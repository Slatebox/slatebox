// Moving a card anyway on every smart component (owner, 2026-11-23: "dropping the card where it shouldn't go should be
// possible with a confirmation ... standard in the smart components"), through the server: the canvas's edits (a
// pipeline, a budget, a launch plan, a nested board), marked by the server with who and when (never the page); a whole
// save (a kept proposal) made again by its edits; the recorded Undo, one step; exec/MCP's workshop_edits and
// move_workshop_card held for the person (confirmation_required, breaks_board_rule) and saved on confirm; check_move's
// overridable. Hard limits stay refused.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { validateWorkshop, applyWorkshopEdits } from "slateboxjs/workshops/model";
import { sampleBudget, sampleLaunchPlan, samplePipeline, checkNestMove } from "slateboxjs/workshops/rules";
import { discoveryTreeSample } from "slateboxjs/workshops/samples";
import { checkWorkshopMove } from "slateboxjs/workshops/behaviour";
import { playWorkshopChanges, readWorkshopChanges } from "../web/app/server/methods/workshop-play.mjs";
import { replaceWorkshop } from "../web/app/server/methods/workshop-replace.mjs";
import { makeExecWorld } from "./exec-test-world.mjs";

const card = (board, id) => board.cards.find((item) => item.id === id);

test("the canvas's edit made anyway: kept as an override, played with the server's name, never the page's", () => {
  const pipeline = validateWorkshop(samplePipeline());
  const edit = { kind: "move_card", card: { id: "northwind" }, lane: { id: "proposal" }, override: true };
  // The engine's onChange: { cardId, laneId, override: true, edits: [that edit] }.
  const [change] = readWorkshopChanges([{ cardId: "northwind", laneId: "proposal", override: true, edits: [edit] }]);
  assert.deepEqual(change, { edits: [edit], cardId: "northwind", laneId: "proposal", override: true });
  // An override edit is an override even when the change does not say so.
  assert.equal(readWorkshopChanges([{ cardId: "northwind", edits: [edit] }])[0].override, true);
  assert.throws(() => readWorkshopChanges([{ cardId: "northwind", edits: [edit], override: "yes" }]));
  const played = playWorkshopChanges(pipeline, [change], undefined, undefined, { by: "Tim" });
  assert.ok(played.workshop, JSON.stringify(played.refused));
  assert.equal(card(played.workshop, "northwind").laneId, "proposal");
  assert.equal(card(played.workshop, "northwind").override.by, "Tim");
  assert.equal(card(played.workshop, "northwind").override.from, "lead");
  // Without override: refused with the rule's sentence, and said to be one the person may agree to.
  const refused = playWorkshopChanges(pipeline, readWorkshopChanges([{ cardId: "northwind", edits: [{ ...edit, override: undefined }] }]), undefined, undefined, null);
  assert.equal(refused.refused.reason, "Deals move one stage at a time. Northwind is in Lead, so Qualified comes first.");
  assert.equal(refused.refused.overridable, true);
});

test("each board's override keeps its numbers true: a budget over, a plan late or before its wait, a card under a forbidden parent", () => {
  const budget = playWorkshopChanges(validateWorkshop(sampleBudget()), readWorkshopChanges([{ cardId: "ads", edits: [{ kind: "move_card", card: { id: "ads" }, lane: { id: "design" }, override: true }] }]), undefined, undefined, { by: "Ana" });
  assert.equal(card(budget.workshop, "ads").laneId, "design");
  assert.equal(card(budget.workshop, "ads").override.by, "Ana");
  const plan = playWorkshopChanges(validateWorkshop(sampleLaunchPlan()), readWorkshopChanges([{ cardId: "build", edits: [{ kind: "set_task", card: { id: "build" }, lag: -2, override: true }] }]), undefined, undefined, { by: "Ana" });
  assert.equal(card(plan.workshop, "build").lag, -2);
  assert.deepEqual(card(plan.workshop, "build").override.was, { lag: 0, duration: 6 });
  const tree = validateWorkshop(discoveryTreeSample());
  const nested = playWorkshopChanges(tree, readWorkshopChanges([{ cardId: "csv-import", edits: [{ kind: "nest_card", card: { id: "csv-import" }, under: { id: "outcome" }, override: true }] }]), undefined, undefined, { by: "Ana" });
  assert.equal(card(nested.workshop, "csv-import").parentId, "outcome");
  assert.equal(card(nested.workshop, "csv-import").override.sentence, "Solutions sit under an opportunity.");
  // check_move says the same, for exec and the chat.
  assert.equal(checkWorkshopMove(validateWorkshop(samplePipeline()), "northwind", "proposal").refused.overridable, true);
  assert.equal(checkNestMove(tree, "CSV import", { under: "Activation to 40%" }).refused.overridable, true);
});

