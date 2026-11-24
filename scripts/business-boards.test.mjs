// The launch plan, sales pipeline and budget in the app: made from the chat phrases people type,
// played on the canvas as the edits they make (the server makes them by the same rules), read
// with their numbers, and loaded only by a slate that holds one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyWorkshopEdits, validateWorkshop } from "slateboxjs/workshops/model";
import { sampleBudget, sampleLaunchPlan, samplePipeline, scheduleLaunch } from "slateboxjs/workshops/rules";
import { launchPlanFromBrief } from "../web/app/imports/api/common/launch-plan-brief.mjs";
import { pipelineFromBrief } from "../web/app/imports/api/common/pipeline-brief.mjs";
import { budgetFromBrief } from "../web/app/imports/api/common/budget-brief.mjs";
import { businessBoardFromBrief, businessBoardSaid } from "../web/app/imports/api/common/business-board-brief.mjs";
import { nativeCanvasDraft, nativeRequestKind } from "../web/app/imports/api/common/native-canvas-conversation.mjs";
import { playWorkshopChanges, readWorkshopChanges } from "../web/app/server/methods/workshop-play.mjs";
import { readWorkshop } from "../web/app/server/workshop-read.mjs";
import { notTheBoards, recordedUndo, replaceWorkshop } from "../web/app/server/methods/workshop-replace.mjs";

const app = (path) => readFileSync(new URL("../web/app/" + path, import.meta.url), "utf8");

test("“Plan a launch for day 30: …” makes the launch plan it says, by the plan's own rules", () => {
  const plan = launchPlanFromBrief("Plan a launch for day 30: Design 5 days, Build 8 days after Design, Docs 3 days after Build");
  assert.equal(plan.kind, "launch-plan");
  assert.equal(plan.launch.day, 30);
  assert.deepEqual(plan.lanes.map((lane) => lane.label), ["Product", "Engineering"]);
  assert.deepEqual(plan.cards.map((card) => [card.label, card.duration, card.dependsOn ?? []]),
    [["Design", 5, []], ["Build", 8, ["design"]], ["Docs", 3, ["build"]]]);
  assert.equal(scheduleLaunch(plan).get("docs").end, 16);
  // Teams named with “on”, days as “Nd” or weeks, and no day written: the plan's finish, at least day 14.
  const teams = launchPlanFromBrief("Make a launch plan: Copy 2d on Marketing, Site 2w on Engineering after Copy");
  assert.deepEqual(teams.lanes.map((lane) => lane.label), ["Marketing", "Engineering"]);
  assert.deepEqual(teams.cards.map((card) => card.duration), [2, 10]);
  assert.equal(teams.launch.day, 14);
  // The short form is the sample plan; a day on it moves launch.
  assert.deepEqual(launchPlanFromBrief("Make a launch plan"), validateWorkshop(sampleLaunchPlan()));
  assert.equal(launchPlanFromBrief("Plan a launch in 20 days").launch.day, 20);
  // What the rules refuse is said in their words.
  assert.throws(() => launchPlanFromBrief("Plan a launch for day 10: Design 5 days, Build 8 days after Design"), /Build ends on day 13, after launch on day 10\./);
  assert.throws(() => launchPlanFromBrief("Plan a launch: Build 3 days after Design, Design 2 days"), /There is no task called “Design”/);
});

test("“Make a sales pipeline with Northwind 40k, …, target 250k” makes that pipeline, deals in its first stage", () => {
  const pipeline = pipelineFromBrief("Make a sales pipeline with Northwind 40k, Acme 25k, Globex 60k, target 250k");
  assert.equal(pipeline.kind, "pipeline");
  assert.deepEqual(pipeline.forecast, { target: 250000, currency: "$" });
  assert.deepEqual(pipeline.lanes.map((lane) => lane.label), ["Lead", "Qualified", "Proposal", "Won", "Lost"]);
  assert.deepEqual(pipeline.cards.map((card) => [card.label, card.laneId, card.amount]), [["Northwind", "lead", 40000], ["Acme", "lead", 25000], ["Globex", "lead", 60000]]);
  const staged = pipelineFromBrief("Make a pipeline with Initech €20k; target €100k; stages Intro, Demo, Offer");
  assert.deepEqual(staged.lanes.map((lane) => [lane.label, lane.probability ?? lane.role]), [["Intro", 0.3], ["Demo", 0.5], ["Offer", 0.8], ["Won", "won"], ["Lost", "lost"]]);
  assert.equal(staged.forecast.currency, "€");
  assert.deepEqual(pipelineFromBrief("Make a sales pipeline"), validateWorkshop(samplePipeline()));
  assert.throws(() => pipelineFromBrief("Make a sales pipeline with Acme 5k, target soon"), /target as an amount/);
});

