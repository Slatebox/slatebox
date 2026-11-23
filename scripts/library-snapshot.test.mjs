// What a library version keeps of a slate: its content, never anything that belongs to its
// author's copy (identity, sharing, people, conversations, files, history, library fields), and
// its boards still drawable.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSize, contentHash, snapshotDeck, snapshotSlate, snapshotWorkshop } from "../web/app/server/library/snapshot.mjs";
import { slateBoards } from "../web/app/imports/api/common/slate-boards.mjs";

const board = (title) => ({ version: 1, title, lanes: [{ id: "todo", label: "To do" }, { id: "done", label: "Done" }], cards: [{ id: "c1", label: "Card", laneId: "todo" }] });
const row = () => ({
  _id: "s1", shareId: "share1", userId: "ann", orgId: "team1", created: 1, lastSaved: 2, lastSavedBy: "ann", revision: 9, recentTouches: [{ r: 1 }],
  sharingRevision: 3, nativeConversationRevision: 4, lastNativeCanvasProposal: { id: "x" }, livePresentation: { on: true }, archivedDate: undefined,
  comments: [{ text: "private" }], collaborators: [{ userId: "ben" }], chatHistory: [{ text: "hi" }], library: { mode: "build" }, libraryOrigin: { itemId: "i1" },
  isTemplate: true, isFeatured: true, isCommunity: true, templateApproved: true, boardSeq: 3,
  options: {
    name: "Plan", description: "What we do", id: "s1", url_name: "plan", accessKey: "secret-link", isPublic: true, isPrivate: false, isUnlisted: false,
    allowCollaboration: true, isSharing: true, searchName: "plan", searchText: "plan", welcomeAid: "aid", uploadedFiles: [{ url: "https://x/a.pdf" }],
    lastSavedGoogleDocUrl: "https://docs/x", staticImage: "https://img", templateMarkdown: "# Template", isTemplate: true, templateApproved: true,
    isCommunity: true, isFeatured: true, backgroundColor: "#ffffff", workshopOrigin: { x: 10, y: 20 },
  },
  nodes: [{ options: { id: "n1", text: "Hello", xPos: 0, yPos: 0, width: 100, height: 50, apiKey: "sk-should-go" }, relationships: { associations: [] } }],
  nativeCanvasDrawing: true,
  creative: { revision: 7, model: { version: 1, kind: "workshop", workshop: board("Main") }, undo: [{ by: "ann" }], trades: { n1: { as: "card" } } },
  boards: { b2: { revision: 5, model: { version: 1, kind: "workshop", workshop: board("Second") }, undo: [{ by: "ann" }], trades: {}, origin: { x: 500, y: 20 } } },
  boardsRevision: 12,
});

test("a slate snapshot keeps the content and drops everything that is its author's", () => {
  const snap = snapshotSlate(row());
  for (const key of ["_id", "shareId", "userId", "orgId", "created", "lastSaved", "lastSavedBy", "revision", "recentTouches", "sharingRevision",
    "nativeConversationRevision", "lastNativeCanvasProposal", "livePresentation", "comments", "collaborators", "chatHistory", "library", "libraryOrigin",
    "isTemplate", "isFeatured", "isCommunity", "templateApproved", "boardSeq"]) assert.equal(snap[key], undefined, key);
  for (const key of ["id", "url_name", "accessKey", "isPublic", "isPrivate", "isUnlisted", "allowCollaboration", "isSharing", "searchName", "searchText",
    "welcomeAid", "uploadedFiles", "lastSavedGoogleDocUrl", "staticImage", "templateMarkdown", "isTemplate", "templateApproved", "isCommunity", "isFeatured"])
    assert.equal(snap.options[key], undefined, "options." + key);
  assert.deepEqual([snap.options.name, snap.options.description, snap.options.backgroundColor], ["Plan", "What we do", "#ffffff"]);
  assert.equal(snap.nodes[0].options.text, "Hello");
  assert.equal(snap.nodes[0].options.apiKey, undefined, "a secret-named field is dropped at any depth");
  // Every board's history goes; the boards themselves stay, drawable where they were.
  assert.equal(snap.creative.undo, undefined);
  assert.equal(snap.creative.trades, undefined);
  assert.equal(snap.creative.revision, 0);
  assert.equal(snap.boards.b2.undo, undefined);
  assert.equal(snap.boards.b2.trades, undefined);
  assert.equal(snap.boardsRevision, 0);
  const boards = slateBoards(snap);
  assert.deepEqual(boards.map((b) => [b.id, b.model.workshop.title]), [["main", "Main"], ["b2", "Second"]]);
  assert.deepEqual(boards[0].origin, { x: 10, y: 20 });
  assert.deepEqual(boards[1].origin, { x: 500, y: 20 });
});

test("the snapshot is the same for the same content, wherever and whenever the slate was saved", () => {
  const a = snapshotSlate(row());
  const moved = { ...row(), shareId: "other", lastSaved: 99, revision: 40, options: { ...row().options, accessKey: "other-key", url_name: "x" } };
  assert.equal(contentHash({ kind: "slate", slate: a }), contentHash({ kind: "slate", slate: snapshotSlate(moved) }));
  const edited = row();
  edited.nodes[0].options.text = "Changed";
  assert.notEqual(contentHash({ kind: "slate", slate: a }), contentHash({ kind: "slate", slate: snapshotSlate(edited) }));
});

test("a deck keeps what the player needs, never its owner or links; a board keeps no history; size is capped", () => {
  const deck = snapshotDeck({ _id: "d1", userId: "ann", orgId: "t", slateShareId: "share1", url: "https://x/present/share1", imageUrl: "https://img", isPublished: true,
    isPublic: true, isFeatured: true, author: "Ann", name: "Deck", viewpoints: [{ nodeIds: ["n1"] }], direction: { steps: [] }, style: { id: "neon" }, presentationData: "{}", slateJSON: "{}" });
  assert.deepEqual(Object.keys(deck).sort(), ["direction", "name", "presentationData", "slateJSON", "style", "viewpoints"]);
  assert.equal(snapshotDeck(null), null);
  const workshop = snapshotWorkshop(board("B"));
  assert.equal(workshop.title, "B");
  assert.throws(() => snapshotWorkshop(null), { status: 409, code: "no_board" });
  assert.throws(() => checkSize({ kind: "slate", slate: { nodes: ["x".repeat(1000001)] } }), { status: 413, code: "too_large" });
  assert.ok(checkSize({ kind: "component", workshop }) < 1000);
});
