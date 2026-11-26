// The start page's use-case interview and its tiles, S6 (2026-11-26): the start.tiles.* actions as the
// app calls them (Meteor methods over the real registry, library, save core and add_component door:
// the exec world), with stand-ins only for the model, the drafting call and, where a test says so,
// the real meter with a guest: a talk's plan kept as the person's tile; the first build drafts each
// board (the quality gate), keeps them as private library drafts and opens them together on one new
// private slate, laid out side by side with no overlap; Make another opens a new slate from the kept
// drafts with no model; Make a fresh version drafts them again; rename and remove; a person reaches
// only their own tiles; a guest talks and builds from the guest allowance, and their tiles stay theirs
// when they save the account. And the wiring around them: rate limits, metering, removal with the
// account, the guest claim, never published.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { makeExecWorld } from "./exec-test-world.mjs";
import { makeProfileWorld, memoryCollection } from "./profile-test-stores.mjs";
import { meterWorld } from "./fixtures/meter-world.mjs";
import { mountDdp } from "../web/app/server/actions/ddp.mjs";
import { principalFromUser } from "../web/app/server/actions/principal.mjs";
import { API_TOKEN_SCOPES } from "../web/app/server/api-token-core.mjs";
import { createAppRegistry } from "../web/app/server/actions/index.mjs";
import { TILE_RATE_LIMITS } from "../web/app/server/actions/start-tiles.mjs";
import { createPersonalTiles } from "../web/app/server/start/tiles-core.mjs";
import { createStartInterview } from "../web/app/server/start/interview-core.mjs";
import { openBoardsOnNewSlate } from "../web/app/server/personal/open-slate.mjs";
import { parseComponentDraft } from "../web/app/server/methods/workshop-component-draft.mjs";
import { TILE_LIMITS, TILE_WORDS } from "../web/app/imports/api/common/personal-tiles.mjs";
import { START_WORDS, planTurnText } from "../web/app/imports/api/common/start-interview.mjs";
import { GUEST_NO_ADDRESS } from "../web/app/server/metering/allowance.mjs";
import { slateBoards, boardBoxes, BOARD_GAP } from "../web/app/imports/api/common/slate-boards.mjs";
import { overlapsAny } from "../web/app/imports/api/common/component-add.mjs";
import { boardRoom } from "../web/app/server/board-room.mjs";
import { runAIAction, installMeter } from "../web/app/server/metering/context.mjs";
import { DEFAULT_METERING, dayKey } from "../web/app/server/metering/policy.mjs";
import { METER_RATE_LIMITS } from "../web/app/server/metering/limits.mjs";

const app = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), "utf8");
const IDS = ["start.tiles.list", "start.tiles.rename", "start.tiles.remove", "start.tiles.build", "start.tiles.rebuild"];
const PLAN = {
  title: "Fantasy league HQ",
  blurb: "Draft night and every week's lineup for your twelve team league.",
  icon: "deals",
  summary: "A twelve team fantasy football league with a 15 round snake draft in August; lineups lock Thursday night.",
  boards: [
    { kind: "component", name: "Snake draft board", brief: "A snake draft board: lanes for available players by position and one lane per round that holds twelve picks.", why: "Your league drafts 15 rounds, snake style." },
    { kind: "component", name: "Weekly lineup", brief: "A weekly lineup board: starters, the bench and the waiver wire; lineups lock Thursday night.", why: "Lineups lock Thursday night." },
    { kind: "component", name: "Trade review", brief: "A trade review board: proposed trades move to reviewed and then accepted or vetoed by the league.", why: "Your league votes on trades." },
  ],
};
// What the drafting call answers: a board the quality gate takes, under a title of its own (the board is kept under the
// plan's name for it).
const board = (title) => parseComponentDraft({
  version: 1, title,
  lanes: [{ id: "available", label: "Available players" }, { id: "round", label: "Round one", capacity: 12 }, { id: "taken", label: "Drafted" }],
  cards: ["Running back one", "Wide receiver two", "Tight end three", "Quarterback four", "Kicker five", "Defense six"].map((label, i) => ({ id: `c${i}`, label, laneId: "available" })),
  rules: [{ kind: "one-step" }],
});
const TITLES = PLAN.boards.map((b) => b.name);
const DRAFTED_TITLES = ["The draft", "Lineups", "Trades"];
const plain = (fn) => async (...args) => {
  // the meter's refusal as the app's wiring makes it: its own code and words, a status the registry keeps
  try { return await fn(...args); } catch (error) { if (error?.error && !error.status) throw Object.assign(new Error(error.reason), { status: error.error === "guest" ? 403 : 402, code: error.error }); throw error; }
};

