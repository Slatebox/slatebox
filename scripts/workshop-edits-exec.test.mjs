// workshop_edits and undo_workshop_edit through the exec gate: the edits people make, held as
// people's removals are, refused with the sentence a person sees, and undone with the rule a
// person's "Undo last change" keeps.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { makeExecWorld } from "./exec-test-world.mjs";
import { EXEC_LIMITS } from "../web/app/server/exec/limits.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const lanes = () => ({
  version: 1,
  title: "Launch week",
  lanes: [{ id: "now", label: "Now", capacity: 2 }, { id: "next", label: "Next" }, { id: "later", label: "Later" }],
  cards: [{ id: "a", label: "Alpha", laneId: "now" }, { id: "b", label: "Beta", laneId: "now" }, { id: "c", label: "Gamma", laneId: "next" }],
});

async function setup(t, options) {
  const world = makeExecWorld(options);
  t.after(() => world.close());
  world.slates.push({
    _id: "slate-6", shareId: "board", userId: "owner", lastSaved: 1000, options: { name: "Board", isPrivate: true }, nodes: [],
    creative: { revision: 1, model: { version: 1, kind: "workshop", workshop: lanes() } },
  });
  const principal = await world.principalFor(["slates:read", "slates:write"]);
  const gate = world.exec.gate;
  const context = (extra = {}) => gate.newContext({ execId: uuid(), principal, surface: "api", codeSha256: sha("code"), intent: "test", ...extra });
  const board = () => world.slate("board").creative.model.workshop;
  const revision = () => world.slate("board").creative.revision;
  const edits = (list, message = "Edit the board") => ({
    shareId: "board",
    plan: { message, operations: [{ kind: "workshop_edits", edits: list, expectedRevision: revision() }] },
  });
  return { world, principal, gate, context, board, revision, edits };
}

test("additions and moves save at once, through the engine's reducer, and name the cards they touched", async (t) => {
  const { gate, context, board, revision, edits } = await setup(t);
  const ctx = context();
  const out = await gate.call(ctx, { seq: 1, method: "slates.applyOperations", input: edits([
    { kind: "add_card", lane: "Later", label: "Delta" },
    { kind: "move_card", card: { id: "c" }, lane: "the Later lane" },
    { kind: "rename_card", card: "Alpha", label: "Alpha one" },
  ]) });
  assert.equal(out.ok, true, JSON.stringify(out.error));
  assert.equal(revision(), 2);
  assert.deepEqual(board().cards.map((card) => [card.label, card.laneId]), [["Alpha one", "now"], ["Beta", "now"], ["Gamma", "later"], ["Delta", "later"]]);
  const report = out.value.report;
  assert.deepEqual(report.edits.map((edit) => edit.said), ["Added “Delta” to “Later”.", "Moved “Gamma” to “Later”.", "Renamed “Alpha” to “Alpha one”."]);
  assert.deepEqual(report.addedCards, ["card-1"]);
  assert.deepEqual(report.removedCards, []);
  assert.deepEqual(report.targets, ["card-card-1", "card-c", "card-a"]);
  assert.match(out.value.receiptId, /^workshop-[0-9a-f]{64}$/);
  assert.equal(ctx.held, null);
  // A card is a note, and every edit is an operation.
  assert.deepEqual([ctx.counters.operations, ctx.counters.notesCreated], [3, 1]);
  assert.ok(out.value.workshop.edits.includes("add_card"));
});

test("a refusal is the sentence a person sees, with the edit, the legal lanes and the board; nothing saves", async (t) => {
  const { world, gate, context, revision, edits } = await setup(t);
  const out = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: edits([
    { kind: "rename_card", card: "Gamma", label: "Gamma two" },
    { kind: "move_card", card: "Gamma", lane: "Now" },
  ]) });
  assert.equal(out.ok, false);
  assert.equal(out.error.status, 409);
  assert.equal(out.error.code, "edit_refused");
  const { details } = out.error;
  assert.equal(details.status, "refused");
  assert.equal(details.reason, out.error.message);
  assert.equal(details.reason, "It already holds 2 of 2 cards.");
  assert.equal(details.editIndex, 1);
  assert.deepEqual(details.legalLaneIds, ["later"]);
  assert.equal(details.revision, 1);
  assert.equal(details.workshop.revision, 1);
  assert.equal(revision(), 1, "nothing saved");
  assert.equal(world.slate("board").creative.model.workshop.cards[2].label, "Gamma");
  assert.equal(world.workshopRuns.length, 0);
});

