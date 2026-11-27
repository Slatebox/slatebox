// What agents suggest, live on the slate (server/agents/suggestions.mjs, the slates.applyOperations
// routing and server/actions/agent-suggestions.mjs): an agent's canvas edit becomes ghosts for
// everyone on the slate, people who may edit keep or discard them, each agent's work undoes on its
// own, the edit-directly mode and Pause all, attribution, and the same rules on exec and MCP.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createSuggestionStore, addNoteOps, diffItems, publicAction, summarize, choreography } from "../web/app/server/agents/suggestions.mjs";
import { applyToCanvas } from "../web/app/server/actions/slate-operations.mjs";
import { safeIconUrl } from "../web/app/server/presence/agentPresence.mjs";
import { reportedClientName } from "../web/app/server/mcp/endpoint.mjs";
import { createAppRegistry } from "../web/app/server/actions/index.mjs";
import { buildClientManifest, renderExecTool } from "../web/app/server/actions/client-render.mjs";
import { boundActions } from "../web/app/server/actions/exec-binding.mjs";
import { EXEC_LIMITS } from "../web/app/server/exec/limits.mjs";
import { memoryCollection, makeExecWorld } from "./exec-test-world.mjs";
import { memoryMongo } from "./memory-mongo.mjs";

const appRequire = createRequire(new URL("../web/app/package.json", import.meta.url));
const { readNote, applyPlanToJSON } = await import(appRequire.resolve("slateboxjs/operations"));

const ALL = ["slates:read", "slates:write", "slates:delete"];
const person = (userId = "owner", kind = "person") => ({ kind, userId, tokenId: null, tokenName: null, scopes: ALL });

function world(options = {}) {
  const w = makeExecWorld(options);
  let n = 0;
  const flags = { editDirectly: false };
  const editors = new Set();
  w.deps.suggestions = createSuggestionStore({
    collection: memoryCollection(),
    controls: memoryCollection(),
    identify: w.presence.identify,
    applyPlan: async () => { throw new Error("keep and undo pass their own save"); },
    findName: async (id) => ({ owner: "Ada", other: "Ben" })[id] ?? "Someone",
    newId: () => `s${++n}`,
  });
  w.deps.agentOptions = { editDirectly: () => flags.editDirectly };
  w.deps.resolveSlateForUser = async (shareId, userId) => {
    const slate = w.slate(shareId);
    if (!slate) return null;
    const own = slate.userId === userId;
    return { slate, canRead: own || editors.has(userId) || slate.options.isPublic === true, canEdit: own || editors.has(userId) };
  };
  return Object.assign(w, { flags, editors });
}

const add = (text, extra = {}) => ({ kind: "add_nodes", count: 1, shape: "rectangle", text, ...extra });
const edit = (w, principal, operations, { shareId = "demo", message = "Ideas" } = {}) =>
  w.registry.run(principal, "slates.applyOperations", { shareId, expectedRevision: w.slate(shareId).revision ?? 0, plan: { message, operations } });
const decide = (w, principal, input) => w.registry.run(principal, "suggestions.decide", { shareId: "demo", ...input });
const list = async (w, principal = person()) => (await w.registry.run(principal, "suggestions.list", { shareId: "demo" })).body;
// Keep all on an agent's chip: each of its actions with something waiting.
async function keepAll(w, principal, agentId) {
  const out = { kept: [], refused: [] };
  for (const action of (await list(w)).actions.filter((a) => a.agentId === agentId && a.items.some((item) => item.state === "pending"))) {
    const { body } = await decide(w, principal, { decision: "keep", actionId: action.actionId });
    out.kept.push(...body.kept);
    out.refused.push(...body.refused);
  }
  return out;
}
const ids = (w, shareId = "demo") => w.slate(shareId).nodes.map((node) => node.options.id);

test("an agent's canvas edit is shown live as suggestions, not saved; its pointer visits each ghost and says what it suggests", async (t) => {
  const w = world();
  t.after(() => w.close());
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const before = structuredClone(w.slate("demo").nodes);
  const out = await edit(w, agent, [add("Idea A"), add("Idea B"), { kind: "update_nodes", target: { ids: ["second"] }, changes: { text: "Second, sharper" } }, { kind: "connect_nodes", from: { ids: ["second"] }, to: { ids: ["welcome"] } }]);
  assert.equal(out.status, 202);
  assert.equal(out.body.outcome, "suggested");
  assert.equal(out.body.mode, "save");
  assert.match(out.body.message, /^Suggested on the slate: 2 new notes, 1 change and 1 line/);
  assert.deepEqual(w.slate("demo").nodes, before, "nothing is saved");
  assert.equal(out.body.revision, w.slate("demo").revision ?? 0);
  assert.equal(w.runs.length, 0, "no run for canvases to draw");
  const { suggestion } = out.body;
  assert.deepEqual(suggestion.items.map((item) => item.kind).sort(), ["add", "add", "link", "update"]);
  assert.ok(suggestion.items.every((item) => item.state === "pending"));
  const added = suggestion.items.filter((item) => item.kind === "add");
  assert.deepEqual(added.map((item) => item.node.options.text), ["Idea A", "Idea B"]);
  const update = suggestion.items.find((item) => item.kind === "update");
  assert.deepEqual([update.nodeId, update.changes, update.previous], ["second", { text: "Second, sharper" }, { text: "Second" }]);
  assert.equal(suggestion.label, "Ada's agent");
  assert.equal(suggestion.origin, "visiting");
  assert.match(suggestion.agentId, /^[0-9a-f]{12}$/);
  // The pointer: to the first ghost's spot, then each ghost and the changed note, saying what it suggests.
  const [doc] = [...w.presenceRows.docs.values()];
  assert.deepEqual(doc.targets, [...added.map((item) => "ghost-" + item.nodeId), "second"]);
  assert.equal(doc.say, "Suggesting 2 new notes, 1 change and 1 line");
  assert.ok(doc.sayAt instanceof Date);
  const first = added[0].node.options;
  assert.deepEqual(doc.point, { x: Math.round(first.xPos + first.width / 2), y: Math.round(first.yPos + first.height / 2) });
  assert.equal(doc.agentId, suggestion.agentId);
  // Slate settings are not suggested.
  await assert.rejects(edit(w, agent, [{ kind: "update_slate", changes: { name: "Renamed" } }]), { status: 409, code: "needs_direct_edit" });
});

