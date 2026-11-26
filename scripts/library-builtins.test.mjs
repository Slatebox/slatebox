// The engine catalogue's entries as library items: one per entry, published, by Slatebox, in
// their category and locked there; re-seeding changes nothing; a changed board is a new version;
// an entry gone from the catalogue is unpublished, never deleted.
import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog } from "slateboxjs/catalog";
import { seedBuiltins, builtinContent } from "../web/app/server/library/builtins.mjs";
import { libraryCollection } from "./library-test-stores.mjs";

let n = 0;
const world = () => ({ items: libraryCollection(), versions: libraryCollection(), events: libraryCollection(), newId: () => "e" + ++n, now: () => Date.parse("2026-11-23T00:00:00Z") });

test("every catalogue entry is a published built-in item with its board, by Slatebox, locked in its category", async () => {
  const w = world();
  const report = await seedBuiltins(w);
  // Twenty since the printable page (a grid sheet) joined the catalogue.
  assert.equal(catalog.length, 20);
  assert.equal(report.created.length, 20);
  assert.equal(w.items.docs.length, 20);
  for (const entry of catalog) {
    const item = w.items.docs.find((doc) => doc._id === "builtin-" + entry.id);
    assert.ok(item, entry.id);
    assert.deepEqual([item.kind, item.origin, item.builtinId, item.slug, item.status, item.authorName, item.authorId, item.category, item.categoryLocked, item.publishedVersion],
      ["component", "builtin", entry.id, entry.id, "published", "Slatebox", null, entry.group, true, 1], entry.id);
    assert.equal(item.title, entry.name);
    assert.equal(item.summary, entry.line);
    const version = w.versions.docs.find((doc) => doc.itemId === item._id && doc.n === 1);
    assert.deepEqual(version.content, JSON.parse(JSON.stringify(builtinContent(entry))), entry.id);
    assert.equal(version.source, "builtin");
    assert.match(version.contentHash, /^[0-9a-f]{64}$/);
  }
  // The retro board carries its example cards (the listing gate's sample), so a preview is never empty.
  const retro = w.versions.docs.find((doc) => doc.itemId === "builtin-retro");
  assert.ok(retro.content.workshop.cards.length > 0);
});

test("seeding again is a no-op: no new version, item or event", async () => {
  const w = world();
  await seedBuiltins(w);
  const before = { items: JSON.stringify(w.items.docs), versions: w.versions.docs.length, events: w.events.docs.length };
  const again = await seedBuiltins(w);
  assert.equal(again.unchanged.length, 20);
  assert.deepEqual([again.created.length, again.updated.length, again.unpublished.length], [0, 0, 0]);
  assert.equal(JSON.stringify(w.items.docs), before.items);
  assert.equal(w.versions.docs.length, before.versions);
  assert.equal(w.events.docs.length, before.events);
});

test("a changed preset adds version 2 and publishes it; counts stay", async () => {
  const w = world();
  await seedBuiltins(w);
  await w.items.updateOne({ _id: "builtin-retro" }, { $inc: { "counts.adds": 4 } });
  const changed = catalog.map((entry) => (entry.id === "retro" ? { ...entry, name: "Retro board" } : entry));
  const report = await seedBuiltins({ ...w, catalog: changed });
  assert.deepEqual(report.updated, ["builtin-retro"]);
  const item = await w.items.findOne({ _id: "builtin-retro" });
  assert.equal(item.title, "Retro board");
  assert.equal(item.counts.adds, 4);
  // The name is metadata only: the board is the same, so no new version.
  assert.equal(item.publishedVersion, 1);
  // A different board is a new version.
  const samples = (await import("slateboxjs/workshops/samples")).catalogSamples;
  const reshaped = { ...samples, budget: () => ({ ...samples.budget(), title: "Budget, reshaped" }) };
  const second = await seedBuiltins({ ...w, catalog: changed, samples: reshaped });
  assert.deepEqual(second.updated, ["builtin-budget"]);
  const budget = await w.items.findOne({ _id: "builtin-budget" });
  assert.deepEqual([budget.publishedVersion, budget.versionCount], [2, 2]);
  assert.equal((await w.versions.findOne({ itemId: "builtin-budget", n: 2 })).content.workshop.title, "Budget, reshaped");
});

test("an entry gone from the catalogue is unpublished with an event, never deleted", async () => {
  const w = world();
  await seedBuiltins(w);
  const report = await seedBuiltins({ ...w, catalog: catalog.filter((entry) => entry.id !== "triage") });
  assert.deepEqual(report.unpublished, ["builtin-triage"]);
  const item = await w.items.findOne({ _id: "builtin-triage" });
  assert.equal(item.status, "unpublished");
  assert.ok(await w.versions.findOne({ itemId: "builtin-triage", n: 1 }), "its versions stay");
  assert.ok(w.events.docs.some((event) => event.itemId === "builtin-triage" && event.type === "unpublished"));
  // Back in the catalogue, it is published again.
  await seedBuiltins(w);
  assert.equal((await w.items.findOne({ _id: "builtin-triage" })).status, "published");
});