test("“Split a 1.2M budget across Product, Sales and Marketing; Product at least 400k” balances, floors kept", () => {
  const budget = budgetFromBrief("Split a 1.2M budget across Product, Sales and Marketing; Product at least 400k");
  assert.equal(budget.kind, "budget");
  assert.deepEqual(budget.budget, { total: 1200000, currency: "$", step: 5000 });
  assert.deepEqual(budget.lanes.map((lane) => [lane.label, lane.allocation, lane.floor]), [["Product", 400000, 400000], ["Sales", 400000, undefined], ["Marketing", 400000, undefined]]);
  // Equal shares in whole steps, the rest to the first team; a floor above its share takes from the others.
  const uneven = budgetFromBrief("Split a $100k budget across Ops, Design and Research; Research at least 50k; with Contractor 30k in Ops");
  assert.deepEqual(uneven.lanes.map((lane) => lane.allocation), [30000, 20000, 50000]);
  assert.equal(uneven.lanes.reduce((sum, lane) => sum + lane.allocation, 0), 100000);
  assert.deepEqual(uneven.cards, [{ id: "contractor", label: "Contractor", laneId: "ops", amount: 30000 }]);
  assert.deepEqual(budgetFromBrief("Make a budget"), validateWorkshop(sampleBudget()));
  assert.throws(() => budgetFromBrief("Split a 1M budget across Product"), /two to five teams/);
  assert.throws(() => budgetFromBrief("Split a 100k budget across Ops and Design; with Rent 10k in Legal"), /no team called “Legal”/);
});

test("the conversation tells a board phrase from a drawing by its opener, and previews the board the server read", () => {
  for (const phrase of ["Plan a launch for day 30: Design 5 days", "Make a launch plan", "Make a sales pipeline with Acme 5k", "make a pipeline",
    "Split a 1.2M budget across Product and Sales", "Make a budget"]) assert.equal(nativeRequestKind(phrase), "board", phrase);
  assert.equal(nativeRequestKind("Make a workshop with Ideas and Pilot"), "lanes");
  assert.equal(nativeRequestKind("Draw a flow from Sign up to Pay"), "draw");
  const board = businessBoardFromBrief("Make a launch plan");
  const draft = nativeCanvasDraft({ nodes: [] }, "Make a launch plan", "a".repeat(17), board);
  assert.deepEqual([draft.mode, draft.format], ["play", "launch-plan"]);
  assert.equal(businessBoardSaid(draft.workshop), "Added a launch plan · Product → Engineering · launch day 14");
  assert.equal(businessBoardSaid(businessBoardFromBrief("Make a sales pipeline")), "Added a sales pipeline · Lead → Qualified → Proposal → Won → Lost · target $250k");
  assert.equal(businessBoardSaid(businessBoardFromBrief("Make a budget")), "Added a budget · Product → Sales → Design → Marketing · $1.2M · balanced");
  assert.throws(() => nativeCanvasDraft({ nodes: [] }, "Make a launch plan", "a".repeat(17), undefined), /Say what the board holds/);
  assert.equal(businessBoardFromBrief("Draw a flow"), null);
});

