// slates.undo and slates.redo: a caller takes back, and makes again, their own canvas edits through the
// action contract, never another caller's and never what someone else changed since (left[]).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createAppRegistry } from "../web/app/server/actions/index.mjs";
import { createIdempotencyStore } from "../web/app/server/actions/idempotency.mjs";
import { createSlateReader } from "../web/app/server/slate-read.mjs";
import { createSlateSaveCore } from "../web/app/server/slate-save-core.mjs";
import { memoryMongo } from "./memory-mongo.mjs";
import { applyToCanvas } from "../web/app/server/actions/slate-operations.mjs";
import { serve } from "./action-test-stores.mjs";

const { applyPlanToJSON } = createRequire(new URL("../web/app/package.json", import.meta.url))("slateboxjs/operations");

const note = (id, text, x = 100) => ({
  options: { id, text, xPos: x, yPos: 100, width: 180, height: 100, vectorPath: "rectangle", backgroundColor: "#7aa2c8" },
  relationships: { associations: [] },
});
const owner = { kind: "person", userId: "owner", tokenId: null, scopes: ["slates:read", "slates:write"] };

function app(t) {
  const slates = memoryMongo();
  const events = memoryMongo();
  const runs = memoryMongo();
  let clock = 5000;
  const now = () => clock++;
  const saveCore = createSlateSaveCore({ slates, events, now });
  const sortBy = (sort = {}) => (a, b) => {
    for (const [key, dir] of Object.entries(sort)) {
      // Mongo's order: dir 1 ascending, -1 descending.
      if ((a[key] ?? -Infinity) < (b[key] ?? -Infinity)) return -dir;
      if ((a[key] ?? -Infinity) > (b[key] ?? -Infinity)) return dir;
    }
    return 0;
  };
  const deps = {
      saveCore,
      // The owner and the slate's editors may edit it.
      authorizeTokenForSlate: async (token, shareId) => {
        const slate = await slates.findOne({ shareId });
        const authorized = Boolean(slate && (slate.userId === token.userId || (slate.editors ?? []).includes(token.userId)));
        return { slate, authorized, access: authorized ? { role: "EDIT", canEdit: true, isOwner: slate.userId === token.userId, linkRole: null, grantKey: null } : null };
      },
      loadUser: async (userId) => ({ _id: userId }),
      readSlate: createSlateReader({ listComments: async () => [], findPresentation: async () => null, appOrigin: () => "http://slatebox.test", embedOrigin: () => "http://slatebox.test" }),
      applySlateOperationPlanToJSON: applyPlanToJSON,
      // A Meteor collection in the app (findOneAsync with a sort, insertAsync, updateAsync).
      operationRuns: {
        findOneAsync: async (selector, options = {}) => (await runs.find(selector).toArray()).sort(sortBy(options.sort))[0] ?? null,
        insertAsync: (row) => runs.insertOne({ _id: "run-" + runs.docs().length, ...row }),
        updateAsync: (selector, update) => runs.updateOne(selector, update),
      },
  };
  const registry = createAppRegistry({
    deps,
    idempotency: createIdempotencyStore({ collection: memoryMongo() }),
    now,
  });
  const authenticate = async (req) => {
    const raw = req.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!raw) return null;
    const [userId, token = "main"] = raw.split(":");
    return { kind: "agent", tokenId: "token-" + userId + "-" + token, tokenName: "Agent " + token, userId, scopes: ["slates:read", "slates:write"] };
  };
  return { slates, runs, saveCore, deps, now, call: serve(t, registry, authenticate) };
}

async function seeded(t) {
  const env = app(t);
  await env.saveCore.create({
    row: {
      _id: "s1", shareId: "share1", userId: "owner", editors: ["peer"], lastSaved: 1,
      nodes: [note("a", "Alpha"), note("b", "Beta", 400)],
      options: { id: "s1", name: "Plan", description: "", isPrivate: true, isPublic: false, isUnlisted: false },
    },
    actor: owner,
    source: "create",
  });
  env.call = await env.call;
  return env;
}

const plan = (...operations) => ({ message: "Done.", operations });
const revision = async (env) => (await env.slates.findOne({ _id: "s1" })).revision;
async function edit(env, token, ...operations) {
  const saved = await env.call("/api/v1/slates/share1/operations", { token, method: "POST", body: { plan: plan(...operations), expectedRevision: await revision(env) } });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  return saved;
}
const undo = (env, token) => env.call("/api/v1/slates/share1/undo", { token, method: "POST", body: {} });
const redo = (env, token) => env.call("/api/v1/slates/share1/redo", { token, method: "POST", body: {} });
const stored = async (env) => (await env.slates.findOne({ _id: "s1" })).nodes;
const textOf = async (env, id) => (await stored(env)).find((n) => n.options.id === id)?.options.text;

