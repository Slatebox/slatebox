// exec scripts, called in memory through the MCP server and the local runner, against the
// app's action registry routes behind the exec gate (the same gatedRegistry the app mounts),
// the engine's canvas operations and the app's workshop operations.
// Restated (exec): each per-action tool call is now an exec script making the same call, with
// the same assertions on the stored slates. New, deliberately: saves that remove notes or
// connectors, or share a slate, are held as confirmation_required by the gate and saved only
// when the same script is run again with confirm; the assertions check both halves.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSlateboxMcpServer } from "../src/server.js";
import { createExec } from "../src/exec/index.js";
import { defaultGenerated } from "../src/generated.js";

const app = new URL("../../../web/app/", import.meta.url);
const { createAppRegistry } = await import(new URL("server/actions/index.mjs", app));
const { mountHttp } = await import(new URL("server/actions/http.mjs", app));
const { createIdempotencyStore } = await import(new URL("server/actions/idempotency.mjs", app));
const { buildClientManifest } = await import(new URL("server/actions/client-render.mjs", app));
const { createGate } = await import(new URL("server/exec/gate.mjs", app));
const { createExecStore } = await import(new URL("server/exec/audit.mjs", app));
const { gatedRegistry } = await import(new URL("server/exec/system.mjs", app));
const { memoryDriverCollection } = await import(new URL("../../scripts/action-test-stores.mjs", app));
// The exec store's in-memory collection (it supports $push), from builder A's exec test world.
const { memoryCollection } = await import(new URL("../../scripts/exec-test-world.mjs", app));
const { createWorkshopOperations } = await import(new URL("server/workshop-operation-api.mjs", app));
const { createSlateReader } = await import(new URL("server/slate-read.mjs", app));
const { createPrivateSlateOperation } = await import(new URL("server/create-slate-api.mjs", app));
const { createSlateSaveCore } = await import(new URL("server/slate-save-core.mjs", app));
const requireApp = createRequire(new URL("package.json", app));
const { applyPlanToJSON, describeOperations, LIMITS } = requireApp("slateboxjs/operations");
const { default: express } = await import(requireApp.resolve("express"));
const { createWorkshopMap, validateWorkshop, describeWorkshopEdits } = requireApp("slateboxjs/workshops/model");
const { createInstanceDescriber } = await import(new URL("server/instance/describe.mjs", app));
const { createAccounts } = await import(new URL("server/instance/account-summary.mjs", app));
const { resolveInstanceIdentity } = await import(new URL("server/instance/identity.mjs", app));
const { actions } = await import(new URL("server/actions/index.mjs", app));
const { RATE_LIMITS } = await import(new URL("server/actions/rate-limit.mjs", app));
const { createAISettings } = await import(new URL("server/methods/ai/ai-settings-core.mjs", app));
const { createAgentTasks } = await import(new URL("server/agents/agentTasks.mjs", app));
const { createAgentPresence } = await import(new URL("server/presence/agentPresence.mjs", app));
const { deckRecord } = await import(new URL("imports/ui/components/presentations/presentationCompose.mjs", app));

const at = (doc, path) => path.split(".").reduce((value, key) => value?.[key], doc);
function put(doc, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let target = doc;
  for (const key of keys) target = target[key] ??= {};
  target[last] = value;
}
const matches = (doc, query) => Object.entries(query).every(([path, want]) => {
  const have = at(doc, path);
  if (want && typeof want === "object") {
    if ("$ne" in want) return want.$ne === null ? have != null : have !== want.$ne;
    // slates.undo and slates.redo read the caller's receipts by these.
    if ("$exists" in want) return (have !== undefined) === want.$exists;
    if ("$gt" in want) return have > want.$gt;
  }
  return (have ?? null) === want;
});
// A Meteor findOneAsync's sort: { field: 1 | -1 }, in order.
const sorted = (rows, sort = {}) => [...rows].sort((a, b) => {
  for (const [path, dir] of Object.entries(sort)) {
    const x = at(a, path) ?? -Infinity, y = at(b, path) ?? -Infinity;
    if (x !== y) return x < y ? -dir : dir;
  }
  return 0;
});

/** Enough of a Mongo collection, raw and Meteor-shaped, for the API handlers. */
function collection(rows = []) {
  const update = (selector, { $set = {}, $inc = {}, $push = {} }) => {
    const doc = rows.find((row) => matches(row, selector));
    if (!doc) return 0;
    for (const [path, value] of Object.entries($set)) put(doc, path, structuredClone(value));
    for (const [path, value] of Object.entries($inc)) put(doc, path, (at(doc, path) ?? 0) + value);
    for (const [path, value] of Object.entries($push)) put(doc, path, [...(at(doc, path) ?? []), ...structuredClone(value.$each)]);
    return 1;
  };
  return {
    rows,
    findOne: async (query) => structuredClone(rows.find((row) => matches(row, query)) ?? null),
    insertOne: async (row) => { rows.push(structuredClone(row)); },
    updateOne: async (selector, modifier) => ({ matchedCount: update(selector, modifier) }),
    findOneAsync: async (query, options = {}) => structuredClone(sorted(rows.filter((row) => matches(row, query)), options.sort)[0] ?? null),
    // A Meteor insert gives the row an _id when it has none.
    insertAsync: async (row) => { rows.push(structuredClone({ _id: "row-" + rows.length, ...row })); },
    updateAsync: async (selector, modifier) => update(selector, modifier),
  };
}

function note(id, text, xPos) {
  return { options: { id, text, shape: "rectangle", vectorPath: "rectangle", xPos, yPos: 100, width: 200, height: 100 },
    relationships: { associations: [] } };
}

function workshopSlate(shareId, workshop) {
  return { _id: shareId + "-id", shareId, userId: "owner", orgId: null, nodes: [], options: { isPrivate: true },
    lastSaved: 1, creative: { revision: 3, model: { version: 1, kind: "workshop", workshop } } };
}

