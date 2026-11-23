// The one save core (web/app/server/slate-save-core.mjs): revision sequence, server-side diff,
// scoped conflict, search fields and the event log. Runs without Meteor or MongoDB.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSlateSaveCore,
  diffSlate,
  SlateSaveConflict,
  SlateSaveRefused,
  TOUCH_LIMIT,
  TOUCH_WINDOW,
} from "../web/app/server/slate-save-core.mjs";
import { edgeNGrams, FIELD_LIMIT, GRAM_LIMIT, searchText } from "../web/app/server/slate-search-fields.mjs";
import { memoryMongo } from "./memory-mongo.mjs";

const note = (id, text, x = 0) => ({ options: { id, text, xPos: x, yPos: 0 }, relationships: { associations: [] } });
const person = { kind: "person", userId: "owner" };
const agent = { kind: "agent", userId: "owner", tokenId: "t1", tokenName: "Planner" };

function setup(clock = { t: 1000 }) {
  const slates = memoryMongo();
  const events = memoryMongo();
  const core = createSlateSaveCore({ slates, events, now: () => clock.t++ });
  return { slates, events, core, clock };
}

async function seed(core, nodes = [note("a", "Alpha"), note("b", "Beta"), note("c", "Gamma")]) {
  await core.create({
    row: { _id: "s1", shareId: "share1", userId: "owner", nodes, options: { id: "s1", name: "Plan board", description: "Our plan" } },
    actor: person,
    source: "create",
  });
}

const setNodes = (nodes) => () => ({ set: { nodes } });

test("a new slate starts at revision 1 with its search fields and a create event", async () => {
  const { slates, events, core } = setup();
  await seed(core);
  const stored = await slates.findOne({ _id: "s1" });
  assert.equal(stored.revision, 1);
  assert.equal(stored.options.searchName, "Pla Plan boa boar board");
  assert.equal(stored.options.searchDescription, "Our pla plan");
  assert.match(stored.options.searchText, /Alph Alpha/);
  const [created] = events.docs();
  assert.deepEqual(
    { revision: created.revision, source: created.source, notes: created.notes, actor: created.actor },
    { revision: 1, source: "create", notes: ["a", "b", "c"], actor: { kind: "person", userId: "owner" } },
  );
});

test("a retried create of the same id stores one slate and one event", async () => {
  const { slates, events, core } = setup();
  await seed(core);
  const again = await core.create({ row: { _id: "s1", shareId: "x", userId: "owner", nodes: [], options: {} }, actor: person, source: "create" });
  assert.equal(again.created, false);
  assert.equal(slates.docs().length, 1);
  assert.equal(events.docs().length, 1);
});

test("every save raises the revision by one and logs the notes it touched, from a server-side diff", async () => {
  const { slates, events, core } = setup();
  await seed(core);
  const saved = await core.save({
    slateId: "s1",
    actor: person,
    source: "autosave",
    build: setNodes([note("a", "Alpha!"), note("b", "Beta"), note("d", "Delta")]),
  });
  assert.equal(saved.revision, 2);
  assert.deepEqual(saved.notes.sort(), ["a", "c", "d"]);
  const stored = await slates.findOne({ _id: "s1" });
  assert.equal(stored.revision, 2);
  assert.match(stored.options.searchText, /Delt Delta/);
  assert.doesNotMatch(stored.options.searchText, /Gamma/);
  const logged = events.docs().map((e) => [e._id, e.revision, e.source, [...e.notes].sort()]);
  assert.deepEqual(logged, [
    ["s1:1", 1, "create", ["a", "b", "c"]],
    ["s1:2", 2, "autosave", ["a", "c", "d"]],
  ]);
});

test("a save that changes nothing logs nothing and keeps the revision", async () => {
  const { slates, events, core } = setup();
  await seed(core);
  const stored = await slates.findOne({ _id: "s1" });
  const result = await core.save({ slateId: "s1", actor: person, source: "autosave", build: setNodes(stored.nodes) });
  assert.deepEqual([result.saved, result.revision], [false, 1]);
  assert.equal(events.docs().length, 1);
});

