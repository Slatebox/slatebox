// Building a smart component (library spec §4): the builder's links and first-turn shapes, a component grown on a
// builder slate by the same edits chat and exec make, a branch that keeps its parent's category, the board's rule
// controls saved through the canvas's own door (stamped 'canvas', never mixed with a move), "Yours" right after a
// save, a community component added beside a slate's boards (preview, then save), and Submit landing in the queue.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { validateWorkshop, workshopCandidate } from "slateboxjs/workshops/model";
import "slateboxjs/workshops/behaviour";
import "slateboxjs/workshops/rules";
import { catalogAddRequest, catalogPreset } from "slateboxjs/catalog";
import { catalogSamples as samples } from "slateboxjs/workshops/samples";
import { RULE_CONTROL_EDITS, ruleControls } from "slateboxjs/workshops/controls";
import { makeExecWorld } from "./exec-test-world.mjs";
import { principalFromUser } from "../web/app/server/actions/principal.mjs";
import { API_TOKEN_SCOPES } from "../web/app/server/api-token-core.mjs";
import { ownEntries, listedEntries, searchEntries, setLibraryItems, entryOfItem } from "../web/app/imports/api/common/library.mjs";
import { nativeRequestKind } from "../web/app/imports/api/common/native-canvas-conversation.mjs";
import { workshopFromLaneBrief } from "../web/app/imports/api/common/native-lane-brief.mjs";
import { proposeLaneReply } from "../web/app/imports/api/common/lane-conversation.mjs";
import "../web/app/imports/api/common/board-chat.mjs";
import { CANVAS_RULE_EDITS, RULES_ALONE, playWorkshopChanges, readWorkshopChanges } from "../web/app/server/methods/workshop-play.mjs";
import { BUILD_SHAPES, buildBarWords, buildFirstTurn, buildLink, readBuildHash, readSaveSheet, readSynonyms } from "../web/app/imports/ui/components/library/build/buildTurns.mjs";

const app = (path) => readFileSync(new URL("../web/app/" + path, import.meta.url), "utf8");

async function setup(t) {
  const world = makeExecWorld();
  t.after(() => world.close());
  await world.libraryReady;
  world.users.docs.push({ _id: "guest1", isAnonymous: true });
  const person = (userId) => principalFromUser(world.users.docs.find((user) => user._id === userId), API_TOKEN_SCOPES);
  const run = (principal, id, input, options) => world.registry.run(principal, id, input, options).then((result) => result.body);
  return { world, person, run };
}
const boardOf = (world, shareId, id = "main") => {
  const slate = world.slate(shareId);
  return id === "main" ? slate.creative?.model?.workshop : slate.boards?.[id]?.model?.workshop;
};

test("the builder's links: /new#build starts from scratch, /new#build=<item> branches; nothing else is a builder", () => {
  assert.deepEqual(readBuildHash("#build"), { itemId: "new" });
  assert.deepEqual(readBuildHash("#build="), { itemId: "new" });
  assert.deepEqual(readBuildHash("#build=builtin-retro"), { itemId: "builtin-retro" });
  assert.deepEqual(readBuildHash("#build=weekly-retro-a1b2c3"), { itemId: "weekly-retro-a1b2c3" });
  for (const other of ["", "#brief=Plan", "#build=../x", "#build=a b", "#builder", "#build=retro&brief=x"]) assert.equal(readBuildHash(other), null, other);
  assert.equal(buildLink(), "/new#build");
  assert.equal(buildLink("builtin-retro"), "/new#build=builtin-retro");
  // NewCreativeSlate reads the hash before any brief (a build link never reaches the brief reader, which refuses unknown options).
  const page = app("imports/ui/pages/NewCreativeSlate.jsx");
  assert.match(page, /readBuildHash\(hash\)/);
  assert.match(page, /libraryApi\.branch\(\{ itemId \}\)/);
});

