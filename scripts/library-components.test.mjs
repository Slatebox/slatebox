// add_component (library final.md §2.8, phase 2): exec and agents add any library component to a
// slate through the same door as the chat's Keep. The board sits beside the slate's notes, covering
// none; a slate that has a board answers with the honest sentence; open pages hear it (the slate's
// conversation revision moves, with the board's place).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { makeExecWorld } from "./exec-test-world.mjs";
import "slateboxjs/workshops/behaviour";
import { workshopLanePlaces } from "slateboxjs/workshops/model";
import { catalog } from "slateboxjs/catalog";
import { componentAddition, componentPlace, noteFrames, overlapsAny, readComponentRequest } from "../web/app/imports/api/common/component-add.mjs";
import { catalogSamples as samples } from "slateboxjs/workshops/samples";

const sha = (text) => createHash("sha256").update(text).digest("hex");
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const note = (id, x, y, width = 160, height = 80) => ({ options: { id, text: id, xPos: x, yPos: y, width, height }, relationships: { associations: [] } });

async function setup(t, slate = {}) {
  const world = makeExecWorld();
  t.after(() => world.close());
  world.slates.push({
    _id: "slate-9", shareId: "plain", userId: "owner", lastSaved: 1000, revision: 4, nativeConversationRevision: 2,
    options: { name: "Plain", isPrivate: true },
    nodes: [note("welcome", 100, 100), note("far", 900, -200, 300, 120), note("low", 40, 700)],
    ...slate,
  });
  const principal = await world.principalFor(["slates:read", "slates:write"]);
  const gate = world.exec.gate;
  const context = () => gate.newContext({ execId: uuid(), principal, surface: "api", codeSha256: sha("code"), intent: "test" });
  const add = (ctx, seq, op, mode) => gate.call(ctx, { seq, method: "slates.applyOperations",
    input: { shareId: "plain", ...(mode && { mode }), plan: { message: "Add it", operations: [{ kind: "add_component", expectedRevision: world.slate("plain").revision ?? 0, ...op }] } } });
  return { world, gate, context, add };
}

test("the board sits past the right of every note, level with the top: it covers none", () => {
  const nodes = [note("a", 100, 100), note("b", 900, -200, 300, 120), note("c", 40, 700)];
  const origin = componentPlace(nodes);
  assert.deepEqual(origin, { x: 1280, y: -200 });
  for (const entry of catalog) {
    const { workshop } = componentAddition({ nodes }, { component: entry.id }, samples);
    const { width, height } = workshopLanePlaces(workshop);
    assert.equal(overlapsAny({ ...origin, width, height }, noteFrames(nodes)), false, entry.id);
  }
  assert.deepEqual(componentPlace([]), { x: 40, y: 40 });
  // A note without a place is not counted; a stray value never makes the place NaN.
  assert.deepEqual(componentPlace([{ options: { id: "x" } }, note("a", 0, 0, "wide", 10)]), { x: 80, y: 0 });
});

test("a component request is a library id and an optional plain topic", () => {
  assert.deepEqual(readComponentRequest({ component: "retro", topic: "  Q3   launch " }), { component: "retro", topic: "Q3 launch" });
  assert.throws(() => readComponentRequest({ component: "listening-room" }), /nothing called listening-room/);
  assert.throws(() => readComponentRequest({ component: "retro", topic: "<b>x</b>" }), /plain text/);
  assert.throws(() => readComponentRequest({ component: "retro", topic: "x".repeat(101) }), /100 characters/);
});

test("add_component preview shows the board and its place, and saves nothing", async (t) => {
  const { world, context, add } = await setup(t);
  const out = await add(context(), 1, { component: "retro", topic: "Q3 launch" }, "preview");
  assert.equal(out.ok, true, JSON.stringify(out.error));
  assert.equal(out.value.mode, "preview");
  assert.equal(out.value.workshop.title, "Retro: Q3 launch");
  assert.deepEqual(out.value.report.origin, { x: 1280, y: -200 });
  assert.deepEqual(out.value.report.rules, ["Went well holds 3.", "Change holds 3.", "Try holds 3."]);
  assert.equal(world.slate("plain").creative, undefined);
  assert.equal(world.slate("plain").revision, 4);
});

