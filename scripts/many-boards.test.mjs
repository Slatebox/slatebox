// Many boards on one slate (boards S4a, work-multiboard plan §2.4): the first board stays where it
// always was (creative) as board "main"; each further board is boards.<id>, with its own revision.
// Exec names the board (boardId); a slate of several boards and a call that names none is refused with
// the boards (400 board_required), so a call never changes the first board by accident.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { makeExecWorld } from "./exec-test-world.mjs";
import "slateboxjs/workshops/behaviour";
import { BOARD_GAP, MAIN_BOARD, besideBoards, boardPaths, boardRecords, boardSaveWrite, boardsCounter, boardsCounterRecordId, chooseBoard, counterWrite, furtherBoardSet, nextBoardId, slateAsBoard, slateBoards } from "../web/app/imports/api/common/slate-boards.mjs";
import { componentPlacing } from "../web/app/imports/api/common/component-add.mjs";
import { slatePreview } from "../web/app/imports/api/common/slate-preview.mjs";
import { nativeCanvasDraft } from "../web/app/imports/api/common/native-canvas-conversation.mjs";
import { boardRoom } from "../web/app/server/board-room.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(13, "0").slice(-12)}`;
const lanes = (title, ids = ["todo", "done"]) => ({ version: 1, title, lanes: ids.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
  cards: [{ id: "card-1", label: "First", laneId: ids[0] }] });
const model = (workshop) => ({ version: 1, kind: "workshop", workshop });
const twoBoards = () => ({
  _id: "slate-2", shareId: "two", userId: "owner", lastSaved: 1000, revision: 9, nativeConversationRevision: 4, nativeCanvasDrawing: true,
  options: { name: "Two", isPrivate: true, workshopOrigin: { x: 40, y: 40 } }, nodes: [],
  creative: { revision: 5, model: model(lanes("Retro")) },
  boards: { b2: { revision: 2, model: model(lanes("Sprint", ["todo", "doing", "done"])), origin: { x: 1420, y: 40 }, createdAt: 1 } },
  boardSeq: 2, boardsRevision: 7,
});

async function world(t, slate = twoBoards()) {
  const w = makeExecWorld();
  t.after(() => w.close());
  w.slates.push(slate);
  const principal = await w.principalFor(["slates:read", "slates:write"]);
  const gate = w.exec.gate;
  const context = () => gate.newContext({ execId: uuid(), principal, surface: "api", codeSha256: sha("code"), intent: "test" });
  return { w, principal, gate, context };
}

test("a slate's boards: the first is main (creative), the rest boards.<id> in the order they were added", () => {
  const slate = twoBoards();
  assert.deepEqual(slateBoards(slate).map((board) => [board.id, board.model.workshop.title, board.revision, board.origin]),
    [["main", "Retro", 5, { x: 40, y: 40 }], ["b2", "Sprint", 2, { x: 1420, y: 40 }]]);
  assert.deepEqual(slateBoards({ nodes: [] }), []);
  // The slate as one board sees it: a reader written for one board reads any of them.
  const b2 = slateAsBoard(slate, "b2");
  assert.equal(b2.creative.model.workshop.title, "Sprint");
  assert.equal(b2.creative.revision, 2);
  assert.deepEqual(b2.options.workshopOrigin, { x: 1420, y: 40 });
  assert.equal(slateAsBoard(slate, "b9"), null);
  assert.deepEqual(boardPaths("b2"), { root: "boards.b2", model: "boards.b2.model", workshop: "boards.b2.model.workshop", kind: "boards.b2.model.kind",
    revision: "boards.b2.revision", trades: "boards.b2.trades", undo: "boards.b2.undo", origin: "boards.b2.origin" });
  assert.equal(boardPaths(MAIN_BOARD).revision, "creative.revision");
  assert.throws(() => boardPaths("B 2"), /lowercase/);
});

test("which board a call means: the one it names, the only one, or a refusal that lists them", () => {
  const slate = twoBoards();
  assert.equal(chooseBoard(slate, "b2").id, "b2");
  assert.equal(chooseBoard(slate, "main").id, "main");
  assert.throws(() => chooseBoard(slate), (error) => error.code === "board_required" && error.boards.length === 2 &&
    error.message === "This slate holds 2 boards: name the one to change (boardId): main (Retro), b2 (Sprint).");
  assert.throws(() => chooseBoard(slate, "b7"), (error) => error.code === "board_not_found");
  const one = { creative: { revision: 0, model: model(lanes("Only")) }, options: {} };
  assert.equal(chooseBoard(one).id, "main", "a slate of one board needs no boardId");
});

