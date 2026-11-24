import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { createSlateSaveCore } from "../web/app/server/slate-save-core.mjs";
import { API_TOKEN_SCOPES, createApiTokenService } from "../web/app/server/api-token-core.mjs";
import { actions, createAppRegistry } from "../web/app/server/actions/index.mjs";
import { createRegistry, defineAction } from "../web/app/server/actions/registry.mjs";
import { buildOpenApi } from "../web/app/server/actions/openapi.mjs";
import { buildContract } from "../web/app/server/actions/contract.mjs";
import { renderClientFiles } from "../web/app/server/actions/client-render.mjs";
import { mountDdp } from "../web/app/server/actions/ddp.mjs";
import { OPERATION_RUN_TTL_MS, runExpiry } from "../web/app/imports/api/common/slate-operation-runs.mjs";
import { IDEMPOTENCY_TTL_MS, createIdempotencyStore, ensureIdempotencyIndexes } from "../web/app/server/actions/idempotency.mjs";
import { createRateLimiter } from "../web/app/server/actions/rate-limit.mjs";
import { principalFromToken, principalFromUser } from "../web/app/server/actions/principal.mjs";
import { isApiPath } from "../web/app/server/actions/http.mjs";
import { createClient } from "../packages/slatebox-mcp/src/client/index.js";
import { memoryDriverCollection, memoryMeteorCollection, serve } from "./action-test-stores.mjs";
import { createSlateReader } from "../web/app/server/slate-read.mjs";

// slateboxjs is the app's dependency (web/app), not the repository root's.
const { applyPlanToJSON: applySlateOperationPlanToJSON } = createRequire(
  new URL("../web/app/package.json", import.meta.url),
)("slateboxjs/operations");

const node = (id, text) => ({
  options: { id, text, xPos: 100, yPos: 100, width: 180, height: 100, vectorPath: "rectangle" },
  relationships: { associations: [] },
});
const addPlan = {
  message: "Done — I added a triangle.",
  operations: [{ kind: "add_nodes", shape: "triangle", text: "Decision", count: 1, placement: { relativeTo: "welcome", direction: "right" } }],
};

let world;

function makeWorld({ limits } = {}) {
  const users = memoryMeteorCollection("user");
  users.docs.push({ _id: "owner" }, { _id: "guest", isAnonymous: true });
  const tokens = memoryMeteorCollection("token");
  const slate = {
    _id: "slate-1", shareId: "demo", userId: "owner", lastSaved: 1000,
    options: { name: "Demo", description: "", containerStyle: {} },
    nodes: [node("welcome", "Welcome!")],
  };
  const runs = [];
  const service = createApiTokenService({
    apiTokens: tokens,
    users,
    slates: { findOneAsync: async ({ shareId }) => (shareId === slate.shareId ? slate : null) },
    slateAccess: { find: () => ({ fetchAsync: async () => [] }) },
    now: () => 5000,
  });
  const idempotencyRows = memoryDriverCollection();
  const rateRows = memoryDriverCollection();
  let clock = 0;
  const deps = {
    apiTokens: service,
    authorizeTokenForSlate: service.authorizeTokenForSlate,
    readSlate: createSlateReader({
      listComments: async () => [],
      findPresentation: async () => null,
      appOrigin: () => "https://app.example",
      embedOrigin: () => "https://api.example",
    }),
    applySlateOperationPlanToJSON,
    // Restated (P05a): the operations action saves through the save core; its store is this
    // one slate (selector fields compared, $set and $inc applied, the touch list kept).
    saveCore: createSlateSaveCore({
      slates: {
        async findOne(selector) {
          const holds = Object.entries(selector).every(([key, want]) => key === "revision" ? (slate.revision ?? null) === want : want === null ? slate[key] == null : slate[key] === want);
          return holds ? structuredClone(slate) : null;
        },
        async updateOne(selector, modifier) {
          if (selector._id !== slate._id || (slate.revision ?? null) !== selector.revision) return { matchedCount: 0 };
          for (const [path, value] of Object.entries(modifier.$set)) {
            const keys = path.split(".");
            keys.slice(0, -1).reduce((record, key) => (record[key] ||= {}), slate)[keys.at(-1)] = value;
          }
          slate.revision = (slate.revision ?? 0) + 1;
          return { matchedCount: 1 };
        },
      },
      events: { insertOne: async () => {} },
      now: () => 2000,
    }),
    operationRuns: {
      findOneAsync: async (q) => runs.find((r) => r.tokenId === q.tokenId && r.idempotencyKey === q.idempotencyKey),
      insertAsync: async (run) => runs.push(run),
    },
  };
  const build = () =>
    createAppRegistry({
      deps,
      now: () => 2000 + clock,
      idempotency: createIdempotencyStore({ collection: idempotencyRows, now: () => 2000 + clock }),
      limiter: createRateLimiter({ collection: rateRows, now: () => clock, limits }),
    });
  const authenticate = async (req) => principalFromToken(await service.authenticateApiRequest(req));
  const mint = (scopes = ["slates:read", "slates:write"], userId = "owner") =>
    service.createApiToken({ userId, name: "Agent", scopes });
  return { users, tokens, slate, runs, service, deps, build, authenticate, mint, idempotencyRows, setClock: (ms) => (clock = ms) };
}

beforeEach(() => {
  world = makeWorld();
});