test("each first-turn shape is a plain chat message read on the slate, with no AI, as the board it names", () => {
  // No 2 by 2 until its square has controls of its own (a corner's badge to drag), so every start offered has controls that mean something.
  assert.deepEqual(BUILD_SHAPES.map((shape) => shape.label), ["Columns", "Lists in lists", "A tree", "A timeline"]);
  for (const shape of BUILD_SHAPES) {
    assert.equal(nativeRequestKind(shape.message), shape.kind, shape.label);
    if (shape.kind === "lanes") {
      const board = workshopFromLaneBrief(shape.message);
      assert.deepEqual(board.lanes.map((lane) => lane.label), ["To do", "Doing", "Done"]);
      continue;
    }
    const asked = catalogAddRequest(shape.message);
    assert.ok(asked, shape.label);
    const board = catalogPreset(asked.id, undefined, samples);
    assert.equal(board.kind ?? "lanes", shape.makes, shape.label);
    if (shape.layout) assert.equal(board.nest?.layout, shape.layout, shape.label);
  }
  // From scratch the first turn offers them; a branch says whose copy it is instead.
  assert.equal(buildFirstTurn({ mode: "build" }).shapes, BUILD_SHAPES);
  const branch = buildFirstTurn({ mode: "build", parent: { itemId: "builtin-retro", version: 1, title: "Retro", category: "meetings" } });
  assert.deepEqual([branch.title, branch.line, branch.shapes.length], ["This is your copy of Retro.", "Change anything: say it, or drag the controls on the board.", 0]);
  assert.deepEqual(buildBarWords({ library: { mode: "build", parent: { title: "Retro", category: "meetings" } }, title: "", status: "submitted" }),
    { heading: "Building a smart component", title: "Untitled", from: "Branched from Retro (Meetings)", category: "Meetings (from Retro)", state: "Submitted for review" });
});

test("the save sheet: a name and one line; a category to submit; a branch never sends one (the server fills in its parent's)", () => {
  assert.deepEqual(readSaveSheet({ title: " ", summary: "x" }), { problem: "Give it a name.", field: "title" });
  assert.deepEqual(readSaveSheet({ title: "Mine", summary: "" }), { problem: "Say in one line what it does.", field: "summary" });
  assert.deepEqual(readSaveSheet({ title: "Mine", summary: "Does it" }, { submitting: true }), { problem: "Pick a category, so people can find it.", field: "category" });
  assert.deepEqual(readSaveSheet({ title: "Mine", summary: "Does it" }), { input: { title: "Mine", summary: "Does it" } });
  assert.deepEqual(readSaveSheet({ title: "Mine", summary: "Does it", category: "plan", synonyms: "standup, Standup, sprint", note: "Hi" }, { submitting: true }),
    { input: { title: "Mine", summary: "Does it", category: "plan", synonyms: ["standup", "sprint"] }, note: "Hi" });
  assert.deepEqual(readSaveSheet({ title: "Mine", summary: "Does it", category: "plan" }, { locked: "meetings", submitting: true }), { input: { title: "Mine", summary: "Does it" } });
  assert.equal(readSynonyms(Array.from({ length: 20 }, (_, i) => "w" + i).join(",")).length, 12);
});

test("from scratch: a builder slate grows a board by the edits chat and exec make, saves it as a draft, and it is under Yours at once", async (t) => {
  const { world, person, run } = await setup(t);
  const ada = person("owner");
  const { shareId } = await run(ada, "library.branch", { itemId: "new" });
  assert.deepEqual(world.slate(shareId).library, { mode: "build" });
  await assert.rejects(run(ada, "library.saveDraft", { shareId, title: "Empty", summary: "x" }), { code: "no_board" });
  // The first shape (the chat's Keep of a board, or exec's add_component: the same core) puts the board on the slate.
  // exec (an agent of Ada's) makes the same changes the chat keeps.
  const agent = await world.principalFor(["slates:read", "slates:write"]);
  await run(agent, "slates.applyOperations", { shareId, plan: { message: "Add a team board", operations: [{ kind: "add_component", component: "team-board", expectedRevision: world.slate(shareId).revision ?? 0 }] } },
    { idempotencyKey: "00000000-0000-4000-8000-000000000001" });
  const grown = boardOf(world, shareId);
  assert.ok(grown?.lanes.length >= 3);
  // Each turn grows it: a rule said in chat is the edit exec makes.
  const said = proposeLaneReply(grown, "Let Done hold 4", null, { by: "Ada" });
  assert.ok(said.workshop, said.reply);
  const edits = [{ kind: "add_rule", rule: { kind: "capacity", where: "done", max: 4 } }];
  assert.deepEqual(said.workshop.behaviour.rules.filter((rule) => rule.where === "done").map((rule) => rule.max), [4]);
  await run(agent, "slates.applyOperations", { shareId, plan: { message: "Let Done hold 4", operations: [{ kind: "workshop_edits", edits, expectedRevision: world.slate(shareId).creative.revision }] } },
    { idempotencyKey: "00000000-0000-4000-8000-000000000002" });
  const ruled = boardOf(world, shareId);
  assert.ok(ruled.behaviour.rules.some((rule) => rule.kind === "capacity" && rule.where === "done" && rule.max === 4));
  const saved = await run(ada, "library.saveDraft", { shareId, title: "Two at a time", summary: "A team board where Doing holds two", category: "track" });
  assert.equal(saved.status, "draft");
  // Yours: the draft is listed right after the save, with the board it saved.
  const mine = await run(ada, "library.mine", {});
  const item = mine.items.find((row) => row.id === saved.itemId);
  assert.deepEqual([item.title, item.status, item.category], ["Two at a time", "draft", "track"]);
  setLibraryItems({ own: mine.items, community: [] });
  assert.deepEqual(ownEntries().map((entry) => [entry.name, entry.status, entry.own]), [["Two at a time", "draft", true]]);
  assert.deepEqual(ownEntries("track").length, 1);
  assert.deepEqual(ownEntries("plan").length, 0);
  // The person's own are never listed twice (not among the community components).
  assert.ok(!listedEntries().some((entry) => entry.itemId === saved.itemId));
  setLibraryItems({});
});