test("a counter the caller raises (a workshop's own revision) always writes", async () => {
  const { slates, core } = setup();
  await seed(core);
  await slates.updateOne({ _id: "s1" }, { $set: { "creative.revision": 4 } });
  const stored = await slates.findOne({ _id: "s1" });
  const result = await core.save({
    slateId: "s1",
    actor: person,
    source: "workshop",
    conditions: { "creative.revision": 4 },
    build: () => ({ set: { nodes: stored.nodes }, inc: { "creative.revision": 1 } }),
  });
  assert.equal(result.saved, true);
  const after = await slates.findOne({ _id: "s1" });
  assert.deepEqual([after.revision, after.creative.revision], [2, 5]);
});

test("a name change rebuilds searchName; search fields a caller sends are ignored", async () => {
  const { slates, events, core } = setup();
  await seed(core);
  await core.save({
    slateId: "s1",
    actor: agent,
    source: "operations",
    build: () => ({ set: { "options.name": "Launch review", "options.searchName": "forged" } }),
  });
  const stored = await slates.findOne({ _id: "s1" });
  assert.equal(stored.options.searchName, "Lau Laun Launc Launch rev revi revie review");
  assert.deepEqual(events.docs()[1].fields, ["options.name"]);
  assert.deepEqual(events.docs()[1].actor, { kind: "agent", userId: "owner", tokenId: "t1", tokenName: "Planner" });
});

test("scoped conflict: a note changed after the caller's revision refuses only a save that changes that note", async () => {
  const { core } = setup();
  await seed(core); // revision 1
  // Someone else changes note a (revision 2) and then note b (revision 3).
  const edit = (nodes) => core.save({ slateId: "s1", actor: person, source: "autosave", build: setNodes(nodes) });
  await edit([note("a", "Alpha by a person"), note("b", "Beta"), note("c", "Gamma")]);
  await edit([note("a", "Alpha by a person"), note("b", "Beta", 50), note("c", "Gamma")]);

  const agentEdit = (change, expectedRevision) =>
    core.save({
      slateId: "s1",
      actor: agent,
      source: "operations",
      expectedRevision,
      build: (current) => ({ set: { nodes: current.nodes.map((n) => (n.options.id in change ? { ...n, options: { ...n.options, text: change[n.options.id] } } : n)).concat(change.add ? [note("z", "Zed")] : []) } }),
    });

  // c was not touched after revision 1: saved.
  const fine = await agentEdit({ c: "Gamma by the agent" }, 1);
  assert.equal(fine.revision, 4);
  // a was touched at revision 2: refused, naming the note and the current revision.
  await assert.rejects(agentEdit({ a: "Alpha by the agent" }, 1), (error) => {
    assert.ok(error instanceof SlateSaveConflict);
    assert.equal(error.status, 409);
    assert.equal(error.code, "slate_changed");
    assert.deepEqual(error.details, { revision: 4, notes: ["a"], fields: [] });
    return true;
  });
  // From revision 2, a is clean again.
  assert.equal((await agentEdit({ a: "Alpha by the agent" }, 2)).revision, 5);
  // A pure addition never conflicts, however old the revision.
  assert.equal((await agentEdit({ add: true }, 1)).revision, 6);
  // A revision the slate has not reached is refused.
  await assert.rejects(agentEdit({ c: "x" }, 99), (error) => error.code === "slate_changed" && error.details.revision === 6);
});

test("scoped conflict on settings: a rename after the caller's revision refuses another rename", async () => {
  const { core } = setup();
  await seed(core);
  const rename = (name, expectedRevision) =>
    core.save({ slateId: "s1", actor: agent, source: "operations", expectedRevision, build: () => ({ set: { "options.name": name } }) });
  await rename("First", 1);
  await assert.rejects(rename("Second", 1), (error) => error.code === "slate_changed" && error.details.fields[0] === "options.name");
  // A note edit from revision 1 is not refused by the rename.
  const result = await core.save({
    slateId: "s1",
    actor: agent,
    source: "operations",
    expectedRevision: 1,
    build: (current) => ({ set: { nodes: current.nodes.map((n) => (n.options.id === "b" ? note("b", "B2") : n)) } }),
  });
  assert.equal(result.revision, 3);
});