test("a hard limit stays refused, even with override: a deal with no amount is never won", () => {
  const unpriced = validateWorkshop({ ...samplePipeline(), cards: [...samplePipeline().cards.filter((item) => item.id !== "harbor"), { id: "nova", label: "Nova", laneId: "proposal" }] });
  const hard = playWorkshopChanges(unpriced, readWorkshopChanges([{ cardId: "nova", edits: [{ kind: "move_card", card: { id: "nova" }, lane: { id: "won" }, override: true }] }]), undefined, undefined, { by: "Tim" });
  assert.ok(hard.refused);
  assert.equal(hard.refused.overridable, undefined);
  assert.equal(checkWorkshopMove(unpriced, "nova", "won").refused.overridable, false);
});

test("a whole save of a board moved anyway (a kept proposal) is made again by its edits, marked by the saver; its Undo is one step", () => {
  const stored = validateWorkshop(samplePipeline());
  const page = { ...stored, cards: [...stored.cards.filter((item) => item.id !== "northwind"),
    { ...card(stored, "northwind"), laneId: "proposal", override: { by: "Mallory", at: "2020-01-01T00:00:00.000Z", sentence: "fake", from: "lead" } }] };
  const kept = replaceWorkshop(stored, page, { revision: 4, current: 4, userId: "tim", actor: { by: "Tim" } });
  assert.ok(kept.workshop, JSON.stringify(kept.refused));
  const mark = card(kept.workshop, "northwind").override;
  assert.equal(mark.by, "Tim");
  assert.equal(mark.sentence, "Deals move one stage at a time. Northwind is in Lead, so Qualified comes first.");
  assert.notEqual(mark.at, "2020-01-01T00:00:00.000Z");
  const undone = replaceWorkshop(kept.workshop, stored, { undo: { by: "tim", revision: 5, workshop: stored }, revision: 5, current: 5, userId: "tim", actor: { by: "Tim" } });
  assert.equal(undone.undone, true);
  assert.deepEqual(card(undone.workshop, "northwind"), card(stored, "northwind"));
  // A plan's task moved in time anyway, kept from a proposal, then put back.
  const plan = validateWorkshop(sampleLaunchPlan());
  const early = { ...plan, cards: plan.cards.map((item) => item.id === "build" ? { ...item, lag: -2, override: { by: "X", at: "2020-01-01T00:00:00.000Z", sentence: "x", from: "engineering", was: { lag: 0 } } } : item) };
  const timed = replaceWorkshop(plan, early, { revision: 2, current: 2, userId: "tim", actor: { by: "Tim" } });
  assert.ok(timed.workshop, JSON.stringify(timed.refused));
  assert.equal(card(timed.workshop, "build").override.by, "Tim");
  assert.equal(card(timed.workshop, "build").override.sentence, "Build waits on Design: it starts day 4 at the earliest.");
  // The edit a plain save would make (no mark) is refused: the page can't move it past its rule without saying so.
  const plain = replaceWorkshop(plan, { ...plan, cards: plan.cards.map((item) => item.id === "build" ? { ...item, lag: -2 } : item) }, { revision: 2, current: 2, userId: "tim", actor: { by: "Tim" } });
  assert.ok(plain.refused);
});

const sha = (text) => createHash("sha256").update(text).digest("hex");
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

async function setup(t, workshop) {
  const world = makeExecWorld();
  t.after(() => world.close());
  world.slates.push({
    _id: "slate-ma", shareId: "board", userId: "owner", lastSaved: 1000, options: { name: "Board", isPrivate: true }, nodes: [],
    creative: { revision: 1, model: { version: 1, kind: "workshop", workshop } },
  });
  const principal = await world.principalFor(["slates:read", "slates:write"]);
  const gate = world.exec.gate;
  const context = (extra = {}) => gate.newContext({ execId: uuid(), principal, surface: "api", codeSha256: sha("code"), intent: "test", ...extra });
  const board = () => world.slate("board").creative.model.workshop;
  const revision = () => world.slate("board").creative.revision;
  const input = (list) => ({ shareId: "board", plan: { message: "Move it anyway", operations: [{ kind: "workshop_edits", edits: list, expectedRevision: revision() }] } });
  return { world, principal, gate, context, board, revision, input };
}