test("a removal waits for a yes: remove_card is held with what it removes, and saves once confirmed", async (t) => {
  const { world, principal, gate, context, board, edits } = await setup(t);
  const input = edits([{ kind: "remove_card", card: "Beta" }]);
  const ctx = context({ execKey: "k1" });
  const held = await gate.call(ctx, { seq: 1, method: "slates.applyOperations", input });
  assert.equal(held.ok, false);
  assert.equal(held.error.code, "confirmation_required");
  assert.deepEqual(held.error.details.reasons, [{ rule: "removes", shareId: "board", count: 1 }]);
  assert.equal(board().cards.length, 3, "nothing removed yet");
  const claimed = await world.exec.store.claimConfirmation({ id: ctx.held.id, subject: principal.tokenId, codeSha256: sha("code"), execId: "x" });
  const again = context({ execKey: "k1", confirmation: { id: ctx.held.id, fingerprints: claimed.fingerprints, used: new Set() } });
  const saved = await gate.call(again, { seq: 1, method: "slates.applyOperations", input });
  assert.equal(saved.ok, true, JSON.stringify(saved.error));
  assert.deepEqual(saved.value.report.removedCards, ["b"]);
  assert.deepEqual(board().cards.map((card) => card.id), ["a", "c"]);
});

test("removing a lane is held too; renames on your own board are not", async (t) => {
  const { gate, context, edits } = await setup(t);
  const lane = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: edits([{ kind: "remove_lane", lane: "Later" }]) });
  assert.equal(lane.error?.code, "confirmation_required");
  assert.deepEqual(lane.error.details.reasons.map((reason) => reason.rule), ["removes"]);
  const rename = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: edits([{ kind: "rename_lane", lane: "Later", label: "Someday" }]) });
  assert.equal(rename.ok, true);
});

test("add_card counts toward the script's note cap and every edit toward its operation cap", async (t) => {
  const { gate, context, edits } = await setup(t, { limits: { ...EXEC_LIMITS, notesCreated: 1, operations: 3 } });
  const tooMany = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: edits([
    { kind: "add_card", lane: "Later", label: "One" }, { kind: "add_card", lane: "Later", label: "Two" },
  ]) });
  assert.equal(tooMany.error.code, "note_limit");
  const long = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: edits([
    { kind: "rename_card", card: "Alpha", label: "1" }, { kind: "rename_card", card: "Alpha", label: "2" },
    { kind: "rename_card", card: "Alpha", label: "3" }, { kind: "rename_card", card: "Alpha", label: "4" },
  ]) });
  assert.equal(long.error.code, "operation_limit");
});

test("undo puts the board back only while nothing has changed since, the rule a person's undo keeps", async (t) => {
  const { gate, context, board, revision, edits } = await setup(t);
  const before = structuredClone(board());
  const saved = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: edits([{ kind: "move_card", card: "Gamma", lane: "Later" }]) });
  assert.equal(saved.ok, true);
  const undo = (receiptId) => ({ shareId: "board", plan: { message: "Undo", operations: [{ kind: "undo_workshop_edit", receiptId, expectedRevision: revision() }] } });
  const undone = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: undo(saved.value.receiptId) });
  assert.equal(undone.ok, true, JSON.stringify(undone.error));
  assert.deepEqual(board(), before);
  assert.equal(revision(), 3);
  assert.equal(undone.value.report.undone, saved.value.receiptId);
  // A second edit, then something else changes: its undo is refused with the board as it stands.
  const second = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: edits([{ kind: "rename_card", card: "Alpha", label: "First" }]) });
  await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: edits([{ kind: "rename_card", card: "Beta", label: "Second" }]) });
  const late = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: undo(second.value.receiptId) });
  assert.equal(late.error.code, "slate_changed");
  assert.equal(late.error.details.workshop.cards[1].label, "Second");
  const unknown = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: undo("workshop-" + "0".repeat(64)) });
  assert.equal(unknown.error.code, "not_found");
});