test("a board change is played as its edits on the board as it stands: two people's edits both kept, a refusal with its sentence and range", () => {
  const plan = validateWorkshop(sampleLaunchPlan());
  const [mine, theirs] = readWorkshopChanges([
    { cardId: "build", edits: [{ kind: "set_task", card: { id: "build" }, duration: 7 }] },
    { cardId: "copy", edits: [{ kind: "set_task", card: { id: "copy" }, lag: 3 }] },
  ]);
  const first = playWorkshopChanges(plan, [mine]);
  const both = playWorkshopChanges(first.workshop, [theirs]);
  assert.deepEqual(both.workshop.cards.map((card) => [card.id, card.duration, card.lag ?? 0]), [["design", 4, 0], ["build", 7, 0], ["copy", 2, 3], ["qa", 2, 0]]);
  // Ben stretches Build past what launch allows: refused with the canvas's sentence, on Build's lane.
  const late = playWorkshopChanges(plan, readWorkshopChanges([{ cardId: "build", edits: [{ kind: "set_task", card: { id: "build" }, duration: 9 }] }]));
  // It is a rule the person may break once they agree ("Move anyway": the same set_task with override true).
  assert.deepEqual(late.refused, { reason: "That pushes QA to day 15, after launch on day 14.", laneId: "engineering",
    limits: { field: "duration", min: 1, max: 8, reasons: { min: "A task takes at least 1 day.", max: "That pushes QA to day 15, after launch on day 14." } }, overridable: true });
  const pipeline = playWorkshopChanges(validateWorkshop(samplePipeline()), readWorkshopChanges([{ cardId: "northwind", laneId: "won",
    edits: [{ kind: "move_card", card: { id: "northwind" }, lane: { id: "won" } }] }]));
  assert.equal(pipeline.refused.reason, "Deals move one stage at a time. Northwind is in Lead, so Qualified comes first.");
  const budget = playWorkshopChanges(validateWorkshop(sampleBudget()), readWorkshopChanges([{ cardId: "contractor", laneId: "design",
    edits: [{ kind: "move_card", card: { id: "contractor" }, lane: { id: "design" } }] }]));
  assert.deepEqual(budget.refused, { reason: "Design has $30k left. Contractor costs $45k.", laneId: "design", overridable: true });
  // A plain workshop is still played by moves and renames.
  const lanes = { version: 1, title: "Week", lanes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], cards: [{ id: "x", label: "X", laneId: "a" }] };
  assert.equal(playWorkshopChanges(lanes, readWorkshopChanges([{ edits: [{ kind: "move_card", card: "X", lane: "B" }] }])).refused.reason, "This workshop is played by moves and renames.");
  for (const bad of [{ edits: [] }, { edits: "move" }, { edits: [null] }, { edits: [{ kind: "move_card", __proto__x: 1, "a.b": 2 }] }, { edits: [{ kind: "x" }], cardId: "<b>" }]) {
    assert.throws(() => readWorkshopChanges([bad]), /Expected a list of edits/, JSON.stringify(bad));
  }
});

test("an undo after a board change puts back the board the change replaced, through the same gate", () => {
  const before = validateWorkshop(sampleBudget());
  const moved = applyWorkshopEdits(before, [{ kind: "shift_budget", from: { id: "sales" }, to: { id: "product" }, amount: 50000 }]);
  assert.ok(!("refused" in moved));
  const back = playWorkshopChanges(moved.workshop, readWorkshopChanges([{ laneId: "sales", edits: [{ kind: "shift_budget", from: { id: "product" }, to: { id: "sales" }, amount: 50000 }] }]));
  assert.deepEqual(back.workshop, before);
});

test("the read of a board carries its numbers: days and the critical path, the forecast, the envelope", () => {
  const slate = { creative: { revision: 3 } };
  const plan = readWorkshop(validateWorkshop(sampleLaunchPlan()), slate);
  assert.equal(plan.kind, "launch-plan");
  assert.deepEqual(plan.launch, { day: 14, finish: 12 });
  assert.deepEqual(plan.cards.find((card) => card.id === "qa"), { id: "qa", label: "QA", laneId: "engineering", legalLaneIds: ["product"],
    duration: 2, lag: 0, dependsOn: ["build"], start: 10, end: 12, slack: 0, critical: true });
  assert.equal(plan.lanes[0].caption, "2 tasks · 1 on the critical path");
  const pipeline = readWorkshop(validateWorkshop(samplePipeline()), slate);
  assert.deepEqual(pipeline.forecast, { target: 250000, currency: "$", value: Math.round(10000 + 7500 + (55000 + 80000 + 35000) * 0.6 + 70000) });
  assert.deepEqual(pipeline.lanes.map((lane) => lane.probability ?? lane.role), [0.1, 0.3, 0.6, "won", "lost"]);
  const budget = readWorkshop(validateWorkshop(sampleBudget()), slate);
  assert.deepEqual(budget.lanes.map((lane) => [lane.allocation, lane.committed, lane.floor ?? null, lane.cap ?? null]),
    [[400000, 245000, 300000, null], [400000, 320000, null, null], [150000, 120000, null, null], [250000, 150000, null, 300000]]);
});

