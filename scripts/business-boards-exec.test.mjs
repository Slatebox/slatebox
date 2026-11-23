// An agent's edits on a launch plan, a sales pipeline and a budget, through exec's workshop_edits:
// additions save at once, everything else is previewed and anything that takes something away
// waits for a yes, and a refusal is the sentence a person sees on the canvas, with the legal range.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { sampleBudget, sampleLaunchPlan, samplePipeline } from "slateboxjs/workshops/rules";
import { makeExecWorld } from "./exec-test-world.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

async function setup(t, workshop) {
  const world = makeExecWorld();
  t.after(() => world.close());
  world.slates.push({
    _id: "slate-b", shareId: "board", userId: "owner", lastSaved: 1000, options: { name: "Board", isPrivate: true }, nodes: [],
    creative: { revision: 1, model: { version: 1, kind: "workshop", workshop } },
  });
  const principal = await world.principalFor(["slates:read", "slates:write"]);
  const gate = world.exec.gate;
  const context = (extra = {}) => gate.newContext({ execId: uuid(), principal, surface: "api", codeSha256: sha("code"), intent: "test", ...extra });
  const board = () => world.slate("board").creative.model.workshop;
  const revision = () => world.slate("board").creative.revision;
  const call = (ctx, list) => gate.call(ctx, { seq: 1, method: "slates.applyOperations", input: {
    shareId: "board", plan: { message: "Edit the board", operations: [{ kind: "workshop_edits", edits: list, expectedRevision: revision() }] } } });
  return { world, principal, gate, context, board, revision, call };
}

test("launch plan: a task added saves at once; a slip that pushes past launch is refused with the canvas's sentence and range", async (t) => {
  const { context, board, revision, call } = await setup(t, sampleLaunchPlan());
  const ctx = context();
  const added = await call(ctx, [{ kind: "add_card", lane: "Engineering", label: "Docs", duration: 2, waitsOn: ["QA"] }]);
  assert.equal(added.ok, true, JSON.stringify(added.error));
  assert.equal(ctx.held, null);
  assert.deepEqual(added.value.report.addedCards, ["card-1"]);
  assert.equal(added.value.workshop.launch.finish, 14);
  assert.deepEqual(board().cards.at(-1), { id: "card-1", label: "Docs", laneId: "engineering", duration: 2, dependsOn: ["qa"] });

  const refused = await call(context(), [{ kind: "set_task", card: "Build", duration: 9 }]);
  assert.equal(refused.error.code, "edit_refused");
  assert.equal(refused.error.details.reason, "That pushes Docs to day 17, after launch on day 14.");
  assert.deepEqual(refused.error.details.limits, { field: "duration", min: 1, max: 6, reasons: { min: "A task takes at least 1 day.", max: "That pushes Docs to day 15, after launch on day 14." } });
  assert.equal(revision(), 2, "nothing saved");

  // Slipping Copy is not a removal: previewed, then saved without a yes.
  const slid = await call(context(), [{ kind: "set_task", card: "Copy", lag: 3 }]);
  assert.equal(slid.ok, true, JSON.stringify(slid.error));
  assert.equal(board().cards.find((card) => card.id === "copy").lag, 3);
});

test("launch plan: unlinking two tasks takes a link away, so it waits for a yes", async (t) => {
  const { world, principal, context, board, call } = await setup(t, sampleLaunchPlan());
  const ctx = context({ execKey: "u1" });
  const held = await call(ctx, [{ kind: "unlink_tasks", card: "QA", waitsOn: "Build" }]);
  assert.equal(held.error?.code, "confirmation_required");
  assert.deepEqual(held.error.details.reasons, [{ rule: "removes", shareId: "board", count: 1 }]);
  assert.deepEqual(board().cards.find((card) => card.id === "qa").dependsOn, ["build"], "nothing unlinked yet");
  const claimed = await world.exec.store.claimConfirmation({ id: ctx.held.id, subject: principal.tokenId, codeSha256: sha("code"), execId: "x" });
  const saved = await call(context({ execKey: "u1", confirmation: { id: ctx.held.id, fingerprints: claimed.fingerprints, used: new Set() } }),
    [{ kind: "unlink_tasks", card: "QA", waitsOn: "Build" }]);
  assert.equal(saved.ok, true, JSON.stringify(saved.error));
  assert.deepEqual(saved.value.report.removedLinks, [{ cardId: "qa", waitsOn: "build" }]);
  // The task keeps its start: its lag is what the link held.
  assert.equal(board().cards.find((card) => card.id === "qa").lag, 10);
});