test("a revision older than the remembered touches is refused, since nothing shows its notes are untouched", async () => {
  const { slates, core } = setup();
  await seed(core);
  for (let i = 0; i < TOUCH_WINDOW + 1; i += 1)
    await core.save({ slateId: "s1", actor: person, source: "autosave", build: setNodes([note("a", "A" + i), note("b", "Beta"), note("c", "Gamma")]) });
  assert.equal((await slates.findOne({ _id: "s1" })).recentTouches.length, TOUCH_WINDOW);
  await assert.rejects(
    core.save({ slateId: "s1", actor: agent, source: "operations", expectedRevision: 1, build: (c) => ({ set: { nodes: c.nodes.map((n) => (n.options.id === "c" ? note("c", "C") : n)) } }) }),
    (error) => error.code === "slate_changed",
  );
});

test("a save that loses a race builds again on what the other writer stored", async () => {
  const { slates, core } = setup();
  await seed(core);
  let builds = 0;
  const result = await core.save({
    slateId: "s1",
    actor: agent,
    source: "operations",
    build: async (current) => {
      builds += 1;
      // The first time, a person's autosave lands between the read and the write.
      if (builds === 1) await slates.updateOne({ _id: "s1" }, { $set: { nodes: [...current.nodes, note("p", "Person")] }, $inc: { revision: 1 } });
      return { set: { nodes: [...current.nodes, note("q", "Agent")] } };
    },
  });
  assert.equal(builds, 2);
  assert.equal(result.revision, 3);
  assert.deepEqual((await slates.findOne({ _id: "s1" })).nodes.map((n) => n.options.id), ["a", "b", "c", "p", "q"]);
});

test("conditions that stop holding (sharing changed) refuse the save without a write or an event", async () => {
  const { slates, events, core } = setup();
  await seed(core);
  await assert.rejects(
    core.save({
      slateId: "s1",
      actor: person,
      source: "autosave",
      conditions: { sharingRevision: null },
      build: async (current) => {
        await slates.updateOne({ _id: "s1" }, { $set: { sharingRevision: 1 } });
        return { set: { nodes: [] } };
      },
    }),
    SlateSaveRefused,
  );
  assert.equal((await slates.findOne({ _id: "s1" })).nodes.length, 3);
  assert.equal(events.docs().length, 1);
});

test("the diff reads a workshop's lanes and cards as items and its other keys as settings", () => {
  const before = { creative: { model: { kind: "workshop", workshop: { title: "Plan", lanes: [{ id: "l1", label: "Now" }], cards: [{ id: "k1", laneId: "l1" }] } } } };
  const workshop = { title: "Plan 2", lanes: [{ id: "l1", label: "Now" }, { id: "l2", label: "Next" }], cards: [{ id: "k1", laneId: "l2" }] };
  assert.deepEqual(diffSlate(before, { "creative.model.workshop": workshop }), {
    added: ["l2"],
    changed: ["k1"],
    removed: [],
    properties: [["l2", "*"], ["k1", "laneId"]],
    fields: ["workshop.title"],
  });
});

test("notes the ids cannot name (no id, or a new order) still count as a change", () => {
  const current = { nodes: [note("a", "A"), note("b", "B")] };
  assert.deepEqual(diffSlate(current, { nodes: [note("b", "B"), note("a", "A")] }).fields, ["nodes"]);
  assert.deepEqual(diffSlate({ nodes: [] }, { nodes: [{ options: { text: "No id" } }] }).fields, ["nodes"]);
  assert.deepEqual(diffSlate(current, { nodes: structuredClone(current.nodes) }).fields, []);
});