test("ids come from a counter that is never used twice, and the slate's counter for all boards goes up with every board", () => {
  assert.equal(nextBoardId({ creative: { revision: 0, model: model(lanes("A")) } }), "b2");
  assert.equal(nextBoardId(twoBoards()), "b3");
  // A board deleted later never gives its id back: the counter says 5 though only b2 is left.
  assert.equal(nextBoardId({ ...twoBoards(), boardSeq: 5 }), "b6");
  const set = furtherBoardSet(twoBoards(), "b3", lanes("Third"), { x: 9, y: 8 }, 77);
  assert.deepEqual(set, { "boards.b3": { revision: 0, model: model(lanes("Third")), origin: { x: 9, y: 8 }, createdAt: 77 }, boardSeq: 3, boardsRevision: 8 });
  // A slate of one board keeps no such counter: its board's revision is it, as it always was.
  const one = { creative: { revision: 4, model: model(lanes("A")) } };
  assert.equal(boardsCounter(one), 4);
  assert.deepEqual(counterWrite(one), { set: {}, conditions: {}, next: null });
  assert.deepEqual(counterWrite(twoBoards()), { set: { boardsRevision: 8 }, conditions: { boardsRevision: 7 }, next: 8 });
});

test("a new board goes 160 past every note and every board's room, on the first board's row", () => {
  const slate = { ...twoBoards(), nodes: [{ options: { id: "far", xPos: 4000, yPos: 600, width: 100, height: 50 } }] };
  const placed = componentPlacing(slate, lanes("Third"));
  assert.equal(placed.boardId, "b3");
  assert.deepEqual(placed.origin, { x: 4100 + BOARD_GAP, y: 40 });
  const clear = componentPlacing(twoBoards(), lanes("Third"));
  // Sprint's room: five lanes (1220) from 1420.
  assert.deepEqual(clear.origin, { x: 1420 + 1220 + BOARD_GAP, y: 40 });
  // A launch plan keeps its kit's desktop width (1200): a board after it starts past that.
  assert.equal(boardRoom({ ...lanes("x"), title: "Launch" }).width, 1220);
  assert.deepEqual(besideBoards([], [{ x: 0, y: 10, width: 1200, height: 300 }]), { x: 1360, y: 10 });
});

test("a slate made by slates.create (its first board's place never stored) takes a further board 160 past the first board's room", async (t) => {
  // slates.create and creativeSlates.create store the first board with no options.workshopOrigin: the page draws it
  // where workshopOrigin says (beside the notes, or at 40,40 on an empty slate), so that is where it is.
  const made = { _id: "slate-7", shareId: "made", userId: "owner", lastSaved: 1000, revision: 1, options: { name: "Made", isPrivate: true }, nodes: [],
    creative: { revision: 0, model: model(lanes("Map")) } };
  assert.deepEqual(slateBoards(made)[0].origin, { x: 40, y: 40 });
  assert.deepEqual(besideBoards([], []), { x: 40, y: 40 }, "nothing to be beside: a finite place");
  const mainRoom = boardRoom(made.creative.model.workshop).width;
  const placed = componentPlacing(made, lanes("Retro"));
  assert.deepEqual(placed.origin, { x: 40 + mainRoom + BOARD_GAP, y: 40 });
  assert.deepEqual(placed.set["options.workshopOrigin"], { x: 40, y: 40 }, "the first board's place is stored in the same write");
  // With notes, the first board sits 80 past them (as the page draws it), and the new board past its room, not over it.
  const noted = { ...made, nodes: [{ options: { id: "n", xPos: 100, yPos: 200, width: 300, height: 80 } }] };
  assert.deepEqual(componentPlacing(noted, lanes("Retro")).origin, { x: 480 + mainRoom + BOARD_GAP, y: 200 });
  // A stored place is kept, and not written again.
  assert.equal(componentPlacing(twoBoards(), lanes("Third")).set["options.workshopOrigin"], undefined);
  // Through exec: add_component answers a finite place and stores it, and the first board's place with it.
  const { w, principal } = await world(t, made);
  const out = await w.registry.run(principal, "slates.applyOperations", { shareId: "made", plan: { message: "Add a retro",
    operations: [{ kind: "add_component", component: "retro", expectedRevision: 1 }] } }, { idempotencyKey: "made-1" });
  assert.equal(out.status, 201, JSON.stringify(out.body));
  assert.deepEqual(out.body.report.origin, { x: 40 + mainRoom + BOARD_GAP, y: 40 });
  const stored = w.slate("made");
  assert.deepEqual(stored.boards.b2.origin, { x: 40 + mainRoom + BOARD_GAP, y: 40 });
  assert.deepEqual(stored.options.workshopOrigin, { x: 40, y: 40 });
});