test("an agent builds on its own waiting notes: it may connect them and change them, and removing one takes it back", async (t) => {
  const w = world();
  t.after(() => w.close());
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const first = await edit(w, agent, [add("Draft"), add("Spare")]);
  const [draft, spare] = first.body.suggestion.items.map((item) => item.nodeId);
  const next = await edit(w, agent, [
    { kind: "connect_nodes", from: { ids: ["welcome"] }, to: { ids: [draft] } },
    { kind: "update_nodes", target: { ids: [draft] }, changes: { text: "Draft, final" } },
    { kind: "delete_nodes", target: { ids: [spare] } },
  ]);
  assert.equal(next.status, 202);
  assert.deepEqual(next.body.suggestion.items.map((item) => [item.kind, item.parentId, item.association?.childId]), [["link", "welcome", draft]]);
  const { actions } = await list(w);
  const earlier = actions.find((action) => action.actionId === first.body.suggestion.actionId);
  const byNode = Object.fromEntries(earlier.items.map((item) => [item.nodeId, item]));
  assert.equal(byNode[draft].node.options.text, "Draft, final", "the waiting note changed");
  assert.equal(byNode[draft].state, "pending");
  assert.deepEqual([byNode[spare].state, byNode[spare].reason], ["discarded", "withdrawn"]);
  assert.equal(ids(w).length, 2, "still nothing saved");
});

test("people who may edit keep or discard right on the ghost; readers, other people and the agent itself cannot keep", async (t) => {
  const w = world();
  t.after(() => w.close());
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const out = await edit(w, agent, [add("Keep me"), add("Drop me")]);
  const { actionId, items } = out.body.suggestion;
  const [keepItem, dropItem] = items;
  // Someone who cannot edit the slate: refused, by the session rule and by the token rule.
  await assert.rejects(decide(w, person("other"), { decision: "keep", actionId }), { status: 404 });
  const theirs = await w.principalFor(["slates:read", "slates:write"], "other");
  await assert.rejects(decide(w, theirs, { decision: "discard", actionId }), { status: 403 });
  w.slate("demo").options.isPublic = true;
  await assert.rejects(decide(w, person("other"), { decision: "keep", actionId }), { status: 403, code: "edit_role_required" });
  const reader = await w.principalFor(["slates:read"]);
  await assert.rejects(decide(w, reader, { decision: "keep", actionId }), { code: "insufficient_scope" });
  w.slate("demo").options.isPublic = false;
  // The agent cannot keep its own suggestions, and no other agent (even the same person's) keeps them either.
  await assert.rejects(decide(w, agent, { decision: "keep", actionId }), { status: 403, code: "people_only" });
  const sibling = await w.principalFor(["slates:read", "slates:write"]);
  await assert.rejects(decide(w, sibling, { decision: "keep", actionId }), { status: 403, code: "people_only" });
  assert.equal(ids(w).length, 2);
  // The owner keeps one: it is saved with its own id and words, through the edit path canvases draw.
  const kept = await decide(w, person(), { decision: "keep", actionId, itemIds: [keepItem.id] });
  assert.deepEqual(kept.body.kept, [{ actionId, itemId: keepItem.id }]);
  assert.ok(ids(w).includes(keepItem.nodeId));
  assert.equal(w.slate("demo").nodes.find((node) => node.options.id === keepItem.nodeId).options.text, "Keep me");
  assert.equal(kept.body.revision, w.slate("demo").revision);
  const run = w.runs.at(-1);
  assert.equal(run.plan.operations[0].kind, "add_nodes");
  assert.deepEqual(run.plan.operations[0].ids, [keepItem.nodeId]);
  assert.equal(run.agent.agentId, out.body.suggestion.agentId, "the run names the agent it came from");
  assert.equal(run.agent.kept, true);
  // A person who was given the edit right discards the other: nothing saved, its ghost goes.
  w.editors.add("other");
  const revision = w.slate("demo").revision;
  const dropped = await decide(w, person("other"), { decision: "discard", actionId, itemIds: [dropItem.id] });
  assert.deepEqual(dropped.body.discarded, [{ actionId, itemId: dropItem.id }]);
  assert.equal(w.slate("demo").revision, revision);
  const { actions } = await list(w);
  assert.deepEqual(actions[0].items.map((item) => [item.state, item.decidedBy]), [["kept", "Ada"], ["discarded", "Ben"]]);
  assert.equal(actions[0].items[0].node, undefined, "a kept note's ghost data is not sent on");
  assert.deepEqual(await w.deps.suggestions.ghostIds("slate-1"), []);
});

test("Keep all keeps every waiting suggestion of one agent in one save; a line brings the new notes at its ends; a gone note is refused", async (t) => {
  const w = world();
  t.after(() => w.close());
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const a = await edit(w, agent, [add("One")]);
  const one = a.body.suggestion.items[0].nodeId;
  const b = await edit(w, agent, [{ kind: "connect_nodes", from: { ids: ["second"] }, to: { ids: [one] } }, { kind: "update_nodes", target: { ids: ["welcome"] }, changes: { backgroundColor: "#ffcc00" } }]);
  // Keeping only the line brings its new note with it.
  const line = b.body.suggestion.items.find((item) => item.kind === "link");
  const kept = await decide(w, person(), { decision: "keep", actionId: b.body.suggestion.actionId, itemIds: [line.id] });
  assert.equal(kept.body.kept.length, 2);
  assert.ok(ids(w).includes(one));
  assert.ok(w.slate("demo").nodes.find((node) => node.options.id === "second").relationships.associations.some((l) => l.childId === one));
  // A change to a note someone removed meanwhile is refused, and says why.
  const c = await edit(w, agent, [{ kind: "update_nodes", target: { ids: ["second"] }, changes: { text: "Gone soon" } }, add("Two")]);
  w.slate("demo").nodes = w.slate("demo").nodes.filter((node) => node.options.id !== "second");
  const all = await keepAll(w, person(), c.body.suggestion.agentId);
  assert.equal(all.refused.length, 1);
  assert.equal(all.refused[0].reason, "The note is no longer on the slate.");
  assert.equal(all.kept.length, 2, "the colour change and the new note");
  assert.equal(w.slate("demo").nodes.find((node) => node.options.id === "welcome").options.backgroundColor, "#ffcc00");
  const { agents } = await list(w);
  assert.deepEqual(agents.map((x) => x.waiting), [0]);
});

test("a line is kept when both its ends are: keeping the notes one by one brings the line with the second; discarding either end takes it", async (t) => {
  const w = world();
  t.after(() => w.close());
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const made = await edit(w, agent, [add("A", { ids: ["na"] }), add("B", { ids: ["nb"] }), add("C", { ids: ["nc"] }),
    { kind: "connect_nodes", from: { ids: ["na"] }, to: { ids: ["nb"] } }, { kind: "connect_nodes", from: { ids: ["nb"] }, to: { ids: ["nc"] } }]);
  const action = made.body.suggestion;
  const item = (nodeId) => action.items.find((i) => i.kind === "add" && i.nodeId === nodeId).id;
  // the first end alone: no line yet
  const first = await decide(w, person(), { decision: "keep", actionId: action.actionId, itemIds: [item("na")] });
  assert.equal(first.body.kept.length, 1);
  // the second end: its note, and the line between the two, in one save
  const before = w.slate("demo").revision;
  const second = await decide(w, person(), { decision: "keep", actionId: action.actionId, itemIds: [item("nb")] });
  assert.equal(second.body.kept.length, 2);
  assert.equal(w.slate("demo").revision, before + 1, "one save, so one undo step");
  assert.ok(w.slate("demo").nodes.find((n) => n.options.id === "na").relationships.associations.some((l) => l.childId === "nb"));
  // discarding the third note takes the line to it
  const gone = await decide(w, person(), { decision: "discard", actionId: action.actionId, itemIds: [item("nc")] });
  assert.equal(gone.body.discarded.length, 2);
  const after = (await list(w)).actions.find((a) => a.actionId === action.actionId);
  assert.equal(after.items.filter((i) => i.state === "pending").length, 0);
});

