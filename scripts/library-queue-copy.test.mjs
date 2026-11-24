// What the review queue, the review panel, My library and the publish dialog say and offer, from an
// item's status (QUEUE). The same functions the pages call (components/library/libraryCopy.mjs,
// review/refineTurns.mjs, previewSlate.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  authorActions, authorStatus, originCredit, diffLines, eventLine, groupMine, publishDefaults, publishInput, waitedFor, QUEUE_TABS, PUBLISH_LINE,
} from "../web/app/imports/ui/components/library/libraryCopy.mjs";
import { proposalChanges, refineHistory } from "../web/app/imports/ui/components/library/review/refineTurns.mjs";
import { previewSlateOf } from "../web/app/imports/ui/components/library/previewSlate.mjs";

test("an author sees where each item stands, grouped, with only the actions the lifecycle allows", () => {
  const items = [
    { id: "a", status: "draft", reviewStatus: null },
    { id: "b", status: "submitted", reviewStatus: "submitted", pendingVersion: 1 },
    { id: "c", status: "in_review", reviewStatus: "in_review", pendingVersion: 1 },
    { id: "d", status: "changes_requested", reviewStatus: "changes_requested", pendingVersion: 1 },
    { id: "e", status: "published", reviewStatus: null, publishedVersion: 2 },
    { id: "f", status: "published", reviewStatus: "submitted", pendingVersion: 3, publishedVersion: 2 },
    { id: "g", status: "rejected", reviewStatus: "rejected" },
    { id: "h", status: "published", reviewStatus: "changes_requested", pendingVersion: 3, publishedVersion: 2 },
  ];
  assert.deepEqual(groupMine(items).map((group) => [group.title, group.items.map((item) => item.id)]), [
    ["Drafts", ["a"]], ["Waiting for review", ["b", "c"]], ["Needs changes", ["d", "h"]], ["Published", ["e", "f"]], ["Not accepted", ["g"]],
  ]);
  assert.equal(authorStatus(items[5]).label, "Published · update waiting for review");
  assert.equal(authorStatus(items[2]).label, "Being reviewed");
  const can = (id) => authorActions(items.find((item) => item.id === id));
  assert.deepEqual(can("a"), { submit: true, withdraw: false, discard: true, reply: false });
  assert.deepEqual(can("b"), { submit: false, withdraw: true, discard: false, reply: true });
  assert.deepEqual(can("c"), { submit: false, withdraw: false, discard: false, reply: true }, "in review: write to the reviewer instead");
  assert.deepEqual(can("d").submit, true);
  assert.deepEqual([can("e").submit, can("e").withdraw], [true, true], "a published item takes an update, or comes out");
  assert.deepEqual([can("f").submit, can("f").withdraw], [false, true], "an update waiting: nothing to send; the update can be taken back (the published version stays)");
});

test("the queue's words: tabs, waiting time, the thread and a diff", () => {
  assert.deepEqual(QUEUE_TABS.map((tab) => tab.label), ["Waiting", "In review", "Published", "Not accepted"]);
  assert.deepEqual([waitedFor(30_000), waitedFor(5 * 60_000), waitedFor(3 * 3600_000), waitedFor(4 * 86400_000)], ["just now", "5 minutes", "3 hours", "4 days"]);
  assert.equal(eventLine({ type: "changes_requested", actor: { kind: "reviewer", name: "Root" }, version: 2 }), "Root asked for changes (version 2)");
  assert.equal(eventLine({ type: "refine_proposed", actor: { kind: "ai", name: "Slatebox" } }), "Slatebox AI asked for a refinement");
  assert.deepEqual(diffLines({ meta: { title: ["Retro", "Team retro"], category: [null, "meetings"] }, rules: ["+ Cards move one column at a time."], notes: "1 added, 0 removed, 0 changed" }),
    ["Title: Retro → Team retro", "Category: — → Meetings", "+ Cards move one column at a time.", "Notes: 1 added, 0 removed, 0 changed"]);
});

test("the refine chat sends its last six turns, and only a change gets Keep", () => {
  const turns = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `turn ${i}` }));
  turns.push({ role: "assistant", text: "That could not be done.", state: "error" });
  assert.deepEqual(refineHistory(turns).map((turn) => turn.text), ["turn 3", "turn 4", "turn 5", "turn 6", "turn 7", "turn 8"]);
  assert.equal(proposalChanges({ proposal: { meta: {}, edits: [], check: ["Look at the names"] } }), false);
  assert.equal(proposalChanges({ proposal: { meta: { title: "X" }, edits: [] } }), true);
  assert.equal(proposalChanges({ proposal: { meta: {}, edits: [{ kind: "add_rule" }] } }), true);
});

test("the publish dialog starts from the slate and sends only what was filled in; a category is a component's", () => {
  const start = publishDefaults({ kind: "slate", name: "Kickoff", description: "  Two\nnotes  ", libraryOrigin: { title: "Retro" } });
  assert.deepEqual(start, { kind: "slate", title: "Kickoff", summary: "Two notes", description: "", note: "", basedOn: "Retro" });
  assert.deepEqual(publishInput({ ...start, note: " Please look " }, { shareId: "s1" }), { kind: "slate", shareId: "s1", title: "Kickoff", summary: "Two notes", note: "Please look" });
  assert.equal("category" in publishInput(start, { shareId: "s1" }), false);
  assert.match(PUBLISH_LINE, /CC BY 4\.0/);
});

test("a preview draws a component's board on an empty slate, and a slate as it is, never with a real share id", () => {
  const board = previewSlateOf({ kind: "component", workshop: { title: "Retro", lanes: [] } }, { key: "builtin-retro", title: "Retro" });
  assert.deepEqual([board.shareId, board.creative.model.kind, board.nodes.length, board.options.workshopOrigin], ["library_builtinretro", "workshop", 0, { x: 40, y: 40 }]);
  const slate = previewSlateOf({ kind: "slate", slate: { shareId: "real", options: { name: "Kickoff" }, nodes: [{ options: { id: "n1" } }] } }, { key: "i1" });
  assert.deepEqual([slate.shareId, slate.nodes.length, slate.options.containerStyle.backgroundColor], ["library_i1", 1, "#ffffff"]);
});

test("a slate from the library credits its author: a copy names it, a board says where it came from", () => {
  assert.deepEqual(originCredit({ itemId: "i1", kind: "slate", title: "Launch plan", authorName: "Ada Author" }), { text: "Copy of Launch plan by Ada Author", href: "/library/i1" });
  assert.equal(originCredit({ itemId: "builtin-retro", kind: "component", title: "Retro", authorName: "Slatebox" }).text, "Retro by Slatebox, from the library");
  assert.equal(originCredit(null), null);
  const header = readFileSync(new URL("../web/app/imports/ui/components/CanvasToolbar.jsx", import.meta.url), "utf8");
  assert.match(header, /data-library-credit/);
  assert.match(header, /key: 'origin', label: credit\.text/);
});
