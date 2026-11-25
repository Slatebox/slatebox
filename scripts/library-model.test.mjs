// The shared library's pure model: kinds and categories, the metadata limits, slugs, the one
// lifecycle table and who may read an item.
import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogGroups } from "slateboxjs/catalog";
import {
  LIBRARY_CATEGORIES, LIBRARY_KINDS, LIBRARY_LICENSE, LIFECYCLE, LISTED_KINDS, canReadItem, categoryLockSentence, nextStatus, readMessage, readMeta,
  reviewStateOf, slugify, transition,
} from "../web/app/imports/api/common/library-model.mjs";

test("the categories are the engine catalogue's groups less All; the kinds are four, three listed (an integration is a gallery card)", () => {
  assert.deepEqual(LIBRARY_CATEGORIES, catalogGroups.map((group) => group.id).filter((id) => id !== "all"));
  assert.deepEqual(LIBRARY_KINDS, ["component", "slate", "presentation", "integration"]);
  assert.deepEqual(LISTED_KINDS, ["component", "slate", "presentation"]);
  assert.equal(LIBRARY_LICENSE, "CC-BY-4.0");
  assert.equal(categoryLockSentence("decide"), "A branch stays in its parent's category, Decide.");
});

test("metadata is plain text within its limits; a missing title or summary is named", () => {
  assert.deepEqual(readMeta({ title: "  Weekly <b>retro</b> ", summary: "Went well,\n change, try", category: "meetings", synonyms: ["retro", "Retro", "look back"] }),
    { title: "Weekly retro", summary: "Went well, change, try", category: "meetings", synonyms: ["retro", "look back"] });
  assert.throws(() => readMeta({ summary: "x" }), { status: 400, details: { field: "title" } });
  assert.throws(() => readMeta({ title: "x" }), { status: 400, details: { field: "summary" } });
  assert.throws(() => readMeta({ title: "x".repeat(81), summary: "y" }), { status: 400, details: { field: "title" } });
  assert.throws(() => readMeta({ title: "x", summary: "y".repeat(161) }), { status: 400, details: { field: "summary" } });
  assert.throws(() => readMeta({ title: "x", summary: "y", description: "z".repeat(2001) }), { status: 400, details: { field: "description" } });
  assert.throws(() => readMeta({ title: "x", summary: "y", category: "all" }), { status: 400, details: { field: "category" } });
  assert.throws(() => readMeta({ title: "x", summary: "y", synonyms: Array(13).fill("a") }), { status: 400, details: { field: "synonyms" } });
  assert.throws(() => readMeta({ title: "x", summary: "y", synonyms: ["a".repeat(41)] }), { status: 400, details: { field: "synonyms" } });
  assert.throws(() => readMeta({ title: "x", summary: "y", synonyms: ["a"] }, { kind: "slate" }), { status: 400, details: { field: "synonyms" } });
  // An edit reads only what it is given, and never blanks a title.
  assert.deepEqual(readMeta({ category: "plan" }, { partial: true }), { category: "plan" });
  assert.throws(() => readMeta({ title: "   " }, { partial: true }), { status: 400, details: { field: "title" } });
  assert.throws(() => readMessage(""), { code: "message_required" });
  assert.equal(readMessage(undefined, { required: false }), undefined);
  assert.throws(() => readMessage("m".repeat(2001)), { status: 400 });
});

test("a slug is the title's words and the start of the id; it never carries markup or spaces", () => {
  assert.equal(slugify("Weekly Retro: Q3!", "AbC123xyz"), "weekly-retro-q3-abc123");
  assert.equal(slugify("Café déjà vu", "zz9"), "cafe-deja-vu-zz9");
  assert.equal(slugify("<>", "id1"), "item-id1");
  assert.match(slugify("x".repeat(200), "abcdef"), /^x{60}-abcdef$/);
});

test("the lifecycle table: every allowed step, and what it refuses", () => {
  const allowed = [
    [null, "saveDraft", "author", "draft"], ["draft", "saveDraft", "author", "draft"],
    [null, "submit", "author", "submitted"], ["draft", "submit", "author", "submitted"], ["changes_requested", "submit", "author", "submitted"],
    ["rejected", "submit", "author", "submitted"], ["unpublished", "submit", "author", "submitted"], ["published", "submit", "author", "published"],
    ["submitted", "withdraw", "author", "draft"], ["published", "withdraw", "author", "unpublished"], ["draft", "discard", "author", "gone"],
    ["submitted", "review.open", "reviewer", "in_review"], ["changes_requested", "review.open", "reviewer", "in_review"], ["in_review", "review.open", "reviewer", "in_review"],
    ["in_review", "review.requestChanges", "reviewer", "changes_requested"], ["in_review", "review.approve", "reviewer", "published"],
    ["in_review", "review.reject", "reviewer", "rejected"], ["submitted", "review.reject", "reviewer", "rejected"],
    ["published", "review.unpublish", "reviewer", "unpublished"],
  ];
  for (const [from, action, role, to] of allowed) assert.equal(nextStatus(from, action, role), to, `${from} ${action}`);
  const refused = [
    ["submitted", "submit", "author"], ["in_review", "submit", "author"], ["in_review", "withdraw", "author"], ["submitted", "discard", "author"],
    ["published", "discard", "author"], ["submitted", "review.approve", "reviewer"], ["draft", "review.open", "reviewer"],
    ["changes_requested", "review.approve", "reviewer"], ["rejected", "review.unpublish", "reviewer"], ["draft", "review.reject", "reviewer"],
    // Roles do not cross: an author never approves, a reviewer never submits for someone.
    ["in_review", "review.approve", "author"], ["draft", "submit", "reviewer"],
  ];
  for (const [from, action, role] of refused) assert.equal(nextStatus(from, action, role), null, `${from} ${action} ${role}`);
  assert.ok(LIFECYCLE.length >= 10);
});