test("undo is per agent action: it never undoes another agent's work, and leaves what a person changed since", async (t) => {
  const w = world();
  t.after(() => w.close());
  const agentA = await w.principalFor(["slates:read", "slates:write"]);
  const agentB = await w.principalFor(["slates:read", "slates:write"]);
  w.slate("demo").nodes[1].options.backgroundColor = "#ffffff";
  const a = await edit(w, agentA, [add("From A"), { kind: "update_nodes", target: { ids: ["second"] }, changes: { text: "A's words", backgroundColor: "#00aa00" } }]);
  const b = await edit(w, agentB, [add("From B"), { kind: "update_nodes", target: { ids: ["welcome"] }, changes: { text: "B's words" } }]);
  assert.notEqual(a.body.suggestion.agentId, b.body.suggestion.agentId, "two tokens are two agents");
  await keepAll(w, person(), a.body.suggestion.agentId);
  await keepAll(w, person(), b.body.suggestion.agentId);
  const fromA = a.body.suggestion.items[0].nodeId;
  const fromB = b.body.suggestion.items[0].nodeId;
  assert.ok(ids(w).includes(fromA) && ids(w).includes(fromB));
  // A person changes the note A changed (its words), through the same edit path.
  const slate = w.slate("demo");
  await applyToCanvas(person(), { plan: { message: "Mine", operations: [{ kind: "update_nodes", target: { ids: ["second"] }, changes: { text: "Ada's words" } }] }, expectedRevision: slate.revision }, { deps: w.deps, mode: "save", now: () => 9000, resource: slate });
  const undone = await decide(w, person(), { decision: "undo", actionId: a.body.suggestion.actionId });
  assert.equal(undone.body.undone.length, 2, "A's note and A's colour");
  assert.ok(!ids(w).includes(fromA));
  const second = w.slate("demo").nodes.find((node) => node.options.id === "second").options;
  assert.equal(second.text, "Ada's words", "the person's later edit stays");
  assert.equal(second.backgroundColor, "#ffffff", "A's colour went back");
  assert.ok(ids(w).includes(fromB), "B's note stays");
  assert.equal(w.slate("demo").nodes.find((node) => node.options.id === "welcome").options.text, "B's words", "B's change stays");
  // Nothing left of A's action to undo; B's still undoes.
  await assert.rejects(decide(w, person(), { decision: "undo", actionId: a.body.suggestion.actionId }), { status: 409, code: "nothing_to_undo" });
  const { actions } = await list(w);
  const actionA = actions.find((x) => x.actionId === a.body.suggestion.actionId);
  assert.deepEqual([actionA.undone, actionA.undoable], [true, false]);
  assert.equal(actions.find((x) => x.actionId === b.body.suggestion.actionId).undoable, true);
  // Only someone who may edit undoes.
  await assert.rejects(decide(w, person("other"), { decision: "undo", actionId: b.body.suggestion.actionId }), { status: 404 });
  await assert.rejects(decide(w, person(), { decision: "undo", actionId: b.body.suggestion.actionId, itemIds: ["x"] }), { status: 400 });
});

test("edit directly: off unless settings allow it; a person turns it on for one agent; each save is one undoable action", async (t) => {
  const w = world();
  t.after(() => w.close());
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const probe = await edit(w, agent, [add("Probe")]);
  const agentId = probe.body.suggestion.agentId;
  await assert.rejects(w.registry.run(person(), "agents.control", { shareId: "demo", agentId, editing: "direct" }), { status: 403, code: "edit_directly_off" });
  w.flags.editDirectly = true;
  // An agent cannot widen its own rights, nor can a guest; agents.control is not on the token surfaces.
  await assert.rejects(w.registry.run(agent, "agents.control", { shareId: "demo", agentId, editing: "direct" }), { status: 403, code: "session_required" });
  await assert.rejects(w.registry.run(person("owner", "guest"), "agents.control", { shareId: "demo", agentId, editing: "direct" }), { status: 403, code: "person_required" });
  // Another editor of the slate cannot let someone else's agent edit directly: only the person who brought it, or the slate's owner.
  w.editors.add("other");
  await assert.rejects(w.registry.run(person("other"), "agents.control", { shareId: "demo", agentId, editing: "direct" }), { status: 403, code: "agent_owner_only" });
  assert.equal(await w.deps.suggestions.maySetDirect(w.slate("demo"), agentId, "other"), false);
  // The person whose token the agent runs as may (its actions say whose it is), and so may the slate's owner.
  assert.deepEqual(await w.deps.suggestions.agentsOf(w.slate("demo")._id, "owner"), [agentId]);
  assert.deepEqual(await w.deps.suggestions.agentsOf(w.slate("demo")._id, "other"), []);
  const set = await w.registry.run(person(), "agents.control", { shareId: "demo", agentId, editing: "direct" });
  assert.deepEqual(set.body.modes, { [agentId]: "direct" });
  assert.equal((await w.deps.suggestions.controlsOf(w.slate("demo")._id)).modeBy[agentId], "Ada");
  // ...but any editor may put it back to suggesting (checked below); here it stays direct.
  const saved = await edit(w, agent, [add("Straight in"), { kind: "update_nodes", target: { ids: ["welcome"] }, changes: { text: "Hello" } }]);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.outcome, "saved");
  const straight = saved.body.report.created[0];
  assert.ok(ids(w).includes(straight));
  const { actions, agents } = await list(w);
  const direct = actions.at(-1);
  assert.equal(direct.mode, "direct");
  assert.deepEqual(direct.items.map((item) => item.state), ["applied", "applied"]);
  assert.equal(agents.find((x) => x.agentId === agentId).mode, "direct");
  const undone = await decide(w, person(), { decision: "undo", actionId: direct.actionId });
  assert.equal(undone.body.undone.length, 2);
  assert.ok(!ids(w).includes(straight));
  assert.equal(w.slate("demo").nodes.find((node) => node.options.id === "welcome").options.text, "Welcome!");
  // Settings off again: the agent suggests, whatever was set.
  w.flags.editDirectly = false;
  assert.equal((await edit(w, agent, [add("Back to ghosts")])).body.outcome, "suggested");
  // Back to suggesting by a person.
  w.flags.editDirectly = true;
  await w.registry.run(person(), "agents.control", { shareId: "demo", agentId, editing: "suggest" });
  assert.equal((await edit(w, agent, [add("Ghost again")])).body.outcome, "suggested");
});