test("notes asked for in the chat go below every board, not only the first", () => {
  const slate = { ...twoBoards(), creative: { revision: 5, model: model({ ...lanes("Retro"), cards: Array.from({ length: 1 }, (_, i) => ({ id: "c" + i, label: "C", laneId: "todo" })) }) } };
  // Sprint holds many cards and is taller than Retro.
  slate.boards.b2.model.workshop.cards = Array.from({ length: 8 }, (_, i) => ({ id: "s" + i, label: "Sprint card " + i, laneId: "todo" }));
  const draft = nativeCanvasDraft(slate, "Add notes: Alpha, Beta", "abcdefghijklmnopq");
  const sprintBottom = 40 + slatePreview(slate).nodes.filter((node) => node.options.id.startsWith("b2:")).reduce((max, node) => Math.max(max, node.options.yPos + node.options.height - 40), 0);
  for (const node of draft.nodes) assert.ok(node.options.yPos >= sprintBottom, node.options.yPos + " below " + sprintBottom);
});

test("a slate's card draws every board, each further board's notes named in its scope", () => {
  const preview = slatePreview(twoBoards());
  const ids = preview.nodes.map((node) => node.options.id);
  assert.ok(ids.includes("lane-todo") && ids.includes("b2:lane-todo") && ids.includes("b2:lane-doing"));
  assert.ok(ids.includes("card-card-1") && ids.includes("b2:card-card-1"), "the same card id on two boards draws as two notes");
  assert.equal(preview.nodes.find((node) => node.options.id === "b2:lane-todo").options.xPos >= 1420, true);
});

test("exec: a workshop edit names its board; one that names none on a slate of several is refused with the boards", async (t) => {
  const { w, principal } = await world(t);
  const run = (op, key) => w.registry.run(principal, "slates.applyOperations", { shareId: "two", plan: { message: "Add a lane", operations: [op] } }, key ? { idempotencyKey: key } : {});
  await assert.rejects(run({ kind: "workshop_edits", edits: [{ kind: "add_lane", label: "Blocked" }], expectedRevision: 2 }, "k1"), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.code, "board_required");
    assert.deepEqual(error.details.boards, [{ id: "main", title: "Retro", kind: "lanes" }, { id: "b2", title: "Sprint", kind: "lanes" }]);
    return true;
  });
  assert.equal(w.slate("two").revision, 9, "nothing was saved");
  const out = await run({ kind: "workshop_edits", boardId: "b2", edits: [{ kind: "add_lane", label: "Blocked" }], expectedRevision: 2 }, "k2");
  assert.equal(out.status, 201, JSON.stringify(out.body));
  assert.equal(out.body.boardId, "b2");
  const slate = w.slate("two");
  assert.deepEqual(slate.boards.b2.model.workshop.lanes.map((lane) => lane.label), ["Todo", "Doing", "Done", "Blocked"]);
  assert.equal(slate.boards.b2.revision, 3, "the board's own revision");
  // The other board is untouched, its revision too: a preview waiting on Retro is still current.
  assert.equal(slate.creative.revision, 5);
  assert.deepEqual(slate.creative.model.workshop.lanes.map((lane) => lane.label), ["Todo", "Done"]);
  // The slate's counter for all its boards goes up in the same write, as a person's change does: the canvas's autosave is fenced on it.
  assert.equal(slate.boardsRevision, 8, "an exec edit on b2 raises the slate's counter for all boards");
  // An edit on the first board names it, or its old revision is stale.
  const main = await run({ kind: "move_workshop_card", boardId: "main", cardId: "card-1", laneId: "done", expectedRevision: 5 }, "k3");
  assert.equal(main.status, 201, JSON.stringify(main.body));
  assert.equal(w.slate("two").creative.model.workshop.cards[0].laneId, "done");
  assert.equal(w.slate("two").boards.b2.model.workshop.cards[0].laneId, "todo", "card-1 on Sprint never moves with card-1 on Retro");
  assert.equal(w.slate("two").boardsRevision, 9, "and an exec edit on the first board raises it too");
  assert.deepEqual(main.body.report.targets, ["card-card-1"]);
  const stale = run({ kind: "move_workshop_card", boardId: "b2", cardId: "card-1", laneId: "doing", expectedRevision: 2 }, "k4");
  await assert.rejects(stale, (error) => error.code === "slate_changed" && error.details.revision === 3);
  const unknown = run({ kind: "move_workshop_card", boardId: "b8", cardId: "card-1", laneId: "doing", expectedRevision: 2 }, "k5");
  await assert.rejects(unknown, (error) => error.code === "board_not_found");
});