function tileRows() {
  const rows = memoryCollection();
  rows.countDocuments = async (selector) => (await rows.find(selector).toArray()).length;
  return rows;
}

async function makeWorld(t, { metered = false, address = "203.0.113.7" } = {}) {
  const world = makeExecWorld();
  t.after(() => world.close());
  t.after(() => installMeter(null));
  await world.libraryReady;
  world.users.docs.push({ _id: "gus", isAnonymous: true });
  const profile = await makeProfileWorld({ users: [{ _id: "owner" }, { _id: "other" }, { _id: "gus" }] });
  const rows = tileRows();
  const sent = [];
  const drafted = [];
  const answers = [];
  const locks = new Set();
  const marks = {};
  const stand = { refuse: null, weakAt: -1, off: null, missing: false, openFails: 0, allowed: 0, runs: 0 };
  let share = 0;
  let id = 0;
  let tileSeq = 0;
  Object.assign(world.deps, {
    loadUser: async (userId) => world.users.docs.find((user) => user._id === userId) || null,
    generateShareId: async () => "st" + (++share),
    newId: () => "slate-st" + (++id),
    resolveSlateForUser: async (shareId) => ({ slate: world.slate(shareId) }),
  });
  const lock = async (userId) => (locks.has(userId) ? null : (locks.add(userId), async () => { locks.delete(userId); }));
  const tiles = createPersonalTiles({
    tiles: rows,
    loadUser: world.deps.loadUser,
    profile: profile.store,
    newId: () => `Tile${String(++tileSeq).padStart(4, "0")}`,
    allowed: async () => { stand.allowed += 1; if (stand.refuse) throw Object.assign(new Error(stand.refuse), { status: 402, code: "ai_month" }); },
    lock,
    // one build, one metered action: personal.build for a person, start.build for a guest (the app's wiring)
    run: plain((user, fn) => { stand.runs += 1; return runAIAction({ feature: user.isAnonymous ? "start.build" : "personal.build", userId: user._id }, fn); }),
    draft: async (input) => {
      const index = drafted.length % PLAN.boards.length;
      drafted.push(input);
      if (stand.weakAt === drafted.length - 1) return { ...board("x"), cards: board("x").cards.map((card, i) => ({ ...card, label: `Piece ${i + 1}` })) };
      return board(DRAFTED_TITLES[index]);
    },
    library: { saveMade: (principal, input) => world.deps.library.saveMade(principal, input) },
    open: async ({ principal, itemIds, name, key }) => {
      // a slate that did not open (a passing failure), as many times as a test says
      if (stand.openFails > 0) { stand.openFails -= 1; throw new Error("The new slate could not be made."); }
      return openBoardsOnNewSlate({ deps: world.deps, principal, itemIds, name, key });
    },
    marker: async (userId, count) => { marks[userId] = count; },
  });
  world.deps.startTiles = tiles;
  const interview = createStartInterview({
    loadUser: world.deps.loadUser,
    profile: profile.store,
    connectedTools: async (userId) => (userId === "owner" ? [{ name: "Linear", cardId: "linear", kind: "mcp" }] : []),
    surfaceOff: async () => stand.off,
    modelMissing: async () => stand.missing,
    allowed: async () => {},
    lock,
    run: plain((userId, fn) => runAIAction({ feature: "start.interview", userId }, fn)),
    request: async (opts) => { sent.push(opts); const next = answers.shift(); return next ?? { abort: true, abortMessage: "nothing queued" }; },
    tiles: { full: (userId) => tiles.full(userId), revisable: (principal, tileId) => tiles.revisable(principal, tileId), saveFromTalk: (principal, talk) => tiles.saveFromTalk(principal, talk) },
  });
  let methods;
  mountDdp(world.registry, {
    defineMethods: (defined) => (methods = defined),
    makeError: (code, reason, details) => Object.assign(new Error(reason), { error: code, reason, details }),
    loadUser: world.deps.loadUser,
    scopes: API_TOKEN_SCOPES,
  });
  const person = (userId) => principalFromUser(world.users.docs.find((user) => user._id === userId), API_TOKEN_SCOPES);
  // A Meteor method as the app calls it, signed in (or as a guest).
  const as = (userId) => (method, input = {}) => methods[method].call({ userId }, input);
  const talk = (userId, input) => interview.turn(person(userId), input);
  const meter = metered ? await meterWorld({ person: { anonymous: true }, settings: { ...structuredClone(DEFAULT_METERING), free: { ...DEFAULT_METERING.free, proRequiredFrom: "now" }, ownKeys: true }, address }) : null;
  return { world, profile, rows, sent, drafted, answers, locks, marks, stand, as, talk, person, meter, tiles };
}
const plan = (args = PLAN) => ({ toolCall: { name: "propose_plan", arguments: args } });
const ask = (question) => ({ toolCall: { name: "ask", arguments: { question } } });
const HISTORY = [{ role: "user", content: "I want something for my fantasy football league." }, { role: "assistant", content: "How many teams are in your league?" }];