test("scoped by property: a move or a browser filling in defaults does not block another property of the same note", async () => {
  const { core } = setup();
  await seed(core); // revision 1
  const person = (change) => core.save({ slateId: "s1", actor: person_, source: "autosave", build: (c) => ({ set: { nodes: c.nodes.map((n) => (n.options.id === "a" ? change(structuredClone(n)) : n)) } }) });
  const person_ = { kind: "person", userId: "owner" };
  // The first browser save adds defaults the server never wrote, in another key order.
  await person((n) => ({ relationships: n.relationships, options: { fontFamily: "Arial", ...n.options, showMenu: true } }));
  // A person moves note a.
  await person((n) => ({ ...n, options: { ...n.options, xPos: 500 } }));
  const agentText = (text, expectedRevision) => core.save({ slateId: "s1", actor: agent, source: "operations", expectedRevision,
    build: (c) => ({ set: { nodes: c.nodes.map((n) => (n.options.id === "a" ? { ...n, options: { ...n.options, text } } : n)) } }) });
  assert.equal((await agentText("Alpha by the agent", 1)).revision, 4);
  // A person then edits the text of a: an agent text edit from revision 4 is refused...
  await person((n) => ({ ...n, options: { ...n.options, text: "Alpha by a person" } }));
  await assert.rejects(agentText("Again", 4), (error) => error.code === "slate_changed" && error.details.notes[0] === "a");
  // ...and an agent move from revision 4 is not.
  const move = await core.save({ slateId: "s1", actor: agent, source: "operations", expectedRevision: 4,
    build: (c) => ({ set: { nodes: c.nodes.map((n) => (n.options.id === "a" ? { ...n, options: { ...n.options, xPos: 900 } } : n)) } }) });
  assert.equal(move.revision, 6);
  // Deleting a from revision 4 is refused: a changed since.
  await assert.rejects(core.save({ slateId: "s1", actor: agent, source: "operations", expectedRevision: 4,
    build: (c) => ({ set: { nodes: c.nodes.filter((n) => n.options.id !== "a") } }) }), (error) => error.code === "slate_changed");
});

test("a note re-exported in another key order is not a change", () => {
  const before = { nodes: [{ options: { id: "a", text: "A", xPos: 1 }, relationships: { associations: [{ id: "x", parentId: "a", childId: "b" }] } }] };
  const after = { nodes: [{ relationships: { associations: [{ childId: "b", parentId: "a", id: "x" }] }, options: { xPos: 1, text: "A", id: "a" } }] };
  assert.deepEqual(diffSlate(before, { nodes: after.nodes }), { added: [], changed: [], removed: [], properties: [], fields: [] });
});

test("a very large save is remembered by note, and past the limit as everything", async () => {
  const { slates, core } = setup();
  const many = Array.from({ length: TOUCH_LIMIT + 1 }, (_, i) => note("n" + i, "N" + i));
  await seed(core, many.slice(0, 100));
  // 100 notes, 3 properties each: remembered by note.
  await core.save({ slateId: "s1", actor: person, source: "autosave", build: (c) => ({ set: { nodes: c.nodes.map((n) => ({ ...n, options: { ...n.options, a: 1, b: 2, c: 3 } })) } }) });
  const byNote = (await slates.findOne({ _id: "s1" })).recentTouches.at(-1);
  assert.equal(byNote.properties.length, 100);
  assert.deepEqual(byNote.properties[0], ["n0", "*"]);
  // More notes than the limit: remembered as everything, so an older revision is refused even for an untouched note.
  await core.save({ slateId: "s1", actor: person, source: "autosave", build: () => ({ set: { nodes: many } }) });
  assert.equal((await slates.findOne({ _id: "s1" })).recentTouches.at(-1).all, true);
  await assert.rejects(core.save({ slateId: "s1", actor: agent, source: "operations", expectedRevision: 2,
    build: (c) => ({ set: { "options.name": "x" } }) }), (error) => error.code === "slate_changed");
});

// fix-P05a (review finding 2): a note's text is the writer's to choose, up to 10000 characters
// in the API contract. Unbounded prefixes made one 6000-character word 18 MB of search text,
// over MongoDB's 16 MB document limit, so no save of that slate could land.
test("search text is bounded: a long word gives prefixes up to a limit, and a field stops at a limit", async () => {
  const word = "x".repeat(10000);
  const grams = edgeNGrams(word).split(" ");
  assert.equal(grams[0], "xxx");
  assert.equal(grams.at(-1).length, GRAM_LIMIT);
  assert.ok(edgeNGrams(word).length < 300);
  // A word of ordinary length is still found whole, and by its prefixes.
  assert.equal(edgeNGrams("internationalizations").split(" ").at(-1), "internationalizations");
  assert.match(edgeNGrams("Review"), /^Rev Revi Revie Review$/);
  // Twenty notes of 10000 characters of ordinary words stay within the field limit.
  const prose = Array.from({ length: 1700 }, (_, i) => "word" + i).join(" ").slice(0, 10000);
  const text = searchText(Array.from({ length: 20 }, () => ({ options: { text: prose } })));
  assert.ok(text.length <= FIELD_LIMIT);
  assert.match(text, /^wor word word0 /);

  const { slates, core } = setup();
  await seed(core, [note("a", word)]);
  await core.save({ slateId: "s1", actor: agent, source: "operations", build: () => ({ set: { nodes: [note("a", word + " " + word)] } }) });
  assert.ok((await slates.findOne({ _id: "s1" })).options.searchText.length < 600);
});