async function heldThenConfirmed(t, workshop, edit, rule) {
  const { world, principal, gate, context, board, input } = await setup(t, workshop);
  // Without override: refused, overridable.
  const refused = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: input([edit]) });
  assert.equal(refused.error.code, "edit_refused", JSON.stringify(refused.error));
  assert.equal(refused.error.details.overridable, true);
  // With override: held for the person, with the rule it breaks.
  const body = input([{ ...edit, override: true }]);
  const ctx = context({ execKey: "anyway-" + edit.kind });
  const held = await gate.call(ctx, { seq: 1, method: "slates.applyOperations", input: body });
  assert.equal(held.error?.code, "confirmation_required", JSON.stringify(held.error));
  assert.deepEqual(held.error.details.reasons, [{ rule: "breaks_board_rule", shareId: "board", count: 1, rules: [rule] }]);
  const before = JSON.stringify(board());
  const claimed = await world.exec.store.claimConfirmation({ id: ctx.held.id, subject: principal.tokenId, codeSha256: sha("code"), execId: "x" });
  const again = context({ execKey: "anyway-" + edit.kind, confirmation: { id: ctx.held.id, fingerprints: claimed.fingerprints, used: new Set() } });
  assert.equal(JSON.stringify(board()), before, "nothing changed before the yes");
  const saved = await gate.call(again, { seq: 1, method: "slates.applyOperations", input: body });
  assert.equal(saved.ok, true, JSON.stringify(saved.error));
  const moved = card(board(), edit.card.id);
  assert.ok(moved.override.by && moved.override.by !== "Someone");
  assert.equal(moved.override.sentence, rule);
  return board();
}

test("exec: a pipeline's move_card made anyway waits for a yes, then saves marked with the token's name", async (t) => {
  const after = await heldThenConfirmed(t, samplePipeline(), { kind: "move_card", card: { id: "northwind" }, lane: { id: "proposal" } },
    "Deals move one stage at a time. Northwind is in Lead, so Qualified comes first.");
  assert.equal(card(after, "northwind").laneId, "proposal");
});

test("exec: a launch plan's set_task before its wait, and a nested board's nest_card, are held and confirmed the same way", async (t) => {
  const plan = await heldThenConfirmed(t, sampleLaunchPlan(), { kind: "set_task", card: { id: "build" }, lag: -2 }, "Build waits on Design: it starts day 4 at the earliest.");
  assert.equal(card(plan, "build").lag, -2);
  const tree = await heldThenConfirmed(t, discoveryTreeSample(), { kind: "nest_card", card: { id: "csv-import" }, under: { id: "outcome" } }, "Solutions sit under an opportunity.");
  assert.equal(card(tree, "csv-import").parentId, "outcome");
});

test("exec: a budget's line item made anyway through the short form (move_workshop_card override) is held too", async (t) => {
  const { gate, context, revision } = await setup(t, sampleBudget());
  const move = (extra = {}) => ({ shareId: "board", plan: { message: "Move ads", operations: [{ kind: "move_workshop_card", cardId: "ads", laneId: "design", expectedRevision: revision(), ...extra }] } });
  const refused = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: move() });
  assert.equal(refused.error.code, "move_refused");
  assert.equal(refused.error.details.overridable, true);
  const held = await gate.call(context({ execKey: "ads" }), { seq: 1, method: "slates.applyOperations", input: move({ override: true }) });
  assert.equal(held.error?.code, "confirmation_required");
  assert.deepEqual(held.error.details.reasons[0].rules, ["Design has $30k left. Launch ads costs $150k."]);
  // The reducer agrees with what exec says.
  assert.equal("refused" in applyWorkshopEdits(validateWorkshop(sampleBudget()), [{ kind: "move_card", card: { id: "ads" }, lane: { id: "design" }, override: true }]), false);
});