test("an action definition is refused when it would publish something it cannot honour", () => {
  const base = {
    id: "slates.example", title: "Example", description: "Example.", toolset: "slates", kind: "read",
    principals: ["agent"], mounts: { http: { method: "GET", path: "/example/{shareId}" } },
    input: { type: "object", properties: { shareId: { type: "string" } }, required: ["shareId"], additionalProperties: false },
    output: { type: "object" }, handler: () => ({}),
  };
  assert.ok(defineAction(base));
  assert.throws(() => defineAction({ ...base, destructive: true }), /read takes no/);
  assert.throws(() => defineAction({ ...base, principals: ["person"] }), /called by a token/);
  assert.throws(() => defineAction({ ...base, input: { ...base.input, required: [] } }), /path parameter shareId/);
  assert.throws(() => defineAction({ ...base, input: { ...base.input, additionalProperties: true } }), /refuse fields/);
  assert.throws(() => defineAction({ ...base, kind: "write", mounts: { http: { method: "GET", path: "/x" } }, input: { type: "object", properties: { mode: {} }, additionalProperties: false } }), /mode belongs/);
  assert.throws(() => defineAction({ ...base, mounts: { ddp: true } }), /Meteor method is called by a signed-in session/);
  assert.throws(() => defineAction({ ...base, mounts: { ddp: true }, principals: ["person"], tool: { name: "x" } }), /needs one/);
  // A cacheable public answer (library): only a read a visitor may make, with a whole number of seconds.
  assert.equal(defineAction({ ...base, principals: ["agent", "visitor"], publicCache: { maxAge: 300 } }).publicCache.maxAge, 300);
  assert.throws(() => defineAction({ ...base, publicCache: { maxAge: 300 } }), /publicCache is for a read a visitor may make/);
  assert.throws(() => defineAction({ ...base, kind: "write", principals: ["agent", "visitor"], mounts: { http: { method: "POST", path: "/example/{shareId}" } }, idempotency: "optional", publicCache: { maxAge: 60 } }), /publicCache|visitor only reads/);
  assert.throws(() => defineAction({ ...base, principals: ["agent", "visitor"], publicCache: { maxAge: 0 } }), /whole seconds/);
  assert.throws(() => defineAction({ ...base, principals: ["agent", "visitor"], publicCache: { maxAge: 60, private: true } }), /whole seconds/);
});

test("the library's actions: every one has an HTTP route and a tool (commands come from tools); only public reads are cached", () => {
  const registry = createAppRegistry();
  const library = registry.list().filter((action) => action.id.startsWith("library."));
  assert.equal(library.length, 20);
  for (const action of library) {
    assert.ok(action.mounts.http && action.tool?.name, action.id);
    assert.equal(Boolean(action.publicCache), action.principals.includes("visitor"), action.id);
    if (action.publicCache) assert.equal(action.kind, "read", action.id);
    // Review is for administrators: its own permission, and never a guest's or a visitor's.
    if (action.id.startsWith("library.review.")) {
      assert.equal(action.scope, "library:review", action.id);
      assert.deepEqual(action.principals, ["person", "agent"], action.id);
      assert.equal(typeof action.precheck, "function", action.id);
    }
  }
  assert.deepEqual(library.filter((action) => action.publicCache).map((action) => [action.id, action.publicCache.maxAge]).sort(),
    [["library.export", 120], ["library.get", 60], ["library.list", 60], ["library.stats", 300]], "what is taken out leaves shared caches within a minute");
  assert.deepEqual(library.filter((action) => action.confirm).map((action) => action.id).sort(), ["library.review.approve", "library.submit"]);
  assert.deepEqual(library.filter((action) => action.destructive).map((action) => action.id).sort(), ["library.discard", "library.review.unpublish"]);
  // Nothing else in the registry is cached: every other answer stays no-store.
  assert.deepEqual(registry.list().filter((action) => action.publicCache && !action.id.startsWith("library.")).map((action) => action.id), []);
});

test("the OpenAPI document is generated from the registry and lists every route with its flags", async (t) => {
  const registry = world.build();
  const doc = buildOpenApi(registry);
  const routed = actions.filter((action) => action.mounts.http);
  for (const action of routed) {
    const op = doc.paths[action.mounts.http.path][action.mounts.http.method.toLowerCase()];
    assert.equal(op["x-slatebox"].action, action.id);
    assert.equal(op["x-slatebox"].readOnly, action.readOnly);
    assert.equal(op["x-slatebox"].destructive, action.destructive);
    assert.equal(op["x-slatebox"].idempotent, action.idempotent);
    assert.equal(op["x-slatebox"].openWorld, action.openWorld);
  }
  assert.equal(Object.values(doc.paths).flatMap(Object.keys).length, routed.length);
  assert.equal(doc.paths["/slates/{shareId}/invite/{inviteId}"].delete["x-slatebox"].destructive, true);
  assert.equal(doc.paths["/tokens"].post, undefined, "minting a token is never an HTTP route");
  // Served at /api/v1/openapi.json, unauthenticated.
  const call = await serve(t, registry, world.authenticate);
  const served = await call("/api/v1/openapi.json");
  assert.equal(served.status, 200);
  assert.deepEqual(served.body, JSON.parse(JSON.stringify(doc)));
});

