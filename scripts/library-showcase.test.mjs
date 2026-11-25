// The six presentations Slatebox built for the site's Presentations page, as library items (server/library/showcase.mjs):
// published, by Slatebox, each with its slate and the deck the app's own composer makes of its look; re-seeding
// changes nothing; changed content is a new version; a presentation gone from the list is unpublished, never deleted;
// the built-in components' seed leaves them alone. "Make it yours" (library.fork) copies the slate as it is (every
// note's id, place, size, shape and colors, every connection, the title) and the deck with its look, and Present keeps
// that deck instead of planning the slate again.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { seedShowcase, showcaseContent, SHOWCASE_PREFIX } from "../web/app/server/library/showcase.mjs";
import { showcasePresentations } from "../web/app/server/library/showcase/presentations.mjs";
import { seedBuiltins } from "../web/app/server/library/builtins.mjs";
import { libraryCollection } from "./library-test-stores.mjs";
import { makeExecWorld } from "./exec-test-world.mjs";
import { mountDdp } from "../web/app/server/actions/ddp.mjs";
import { principalFromUser } from "../web/app/server/actions/principal.mjs";
import { API_TOKEN_SCOPES } from "../web/app/server/api-token-core.mjs";
import { needsPlan } from "../web/app/imports/ui/components/presentations/presentationPlan.mjs";
import { STYLES } from "../web/app/imports/ui/components/presentations/presentationStyles.mjs";
import { nativeSlateFromBrief } from "../web/app/imports/api/common/native-diagram-brief.mjs";

const SLUGS = ["launch-war-room", "checkout-postmortem", "investor-update", "trial-research", "roadmap-bets", "first-month"];
const STYLE_OF = { "launch-war-room": "neon", "checkout-postmortem": "blueprint", "investor-update": "editorial", "trial-research": "sketch", "roadmap-bets": "voyage", "first-month": "journey" };
let n = 0;
const world = () => ({ items: libraryCollection(), versions: libraryCollection(), events: libraryCollection(), newId: () => "e" + ++n, now: () => Date.parse("2026-11-24T00:00:00Z") });
const counts = (w) => ({ items: w.items.docs.length, versions: w.versions.docs.length, events: w.events.docs.length });

test("the bundled six: a slug, title, summary, slate and look each; every step names notes of its slate; a style the app has", () => {
  assert.deepEqual(showcasePresentations.map((entry) => entry.slug), SLUGS);
  for (const entry of showcasePresentations) {
    assert.match(entry.slug, /^[a-z0-9][a-z0-9-]*$/);
    assert.ok(entry.title && entry.title.length <= 80, entry.slug);
    assert.ok(entry.summary.length <= 160 && /example/i.test(entry.summary), entry.slug + ": its summary says it is an example");
    assert.equal(entry.look.style, STYLE_OF[entry.slug]);
    assert.ok(STYLES[entry.look.style], entry.slug + ": a style the app has");
    const ids = new Set(entry.slate.nodes.map((node) => node.options.id));
    assert.equal(ids.size, entry.slate.nodes.length, entry.slug + ": note ids are unique");
    for (const step of entry.look.direction.steps) for (const id of step.nodeIds) assert.ok(ids.has(id), `${entry.slug}: step note ${id}`);
    // Nothing the app would have to fetch or license: no pictures, no custom shapes.
    assert.doesNotMatch(JSON.stringify(entry), /https?:\/\/|vectorPath|"image"/, entry.slug);
  }
});

// The site's scripts/make-present-decks.mjs writes the app's copy; beside a site checkout (SITE_DIR), the two agree.
const siteDir = process.env.SITE_DIR;
test("the app's copy matches the site's files (SITE_DIR)", { skip: !siteDir || !existsSync(siteDir + "/assets/hubs/present") }, () => {
  for (const entry of showcasePresentations) {
    const slate = JSON.parse(readFileSync(`${siteDir}/assets/hubs/present/${entry.slug}-slate.json`, "utf8"));
    const deck = JSON.parse(readFileSync(`${siteDir}/assets/hubs/present/${entry.slug}-deck.json`, "utf8"));
    assert.deepEqual(entry.slate, slate, entry.slug);
    assert.deepEqual({ name: entry.title, look: entry.look }, deck, entry.slug);
  }
});

