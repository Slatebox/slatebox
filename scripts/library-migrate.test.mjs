// Community slates, approved public templates and featured presentations become library items:
// templates and featured decks published (an editor approved them), community slates waiting in
// the queue (never published unreviewed). Running it twice adds nothing; the slates are untouched.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MIGRATE_COMMUNITY_STATUS, migrateCommunity } from "../web/app/server/library/migrate.mjs";
import { libraryCollection } from "./library-test-stores.mjs";

const note = (id, text) => ({ options: { id, text, xPos: 0, yPos: 0, width: 100, height: 50 }, relationships: { associations: [] } });
const fixtures = () => [
  { _id: "t1", shareId: "tmpl", userId: "master", options: { name: "Weekly plan", isTemplate: true, templateApproved: true, isPublic: true, templateMarkdown: "## A plan\nFor **weekly** work.", userNameOverride: "Slatebox", accessKey: "k1" }, nodes: [note("a", "Mon")] },
  { _id: "t2", shareId: "tmpl-unapproved", userId: "ben", options: { name: "Draft template", isTemplate: true, templateApproved: false, isPublic: true }, nodes: [] },
  { _id: "t3", shareId: "tmpl-private", userId: "ben", options: { name: "Private template", isTemplate: true, templateApproved: true, isPublic: true, isPrivate: true }, nodes: [] },
  { _id: "c1", shareId: "comm", userId: "ben", options: { name: "Ben's map", description: "How we ship", isPublic: true, accessKey: "k2" }, nodes: [note("b", "Ship")], comments: [{ text: "x" }] },
  { _id: "c2", shareId: "master-public", userId: "master", options: { name: "Master's", isPublic: true }, nodes: [] },
  { _id: "c3", shareId: "archived", userId: "ben", archivedDate: new Date(0), options: { name: "Gone", isPublic: true }, nodes: [] },
  { _id: "p1", shareId: "private", userId: "ben", options: { name: "Mine", isPrivate: true }, nodes: [] },
  { _id: "d1", shareId: "deck-slate", userId: "cy", options: { name: "Deck slate", isPrivate: true, creationBrief: "Plan Q1 layoffs" }, nodes: [note("c", "Slide"), note("x", "secret note not in deck")] },
];
const decks = () => [
  { _id: "pr1", slateShareId: "deck-slate", userId: "cy", name: "Launch story", isPublished: true, isPublic: true, isFeatured: true, viewpoints: [{ nodeIds: ["c"] }], style: { id: "neon" },
    slateJSON: JSON.stringify({ options: { name: "Deck slate" }, nodes: [note("c", "Slide")] }) },
  { _id: "pr2", slateShareId: "deck-slate", userId: "cy", name: "Not featured", isPublished: true, isPublic: true, isFeatured: false },
];

async function run(stores, extra = {}) {
  let n = 0;
  return migrateCommunity({ ...stores, userName: async (id) => ({ ben: "Ben Ito", cy: "Cy Ray" }[id] || "A Slatebox user"), masterUserId: "master",
    newId: () => `m${++n}-${Math.random().toString(36).slice(2, 8)}`, now: () => Date.parse("2026-11-23T00:00:00Z"), ...extra });
}

test("templates and featured presentations are published; community slates wait for review", async () => {
  const slates = libraryCollection(fixtures());
  const stores = { slates, presentations: libraryCollection(decks()), items: libraryCollection(), versions: libraryCollection(), events: libraryCollection() };
  const before = JSON.stringify(slates.docs);
  const report = await run(stores);
  assert.deepEqual(report.created, { published: 2, submitted: 1 });
  assert.equal(MIGRATE_COMMUNITY_STATUS, "submitted");
  const byKey = Object.fromEntries(stores.items.docs.map((item) => [item.migratedFrom, item]));
  assert.deepEqual(Object.keys(byKey).sort(), ["community:c1", "presentation:pr1", "template:t1"]);
  const template = byKey["template:t1"];
  assert.deepEqual([template.kind, template.status, template.authorName, template.title, template.publishedVersion], ["slate", "published", "Slatebox", "Weekly plan", 1]);
  assert.equal(template.summary, "A plan For weekly work.");
  const deck = byKey["presentation:pr1"];
  assert.deepEqual([deck.kind, deck.status, deck.authorName, deck.title], ["presentation", "published", "Cy Ray", "Launch story"]);
  const deckVersion = stores.versions.docs.find((v) => v.itemId === deck._id);
  assert.equal(deckVersion.content.deck.style.id, "neon");
  assert.equal(deckVersion.content.slate.nodes[0].options.text, "Slide");
  // What the deck's player showed, never the slate as it stands: no later note, no creation brief.
  assert.deepEqual(deckVersion.content.slate.nodes.map((node) => node.options.text), ["Slide"]);
  assert.equal(deckVersion.content.slate.options.creationBrief, undefined);
  const community = byKey["community:c1"];
  assert.deepEqual([community.kind, community.status, community.reviewStatus, community.pendingVersion, community.publishedVersion, community.authorId],
    ["slate", "submitted", "submitted", 1, undefined, "ben"]);
  const version = stores.versions.docs.find((v) => v.itemId === community._id);
  assert.equal(version.source, "migration");
  assert.equal(version.content.slate.options.accessKey, undefined, "the snapshot is the library's, not the slate's links");
  assert.equal(version.content.slate.comments, undefined);
  const event = stores.events.docs.find((e) => e.itemId === community._id);
  assert.equal(event.type, "migrated");
  assert.equal(event.message, "Moved from Community slates on 2026-11-23.");
  // The slates are not changed: a public slate stays link-public.
  assert.equal(JSON.stringify(slates.docs), before);
});