// staging-2 (2026-11-20): /exec's mode said "propose stores the change for a person to keep or
// discard" while its enum, and the server, take only save and preview. Every mode's description
// names exactly the modes its enum lists, in the OpenAPI document and the tool contract.
test("every mode description names exactly the modes its enum lists", async () => {
  const registry = world.build();
  const modes = [];
  const walk = (value, where) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach((item, i) => walk(item, where + "/" + i));
    // A response schema lists the mode that ran, with no description to check.
    if (value.properties?.mode?.enum && value.properties.mode.description !== undefined) modes.push([where, value.properties.mode]);
    for (const [key, item] of Object.entries(value)) walk(item, where + "/" + key);
  };
  walk(JSON.parse(JSON.stringify(buildOpenApi(registry))), "openapi");
  walk(JSON.parse(JSON.stringify(buildContract(registry))), "contract");
  const pinnedDoc = JSON.parse(await readFile(new URL("../web/app/server/actions/generated/openapi.json", import.meta.url), "utf8"));
  walk(pinnedDoc, "generated openapi.json");
  assert.ok(modes.some(([where]) => where.includes("/exec/")), "the /exec mode is among them");
  for (const [where, mode] of modes) {
    for (const name of ["save", "preview", "propose"]) {
      assert.equal(new RegExp("\\b" + name + "\\b").test(mode.description ?? ""), mode.enum.includes(name),
        `${where}: the description ${mode.enum.includes(name) ? "names" : "does not name"} ${name} (enum ${mode.enum.join("|")})`);
    }
  }
});

test("the generated OpenAPI document and tool contract are pinned", async () => {
  const registry = world.build();
  const pinned = async (name) =>
    JSON.parse(await readFile(new URL(`../web/app/server/actions/generated/${name}`, import.meta.url), "utf8"));
  assert.deepEqual(JSON.parse(JSON.stringify(buildOpenApi(registry))), await pinned("openapi.json"),
    "Regenerate with: node scripts/generate-action-contract.mjs");
  const contract = buildContract(registry);
  assert.deepEqual(JSON.parse(JSON.stringify(contract)), await pinned("contract.json"),
    "Regenerate with: node scripts/generate-action-contract.mjs");
  const tool = contract.actions.find((a) => a.id === "slates.revokeInvite").tool;
  assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
  assert.ok(contract.actions.every((a) => !JSON.stringify(a.input).includes("$ref")), "schemas stand alone");
  assert.equal(contract.actions.find((a) => a.id === "apiTokens.create"), undefined);
  // The exec client files, in the app and in the MCP package, are pinned the same way.
  for (const [name, text] of Object.entries(renderClientFiles(registry)))
    for (const dir of ["../web/app/server/actions/generated/", "../packages/slatebox-mcp/generated/"])
      assert.equal(await readFile(new URL(dir + name, import.meta.url), "utf8"), text,
        `${dir}${name}: regenerate with: node scripts/generate-action-contract.mjs`);
});

test("a token without the action's scope gets 403 insufficient_scope", async (t) => {
  const call = await serve(t, world.build(), world.authenticate);
  const reader = await world.mint(["slates:read"]);
  const denied = await call("/api/v1/slates/demo/operations", { token: reader.token, method: "POST", body: { plan: addPlan, expectedRevision: world.slate.revision ?? 0 } });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "insufficient_scope");
  assert.equal(denied.body.error.details.requiredScope, "slates:write");
  const missing = await call("/api/v1/slates/demo", { token: "sbx_nope_nope" });
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error.code, "unauthorized");
});

test("mode preview saves nothing and says so; propose is refused until proposals exist; dryRun is gone", async (t) => {
  const call = await serve(t, world.build(), world.authenticate);
  const { token } = await world.mint();
  const preview = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: { plan: addPlan, expectedRevision: world.slate.revision ?? 0, mode: "preview" } });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.mode, "preview");
  assert.equal(world.slate.nodes.length, 1);
  assert.equal(world.runs.length, 0);
  const propose = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: { plan: addPlan, expectedRevision: world.slate.revision ?? 0, mode: "propose" } });
  assert.equal(propose.status, 400);
  assert.equal(propose.body.error.code, "mode_unavailable");
  assert.deepEqual(propose.body.error.details.modes, ["save", "preview"]);
  // Restated (fix-P02, review finding 6): dryRun gets the refusal any undeclared field gets,
  // not a sentence about the old field. It was: assert.match(message, /"mode":"preview"/).
  const old = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: { plan: addPlan, expectedRevision: world.slate.revision ?? 0, dryRun: true } });
  assert.equal(old.status, 400);
  assert.equal(old.body.error.details.field, "dryRun");
  assert.match(old.body.error.message, /dryRun is not a field this request accepts/);
  assert.equal(world.slate.nodes.length, 1);
  const saved = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: { plan: addPlan, expectedRevision: world.slate.revision ?? 0 } });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.mode, "save");
  assert.equal(world.slate.nodes.length, 2);
});