test("a caller's undo puts back what their edit changed, saved as an edit; redo makes it again; a new edit clears redo", async (t) => {
  const env = await seeded(t);
  await edit(env, "owner", { kind: "update_nodes", target: { ids: ["b"] }, changes: { text: "Shipped", backgroundColor: "#ff0000" } });
  const before = await revision(env);
  const undone = await undo(env, "owner");
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.equal(await textOf(env, "b"), "Beta");
  assert.equal(undone.body.revision, before + 1);
  assert.deepEqual(undone.body.left, []);
  assert.equal(undone.body.undone, "run-0");
  // The undo is drawn on every open canvas as any saved plan is: a receipt with its plan, naming what it undid.
  const receipt = env.runs.docs().at(-1);
  assert.equal(receipt.plan.operations[0].kind, "update_nodes");
  assert.deepEqual(receipt.stepOf, { undo: "run-0" });
  assert.equal(receipt.undoable, undefined);

  const redone = await redo(env, "owner");
  assert.equal(redone.status, 200, JSON.stringify(redone.body));
  assert.equal(await textOf(env, "b"), "Shipped");
  assert.equal(redone.body.redone, "run-0");

  // Undo again, then a new edit: nothing to redo.
  assert.equal((await undo(env, "owner")).status, 200);
  await edit(env, "owner", { kind: "update_nodes", target: { ids: ["a"] }, changes: { text: "Alpha 2" } });
  const none = await redo(env, "owner");
  assert.equal(none.status, 409);
  assert.equal(none.body.code ?? none.body.error?.code ?? none.body.type?.split("/").pop(), "nothing_to_redo");
});

test("undo takes back only the caller's own edit: another person's later edit and another token's edit stay", async (t) => {
  const env = await seeded(t);
  await edit(env, "owner", { kind: "add_nodes", count: 1, ids: ["mine"], text: "Owner idea", shape: "rectangle" });
  await edit(env, "peer", { kind: "update_nodes", target: { ids: ["a"] }, changes: { text: "Alpha by peer" } });
  // The same person through another token (another agent) is another caller.
  await edit(env, "owner:other", { kind: "update_nodes", target: { ids: ["b"] }, changes: { text: "Beta by the other agent" } });
  const undone = await undo(env, "owner");
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  const notes = await stored(env);
  assert.equal(notes.some((n) => n.options.id === "mine"), false);
  assert.equal(await textOf(env, "a"), "Alpha by peer");
  assert.equal(await textOf(env, "b"), "Beta by the other agent");
  // Nothing of the owner's main token is left to undo.
  const none = await undo(env, "owner");
  assert.equal(none.status, 409);
});

test("a part someone else changed since stays as they left it and is listed; the rest goes back", async (t) => {
  const env = await seeded(t);
  await edit(env, "owner", { kind: "update_nodes", target: { ids: ["b"] }, changes: { text: "Owner text", backgroundColor: "#00ff00" } });
  await edit(env, "peer", { kind: "update_nodes", target: { ids: ["b"] }, changes: { text: "Peer text" } });
  const undone = await undo(env, "owner");
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  const b = (await stored(env)).find((n) => n.options.id === "b");
  assert.equal(b.options.text, "Peer text");
  assert.notEqual(b.options.backgroundColor, "#00ff00");
  assert.deepEqual(undone.body.left, [{ kind: "note", id: "b", key: "text", reason: "changed since by someone else" }]);
});

test("an edit someone else has entirely changed since is undone with nothing saved, and says so", async (t) => {
  const env = await seeded(t);
  await edit(env, "owner", { kind: "update_nodes", target: { ids: ["b"] }, changes: { text: "Owner text" } });
  await edit(env, "peer", { kind: "update_nodes", target: { ids: ["b"] }, changes: { text: "Peer text" } });
  const at = await revision(env);
  const undone = await undo(env, "owner");
  assert.equal(undone.status, 200);
  assert.deepEqual(undone.body.operations, []);
  assert.match(undone.body.message, /Someone else changed everything that edit changed since/);
  assert.equal(await revision(env), at);
  assert.equal(await textOf(env, "b"), "Peer text");
});

test("undo brings back notes and lines an edit removed, and removes notes and lines it added", async (t) => {
  const env = await seeded(t);
  await edit(env, "owner", { kind: "connect_nodes", from: { ids: ["a"] }, to: { ids: ["b"] }, ids: ["a->b"] });
  await edit(env, "owner", { kind: "delete_nodes", target: { ids: ["b"] } });
  assert.equal((await stored(env)).some((n) => n.options.id === "b"), false);
  const restored = await undo(env, "owner");
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  const back = (await stored(env)).find((n) => n.options.id === "b");
  assert.equal(back.options.text, "Beta");
  const a = (await stored(env)).find((n) => n.options.id === "a");
  assert.deepEqual(a.relationships.associations.map((l) => l.childId), ["b"]);
  // Undo the connection too: the line goes.
  assert.equal((await undo(env, "owner")).status, 200);
  const a2 = (await stored(env)).find((n) => n.options.id === "a");
  assert.deepEqual(a2.relationships.associations, []);
});

