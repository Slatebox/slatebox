// D1b (dragology final.md §6): the move log. Every save that moves a board's cards appends its
// moves, with the time, to the slate's event row; time-in-lane comes from it. Server only, ids only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSlateSaveCore } from "../web/app/server/slate-save-core.mjs";
import { moveAnnotation, readMoveLog, timeInLane, waitedLine, workshopInSet, workshopMovesBetween } from "../web/app/server/workshop-move-log.mjs";

const DAY = 86400000;
const board = (cards) => ({ version: 1, title: "Team", lanes: [{ id: "todo", label: "To do" }, { id: "doing", label: "Doing" }, { id: "review", label: "Review" }, { id: "done", label: "Done" }],
  cards: cards.map(([id, laneId]) => ({ id, label: id.toUpperCase(), laneId })) });

test("the moves between two boards: lane changes, cards that came on and cards that left", () => {
  const before = board([["a", "todo"], ["b", "doing"], ["c", "review"]]);
  const after = board([["a", "doing"], ["b", "doing"], ["d", "todo"]]);
  assert.deepEqual(workshopMovesBetween(before, after), [
    { card: "a", from: "todo", to: "doing" }, { card: "d", from: null, to: "todo" }, { card: "c", from: "review", to: null }]);
  assert.deepEqual(workshopMovesBetween(null, board([["a", "todo"]])), [{ card: "a", from: null, to: "todo" }]);
  assert.deepEqual(workshopMovesBetween(before, before), []);
});

test("a save's set names its workshop in each of the shapes the writers use", () => {
  const w = board([]);
  assert.equal(workshopInSet({ "creative.model.workshop": w }), w);
  assert.equal(workshopInSet({ "creative.model": { version: 1, kind: "workshop", workshop: w } }), w);
  assert.equal(workshopInSet({ creative: { revision: 0, model: { kind: "workshop", workshop: w } } }), w);
  assert.equal(workshopInSet({ nodes: [] }), undefined);
  assert.deepEqual(moveAnnotation({ creative: { model: { kind: "workshop", workshop: board([["a", "todo"]]) } } }, { "creative.model.workshop": board([["a", "done"]]) }),
    { moves: [{ card: "a", from: "todo", to: "done" }] });
  assert.deepEqual(moveAnnotation({}, { nodes: [] }), {});
});

test("time in lane, from fixtures: completed visits and the ones still going", () => {
  const t0 = Date.UTC(2026, 10, 1);
  const log = [
    { at: t0, moves: [{ card: "a", from: null, to: "todo" }, { card: "b", from: null, to: "todo" }] },
    { at: t0 + 1 * DAY, moves: [{ card: "a", from: "todo", to: "review" }] },
    { at: t0 + 2 * DAY, moves: [{ card: "b", from: "todo", to: "review" }] },
    { at: t0 + 3.2 * DAY, moves: [{ card: "a", from: "review", to: "done" }] },
    { at: t0 + 4 * DAY, moves: [{ card: "b", from: "review", to: null }] },
  ];
  const now = t0 + 5 * DAY;
  // Review: a waited 2.2 days, b 2 days → 2.1. To do: 1 and 2 → 1.5. Done: no card has ever moved on
  // from it to another lane, so a card there is finished, not waiting: it is not in the line.
  assert.deepEqual(timeInLane(log, now), [
    { laneId: "review", visits: 2, days: 2.1 }, { laneId: "todo", visits: 2, days: 1.5 }]);
  assert.equal(waitedLine(timeInLane(log, now), board([])), "Cards waited 2.1 days in Review, 1.5 days in To do.");
  assert.equal(waitedLine([], board([])), null);
  // Dates in the log are read as times, and rows out of shape are skipped.
  assert.deepEqual(timeInLane([{ at: new Date(t0), moves: [{ card: "a", from: null, to: "doing" }] }, { at: "x", moves: [] },
    { at: new Date(t0 + DAY), moves: [{ card: "a", from: "doing", to: "done" }] }], t0 + 2 * DAY), [{ laneId: "doing", visits: 1, days: 1 }]);
});

