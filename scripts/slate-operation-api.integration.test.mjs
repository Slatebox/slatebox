import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import express from "express";
import { createRequire } from "node:module";
import { createAppRegistry } from "../web/app/server/actions/index.mjs";
import { mountHttp } from "../web/app/server/actions/http.mjs";
import { createIdempotencyStore } from "../web/app/server/actions/idempotency.mjs";
import { createRateLimiter } from "../web/app/server/actions/rate-limit.mjs";
import { memoryDriverCollection } from "./action-test-stores.mjs";
import { createSlateSaveCore } from "../web/app/server/slate-save-core.mjs";
import { createSlateReader } from "../web/app/server/slate-read.mjs";

// slateboxjs is the app's dependency (web/app), not the repository root's.
const { applyPlanToJSON } = createRequire(
  new URL("../web/app/package.json", import.meta.url),
)("slateboxjs/operations");

// Restated (P02): the routes are mounted from the action registry instead of hand-built
// handlers. The assertions are the same except where noted: dryRun became mode "preview"
// and the in-process rate limiter became the database-kept one.

function node(id, text, xPos, yPos) {
  return {
    options: {
      id,
      text,
      xPos,
      yPos,
      width: 180,
      height: 100,
      vectorPath: "rectangle",
      backgroundColor: "#7aa2c8",
    },
    relationships: { associations: [] },
  };
}

let slate;
let runs;
let updateResult;
let beforeSave;
let server;
let baseUrl;
let idempotencyRows = memoryDriverCollection();

const read = (doc, path) => path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), doc);
const holds = (selector) =>
  Object.entries(selector).every(([path, want]) =>
    want === null ? read(slate, path) == null : JSON.stringify(read(slate, path)) === JSON.stringify(want));
function put(path, value) {
  const keys = path.split(".");
  const parent = keys.slice(0, -1).reduce((record, key) => (record[key] ||= {}), slate);
  parent[keys.at(-1)] = value;
}
const slateStore = {
  async findOne(selector) {
    return holds(selector) ? structuredClone(slate) : null;
  },
  async updateOne(selector, update) {
    beforeSave?.();
    if (!updateResult || !holds(selector)) return { matchedCount: 0 };
    for (const [path, value] of Object.entries(update.$set || {})) put(path, value);
    for (const [path, value] of Object.entries(update.$inc || {})) put(path, (read(slate, path) || 0) + value);
    for (const [path, value] of Object.entries(update.$push || {})) put(path, [...(read(slate, path) || []), ...value.$each]);
    return { matchedCount: 1 };
  },
};

before(() => {
  const app = express();
  const registry = createAppRegistry({
    deps: {
      // Restated (P07): the service also says what the caller may do there, and a caller with
      // no account (a visitor) reads public slates only.
      authorizeTokenForSlate: async (token, shareId) => {
        if (shareId === "missing") return { slate: null, authorized: false };
        if (token.userId === "forbidden" || (!token.userId && !slate.options.isPublic)) {
          return { slate, authorized: false };
        }
        const isOwner = token.userId === slate.userId;
        return { slate, authorized: true, access: { role: "EDIT", canEdit: true, isOwner, linkRole: null, grantKey: null } };
      },
      readSlate: createSlateReader({
        listComments: async () => [],
        findPresentation: async () => null,
        appOrigin: () => "https://app.example",
        embedOrigin: () => "https://api.example",
      }),
      applySlateOperationPlanToJSON: applyPlanToJSON,
      // Restated (P05a): the action saves through the save core, which reads the stored slate
      // and writes it with one conditional update. This stand-in is that one slate.
      saveCore: createSlateSaveCore({ slates: slateStore, events: memoryDriverCollection(), now: () => 2000 }),
      operationRuns: {
        async findOneAsync(selector) {
          return runs.find(
            (run) =>
              run.tokenId === selector.tokenId &&
              run.idempotencyKey === selector.idempotencyKey,
          );
        },
        async insertAsync(run) {
          runs.push({ _id: `run-${runs.length + 1}`, ...run });
        },
      },
    },
    idempotency: createIdempotencyStore({ collection: idempotencyRows }),
    now: () => 2000,
  });
  mountHttp(app, registry, {
    express,
    authenticate: async (req) => {
      const raw = req.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!raw || raw === "invalid") return null;
      const scopes = raw === "reader" ? ["slates:read"] : ["slates:read", "slates:write"];
      return { kind: "agent", tokenId: `token-${raw}`, userId: raw, scopes };
    },
  });
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  slate = {
    _id: "slate-1",
    shareId: "demo",
    userId: "owner",
    lastSaved: 1000,
    options: { name: "Demo", description: "", containerStyle: {} },
    nodes: [node("welcome", "Welcome!", 100, 100)],
  };
  runs = [];
  idempotencyRows.docs.clear();
  updateResult = 1;
  beforeSave = null;
});

