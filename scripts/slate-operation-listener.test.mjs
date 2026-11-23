// SlateOperationListener draws an agent's saved canvas plan on every open canvas. A workshop
// edit's receipt is in the same collection (its _id starts "workshop-"), but a workshop reaches
// screens through creativeSlates.state; handed to the canvas applier it throws.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { appliesToCanvas } from "../web/app/imports/api/common/slate-operation-runs.mjs";

const appRequire = createRequire(new URL("../web/app/package.json", import.meta.url));

const workshopReceipt = {
  _id: "workshop-" + "a".repeat(64),
  slateShareId: "board",
  plan: { message: "Move Gamma", operations: [{ kind: "move_workshop_card", cardId: "c", laneId: "later", expectedRevision: 3 }] },
  createdAt: 1,
};
const editsReceipt = {
  _id: "workshop-" + "b".repeat(64),
  slateShareId: "board",
  plan: { message: "Add a card", operations: [{ kind: "workshop_edits", edits: [{ kind: "add_card", lane: "Now", label: "X" }], expectedRevision: 4 }] },
  createdAt: 2,
};
const canvasRun = {
  _id: "r1",
  slateShareId: "board",
  plan: { message: "Add", operations: [{ kind: "add_nodes", count: 1, text: "Hi" }] },
  createdAt: 3,
};

test("the canvas applier throws on a workshop receipt (what the listener used to hand it)", async () => {
  const engine = await import(appRequire.resolve("slateboxjs"));
  const SlateOperations = engine.SlateOperations ?? engine.default.SlateOperations;
  const slate = { nodes: { allNodes: [] } };
  for (const run of [workshopReceipt, editsReceipt])
    assert.throws(() => SlateOperations.applySlateOperations(slate, run.plan, { replay: true }), /unsupported kind/);
});

test("the listener sends only canvas plans to the canvas applier", () => {
  assert.equal(appliesToCanvas(workshopReceipt), false);
  assert.equal(appliesToCanvas(editsReceipt), false);
  assert.equal(appliesToCanvas({ ...editsReceipt, _id: "other" }), false, "by its operations as well as its id");
  assert.equal(appliesToCanvas(canvasRun), true);
  assert.equal(appliesToCanvas({ _id: "x" }), false);
});