test("a replayed idempotency key with a different body answers 409; the same body replays once", async (t) => {
  const call = await serve(t, world.build(), world.authenticate);
  const { token } = await world.mint();
  const first = { token, key: "edit-1", method: "POST", body: { plan: addPlan, expectedRevision: world.slate.revision ?? 0, userMessage: "Add one" } };
  const [a, b] = await Promise.all([call("/api/v1/slates/demo/operations", first), call("/api/v1/slates/demo/operations", first)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.deepEqual(a.body, b.body);
  assert.equal(world.slate.nodes.length, 2);
  assert.equal(world.runs.length, 1);
  const replay = await call("/api/v1/slates/demo/operations", first);
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("idempotent-replayed"), "true");
  // A field left out and the same field sent with its declared default are one request.
  const bare = { token, key: "edit-2", method: "POST", body: { plan: addPlan, expectedRevision: world.slate.revision ?? 0 } };
  assert.equal((await call("/api/v1/slates/demo/operations", bare)).status, 201);
  const explicit = await call("/api/v1/slates/demo/operations", { ...bare, body: { plan: addPlan, expectedRevision: world.slate.revision ?? 0, userMessage: "" } });
  assert.equal(explicit.status, 200);
  assert.equal(world.slate.nodes.length, 3);
  const different = await call("/api/v1/slates/demo/operations", { ...first, body: { plan: addPlan, expectedRevision: world.slate.revision ?? 0, userMessage: "Add another" } });
  assert.equal(different.status, 409);
  assert.equal(different.body.error.code, "idempotency_conflict");
  assert.equal(world.slate.nodes.length, 3);
  const otherAction = await call("/api/v1/slates", { token, key: "edit-1", method: "POST", body: { brief: "A → B", kind: "diagram" } });
  assert.equal(otherAction.status, 409);
  const malformed = await call("/api/v1/slates/demo/operations", { ...first, key: "has space" });
  assert.equal(malformed.status, 400);
});

// Privacy: an idempotency record (and the answer it replays) is kept 24 hours after it is
// written, then expires. MongoDB drops it by its expiresAt (TTL index); until then, reads treat an
// expired record as absent, so a key reused after a day starts a new request.
test("idempotency records expire 24 hours after they are written; replay works inside the window", async () => {
  let time = 0;
  const rows = memoryDriverCollection();
  const store = createIdempotencyStore({ collection: rows, now: () => time });
  const claim = { subject: "token", key: "k", action: "slates.applyOperations", fingerprint: "f1" };
  assert.equal((await store.reserve(claim)).state, "reserved");
  await store.complete("token", "k", { ok: true, text: "people's words" });
  const [row] = rows.docs.values();
  assert.ok(row.expiresAt instanceof Date, "a TTL index needs a Date");
  assert.equal(row.expiresAt.getTime(), IDEMPOTENCY_TTL_MS);
  assert.equal(IDEMPOTENCY_TTL_MS, 24 * 3600_000);
  time = IDEMPOTENCY_TTL_MS - 1;
  const replay = await store.reserve(claim);
  assert.deepEqual([replay.state, replay.record.response], ["existing", { ok: true, text: "people's words" }]);
  assert.equal((await store.get("token", "k")).state, "done");
  time = IDEMPOTENCY_TTL_MS;
  assert.equal(await store.get("token", "k"), null, "an expired record is not read");
  const fresh = await store.reserve({ ...claim, fingerprint: "f2" });
  assert.equal(fresh.state, "reserved", "an expired key starts a new request");
  const [again] = rows.docs.values();
  assert.equal(again.response, undefined, "the old answer is gone");
  assert.equal(again.expiresAt.getTime(), 2 * IDEMPOTENCY_TTL_MS);
});

// Privacy: a saved run's receipt (the plan, the person's words, the answer) is kept 90 days, then
// MongoDB drops it by its expiresAt; open canvases only ever need the last few.
test("a saved canvas plan's run receipt expires 90 days after it is saved", async (t) => {
  assert.equal(OPERATION_RUN_TTL_MS, 90 * 24 * 3600_000);
  assert.equal(runExpiry(1000).getTime(), 1000 + OPERATION_RUN_TTL_MS);
  assert.equal(runExpiry(new Date(1000)).getTime(), 1000 + OPERATION_RUN_TTL_MS);
  const call = await serve(t, world.build(), world.authenticate);
  const { token } = await world.mint();
  const saved = await call("/api/v1/slates/demo/operations", { token, key: "keep-90", method: "POST", body: { plan: addPlan, expectedRevision: world.slate.revision ?? 0 } });
  assert.equal(saved.status, 201);
  const run = world.runs.at(-1);
  assert.ok(run.expiresAt instanceof Date);
  assert.equal(run.expiresAt.getTime(), new Date(run.createdAt).getTime() + OPERATION_RUN_TTL_MS);
});

// Release/agentic, the lead's decision: every edit through the API names the revision it was
// made on. A canvas plan without expectedRevision is refused with a 400 that names it, preview
// and save alike, and nothing is saved.
test("a canvas edit without expectedRevision is refused with 400 invalid_request naming it", async (t) => {
  const call = await serve(t, world.build(), world.authenticate);
  const { token } = await world.mint();
  for (const mode of ["preview", "save"]) {
    const refused = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: { plan: addPlan, mode } });
    assert.equal(refused.status, 400, mode);
    assert.equal(refused.body.error.code, "invalid_request");
    assert.equal(refused.body.error.details.field, "expectedRevision");
    assert.match(refused.body.error.message, /expectedRevision is required/);
  }
  assert.equal(world.slate.nodes.length, 1);
  assert.equal(world.runs.length, 0);
  const doc = buildOpenApi(world.build());
  assert.match(doc.paths["/slates/{shareId}/operations"].post.requestBody.content["application/json"].schema.properties.expectedRevision.description, /^Required with a canvas plan/);
});

