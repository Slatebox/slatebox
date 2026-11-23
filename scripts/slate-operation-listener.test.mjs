// SlateOperationListener draws an agent's saved canvas plan on every open canvas. A workshop
// edit's receipt is in the same collection (its _id starts "workshop-"), but a workshop reaches
// screens through creativeSlates.state; handed to the canvas applier it throws.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { appliesToCanvas, runsSince, runFields } from "../web/app/imports/api/common/slate-operation-runs.mjs";
import { readFileSync } from "node:fs";

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

// An agent's saved edit reaches every open canvas that may read the slate, a visitor with no account
// too: their canvas used to wait for an account holder's open canvas to pass it on through the room,
// and missed it when none was open (or that canvas had not joined the room yet). The runs a canvas
// is sent are those after the revision it loaded, by the server's numbering, not the browser's clock:
// one saved between loading the slate and starting to listen is neither lost nor drawn twice.
const app = (path) => readFileSync(new URL("../web/app/" + path, import.meta.url), "utf8");

test("the runs a canvas is sent are those after the revision it loaded", () => {
  assert.deepEqual(runsSince("board", { revision: 7 }), { slateShareId: "board", revision: { $gt: 7 } });
  assert.deepEqual(runsSince("board", { revision: 0 }), { slateShareId: "board", revision: { $gt: 0 } });
  // A client from before (a time) is still answered as it asked.
  assert.deepEqual(runsSince("board", 1234), { slateShareId: "board", createdAt: { $gte: 1234 } });
  assert.deepEqual(runsSince("board", undefined, () => 99), { slateShareId: "board", createdAt: { $gte: 99 } });
  assert.deepEqual(runsSince("board", { revision: -1 }, () => 5), { slateShareId: "board", createdAt: { $gte: 5 } }, "a revision that is not one is not trusted");
});

test("someone who may only read the slate is sent the plan, never the words the person gave the agent", () => {
  assert.equal(runFields(true).userMessage, 1);
  assert.equal(runFields(false).userMessage, undefined);
  for (const canEdit of [true, false]) {
    assert.equal(runFields(canEdit).plan, 1);
    assert.equal(runFields(canEdit).revision, 1);
  }
});

test("the publication serves anyone who may read the slate, a visitor with no account too", () => {
  const source = app("server/publications.js");
  const start = source.indexOf("CONSTANTS.publications.slateOperationRuns");
  const body = source.slice(start, source.indexOf("Meteor.publish(", start));
  assert.doesNotMatch(body, /!this\.userId/, "no account is not a reason to send nothing");
  assert.match(body, /canReadSlate\(this\.userId, slate\)/);
  assert.match(body, /runsSince\(shareId, since\)/);
  assert.match(body, /runFields\(/);
});

test("the listener asks for runs after the loaded revision, draws them in order, and a visitor with no account only draws them", () => {
  const source = app("imports/ui/components/SlateOperationListener.jsx");
  assert.doesNotMatch(source, /mountedAt/, "not the browser's clock");
  assert.match(source, /runsSince\(slate\.shareId, since\)/);
  assert.match(source, /sort: \{ revision: 1, createdAt: 1 \}/, "a Mermaid import saves its runs under one revision, in order of time");
  assert.match(source, /send: Boolean\(Meteor\.userId\(\)\)/);
  const canvas = app("imports/ui/pages/Canvas.jsx");
  assert.match(canvas, /<SlateOperationListener slate=\{slate\.current\} revision=\{loadedRevision\.current\} \/>/);
});