test("a branch keeps its parent's category: inherited on save, 409 when changed, locked through submit", async (t) => {
  const { world, person, run } = await setup(t);
  const ada = person("owner"), root = person("admin");
  const { shareId } = await run(ada, "library.branch", { itemId: "builtin-retro" });
  const library = world.slate(shareId).library;
  assert.deepEqual(library.parent, { itemId: "builtin-retro", version: 1, title: "Retro", category: "meetings" });
  assert.deepEqual(buildBarWords({ library }).category, "Meetings (from Retro)");
  await assert.rejects(run(ada, "library.saveDraft", { shareId, title: "Our retro", summary: "Three columns", category: "plan" }),
    { code: "category_locked", message: "A branch stays in its parent's category, Meetings." });
  const saved = await run(ada, "library.saveDraft", { shareId, title: "Our retro", summary: "Went well, change, try, with a vote" });
  const item = world.library.items.docs.find((doc) => doc._id === saved.itemId);
  assert.deepEqual([item.category, item.categoryLocked, item.provenance.branchedFrom.title], ["meetings", true, "Retro"]);
  await assert.rejects(run(ada, "library.submit", { kind: "component", itemId: saved.itemId, category: "decide" }), { code: "category_locked" });
  const sent = await run(ada, "library.submit", { kind: "component", itemId: saved.itemId, note: "Please look" });
  assert.equal(sent.status, "submitted");
  // Submit lands in the owner's queue (waiting), with the author's note.
  const queue = await run(root, "library.review.queue", {});
  const row = queue.items.find((entry) => entry.id === saved.itemId);
  assert.ok(row, "the submission is in the queue");
  assert.equal(row.kind, "component");
  assert.equal(world.library.events.docs.filter((event) => event.itemId === saved.itemId && event.type === "submitted")[0].message, "Please look");
});

test("a guest builds and saves, and is asked to sign up to submit", async (t) => {
  const { world, run } = await setup(t);
  const guest = principalFromUser(world.users.docs.find((user) => user._id === "guest1"), API_TOKEN_SCOPES);
  const { shareId } = await run(guest, "library.branch", { itemId: "builtin-pros-cons" });
  const saved = await run(guest, "library.saveDraft", { shareId, title: "Pros, cons and a verdict", summary: "Pros and cons with a verdict column" });
  await assert.rejects(run(guest, "library.submit", { kind: "component", itemId: saved.itemId }), { code: "sign_in_to_publish" });
});

// A board of columns with a limit line on Doing: the controls the canvas draws, as the layer would place them.
const team = () => validateWorkshop({ ...catalogPreset("team-board"), cards: [
  { id: "billing", label: "Billing", laneId: "todo" }, { id: "search", label: "Search", laneId: "todo" }, { id: "export", label: "Export", laneId: "doing" },
] });
const layoutOf = (board) => ({ places: board.lanes.map((lane, index) => ({ laneId: lane.id, x: index * 240, y: 0, width: 228, height: 400, row: 0 })), width: board.lanes.length * 240, height: 400 });