test("running it twice adds nothing; a dry run writes nothing", async () => {
  const stores = { slates: libraryCollection(fixtures()), presentations: libraryCollection(decks()), items: libraryCollection(), versions: libraryCollection(), events: libraryCollection() };
  const dry = await run(stores, { dryRun: true });
  assert.deepEqual(dry.created, { published: 2, submitted: 1 });
  assert.equal(stores.items.docs.length + stores.versions.docs.length + stores.events.docs.length, 0);
  await run(stores);
  const counts = [stores.items.docs.length, stores.versions.docs.length, stores.events.docs.length];
  const again = await run(stores);
  assert.deepEqual(again.created, { published: 0, submitted: 0 });
  assert.equal(again.skipped, 3);
  assert.deepEqual([stores.items.docs.length, stores.versions.docs.length, stores.events.docs.length], counts);
});

test("a template the app seeds itself (owned by no account) is credited to Slatebox, with no author account", async () => {
  const seed = { _id: "tplprocon001", shareId: "tplprocon001", userId: "system", options: { name: "Pro/Con Analysis", isTemplate: true, templateApproved: true, isPublic: true, description: "Weigh a decision" }, nodes: [note("s", "Advantages")] };
  const stores = { slates: libraryCollection([seed]), presentations: libraryCollection(), items: libraryCollection(), versions: libraryCollection(), events: libraryCollection() };
  const report = await run(stores);
  assert.deepEqual(report.created, { published: 1, submitted: 0 });
  const [item] = stores.items.docs;
  assert.deepEqual([item.migratedFrom, item.status, item.authorName, item.authorId], ["template:tplprocon001", "published", "Slatebox", null]);
});

test("a featured deck of a deleted slate is left out; one without the player's copy waits for review, never published as the whole slate", async () => {
  const slates = libraryCollection([
    { _id: "g1", shareId: "gone", userId: "cy", archivedDate: new Date(0), options: { name: "Gone", isPrivate: true }, nodes: [note("s", "secret note not in deck")] },
    { _id: "o1", shareId: "old", userId: "cy", options: { name: "Old deck slate", isPrivate: true, creationBrief: "my prompt" }, nodes: [note("o", "Old")] },
  ]);
  const presentations = libraryCollection([
    { _id: "pg", slateShareId: "gone", userId: "cy", name: "Deleted", isPublished: true, isPublic: true, isFeatured: true, slateJSON: JSON.stringify({ nodes: [note("s", "secret note not in deck")] }) },
    { _id: "po", slateShareId: "old", userId: "cy", name: "Old deck", isPublished: true, isPublic: true, isFeatured: true },
  ]);
  const stores = { slates, presentations, items: libraryCollection(), versions: libraryCollection(), events: libraryCollection() };
  const report = await run(stores);
  assert.deepEqual(report.created, { published: 0, submitted: 1 });
  assert.equal(stores.items.docs.some((item) => item.migratedFrom === "presentation:pg"), false, "a deleted slate's deck is not moved");
  const [old] = stores.items.docs;
  assert.deepEqual([old.migratedFrom, old.status, old.migrationPristine], ["presentation:po", "submitted", true]);
  const version = stores.versions.docs.find((v) => v.itemId === old._id);
  assert.equal(version.content.slate.options.creationBrief, undefined, "the creation brief never goes into a version");
});