test("an agent's work kept or undone through its suggestions is never slates.undo's: it skips to the caller's own applyOperations edit", async (t) => {
  const env = await seeded(t);
  await edit(env, "owner", { kind: "update_nodes", target: { ids: ["a"] }, changes: { text: "Alpha by the agent" } });
  // suggestions.decide saves an agent action's undo (or a person's Keep) with its attribution, as the same caller.
  const caller = { kind: "agent", tokenId: "token-owner-main", tokenName: "Agent main", userId: "owner", scopes: ["slates:read", "slates:write"] };
  const slate = await env.slates.findOne({ _id: "s1" });
  await applyToCanvas(caller, { plan: plan({ kind: "update_nodes", target: { ids: ["b"] }, changes: { text: "Beta, the agent's action undone" } }), userMessage: "", expectedRevision: slate.revision },
    { deps: env.deps, mode: "save", now: env.now, idempotencyKey: null, resource: slate, attribution: { agentId: "agent-1", label: "Agent main", undo: true } });
  const attributed = env.runs.docs().at(-1);
  assert.equal(attributed.undoable, undefined);
  assert.equal(attributed.agent.agentId, "agent-1");
  // slates.undo takes back the caller's own edit, and leaves the suggestions' save as it is.
  const undone = await undo(env, "owner");
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.equal(undone.body.undone, "run-0");
  assert.equal(await textOf(env, "a"), "Alpha");
  assert.equal(await textOf(env, "b"), "Beta, the agent's action undone");
});

test("undo leaves a note it added when someone else has drawn a line to it since, and says so; the line stays", async (t) => {
  const env = await seeded(t);
  await edit(env, "owner", { kind: "add_nodes", count: 1, ids: ["n1"], text: "Agent idea", shape: "rectangle" });
  await edit(env, "peer", { kind: "connect_nodes", from: { ids: ["a"] }, to: { ids: ["n1"] }, ids: ["L1"] });
  const undone = await undo(env, "owner");
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.deepEqual(undone.body.operations, []);
  assert.deepEqual(undone.body.left, [{ kind: "note", id: "n1", reason: "connected since by someone else" }]);
  assert.ok((await stored(env)).some((n) => n.options.id === "n1"));
  const a = (await stored(env)).find((n) => n.options.id === "a");
  assert.deepEqual(a.relationships.associations.map((l) => l.childId), ["n1"]);
});

test("a note the caller added with its own line goes, line and all, when nobody else connected to it", async (t) => {
  const env = await seeded(t);
  await edit(env, "owner",
    { kind: "add_nodes", count: 1, ids: ["n1"], text: "Agent idea", shape: "rectangle" },
    { kind: "connect_nodes", from: { ids: ["a"] }, to: { ids: ["n1"] }, ids: ["mine"] });
  const undone = await undo(env, "owner");
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.deepEqual(undone.body.left, []);
  assert.equal((await stored(env)).some((n) => n.options.id === "n1"), false);
});

test("two undo calls at once take back two different edits, never the same one twice", async (t) => {
  const env = await seeded(t);
  await edit(env, "owner", { kind: "update_nodes", target: { ids: ["a"] }, changes: { text: "Alpha 2" } });
  await edit(env, "owner", { kind: "update_nodes", target: { ids: ["b"] }, changes: { text: "Beta 2" } });
  // Both calls read their edit before either marks it: a slow database.
  const read = env.deps.operationRuns.findOneAsync;
  env.deps.operationRuns.findOneAsync = async (...args) => { const found = await read(...args); await new Promise((resolve) => setTimeout(resolve, 5)); return found; };
  const [first, second] = await Promise.all([undo(env, "owner"), undo(env, "owner")]);
  assert.deepEqual([first.status, second.status], [200, 200], JSON.stringify([first.body, second.body]));
  assert.deepEqual([first.body.undone, second.body.undone].sort(), ["run-0", "run-1"]);
  assert.equal(await textOf(env, "a"), "Alpha");
  assert.equal(await textOf(env, "b"), "Beta");
  assert.ok(env.runs.docs().every((run) => run.claimedAt == null), "no edit is left held");
});

test("slates.undo and slates.redo are in the action contract with factual descriptions", async () => {
  const contract = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../web/app/server/actions/generated/contract.json", import.meta.url), "utf8"));
  const text = JSON.stringify(contract);
  for (const id of ["slates.undo", "slates.redo"]) assert.ok(text.includes(id), id);
  assert.ok(text.includes("never takes back a person"));
});