// fix-P05a (review finding 9): the comment said a slate saved before the server built search
// fields "gets all three"; only searchText was built.
test("a slate stored without search fields gets each one it lacks on its next save", async () => {
  const { slates, core } = setup();
  await slates.insertOne({ _id: "old", revision: 3, nodes: [note("a", "Alpha")], options: { id: "old", name: "Old plan", description: "Kept notes" } });
  await core.save({ slateId: "old", actor: person, source: "autosave", build: () => ({ set: { "options.showZoom": false } }) });
  const stored = await slates.findOne({ _id: "old" });
  assert.deepEqual([stored.options.searchName, stored.options.searchDescription, stored.options.searchText],
    ["Old pla plan", "Kep Kept not note notes", "Alp Alph Alpha"]);
});

// fix-P05a (review finding 4): the diff ran a key-sorting serialization over every key of every
// note on each autosave (about 380 ms for 5000 notes of 40 keys when nothing changed). Equal
// notes are now settled by the native serialization; only notes that differ are compared key by
// key. The bound is generous (several times the measured cost) so a busy machine does not fail it.
test("the diff of a large slate settles unchanged notes cheaply and still finds the one change", () => {
  const make = (n) => Array.from({ length: n }, (_, i) => ({
    options: Object.fromEntries([["id", "n" + i], ["text", "Note " + i], ...Array.from({ length: 38 }, (_, k) => ["k" + k, { a: k, b: [1, 2, 3], c: "x".repeat(20) }])]),
    relationships: { associations: [{ parentId: "n" + (i - 1), childId: "n" + i, lineColor: "#000" }] },
  }));
  const stored = make(5000);
  const same = make(5000);
  const changed = make(5000);
  changed[7].options.text = "Changed";
  diffSlate({ nodes: stored }, { nodes: same });
  const started = performance.now();
  const none = diffSlate({ nodes: stored }, { nodes: same });
  const one = diffSlate({ nodes: stored }, { nodes: changed });
  const took = performance.now() - started;
  assert.deepEqual(none, { added: [], changed: [], removed: [], properties: [], fields: [] });
  assert.deepEqual(one.properties, [["n7", "options.text"]]);
  assert.ok(took < 400, `two diffs of 5000 notes took ${took.toFixed(0)} ms`);
});

test("a note with no id, or sharing an id, that changes is still a change; the same notes in the same order are not", () => {
  const a = { options: { text: "A" } };
  const twin1 = { options: { id: "t", text: "One" } };
  const twin2 = { options: { id: "t", text: "Two" } };
  assert.deepEqual(diffSlate({ nodes: [a, twin1, twin2] }, { nodes: [a, twin1, twin2] }).fields, []);
  assert.deepEqual(diffSlate({ nodes: [a, twin1, twin2] }, { nodes: [{ options: { text: "B" } }, twin1, twin2] }).fields, ["nodes"]);
  assert.deepEqual(diffSlate({ nodes: [a, twin1, twin2] }, { nodes: [a, { options: { id: "t", text: "Changed" } }, twin2] }).fields, ["nodes"]);
});

// fix-P05a (review finding 9): a preview reports the conflict its save would meet.
test("check names the conflict a save would meet, without saving", async () => {
  const { slates, events, core } = setup();
  await seed(core);
  await core.save({ slateId: "s1", actor: person, source: "autosave", build: setNodes([note("a", "Alpha by a person"), note("b", "Beta"), note("c", "Gamma")]) });
  const current = await slates.findOne({ _id: "s1" });
  const agentSet = (id, text) => ({ nodes: current.nodes.map((n) => (n.options.id === id ? { ...n, options: { ...n.options, text } } : n)) });
  assert.doesNotThrow(() => core.check({ current, set: agentSet("b", "Beta by the agent"), expectedRevision: 1 }));
  assert.throws(() => core.check({ current, set: agentSet("a", "Alpha by the agent"), expectedRevision: 1 }),
    (error) => error.code === "slate_changed" && error.details.notes[0] === "a" && error.details.revision === 2);
  assert.equal(events.docs().length, 2);
});