test("a plain slate's code never loads a board's rules or kit: they load on demand, before the board is read", () => {
  const eager = ["imports/api/common/native-canvas-conversation.mjs", "imports/ui/components/NativeCanvasConversation.jsx",
    "imports/ui/components/workshop/useWorkshopOnCanvas.js", "imports/ui/pages/NewCreativeSlate.jsx", "imports/api/common/portableWorkshopSlate.mjs",
    "imports/api/common/creativeSlates.mjs", "imports/ui/pages/Canvas.jsx", "imports/api/common/board-routes.mjs"];
  for (const file of eager) {
    const source = app(file);
    assert.doesNotMatch(source, /^\s*import[^(]*from\s+['"]slateboxjs\/(?:boards|workshops\/rules)['"]/m, file);
    assert.doesNotMatch(source, /from\s+['"][^'"]*(?:launch-plan|pipeline|budget|business-board)-brief\.mjs['"]/, file);
  }
  assert.match(app("imports/ui/components/workshop/useWorkshopOnCanvas.js"), /import\('slateboxjs\/boards'\)/);
  // The board routes load a board's rules, and its rulebook's module, on demand (board-routes.mjs).
  assert.match(app("imports/ui/pages/NewCreativeSlate.jsx"), /loadBoardRoute\(/);
  assert.match(app("imports/api/common/board-routes.mjs"), /import\('slateboxjs\/workshops\/rules'\)/);
  assert.match(app("imports/api/common/board-routes.mjs"), /import\('slateboxjs\/workshops\/behaviour'\)/);
  // The server loads every board's rules before it reads a board.
  assert.match(app("server/main.js"), /^import 'slateboxjs\/workshops\/rules'$/m);
});

// Phase 2 review H1: a whole save (creativeSlates.save) of a crafted board went through every rule the
// edits keep. Each row is a board someone with edit access could send; each must be refused.
test("a whole save of a launch plan, pipeline or budget is held to the board's own edits (review H1)", () => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const change = (board, mutate) => { const next = clone(board); mutate(next); return next; };
  const save = (stored, next, undo = null) => replaceWorkshop(stored, next, { undo, revision: 7, userId: "ann" });
  const pipeline = validateWorkshop(samplePipeline());
  const budget = validateWorkshop(sampleBudget());
  const plan = validateWorkshop(sampleLaunchPlan());
  const rows = [
    ["a deal from Lead straight to Won", pipeline, (b) => { b.cards.find((c) => c.id === "northwind").laneId = "won"; },
      "Deals move one stage at a time. Northwind is in Lead, so Qualified comes first."],
    ["a won deal back to Lead", pipeline, (b) => { b.cards.find((c) => c.id === "bluefin").laneId = "lead"; },
      "A won deal stays won. Move it to Lost if it fell through."],
    ["a new $900M deal straight into Won", pipeline, (b) => { b.cards.push({ id: "fake", label: "Fake", laneId: "won", amount: 900000000 }); },
      "A new deal starts in an open stage, not in Won."],
    ["Lead's chance to 100%", pipeline, (b) => { b.lanes[0].probability = 1; },
      "Lead keeps its chance to win and what it holds (open, won or lost). Rename it or set how many deals it holds instead."],
    ["Lead becomes the Won stage", pipeline, (b) => { b.lanes[0].role = "won"; delete b.lanes[0].probability; delete b.lanes[3].role; b.lanes[3].probability = 0.5; b.cards.forEach((c) => { c.amount ??= 1; }); },
      /keeps its chance to win and what it holds/],
    ["the budget's total grows 4x, every cap and floor removed", budget, (b) => { b.budget.total *= 4; b.lanes.forEach((l) => { delete l.cap; delete l.floor; l.allocation *= 4; }); },
      "The total changes only at the envelope’s edges: drag one, or say the new total."],
    ["money past Marketing's cap", budget, (b) => { const m = b.lanes.find((l) => l.id === "marketing"); delete m.cap; m.allocation += 100000; b.lanes.find((l) => l.id === "product").allocation -= 100000; },
      "Marketing keeps its floor and cap. Move money between teams instead."],
    ["a task stretched past launch", plan, (b) => { b.cards.find((c) => c.id === "build").duration = 12; },
      /after launch on day 14\.$/],
    ["a card's look, which no edit sets", pipeline, (b) => { b.cards[0].look = { backgroundColor: "#ff0000" }; }, notTheBoards],
  ];
  for (const [name, board, mutate, reason] of rows) {
    const result = save(board, change(board, mutate));
    assert.ok(result.refused, name + " was saved");
    if (reason instanceof RegExp) assert.match(result.refused.reason, reason, name);
    else assert.equal(result.refused.reason, reason, name);
  }
  // What the board's own edits make is kept: a deal one stage on, a stage's limit and the target, a
  // shift between teams, a deal added in Lead (with the id the page gave it), a card removed.
  const kept = change(pipeline, (b) => { b.cards.find((c) => c.id === "northwind").laneId = "qualified"; b.lanes[2].capacity = 4; b.forecast.target = 300000;
    b.cards.push({ id: "initech", label: "Initech", laneId: "lead", amount: 20000 }); b.cards = b.cards.filter((c) => c.id !== "acme"); b.title = "Q3 deals"; });
  assert.deepEqual(save(pipeline, kept), { workshop: validateWorkshop(kept) });
  const shifted = change(budget, (b) => { b.lanes.find((l) => l.id === "sales").allocation -= 50000; b.lanes.find((l) => l.id === "product").allocation += 50000; });
  assert.deepEqual(save(budget, shifted), { workshop: validateWorkshop(shifted) });
  const removed = change(plan, (b) => { b.cards = b.cards.filter((c) => c.id !== "build"); b.cards.find((c) => c.id === "qa").dependsOn = undefined; });
  assert.ok(save(plan, JSON.parse(JSON.stringify(removed))).workshop, "a task removed with what waited on it");
});

test("a whole save puts a board back only as the Undo recorded for that person, at that revision (review H1)", () => {
  const before = validateWorkshop(samplePipeline());
  // Bluefin was won by a change Ann made at revision 6, saved as revision 7 with its Undo.
  const won = change(before, (b) => { b.cards.find((c) => c.id === "globex").laneId = "won"; });
  function change(board, mutate) { const next = JSON.parse(JSON.stringify(board)); mutate(next); return next; }
  const undo = recordedUndo(before, 7, "ann");
  assert.deepEqual(undo, { revision: 7, by: "ann", workshop: before });
  const back = JSON.parse(JSON.stringify(before));
  assert.deepEqual(replaceWorkshop(won, back, { undo, revision: 7, userId: "ann" }), { workshop: before, undone: true });
  // Someone else, a later revision, or another board: not that Undo, so the won deal stays won.
  for (const [who, revision] of [["ben", 7], ["ann", 8]]) {
    assert.match(replaceWorkshop(won, back, { undo, revision, userId: who }).refused.reason, /won deal stays won/);
  }
  const other = change(before, (b) => { b.cards.find((c) => c.id === "bluefin").laneId = "lead"; });
  assert.ok(replaceWorkshop(won, other, { undo, revision: 7, userId: "ann" }).refused);
  // A plain workshop records no Undo; its whole saves keep its kind (review M1).
  assert.equal(recordedUndo({ version: 1, title: "Week", lanes: [], cards: [] }, 3, "ann"), null);
  const lanes = validateWorkshop({ version: 1, title: "Week", lanes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }], cards: [{ id: "x", label: "X", laneId: "a" }] });
  assert.equal(replaceWorkshop(lanes, validateWorkshop(samplePipeline()), {}).refused.reason,
    "This board is a lane workshop, and it stays one. Put another kind of workshop on a board of its own.");
  assert.ok(replaceWorkshop(lanes, { ...lanes, cards: [...lanes.cards, { id: "y", label: "Y", laneId: "b" }] }, {}).workshop);
});

test("a rename on a launch plan, pipeline or budget is the board's own edit, by its rules (review L6)", () => {
  const pipeline = validateWorkshop(samplePipeline());
  const renamed = playWorkshopChanges(pipeline, readWorkshopChanges([{ rename: { laneId: "proposal", label: "Offer" } }]));
  assert.equal(renamed.workshop.lanes.find((l) => l.id === "proposal").label, "Offer");
  const direct = applyWorkshopEdits(pipeline, [{ kind: "rename_card", card: { id: "acme" }, label: "Acme $90k" }]);
  const played = playWorkshopChanges(pipeline, readWorkshopChanges([{ rename: { cardId: "acme", label: "Acme $90k" } }]));
  if ("refused" in direct) assert.equal(played.refused.reason, direct.refused.reason);
  else assert.deepEqual(played.workshop, direct.workshop);
  const stage = applyWorkshopEdits(pipeline, [{ kind: "rename_lane", lane: { id: "won" }, label: "Lead" }]);
  const playedStage = playWorkshopChanges(pipeline, readWorkshopChanges([{ rename: { laneId: "won", label: "Lead" } }]));
  if ("refused" in stage) assert.equal(playedStage.refused.reason, stage.refused.reason);
  else assert.deepEqual(playedStage.workshop, stage.workshop);
});

test("the whole-save method uses the gate, and records the Undo with every board change (review H1, M1)", () => {
  const method = app("server/methods/creative-slates.js");
  // The gate, with the recorded Undo, the revision stored now (a stale save is said to be stale) and who saves (a rule's audit line).
  assert.match(method, /replaceWorkshop\(before, model\.workshop, \{ undo: slate\.creative\.undo \?\? null, revision, current: slate\.creative\.revision, userId: this\.userId, actor \}\)/);
  assert.match(method, /if \(replaced\.stale\) throw stale\(\)/);
  assert.doesNotMatch(method, /businessKind\(slate\.creative\.model\.workshop/);
  assert.match(method, /recordedUndo\(before\.workshop, revision \+ 1, this\.userId\)/);
  // Each board's Undo is stored on that board (boardPaths: creative.undo for the first board, boards.<id>.undo for the rest).
  // Restated 2026-11-23: the board's write moved to boardSaveWrite (slate-boards.mjs), which many-boards.test.mjs also runs.
  assert.match(method, /boardSaveWrite\(slate, stored, \{ model, revision, drawing, trades, undo \}\)/);
  assert.match(app("imports/api/common/slate-boards.mjs"), /\[paths\.undo\]: undo/);
});

test("the server names the engine build it runs, from the dist's identity stamp (review M4)", async () => {
  const { engineIdentity } = await import("../web/app/server/engine-identity.mjs");
  const { createRequire } = await import("node:module");
  const stamp = createRequire(import.meta.url)("slateboxjs/build.json");
  assert.match(stamp.commit, /^[0-9a-f]{40}$/);
  assert.equal(engineIdentity(() => stamp), `slateboxjs ${stamp.version} built from ${stamp.commit.slice(0, 12)} (${stamp.branch})${stamp.dirty ? " with uncommitted changes" : ""} at ${stamp.builtAt}.`);
  assert.equal(engineIdentity(() => { throw new Error("missing"); }), "slateboxjs: no identity stamp (built before dist/BUILD.json).");
  assert.match(app("server/main.js"), /console\.log\(engineIdentity\(\(\) => require\('slateboxjs\/dist\/BUILD\.json'\)\)\)/);
});

test("a note let go on a launch plan's days is made into a task starting that day, on the server as on the canvas", () => {
  const plan = validateWorkshop(sampleLaunchPlan());
  const drop = (day) => ({ cardId: "n7", laneId: "product", noteToCard: { noteId: "n7", label: "New task", ...(day === undefined ? {} : { day }) } });
  const [read] = readWorkshopChanges([drop(5.6)]);
  assert.equal(read.noteToCard.day, 5.6);
  const played = playWorkshopChanges(plan, [read], ["n7"]);
  assert.equal(played.refused, undefined);
  assert.equal(scheduleLaunch(played.workshop).get("n7").from, 5);
  // Without a day (a phone, the team names, an older canvas): at the start, as before.
  assert.equal(scheduleLaunch(playWorkshopChanges(plan, readWorkshopChanges([drop()]), ["n7"]).workshop).get("n7").from, 0);
  // Past launch: the last day the line lets a two-day task start.
  assert.equal(scheduleLaunch(playWorkshopChanges(plan, readWorkshopChanges([drop(40)]), ["n7"]).workshop).get("n7").to, 14);
  // A day is a calendar offset: nothing else is read.
  for (const day of [-1, "5", Infinity, 5000]) assert.throws(() => readWorkshopChanges([drop(day)]), /Expected a move or a rename/);
});