async function planned(w, userId = "owner") {
  w.answers.push(plan());
  const out = await w.talk(userId, { message: "Twelve teams, snake draft, 15 rounds.", history: HISTORY, planNow: true });
  return out.tile;
}

test("five actions, the person's own, in the app only: a signed-in person or a guest, never a token", () => {
  const registry = createAppRegistry();
  const tiles = registry.list().filter((action) => action.id.startsWith("start."));
  assert.deepEqual(tiles.map((action) => action.id).sort(), [...IDS].sort());
  for (const action of tiles) {
    assert.deepEqual(action.principals, ["person", "guest"], action.id);
    assert.equal(action.mounts.http, null, `${action.id}: no /api/v1 route, no tool`);
    assert.equal(action.tool, null, action.id);
    assert.equal(action.scope, action.kind === "read" ? "profile:read" : "profile:write", action.id);
  }
  assert.deepEqual(registry.get("start.tiles.build").alsoScopes, ["slates:write"]);
  assert.equal(registry.get("start.tiles.build").changesNoSlate, false, "building makes a slate");
  assert.deepEqual(Object.keys(TILE_RATE_LIMITS).sort(), [...IDS].sort());
  for (const method of ["start.interview.turn", "start.tiles.build", "start.tiles.rebuild"]) assert.ok(METER_RATE_LIMITS.some((rule) => rule.method === method && rule.per === "user"), method);
});

test("the talk: specific questions, then the plan kept as the person's tile; About you and connected tools reach it as data, signed in only", async (t) => {
  const w = await makeWorld(t);
  await w.profile.store.add("owner", { kind: "role", text: "League commissioner" });
  w.answers.push(ask("How many teams are in your league, and is the draft snake or auction?"));
  const first = await w.talk("owner", { message: "I want something for my fantasy football league.", history: [] });
  assert.deepEqual(first, { reply: "How many teams are in your league, and is the draft snake or auction?" });
  // the request: the surface's own feature, the person's words as data, what is known as data
  const opts = w.sent[0];
  assert.equal(opts.feature, "start.interview");
  assert.equal(opts.userId, "owner");
  assert.deepEqual(opts.prompts, [{ role: "user", content: '<data name="answer">I want something for my fantasy football league.</data>' }]);
  assert.match(opts.system, /<data name="facts">- role: League commissioner<\/data>/);
  assert.match(opts.system, /<data name="tools">- Linear<\/data>/);
  // the plan, kept as their tile (nothing built yet), with the talk's text
  const tile = await planned(w);
  assert.deepEqual({ title: tile.title, icon: tile.icon, built: tile.built, boards: tile.boards.length }, { title: PLAN.title, icon: "deals", built: null, boards: 3 });
  assert.deepEqual(w.sent.at(-1).function_call, { name: "propose_plan" }, "the plan was asked for");
  const row = await w.rows.findOne({ _id: tile.id });
  assert.equal(row.userId, "owner");
  assert.deepEqual(row.interview.turns.map((turn) => turn.text), [HISTORY[0].content, HISTORY[1].content, "Twelve teams, snake draft, 15 rounds."]);
  assert.equal(row.interview.summary, PLAN.summary);
  assert.equal(w.marks.owner, 1, "/new knows they keep a tile");
  assert.equal(w.drafted.length, 0, "a plan builds nothing by itself");
  // personalization off: nothing of About you, nor the tools, reaches the talk
  await w.profile.store.setSettings("owner", { on: false });
  w.answers.push(ask("How many rounds?"));
  await w.talk("owner", { message: "My league.", history: [] });
  assert.doesNotMatch(w.sent.at(-1).system, /<data name="facts">|<data name="tools">/);
  // a guest: never About you, never tools
  w.answers.push(ask("How many teams?"));
  await w.talk("gus", { message: "My league.", history: [] });
  assert.doesNotMatch(w.sent.at(-1).system, /<data name="facts">|<data name="tools">/);
  // before any model: the administrator's switch and a model to answer it; a bad message or history
  w.stand.off = { message: "Not today." };
  await assert.rejects(w.talk("owner", { message: "x", history: [] }), (error) => error.code === "turned-off" && error.message === `${START_WORDS.off} Not today.`);
  w.stand.off = null;
  w.stand.missing = true;
  await assert.rejects(w.talk("owner", { message: "x", history: [] }), (error) => error.code === "no-model");
  w.stand.missing = false;
  await assert.rejects(w.talk("owner", { message: "", history: [] }), (error) => error.code === "invalid-turn");
  await assert.rejects(w.talk("owner", { message: "x", history: [{ role: "assistant", content: "Hi?" }] }), (error) => error.code === "invalid-history");
  // an answer that cannot be used is said plainly
  w.answers.push({ toolCall: { name: "remember", arguments: {} } });
  await assert.rejects(w.talk("owner", { message: "x", history: [] }), (error) => error.code === "reply-unavailable" && error.message === START_WORDS.failed);
  assert.equal(w.locks.size, 0);
});

