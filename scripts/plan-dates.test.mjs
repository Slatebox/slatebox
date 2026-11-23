// A launch plan asked for with a date (“Add a launch plan for our app launching in March”) launches on
// that date. The library's plan launched on its third Friday whatever the request said (a March launch
// came out as Fri 11 Dec). The request's date is read where the plan is made: the chat's library add
// (nativeCanvas.preview), exec's add_component, and the typed plan (“Plan a launch in March”).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import "slateboxjs/workshops/behaviour";
import { validateWorkshop } from "slateboxjs/workshops/model";
import { dateName, launchPlanSample, scheduleLaunch } from "slateboxjs/workshops/rules";
import { catalogSamples as samples } from "slateboxjs/workshops/samples";
import { datedLaunchPlan, namedDay } from "../web/app/imports/api/common/plan-dates.mjs";
import { launchPlanFromBrief } from "../web/app/imports/api/common/launch-plan-brief.mjs";
import { businessBoardSaid } from "../web/app/imports/api/common/business-board-brief.mjs";
import { componentAddition } from "../web/app/imports/api/common/component-add.mjs";

const origin = "2026-11-23"; // a Monday: the library's plan made on Sat 21 Nov starts here
const on = (words) => { const day = namedDay(origin, words); return day === null ? null : dateName(origin, day); };
const plan = () => validateWorkshop(launchPlanSample("2026-11-21"));
const launch = (board) => dateName(board.clock.origin, board.launch.day);

test("the day a request names: a month, a day and month either way round, an ISO date, early, mid and late", () => {
  assert.equal(on("launching in March"), "Mon 1 Mar");
  assert.equal(on("for the 12 March launch"), "Fri 12 Mar");
  assert.equal(on("ship on March 12th"), "Fri 12 Mar");
  assert.equal(on("go live by 2027-03-05"), "Fri 5 Mar");
  assert.equal(on("mid-April"), "Thu 15 Apr");
  assert.equal(on("late March"), "Wed 31 Mar");
  assert.equal(on("by the end of May 2027"), "Mon 31 May");
  assert.equal(on("Dec 31"), "Thu 31 Dec");
  // A month alone needs a word that says when: “we may” is not May.
  assert.equal(on("we may launch soon"), null);
  assert.equal(on("for our app"), null);
  assert.equal(on("31 February"), null);
});

test("the library's launch plan launches on that day; past 120 days its start moves by whole weeks, still a Monday", () => {
  assert.equal(launch(plan()), "Fri 11 Dec");
  const march = datedLaunchPlan(plan(), "launching in March");
  assert.equal(launch(march), "Mon 1 Mar");
  assert.equal(march.clock.origin, origin);
  assert.deepEqual(march.cards, plan().cards, "its tasks are as they were");
  const june = datedLaunchPlan(plan(), "launching in June");
  assert.equal(launch(june), "Tue 1 Jun");
  assert.equal(new Date(june.clock.origin + "T00:00:00Z").getUTCDay(), 1);
  assert.ok(june.launch.day <= 120);
  // Too soon for its tasks: the first day they all end by, never a plan that breaks its line.
  const soon = datedLaunchPlan(plan(), "launching 1 Dec");
  assert.equal(soon.launch.day, Math.max(...[...scheduleLaunch(soon).values()].map((t) => t.to)));
  // No date, or one already past: the plan as it was.
  assert.deepEqual(datedLaunchPlan(plan(), "for our app"), plan());
  assert.deepEqual(datedLaunchPlan(plan(), "by 2026-01-05"), plan());
});

test("exec's add_component and the typed plan read the date too, and the kept line says it", () => {
  const added = componentAddition({ nodes: [] }, { component: "launch-plan", topic: "our app launching in March" }, samples);
  assert.equal(dateName(added.workshop.clock.origin, added.workshop.launch.day).slice(-3), "Mar");
  for (const typed of ["Plan a launch in March", "Make a launch plan launching 12 March"]) {
    const board = launchPlanFromBrief(typed);
    assert.match(launch(board), /Mar$/, typed);
    assert.match(businessBoardSaid(board), /· launch \w{3} \d{1,2} Mar$/);
  }
  // What it read before is read as before.
  assert.equal(launchPlanFromBrief("Plan a launch in 20 days").launch.day, 20);
  assert.throws(() => launchPlanFromBrief("Make a launch plan for the team"), /Name the tasks with their days/);
});

test("the chat's library add dates the plan it previews, so Keep keeps that date", () => {
  const preview = readFileSync(new URL("../web/app/server/methods/native-conversation.js", import.meta.url), "utf8");
  assert.match(preview, /if\(draft\.component\) draft=\{\.\.\.draft,workshop:datedLaunchPlan\(draft\.workshop,message\)\}/);
  // Dated before the preview is stored: Keep saves p.draft.workshop, the board the preview showed.
  assert.ok(preview.indexOf("datedLaunchPlan(draft.workshop,message)") < preview.indexOf("this.connection.slateboxNativeCanvasDraft={"));
});