test("exec: a move on a further board points the agent at that board's notes, and an undo stays on its board", async (t) => {
  const { w, principal } = await world(t);
  const run = (op, key) => w.registry.run(principal, "slates.applyOperations", { shareId: "two", plan: { message: "Move", operations: [op] } }, { idempotencyKey: key });
  const moved = await run({ kind: "move_workshop_card", boardId: "b2", cardId: "card-1", laneId: "doing", expectedRevision: 2 }, "m1");
  assert.deepEqual(moved.body.report.targets, ["b2:card-card-1"]);
  // A receipt made on Sprint can't undo on Retro.
  await assert.rejects(run({ kind: "undo_workshop_edit", boardId: "main", receiptId: moved.body.receiptId, expectedRevision: 5 }, "m2"), (error) => error.code === "not_found");
  const undone = await run({ kind: "undo_workshop_edit", boardId: "b2", receiptId: moved.body.receiptId, expectedRevision: 3 }, "m3");
  assert.equal(undone.status, 201, JSON.stringify(undone.body));
  assert.equal(w.slate("two").boards.b2.model.workshop.cards[0].laneId, "todo");
});

test("exec: a slate of one board takes calls that never name a board, as before", async (t) => {
  const one = { ...twoBoards(), boards: undefined, boardSeq: undefined, boardsRevision: undefined };
  const { w, principal } = await world(t, one);
  const out = await w.registry.run(principal, "slates.applyOperations", { shareId: "two", plan: { message: "Move", operations: [
    { kind: "move_workshop_card", cardId: "card-1", laneId: "done", expectedRevision: 5 }] } }, { idempotencyKey: "one-1" });
  assert.equal(out.status, 201);
  assert.equal(out.body.boardId, undefined);
  assert.equal(w.slate("two").creative.revision, 6);
});

test("slates.get lists every board; check_move and components.list read the slate's boards", async (t) => {
  const { gate, context } = await world(t);
  const read = await gate.call(context(), { seq: 1, method: "slates.get", input: { shareId: "two" } });
  assert.equal(read.ok, true, JSON.stringify(read.error));
  assert.deepEqual(read.value.boards.map((board) => [board.id, board.title, board.revision, board.origin]),
    [["main", "Retro", 5, { x: 40, y: 40 }], ["b2", "Sprint", 2, { x: 1420, y: 40 }]]);
  assert.deepEqual(read.value.boards[1].lanes.map((lane) => lane.id), ["todo", "doing", "done"]);
  assert.equal(read.value.workshop.title, "Retro", "workshop stays the first board");
  assert.ok(read.value.nodes.some((node) => node.id === "b2:lane-doing"), "the slate's notes include each board's, in its scope");
  const unnamed = await gate.call(context(), { seq: 2, method: "slates.checkMove", input: { shareId: "two", card: "First", lane: "Done" } });
  assert.equal(unnamed.ok, false);
  assert.equal(unnamed.error.code, "board_required");
  const named = await gate.call(context(), { seq: 3, method: "slates.checkMove", input: { shareId: "two", boardId: "b2", card: "First", lane: "Doing" } });
  assert.equal(named.ok, true, JSON.stringify(named.error));
  assert.equal(named.value.revision, 2);
  const list = await gate.call(context(), { seq: 4, method: "components.list", input: { shareId: "two" } });
  assert.deepEqual(list.value.components.find((entry) => entry.id === "retro").fits, { ok: true });
});