async function request(path, { token, ...options } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  return { response, body: await response.json() };
}

const addPlan = {
  message: "Done — I added a triangle.",
  operations: [
    {
      kind: "add_nodes",
      shape: "triangle",
      text: "Decision",
      count: 1,
      placement: { relativeTo: "welcome", direction: "right" },
    },
  ],
};

test("HTTP slate reads require scoped authentication and never cache data", async () => {
  const unauthorized = await request("/api/v1/slates/demo");
  assert.equal(unauthorized.response.status, 401);
  assert.equal(unauthorized.body.error.code, "unauthorized");
  assert.equal(unauthorized.response.headers.get("cache-control"), "no-store");

  const allowed = await request("/api/v1/slates/demo?include=full", {
    token: "reader",
  });
  assert.equal(allowed.response.status, 200);
  // Restated (P07): the read is the slate read, not {summary, slate}; include=full adds the
  // engine's document instead of the stored row.
  assert.equal(allowed.body.nodeCount, 1);
  assert.equal(allowed.body.document.shareId, "demo");
  assert.equal(allowed.response.headers.get("cache-control"), "no-store");
});

test("HTTP authorization distinguishes forbidden and missing slates", async () => {
  const forbidden = await request("/api/v1/slates/demo", {
    token: "forbidden",
  });
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.body.error.code, "forbidden");

  const missing = await request("/api/v1/slates/missing", { token: "owner" });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, "not_found");
});