test("list, rename and remove: only the person's own tiles; another person's tile answers as not found", async (t) => {
  const w = await makeWorld(t);
  const owner = w.as("owner");
  const tile = await planned(w);
  const listed = await owner("start.tiles.list");
  assert.deepEqual({ ids: listed.tiles.map((item) => item.id), max: listed.max }, { ids: [tile.id], max: TILE_LIMITS.perPerson });
  assert.equal("interview" in listed.tiles[0], false, "the transcript stays on the server");
  // someone else sees none of it, and cannot touch it
  const other = w.as("other");
  assert.deepEqual((await other("start.tiles.list")).tiles, []);
  for (const [method, input] of [["start.tiles.rename", { tileId: tile.id, title: "Mine now" }], ["start.tiles.remove", { tileId: tile.id }], ["start.tiles.build", { tileId: tile.id }], ["start.tiles.rebuild", { tileId: tile.id }]]) {
    await assert.rejects(other(method, input), (error) => error.error === "not_found" && error.reason === TILE_WORDS.notFound, method);
  }
  assert.equal(w.drafted.length, 0);
  assert.equal((await w.rows.findOne({ _id: tile.id })).title, PLAN.title);
  // renamed by its person: one line, bounded, nothing sensitive
  const renamed = await owner("start.tiles.rename", { tileId: tile.id, title: "  Sunday   league " });
  assert.equal(renamed.title, "Sunday league");
  await assert.rejects(owner("start.tiles.rename", { tileId: tile.id, title: "My password is hunter2" }), (error) => error.error === "invalid_request" && error.reason === TILE_WORDS.sensitive);
  await assert.rejects(owner("start.tiles.rename", { tileId: "not a tile!", title: "x" }), (error) => error.error === "invalid_request");
  // removed: gone, and /new is told
  assert.deepEqual(await owner("start.tiles.remove", { tileId: tile.id }), { tileId: tile.id, removed: true, mode: "save" });
  assert.deepEqual((await owner("start.tiles.list")).tiles, []);
  assert.equal(w.marks.owner, 0);
  await assert.rejects(owner("start.tiles.remove", { tileId: tile.id }), (error) => error.error === "not_found");
});