test("a rule control's drag is saved through the canvas's door, stamped 'canvas', and the next drag obeys it", () => {
  assert.deepEqual([...CANVAS_RULE_EDITS], [...RULE_CONTROL_EDITS]);
  const board = team();
  const line = ruleControls(board, layoutOf(board)).find((control) => control.primitive === "capacity" && control.anchor.id === "doing" && control.gestures.drag);
  assert.ok(line, "Doing has a limit line");
  // Drag the line to one card (up by the slots between its limit and 1).
  const before = line.state.value ?? 3;
  const edits = line.gestures.drag({ dx: 0, dy: -(before - 1) * (line.gestures.step ?? 88) });
  assert.ok(edits.length);
  const changes = readWorkshopChanges([{ edits }]);
  const saved = playWorkshopChanges(board, changes, undefined, undefined, { by: "Ada" });
  assert.ok(saved.workshop, saved.refused?.reason);
  const rule = saved.workshop.behaviour.rules.find((item) => item.kind === "capacity" && item.where === "doing");
  assert.deepEqual([rule.max, rule.set.by, rule.set.via], [1, "Ada", "canvas"]);
  // The next drag obeys it: Doing holds Export, so Search can't go in; a move into To do still can.
  assert.equal(workshopCandidate(saved.workshop, "search", "doing"), null);
  const refused = playWorkshopChanges(saved.workshop, [{ cardId: "search", laneId: "doing" }]);
  assert.equal(refused.refused.laneId, "doing");
  const onward = playWorkshopChanges(saved.workshop, [{ cardId: "export", laneId: "review" }]);
  assert.ok(onward.workshop, onward.refused?.reason);
  // The control and chat make the same rule (the control is the picture of the rule).
  const chat = proposeLaneReply(board, "Doing holds 1", null, { by: "Ada" }).workshop.behaviour.rules.find((item) => item.kind === "capacity" && item.where === "doing");
  const body = ({ id, set, ...rest }) => rest;
  assert.deepEqual(body(rule), body(chat));
});