test("Pause all agents stops every agent's edits on the slate until a person resumes them", async (t) => {
  const w = world();
  t.after(() => w.close());
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const paused = await w.registry.run(person(), "agents.control", { shareId: "demo", paused: true });
  assert.equal(paused.body.paused, true);
  await assert.rejects(edit(w, agent, [add("Blocked")]), { status: 423, code: "agents_paused" });
  // A preview still works (it saves and suggests nothing).
  const preview = await w.registry.run(agent, "slates.applyOperations", { shareId: "demo", mode: "preview", expectedRevision: 0, plan: { message: "Look", operations: [add("Just looking")] } });
  assert.equal(preview.status, 200);
  assert.equal((await list(w)).paused, true);
  await w.registry.run(person(), "agents.control", { shareId: "demo", paused: false });
  assert.equal((await edit(w, agent, [add("Free")])).status, 202);
});

test("attribution: a visiting agent is named with its client; an invited agent with who added it and only a safe icon", async (t) => {
  const w = world();
  t.after(() => w.close());
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  w.tokens.docs.find((doc) => doc._id === agent.tokenId).lastClient = "Claude";
  const out = await edit(w, agent, [add("Hi")]);
  assert.deepEqual([out.body.suggestion.label, out.body.suggestion.origin, out.body.suggestion.via], ["Ada's agent · Claude", "visiting", "Claude"]);
  const slate = w.slate("demo");
  const invited = await w.presence.identify({ kind: "agent", userId: "owner", tokenId: "connector:c1", connector: { id: "c1", name: "Research", iconUrl: "javascript:alert(1)" } }, slate);
  assert.deepEqual([invited.label, invited.origin, invited.invitedBy, invited.iconUrl], ["Research", "invited", "Ada", null]);
  const icon = await w.presence.identify({ kind: "agent", userId: "owner", tokenId: "connector:c1", connector: { id: "c1", name: "Research", iconUrl: "https://icons.example/r.png" } }, slate);
  assert.equal(icon.iconUrl, "https://icons.example/r.png");
  assert.equal(icon.agentId, invited.agentId, "one agent across runs on this slate");
  assert.equal(safeIconUrl("data:image/svg+xml;base64,PHN2Zz4="), null, "no SVG (it can carry script)");
  assert.equal(safeIconUrl("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=");
  assert.equal(safeIconUrl("http://plain.example/x.png"), null);
  // The Slatebox agent says so, and saves (its tasks were assigned and approved by a person).
  const builtin = await w.presence.identify({ kind: "agent", userId: "owner", tokenId: "agent:slatebox", builtin: "slatebox" }, slate);
  assert.deepEqual([builtin.label, builtin.origin], ["Slatebox agent", "slatebox"]);
  // What screens and agents receive names no account, token or run.
  const action = (await list(w)).actions[0];
  for (const field of ["ownerId", "runId", "tokenId", "slateId"]) assert.equal(action[field], undefined, field);
});

test("exec and MCP reach keep, discard and undo with the same checks and read suggestions with the slate; pause and edit directly stay with people", async (t) => {
  const w = world({ limits: { ...EXEC_LIMITS, cpuMs: 1500, wallMs: 8000 } });
  t.after(() => w.close());
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const run = await w.exec.service.run({ principal: agent, intent: "Suggest", code: `
const r = await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, plan: { message: "Suggest", operations: [{ kind: "add_nodes", count: 2, shape: "rectangle", text: "Via exec" }] } })
const read = await slatebox.slates.get({ shareId: "demo", include: "suggestions" })
return { outcome: r.outcome, waiting: read.suggestions.actions[0].items.filter((item) => item.state === "pending").length, actionId: r.suggestion.actionId, items: r.suggestion.items.map((item) => item.id) }` });
  assert.equal(run.status, "completed", JSON.stringify(run.error ?? run));
  assert.deepEqual([run.result.outcome, run.result.waiting], ["suggested", 2]);
  assert.equal(ids(w).length, 2, "an exec run's edit is a suggestion too");
  const { actionId, items: [first, second] } = run.result;
  // The agent's own keep is refused (here, after the person agrees to the held call).
  const own = `return slatebox.suggestions.decide({ shareId: "demo", decision: "keep", actionId: ${JSON.stringify(actionId)}, itemIds: [${JSON.stringify(first)}] })`;
  const ownHeld = await w.exec.service.run({ principal: agent, intent: "Keep", code: own });
  assert.equal(ownHeld.status, "confirmation_required", "keeping may remove notes: exec holds it for the person");
  const ownTry = await w.exec.service.run({ principal: agent, intent: "Keep", code: own, confirm: ownHeld.confirmation.id, idempotencyKey: ownHeld.idempotencyKey });
  assert.equal(ownTry.error?.code, "people_only", JSON.stringify(ownTry));
  // Another agent of the same person cannot keep it either (a person keeps, on the slate); it may discard at once.
  const other = await w.principalFor(["slates:read", "slates:write"]);
  const keep = own.replace(first, first);
  const held = await w.exec.service.run({ principal: other, intent: "Keep", code: keep });
  assert.deepEqual([held.status, held.confirmation.reasons[0].rule], ["confirmation_required", "removes"]);
  const refusedKeep = await w.exec.service.run({ principal: other, intent: "Keep", code: keep, confirm: held.confirmation.id, idempotencyKey: held.idempotencyKey });
  assert.equal(refusedKeep.error?.code, "people_only", JSON.stringify(refusedKeep));
  assert.equal(ids(w).length, 2);
  const kept = await decide(w, person(), { decision: "keep", actionId, itemIds: [first] });
  assert.equal(kept.body.kept.length, 1);
  assert.equal(ids(w).length, 3);
  const discard = await w.exec.service.run({ principal: other, intent: "Discard", code: own.replace('"keep"', '"discard"').replace(first, second) });
  assert.equal(discard.status, "completed", JSON.stringify(discard.error ?? discard));
  assert.equal(discard.result.discarded.length, 1);
  // The surfaces: decide is a typed MCP tool and an exec method, and a token reads suggestions with
  // the slate; the canvas's list and people's controls (pause, edit directly) are Meteor methods.
  const registry = createAppRegistry();
  const manifest = buildClientManifest(registry);
  const typed = new Map(renderExecTool(manifest).typed.map((tool) => [tool.method, tool]));
  assert.equal(typed.get("suggestions.decide").name, "decide_suggestions");
  assert.equal(typed.has("agents.control"), false);
  assert.equal(typed.has("suggestions.list"), false);
  assert.deepEqual(registry.get("slates.get").input.properties.include.enum, ["full", "suggestions"]);
  assert.deepEqual(boundActions(registry).filter((a) => /^(suggestions|agents)\./.test(a.id)).map((a) => [a.id, a.mounts.http.path]), [["suggestions.decide", "/slates/{shareId}/suggestions/decide"]]);
  for (const id of ["agents.control", "suggestions.list"]) assert.deepEqual([registry.get(id).mounts, registry.get(id).principals], [{ ddp: true, http: null }, ["person", "guest"]], id);
  assert.equal(registry.get("suggestions.decide").removes({ decision: "discard" }), false);
  assert.equal(registry.get("suggestions.decide").removes({ decision: "keep" }), true);
});

test("a kept note is the note the agent suggested: shape, colours, size and words survive the round trip", () => {
  const slate = { options: { name: "x" }, nodes: [] };
  const made = applyPlanToJSON(slate, { message: "Make", operations: [add("Styled", { width: 240, height: 140, style: { backgroundColor: "#123456", borderColor: "#abcdef", fontSize: 28 } })] }, { requireMatches: true });
  const node = made.slate.nodes[0];
  const again = applyPlanToJSON(slate, { message: "Again", operations: addNoteOps(node) }, { requireMatches: true });
  const { id: _a, ...want } = readNote(node);
  const { id: _b, ...got } = readNote(again.slate.nodes[0]);
  assert.deepEqual(got, want);
  assert.equal(again.slate.nodes[0].options.id, node.options.id);
});

test("items in plain words, and where the pointer goes", () => {
  let n = 0;
  const before = { nodes: [{ options: { id: "a", text: "A", xPos: 0, yPos: 0, width: 100, height: 50 }, relationships: { associations: [{ id: "a->b", parentId: "a", childId: "b" }] } }, { options: { id: "b", text: "B", xPos: 200, yPos: 0, width: 100, height: 50 }, relationships: { associations: [] } }] };
  const after = { nodes: [{ options: { id: "a", text: "A2", xPos: 0, yPos: 0, width: 100, height: 50 }, relationships: { associations: [] } }, { options: { id: "c", text: "C", xPos: 400, yPos: 100, width: 100, height: 50 }, relationships: { associations: [] } }] };
  const items = diffItems(before, after, () => `i${++n}`);
  assert.deepEqual(items.map((item) => item.kind), ["add", "update", "remove"], "the line goes with the removed note");
  assert.equal(summarize(items), "1 new note, 1 change and 1 removal");
  assert.deepEqual(choreography(items), { targets: ["ghost-c", "a", "b"], point: { x: 450, y: 125 } });
  const shown = publicAction({ _id: "x", agentId: "k", label: "L", items: [{ ...items[0], state: "kept" }], summary: "s", mode: "suggest", createdAt: new Date(0) });
  assert.equal(shown.items[0].node, undefined);
});

test("an MCP client's name is read from initialize or, on newer clients, from every request's _meta", () => {
  assert.equal(reportedClientName({ jsonrpc: "2.0", method: "initialize", params: { clientInfo: { name: "Claude" } } }), "Claude");
  assert.equal(reportedClientName({ jsonrpc: "2.0", method: "tools/call", params: { name: "exec", _meta: { "io.modelcontextprotocol/clientInfo": { name: "ChatGPT", version: "1" } } } }), "ChatGPT");
  assert.equal(reportedClientName([{ jsonrpc: "2.0", method: "tools/list", params: {} }, null]), null);
});

test("a pointer whose agent's suggestion waits says \"Waiting for you\", never \"Done\"; on its way to its ghosts it says \"Suggesting…\"", async () => {
  const { withWaiting } = await import("../web/app/imports/api/common/agent-roster.mjs");
  const core = await import(createRequire(new URL("../web/app/package.json", import.meta.url)).resolve("slateboxjs"));
  const { agentStepText } = { ...core, ...(core.default || {}) };
  const steps = ["Ask Exa", "Read what it found", "Place suggestions"].map((text) => ({ text, status: "done" }));
  const ended = { agentKey: "r1", agentId: "ag-exa", label: "Exa", status: "done", plan: { steps, current: 2 }, targets: ["ghost-a", "ghost-b"], updatedAt: 0, endedAt: 0, expiresAt: 1 };
  const other = { ...ended, agentKey: "r2", agentId: "ag-other", targets: [] };
  const actions = [
    { actionId: "x1", agentId: "ag-exa", items: [{ id: "add:a", kind: "add", state: "pending" }, { id: "add:b", kind: "add", state: "kept" }] },
    { actionId: "x2", agentId: "ag-other", items: [{ id: "add:c", kind: "add", state: "kept" }] },
  ];
  const [exa, done] = withWaiting([ended, other], actions);
  assert.equal(exa.waiting, true);
  assert.equal(done.waiting, false);
  assert.equal(agentStepText(exa), "Waiting for you");
  assert.equal(agentStepText(done), "Done", "nothing waits any more: done");
  // Still landing (its pointer on its way to the ghosts): what it does, never Done.
  assert.equal(agentStepText({ ...ended, waiting: false }, { landing: true }), "Suggesting…");
  // A live run that filed a suggestion (its targets are ghosts) is suggesting; its greeting (no ghosts) says its message.
  assert.equal(agentStepText({ ...ended, status: "live", endedAt: null, plan: null }), "Suggesting…");
  assert.equal(agentStepText({ ...ended, status: "live", endedAt: null, plan: null, targets: [], message: "Hi, I'm Exa." }), "Hi, I'm Exa.");
  // Only pending items count; an agent with no agentId is never waiting.
  assert.deepEqual(withWaiting([{ agentKey: "r3" }], actions).map((r) => r.waiting), [false]);
});

test("the roster: people, then agents as their own group; an agent with suggestions waiting or a recent action stays on it; activity reads plainly", async () => {
  const { agentsOnRoster, activityLine, pendingCount, ROSTER_RECENT_MS } = await import("../web/app/imports/api/common/agent-roster.mjs");
  const now = Date.parse("2026-11-23T12:00:00Z");
  const live = { agentKey: "p1", agentId: "a1", label: "Ada's agent · Claude", colorIndex: 2, origin: "visiting", via: "Claude" };
  const waiting = { actionId: "x1", agentId: "a2", label: "Research", origin: "invited", invitedBy: "Ada", summary: "2 new notes", mode: "suggest", createdAt: new Date(now - 2 * ROSTER_RECENT_MS).toISOString(), items: [{ id: "i1", kind: "add", state: "pending" }, { id: "i2", kind: "add", state: "kept", decidedBy: "Ben" }] };
  const old = { actionId: "x2", agentId: "a3", label: "Old", summary: "1 change", mode: "suggest", createdAt: new Date(now - 2 * ROSTER_RECENT_MS).toISOString(), items: [{ id: "i3", kind: "update", state: "kept" }] };
  const recent = { actionId: "x3", agentId: "a1", label: "Ada's agent · Claude", summary: "1 new note", mode: "direct", undone: false, createdAt: new Date(now - 1000).toISOString(), items: [{ id: "i4", kind: "add", state: "applied" }] };
  const roster = agentsOnRoster([live], [waiting, old, recent], now);
  assert.deepEqual(roster.map((agent) => [agent.agentId, agent.live, agent.waiting, agent.actions.length]), [["a1", true, 0, 1], ["a2", false, 1, 1]]);
  assert.equal(pendingCount(waiting), 1);
  assert.equal(activityLine(waiting), "2 new notes · 1 waiting, 1 kept");
  assert.equal(activityLine({ ...waiting, items: waiting.items.map((item) => ({ ...item, state: "kept", decidedBy: "Ada" })) }), "2 new notes · kept by Ada");
  assert.equal(activityLine(recent), "1 new note, saved directly");
  assert.equal(activityLine({ ...recent, undone: true }), "1 new note, saved directly · undone");
  // The canvas wires Keep and Discard on each ghost, Keep all, Undo and Pause to the server's actions.
  const { readFile } = await import("node:fs/promises");
  const listener = await readFile(new URL("../web/app/imports/ui/components/AgentPresenceListener.jsx", import.meta.url), "utf8");
  assert.match(listener, /createAgentSuggestions\(engine, \{\s*canAct: \(\) => canAct\.current/);
  assert.match(listener, /decision: 'keep', actionId, itemIds: \[itemId\]/);
  assert.match(listener, /decision: 'discard', actionId, itemIds: \[itemId\]/);
  assert.match(listener, /decision: 'undo', actionId: action\.actionId/);
  assert.match(listener, /'agents\.control', \{ shareId, paused: !controls\.paused \}/);
  assert.match(listener, /toNode: compat\.v1NodeToV2/);
  // A person's Keep is a step of their own undo history: the run it saves is expected as this page's own
  // (drawn with ownStep), only when something was kept; Discard and an agent action's Undo are not.
  assert.match(listener, /input\.decision === 'keep' \? keepers\.get\(shareId\) : null/);
  assert.match(listener, /expectOwnRuns\(slate, asked, \(out\) => \(out\?\.kept\?\.length \? out\.revision : null\)\)/);
  assert.match(listener, /keepers\.set\(shareId, slate\)/);
  const canvas = await readFile(new URL("../web/app/imports/ui/pages/Canvas.jsx", import.meta.url), "utf8");
  // viewOnly and commentOnly are the sharing's read and comment levels, with a phone viewing only (phone-view.test.mjs).
  assert.match(canvas, /<AgentPresenceListener slate=\{slate\.current\} canEdit=\{!viewOnly && !commentOnly\} \/>/);
  assert.match(canvas, /const viewOnly = phoneView \|\| Boolean\(accessLevel\.current\.isReadOnly\)/);
  assert.match(canvas, /const commentOnly = !phoneView && Boolean\(accessLevel\.current\.isCommentOnly\)/);
});

test("an agent's video note is a live suggestion like any canvas edit; a person's is saved", async (t) => {
  const w = world();
  t.after(() => w.close());
  w.deps.media = async (url) => ({ found: true, media: { provider: "youtube", id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "A talk" } });
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const before = structuredClone(w.slate("demo").nodes);
  const out = await w.registry.run(agent, "slates.addMedia", { shareId: "demo", url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(out.status, 202);
  assert.equal(out.body.outcome, "suggested");
  assert.deepEqual(w.slate("demo").nodes, before, "nothing is saved");
  const [item] = out.body.suggestion.items;
  assert.equal(item.kind, "add");
  assert.equal(item.node.options.media.id, "dQw4w9WgXcQ");
  assert.equal(out.body.nodeId, item.nodeId);
  // Kept by a person: the video note is on the slate.
  const kept = await decide(w, person(), { decision: "keep", actionId: out.body.suggestion.actionId });
  assert.equal(kept.body.kept.length, 1);
  assert.ok(w.slate("demo").nodes.some((node) => node.options.media?.id === "dQw4w9WgXcQ"));
  // A person's own video note saves at once.
  const mine = await w.registry.run(person(), "slates.addMedia", { shareId: "demo", url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(mine.status, 201);
});

test("an agent undoes only its own work; who brought an agent is known from its live presence before it suggests anything", async (t) => {
  const w = world();
  t.after(() => w.close());
  w.flags.editDirectly = true;
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const sibling = await w.principalFor(["slates:read", "slates:write"]);
  const probe = await edit(w, agent, [add("Mine")]);
  const kept = await decide(w, person(), { decision: "keep", actionId: probe.body.suggestion.actionId });
  assert.equal(kept.body.kept.length, 1);
  // Another agent cannot undo what a person kept of this agent's work; the agent itself may take its own back.
  await assert.rejects(decide(w, sibling, { decision: "undo", actionId: probe.body.suggestion.actionId }), { status: 403, code: "people_only" });
  const undone = await decide(w, agent, { decision: "undo", actionId: probe.body.suggestion.actionId });
  assert.equal(undone.body.undone.length, 1);
  // Presence: an agent working on the slate that has not suggested yet still has a known owner.
  const store = createSuggestionStore({
    collection: memoryCollection(), controls: memoryCollection(), identify: w.presence.identify,
    applyPlan: async () => ({ revision: 0 }), presenceOwners: async () => [{ agentId: "fresh", ownerId: "other" }],
  });
  assert.equal(await store.maySetDirect({ _id: "s", userId: "owner" }, "fresh", "other"), true);
  assert.equal(await store.maySetDirect({ _id: "s", userId: "owner" }, "fresh", "third"), false);
  assert.equal(await store.maySetDirect({ _id: "s", userId: "owner" }, "fresh", "owner"), true, "the slate's owner may");
});

test("one chip per agent: an invited agent stays on the roster while it is on the slate, working or not, and its live record joins the same chip", async () => {
  const { agentsOnRoster } = await import("../web/app/imports/api/common/agent-roster.mjs");
  const now = Date.parse("2026-11-23T12:00:00Z");
  const extras = [{ agentId: "inv1", label: "Test Diagrams", colorIndex: 3, invitedBy: "Ada", state: null }, { agentId: "inv2", label: "Issues", colorIndex: 2, invitedBy: "you", state: "needs sign-in" }];
  // idle: both on the roster, as invited agents
  const idle = agentsOnRoster([], [], now, extras);
  assert.deepEqual(idle.map((a) => [a.agentId, a.invited, a.origin, a.state, a.live]), [["inv1", true, "invited", null, false], ["inv2", true, "invited", "needs sign-in", false]]);
  // working: its pointer record joins the same entry (one chip), never a second one
  const working = agentsOnRoster([{ agentKey: "inv1", agentId: "inv1", label: "Test Diagrams", colorIndex: 3, origin: "invited" }], [], now, extras);
  assert.equal(working.filter((a) => a.agentId === "inv1").length, 1);
  assert.equal(working[0].live, true);
  assert.equal(working[0].invited, true);
});

// Run receipts that slates.undo can read and mark (a Meteor collection in the app).
function undoableRuns(w) {
  const rows = memoryMongo();
  let n = 0;
  const order = (sort = {}) => (a, b) => {
    for (const [key, dir] of Object.entries(sort)) {
      if ((a[key] ?? -Infinity) < (b[key] ?? -Infinity)) return -dir;
      if ((a[key] ?? -Infinity) > (b[key] ?? -Infinity)) return dir;
    }
    return 0;
  };
  Object.assign(w.deps.operationRuns, {
    findOneAsync: async (selector, options = {}) => (await rows.find(selector).toArray()).sort(order(options.sort))[0] ?? null,
    insertAsync: (row) => rows.insertOne({ _id: "run-" + n++, ...row }),
    updateAsync: (selector, update) => rows.updateOne(selector, update),
  });
  return rows;
}
async function directAgent(w) {
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const probe = await edit(w, agent, [add("Probe")]);
  const agentId = probe.body.suggestion.agentId;
  await decide(w, person(), { decision: "discard", actionId: probe.body.suggestion.actionId });
  w.flags.editDirectly = true;
  await w.registry.run(person(), "agents.control", { shareId: "demo", agentId, editing: "direct" });
  return { agent, agentId };
}
const slateUndo = (w, principal, direction = "undo") => w.registry.run(principal, direction === "undo" ? "slates.undo" : "slates.redo", { shareId: "demo" });

test("an agent's slates.undo and slates.redo meet the rules its edits meet: paused, suggesting, and work a person already undid", async (t) => {
  const w = world();
  t.after(() => w.close());
  undoableRuns(w);
  const { agent, agentId } = await directAgent(w);
  // The agent adds n1 straight to the slate; a person takes it back with the agent's Undo chip.
  const saved = await edit(w, agent, [add("Straight in")]);
  assert.equal(saved.body.outcome, "saved");
  const n1 = saved.body.report.created[0];
  const direct = (await list(w)).actions.at(-1);
  await decide(w, person(), { decision: "undo", actionId: direct.actionId });
  assert.ok(!ids(w).includes(n1));
  // Nothing of the agent's is left to undo, and its redo never brings back what the person undid.
  await assert.rejects(slateUndo(w, agent), { status: 409, code: "nothing_to_undo" });
  await assert.rejects(slateUndo(w, agent, "redo"), { status: 409, code: "nothing_to_redo" });
  assert.ok(!ids(w).includes(n1), "the person's undo stands");

  const again = await edit(w, agent, [add("Second try")]);
  const n2 = again.body.report.created[0];
  // People paused agents: refused, saved nothing.
  await w.registry.run(person(), "agents.control", { shareId: "demo", paused: true });
  await assert.rejects(slateUndo(w, agent), { status: 423, code: "agents_paused" });
  await w.registry.run(person(), "agents.control", { shareId: "demo", paused: false });
  // Suggesting again: the agent cannot undo straight to the slate.
  await w.registry.run(person(), "agents.control", { shareId: "demo", agentId, editing: "suggest" });
  await assert.rejects(slateUndo(w, agent), { status: 409, code: "needs_direct_edit" });
  assert.ok(ids(w).includes(n2));
  // Direct again: the undo saves, and is filed as one action of the agent's (its own Undo chip).
  await w.registry.run(person(), "agents.control", { shareId: "demo", agentId, editing: "direct" });
  const before = (await list(w)).actions.length;
  const undone = await slateUndo(w, agent);
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.ok(!ids(w).includes(n2));
  const actions = (await list(w)).actions;
  assert.equal(actions.length, before + 1);
  assert.equal(actions.at(-1).mode, "direct");
  assert.equal(actions.at(-1).undoable, true, "a person can take the agent's undo back");
});

test("a held slates.undo names the edit it takes back: a newer edit makes the agreement stale; an undo that removes nothing is not held", async (t) => {
  const w = world();
  t.after(() => w.close());
  undoableRuns(w);
  const { agent } = await directAgent(w);
  const gate = w.exec.gate;
  await edit(w, agent, [add("First")]);
  const held = await gate.directCall(agent, "slates.undo", { shareId: "demo" }).catch((error) => error);
  assert.equal(held.code, "confirmation_required");
  assert.deepEqual(held.details.reasons, [{ rule: "removes", shareId: "demo", count: 1, edit: "run-0" }]);
  // The agent saves another edit before the person agrees: the agreement was for run-0, not the new one.
  const newer = await edit(w, agent, [add("Newer")]);
  const newest = newer.body.report.created[0];
  await assert.rejects(gate.directCall(agent, "slates.undo", { shareId: "demo" }, { confirm: held.details.confirmationId }), { status: 409, code: "confirmation_invalid" });
  assert.ok(ids(w).includes(newest), "nothing was undone");
  // Agreed to the edit it takes back now, it saves.
  const again = await gate.directCall(agent, "slates.undo", { shareId: "demo" }).catch((error) => error);
  assert.equal(again.details.reasons[0].edit, "run-1");
  const done = await gate.directCall(agent, "slates.undo", { shareId: "demo" }, { confirm: again.details.confirmationId });
  assert.equal(done.body.undone, "run-1");
  assert.ok(!ids(w).includes(newest));
  // Redo adds the note back: it removes nothing, so it is not held.
  const redone = await gate.directCall(agent, "slates.redo", { shareId: "demo" });
  assert.equal(redone.body.redone, "run-1");
  assert.ok(ids(w).includes(newest));
});

test("Keep all and a Discard at the same moment never undo each other: a stale write is read again; a line whose end is gone is refused, not left waiting", async () => {
  const collection = memoryCollection();
  // The first write waits at a gate: the discard has read the action and writes only after the Keep is done.
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  let gated = 0;
  const realUpdate = collection.updateOne.bind(collection);
  collection.updateOne = async (selector, update) => { if (gated++ === 0) await gate; return realUpdate(selector, update); };
  let n = 0;
  const store = createSuggestionStore({ collection, controls: memoryCollection(), identify: async () => ({ agentId: "ag" }), applyPlan: async () => ({ revision: 2 }), findName: async (id) => ({ ada: "Ada", ben: "Ben" })[id], newId: () => `s${++n}` });
  const note = (id) => ({ options: { id, text: id, xPos: 0, yPos: 0, width: 100, height: 60 }, relationships: { associations: [] } });
  await collection.insertOne({ _id: "act", slateId: "slate", agentId: "ag", label: "GitHub", createdAt: new Date(), items: [
    { id: "a", kind: "add", state: "pending", nodeId: "na", node: note("na") },
    { id: "b", kind: "add", state: "pending", nodeId: "nb", node: note("nb") },
    { id: "ab", kind: "link", state: "pending", parentId: "na", association: { id: "lab", parentId: "na", childId: "nb" } },
  ] });
  const slate = { _id: "slate", shareId: "demo", revision: 1, nodes: [] };
  const ben = store.discard(person("ben"), slate, { actionId: "act", itemIds: ["b"] });
  await new Promise((resolve) => setTimeout(resolve, 5));
  gated = 1; // the Keep writes straight through
  const kept = await store.keep(person("ada"), slate, { actionId: "act" }, async () => ({ revision: 2 }));
  assert.deepEqual(kept.kept.map((k) => k.itemId).sort(), ["a", "ab", "b"]);
  open();
  const discarded = await ben;
  assert.deepEqual(discarded.discarded, [], "Ben's discard came after the notes were kept: nothing to discard");
  const [after] = await collection.find({ _id: "act" }).toArray();
  assert.deepEqual(after.items.map((i) => [i.id, i.state]), [["a", "kept"], ["b", "kept"], ["ab", "kept"]], "nothing kept shows as waiting again");

  // A line between a note on the slate and one a person deleted since: Discard all reaches it, and a
  // Keep of the rest refuses it (it can never land) instead of leaving it waiting unseen.
  await collection.insertOne({ _id: "lines", slateId: "slate", agentId: "ag", label: "GitHub", createdAt: new Date(), items: [
    { id: "c", kind: "add", state: "pending", nodeId: "nc", node: note("nc") },
    { id: "cx", kind: "link", state: "pending", parentId: "nc", association: { id: "lcx", parentId: "nc", childId: "deleted" } },
  ] });
  const out = await store.keep(person("ada"), { ...slate, nodes: [note("na")] }, { actionId: "lines", itemIds: ["c"] }, async () => ({ revision: 3 }));
  assert.deepEqual(out.kept.map((k) => k.itemId), ["c"]);
  const [lines] = await collection.find({ _id: "lines" }).toArray();
  assert.deepEqual(lines.items.map((i) => [i.id, i.state, i.reason ?? null]), [["c", "kept", null], ["cx", "refused", "A note at its end is gone."]]);
});

test("a host's gate (deps.suggestionGate) decides first: Keep keeps only what it lets through and says what it held; discard tells it; undo leaves what it skips; retext changes a waiting note's words", async (t) => {
  const w = world();
  t.after(() => w.close());
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const out = await edit(w, agent, [add("A note"), add("An action card")]);
  const { actionId, items } = out.body.suggestion;
  const [note, card] = items;
  const seen = [];
  // As enterprise/server/outside.mjs answers: the card's item is held unless kept on its own.
  w.deps.suggestionGate = async (principal, slate, choice) => {
    seen.push([choice.decision, choice.itemIds || null]);
    if (choice.decision === "keep") return choice.itemIds ? { itemIds: choice.itemIds, held: [] } : { itemIds: [note.id], held: [{ itemId: card.id, reason: "Approve it on its own card." }] };
    if (choice.decision === "undo") return { skip: [card.id], left: [{ itemId: card.id, reason: "It stays done outside." }] };
    return null;
  };
  // a waiting note's words change for every screen (the host's card says it was done)
  // card marks the note as the host's action card: published, so every canvas draws Approve and Decline on it
  assert.equal(await w.deps.suggestions.retext(w.slate("demo"), { actionId, nodeId: card.nodeId, text: "Create issue", card: { id: "oCard1234", state: "waiting" } }), true);
  const marked = (await w.deps.suggestions.list(w.slate("demo")._id)).find((a) => a._id === actionId);
  assert.deepEqual(publicAction(marked).items.find((i) => i.id === card.id).card, { id: "oCard1234", state: "waiting" });
  assert.equal(publicAction(marked).items.find((i) => i.id === note.id).card, undefined, "a plain note carries no card");
  assert.equal(await w.deps.suggestions.retext(w.slate("demo"), { actionId, nodeId: card.nodeId, text: "Done · Create issue", link: "https://example.org/i/1" }), true);
  const all = await decide(w, person(), { decision: "keep", actionId });
  assert.deepEqual(all.body.kept.map((k) => k.itemId), [note.id]);
  assert.deepEqual(all.body.held, [{ itemId: card.id, reason: "Approve it on its own card." }]);
  assert.ok(!ids(w).includes(card.nodeId), "the held card still waits");
  // kept on its own, it lands with its new words and link
  await decide(w, person(), { decision: "keep", actionId, itemIds: [card.id] });
  const saved = w.slate("demo").nodes.find((node) => node.options.id === card.nodeId);
  assert.equal(saved.options.text, "Done · Create issue");
  assert.equal(saved.options.link?.data, "https://example.org/i/1");
  assert.equal(await w.deps.suggestions.retext(w.slate("demo"), { actionId, nodeId: card.nodeId, text: "late" }), false, "a kept note is not the host's to rewrite");
  // undo takes back the note, never the skipped card, and says why
  const undone = await decide(w, person(), { decision: "undo", actionId });
  assert.deepEqual(undone.body.undone, [note.id]);
  assert.deepEqual(undone.body.left.at(-1), { itemId: card.id, reason: "It stays done outside." });
  assert.ok(ids(w).includes(card.nodeId) && !ids(w).includes(note.nodeId));
  // an undo of only skipped items is nothing to do, not an error
  const again = await decide(w, person(), { decision: "undo", actionId });
  assert.deepEqual(again.body.undone, []);
  // a gate that lets nothing through keeps nothing
  const second = await edit(w, agent, [add("Another card")]);
  w.deps.suggestionGate = async (principal, slate, choice) => (choice.decision === "keep" ? { itemIds: [], held: [{ itemId: second.body.suggestion.items[0].id, reason: "Only Ada approves." }] } : null);
  const none = await decide(w, person(), { decision: "keep", actionId: second.body.suggestion.actionId });
  assert.deepEqual([none.body.kept, none.body.held[0].reason], [[], "Only Ada approves."]);
  await decide(w, person(), { decision: "discard", actionId: second.body.suggestion.actionId });
  assert.deepEqual(seen.map(([d]) => d), ["keep", "keep", "undo", "undo"]);
});

test("a host's gate on discard holds what it cannot decline (a change being made outside): the rest is discarded, held[] says why", async (t) => {
  const w = world();
  t.after(() => w.close());
  const agent = await w.principalFor(["slates:read", "slates:write"]);
  const out = await edit(w, agent, [add("A note"), add("A running card")]);
  const { actionId, items } = out.body.suggestion;
  const [note, card] = items;
  w.deps.suggestionGate = async (principal, slate, choice) => (choice.decision === "discard" ? { itemIds: [note.id], held: [{ itemId: card.id, reason: "It is being made right now and cannot be stopped." }] } : null);
  const all = await decide(w, person(), { decision: "discard", actionId });
  assert.deepEqual(all.body.discarded.map((d) => d.itemId ?? d), [note.id]);
  assert.deepEqual(all.body.held, [{ itemId: card.id, reason: "It is being made right now and cannot be stopped." }]);
  // nothing let through: nothing discarded
  w.deps.suggestionGate = async () => ({ itemIds: [], held: [{ itemId: card.id, reason: "Still running." }] });
  const none = await decide(w, person(), { decision: "discard", actionId, itemIds: [card.id] });
  assert.deepEqual([none.body.discarded, none.body.held[0].reason], [[], "Still running."]);
  // the held card can still be decided later (it was never discarded)
  w.deps.suggestionGate = null;
  const later = await decide(w, person(), { decision: "discard", actionId, itemIds: [card.id] });
  assert.deepEqual(later.body.discarded.map((d) => d.itemId ?? d), [card.id]);
});