test("seeding publishes six presentations by Slatebox, each with its slate and the deck the app composes in its style", async () => {
  const w = world();
  const report = await seedShowcase(w);
  assert.deepEqual(report.created, SLUGS.map((slug) => SHOWCASE_PREFIX + slug));
  assert.equal(w.items.docs.length, 6);
  for (const entry of showcasePresentations) {
    const item = await w.items.findOne({ slug: entry.slug });
    assert.deepEqual([item._id, item.kind, item.origin, item.status, item.authorId, item.authorName, item.title, item.summary, item.publishedVersion],
      [SHOWCASE_PREFIX + entry.slug, "presentation", "builtin", "published", null, "Slatebox", entry.title, entry.summary, 1], entry.slug);
    assert.deepEqual(item.preview, { kind: "presentation", notes: entry.slate.nodes.length });
    const version = await w.versions.findOne({ itemId: item._id, n: 1 });
    const { slate, deck } = version.content;
    assert.equal(version.content.kind, "presentation");
    assert.equal(slate.options.name, entry.title);
    assert.deepEqual(slate.nodes, entry.slate.nodes, entry.slug + ": the slate as the site draws it");
    assert.deepEqual(slate.options.containerStyle, entry.slate.options.containerStyle);
    assert.equal(deck.name, entry.title);
    assert.deepEqual(deck.style, { id: entry.look.style });
    assert.equal(deck.direction.style.id, entry.look.style);
    assert.equal(deck.direction.title, entry.look.direction.title);
    assert.deepEqual(deck.direction.steps.map((step) => step.nodeIds), entry.look.direction.steps.map((step) => step.nodeIds), entry.slug + ": the same steps");
    assert.ok(deck.viewpoints.length >= entry.look.direction.steps.length, entry.slug + ": composed steps");
    assert.ok(deck.viewpoints.every((viewpoint) => Array.isArray(viewpoint.nodeIds)));
    assert.equal(JSON.parse(deck.slateJSON).nodes.length, entry.slate.nodes.length, entry.slug + ": the player's copy of the slate");
    assert.equal(deck.presentationData.nodes.length, 1, entry.slug + ": one root");
  }
});

test("seeding again changes nothing; the built-in components' seed leaves the six published", async () => {
  const w = world();
  await seedShowcase(w);
  const before = { ...counts(w), items: JSON.stringify(w.items.docs) };
  const again = await seedShowcase(w);
  assert.equal(again.unchanged.length, 6);
  assert.deepEqual([again.created, again.updated, again.unpublished, again.skipped].map((list) => list.length), [0, 0, 0, 0]);
  assert.equal(JSON.stringify(w.items.docs), before.items);
  assert.deepEqual([w.versions.docs.length, w.events.docs.length], [before.versions, before.events]);
  // A restart seeds both, in either order: neither unpublishes the other's items.
  const builtins = await seedBuiltins(w);
  assert.deepEqual(builtins.unpublished, []);
  const third = await seedShowcase(w);
  assert.deepEqual([third.unchanged.length, third.unpublished.length], [6, 0]);
  assert.equal(await w.items.countDocuments({ kind: "presentation", origin: "builtin", status: "published" }), 6);
  assert.equal(new Set(w.items.docs.map((doc) => doc.slug)).size, w.items.docs.length, "no duplicate slugs");
});