test("another account cannot undo your edit", async (t) => {
  const { world, gate, context, revision, edits } = await setup(t);
  const saved = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: edits([{ kind: "move_card", card: "Gamma", lane: "Later" }]) });
  const receipt = world.workshopRuns.find((row) => row._id === saved.value.receiptId);
  assert.ok(receipt.before && receipt.beforeRevision === 1 && receipt.afterRevision === 2);
  receipt.userId = "other";
  const out = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: { shareId: "board", plan: { message: "Undo", operations: [{ kind: "undo_workshop_edit", receiptId: saved.value.receiptId, expectedRevision: revision() }] } } });
  assert.equal(out.error.code, "not_found");
});

test("move_workshop_card is the short form of move_card: the same reducer, the same refusal", async (t) => {
  const { gate, context, revision } = await setup(t);
  const move = (cardId, laneId) => ({ shareId: "board", plan: { message: "Move", operations: [{ kind: "move_workshop_card", cardId, laneId, expectedRevision: revision() }] } });
  const full = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: move("c", "now") });
  assert.equal(full.error.code, "move_refused");
  const viaEdits = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: { shareId: "board", plan: { message: "Move", operations: [{ kind: "workshop_edits", edits: [{ kind: "move_card", card: { id: "c" }, lane: { id: "now" } }], expectedRevision: revision() }] } } });
  assert.equal(viaEdits.error.message, full.error.message);
  const ok = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: move("c", "later") });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.report.targets, ["card-c"]);
});

test("moving a card anyway waits for a yes, with the rule it breaks; confirmed, the card is marked with the agent", async (t) => {
  const { world, principal, gate, context, board, revision } = await setup(t);
  const move = (extra = {}) => ({ shareId: "board", plan: { message: "Move Gamma to Now anyway", operations: [{ kind: "move_workshop_card", cardId: "c", laneId: "now", expectedRevision: revision(), ...extra }] } });
  // Refused, and said to be one the person may agree to.
  const refused = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: move() });
  assert.equal(refused.error.code, "move_refused");
  assert.equal(refused.error.details.overridable, true);
  // With override: held for the person, shown the rule it breaks.
  const input = move({ override: true });
  const ctx = context({ execKey: "anyway" });
  const held = await gate.call(ctx, { seq: 1, method: "slates.applyOperations", input });
  assert.equal(held.error?.code, "confirmation_required");
  assert.deepEqual(held.error.details.reasons, [{ rule: "breaks_board_rule", shareId: "board", count: 1, rules: ["It already holds 2 of 2 cards."] }]);
  assert.equal(board().cards[2].laneId, "next", "nothing moved yet");
  const claimed = await world.exec.store.claimConfirmation({ id: ctx.held.id, subject: principal.tokenId, codeSha256: sha("code"), execId: "x" });
  const again = context({ execKey: "anyway", confirmation: { id: ctx.held.id, fingerprints: claimed.fingerprints, used: new Set() } });
  const saved = await gate.call(again, { seq: 1, method: "slates.applyOperations", input });
  assert.equal(saved.ok, true, JSON.stringify(saved.error));
  const gamma = board().cards.find((card) => card.id === "c");
  assert.equal(gamma.laneId, "now");
  assert.deepEqual({ ...gamma.override, at: undefined }, { by: principal.tokenName ?? gamma.override.by, at: undefined, sentence: "It already holds 2 of 2 cards.", from: "next" });
  assert.ok(gamma.override.by && gamma.override.by !== "Someone");
  // The same through workshop_edits: move_card with override is held too.
  const ctx2 = context({ execKey: "anyway2" });
  const viaEdits = await gate.call(ctx2, { seq: 1, method: "slates.applyOperations", input: { shareId: "board", plan: { message: "Move", operations: [{ kind: "workshop_edits", edits: [{ kind: "move_card", card: "Alpha", lane: "Next", override: false }, { kind: "move_card", card: "Beta", lane: "Later" }], expectedRevision: revision() }] } } });
  assert.equal(viaEdits.ok, true, "a legal move with override false needs no yes: " + JSON.stringify(viaEdits.error));
});