test("an update to a published item is reviewed beside it: the item stays published until the update is approved", () => {
  const live = { status: "published", publishedVersion: 2 };
  const submitted = transition(live, "submit", "author");
  assert.deepEqual(submitted, { status: "published", reviewStatus: "submitted" });
  const waiting = { ...live, ...submitted, pendingVersion: 3 };
  assert.equal(reviewStateOf(waiting), "submitted");
  const opened = transition(waiting, "review.open", "reviewer");
  assert.deepEqual(opened, { status: "published", reviewStatus: "in_review" });
  assert.deepEqual(transition({ ...waiting, ...opened }, "review.requestChanges", "reviewer"), { status: "published", reviewStatus: "changes_requested" });
  assert.deepEqual(transition({ ...waiting, ...opened }, "review.reject", "reviewer"), { status: "published", reviewStatus: "rejected" });
  assert.deepEqual(transition({ ...waiting, ...opened }, "review.approve", "reviewer"), { status: "published", reviewStatus: null });
  // Unpublishing takes the item down whatever is waiting.
  assert.deepEqual(transition({ ...waiting, ...opened }, "review.unpublish", "reviewer"), { status: "unpublished", reviewStatus: null });
  // A published item with nothing waiting has nothing to review.
  assert.equal(transition(live, "review.approve", "reviewer"), null);
  assert.equal(transition(live, "review.open", "reviewer"), null);
});

test("published is public; anything else only its author and reviewers read", () => {
  for (const status of ["draft", "submitted", "in_review", "changes_requested", "rejected", "unpublished"]) {
    const item = { status, authorId: "ann" };
    assert.equal(canReadItem(item, {}), false, status);
    assert.equal(canReadItem(item, { userId: "ben" }), false, status);
    assert.equal(canReadItem(item, { userId: "ann" }), true, status);
    assert.equal(canReadItem(item, { userId: "ben", reviewer: true }), true, status);
  }
  assert.equal(canReadItem({ status: "published", authorId: "ann" }, {}), true);
  assert.equal(canReadItem(null, { reviewer: true }), false);
});

test("the refine grammar answers renames, categories and summaries without AI; every proposal is checked against the item", async () => {
  const { localRefinement, checkProposal } = await import("../web/app/server/library/refine.mjs");
  assert.deepEqual(localRefinement("rename it to \"Weekly retro\""), { reply: "Rename it to \"Weekly retro\".", meta: { title: "Weekly retro" } });
  assert.deepEqual(localRefinement("Call it Team board."), { reply: "Rename it to \"Team board\".", meta: { title: "Team board" } });
  assert.deepEqual(localRefinement("put it in Decide"), { reply: "Put it in Decide.", meta: { category: "decide" } });
  assert.deepEqual(localRefinement("category: meetings"), { reply: "Put it in Meetings.", meta: { category: "meetings" } });
  assert.equal(localRefinement("put it in Space").meta, undefined, "an unknown category is answered with the list, and changes nothing");
  assert.deepEqual(localRefinement("summary: Three columns, one rule"), { reply: "Use this one-line summary.", meta: { summary: "Three columns, one rule" } });
  assert.equal(localRefinement("What should I check?"), null);
  const item = { kind: "component", title: "Retro", summary: "x", category: "meetings", categoryLocked: true };
  assert.deepEqual(checkProposal(item, { reply: "ok", meta: { title: "Retro" } }).diff.meta, {}, "no change is no change");
  assert.deepEqual(checkProposal(item, { reply: "ok", meta: { title: "Team retro" } }).diff.meta, { title: ["Retro", "Team retro"] });
  assert.throws(() => checkProposal(item, { meta: { category: "plan" } }), { status: 409, code: "category_locked" });
  assert.throws(() => checkProposal(item, { meta: { title: "x".repeat(81) } }), { status: 400 });
  assert.throws(() => checkProposal({ ...item, kind: "slate" }, { edits: [{ kind: "add_lane" }] }), { status: 400 });
  assert.deepEqual(checkProposal(item, { reply: "Look at", check: ["A name in a card", 3] }).check, ["A name in a card"]);
});