test("the first build: each board drafted through the quality gate, kept as private library drafts, opened together on one new private slate with no overlap", async (t) => {
  const w = await makeWorld(t);
  await w.profile.store.add("owner", { kind: "role", text: "League commissioner" });
  const owner = w.as("owner");
  const tile = await planned(w);
  const built = await owner("start.tiles.build", { tileId: tile.id });
  assert.deepEqual({ ...built, shareId: "x" }, { tileId: tile.id, title: PLAN.title, shareId: "x", boards: 3, repeat: false, fresh: false, mode: "save" });
  // the drafts: For you's path, with the talk's summary and each board's why (and About you) as data
  const facts = await w.profile.store.forPrompt("owner");
  assert.deepEqual(w.drafted, PLAN.boards.map((b) => ({ userId: "owner", brief: b.brief, format: "component", tile: { summary: PLAN.summary, name: b.name, why: b.why, facts } })));
  // the person's own private drafts in the library, from this tile
  const row = await w.rows.findOne({ _id: tile.id });
  assert.equal(row.built.libraryDraftIds.length, 3);
  for (const [index, itemId] of row.built.libraryDraftIds.entries()) {
    const item = await w.world.library.items.findOne({ _id: itemId });
    assert.deepEqual({ kind: item.kind, status: item.status, authorId: item.authorId, title: item.title, madeFor: item.provenance.madeFor },
      { kind: "component", status: "draft", authorId: "owner", title: TITLES[index], madeFor: { kind: "tile", tileId: tile.id } });
  }
  // (each board is called what the plan called it, whatever title the draft came with)
  // one new private slate of theirs, named for the tile, holding all three boards
  const slate = w.world.slate(built.shareId);
  assert.equal(slate.userId, "owner");
  assert.deepEqual([slate.options.isPrivate, slate.options.isPublic, slate.options.name], [true, false, PLAN.title]);
  const boards = slateBoards(slate);
  assert.deepEqual(boards.map((b) => b.id), ["main", "b2", "b3"]);
  assert.deepEqual(boards.map((b) => b.model.workshop.title), TITLES);
  // laid out side by side on one row, BOARD_GAP apart past the room each keeps: no board covers another
  const boxes = boardBoxes(slate, boardRoom);
  assert.equal(boxes.length, 3);
  for (const [i, box] of boxes.entries()) assert.equal(overlapsAny(box, boxes.filter((_, j) => j !== i)), false, box.id);
  for (let i = 1; i < boxes.length; i += 1) {
    assert.equal(boxes[i].y, boxes[0].y, "the first board's row");
    assert.ok(boxes[i].x >= boxes[i - 1].x + boxes[i - 1].width + BOARD_GAP - 1, "past the board before it");
  }
  // through the add_component door, once per board
  assert.deepEqual(w.world.runs.filter((run) => run.slateShareId === built.shareId).map((run) => run.plan.operations[0].library.itemId), row.built.libraryDraftIds);
  assert.equal(w.locks.size, 0);
});

test("Make another: a new slate from the kept drafts, at once, with no model; Make a fresh version drafts every board again", async (t) => {
  const w = await makeWorld(t);
  const owner = w.as("owner");
  const tile = await planned(w);
  const first = await owner("start.tiles.build", { tileId: tile.id });
  const kept = (await w.rows.findOne({ _id: tile.id })).built.libraryDraftIds;
  const sentBefore = w.sent.length;
  // Make another: no draft, no model, a new slate with the same boards
  const again = await owner("start.tiles.build", { tileId: tile.id });
  assert.deepEqual([again.repeat, again.boards], [true, 3]);
  assert.notEqual(again.shareId, first.shareId);
  assert.equal(w.drafted.length, 3, "no board drafted again");
  assert.equal(w.sent.length, sentBefore, "no model asked");
  assert.deepEqual(slateBoards(w.world.slate(again.shareId)).map((b) => b.model.workshop.title), TITLES);
  assert.ok((await owner("start.tiles.list")).tiles[0].usedAt, "used just now");
  assert.deepEqual((await owner("start.tiles.list")).tiles[0].built.boards, 3);
  // a fresh version: every board drafted again from the talk, kept for the next Make another
  const fresh = await owner("start.tiles.rebuild", { tileId: tile.id });
  assert.deepEqual([fresh.repeat, fresh.fresh, fresh.boards], [false, true, 3]);
  assert.equal(w.drafted.length, 6);
  const now = (await w.rows.findOne({ _id: tile.id })).built.libraryDraftIds;
  assert.equal(now.filter((itemId) => kept.includes(itemId)).length, 0, "new drafts");
  // the earlier drafts stay in the person's library: they are their own, and may be on slates
  for (const itemId of kept) assert.ok(await w.world.library.items.findOne({ _id: itemId }));
  const next = await owner("start.tiles.build", { tileId: tile.id });
  assert.equal(next.repeat, true);
  assert.deepEqual(w.world.runs.filter((run) => run.slateShareId === next.shareId).map((run) => run.plan.operations[0].library.itemId), now);
  // a kept draft discarded from the library since: said plainly, a fresh version offered
  await w.world.library.items.deleteOne({ _id: now[1] });
  await assert.rejects(owner("start.tiles.build", { tileId: tile.id }), (error) => error.error === "drafts_gone" && error.reason === TILE_WORDS.draftsGone);
  assert.equal(w.locks.size, 0);
});