// Someone else's map, which the token's account may edit (an EDIT grant).
const theirMap = () => ({
  version: 1, title: "Their map",
  lanes: [
    { id: "start", label: "Start", station: { column: 0, row: 0, next: ["next"], outcome: "Their start text.", image: { src: "https://example.com/a.png", alt: "Their picture" } } },
    { id: "next", label: "Next step", station: { column: 1, row: 0, next: [], outcome: "Their next text." } },
  ],
  cards: [{ id: "token", label: "Token", laneId: "start" }],
});

async function theirs(t, owner = "other") {
  const world = makeExecWorld({ grants: [{ slateId: "slate-9", type: "public", userId: "owner", slateAccessPermissionId: "EDIT" }] });
  t.after(() => world.close());
  world.slates.push({ _id: "slate-9", shareId: "theirmap", userId: owner, lastSaved: 1000, options: { name: "Their map", isPublic: true }, nodes: [],
    creative: { revision: 1, model: { version: 1, kind: "workshop", workshop: theirMap() } } });
  const principal = await world.principalFor(["slates:read", "slates:write"]);
  const run = (edit) => world.exec.gate.call(
    world.exec.gate.newContext({ execId: uuid(), principal, surface: "api", codeSha256: sha("c"), intent: "t" }),
    { seq: 1, method: "slates.applyOperations", input: { shareId: "theirmap", plan: { message: "m", operations: [{ kind: "workshop_edits", edits: [edit], expectedRevision: world.slate("theirmap").creative.revision }] } } }
  );
  const station = () => world.slate("theirmap").creative.model.workshop.lanes[0].station;
  return { world, run, station };
}

test("on someone else's board every change to what is there waits for a yes: a picture, a step's words, a move", async (t) => {
  const { run, station } = await theirs(t);
  const picture = await run({ kind: "set_station_image", station: "Start", image: null });
  assert.equal(picture.error?.code, "confirmation_required");
  assert.deepEqual(picture.error.details.reasons.map((reason) => reason.rule).sort(), ["others_notes", "removes"]);
  assert.equal(station().image?.alt, "Their picture", "their picture stays");
  const words = await run({ kind: "set_station_outcome", station: "Start", outcome: "x" });
  assert.equal(words.error?.code, "confirmation_required");
  assert.deepEqual(words.error.details.reasons, [{ rule: "others_notes", shareId: "theirmap", count: 1 }]);
  assert.equal(station().outcome, "Their start text.");
  const alt = await run({ kind: "set_station_image_alt", station: "Start", alt: "Mine now" });
  assert.equal(alt.error?.code, "confirmation_required");
  const moved = await run({ kind: "advance_card", card: "Token" });
  assert.equal(moved.error?.code, "confirmation_required");
  const renamed = await run({ kind: "rename_lane", lane: "Start", label: "x" });
  assert.deepEqual(renamed.error.details.reasons.map((reason) => reason.rule), ["others_notes"]);
  // Adding something new is not theirs: it saves.
  const added = await run({ kind: "add_station", from: "Next step", label: "Follow-up" });
  assert.equal(added.ok, true, JSON.stringify(added.error));
});

test("on your own board, taking a picture off or a path away is a removal; words and moves are not", async (t) => {
  const { run, station } = await theirs(t, "owner");
  const picture = await run({ kind: "set_station_image", station: "Start", image: null });
  assert.deepEqual(picture.error?.details?.reasons, [{ rule: "removes", shareId: "theirmap", count: 1 }]);
  assert.ok(station().image);
  const path = await run({ kind: "disconnect_stations", from: "Start", to: "Next step" });
  assert.deepEqual(path.error?.details?.reasons, [{ rule: "removes", shareId: "theirmap", count: 1 }]);
  assert.deepEqual(station().next, ["next"]);
  const words = await run({ kind: "set_station_outcome", station: "Start", outcome: "New words" });
  assert.equal(words.ok, true, JSON.stringify(words.error));
  // A step put in front of another carries the path on: nothing is taken away.
  const inserted = await run({ kind: "insert_station", before: "Next step", label: "Check" });
  assert.equal(inserted.ok, true, JSON.stringify(inserted.error));
  assert.deepEqual(inserted.value.report.removedPaths, []);
});