// A retry, or a script run again to confirm, reads the slate again: the same edit with a later
// expectedRevision is the same request, so its key replays instead of answering 409.
test("a key replays the same edit sent again with a later expectedRevision", async (t) => {
  const call = await serve(t, world.build(), world.authenticate);
  const { token } = await world.mint();
  const first = await call("/api/v1/slates/demo/operations", { token, key: "rev-1", method: "POST", body: { plan: addPlan, expectedRevision: 0 } });
  assert.equal(first.status, 201);
  const again = await call("/api/v1/slates/demo/operations", { token, key: "rev-1", method: "POST", body: { plan: addPlan, expectedRevision: first.body.revision } });
  assert.equal(again.status, 200);
  assert.equal(again.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(again.body, first.body);
  assert.equal(world.slate.nodes.length, 2);
});

test("calls made with a token report their rate limit, counted per token and per account, in the database", async (t) => {
  world = makeWorld({ limits: { perToken: 2, perAccount: 3, windowSeconds: 60 } });
  // Two app processes share one store: the count is not per process.
  const callA = await serve(t, world.build(), world.authenticate);
  const callB = await serve(t, world.build(), world.authenticate);
  const one = await world.mint(["slates:read"]);
  const two = await world.mint(["slates:read"]);
  const first = await callA("/api/v1/slates/demo", { token: one.token });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("ratelimit-limit"), "2");
  assert.equal(first.headers.get("ratelimit-remaining"), "1");
  assert.equal(first.headers.get("ratelimit-reset"), "60");
  assert.equal((await callB("/api/v1/slates/demo", { token: one.token })).status, 200);
  const refused = await callA("/api/v1/slates/demo", { token: one.token });
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error.code, "rate_limited");
  assert.equal(refused.headers.get("retry-after"), "60");
  assert.equal(refused.body.error.retryAfter, 60);
  assert.equal(refused.headers.get("ratelimit-remaining"), "0");
  // The account's third call was the refused one; a second token of the same account is refused too.
  const sibling = await callB("/api/v1/slates/demo", { token: two.token });
  assert.equal(sibling.status, 429);
  world.setClock(60000);
  assert.equal((await callA("/api/v1/slates/demo", { token: two.token })).status, 200);
});

test("a token lists and revokes itself only; revoking current signs the agent out; minting needs a session", async (t) => {
  const call = await serve(t, world.build(), world.authenticate);
  const agent = await world.mint(["slates:read"]);
  const other = await world.mint(["slates:write"]);
  const listed = await call("/api/v1/tokens", { token: agent.token });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.tokens.map((row) => row._id), [agent.id]);
  assert.equal(JSON.stringify(listed.body).includes("tokenHash"), false);
  assert.equal(JSON.stringify(listed.body).includes(agent.token), false);
  const notMine = await call(`/api/v1/tokens/${other.id}`, { token: agent.token, method: "DELETE" });
  assert.equal(notMine.status, 404);
  assert.equal(world.tokens.docs.find((row) => row._id === other.id).revokedAt, null);
  const mint = await call("/api/v1/tokens", { token: agent.token, method: "POST", body: { scopes: ["slates:write"] } });
  assert.equal(mint.status, 404);
  assert.equal(mint.body.error.code, "unknown_route");
  const out = await call("/api/v1/tokens/current", { token: agent.token, method: "DELETE" });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { tokenId: agent.id, revoked: true, mode: "save" });
  const after = await call("/api/v1/tokens", { token: agent.token });
  assert.equal(after.status, 401);
});