test("add_component saves the board beside the notes, and moves the conversation revision so open pages draw it", async (t) => {
  const { world, context, add } = await setup(t);
  const out = await add(context(), 1, { component: "team-board" });
  assert.equal(out.ok, true, JSON.stringify(out.error));
  const slate = world.slate("plain");
  assert.equal(slate.creative.model.kind, "workshop");
  assert.equal(slate.creative.revision, 0);
  assert.equal(slate.creative.model.workshop.title, "Team board");
  assert.equal(slate.creative.model.workshop.behaviour.rules.length, 3);
  assert.deepEqual(slate.options.workshopOrigin, { x: 1280, y: -200 });
  assert.equal(slate.nativeCanvasDrawing, true);
  assert.equal(slate.nativeConversationRevision, 3);
  assert.equal(slate.revision, 5);
  assert.equal(slate.nodes.length, 3, "no note is touched");
  const { width, height } = workshopLanePlaces(slate.creative.model.workshop);
  assert.equal(overlapsAny({ ...slate.options.workshopOrigin, width, height }, noteFrames(slate.nodes)), false);
  assert.deepEqual(out.value.report.targets, ["lane-todo", "lane-doing", "lane-review", "lane-done", "lane-wont"]);
});

test("every library component can be added to an empty slate", async (t) => {
  for (const entry of catalog) {
    const { world, context, add } = await setup(t, { nodes: [] });
    const out = await add(context(), 1, { component: entry.id });
    assert.equal(out.ok, true, entry.id + " " + JSON.stringify(out.error));
    assert.deepEqual(world.slate("plain").options.workshopOrigin, { x: 40, y: 40 });
    if (entry.build.sample) assert.equal(world.slate("plain").creative.model.workshop.kind, entry.build.kind);
  }
});

// Many boards on a slate (boards S4a): the second add succeeds, beside the first board's room.
test("a slate that has a board takes a second one, 160 right of the first board's room, as board b2", async (t) => {
  const board = { version: 1, title: "Lanes", lanes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], cards: [] };
  const { world, context, add } = await setup(t, { creative: { revision: 3, model: { version: 1, kind: "workshop", workshop: board } },
    options: { name: "Plain", isPrivate: true, workshopOrigin: { x: 1280, y: -200 } } });
  const out = await add(context(), 1, { component: "retro" });
  assert.equal(out.ok, true, JSON.stringify(out.error));
  assert.equal(out.value.boardId, "b2");
  const slate = world.slate("plain");
  assert.equal(slate.creative.model.workshop.title, "Lanes", "the first board is untouched");
  assert.equal(slate.creative.revision, 3);
  assert.equal(slate.boards.b2.model.workshop.title, "Retro");
  assert.equal(slate.boards.b2.revision, 0);
  assert.equal(slate.boardSeq, 2);
  // A board of lanes keeps five lanes' room (5 × 244 = 1220): the second starts 160 past it, on its row.
  assert.deepEqual(slate.boards.b2.origin, { x: 1280 + 1220 + 160, y: -200 });
  assert.deepEqual(out.value.report.origin, slate.boards.b2.origin);
  assert.deepEqual(out.value.report.targets, ["b2:lane-well", "b2:lane-change", "b2:lane-try"]);
  assert.equal(slate.nativeConversationRevision, 3, "open pages hear of the new board");
  assert.equal(slate.nodes.length, 3, "no note is touched");
});