test("the save core appends each save's moves to its event row, with its time", async () => {
  const rows = [{ _id: "s1", revision: 3, userId: "u", nodes: [], creative: { revision: 1, model: { version: 1, kind: "workshop", workshop: board([["a", "todo"], ["b", "todo"]]) } } }];
  const events = [];
  let clock = 1000;
  const core = createSlateSaveCore({
    slates: {
      findOne: async (q) => structuredClone(rows.find((row) => row._id === q._id) ?? null),
      updateOne: async (q, update) => {
        const row = rows.find((item) => item._id === q._id && (q.revision === undefined || item.revision === q.revision));
        if (!row) return { matchedCount: 0 };
        for (const [path, value] of Object.entries(update.$set)) {
          const keys = path.split("."); let at = row;
          for (const key of keys.slice(0, -1)) at = at[key] ??= {};
          at[keys.at(-1)] = value;
        }
        for (const [path, value] of Object.entries(update.$inc ?? {})) {
          const keys = path.split("."); let at = row;
          for (const key of keys.slice(0, -1)) at = at[key] ??= {};
          at[keys.at(-1)] = (at[keys.at(-1)] ?? 0) + value;
        }
        return { matchedCount: 1 };
      },
    },
    events: {
      insertOne: async (row) => { events.push(row); },
      find: (q) => ({ toArray: async () => events.filter((row) => row.slateId === q.slateId && row.moves).sort((a, b) => b.revision - a.revision) }),
    },
    now: () => clock,
  });
  const move = (cards) => core.save({ slateId: "s1", actor: { kind: "person", userId: "u" }, source: "workshop", build: () => ({ set: { "creative.model.workshop": board(cards) }, inc: { "creative.revision": 1 } }) });
  await move([["a", "review"], ["b", "todo"]]);
  clock += 2 * DAY;
  await move([["a", "done"], ["b", "todo"]]);
  // A save that moves no card (a rename) logs no moves.
  await core.save({ slateId: "s1", actor: { kind: "person", userId: "u" }, source: "workshop", build: () => ({ set: { "creative.model.workshop": { ...board([["a", "done"], ["b", "todo"]]), title: "Renamed" } } }) });
  assert.deepEqual(events.map((row) => row.moves ?? null), [[{ card: "a", from: "todo", to: "review" }], [{ card: "a", from: "review", to: "done" }], null]);
  assert.deepEqual(events.map((row) => row.at), [1000, 1000 + 2 * DAY, 1000 + 2 * DAY]);
  const log = await readMoveLog({ find: (q, options) => ({ toArray: async () => events.filter((row) => row.slateId === q.slateId && row.moves).sort((a, b) => b.revision - a.revision).slice(0, options.limit) }) }, "s1");
  assert.deepEqual(timeInLane(log, 1000 + 3 * DAY), [{ laneId: "review", visits: 1, days: 2 }]);
  // A note-only save is never annotated.
  await core.save({ slateId: "s1", actor: { kind: "person", userId: "u" }, source: "autosave", build: () => ({ set: { nodes: [{ options: { id: "n", text: "hi" } }] } }) });
  assert.equal(events.at(-1).moves, undefined);
});

test("a lane cards end in is not waiting: a month in Done, or a retro's notes where they were put, says nothing", () => {
  const t0 = Date.UTC(2026, 10, 1);
  const flow = [
    { at: t0, moves: [{ card: "a", from: null, to: "doing" }, { card: "b", from: null, to: "doing" }] },
    { at: t0 + DAY, moves: [{ card: "a", from: "doing", to: "done" }] },
    { at: t0 + 3 * DAY, moves: [{ card: "b", from: "doing", to: "done" }] },
  ];
  // Doing: a 1 day, b 3 days. Done holds both for weeks, which is not a wait.
  assert.deepEqual(timeInLane(flow, t0 + 30 * DAY), [{ laneId: "doing", visits: 2, days: 2 }]);
  assert.equal(waitedLine(timeInLane(flow, t0 + 30 * DAY), board([])), "Cards waited 2 days in Doing.");
  // A retro: cards are put in Went well and stay. Nothing waited anywhere.
  const retro = { version: 1, title: "Retro", lanes: [{ id: "well", label: "Went well" }], cards: [] };
  const put = [{ at: t0, moves: [{ card: "x", from: null, to: "well" }, { card: "y", from: null, to: "well" }] }];
  assert.deepEqual(timeInLane(put, t0 + 10 * DAY), []);
  assert.equal(waitedLine(timeInLane(put, t0 + 10 * DAY), retro), null);
  // A card still in a lane others have moved on from is still waiting there, up to now.
  const stuck = [...flow, { at: t0 + 4 * DAY, moves: [{ card: "c", from: null, to: "doing" }] }];
  assert.deepEqual(timeInLane(stuck, t0 + 10 * DAY), [{ laneId: "doing", visits: 3, days: 3.3 }]);
});