test("the Developer tab and the API run one handler for list, create and revoke", async (t) => {
  const registry = world.build();
  const seen = [];
  const spied = { ...world.service };
  for (const name of ["listApiTokens", "revokeApiToken", "createApiToken"]) {
    spied[name] = async (...args) => {
      seen.push(name);
      return world.service[name](...args);
    };
  }
  world.deps.apiTokens = spied;
  let methods;
  const names = mountDdp(registry, {
    defineMethods: (defined) => (methods = defined),
    makeError: (code, reason, details) => Object.assign(new Error(reason), { error: code, reason, details }),
    loadUser: async (id) => world.users.docs.find((user) => user._id === id),
    scopes: API_TOKEN_SCOPES,
  });
  // Restated (P05a, P08): the slate settings and copy actions are also Meteor methods (session only),
  // and the Developer tab and the profile menu also read instance.describe and account.get.
  // The AI settings page reads, changes and tests AI connections through ai.get, ai.update and ai.check.
  // Restated (Mermaid): the app's Mermaid dialog imports through slates.importMermaid, the action tokens call.
  // Restated (team export): Team settings › Export everything calls team.export, and Admin tools ›
  // Import a team export calls teamImports.start, list, get, confirm, invite and discard.
// Restated (agent teammates): the canvas's Agent tasks panel lists, asks and approves through
  // agentTasks.list, agentTasks.create and agentTasks.update, the actions tokens call.
  // Restated (agent suggestions): the canvas reads what agents suggest through suggestions.list, keeps,
  // discards and undoes through suggestions.decide (the action tokens call), and people pause agents or
  // let one edit directly through agents.control.
// Restated (video notes): a video address pasted on the canvas is looked up through media.lookup,
  // and slates.addMedia is the same add the API, exec and MCP make.
  // Restated (library): the app's library pages, the builder and the review panel call every library.*
  // action but library.export (a token's or a visitor's read for the public gallery build).
  // Restated (AI control S1): administrators read AI control through ai.control.get and
  // ai.control.effective, Meteor methods only until the admin toolset gives them HTTP and tools.
  // Restated (AI control S2): the Overview, Audit and reset of /admin/ai call ai.control.health,
  // ai.audit.list and ai.control.reset, the actions tokens call.
  // Restated (AI control S3): Providers and keys and Models call ai.providers.*, ai.connections.*
  // and ai.models.*; archive and remove are Meteor methods only (a person, never a token).
  assert.deepEqual(names.sort(), ["account.get", "agentTasks.create", "agentTasks.list", "agentTasks.update", "agents.control", "ai.audit.list", "ai.check", "ai.connections.list", "ai.connections.remove", "ai.connections.save", "ai.control.effective", "ai.control.get", "ai.control.health", "ai.control.reset", "ai.get", "ai.models.discover", "ai.models.save", "ai.providers.archive", "ai.providers.save", "ai.update", "apiTokens.create", "apiTokens.list", "apiTokens.revoke", "comments.add", "instance.describe", "library.branch", "library.comment", "library.discard", "library.fork", "library.get", "library.list", "library.mine", "library.review.approve", "library.review.open", "library.review.queue", "library.review.refine", "library.review.reject", "library.review.requestChanges", "library.review.unpublish", "library.review.update", "library.saveDraft", "library.stats", "library.submit", "library.withdraw", "media.lookup", "slates.addMedia", "slates.copy", "slates.importMermaid", "slates.updateSettings", "suggestions.decide", "suggestions.list", "team.export", "teamImports.confirm", "teamImports.discard", "teamImports.get", "teamImports.invite", "teamImports.list", "teamImports.start"]);
  const asOwner = { userId: "owner" };
  const created = await methods["apiTokens.create"].call(asOwner, { name: "From the tab", scopes: ["slates:read"] });
  assert.match(created.token, /^sbx_/);
  assert.equal((await methods["apiTokens.list"].call(asOwner)).tokens.length, 1);
  await assert.rejects(methods["apiTokens.list"].call({ userId: "guest" }), { error: "registration_required" });
  await assert.rejects(methods["apiTokens.create"].call({ userId: null }, { scopes: ["slates:read"] }), { error: "unauthorized" });
  await assert.rejects(methods["apiTokens.create"].call(asOwner, { scopes: ["team:admin"] }), { error: "invalid_request" });
  const call = await serve(t, registry, world.authenticate);
  assert.equal((await call("/api/v1/tokens", { token: created.token })).status, 200);
  await methods["apiTokens.revoke"].call(asOwner, { tokenId: created.id });
  assert.equal((await call("/api/v1/tokens", { token: created.token })).status, 401);
  const viaHttp = await methods["apiTokens.create"].call(asOwner, { name: "Second", scopes: ["slates:read"] });
  assert.equal((await call("/api/v1/tokens/current", { token: viaHttp.token, method: "DELETE" })).status, 200);
  assert.deepEqual(seen, ["createApiToken", "listApiTokens", "listApiTokens", "revokeApiToken", "createApiToken", "revokeApiToken"]);
  await assert.rejects(methods["apiTokens.revoke"].call(asOwner, { tokenId: "someone-elses" }), { error: "not_found" });
  for (let index = 0; index < 10; index += 1) await methods["apiTokens.create"].call(asOwner, { scopes: ["slates:read"] });
  await assert.rejects(methods["apiTokens.create"].call(asOwner, { scopes: ["slates:read"] }), { error: "token_limit" });
});

test("every refusal on /api/v1 uses one error shape, including bad JSON and unknown routes and fields", async (t) => {
  const call = await serve(t, world.build(), world.authenticate);
  const { token } = await world.mint();
  const badJson = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: "{nope" });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.error.code, "invalid_json");
  const unknown = await call("/api/v1/nothing-here", { token });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, "unknown_route");
  const query = await call("/api/v1/slates/demo?include=everything", { token });
  assert.equal(query.status, 400);
  assert.equal(query.body.error.details.field, "include");
  const extra = await call("/api/v1/slates/demo?colour=red", { token });
  assert.equal(extra.status, 400);
  const field = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: { plan: addPlan, expectedRevision: 0, extra: 1 } });
  assert.equal(field.status, 400);
  assert.match(field.body.error.message, /extra is not a field/);
  for (const response of [badJson, unknown, query, field]) assert.equal(response.headers.get("cache-control"), "no-store");
});