// Restated (P02): dryRun became the registry's mode "preview".
test("previews materialize a safe plan without writing or auditing", async () => {
  const result = await request("/api/v1/slates/demo/operations", {
    token: "owner",
    method: "POST",
    body: JSON.stringify({
      plan: addPlan,
      expectedRevision: slate.revision ?? 0,
      userMessage: "Add one triangle to the right of Welcome",
      mode: "preview",
    }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.mode, "preview");
  assert.match(result.body.operations[0].ids[0], /^[a-z0-9-]{8,}$/i);
  assert.notEqual(result.body.operations[0].ids[0], "welcome");
  assert.equal(slate.nodes.length, 1);
  assert.equal(runs.length, 0);
});

test("writes persist, audit materialized operations, and replay idempotently", async () => {
  const options = {
    token: "owner",
    method: "POST",
    headers: { "idempotency-key": "same-request" },
    body: JSON.stringify({
      plan: addPlan,
      expectedRevision: slate.revision ?? 0,
      userMessage: "Add one triangle to the right of Welcome",
    }),
  };
  const created = await request("/api/v1/slates/demo/operations", options);
  assert.equal(created.response.status, 201);
  assert.equal(created.body.ok, true);
  assert.equal(slate.nodes.length, 2);
  assert.equal(runs.length, 1);
  assert.equal(
    runs[0].plan.operations[0].ids[0],
    created.body.operations[0].ids[0],
  );

  const replayed = await request("/api/v1/slates/demo/operations", options);
  assert.equal(replayed.response.status, 200);
  assert.deepEqual(replayed.body, created.body);
  assert.equal(replayed.response.headers.get("cache-control"), "no-store");
  assert.equal(slate.nodes.length, 2);
  assert.equal(runs.length, 1);
});

test("optimistic concurrency returns 409 without an audit record", async () => {
  updateResult = 0;
  const result = await request("/api/v1/slates/demo/operations", {
    token: "owner",
    method: "POST",
    body: JSON.stringify({
      plan: addPlan,
      expectedRevision: slate.revision ?? 0,
      userMessage: "Add one triangle to the right of Welcome",
    }),
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error.code, "slate_changed");
  assert.equal(runs.length, 0);
});

test("invalid operation plans return a structured 400 and never write", async () => {
  const result = await request("/api/v1/slates/demo/operations", {
    token: "owner",
    method: "POST",
    body: JSON.stringify({
      plan: { message: "Done.", operations: [{ kind: "invented" }] },
      expectedRevision: slate.revision ?? 0,
      userMessage: "Do something",
    }),
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, "invalid_operation_plan");
  assert.equal(slate.nodes.length, 1);
  assert.equal(runs.length, 0);
});

// Restated (P02): the limiter is kept in the database and also counts per account.
test("rate limiting is isolated per token and resets by minute", async () => {
  let time = 0;
  const limiter = createRateLimiter({
    collection: memoryDriverCollection(),
    now: () => time,
    limits: { perToken: 2, perAccount: 10, windowSeconds: 60 },
  });
  const permit = async (tokenId) => (await limiter.take({ tokenId, userId: "owner-" + tokenId })).allowed;
  assert.equal(await permit("a"), true);
  assert.equal(await permit("a"), true);
  assert.equal(await permit("a"), false);
  assert.equal(await permit("b"), true);
  time = 60000;
  assert.equal(await permit("a"), true);
});


test("an ordinary edit racing a grant change has no write or receipt", async () => {
  beforeSave = () => { slate.sharingRevision = 1; };
  const result = await request("/api/v1/slates/demo/operations", {
    token: "member", method: "POST",
    body: JSON.stringify({ plan: addPlan, expectedRevision: slate.revision ?? 0, userMessage: "Add a node" }),
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error.code, "slate_changed");
  assert.equal(slate.nodes.length, 1);
  assert.equal(runs.length, 0);
});

// The engine's operations module behind the route (P03).
// Integration (w1): the registry takes mode "preview" where P03 sent dryRun.
async function save(plan, { preview = false, userMessage = "Edit the slate" } = {}) {
  return request("/api/v1/slates/demo/operations", {
    token: "owner",
    method: "POST",
    body: JSON.stringify({ plan, userMessage, expectedRevision: slate.revision ?? 0, ...(preview ? { mode: "preview" } : {}) }),
  });
}

const edit = (...operations) => ({ message: "Done.", operations });
const stored = (id) => slate.nodes.find((n) => n.options.id === id).options;

test("a note added with id x1 can be connected in the same plan, and add_nodes at x,y lands there", async () => {
  const result = await save(
    edit(
      { kind: "add_nodes", count: 1, shape: "rectangle", text: "New", ids: ["x1"], x: 640, y: 320 },
      { kind: "connect_nodes", from: { ids: ["welcome"] }, to: { ids: ["x1"] } },
    ),
  );
  assert.equal(result.response.status, 201);
  assert.deepEqual(result.body.report.connected, ["welcome->x1"]);
  assert.deepEqual([stored("x1").xPos, stored("x1").yPos], [640, 320]);
  assert.deepEqual(slate.nodes[0].relationships.associations.map((a) => a.childId), ["x1"]);
});

test("an empty match answers 409 no_match on save and writes nothing; a preview warns", async () => {
  const plan = edit({ kind: "update_nodes", target: { text: "Nobody" }, changes: { text: "x" } });
  const saved = await save(plan);
  assert.equal(saved.response.status, 409);
  assert.equal(saved.body.error.code, "no_match");
  assert.equal(saved.body.error.message, "Operation 1 matched no notes.");
  assert.equal(runs.length, 0);
  const preview = await save(plan, { preview: true });
  assert.equal(preview.response.status, 200);
  assert.deepEqual(preview.body.report.warnings, ["Operation 1 matched no notes."]);
  assert.deepEqual(preview.body.report.operations[0].matched, []);
});

test("an update to a locked note is skipped and reported, and rotation is stored where the engine loads it", async () => {
  slate.nodes[0].options.isLocked = true;
  const locked = await save(edit({ kind: "update_nodes", target: { ids: ["welcome"] }, changes: { text: "Changed" } }));
  assert.equal(locked.response.status, 201);
  assert.deepEqual(locked.body.report.skipped, [{ operation: 1, id: "welcome", reason: "locked" }]);
  assert.equal(stored("welcome").text, "Welcome!");
  const rotated = await save(edit({ kind: "update_nodes", target: { ids: ["welcome"] }, changes: { locked: false, rotationAngle: 45 } }));
  assert.equal(rotated.response.status, 201);
  assert.deepEqual(stored("welcome").rotate, { rotationAngle: 45 });
  assert.equal("rotationAngle" in stored("welcome"), false);
});

test("connecting twice leaves one connector on a slate made from a brief, and disconnect b to a removes a to b", async () => {
  slate.nodes.push(node("step-2", "Review", 400, 100));
  slate.nodes[0].relationships.associations.push({ id: "welcome-step-2", parentId: "welcome", childId: "step-2" });
  const twice = await save(edit({ kind: "connect_nodes", from: { ids: ["welcome"] }, to: { ids: ["step-2"] } }));
  assert.equal(twice.response.status, 201);
  assert.equal(twice.body.report.unchanged, true);
  assert.equal(slate.nodes[0].relationships.associations.length, 1);
  const reversed = await save(edit({ kind: "disconnect_nodes", from: { ids: ["step-2"] }, to: { ids: ["welcome"] } }));
  assert.equal(reversed.response.status, 201);
  assert.deepEqual(reversed.body.report.disconnected, ["welcome-step-2"]);
  assert.deepEqual(slate.nodes[0].relationships.associations, []);
});

test("a text selector that matches several notes is refused with the candidates named", async () => {
  slate.nodes.push(node("w2", "Welcome!", 400, 100));
  const result = await save(edit({ kind: "delete_nodes", target: { text: "Welcome!" } }));
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, "ambiguous_selector");
  assert.match(result.body.error.message, /matches 2 notes \(welcome, w2\)/);
  // review-P03 F5: the details the engine describes reach the caller.
  assert.deepEqual(result.body.error.details.candidates.map((c) => c.id), ["welcome", "w2"]);
  assert.equal(slate.nodes.length, 2);
});

test("an id already in use is refused with 409 id_taken and nothing is written (review-P03 F2)", async () => {
  const before = JSON.stringify(slate.nodes);
  const result = await save(
    edit(
      { kind: "add_nodes", count: 1, shape: "rectangle", text: "Clash", ids: ["welcome"] },
      { kind: "update_nodes", target: { ids: ["welcome"] }, changes: { text: "wrong note" } },
    ),
  );
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error.code, "id_taken");
  assert.deepEqual(result.body.error.details, { ids: ["welcome"] });
  assert.equal(JSON.stringify(slate.nodes), before);
  assert.equal(runs.length, 0);
});

test("a connect fan-out past the per-operation cap is refused at once with 422 (review-P03 F1)", async () => {
  const adds = Array.from({ length: 8 }, (_, i) => ({ kind: "add_nodes", count: 20, shape: "rectangle", x: 0, y: i * 200 }));
  const started = Date.now();
  const result = await save(edit(...adds, { kind: "connect_nodes", from: { all: true }, to: { all: true } }));
  assert.equal(result.response.status, 422);
  assert.equal(result.body.error.code, "connector_limit");
  assert.equal(result.body.error.details.limit, 400);
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  assert.equal(slate.nodes.length, 1);
});

// P10: the canvas vocabulary for the common jobs, through the route an agent uses.
const { NODE_KEYS } = createRequire(new URL("../web/app/package.json", import.meta.url))("slateboxjs/operations");

test("one plan adds a note connected below another, copying its fill, border and font (P10 add-connected-note)", async () => {
  Object.assign(stored("welcome"), { backgroundColor: "#ff8800", borderColor: "#112233", borderWidth: 4, fontFamily: "Georgia", fontSize: 28 });
  const result = await save(edit({ kind: "add_nodes", count: 1, text: "Next", ids: ["k1"], placement: { relativeTo: "welcome", direction: "below", connect: true } }));
  assert.equal(result.response.status, 201);
  assert.deepEqual(result.body.report.connected, ["welcome->k1"]);
  const added = stored("k1");
  assert.deepEqual(
    [added.backgroundColor, added.borderColor, added.borderWidth, added.fontFamily, added.fontSize, added.xPos, added.yPos],
    ["#ff8800", "#112233", 4, "Georgia", 28, 100, 100 + 100 + 75],
  );
  assert.deepEqual(stored("welcome").options?.relationships, undefined);
  assert.deepEqual(slate.nodes[0].relationships.associations.map((a) => [a.id, a.childId]), [["welcome->k1", "k1"]]);
});

test("a link round-trips, and a link that is not http or https is refused (P10 set-note-link)", async () => {
  const saved = await save(edit({ kind: "update_nodes", target: { ids: ["welcome"] }, changes: { link: "https://slatebox.com/docs" } }));
  assert.equal(saved.response.status, 201);
  assert.equal(NODE_KEYS.link.read(stored("welcome")), "https://slatebox.com/docs");
  assert.deepEqual(stored("welcome").link, { show: true, type: "url", data: "https://slatebox.com/docs" });
  const refused = await save(edit({ kind: "update_nodes", target: { ids: ["welcome"] }, changes: { link: "javascript:alert(1)" } }));
  assert.equal(refused.response.status, 400);
  assert.match(refused.body.error.message, /link must be an http or https address/);
  assert.equal(NODE_KEYS.link.read(stored("welcome")), "https://slatebox.com/docs");
});

test("layout tree on a 12-note graph leaves no overlaps in the stored geometry (P10 optimize-layout)", async () => {
  slate.nodes = Array.from({ length: 12 }, (_, i) => node(`n${i}`, `N${i}`, 10 * i, 7 * i));
  const join = (from, to) => slate.nodes[from].relationships.associations.push({ id: `n${from}->n${to}`, parentId: `n${from}`, childId: `n${to}` });
  [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [2, 6], [3, 7], [3, 8], [3, 9], [5, 10], [6, 11]].forEach(([f, t]) => join(f, t));
  const result = await save(edit({ kind: "arrange_nodes", target: { all: true }, layout: "tree" }));
  assert.equal(result.response.status, 201);
  const boxes = slate.nodes.map((n) => ({ x: n.options.xPos, y: n.options.yPos, w: n.options.width, h: n.options.height }));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const [a, b] = [boxes[i], boxes[j]];
      const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      assert.equal(overlap, false, `n${i} overlaps n${j}`);
    }
  }
  assert.ok(boxes[4].y > boxes[1].y && boxes[1].y > boxes[0].y);
});

test("order front is the note's place in the saved list, so it survives a reload (P10 reorder-note)", async () => {
  slate.nodes.push(node("second", "Second", 300, 100), node("third", "Third", 500, 100));
  const result = await save(edit({ kind: "update_nodes", target: { ids: ["welcome"] }, changes: { order: "front" } }));
  assert.equal(result.response.status, 201);
  assert.deepEqual(slate.nodes.map((n) => n.options.id), ["second", "third", "welcome"]);
});

test("slate settings and the line colour are saved where the canvas reads them (P10)", async () => {
  slate.nodes[0].relationships.associations.push({ id: "welcome->welcome2", parentId: "welcome", childId: "welcome2", lineColor: "#333333" });
  slate.nodes.push(node("welcome2", "Two", 400, 100));
  const result = await save(
    edit({ kind: "update_slate", changes: { mindMapMode: true, autoResizeNodesBasedOnText: false, showGrid: true, snapToObjects: true, defaultLineColor: "#ff0055" } }),
  );
  assert.equal(result.response.status, 201);
  assert.equal(slate.options.mindMapMode, true);
  assert.equal(slate.options.autoResizeNodesBasedOnText, false);
  assert.deepEqual(slate.options.viewPort, { showGrid: true, snapToObjects: true });
  assert.equal(slate.options.defaultLineColor, "#ff0055");
  assert.equal(slate.nodes[0].relationships.associations[0].lineColor, "#ff0055");
});

test("a preview that keeps duplicating the whole slate is refused at once with 422, before the copies are made (review-P10 P10-1)", async () => {
  const started = Date.now();
  const rssBefore = process.memoryUsage().rss;
  const doubling = Array.from({ length: 30 }, () => ({ kind: "duplicate_nodes", target: { all: true } }));
  const result = await save(edit(...doubling), { preview: true });
  assert.equal(result.response.status, 422);
  assert.equal(result.body.error.code, "note_limit");
  assert.deepEqual(result.body.error.details, { limit: 1000, operation: 10 });
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  assert.ok(process.memoryUsage().rss - rssBefore < 200e6, `grew ${Math.round((process.memoryUsage().rss - rssBefore) / 1e6)} MB`);
  assert.equal(slate.nodes.length, 1);
});