test("a changed summary or slate is a new published version; counts and earlier versions stay", async () => {
  const w = world();
  await seedShowcase(w);
  const id = SHOWCASE_PREFIX + "launch-war-room";
  await w.items.updateOne({ _id: id }, { $inc: { "counts.copies": 3 } });
  const renamed = showcasePresentations.map((entry) => (entry.slug === "launch-war-room" ? { ...entry, summary: "A launch, live. An example built by Slatebox." } : entry));
  const first = await seedShowcase({ ...w, presentations: renamed });
  assert.deepEqual(first.updated, [id]);
  // The deck's description is the summary, so the content changed too.
  assert.equal((await w.items.findOne({ _id: id })).publishedVersion, 2);
  const edited = renamed.map((entry) => entry.slug !== "launch-war-room" ? entry : {
    ...entry,
    slate: { ...entry.slate, nodes: entry.slate.nodes.map((node) => (node.options.id === "golive" ? { ...node, options: { ...node.options, text: "09:30\nGo live" } } : node)) },
  });
  const second = await seedShowcase({ ...w, presentations: edited });
  assert.deepEqual(second.updated, [id]);
  const item = await w.items.findOne({ _id: id });
  assert.deepEqual([item.publishedVersion, item.versionCount, item.counts.copies], [3, 3, 3]);
  const v3 = await w.versions.findOne({ itemId: id, n: 3 });
  assert.equal(v3.content.slate.nodes.find((node) => node.options.id === "golive").options.text, "09:30\nGo live");
  assert.ok(await w.versions.findOne({ itemId: id, n: 1 }), "earlier versions stay");
  assert.equal((await seedShowcase({ ...w, presentations: edited })).unchanged.length, 6);
});

test("a presentation gone from the list is unpublished with an event, never deleted, and comes back when it returns", async () => {
  const w = world();
  await seedShowcase(w);
  const id = SHOWCASE_PREFIX + "first-month";
  const report = await seedShowcase({ ...w, presentations: showcasePresentations.filter((entry) => entry.slug !== "first-month") });
  assert.deepEqual(report.unpublished, [id]);
  assert.equal((await w.items.findOne({ _id: id })).status, "unpublished");
  assert.ok(w.events.docs.some((event) => event.itemId === id && event.type === "unpublished"));
  await seedShowcase(w);
  assert.equal((await w.items.findOne({ _id: id })).status, "published");
});

test("a slug another item holds is left to it", async () => {
  const w = world();
  await w.items.insertOne({ _id: "someone", slug: "roadmap-bets", kind: "slate", origin: "user", status: "published" });
  const report = await seedShowcase(w);
  assert.deepEqual(report.skipped, [SHOWCASE_PREFIX + "roadmap-bets"]);
  assert.equal(report.created.length, 5);
});

async function setup(t) {
  const copies = [];
  const env = makeExecWorld({ library: { copyPresentation: async (deck, where) => { copies.push({ deck, ...where }); } } });
  t.after(() => env.close());
  await env.libraryReady;
  const lib = env.library;
  await seedShowcase({ items: lib.items, versions: lib.versions, events: lib.events, newId: () => "s" + ++n, now: () => Date.parse("2026-11-24T00:00:00Z") });
  env.users.docs.push({ _id: "guest1", isAnonymous: true });
  let methods;
  mountDdp(env.registry, {
    defineMethods: (defined) => (methods = defined),
    makeError: (code, reason, details) => Object.assign(new Error(reason), { error: code, reason, details }),
    loadUser: async (id) => env.users.docs.find((user) => user._id === id) || null,
    scopes: API_TOKEN_SCOPES,
  });
  const ddp = (userId, method, input) => methods[method].call({ userId }, input);
  const person = (userId) => principalFromUser(env.users.docs.find((user) => user._id === userId), API_TOKEN_SCOPES);
  const run = (principal, id, input) => env.registry.run(principal, id, input).then((result) => result.body);
  return { env, copies, ddp, person, run };
}

const lines = (nodes) => nodes.flatMap((node) => (node.relationships?.associations || []).map((link) => ({ ...link })));