test("fields named after Object.prototype members are refused like any other undeclared field", async (t) => {
  const registry = world.build();
  const person = principalFromUser({ _id: "owner" }, API_TOKEN_SCOPES);
  const create = (extra) => registry.run(person, "apiTokens.create", { scopes: ["slates:read"], ...extra });
  for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
    await assert.rejects(create({ [name]: { $where: "1" } }), (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.details.field, name);
      return true;
    });
  }
  // An own __proto__ key, as JSON.parse (and so EJSON over DDP) delivers it.
  const own = JSON.parse('{"scopes":["slates:read"],"__proto__":{"$where":"1"}}');
  await assert.rejects(registry.run(person, "apiTokens.create", own), (error) => error.details.field === "__proto__");
  // Input that borrows its fields from a prototype is not a plain object.
  const borrowed = Object.assign(Object.create({ mode: "preview" }), { scopes: ["slates:read"] });
  await assert.rejects(registry.run(person, "apiTokens.create", borrowed), { status: 400, code: "invalid_request" });
  assert.equal(world.tokens.docs.length, 0, "no refused request minted a token");

  const call = await serve(t, registry, world.authenticate);
  const { token } = await world.mint();
  const query = await call("/api/v1/slates/demo?constructor=x", { token });
  assert.equal(query.status, 400);
  assert.match(query.body.error.message, /constructor is not accepted/);
  const operator = await call("/api/v1/slates/demo/operations", {
    token, method: "POST", body: { plan: addPlan, expectedRevision: world.slate.revision ?? 0, constructor: { $where: "1" } },
  });
  assert.equal(operator.status, 400);
  assert.equal(operator.body.error.details.field, "constructor");
  // Over HTTP, __proto__ once became the input's prototype and set mode without being declared.
  const smuggled = await call("/api/v1/slates/demo/operations", {
    token, method: "POST", body: `{"plan":${JSON.stringify(addPlan)},"expectedRevision":0,"__proto__":{"mode":"preview"}}`,
  });
  assert.equal(smuggled.status, 400);
  assert.equal(smuggled.body.error.details.field, "__proto__");
  assert.equal(world.slate.nodes.length, 1);
  assert.equal(world.runs.length, 0);
});

// Restated (exec): the package's hand-written SlateboxClient became createClient, generated
// from client.json (one method per action id). Same calls, same assertions.
test("the MCP and CLI client previews and saves through the registry's own route, not a mock", async (t) => {
  const call = await serve(t, world.build(), world.authenticate);
  const { token } = await world.mint();
  const client = createClient({ baseUrl: call.base, token });
  const preview = await client.slates.applyOperations({ shareId: "demo", expectedRevision: world.slate.revision ?? 0, plan: addPlan, mode: "preview" });
  assert.equal(preview.mode, "preview");
  assert.equal(world.slate.nodes.length, 1);
  const saved = await client.slates.applyOperations({ shareId: "demo", expectedRevision: world.slate.revision ?? 0, plan: addPlan }, { idempotencyKey: "client-save" });
  assert.equal(saved.mode, "save");
  assert.equal(world.slate.nodes.length, 2);
  assert.deepEqual(await client.slates.applyOperations({ shareId: "demo", expectedRevision: world.slate.revision ?? 0, plan: addPlan }, { idempotencyKey: "client-save" }), saved);
  assert.equal(world.slate.nodes.length, 2);
});

test("the app's own JSON parser leaves every /api/v1 path to the API, whatever its case", () => {
  for (const path of ["/api/v1/slates/demo/operations", "/API/V1/slates/demo/operations", "/Api/v1", "/api/v1/"])
    assert.equal(isApiPath(path), true, path);
  for (const path of ["/api/v10/slates", "/stripehooks", "/apiv1/slates", "/x/api/v1/"])
    assert.equal(isApiPath(path), false, path);
});

test("an edit that can delete notes or connections is declared destructive", () => {
  const registry = world.build();
  const edit = buildContract(registry).actions.find((a) => a.id === "slates.applyOperations");
  assert.equal(edit.tool.name, "edit_slate");
  assert.equal(edit.tool.annotations.destructiveHint, true);
  assert.equal(buildOpenApi(registry).paths["/slates/{shareId}/operations"].post["x-slatebox"].destructive, true);
});

// Optional, against a loopback replica set: the registry's stores on the real driver.
test(
  "Mongo: idempotency records and rate windows behave the same on the real driver",
  { skip: !process.env.SLATEBOX_TEST_WORKSHOP_MONGO_PORT },
  async (t) => {
    const { createRequire } = await import("node:module");
    const { randomUUID } = await import("node:crypto");
    const require = createRequire(new URL("../web/app/package.json", import.meta.url));
    const { MongoClient } = require(process.env.SLATEBOX_TEST_MONGODB_DRIVER || "mongodb");
    const client = new MongoClient("mongodb://127.0.0.1:" + process.env.SLATEBOX_TEST_WORKSHOP_MONGO_PORT);
    const db = client.db("slatebox_actions_test_" + randomUUID().replaceAll("-", ""));
    t.after(async () => {
      await db.dropDatabase();
      await client.close();
    });
    let time = 1000;
    await ensureIdempotencyIndexes(db.collection("idempotency"));
    const ttl = (await db.collection("idempotency").indexes()).find((index) => index.key.expiresAt === 1);
    assert.equal(ttl?.expireAfterSeconds, 0);
    const store = createIdempotencyStore({ collection: db.collection("idempotency"), now: () => time, staleMs: 50 });
    const claim = { subject: "token", key: "k", action: "slates.applyOperations", fingerprint: "f1" };
    assert.equal((await store.reserve(claim)).state, "reserved");
    const busy = await store.reserve(claim);
    assert.equal(busy.state, "existing");
    assert.equal(busy.record.state, "pending");
    time += 100; // the first holder died: its claim is taken over
    assert.equal((await store.reserve(claim)).state, "reserved");
    await store.complete("token", "k", { ok: true });
    const done = await store.reserve(claim);
    assert.deepEqual([done.record.state, done.record.response], ["done", { ok: true }]);
    await store.reserve({ ...claim, key: "gone" });
    await store.release("token", "gone");
    assert.equal(await store.get("token", "gone"), null);
    const limiter = createRateLimiter({ collection: db.collection("rate"), now: () => 0, limits: { perToken: 1, perAccount: 5, windowSeconds: 60 } });
    assert.deepEqual(await limiter.take({ tokenId: "a", userId: "u" }), { allowed: true, limit: 1, remaining: 0, resetSeconds: 60 });
    assert.equal((await limiter.take({ tokenId: "a", userId: "u" })).allowed, false);
    assert.equal((await db.collection("rate").findOne({ _id: "account:u:0" })).count, 2);
  }
);

