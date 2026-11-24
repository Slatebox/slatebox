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
  // The agent cannot keep its own suggestions.
  await assert.rejects(decide(w, agent, { decision: "keep", actionId }), { status: 403, code: "own_suggestion" });
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
  const set = await w.registry.run(person(), "agents.control", { shareId: "demo", agentId, editing: "direct" });
  assert.deepEqual(set.body.modes, { [agentId]: "direct" });
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
  assert.equal(ownTry.error?.code, "own_suggestion", JSON.stringify(ownTry));
  // Another agent of the same person keeps one once the person agrees, and discards the other at once.
  const other = await w.principalFor(["slates:read", "slates:write"]);
  const keep = own.replace(first, first);
  const held = await w.exec.service.run({ principal: other, intent: "Keep", code: keep });
  assert.deepEqual([held.status, held.confirmation.reasons[0].rule], ["confirmation_required", "removes"]);
  const kept = await w.exec.service.run({ principal: other, intent: "Keep", code: keep, confirm: held.confirmation.id, idempotencyKey: held.idempotencyKey });
  assert.equal(kept.status, "completed", JSON.stringify(kept.error ?? kept));
  assert.equal(kept.result.kept.length, 1);
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
  const canvas = await readFile(new URL("../web/app/imports/ui/pages/Canvas.jsx", import.meta.url), "utf8");
  assert.match(canvas, /<AgentPresenceListener slate=\{slate\.current\} canEdit=\{!accessLevel\.current\.isReadOnly && !accessLevel\.current\.isCommentOnly\} \/>/);
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