test("a build refuses: a board the quality gate turns down (the boards before it are kept for the retry), the meter, one build at a time", async (t) => {
  const w = await makeWorld(t);
  const owner = w.as("owner");
  const tile = await planned(w);
  w.stand.weakAt = 1;
  await assert.rejects(owner("start.tiles.build", { tileId: tile.id }), (error) => error.error === "weak_draft" && error.reason === TILE_WORDS.weakDraft && error.details.details.board === 1);
  const row = await w.rows.findOne({ _id: tile.id });
  assert.equal(row.built, null, "not built");
  assert.equal(row.pending.libraryDraftIds.length, 1, "the first board is kept");
  // the retry drafts only what is missing
  w.stand.weakAt = -1;
  const built = await owner("start.tiles.build", { tileId: tile.id });
  assert.equal(built.boards, 3);
  assert.equal(w.drafted.length, 4, "two before, two more after: the first board was not drafted again");
  assert.deepEqual((await w.rows.findOne({ _id: tile.id })).built.libraryDraftIds[0], row.pending.libraryDraftIds[0]);
  // the meter's refusal, before anything is drafted
  const second = await planned(w);
  w.stand.refuse = "You have used this month's free AI.";
  await assert.rejects(owner("start.tiles.build", { tileId: second.id }), (error) => error.error === "ai_month");
  w.stand.refuse = null;
  assert.equal(w.drafted.length, 4);
  // one build at a time per person
  w.locks.add("owner");
  await assert.rejects(owner("start.tiles.build", { tileId: second.id }), (error) => error.error === "busy");
  w.locks.delete("owner");
});

test("at most 24 tiles a person: the talk says so before any model is asked", async (t) => {
  const w = await makeWorld(t);
  for (let i = 0; i < TILE_LIMITS.perPerson; i += 1) await planned(w);
  const sent = w.sent.length;
  await assert.rejects(w.talk("owner", { message: "One more.", history: [] }), (error) => error.code === "tiles-full" && error.message === TILE_WORDS.full);
  assert.equal(w.sent.length, sent);
  await assert.rejects(w.tiles.saveFromTalk(w.person("owner"), { plan: PLAN, summary: PLAN.summary, turns: [] }), (error) => error.code === "tiles_full");
  assert.equal((await w.as("owner")("start.tiles.list")).tiles.length, 24);
});

test("a guest: talks and builds from the guest allowance (12 turns, 1 build a day), Make another still opens at once; the tiles stay theirs when they save the account", async (t) => {
  const w = await makeWorld(t, { metered: true });
  const gus = w.as("gus");
  // the talk's turns come from the guest allowance
  w.answers.push(ask("How many teams are in your league?"));
  await w.talk("gus", { message: "My fantasy league.", history: [] });
  const day = () => w.meter.stores.counters.get(`user:u1:${dayKey(Date.UTC(2026, 10, 19, 12))}`) || {};
  assert.equal(day().allowance_start_interview, 1);
  const tile = await planned(w, "gus");
  assert.equal(day().allowance_start_interview, 2);
  // one build a day: drafted (three boards, one use), kept on the guest's own account, opened on the guest's own slate
  const built = await gus("start.tiles.build", { tileId: tile.id });
  assert.equal(built.boards, 3);
  assert.equal(day().allowance_start_build, 1, "one build, however many boards");
  assert.equal(w.meter.stores.counters.get(`address:guest:203.0.113.7:${dayKey(Date.UTC(2026, 10, 19, 12))}`).allowance_start_build, 1, "and the address's guest count");
  assert.equal(w.world.slate(built.shareId).userId, "gus");
  const kept = (await w.rows.findOne({ _id: tile.id })).built.libraryDraftIds;
  for (const itemId of kept) assert.equal((await w.world.library.items.findOne({ _id: itemId })).authorId, "gus");
  // a second build today: save the account; Make another needs no build and opens at once
  const second = await planned(w, "gus");
  await assert.rejects(gus("start.tiles.build", { tileId: second.id }), (error) => error.error === "guest" && /Save your account/.test(error.reason));
  const again = await gus("start.tiles.build", { tileId: tile.id });
  assert.equal(again.repeat, true);
  // a guest's twelfth turn is the last today
  for (let i = day().allowance_start_interview; i < 12; i += 1) { w.answers.push(ask("And then?")); await w.talk("gus", { message: "More.", history: [] }); }
  w.answers.push(ask("And then?"));
  await assert.rejects(w.talk("gus", { message: "More.", history: [] }), (error) => error.code === "guest" && /Save your account/.test(error.message));
  // the guest saves the account (users.identify: the same account, its id unchanged): the tiles are still theirs
  const guest = w.world.users.docs.find((user) => user._id === "gus");
  guest.isAnonymous = false;
  const listed = await gus("start.tiles.list");
  assert.deepEqual(listed.tiles.map((item) => item.id).sort(), [tile.id, second.id].sort());
  installMeter(null);
  const saved = await gus("start.tiles.build", { tileId: tile.id });
  assert.equal(saved.repeat, true);
  assert.deepEqual(w.world.runs.filter((run) => run.slateShareId === saved.shareId).map((run) => run.plan.operations[0].library.itemId), kept, "their kept drafts, still theirs");
  // and now About you can reach their talks
  await w.profile.store.add("gus", { kind: "role", text: "League commissioner" });
  w.answers.push(ask("How many teams?"));
  await w.talk("gus", { message: "Another league.", history: [] });
  assert.match(w.sent.at(-1).system, /<data name="facts">- role: League commissioner<\/data>/);
});