test("pipeline: a skipped stage is refused with the stage rule; one stage on, a new deal and a price save; removing a deal waits", async (t) => {
  const { context, board, call } = await setup(t, samplePipeline());
  const skip = await call(context(), [{ kind: "move_card", card: "Northwind", lane: "Won" }]);
  assert.equal(skip.error.code, "edit_refused");
  assert.equal(skip.error.details.reason, "Deals move one stage at a time. Northwind is in Lead, so Qualified comes first.");
  const full = await call(context(), [{ kind: "move_card", card: "Acme", lane: "Proposal" }]);
  assert.equal(full.error.details.reason, "Proposal already holds 3 of 3 deals.");
  const ctx = context();
  const moved = await call(ctx, [{ kind: "move_card", card: "Northwind", lane: "Qualified" }, { kind: "set_amount", card: "Globex", amount: 65000 },
    { kind: "add_card", lane: "Lead", label: "Initech", amount: 30000 }]);
  assert.equal(moved.ok, true, JSON.stringify(moved.error));
  assert.equal(ctx.held, null);
  assert.equal(board().cards.find((card) => card.id === "northwind").laneId, "qualified");
  assert.equal(moved.value.workshop.forecast.value, Math.round(65000 * 0.1 + 30000 * 0.1 + 40000 * 0.3 + 25000 * 0.3 + (55000 + 80000 + 35000) * 0.6 + 70000));
  const negative = await call(context(), [{ kind: "set_amount", card: "Acme", amount: -5 }]);
  assert.equal(negative.error.details.reason, "An amount is not below zero.");
  assert.deepEqual(negative.error.details.limits, { field: "amount", min: 0, max: 1e9, reasons: { min: "An amount is not below zero.", max: "An amount is at most 1,000,000,000." } });
  const remove = await call(context(), [{ kind: "remove_card", card: "Acme" }]);
  assert.equal(remove.error?.code, "confirmation_required");
});

test("budget: money moves between teams and the total holds; past what a team commits it is refused with that bound", async (t) => {
  const { context, board, call } = await setup(t, sampleBudget());
  const past = await call(context(), [{ kind: "shift_budget", from: "Sales", to: "Product", amount: 100000 }]);
  assert.equal(past.error.code, "edit_refused");
  assert.equal(past.error.details.reason, "Sales already commits $320k.");
  assert.deepEqual(past.error.details.limits, { field: "amount", min: -100000, max: 80000, reasons: { min: "Product's floor is $300k.", max: "Sales already commits $320k." } });
  const room = await call(context(), [{ kind: "move_card", card: "Contractor", lane: "Design" }]);
  assert.equal(room.error.details.reason, "Design has $30k left. Contractor costs $45k.");
  const moved = await call(context(), [{ kind: "shift_budget", from: "Sales", to: "Product", amount: 50000 }]);
  assert.equal(moved.ok, true, JSON.stringify(moved.error));
  assert.deepEqual(board().lanes.map((lane) => lane.allocation), [450000, 350000, 150000, 250000]);
  assert.equal(board().lanes.reduce((sum, lane) => sum + lane.allocation, 0), 1200000);
  assert.equal(moved.value.workshop.lanes[1].committed, 320000);
  const free = await call(context(), [{ kind: "add_card", lane: "Design", label: "Usability study" }]);
  assert.equal(free.error.details.reason, "Give the line item a cost, like 'Contractor $45k'.");
});

test("the read of each board says what its edits take, so an agent can pick one before trying it", async (t) => {
  for (const [workshop, takes, refuses] of [[sampleLaunchPlan(), ["set_task", "link_tasks", "unlink_tasks", "set_launch_day"], "set_amount"],
    [samplePipeline(), ["set_amount", "set_target"], "shift_budget"], [sampleBudget(), ["shift_budget", "set_amount"], "set_task"]]) {
    const { call, context } = await setup(t, workshop);
    const out = await call(context(), [{ kind: "rename_workshop", title: "Renamed" }]);
    assert.equal(out.ok, true, JSON.stringify(out.error));
    for (const kind of takes) assert.ok(out.value.workshop.edits.includes(kind), workshop.kind + " takes " + kind);
    assert.ok(!out.value.workshop.edits.includes(refuses), workshop.kind + " does not take " + refuses);
    const wrong = await call(context(), [{ kind: refuses, ...(refuses === "set_task" ? { card: workshop.cards[0].id, duration: 3 } : refuses === "set_amount" ? { card: workshop.cards[0].id, amount: 5 } : { from: workshop.lanes[0].id, to: workshop.lanes[1].id, amount: 5000 }) }]);
    assert.equal(wrong.error.code, "edit_refused");
    assert.equal(wrong.error.details.code, "not_on_this_board");
  }
});