// Plan §3 S4a: "a pending preview on Retro survives a card move on Sprint". A play on Sprint (b2) is stored
// with the write creativeSlates.play makes (boardSaveWrite); then Retro's Keep (creativeSlates.save on the
// revision its preview was made on) and its "Undo last change" are still current.
test("a pending preview on Retro survives a card move on Sprint: the write touches Sprint and the slate's counter only", () => {
  const get = (doc, path) => path.split(".").reduce((at, key) => at?.[key], doc);
  const apply = (doc, { conditions, set, inc }) => {
    for (const [path, want] of Object.entries(conditions)) if ((get(doc, path) ?? null) !== want) return false;
    const put = (path, value) => { const keys = path.split("."); const last = keys.pop(); let at = doc; for (const key of keys) at = at[key] ??= {}; at[last] = value; };
    for (const [path, value] of Object.entries(set)) put(path, value);
    for (const [path, by] of Object.entries(inc)) put(path, (get(doc, path) ?? 0) + by);
    return true;
  };
  const doc = twoBoards();
  // Retro has an Undo recorded for this person's last change, at its revision.
  doc.creative.undo = { revision: 5, userId: "owner", previous: lanes("Retro before") };
  const retroUndo = structuredClone(doc.creative.undo);
  // The page previews a change on Retro on Retro's revision (5).
  const previewedOn = slateAsBoard(doc, MAIN_BOARD).creative.revision;
  // A teammate moves a card on Sprint (b2): Sprint's revision and the slate's counter go up in one write.
  const sprint = slateAsBoard(doc, "b2");
  const moved = { ...sprint.creative.model.workshop, cards: [{ id: "card-1", label: "First", laneId: "doing" }] };
  const play = boardSaveWrite(sprint, doc, { model: model(moved), revision: sprint.creative.revision, undo: { revision: 3, userId: "mate", previous: sprint.creative.model.workshop } });
  assert.ok(Object.keys({ ...play.set, ...play.inc }).every((path) => path.startsWith("boards.b2.") || path === "boardsRevision"), JSON.stringify(Object.keys(play.set)));
  assert.equal(apply(doc, play), true);
  assert.equal(doc.boards.b2.revision, 3);
  assert.equal(doc.boardsRevision, 8);
  // Retro is as it was: its revision, its model and its Undo, so its preview is still current and Undo still offered.
  assert.equal(doc.creative.revision, previewedOn);
  assert.deepEqual(doc.creative.undo, retroUndo);
  assert.equal(doc.creative.undo.revision, doc.creative.revision);
  // Keep: the preview saves on the revision it was made on, after the Sprint move.
  const retro = slateAsBoard(doc, MAIN_BOARD);
  const keep = boardSaveWrite(retro, doc, { model: model(lanes("Retro kept")), revision: previewedOn });
  assert.equal(apply(doc, keep), true);
  assert.equal(doc.creative.revision, 6);
  assert.equal(doc.creative.model.workshop.title, "Retro kept");
  assert.equal(doc.boardsRevision, 9);
  // A write made on the counter before the Sprint move is fenced: a stale page can't overwrite it.
  assert.equal(apply(doc, boardSaveWrite(slateAsBoard(twoBoards(), "b2"), twoBoards(), { model: model(moved), revision: 2 })), false);
});

// The live records (S4a review): the slate's counter for all its boards is a record of its own, so a change
// to one board changes that board's record and the counter, never every board's record.
test("a card move on Sprint changes Sprint's live record and the counter record, not Retro's", () => {
  const records = (slate) => new Map(boardRecords({ slateBase: slate, canEdit: true, canJoin: true }, "two").map(([id, fields]) => [id, JSON.stringify(fields)]));
  const before = records(twoBoards());
  assert.deepEqual([...before.keys()], ["two", "two:b2", "two#through"]);
  assert.equal(JSON.parse(before.get("two#through")).through, 7);
  const after = twoBoards();
  after.boards.b2 = { ...after.boards.b2, revision: 3 };
  after.boardsRevision = 8;
  const now = records(after);
  assert.equal(now.get("two"), before.get("two"));
  assert.notEqual(now.get("two:b2"), before.get("two:b2"));
  assert.equal(JSON.parse(now.get("two#through")).through, 8);
  assert.equal(boardsCounterRecordId("two"), "two#through");
  // No board's record carries the counter.
  for (const [id, fields] of now) if (id !== "two#through") assert.equal(JSON.parse(fields).through, undefined);
});

// S4a review: a copy of a slate of several boards starts every board over, as it does the first.
test("a copy of a slate of several boards starts each board's revision over, without the source's Undo or trades", async () => {
  const { copyDocument } = await import("../web/app/server/actions/slate-copy.mjs");
  const source = twoBoards();
  source.boards.b2.undo = { revision: 2, userId: "owner", previous: lanes("Sprint before") };
  source.boards.b2.trades = { "note-1": { as: "card", revision: 7 } };
  const copy = copyDocument(source, { id: "copy-1", shareId: "copy", user: { _id: "someone" }, now: 2000 });
  assert.equal(copy.creative.revision, 0);
  assert.equal(copy.boards.b2.revision, 0);
  assert.equal(copy.boards.b2.undo, undefined);
  assert.equal(copy.boards.b2.trades, undefined);
  assert.equal(copy.boardsRevision, 0);
  // The ids given out stay given out, and the board itself is copied whole.
  assert.equal(copy.boardSeq, 2);
  assert.equal(copy.boards.b2.model.workshop.title, "Sprint");
  assert.deepEqual(copy.boards.b2.origin, { x: 1420, y: 40 });
  // The source is untouched.
  assert.equal(source.boards.b2.revision, 2);
  assert.ok(source.boards.b2.undo);
});