test("two adds made on the same read get b2 and b3, side by side, never one place or one id", async (t) => {
  const board = { version: 1, title: "Lanes", lanes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], cards: [] };
  const { world, context, add } = await setup(t, { nodes: [], creative: { revision: 0, model: { version: 1, kind: "workshop", workshop: board } },
    options: { name: "Plain", isPrivate: true, workshopOrigin: { x: 40, y: 40 } } });
  const revision = world.slate("plain").revision;
  const [a, b] = await Promise.all([add(context(), 1, { component: "retro", expectedRevision: revision }), add(context(), 1, { component: "triage", expectedRevision: revision })]);
  // The second to write is built again on the first: its expectedRevision no longer holds, so it is told to read again.
  const saved = [a, b].filter((out) => out.ok);
  assert.ok(saved.length >= 1);
  for (const out of [a, b].filter((item) => !item.ok)) assert.equal(out.error.code, "slate_changed");
  const again = await add(context(), 2, { component: "triage" });
  assert.equal(again.ok, true, JSON.stringify(again.error));
  const slate = world.slate("plain");
  assert.deepEqual(Object.keys(slate.boards).sort(), ["b2", "b3"]);
  assert.equal(slate.boardSeq, 3);
  assert.equal(slate.boards.b3.origin.x, slate.boards.b2.origin.x + 1220 + 160);
  assert.equal(slate.boards.b3.origin.y, 40);
});

test("a slate holding 8 boards says so, and nothing changes", async (t) => {
  const board = (title) => ({ version: 1, title, lanes: [{ id: "a", label: "A" }], cards: [] });
  const boards = Object.fromEntries([2, 3, 4, 5, 6, 7, 8].map((n) => ["b" + n, { revision: 0, model: { version: 1, kind: "workshop", workshop: board("B" + n) }, origin: { x: n * 2000, y: 0 } }]));
  const { world, context, add } = await setup(t, { creative: { revision: 0, model: { version: 1, kind: "workshop", workshop: board("Main") } }, boards, boardSeq: 8 });
  const out = await add(context(), 1, { component: "retro" });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, "component_opens_new_slate");
  assert.equal(out.error.message, "This slate holds 8 boards, the most for now. Add it on a new slate?");
  assert.equal(Object.keys(world.slate("plain").boards).length, 7);
});

test("an unknown component, a stale revision and a missing revision are refused", async (t) => {
  const { world, context, add, gate } = await setup(t);
  const unknown = await add(context(), 1, { component: "listening-room" });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error.code, /invalid/);
  const stale = await add(context(), 2, { component: "retro", expectedRevision: 1 });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "slate_changed");
  const missing = await gate.call(context(), { seq: 3, method: "slates.applyOperations",
    input: { shareId: "plain", plan: { message: "Add", operations: [{ kind: "add_component", component: "retro" }] } } });
  assert.equal(missing.ok, false);
  assert.equal(world.slate("plain").creative, undefined);
});

test("a saved add_component replays from its key instead of adding twice", async (t) => {
  const world = makeExecWorld();
  t.after(() => world.close());
  world.slates.push({ _id: "slate-9", shareId: "plain", userId: "owner", lastSaved: 1000, revision: 1, options: { name: "Plain", isPrivate: true }, nodes: [] });
  const principal = await world.principalFor(["slates:read", "slates:write"]);
  const run = () => world.registry.run(principal, "slates.applyOperations", {
    shareId: "plain", plan: { message: "Add", operations: [{ kind: "add_component", component: "triage", expectedRevision: 1 }] } }, { idempotencyKey: "add-triage-1" });
  const first = await run();
  assert.equal(first.status, 201);
  assert.equal(world.slate("plain").revision, 2);
  const again = await run();
  assert.equal(again.status, 200);
  assert.equal(again.meta.replayed, true);
  assert.deepEqual(again.body.report, first.body.report);
  assert.equal(world.slate("plain").revision, 2, "the second call did not save again");
  // Without a key a save is refused: an add is never made twice by a retry.
  await assert.rejects(world.registry.run(principal, "slates.applyOperations", {
    shareId: "plain", plan: { message: "Add", operations: [{ kind: "add_component", component: "retro", expectedRevision: 2 }] } }), /component_opens_new_slate|Idempotency-Key|board/);
});