test("a retry with every board drafted already opens them with no model and no use; a gone draft starts the boards over", async (t) => {
  const w = await makeWorld(t);
  const owner = w.as("owner");
  const tile = await planned(w);
  // every board drafted, then the slate did not open
  w.stand.openFails = 1;
  await assert.rejects(owner("start.tiles.build", { tileId: tile.id }), (error) => error.reason === TILE_WORDS.buildFailed);
  const row = await w.rows.findOne({ _id: tile.id });
  assert.equal(row.pending.libraryDraftIds.length, 3, "all three kept");
  assert.deepEqual([w.drafted.length, w.stand.allowed, w.stand.runs], [3, 1, 1]);
  // trying again: no allowance asked, no metered action, no model; the kept boards open
  w.stand.refuse = "You have used today's free builds of your ideas.";
  const built = await owner("start.tiles.build", { tileId: tile.id });
  assert.deepEqual([built.boards, built.repeat], [3, false]);
  assert.deepEqual([w.drafted.length, w.stand.allowed, w.stand.runs], [3, 1, 1], "nothing drafted, nothing metered");
  assert.deepEqual((await w.rows.findOne({ _id: tile.id })).built.libraryDraftIds, row.pending.libraryDraftIds);
  w.stand.refuse = null;
  // a fresh version whose kept drafts went missing before its slate opened: the next try drafts every board again
  w.stand.openFails = 1;
  await assert.rejects(owner("start.tiles.rebuild", { tileId: tile.id }), (error) => error.reason === TILE_WORDS.buildFailed);
  const part = (await w.rows.findOne({ _id: tile.id })).pending.libraryDraftIds;
  await w.world.library.items.deleteOne({ _id: part[0] });
  await assert.rejects(owner("start.tiles.rebuild", { tileId: tile.id }), (error) => error.error === "drafts_gone");
  assert.equal((await w.rows.findOne({ _id: tile.id })).pending, null, "the saved progress is cleared");
  const before = w.drafted.length;
  const fresh = await owner("start.tiles.rebuild", { tileId: tile.id });
  assert.equal(fresh.boards, 3);
  assert.equal(w.drafted.length, before + 3, "every board drafted again");
  assert.equal(w.locks.size, 0);
});

test("changing a plan in the same talk revises its own tile, before it is built: no tile added, never another person's", async (t) => {
  const w = await makeWorld(t);
  const owner = w.as("owner");
  const tile = await planned(w);
  const count = () => w.rows.countDocuments({ userId: "owner" });
  // the plan's turn comes back as the agent's (data), then the change
  const history = [...HISTORY, { role: "user", content: "Twelve teams, snake draft, 15 rounds." }, { role: "assistant", content: planTurnText(PLAN) }];
  w.answers.push(plan({ ...PLAN, boards: PLAN.boards.slice(0, 2) }));
  const out = await w.talk("owner", { message: "Drop the trade board.", history, tileId: tile.id });
  assert.equal(out.tile.id, tile.id);
  assert.deepEqual(out.tile.boards.map((b) => b.name), ["Snake draft board", "Weekly lineup"]);
  assert.equal(await count(), 1, "the same tile");
  const row = await w.rows.findOne({ _id: tile.id });
  assert.equal(row.plan.boards.length, 2);
  assert.equal(row.interview.turns.at(-1).text, "Drop the trade board.");
  assert.match(w.sent.at(-1).prompts.at(-2).content, /^<data name="question">I proposed this plan:/);
  // at the most tiles a person keeps, changing one still works (it adds none)
  for (let i = 1; i < TILE_LIMITS.perPerson; i += 1) await planned(w);
  w.answers.push(plan(PLAN));
  assert.equal((await w.talk("owner", { message: "Put it back.", history, tileId: tile.id })).tile.id, tile.id);
  assert.equal(await count(), TILE_LIMITS.perPerson);
  // another person's tile, or a made-up id: not found, before any model
  const sent = w.sent.length;
  await assert.rejects(w.talk("other", { message: "Mine.", history, tileId: tile.id }), (error) => error.code === "not_found");
  await assert.rejects(w.talk("owner", { message: "x", history, tileId: "no such!" }), (error) => error.code === "invalid-turn");
  // once built, it stays as it is
  await owner("start.tiles.build", { tileId: tile.id });
  await assert.rejects(w.talk("owner", { message: "Add a board.", history, tileId: tile.id }), (error) => error.code === "tile_built" && error.message === TILE_WORDS.revised);
  assert.equal(w.sent.length, sent, "no model asked for any refusal");
});