async function instance(t) {
  const canvas = { _id: "canvas-id", shareId: "canvas", userId: "owner", orgId: null, lastSaved: 1,
    options: { name: "Probe", isPrivate: true }, nodes: [note("a", "Alpha", 0), note("b", "Beta", 300), note("c", "Gamma", 600)] };
  canvas.nodes[0].relationships.associations.push({ id: "a->b", parentId: "a", childId: "b", lineColor: "#333333", lineWidth: 3 });
  const map = createWorkshopMap();
  map.lanes.push({ id: "other", label: "Other", station: { column: 1, row: 1, next: [], outcome: "Other." } });
  const slates = collection([
    canvas,
    workshopSlate("lanes", { version: 1, title: "Record one",
      lanes: [{ id: "ready", label: "Pitches" }, { id: "slot", label: "Friday", capacity: 1 }, { id: "done", label: "Archive" }],
      cards: [{ id: "horn", label: "Horn", laneId: "ready", allowedLaneIds: ["ready", "slot"] }, { id: "chorus", label: "Chorus", laneId: "slot" }] }),
    workshopSlate("map", validateWorkshop(map)),
  ]);
  const runs = collection();
  // Wave 2 (P05a): every writer saves through the app's save core, over the same collection.
  const saveCore = createSlateSaveCore({ slates, events: collection() });
  const stores = { slates, runs, saveCore, withTransaction: (action) => action({}) };
  const invites = [];
  const transfers = [];
  const handedOff = [];
  // Wave 2 (P08): the instance description and the account, on in-memory stores.
  const settings = { public: { env: "selfhost", baseUrl: "http://127.0.0.1" }, selfHosted: { workshopAI: false } };
  const accounts = createAccounts({
    settings, origin: "http://127.0.0.1",
    findUser: async (id) => (id === "owner" ? { _id: "owner", emails: [{ address: "owner@example.test", verified: true }], profile: { firstName: "Owner" } } : null),
    findOrganization: async () => null, listClaims: async () => [], listTiers: async () => [],
    countAiUsed: async () => 0, readAiAllowance: async () => ({ free: 10, pro: 200 }), canGenerate: async () => false,
  });
  const describer = createInstanceDescriber({
    settings, origin: "http://127.0.0.1", accounts, actions, rateLimits: RATE_LIMITS, mailAvailable: () => false,
    identity: () => resolveInstanceIdentity({ collection: memoryDriverCollection(), configuredId: "probe-instance-0001" }),
    engine: { version: "probe", operations: describeOperations(), workshopEdits: describeWorkshopEdits(), limits: LIMITS },
  });
  const idempotency = createIdempotencyStore({ collection: memoryDriverCollection() });
  // AI settings (any-ai): the real settings service on an in-memory store; Test connection is stubbed.
  const aiConnections = [], aiUses = new Map();
  const ownerOf = (owner) => (doc) => doc.ownerType === owner.type && doc.ownerId === owner.id;
  const ai = createAISettings({
    store: {
      listConnections: async (owner) => aiConnections.filter(ownerOf(owner)),
      saveConnection: async (owner, doc) => {
        const at = aiConnections.findIndex((row) => ownerOf(owner)(row) && row.name === doc.name);
        aiConnections.splice(at < 0 ? aiConnections.length : at, at < 0 ? 0 : 1, { ...doc, ownerType: owner.type, ownerId: owner.id });
      },
      removeConnection: async (owner, name) => { const at = aiConnections.findIndex((row) => ownerOf(owner)(row) && row.name === name); if (at >= 0) aiConnections.splice(at, 1); },
      getUse: async (owner) => aiUses.get(`${owner.type}:${owner.id}`) || { use: {} },
      setUse: async (owner, value) => { aiUses.set(`${owner.type}:${owner.id}`, value); },
    },
    master: null, settings, hosted: false,
    loadUser: async (id) => (id === "owner" ? { _id: "owner", orgId: null } : null),
    isAdmin: async () => false, isTeamAdmin: async () => false,
    check: async (connection) => ({ ok: true, reachable: true, models: [connection.model], modelListed: true, chat: "ok", tools: "yes", message: "Connected." }),
  });
  // The probe's deck of its canvas slate: a styled presentation, as Present saves one.
  const box = (x) => ({ rotation: 0, bbox: { x, y: 0, width: 120, height: 60 } });
  const deckLayout = { nodes: [{ nodeId: "a", description: "Plan", metrics: box(0), childrenNodes: [
    { nodeId: "b", description: "Beta", metrics: box(300), childrenNodes: [] },
    { nodeId: "c", description: "Gamma", metrics: box(600), childrenNodes: [] }] }] };
  const deckRow = { _id: "deck1", version: 1, name: "Probe deck", presentationData: JSON.stringify(deckLayout), ...deckRecord({ layout: deckLayout, name: "Probe" }) };
  const restyles = [];
  const planned = [];
  // Parity (slates.list, slates.copy, slates.delete, comments.*): the app's rules have their own
  // tests (scripts/agent-parity.test.mjs). Here: the routes and the calls, on the same store.
  const comments = [];
  const deletedSlates = [];
  const registry = createAppRegistry({ deps: {
    listSlates: async ({ userId, limit }) => slates.rows.filter((row) => row.userId === userId).slice(0, limit),
    deleteSlate: async (slate) => { deletedSlates.push(slate.shareId); return { deleted: true }; },
    resolveSlateForUser: async (shareId, userId) => {
      const slate = await slates.findOne({ shareId });
      return slate && { slate, canRead: true, canEdit: slate.userId === userId };
    },
    publishedPresentation: async () => null,
    newId: () => "copied-id",
    generateShareId: async () => "copied",
    userName: async () => "Owner",
    comments: {
      list: async ({ slateId, nodeId }) => comments.filter((c) => c.slateId === slateId && (!nodeId || c.nodeId === nodeId)),
      add: async (row) => { comments.push({ ...row, _id: "k" + (comments.length + 1) }); return "k" + comments.length; },
      resolve: async ({ slateId, nodeId, resolved }) => comments.filter((c) => c.slateId === slateId && c.nodeId === nodeId).map((c) => (c.resolved = resolved)).length,
      get: async ({ slateId, commentId }) => comments.find((c) => c.slateId === slateId && c._id === commentId) ?? null,
      remove: async ({ commentId }) => { comments.splice(comments.findIndex((c) => c._id === commentId), 1); return 1; },
    },
    ai,
    latestPresentation: async (shareId, userId) => (shareId === "canvas" && userId === "owner" ? deckRow : null),
    savePresentation: async (id, set) => { restyles.push([id, set.style]); Object.assign(deckRow, set); },
    // presentations.create: Present's planner, stood in for (the AI is not reached here).
    createPresentation: async (request) => {
      planned.push(request);
      return { row: { ...deckRow, _id: request.preview ? null : "deck2", version: request.preview ? null : 2 }, automatic: false, reason: "" };
    },
    instance: describer,
    accounts,
    // Wave 2 (P07): the service also says what the caller may do; the probe owns every slate.
    authorizeTokenForSlate: async (_token, shareId) => {
      const slate = await slates.findOne({ shareId });
      return { authorized: Boolean(slate), slate,
        access: { role: "EDIT", canEdit: true, isOwner: true, linkRole: null, grantKey: null } };
    },
    readSlate: createSlateReader({ listComments: async () => [], findPresentation: async () => null,
      appOrigin: () => "http://127.0.0.1", embedOrigin: () => "http://127.0.0.1" }),
    saveCore,
    applyWorkshopOperations: createWorkshopOperations(stores),
    createPrivateSlate: createPrivateSlateOperation({ ...stores, users: collection([{ _id: "owner", orgId: null }]),
      generateShareId: async () => "created", appOrigin: () => "http://127.0.0.1" }),
    // The invitation core needs Mongo transactions; its own tests cover it. Here: the route and the call.
    manageInvite: async ({ shareId, key, body, inviteId, revoke }) => {
      invites.push({ shareId, key, body, inviteId, revoke });
      return { status: 200, body: revoke ? { shareId, inviteId, revoked: true }
        : { shareId, inviteId: "e".repeat(32), role: body.role, url: "http://127.0.0.1/canvas/x" } };
    },
    applySlateOperationPlanToJSON: applyPlanToJSON,
    operationRuns: runs,
    appOrigin: () => "http://127.0.0.1",
    // Agents on the canvas: the real store, in memory.
    presence: createAgentPresence({ collection: memoryCollection(), secret: "probe",
      findUser: async () => ({ _id: "owner", profile: { firstName: "Owner" } }) }),
    // Agent tasks: the real store, in memory (the Slatebox agent has its own tests,
    // scripts/agent-tasks.test.mjs). Here: an open task asked, claimed, noted and handed on.
    agentTasks: {
      store: createAgentTasks({ collection: memoryCollection(), newId: () => "task" + (handedOff.length + 1) }),
      labelOf: async (principal) => (principal.kind === "agent" ? "Owner's agent" : "Owner"),
      onAssigned: (task) => handedOff.push(task.assignee),
    },
    // Team export and import: the archive, its addresses and who may use them have their own
    // tests (scripts/team-export.test.mjs). Here: the routes and the calls.
    teamTransfer: {
      startExport: async (userId) => (transfers.push(["export", userId]), { downloadUrl: "http://127.0.0.1/team-transfer/export/" + "t".repeat(43), method: "POST", expiresAt: "2026-11-22T00:15:00.000Z", team: { name: "Probe" }, members: 1, slates: 3 }),
      startImport: async (userId) => (transfers.push(["import", userId]), { uploadUrl: "http://127.0.0.1/team-transfer/import/" + "u".repeat(43), method: "POST", expiresAt: "2026-11-22T01:00:00.000Z" }),
      listImports: async () => [{ _id: "imp1", state: "pending", orgId: "team2", teamName: "Probe", createdAt: new Date(0), expiresAt: new Date(86400000) }],
      getImport: async (_userId, importId) => ({ _id: importId, state: "pending", orgId: "team2", teamName: "Probe", report: { team: { name: "Probe" }, sections: { slates: { created: 3, skipped: 0 } } } }),
      confirmImport: async (_userId, importId, options) => (transfers.push(["confirm", importId, options.invite]), { importId, state: "confirmed", teamId: "team2", invited: { sent: 0, needsConsent: [], mailDisabled: 0, unverified: ["dana@probe.test"] } }),
      inviteImported: async (_userId, importId, email) => (transfers.push(["invite", importId, email]), { importId, email, outcome: "sent" }),
      discardImport: async (_userId, importId) => (transfers.push(["discard", importId]), { importId, state: "discarded" }),
    },
    // Video notes (server/media): a looked-up video, as the host would answer it.
    media: async (url) => ({ found: true, media: { provider: "youtube", id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "A talk", author: "Probe" } }),
    // Who calls (the app's deps.loadUser): the shape library is per person and team.
    loadUser: async (id) => (id === "owner" ? { _id: "owner", orgId: null } : null),
    // Custom shapes: drawing (a model) and the library have their own tests
    // (scripts/ai-shapes.test.mjs). Here: the routes and the calls.
    shapes: {
      generate: async (who, input) => ({ requestId: "r1", cached: false, candidates: [{ candidateId: "c1", name: "Box", d: "M0 0H100V60H0Z", fillRule: "nonzero", aspect: 1.667, textBox: { x: 0.04, y: 0.07, w: 0.92, h: 0.86 }, describe: input.describe, who: who.userId }] }),
      library: { list: async () => ({ shapes: [{ id: "s1", name: "Box", aspect: 1.667, fillRule: "nonzero", visibility: "private", mine: true, d: "M0 0H100V60H0Z" }] }), used: async () => {} },
      resolve: async (_who, shape) => (shape === "c1"
        ? { custom: { name: "Box", d: "M0 0H100V60H0Z", fillRule: "nonzero", aspect: 1.667, ref: { id: "s1", name: "Box" } }, libraryId: "s1" }
        : { builtin: "ellipse" }),
    },
  }, idempotency });
  const gate = createGate({
    registry,
    manifest: buildClientManifest(registry),
    readSlate: (shareId) => slates.findOne({ shareId }),
    audienceOf: () => "private",
    isReplay: async (subject, key) => (await idempotency.get(subject, key))?.state === "done",
    store: createExecStore({ runs: memoryCollection(), confirmations: memoryCollection(), locks: memoryCollection() }),
  });
  const server = express();
  mountHttp(server, gatedRegistry(registry, gate), {
    express,
    authenticate: async (req) => (req.get("authorization") === "Bearer probe-token"
      ? { kind: "agent", tokenId: "token", userId: "owner", scopes: ["slates:read", "slates:write", "slates:share", "slates:delete", "ai:settings", "team:export", "team:import"] } : null),
  });
  const listener = server.listen(0, "127.0.0.1");
  await new Promise((resolve) => listener.once("listening", resolve));
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  const baseUrl = "http://127.0.0.1:" + listener.address().port;
  const mcp = createSlateboxMcpServer({ exec: createExec({ baseUrl, token: "probe-token" }) });
  const client = new Client({ name: "probe", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverSide);
  await client.connect(clientSide);
  t.after(async () => { await client.close(); await mcp.close(); });
  // As a host does: list first, so the SDK checks every exec result against outputSchema.
  await client.listTools();
  const called = new Set();
  /** Run a script through the MCP exec tool; returns the exec result. */
  const exec = async (code, extra = {}) => {
    const result = await client.callTool({ name: "exec", arguments: { intent: "Probe", code, ...extra } });
    for (const call of result.structuredContent?.calls ?? []) called.add(call.method);
    return result.structuredContent ?? { status: "refused", text: result.content[0].text };
  };
  /** A script that must complete; returns its result. */
  const ok = async (code, extra) => {
    const out = await exec(code, extra);
    assert.equal(out.status, "completed", JSON.stringify(out.error ?? out.confirmation ?? out));
    return out.result;
  };
  /** A script the gate holds: confirm it as a person would, and check it then saves once. */
  const confirmed = async (code, rules) => {
    const held = await exec(code);
    assert.equal(held.status, "confirmation_required", JSON.stringify(held.error ?? held));
    assert.deepEqual(held.confirmation.reasons.map((r) => r.rule).sort(), [...rules].sort());
    const out = await exec(code, { confirm: held.confirmation.id, idempotencyKey: held.idempotencyKey });
    assert.equal(out.status, "completed", JSON.stringify(out.error ?? out.confirmation ?? out));
    const reused = await exec(code, { confirm: held.confirmation.id, idempotencyKey: held.idempotencyKey });
    assert.notEqual(reused.status, "completed", "a confirmation works once");
    return out.result;
  };
  const stored = async (shareId) => slates.findOne({ shareId });
  const texts = async () => (await stored("canvas")).nodes.map((n) => n.options.text);
  return { client, exec, ok, confirmed, called, stored, texts, invites, transfers, deckRow, restyles, planned, comments, deletedSlates, handedOff };
}

// Every canvas edit names the revision it was made on (required since release/agentic): the
// script reads the slate first, as an agent does.
const edit = (operations, extra = "") =>
  `const { revision } = await slatebox.slates.get({ shareId: "canvas" });
return slatebox.slates.applyOperations({ shareId: "canvas", expectedRevision: revision, userMessage: "Probe", plan: { message: "Edit", operations: ${JSON.stringify(operations)} }${extra} })`;

test("canvas edits change exactly the notes they name, and only when saved", async (t) => {
  const { ok, exec, confirmed, stored, texts } = await instance(t);

  const preview = await ok(edit([{ kind: "update_nodes", target: { ids: ["a"] }, changes: { text: "A1" } }], ', mode: "preview"'));
  assert.equal(preview.mode, "preview");
  assert.deepEqual(preview.operations[0].target, { ids: ["a"] });
  assert.deepEqual(await texts(), ["Alpha", "Beta", "Gamma"]);
  const runPreview = await exec(edit([{ kind: "update_nodes", target: { ids: ["a"] }, changes: { text: "A1" } }]), { mode: "preview" });
  assert.equal(runPreview.result.mode, "preview", "a run in preview mode previews every write");
  assert.deepEqual(await texts(), ["Alpha", "Beta", "Gamma"]);

  await ok(edit([{ kind: "update_nodes", target: { ids: ["a"] }, changes: { text: "A1" } }]));
  assert.deepEqual(await texts(), ["A1", "Beta", "Gamma"]);
  await ok(edit([{ kind: "update_nodes", target: { text: "beta" }, changes: { text: "B1" } }]));
  assert.deepEqual(await texts(), ["A1", "B1", "Gamma"]);

  const partial = await exec(edit([{ kind: "update_nodes", target: { text: "a" }, changes: { text: "x" } }]));
  assert.equal(partial.status, "failed");
  // Restated (w1): a save that matches no note is refused with 409 no_match.
  assert.deepEqual([partial.error.code, partial.error.status], ["no_match", 409]);
  // The script's read of the slate (200), then the refused save.
  assert.deepEqual(partial.calls.map((c) => [c.status, c.code]), [[200, undefined], [409, "no_match"]]);
  assert.deepEqual(await texts(), ["A1", "B1", "Gamma"]);

  const before = (await stored("canvas")).nodes.map((n) => [n.options.xPos, n.options.yPos]);
  await ok(edit([{ kind: "arrange_nodes", target: { ids: ["a", "b"] }, layout: "column" }]));
  const after = (await stored("canvas")).nodes.map((n) => [n.options.xPos, n.options.yPos]);
  assert.notDeepEqual(after.slice(0, 2), before.slice(0, 2));
  // A column: one x for both notes, one below the other.
  assert.equal(after[0][0], after[1][0]);
  assert.ok(after[1][1] > after[0][1]);
  assert.deepEqual(after[2], before[2]);

  // Deleting is held for the person (new with exec), then saved once on confirm.
  await confirmed(edit([{ kind: "delete_nodes", target: { ids: ["c"] } }]), ["removes"]);
  assert.deepEqual(await texts(), ["A1", "B1"]);
  const none = await exec(edit([{ kind: "delete_nodes" }]));
  assert.equal(none.status, "failed");
  assert.equal(none.error.code, "invalid_operation_plan");
  assert.deepEqual(await texts(), ["A1", "B1"]);
});

test("every client method succeeds against the app, and refusals keep status, code and details", async (t) => {
  const { ok, exec, confirmed, called, stored, texts, invites, transfers, deckRow, restyles, planned, comments, deletedSlates, handedOff } = await instance(t);

  const created = await ok(`return slatebox.slates.create({ brief: "Request -> Review", kind: "diagram" })`);
  assert.equal(created.shareId, "created");
  assert.ok((await stored("created")).nodes.length >= 2);
  assert.equal((await ok(`return (await slatebox.slates.get({ shareId: "canvas" })).nodeCount`)), 3);
  // Wave 2 (P08): the instance and the account reach scripts with no exec change.
  assert.equal((await ok(`return (await slatebox.instance.describe({})).view`)), "account");
  assert.equal((await ok(`return (await slatebox.account.get({})).id`)), "owner");
  const invite = await confirmed(`return slatebox.slates.issueInvite({ shareId: "canvas", role: "read" })`, ["widens_access"]);
  await confirmed(`return slatebox.slates.revokeInvite({ shareId: "canvas", inviteId: ${JSON.stringify(invite.inviteId)} })`, ["removes"]);
  // Each call reached the core once, with a derived retry key; the confirming rerun saved once.
  assert.deepEqual(invites.map((i) => i.revoke), [false, true]);
  assert.ok(invites.every((i) => /^x[0-9a-f]{40}:\d+$/.test(i.key)), JSON.stringify(invites.map((i) => i.key)));

  await ok(edit([{ kind: "add_nodes", count: 1, shape: "circle", text: "Delta" }]));
  assert.deepEqual(await texts(), ["Alpha", "Beta", "Gamma", "Delta"]);
  await ok(edit([{ kind: "update_nodes", target: { ids: ["b"] }, changes: { backgroundColor: "#ff0000" } }]));
  assert.equal((await stored("canvas")).nodes[1].options.backgroundColor, "#ff0000");
  await ok(edit([{ kind: "connect_nodes", from: { ids: ["a"] }, to: { ids: ["c"] } }]));
  await ok(edit([{ kind: "update_connections", connectionIds: ["a->c"], changes: { label: "then" } }]));
  assert.equal((await stored("canvas")).nodes[0].relationships.associations.find((x) => x.id === "a->c").label, "then");
  await confirmed(edit([{ kind: "disconnect_nodes", from: { ids: ["a"] }, to: { ids: ["c"] } }]), ["removes"]);
  assert.deepEqual((await stored("canvas")).nodes[0].relationships.associations.map((x) => x.id), ["a->b"]);
  await ok(edit([{ kind: "arrange_nodes", target: { text: "Delta" }, layout: "row" }]));
  await confirmed(edit([{ kind: "delete_nodes", target: { text: "Delta" } }]), ["removes"]);
  await ok(edit([{ kind: "update_slate", changes: { name: "Renamed" } }]));
  assert.equal((await stored("canvas")).options.name, "Renamed");
  await ok(edit([{ kind: "update_nodes", target: { ids: ["a"] }, changes: { text: "Plan" } }]));
  assert.deepEqual(await texts(), ["Plan", "Beta", "Gamma"]);
  // slates.undo and slates.redo: the caller's own last edit, taken back and made again. Either may remove
  // notes (an undo of an add), so a script's call is held for the person, as a delete is.
  const undone = await confirmed(`return slatebox.slates.undo({ shareId: "canvas" })`, ["removes"]);
  assert.equal(typeof undone.undone, "string");
  assert.deepEqual(undone.left, []);
  assert.deepEqual(await texts(), ["Alpha", "Beta", "Gamma"]);
  await confirmed(`return slatebox.slates.redo({ shareId: "canvas" })`, ["removes"]);
  assert.deepEqual(await texts(), ["Plan", "Beta", "Gamma"]);

  // A full lane: the rule's sentence, its code and status, the legal lanes and the board.
  const move = (card, lane, revision, extra = "") => `return slatebox.slates.applyOperations({ shareId: "lanes", plan: { message: "Move", operations: [{ kind: "move_workshop_card", cardId: "${card}", laneId: "${lane}", expectedRevision: ${revision} }] }${extra} })`;
  const full = await exec(move("horn", "slot", 3, ', mode: "preview"'));
  assert.equal(full.status, "failed");
  assert.deepEqual([full.error.status, full.error.code, full.error.message], [409, "move_refused", "It already holds 1 of 1 card."]);
  assert.deepEqual(full.error.details.legalLaneIds, []);
  assert.equal(full.error.details.workshop.revision, 3);
  const caught = await ok(`try { await slatebox.slates.applyOperations({ shareId: "lanes", mode: "preview", plan: { message: "Move", operations: [{ kind: "move_workshop_card", cardId: "horn", laneId: "slot", expectedRevision: 3 }] } }) }
catch (error) { if (error.code !== "move_refused") throw error; return error.details.legalLaneIds }`);
  assert.deepEqual(caught, []);
  await ok(move("chorus", "done", 3));
  assert.equal((await stored("lanes")).creative.model.workshop.cards[1].laneId, "done");
  const raced = await exec(move("chorus", "ready", 3, ', mode: "preview"'));
  assert.deepEqual([raced.error.status, raced.error.code], [409, "slate_changed"]);
  assert.equal(raced.error.details.revision, 4);

  // The library, and check_move: the drag's verdict without moving anything.
  // The plain call an agent makes: the whole library fits in exec's 40,000-character result (ok fails on a truncated string).
  const library = await ok(`return slatebox.components.list({ shareId: "lanes" })`);
  assert.ok(library.components.some((entry) => entry.id === "retro" && entry.add === "Add a retro"));
  // Many boards on a slate (boards S4a): a slate that has a board takes another beside it.
  assert.deepEqual(library.components.find((entry) => entry.id === "retro").fits, { ok: true });
  const retro = await ok(`return slatebox.components.get({ id: "retro", shareId: "lanes" })`);
  assert.equal(retro.component.add, "Add a retro");
  assert.ok(retro.component.moves.length > 0 && retro.component.loop.steps.length > 0);
  // Chorus has left Friday, so Horn may go there; Archive is not one of Horn's lanes.
  assert.deepEqual(await ok(`return slatebox.slates.checkMove({ shareId: "lanes", card: "horn", lane: "slot" })`), { revision: 4, rev: 0, ok: true, warnings: [] });
  const verdict = await ok(`return slatebox.slates.checkMove({ shareId: "lanes", card: "Horn", lane: "Archive" })`);
  assert.deepEqual([verdict.refused.sentence, verdict.refused.ruleId, verdict.refused.nearest], ["This card can't go in Archive.", null, "Friday"]);
  assert.equal((await stored("lanes")).creative.revision, 4);

  // Scenes by label, resolved in the script (the tool once did this): Other, Next step, Start.
  const order = await ok(`const { workshop } = await slatebox.slates.get({ shareId: "map" });
const id = (label) => workshop.lanes.find((lane) => lane.label === label).id;
return slatebox.slates.applyOperations({ shareId: "map", mode: "preview", plan: { message: "Order", operations: [{ kind: "set_presentation_order", laneIds: ["Other", "Next step", "Start"].map(id), expectedRevision: workshop.revision }] } })`);
  assert.equal(order.mode, "preview");
  assert.equal(order.report.presentationOrder.length, 3);
  const branch = await ok(`const { workshop } = await slatebox.slates.get({ shareId: "map" });
const start = workshop.lanes.find((lane) => lane.label === "Start");
return slatebox.slates.applyOperations({ shareId: "map", plan: { message: "Branch", operations: [{ kind: "add_map_branch", fromStationId: start.id, label: "Help", outcome: "Ask for help.", expectedRevision: workshop.revision }] } })`);
  assert.equal(branch.mode, "save");
  await ok(`const { workshop } = await slatebox.slates.get({ shareId: "map" });
const help = workshop.lanes.find((lane) => lane.label === "Help");
return slatebox.slates.applyOperations({ shareId: "map", plan: { message: "Outcome", operations: [{ kind: "update_map_outcome", stationId: help.id, outcome: "Asked.", expectedRevision: workshop.revision }] } })`);
  assert.equal((await stored("map")).creative.model.workshop.lanes.at(-1).station.outcome, "Asked.");

  // any-ai: a script reads the AI setup, wires a model on the host (held for confirmation: it changes
  // where AI requests go) and tests it, through the same service the settings page uses.
  assert.equal((await ok(`return (await slatebox.ai.get({})).effective.chat.ref`)), "builtin");
  const wired = await confirmed(`return slatebox.ai.update({ level: "me", connections: [{ name: "desk", type: "openai-compatible", baseUrl: "http://host.docker.internal:11434/v1", model: "desk-model" }], use: { default: "me:desk" } })`, ["widens_access"]);
  assert.equal(wired.effective.generation.ref, "me:desk");
  assert.equal((await ok(`return (await slatebox.ai.check({ level: "me", name: "desk" })).tools`)), "yes");
  const metadata = `return slatebox.ai.update({ level: "me", connections: [{ name: "meta", type: "openai-compatible", baseUrl: "http://169.254.169.254/v1", model: "m" }] })`;
  const heldMetadata = await exec(metadata);
  assert.equal(heldMetadata.status, "confirmation_required");
  // confirmed by a person, the server still refuses a cloud metadata address
  const refused = await exec(metadata, { confirm: heldMetadata.confirmation.id, idempotencyKey: heldMetadata.idempotencyKey });
  assert.equal(refused.status, "failed");
  assert.deepEqual([refused.error.status, refused.error.code], [400, "invalid_request"]);

  // Mermaid (new): any slate out as Mermaid text, and Mermaid in as real notes and lines.
  const exported = await ok(`return slatebox.slates.exportMermaid({ shareId: "canvas" })`);
  assert.match(exported.mermaid, /^---\ntitle: "Renamed"\n---\nflowchart LR\n/);
  assert.match(exported.mermaid, /a\["Plan"\]/);
  const imported = await ok(`return slatebox.slates.importMermaid({ shareId: "canvas", mermaid: "flowchart LR\\n  m1[\\"In\\"] --> m2[\\"Out\\"]" })`);
  assert.deepEqual([imported.mode, imported.notes, imported.lines], ["save", 2, 1]);
  assert.deepEqual(await texts(), ["Plan", "Beta", "Gamma", "In", "Out"]);

  // The run's plan beside its pointer: four steps, the first under way; a tick starts the next.
  const plan = await ok(`await slatebox.presence.plan({ shareId: "canvas", steps: ["Read the notes", "Draft a brief", "Map the flow", "Shorten it"] })
return slatebox.presence.step({ shareId: "canvas", index: 0, status: "done" })`);
  assert.deepEqual(plan.plan.steps.map((step) => step.status), ["done", "doing", "todo", "todo"]);
  const noPlan = await exec(`return slatebox.presence.step({ shareId: "canvas", index: 0, status: "done" })`);
  assert.deepEqual([noPlan.error.status, noPlan.error.code], [409, "no_plan"]);

  // Team export and import (new): exporting everything sends the team's content out, so it waits
  // for the person; confirming an import makes a team live and discarding one deletes it.
  const exportAddress = await confirmed(`return slatebox.team.export({})`, ["widens_access"]);
  assert.match(exportAddress.downloadUrl, /\/team-transfer\/export\//);
  assert.match((await ok(`return slatebox.teamImports.start({})`)).uploadUrl, /\/team-transfer\/import\//);
  assert.deepEqual((await ok(`return slatebox.teamImports.list({})`)).imports.map((row) => [row.importId, row.state]), [["imp1", "pending"]]);
  assert.equal((await ok(`return slatebox.teamImports.get({ importId: "imp1" })`)).report.team.name, "Probe");
  assert.equal((await confirmed(`return slatebox.teamImports.confirm({ importId: "imp1", invite: true })`, ["widens_access"])).state, "confirmed");
  assert.equal((await confirmed(`return slatebox.teamImports.invite({ importId: "imp1", email: "dana@probe.test" })`, ["widens_access"])).outcome, "sent");
  assert.equal((await confirmed(`return slatebox.teamImports.discard({ importId: "imp1" })`, ["removes"])).state, "discarded");
  assert.deepEqual(transfers, [["export", "owner"], ["import", "owner"], ["confirm", "imp1", true], ["invite", "imp1", "dana@probe.test"], ["discard", "imp1"]]);

  // Custom shapes: draw candidates, list the library, put one on a note (saved at once: it removes nothing).
  const drawn = await ok(`return slatebox.shapes.generate({ describe: "a box" })`);
  assert.deepEqual([drawn.candidates[0].candidateId, drawn.candidates[0].who], ["c1", "owner"]);
  assert.equal((await ok(`return slatebox.shapes.list({})`)).shapes[0].name, "Box");
  const shaped = await ok(`return slatebox.shapes.apply({ shareId: "canvas", ids: ["b"], shape: "c1" })`);
  assert.deepEqual([shaped.mode, shaped.shape.name], ["save", "Box"]);
  const boxed = (await stored("canvas")).nodes.find((n) => n.options.id === "b").options;
  assert.deepEqual([boxed.shape, boxed.shapeRef], ["custom", { id: "s1", name: "Box" }]);
  // Presentations: create one with Present's planner (a preview saves nothing and has no link).
  const made = await ok(`return slatebox.presentations.create({ shareId: "canvas", style: "calm", brief: "the risks" })`);
  assert.deepEqual([made.presentationId, made.version, made.link, made.automatic, made.mode], ["deck2", 2, "http://127.0.0.1/canvas/canvas?present=1", false, "save"]);
  assert.equal(made.steps[0].layout, "title");
  const tried = await ok(`return slatebox.presentations.create({ shareId: "canvas", mode: "preview" })`);
  assert.deepEqual([tried.presentationId, tried.link, tried.mode], [null, null, "preview"]);
  assert.deepEqual(planned.map(({ userId, shareId, style, brief, preview }) => [userId, shareId, style, brief, preview]),
    [["owner", "canvas", "calm", "the risks", false], ["owner", "canvas", null, "", true]]);
  // Read a slate's deck, and restyle it in one call (the same steps, no AI).
  const deck = await ok(`return slatebox.presentations.get({ shareId: "canvas" })`);
  assert.equal(deck.style, deckRow.style.id);
  assert.equal(deck.steps[0].layout, "title");
  const restyled = await ok(`return slatebox.presentations.setStyle({ shareId: "canvas", style: "neon" })`);
  assert.equal(restyled.style, "neon");
  // The same steps (each the same notes, in the same order) in the new style's own beats: a style
  // may show a step as another layout (2244bafe: "beats that differ by style").
  assert.deepEqual(restyled.steps.map((step) => [step.step, step.notes]), deck.steps.map((step) => [step.step, step.notes]));
  assert.deepEqual([restyled.steps[0].layout, restyled.steps.at(-1).layout], [deck.steps[0].layout, deck.steps.at(-1).layout]);
  assert.deepEqual(restyles, [["deck1", { id: "neon" }]]);
  // Parity: list, copy and delete slates; read, add, resolve and remove comments. A removal is held.
  const listed = await ok(`return slatebox.slates.list({})`);
  assert.ok(listed.slates.some((slate) => slate.shareId === "canvas" && slate.owner === "you"));
  const copy = await ok(`return slatebox.slates.copy({ shareId: "canvas", name: "Probe copy" })`);
  assert.equal(copy.shareId, "copied");
  assert.equal((await stored("copied")).options.name, "Probe copy");
  await confirmed(`return slatebox.slates.delete({ shareId: "copied" })`, ["removes"]);
  assert.deepEqual(deletedSlates, ["copied"]);
  const comment = await ok(`return slatebox.comments.add({ shareId: "canvas", noteId: "a", text: "Is this right?" })`);
  assert.deepEqual([comment.author, comment.text, comment.resolved], ["Owner", "Is this right?", false]);
  assert.equal((await ok(`return slatebox.comments.list({ shareId: "canvas" })`)).comments.length, 1);
  assert.equal((await ok(`return slatebox.comments.resolve({ shareId: "canvas", noteId: "a" })`)).comments, 1);
  await confirmed(`return slatebox.comments.remove({ shareId: "canvas", commentId: ${JSON.stringify(comment.commentId)} })`, ["removes"]);
  assert.equal(comments.length, 0);

  // Agent tasks (agent teammates): ask for any agent, find it, claim it, note it, hand it to the
  // Slatebox agent; a second claim of a held task is refused with the gate's code.
  const asked = await ok(`return slatebox.agentTasks.create({ shareId: "canvas", text: "Group the notes", assignee: "any" })`);
  assert.deepEqual([asked.task.status, asked.task.askedBy], ["submitted", "Owner's agent"]);
  const open = await ok(`return slatebox.agentTasks.list({ shareId: "canvas" })`);
  assert.deepEqual(open.tasks.map((task) => task.text), ["Group the notes"]);
  const worked = await ok(`await slatebox.agentTasks.update({ shareId: "canvas", taskId: ${JSON.stringify(asked.task.id)}, action: "claim" })
await slatebox.agentTasks.update({ shareId: "canvas", taskId: ${JSON.stringify(asked.task.id)}, action: "note", text: "Two themes" })
return slatebox.agentTasks.update({ shareId: "canvas", taskId: ${JSON.stringify(asked.task.id)}, action: "handoff", to: "slatebox" })`);
  assert.deepEqual([worked.task.status, worked.task.assignee, worked.task.log.map((e) => e.kind)], ["submitted", "slatebox", ["asked", "claimed", "note", "handoff"]]);
  assert.deepEqual(handedOff, ["slatebox"]);
  const notYours = await exec(`return slatebox.agentTasks.update({ shareId: "canvas", taskId: ${JSON.stringify(asked.task.id)}, action: "claim" })`);
  assert.deepEqual([notYours.error.status, notYours.error.code], [409, "task_assigned"]);

  // Agent suggestions need the app's suggestion store, which this app runs without (its agents save,
  // as a self-hosted app before suggestions did): the call is refused in the API's words.
  const decided = await exec(`return slatebox.suggestions.decide({ shareId: "canvas", decision: "discard", actionId: "a1" })`);
  assert.deepEqual([decided.error.status, decided.error.code], [501, "not_available"]);

  // Video notes: the lookup (its host calls and poster storage have their own tests,
  // scripts/media-notes.test.mjs) and the add, saved like any other edit.
  const video = await ok(`return slatebox.media.lookup({ url: "https://youtu.be/dQw4w9WgXcQ" })`);
  assert.deepEqual([video.found, video.media.provider, video.media.title], [true, "youtube", "A talk"]);
  const added = await ok(`return slatebox.slates.addMedia({ shareId: "canvas", url: "https://youtu.be/dQw4w9WgXcQ", x: 900, y: 40 })`);
  assert.equal(added.media.id, "dQw4w9WgXcQ");
  assert.ok(added.nodeId);

  assert.deepEqual([...called].sort(), [...defaultGenerated().methods.keys()].sort(), "every client method was called");
});

test("a rerun with the same key replays its saved calls instead of saving twice", async (t) => {
  const { exec, texts } = await instance(t);
  const code = edit([{ kind: "add_nodes", count: 1, shape: "rectangle", text: "Once" }]);
  const first = await exec(code, { idempotencyKey: "probe-once" });
  assert.equal(first.status, "completed", JSON.stringify(first));
  const again = await exec(code, { idempotencyKey: "probe-once" });
  assert.equal(again.status, "completed");
  // calls[0] is the script's read of the slate; the save is calls[1].
  assert.equal(again.calls[1].replayed, true);
  assert.deepEqual(again.result, first.result);
  assert.deepEqual(await texts(), ["Alpha", "Beta", "Gamma", "Once"]);
  const diverged = await exec(edit([{ kind: "add_nodes", count: 1, shape: "rectangle", text: "Other" }]), { idempotencyKey: "probe-once" });
  assert.equal(diverged.error.code, "idempotency_conflict");
  assert.deepEqual(await texts(), ["Alpha", "Beta", "Gamma", "Once"]);
});

test("describe's three recipes run against the app", async (t) => {
  const { ok } = await instance(t);
  const { recipes } = defaultGenerated().manifest;
  assert.equal(recipes.length, 3);
  for (const [i, recipe] of recipes.entries()) {
    const shareId = i === 2 ? "lanes" : "canvas";
    const code = recipe.code.replace(/const shareId = "[^"]*";/, `const shareId = "${shareId}";`);
    await ok(code);
  }
});

test("the CLI runs a script locally and, with --remote, in the app's sealed runner, under the same rules", async (t) => {
  const { makeExecWorld } = await import(new URL("../../scripts/exec-test-world.mjs", app));
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const world = makeExecWorld();
  t.after(() => world.close());
  const call = await world.serve(t);
  const { token } = await world.mint();
  const bin = fileURLToPath(new URL("../src/slatebox.js", import.meta.url));
  const cli = (args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { env: { PATH: process.env.PATH, SLATEBOX_API_TOKEN: token, SLATEBOX_BASE_URL: call.base } });
    let out = "", err = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.end();
  });
  const count = `return (await slatebox.slates.get({ shareId: "demo" })).nodeCount`;
  const local = await cli(["exec", "-e", count, "--json"]);
  const remote = await cli(["exec", "-e", count, "--json", "--remote"]);
  assert.equal(local.code, 0, local.err);
  assert.equal(remote.code, 0, remote.err);
  assert.equal(JSON.parse(local.out).result, JSON.parse(remote.out).result);
  assert.equal(JSON.parse(remote.out).status, "completed");
  // A delete is held on both paths, and neither saves.
  const before = world.slate("demo").nodes.length;
  const del = `const { revision, nodes } = await slatebox.slates.get({ shareId: "demo" });
return slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: revision, plan: { message: "Remove", operations: [{ kind: "delete_nodes", target: { ids: [nodes[0].id] } }] } })`;
  for (const extra of [[], ["--remote"]]) {
    const held = await cli(["exec", "-e", del, "--json", ...extra]);
    assert.equal(held.code, 6, held.err);
    assert.equal(JSON.parse(held.out).status, "confirmation_required");
    assert.match(held.err, /To save, run:\n {2}slatebox exec -e [\s\S]* --confirm cf_[A-Za-z0-9]{24} --idempotency-key \S+\n/);
  }
  assert.equal(world.slate("demo").nodes.length, before);
});