test("Make it yours: the copy is the same slate (notes, shapes, colors, places, lines, title) with the same deck, kept by Present", async (t) => {
  const { env, copies, ddp, person, run } = await setup(t);
  const visitor = { kind: "visitor", userId: null, scopes: [] };
  // Listed with the library's presentations, credited to Slatebox.
  const listed = await run(visitor, "library.list", { kind: "presentation", origin: "builtin" });
  assert.deepEqual(listed.items.map((item) => item.slug), SLUGS);
  assert.ok(listed.items.every((item) => item.authorName === "Slatebox" && item.origin === "builtin"));
  for (const [index, entry] of showcasePresentations.entries()) {
    // A guest (a visitor who is not signed in gets one first) and a signed-in person both copy it.
    const forked = index % 2 ? await run(person("other"), "library.fork", { itemId: entry.slug }) : await ddp("guest1", "library.fork", { itemId: entry.slug });
    const copy = env.slate(forked.shareId);
    assert.equal(copy.options.name, entry.title, entry.slug + ": the item's title, never a row of notes");
    assert.equal(copy.options.isPrivate, true);
    assert.deepEqual(copy.options.containerStyle, entry.slate.options.containerStyle, entry.slug + ": the background");
    assert.equal(copy.nodes.length, entry.slate.nodes.length, entry.slug + ": every note");
    for (const source of entry.slate.nodes) {
      const mine = copy.nodes.find((node) => node.options.id === source.options.id);
      assert.ok(mine, `${entry.slug}: note ${source.options.id} keeps its id`);
      for (const key of ["text", "xPos", "yPos", "width", "height", "shapeHint", "backgroundColor", "foregroundColor", "borderColor", "borderWidth", "fontSize", "fontFamily", "textXAlign"])
        assert.deepEqual(mine.options[key], source.options[key], `${entry.slug}: ${source.options.id}.${key}`);
    }
    assert.deepEqual(lines(copy.nodes), lines(entry.slate.nodes), entry.slug + ": every connection, with its look");
    assert.equal(copy.libraryOrigin.itemId, SHOWCASE_PREFIX + entry.slug);
    // Its deck: the published one, private to the copier, marked as a library copy.
    const made = copies.at(-1);
    assert.equal(made.shareId, forked.shareId);
    const published = (await run(visitor, "library.get", { itemId: entry.slug })).version.content.deck;
    const { isPublished, isPublic, libraryCopy, ...look } = made.deck;
    assert.deepEqual([isPublished, isPublic, libraryCopy], [false, false, true]);
    assert.deepEqual(look, published, entry.slug + ": the same deck and look");
    assert.deepEqual(made.deck.style, { id: entry.look.style });
    // Present opens it as it is: no new plan, so it plays in the same style.
    assert.equal(needsPlan(made.deck, made.deck.presentationData), false, entry.slug + ": Present keeps the copied deck");
    assert.equal(needsPlan({ ...made.deck, libraryCopy: undefined }, made.deck.presentationData), true, "without the mark it would be planned again");
  }
  assert.equal(env.library.items.docs.find((doc) => doc._id === SHOWCASE_PREFIX + "checkout-postmortem").counts.copies, 1, "a signed-in copy is counted");
});

test("the six are Slatebox's: nobody edits or submits them, and the refusal says to open a copy", async (t) => {
  const { person, run } = await setup(t);
  await assert.rejects(run(person("owner"), "library.withdraw", { itemId: SHOWCASE_PREFIX + "launch-war-room" }), (error) => error.status === 409 && error.code === "builtin" && /Open a copy/.test(error.message));
  await assert.rejects(run(person("admin"), "library.review.update", { itemId: SHOWCASE_PREFIX + "launch-war-room", title: "X" }), { status: 409, code: "builtin" });
});

test("a brief's slate is named after its first note, never a row of steps glued together", () => {
  assert.equal(nativeSlateFromBrief("Launch day: version 2 goes live → The countdown\nThe countdown → 09:00 Go live").options.name, "Launch day: version 2 goes live");
  assert.equal(nativeSlateFromBrief("What can still ship on Friday?").options.name, "What can still ship on Friday?");
});

test("showcaseContent is deterministic, so a restart never adds a version", () => {
  for (const entry of showcasePresentations) assert.equal(JSON.stringify(showcaseContent(entry)), JSON.stringify(showcaseContent(entry)), entry.slug);
});