test("undoing an edit that added a card takes the card away again, so it is reported and held as a removal", async (t) => {
  const { gate, context, board, revision, edits } = await setup(t);
  const saved = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: edits([{ kind: "add_card", lane: "Later", label: "Delta" }]) });
  assert.equal(saved.ok, true);
  const undo = { shareId: "board", plan: { message: "Undo", operations: [{ kind: "undo_workshop_edit", receiptId: saved.value.receiptId, expectedRevision: revision() }] } };
  const held = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: undo });
  assert.equal(held.error?.code, "confirmation_required");
  assert.deepEqual(held.error.details.reasons, [{ rule: "removes", shareId: "board", count: 1 }]);
  assert.equal(board().cards.length, 4, "Delta stays until the yes");
  const preview = await gate.call(context({ mode: "preview" }), { seq: 1, method: "slates.applyOperations", input: undo });
  assert.deepEqual(preview.value.report.removedCards, ["card-1"]);
});

test("a plain REST call with an agent token meets the same hold: a workshop removal waits for a yes", async (t) => {
  const { world } = await setup(t);
  const { token } = await world.mint();
  const call = await world.serve(t);
  const remove = () => ({ plan: { message: "tidy", operations: [{ kind: "workshop_edits", edits: [{ kind: "remove_card", card: "Beta" }], expectedRevision: world.slate("board").creative.revision }] } });
  const held = await call("/api/v1/slates/board/operations", { token, key: "rest-1", method: "POST", body: remove() });
  assert.equal(held.status, 409);
  assert.equal(held.body.error.code, "confirmation_required");
  assert.deepEqual(world.slate("board").creative.model.workshop.cards.map((card) => card.id), ["a", "b", "c"]);
  const saved = await call("/api/v1/slates/board/operations", { token, key: "rest-1", method: "POST", body: remove(), headers: { "slatebox-confirm": held.body.error.details.confirmationId } });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.deepEqual(world.slate("board").creative.model.workshop.cards.map((card) => card.id), ["a", "c"]);
});

test("taking a card's line away on your own board is a removal: disconnect_cards, disconnect_workshop_card and an undo wait for a yes", async (t) => {
  const { world, gate, context, board, revision, edits } = await setup(t);
  const joined = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: edits([{ kind: "connect_cards", card: "Alpha", to: "Beta" }]) });
  assert.equal(joined.ok, true, JSON.stringify(joined.error));
  assert.equal(board().lines.length, 1);
  const lineId = board().lines[0].id;

  const cut = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: edits([{ kind: "disconnect_cards", card: "Alpha", to: "Beta" }]) });
  assert.equal(cut.error?.code, "confirmation_required");
  assert.deepEqual(cut.error.details.reasons, [{ rule: "removes", shareId: "board", count: 1 }]);
  assert.equal(board().lines.length, 1, "the line stays until the yes");
  const preview = await gate.call(context({ mode: "preview" }), { seq: 1, method: "slates.applyOperations", input: edits([{ kind: "disconnect_cards", card: "Alpha", to: "Beta" }]) });
  assert.deepEqual(preview.value.report.removedLines, [lineId]);

  const short = { shareId: "board", plan: { message: "Part them", operations: [{ kind: "disconnect_workshop_card", cardId: "a", toId: "b", expectedRevision: revision() }] } };
  const held = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: short });
  assert.equal(held.error?.code, "confirmation_required");
  assert.deepEqual(held.error.details.reasons, [{ rule: "removes", shareId: "board", count: 1 }]);

  const undo = { shareId: "board", plan: { message: "Undo", operations: [{ kind: "undo_workshop_edit", receiptId: joined.value.receiptId, expectedRevision: revision() }] } };
  const undone = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: undo });
  assert.equal(undone.error?.code, "confirmation_required");
  assert.deepEqual(undone.error.details.reasons, [{ rule: "removes", shareId: "board", count: 1 }]);
  assert.equal(world.slate("board").creative.model.workshop.lines.length, 1);
});

test("a card removed with its lines counts as one removal, the card", async (t) => {
  const { gate, context, edits } = await setup(t);
  const joined = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: edits([{ kind: "connect_cards", card: "Alpha", to: "Beta" }]) });
  assert.equal(joined.ok, true, JSON.stringify(joined.error));
  const held = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: edits([{ kind: "remove_card", card: "Beta" }]) });
  assert.deepEqual(held.error?.details?.reasons, [{ rule: "removes", shareId: "board", count: 1 }]);
});