test("a change of the rules is never mixed with a move or a rename, so each is one save and one undo", () => {
  const board = team();
  const rule = { edits: [{ kind: "add_rule", rule: { kind: "bin", lane: "done" } }] };
  const mixed = playWorkshopChanges(board, readWorkshopChanges([rule, { cardId: "search", laneId: "doing" }]), undefined, undefined, { by: "Ada" });
  assert.deepEqual(mixed.refused, { reason: RULES_ALONE, laneId: null });
  assert.equal(mixed.at, 1);
  assert.throws(() => readWorkshopChanges([{ ...rule, rename: { title: "Renamed" } }]), new RegExp(RULES_ALONE));
  assert.throws(() => readWorkshopChanges([{ edits: [...rule.edits, { kind: "move_card", card: { id: "search" }, lane: { id: "doing" } }] }]), new RegExp(RULES_ALONE));
  // Two rule changes in a row are each their own request: the page sends a change of the rules alone.
  const page = app("imports/ui/components/workshop/useWorkshopOnCanvas.js");
  // Restated (prod's first-class undo): a rule change is played alone, as a move made anyway is, and is queued as a step
  // of the person's undo history (queueChange), so the canvas's Undo takes it back.
  assert.match(page, /const alone = queue\.current\.findIndex\(change => change\.override \|\| isRuleChange\(change\)\)/);
  assert.match(page, /const changes = queue\.current\.splice\(0, alone === 0 \? 1 :/);
  assert.match(page, /ruleSaid\.current\.set\(change, [^\n]+\n[^\n]*\n\s*queueChange\(change\)/);
  // Whatever audit line the page sends, the server's is kept.
  const forged = { edits: [{ kind: "add_rule", rule: { kind: "bin", lane: "done" }, set: { by: "Mallory", via: "preset" } }] };
  const made = playWorkshopChanges(board, readWorkshopChanges([forged]), undefined, undefined, { by: "Ada" });
  if (made.workshop) assert.deepEqual(made.workshop.behaviour.rules.at(-1).set.via, "canvas");
});

test("a rule control works on every board that takes rules: a pipeline's padlock, a plan's snap, a nested board's ladder", () => {
  for (const id of ["sales-pipeline", "launch-plan", "sort-evidence", "break-down-problem"]) {
    const board = validateWorkshop(catalogPreset(id, undefined, samples));
    const controls = ruleControls(board, layoutOf(board));
    const tap = controls.find((control) => control.gestures.tap?.length && control.gestures.tap.every((edit) => ["add_rule", "set_rule", "remove_rule"].includes(edit.kind)));
    assert.ok(tap, id + " shows a rule control");
    const saved = playWorkshopChanges(board, readWorkshopChanges([{ edits: tap.gestures.tap }]), undefined, undefined, { by: "Ada" });
    assert.ok(saved.workshop, id + ": " + saved.refused?.reason);
    assert.ok(saved.workshop.behaviour.rules.every((rule) => rule.set.via !== "canvas" || rule.set.by === "Ada"), id);
  }
});

test("a community component: listed after the built-ins, added beside a slate's boards by library.fork (preview, then save)", async (t) => {
  const { world, person, run } = await setup(t);
  const ada = person("owner"), ben = person("other"), root = person("admin");
  const { shareId } = await run(ada, "library.branch", { itemId: "builtin-team-board" });
  const saved = await run(ada, "library.saveDraft", { shareId, title: "Swarm board", summary: "Everyone on one card at a time" });
  await run(ada, "library.submit", { kind: "component", itemId: saved.itemId });
  await run(root, "library.review.open", { itemId: saved.itemId });
  await run(root, "library.review.approve", { itemId: saved.itemId });
  const listed = await run(ben, "library.list", { kind: "component", origin: "user" });
  setLibraryItems({ community: listed.items, own: [] });
  const entries = listedEntries();
  const community = entries.find((entry) => entry.itemId === saved.itemId);
  assert.ok(community, "the published component is listed");
  assert.ok(entries.indexOf(community) >= 19, "after the built-ins");
  assert.deepEqual([community.addSay[0], community.authorName, community.group], ["Add Swarm board", "Ada", "track"]);
  assert.deepEqual(searchEntries("swarm").map((entry) => entry.itemId), [saved.itemId]);
  // Ben adds it to a slate of his that holds a board: a preview first (where it goes), then the save.
  const own = await run(ben, "library.branch", { itemId: "builtin-retro" });
  const target = world.slate(own.shareId);
  const preview = await run(ben, "library.fork", { itemId: saved.itemId, targetShareId: own.shareId, mode: "preview" });
  assert.ok(preview.canvas?.workshop);
  assert.equal(Object.keys(world.slate(own.shareId).boards ?? {}).length, Object.keys(target.boards ?? {}).length, "a preview saves nothing");
  const made = await run(ben, "library.fork", { itemId: saved.itemId, targetShareId: own.shareId, expectedRevision: preview.revision });
  assert.equal(made.boardId, preview.boardId);
  assert.ok(boardOf(world, own.shareId, made.boardId), "the board is on the slate");
  assert.equal(world.library.items.docs.find((doc) => doc._id === saved.itemId).counts.adds, 1);
  setLibraryItems({});
  assert.equal(entryOfItem({ id: "x", title: "", summary: "s" }).name, "Untitled");
});

test("no HTML overlay draws a control: the page lends the board its controls and saves their edits as a play change", () => {
  const page = app("imports/ui/components/workshop/useWorkshopOnCanvas.js");
  assert.match(page, /import\('slateboxjs\/workshops\/controls'\)/);
  assert.match(page, /onRuleEdit\(edits, sentence\)/);
  assert.match(app("imports/ui/pages/Canvas.jsx"), /controls: nativeBoard\?\.library\?\.mode === 'build' \? 'always' : 'selected'/);
  for (const file of ["imports/ui/components/library/build/BuildBar.jsx", "imports/ui/components/library/build/SaveSheet.jsx"]) {
    assert.doesNotMatch(app(file), /ruleControls|drawRuleControls/, file + " draws no control");
  }
});

// aicontrol fixes (2026-11-24): submitting asks someone with no name on their account how to credit them,
// saves it to their profile, and the item credits that name. A guest can't submit at all.
test("submit asks for a name when the account has none, saves it to the profile, and the item credits it", async (t) => {
  const { CREDIT_QUESTION, needsCreditName, readCreditName, UNNAMED_AUTHOR } = await import("../web/app/imports/api/common/library-model.mjs");
  assert.equal(CREDIT_QUESTION, "How should we credit you?");
  assert.equal(needsCreditName({ _id: "a", profile: {} }), true);
  assert.equal(needsCreditName({ _id: "a", profile: { firstName: " ", lastName: "" } }), true);
  assert.equal(needsCreditName({ _id: "a", profile: { firstName: "Ada" } }), false);
  assert.equal(needsCreditName({ _id: "g", isAnonymous: true }), false, "a guest is asked to sign up instead");
  assert.equal(needsCreditName(null), false);
  assert.deepEqual(readCreditName("  Ada   Lovelace "), { firstName: "Ada", lastName: "Lovelace", name: "Ada Lovelace" });
  assert.deepEqual(readCreditName("Prince"), { firstName: "Prince", lastName: "", name: "Prince" });
  assert.match(readCreditName(" ").problem, /credit you/);
  assert.match(readCreditName("ada@example.com").problem, /email/);
  // The sheet asks only to submit, only when asked to, and the answer travels with the submit.
  const sheet = { title: "Mine", summary: "Does it", category: "plan" };
  assert.deepEqual(readSaveSheet(sheet, { submitting: true, askName: true }), { problem: "Say how we should credit you: a name or a nickname.", field: "credit" });
  assert.deepEqual(readSaveSheet({ ...sheet, credit: "Ada Lovelace" }, { submitting: true, askName: true }), { input: { title: "Mine", summary: "Does it", category: "plan" }, credit: "Ada Lovelace" });
  assert.deepEqual(readSaveSheet({ ...sheet, credit: "Ada Lovelace" }, { submitting: true }), { input: { title: "Mine", summary: "Does it", category: "plan" } });
  assert.deepEqual(readSaveSheet(sheet, { askName: true }), { input: { title: "Mine", summary: "Does it", category: "plan" } }, "Save never asks");

  // The server credits the profile's name at submit: none yet is "A Slatebox user"; once saved, that name.
  const users = { owner: { name: "" } };
  const world = makeExecWorld({ library: { users } });
  t.after(() => world.close());
  await world.libraryReady;
  world.users.docs.push({ _id: "guest1", isAnonymous: true });
  const person = (userId) => principalFromUser(world.users.docs.find((user) => user._id === userId), API_TOKEN_SCOPES);
  const run = (principal, id, input) => world.registry.run(principal, id, input).then((result) => result.body);
  const ada = person("owner");
  const { shareId } = await run(ada, "library.branch", { itemId: "retro" });
  const draft = await run(ada, "library.saveDraft", { shareId, title: "Credit retro", summary: "Went well, change, try", category: "meetings" });
  await run(ada, "library.submit", { kind: "component", itemId: draft.itemId });
  const item = () => world.library.items.docs.find((doc) => doc._id === draft.itemId);
  assert.equal(item().authorName, UNNAMED_AUTHOR);
  await run(ada, "library.withdraw", { itemId: draft.itemId });
  users.owner.name = [readCreditName("Ada Lovelace").firstName, readCreditName("Ada Lovelace").lastName].join(" ");
  await run(ada, "library.submit", { kind: "component", itemId: draft.itemId });
  assert.equal(item().authorName, "Ada Lovelace");
  // A guest can't submit (they are asked to sign up), and can't name a profile they don't have.
  const guest = person("guest1");
  const { shareId: guestShare } = await run(guest, "library.branch", { itemId: "retro" });
  const guestDraft = await run(guest, "library.saveDraft", { shareId: guestShare, title: "Guest retro", summary: "x" });
  await assert.rejects(run(guest, "library.submit", { kind: "component", itemId: guestDraft.itemId }), { status: 403, code: "sign_in_to_publish" });

  // The app: the method saves the name to the profile (never for a guest), the meteor loadUser reads it back,
  // and both submit surfaces ask before they send.
  const app = (path) => readFileSync(new URL("../web/app/" + path, import.meta.url), "utf8");
  const users_js = app("server/methods/users.js");
  const method = users_js.slice(users_js.indexOf("method[CONSTANTS.methods.users.setCreditName]"), users_js.indexOf("method[CONSTANTS.methods.users.certifyForEducation]"));
  assert.match(method, /if \(user\.isAnonymous\) throw new Meteor\.Error\('sign_in_to_publish'/);
  assert.match(method, /\$set: \{ 'profile\.firstName': read\.firstName, 'profile\.lastName': read\.lastName \}/);
  assert.match(app("server/library/meteor.js"), /\[user\.profile\?\.firstName, user\.profile\?\.lastName\]/);
  const builder = app("imports/ui/components/library/build/useBuilder.js");
  assert.ok(builder.indexOf("Meteor.callAsync('users.setCreditName', credit)") > 0 && builder.indexOf("Meteor.callAsync('users.setCreditName', credit)") < builder.indexOf("libraryApi.submit("), "the name is saved before the submit");
  assert.match(app("imports/ui/components/library/build/SaveSheet.jsx"), /submitting && askName && <TextField label=\{CREDIT_QUESTION\}/);
  const dialog = app("imports/ui/components/library/PublishDialog.jsx");
  assert.match(dialog, /askName && <TextField label=\{CREDIT_QUESTION\}/);
  assert.ok(dialog.indexOf("Meteor.callAsync('users.setCreditName', credited.name)") < dialog.indexOf("libraryApi.submit("));
});