test("the rate limiter counts reaching outside addresses per account, for people too", async () => {
  const rows = new Map();
  const collection = { findOneAndUpdate: async ({ _id }, update) => { const row = rows.get(_id) || { _id, count: 0 }; row.count += update.$inc.count; rows.set(_id, row); return { ...row }; }, findOne: async ({ _id }) => rows.get(_id) || null };
  const db = { collection: () => collection };
    // Reaching outside addresses (openWorld) is counted per account for people too, at its own lower rate.
    const open = createRateLimiter({ collection: db.collection("rate-open"), now: () => 0, limits: { perToken: 100, perAccount: 100, perAccountOpenWorld: 2, windowSeconds: 60 } });
    const ada = { kind: "person", userId: "ada", tokenId: null };
    assert.equal((await open.take(ada, { openWorld: true })).allowed, true);
    assert.equal((await open.take(ada, { openWorld: true })).allowed, true);
    assert.deepEqual(await open.take(ada, { openWorld: true }), { allowed: false, limit: 2, remaining: 0, resetSeconds: 60 });
    // a token of the same account shares that count, and still counts its own windows when allowed
    assert.equal((await open.take({ kind: "agent", tokenId: "t", userId: "ada" }, { openWorld: true })).allowed, false);
    assert.equal((await open.take({ kind: "agent", tokenId: "t2", userId: "ben" }, { openWorld: true })).allowed, true);
    assert.equal((await db.collection("rate-open").findOne({ _id: "token:t2:0" })).count, 1);
});

test("the registry meters people too on actions that reach outside addresses", async () => {
  const taken = [];
  const limiter = { take: async (principal, options) => { taken.push([principal.kind, Boolean(options?.openWorld)]); return { allowed: taken.length < 3, limit: 2, remaining: 0, resetSeconds: 9 }; } };
  const reach = defineAction({ id: "outside.reach", title: "Reach", description: "Reaches an outside address.", toolset: "t", kind: "write", openWorld: true, changesNoSlate: true, principals: ["person"], mounts: { ddp: true }, input: { type: "object", properties: {}, additionalProperties: false }, output: { type: "object" }, handler: async () => ({ status: 200, body: { ok: true } }) });
  const plain = defineAction({ id: "inside.read", title: "Read", description: "Reads.", toolset: "t", kind: "read", principals: ["person"], mounts: { ddp: true }, input: { type: "object", properties: {}, additionalProperties: false }, output: { type: "object" }, handler: async () => ({ status: 200, body: { ok: true } }) });
  const registry = createRegistry({ actions: [reach, plain], scopes: ["slates:read"], limiter });
  const ada = { kind: "person", userId: "ada", tokenId: null, scopes: [] };
  await registry.run(ada, "inside.read", {});
  assert.deepEqual(taken, [], "a person's ordinary call is not metered");
  await registry.run(ada, "outside.reach", {});
  await registry.run(ada, "outside.reach", {});
  await assert.rejects(registry.run(ada, "outside.reach", {}), { status: 429, code: "rate_limited" });
  assert.deepEqual(taken, [["person", true], ["person", true], ["person", true]]);
});

test("the scopes a token may need are derived from the actions: every scope any agent-callable action checks, in the token vocabulary's order", () => {
  const registry = world.build();
  // ai:admin is checked by ai.update and ai.check for level team or server, so they declare it.
  assert.deepEqual(registry.neededScopes(), API_TOKEN_SCOPES);
  assert.ok(registry.neededScopes().includes("slates:delete"), "deleting is its own permission");
  assert.deepEqual(["slates.delete", "comments.remove"].map((id) => registry.get(id).scope), ["slates:delete", "slates:delete"]);
  for (const id of ["agentTasks.list", "agentTasks.create", "agentTasks.update", "comments.list", "comments.add", "comments.resolve", "comments.remove"]) {
    const action = registry.get(id);
    assert.ok(action, id);
    assert.ok(registry.neededScopes().includes(action.scope), id);
  }
  assert.throws(
    () => defineAction({ id: "probe.x", title: "x", description: "x", toolset: "x", kind: "read", scope: "slates:read", alsoScopes: "ai:admin", principals: ["agent"], input: { type: "object", properties: {}, additionalProperties: false }, output: { type: "object", properties: {} }, handler: async () => ({}) }),
    /alsoScopes/
  );
});

test("an OAuth connection lacking a permission is told to reconnect and allow it; a personal token to create one", async () => {
  const registry = world.build();
  const ask = (principal) => registry.run(principal, "slates.issueInvite", { shareId: "demo", role: "viewer" }).catch((error) => error);
  const base = { kind: "agent", userId: "owner", tokenId: "t1", scopes: ["slates:read", "slates:write"] };
  const viaApp = await ask({ ...base, oauth: true });
  assert.equal(viaApp.code, "insufficient_scope");
  assert.match(viaApp.message, /Reconnect/);
  assert.match(viaApp.message, /slates:share/);
  assert.doesNotMatch(viaApp.message, /Create a token/);
  const viaToken = await ask(base);
  assert.match(viaToken.message, /Create a token that has it/);
});