test("a guest whose network address is not known gets no guest allowance: save the account, nothing counted", async (t) => {
  const w = await makeWorld(t, { metered: true, address: "10.0.0.7" });
  w.answers.push(ask("How many teams are in your league?"));
  await assert.rejects(w.talk("gus", { message: "My fantasy league.", history: [] }), (error) => error.code === "guest" && error.message === GUEST_NO_ADDRESS);
  assert.equal(w.sent.length, 0, "no model asked");
  const day = w.meter.stores.counters.get(`user:u1:${dayKey(Date.UTC(2026, 10, 19, 12))}`) || {};
  assert.equal(day.allowance_start_interview, undefined);
});

test("the guest claim keeps the tiles: users.identify carries the marker /new reads; removed with the account; never published", async () => {
  const users = app("server/methods/users.js");
  assert.match(users, /\.\.\.\(Number\.isInteger\(user\.profile\?\.startTiles\) && user\.profile\.startTiles > 0 && \{ startTiles: user\.profile\.startTiles \}\)/);
  // the tiles themselves are keyed by the account's id, which saving the account does not change
  assert.match(users, /\{ _id: Meteor\.userId\(\) \},\n\s+\{ \$set: updateUser \}/);
  // removed with the account
  const profile = await makeProfileWorld({ users: [{ _id: "ada" }] });
  const { createProfileStore } = await import("../web/app/server/profile/store.mjs");
  const tiles = memoryCollection();
  const store = createProfileStore({ facts: memoryCollection(), settings: memoryCollection(), users: profile.people, newId: () => "f1", tiles });
  await tiles.insertOne({ _id: "t1", userId: "ada" });
  await tiles.insertOne({ _id: "t2", userId: "bo" });
  await store.removeAll("ada");
  assert.deepEqual(tiles.docs.map((doc) => doc._id), ["t2"]);
  assert.match(app("server/profile/meteor.js"), /tiles: PersonalTiles\.rawCollection\(\)/);
  assert.doesNotMatch(app("server/publications.js"), /PersonalTiles|personalTiles/);
  // the Meteor wiring: req inside runAIAction under the surface's feature; builds under personal.build or start.build
  const meteor = app("server/start/meteor.js");
  assert.match(meteor, /const FEATURE = 'start\.interview'/);
  assert.match(meteor, /run: \(userId, fn\) => runAIAction\(\{ feature: FEATURE, userId \}, fn\),/);
  assert.match(meteor, /const buildFeature = \(user\) => \(user\?\.isAnonymous \? 'start\.build' : 'personal\.build'\)/);
  assert.match(meteor, /run: refusing\(\(user, fn\) => runAIAction\(\{ feature: buildFeature\(user\), userId: user\._id/);
  assert.match(meteor, /surfaceOff: \(userId\) => surfaceOffFor\(\{ feature: FEATURE, userId \}\)/);
  assert.match(meteor, /draft: refusing\(\(input\) => draftForTile\(input\), DRAFT_WORDS\)/);
  assert.match(app("server/actions/mount.js"), /deps\.startTiles = createAppStartTiles\(deps\)/);
  // a tile's drafts: For you's drafting path, with workshop.draft.tile, a guest only for this
  const workshops = app("server/methods/workshops.js");
  assert.match(workshops, /export function draftForTile\(\{ userId, brief, format, tile \}\)/);
  assert.match(workshops, /const guestTile = Boolean\(forYou\?\.tile && forYou\.feature === 'start\.build'\)/);
  assert.match(workshops, /promptText\('workshop\.draft\.tile', \{ instructions, summary/);
  // a guest uses the agent only through the guest allowance, and only where the meter runs
  assert.match(app("server/metering/meteor.js"), /if \(user\.isAnonymous && \(!GUEST_FEATURES\.includes\(feature\) \|\| !meterOn\(\)\)\) return false/);
  // the library keeps a guest's drafts for a tile only
  assert.match(app("server/library/core.mjs"), /if \(!principal\?\.userId \|\| \(principal\.kind === 'guest' && !tile\)\) throw fail\(403, 'sign_in_to_publish'/);
});
