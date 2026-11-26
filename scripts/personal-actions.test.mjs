// For you, S4 (2026-11-26): the personal.ideas.* actions, declared once and served on every surface
// (the Meteor methods My slates and the library call, /api/v1, the exec client and the MCP tools),
// over the real registry, library, save core and add_component door (the exec world), with
// stand-ins only for the model, the drafting call and the meter: only the signed-in person, for
// themselves; a guest gets nothing; a token needs profile:read or profile:write (and slates:write to
// build); with personalization off or nothing known no model is asked; every request names the
// person's facts and connected tools as data; a build is a private library draft opened on a new
// private slate. And the wiring around them: removed with the account, MIT core, rate limits, the
// For you cards in My slates, the library and the interview's summary.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { makeExecWorld } from "./exec-test-world.mjs";
import { makeProfileWorld, memoryCollection } from "./profile-test-stores.mjs";
import { mountDdp } from "../web/app/server/actions/ddp.mjs";
import { principalFromUser } from "../web/app/server/actions/principal.mjs";
import { boundActions } from "../web/app/server/actions/exec-binding.mjs";
import { buildContract } from "../web/app/server/actions/contract.mjs";
import { API_TOKEN_SCOPES } from "../web/app/server/api-token-core.mjs";
import { PERSONAL_RATE_LIMITS } from "../web/app/server/actions/personal.mjs";
import { createPersonalIdeas, factsKeyOf } from "../web/app/server/personal/core.mjs";
import { openOnNewSlate } from "../web/app/server/personal/open-slate.mjs";
import { parseComponentDraft } from "../web/app/server/methods/workshop-component-draft.mjs";
import { IDEA_LIMITS, IDEA_WORDS } from "../web/app/imports/api/common/personal-ideas.mjs";
import { METER_RATE_LIMITS } from "../web/app/server/metering/limits.mjs";
import { createAppRegistry } from "../web/app/server/actions/index.mjs";

const app = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), "utf8");
const IDS = ["personal.ideas.list", "personal.ideas.refresh", "personal.ideas.dismiss", "personal.ideas.build"];
const IDEAS = [
  { title: "Monday sprint planning in Linear", kind: "component", why: "You plan sprints in Linear every Monday.",
    brief: "A backlog lane of Linear issues, a This sprint lane that holds eight, and Shipped. Cards are the bugs the designers raise.", tools: ["Linear"] },
  { title: "Morning bug queue triage", kind: "component", why: "You triage the bug queue every morning.",
    brief: "Lanes for new bugs, triaged, assigned and closed, with one-step moves, for the morning bug queue.", tools: [] },
  { title: "Design review for the mobile app", kind: "grid", why: "Your team is six designers on the mobile app.",
    brief: "A printable page to review mobile app screens with the six designers: a heading, screen panels and notes.", tools: [] },
];
const answer = (ideas) => ({ toolCall: { name: "suggest_ideas", arguments: { ideas } } });
// What the drafting call answers: a sprint board the quality gate takes, in the person's words.
const BOARD = parseComponentDraft({
  version: 1, title: "Monday sprint planning",
  lanes: [{ id: "backlog", label: "Linear backlog" }, { id: "sprint", label: "This sprint", capacity: 8 }, { id: "shipped", label: "Shipped" }],
  cards: ["Crash on login", "Dark mode toggle", "Onboarding redesign", "Push reminders", "Settings search", "Offline drafts"].map((label, i) => ({ id: `c${i}`, label, laneId: "backlog" })),
  rules: [{ kind: "one-step" }],
});

async function makeWorld(t, { tools = { owner: [{ name: "Linear", cardId: "linear", kind: "mcp" }] } } = {}) {
  const world = makeExecWorld();
  t.after(() => world.close());
  await world.libraryReady;
  world.users.docs.push({ _id: "gus", isAnonymous: true });
  const profile = await makeProfileWorld({ users: [{ _id: "owner" }, { _id: "other" }, { _id: "gus" }] });
  const ideas = memoryCollection();
  const sent = [];
  const drafted = [];
  const answers = [];
  const locks = new Set();
  const stand = { off: null, missing: false, refuse: null, board: BOARD, openFails: 0, clock: Date.parse("2026-11-26T15:00:00Z") };
  let share = 0;
  let id = 0;
  Object.assign(world.deps, {
    loadUser: async (userId) => world.users.docs.find((user) => user._id === userId) || null,
    generateShareId: async () => "fy" + (++share),
    newId: () => "slate-fy" + (++id),
  });
  world.deps.personal = createPersonalIdeas({
    ideas,
    loadUser: world.deps.loadUser,
    profile: profile.store,
    connectedTools: async (userId) => tools[userId] || [],
    surfaceOff: async () => stand.off,
    modelMissing: async () => stand.missing,
    allowed: async () => { if (stand.refuse) throw Object.assign(new Error(stand.refuse), { status: 402, code: "ai_month" }); },
    lock: async (userId) => (locks.has(userId) ? null : (locks.add(userId), async () => { locks.delete(userId); })),
    run: async (_userId, fn) => fn(),
    // an answer, or a function of the request (req running its check on the model's answers)
    request: async (opts) => { sent.push(opts); const next = answers.shift(); return typeof next === "function" ? next(opts) : next ?? { abort: true, abortMessage: "nothing queued" }; },
    draft: async (input) => { drafted.push(input); return structuredClone(stand.board); },
    library: { saveMade: (principal, input) => world.deps.library.saveMade(principal, input) },
    open: ({ principal, itemId, key }) => {
      if (stand.openFails > 0) { stand.openFails -= 1; return Promise.reject(Object.assign(new Error("The new slate could not be made."), { status: 503, code: "unavailable" })); }
      return openOnNewSlate({ deps: world.deps, principal, itemId, key });
    },
    now: () => stand.clock,
  });
  let methods;
  mountDdp(world.registry, {
    defineMethods: (defined) => (methods = defined),
    makeError: (code, reason, details) => Object.assign(new Error(reason), { error: code, reason, details }),
    loadUser: world.deps.loadUser,
    scopes: API_TOKEN_SCOPES,
  });
  // A Meteor method as the app calls it, as a signed-in person.
  const as = (userId) => (method, input = {}) => methods[method].call({ userId }, input);
  const person = (userId) => principalFromUser(world.users.docs.find((user) => user._id === userId), API_TOKEN_SCOPES);
  const run = (principal, action, input = {}) => world.registry.run(principal, action, input).then((result) => result.body);
  const facts = async (userId, list) => { for (const [kind, text] of list) await profile.store.add(userId, { kind, text }); };
  return { world, profile, ideas, sent, drafted, answers, locks, stand, as, person, run, facts };
}
const PM = [["role", "Product manager"], ["team", "Six designers on the mobile app"], ["routine", "Plans sprints in Linear every Monday"], ["work", "Triages the bug queue every morning"]];

test("four actions, each the person's own: profile:read to read, profile:write to change (and slates:write to build), never a guest's", () => {
  const registry = createAppRegistry();
  const personal = registry.list().filter((action) => action.id.startsWith("personal."));
  assert.deepEqual(personal.map((action) => action.id).sort(), [...IDS].sort());
  for (const action of personal) {
    assert.equal(action.toolset, "account", action.id);
    assert.equal(action.scope, action.kind === "read" ? "profile:read" : "profile:write", action.id);
    assert.deepEqual(action.principals, ["person", "agent"], action.id);
    assert.ok(action.mounts.ddp && action.mounts.http && action.tool?.name, action.id);
    if (action.kind === "write") assert.equal(action.idempotency, "optional", action.id);
  }
  assert.deepEqual(registry.get("personal.ideas.build").alsoScopes, ["slates:write"]);
  assert.equal(registry.get("personal.ideas.build").changesNoSlate, false, "building makes a slate");
  assert.equal(registry.get("personal.ideas.refresh").changesNoSlate, true);
  assert.deepEqual(boundActions(registry).map((action) => action.id).filter((id) => id.startsWith("personal.")).sort(), [...IDS].sort());
  assert.deepEqual(buildContract(registry).actions.filter((action) => action.id.startsWith("personal.")).map((action) => action.tool.name).sort(),
    ["build_idea_for_you", "dismiss_idea_for_you", "list_ideas_for_you", "refresh_ideas_for_you"]);
});

test("nothing to suggest from, or personalization off: the empty state, and no model is asked", async (t) => {
  const w = await makeWorld(t, { tools: {} });
  const owner = w.as("owner");
  const empty = await owner("personal.ideas.refresh");
  assert.deepEqual({ ideas: empty.ideas, empty: empty.empty, canRefresh: empty.canRefresh }, { ideas: [], empty: { code: "nothing-known", message: IDEA_WORDS.nothingKnown }, canRefresh: false });
  assert.equal(w.sent.length, 0, "no request with nothing known");
  await w.facts("owner", PM);
  await w.profile.store.setSettings("owner", { on: false });
  const off = await owner("personal.ideas.refresh");
  assert.deepEqual({ on: off.on, ideas: off.ideas, code: off.empty.code }, { on: false, ideas: [], code: "personalization-off" });
  assert.equal(w.sent.length, 0, "no request with personalization off");
  // ideas kept from before are not shown while personalization is off, and none is built
  await w.ideas.insertOne({ _id: "owner", userId: "owner", ideas: [{ id: "iaaaaaaaaaaaaaaa", ...IDEAS[0] }], factsKey: "x", createdAt: new Date() });
  assert.deepEqual((await owner("personal.ideas.list")).ideas, []);
  await assert.rejects(owner("personal.ideas.build", { ideaId: "iaaaaaaaaaaaaaaa" }), (error) => error.error === "personalization_off");
  assert.equal(w.drafted.length, 0);
  // a guest gets nothing: save the account first
  await assert.rejects(w.as("gus")("personal.ideas.list"), (error) => error.error === "registration_required");
});

test("new ideas: the facts and the connected tools' names reach the request as data; kept per person with the key of what they used", async (t) => {
  const w = await makeWorld(t);
  await w.facts("owner", PM);
  const owner = w.as("owner");
  w.answers.push(answer(IDEAS));
  const made = await owner("personal.ideas.refresh");
  assert.equal(w.sent.length, 1);
  const [opts] = w.sent;
  assert.equal(opts.feature, "personal.suggest");
  assert.equal(opts.userId, "owner");
  assert.match(opts.system, /<data name="facts">- role: Product manager\n/);
  assert.match(opts.system, /<data name="tools">- Linear<\/data>/);
  assert.equal(opts.functions[0].name, "suggest_ideas");
  assert.deepEqual(made.ideas.map((idea) => idea.title), IDEAS.map((idea) => idea.title));
  for (const idea of made.ideas) assert.match(idea.id, /^i[a-f0-9]{15}$/);
  assert.deepEqual({ empty: made.empty, stale: made.stale, canRefresh: made.canRefresh }, { empty: null, stale: false, canRefresh: true });
  const row = await w.ideas.findOne({ _id: "owner" });
  assert.equal(row.userId, "owner");
  assert.equal(row.factsKey, factsKeyOf(await w.profile.store.forPrompt("owner"), [{ name: "Linear" }]));
  assert.ok(row.createdAt instanceof Date);
  // list reads them back and asks nothing
  assert.deepEqual((await owner("personal.ideas.list")).ideas, made.ideas);
  assert.equal(w.sent.length, 1);
  // someone else's ideas are their own
  assert.deepEqual((await w.as("other")("personal.ideas.list")).ideas, []);
  // About you changes: the ideas say they no longer fit, until new ones are asked for
  await w.profile.store.add("owner", { kind: "goal", text: "Ship the mobile app in March" });
  assert.equal((await owner("personal.ideas.list")).stale, true);
  // Not for me: gone, and named to the next request as turned down (as data)
  const gone = made.ideas[1];
  assert.deepEqual(await owner("personal.ideas.dismiss", { ideaId: gone.id }), { ideaId: gone.id, dismissed: true, mode: "save" });
  assert.deepEqual((await owner("personal.ideas.list")).ideas.map((idea) => idea.id), [made.ideas[0].id, made.ideas[2].id]);
  await assert.rejects(owner("personal.ideas.dismiss", { ideaId: gone.id }), (error) => error.error === "not_found");
  w.answers.push(answer([...IDEAS]));
  const again = await owner("personal.ideas.refresh");
  assert.match(w.sent[1].prompts[0].content, /<data name="dismissed">- Morning bug queue triage<\/data>/);
  assert.deepEqual(again.ideas.map((idea) => idea.title), [IDEAS[0].title, IDEAS[2].title], "a turned-down idea never comes back");
  assert.equal(again.stale, false);
});

test("before any model: the administrator's switch, a model, the hourly limit, the meter and one request at a time", async (t) => {
  const w = await makeWorld(t);
  await w.facts("owner", PM);
  const owner = w.as("owner");
  w.stand.off = { message: "Back on Monday." };
  await assert.rejects(owner("personal.ideas.refresh"), (error) => error.error === "turned_off" && error.reason === `${IDEA_WORDS.turnedOff} Back on Monday.`);
  w.stand.off = null;
  w.stand.missing = true;
  await assert.rejects(owner("personal.ideas.refresh"), (error) => error.error === "no_model" && /Admin › AI/.test(error.reason));
  w.stand.missing = false;
  w.stand.refuse = "This month's agent use is spent.";
  await assert.rejects(owner("personal.ideas.refresh"), (error) => error.error === "ai_month" && error.details.status === 402);
  w.stand.refuse = null;
  w.locks.add("owner");
  await assert.rejects(owner("personal.ideas.refresh"), (error) => error.error === "busy");
  w.locks.delete("owner");
  assert.equal(w.sent.length, 0, "none of those asked a model");
  // up to ten an hour
  for (let i = 0; i < IDEA_LIMITS.refreshesPerHour; i += 1) { w.answers.push(answer(IDEAS)); await owner("personal.ideas.refresh"); }
  await assert.rejects(owner("personal.ideas.refresh"), (error) => error.error === "rate_limited" && error.details.status === 429 && error.details.retryAfter > 0);
  assert.equal(w.sent.length, IDEA_LIMITS.refreshesPerHour);
  w.stand.clock += 3_600_000;
  w.answers.push(answer(IDEAS));
  await owner("personal.ideas.refresh");
  assert.equal(w.sent.length, IDEA_LIMITS.refreshesPerHour + 1, "the next hour asks again");
  assert.equal(w.locks.size, 0, "every lock released");
});

test("an answer that falls short: the best usable ideas are kept; none usable is said plainly", async (t) => {
  const w = await makeWorld(t);
  await w.facts("owner", PM);
  const owner = w.as("owner");
  // req ran the check on the first answer (two usable ideas, one generic), asked again, and the retry fell short too
  w.answers.push((opts) => {
    opts.validateResponse(answer([IDEAS[0], IDEAS[1], { ...IDEAS[2], title: "Kanban board" }]))
    opts.validateResponse(answer([{ ...IDEAS[0], title: "Kanban board" }]))
    return { abort: true, shape: true, abortMessage: "The agent’s answer could not be used." }
  });
  const kept = await owner("personal.ideas.refresh");
  assert.deepEqual(kept.ideas.map((idea) => idea.title), [IDEAS[0].title, IDEAS[1].title]);
  // nothing usable at all
  w.answers.push(answer([{ title: "Kanban board", kind: "component", why: "Everyone needs one.", brief: "A board with to do, doing and done lanes." }]));
  await assert.rejects(owner("personal.ideas.refresh"), (error) => error.error === "suggest_unavailable" && error.reason === IDEA_WORDS.failed);
  // the earlier ideas are still there
  assert.equal((await owner("personal.ideas.list")).ideas.length, 2);
});

test("Build it: drafted from the person's words, held to the quality gate, a private library draft, opened on a new private slate", async (t) => {
  const w = await makeWorld(t);
  await w.facts("owner", PM);
  const owner = w.as("owner");
  w.answers.push(answer(IDEAS));
  const { ideas } = await owner("personal.ideas.refresh");
  const idea = ideas[0];
  const built = await owner("personal.ideas.build", { ideaId: idea.id });
  assert.deepEqual({ ...built, itemId: "x", shareId: "x" }, { ideaId: idea.id, kind: "component", title: idea.title, itemId: "x", shareId: "x", built: true, mode: "save" });
  // the draft: workshops.draft's path with the idea's brief, and the facts, the why and the connected tools it uses, as data
  assert.deepEqual(w.drafted, [{ userId: "owner", brief: idea.brief, format: "component", personal: { facts: await w.profile.store.forPrompt("owner"), why: idea.why, tools: "- Linear" } }]);
  // the person's own private draft in the library, from For you
  const item = await w.world.library.items.findOne({ _id: built.itemId });
  assert.deepEqual({ kind: item.kind, status: item.status, authorId: item.authorId, title: item.title, origin: item.origin }, { kind: "component", status: "draft", authorId: "owner", title: idea.title, origin: "user" });
  assert.equal(item.summary, "A backlog lane of Linear issues, a This sprint lane that holds eight, and Shipped.");
  assert.deepEqual(item.provenance, { madeFor: { kind: "for-you", ideaId: idea.id } });
  assert.equal(item.draft.workshop.title, idea.title);
  assert.equal(item.sourceShareId, undefined, "no builder slate: library.submit sends the saved draft");
  // opened on a new private slate of theirs, as its first board, through add_component with the library item
  const slate = w.world.slate(built.shareId);
  assert.equal(slate.userId, "owner");
  assert.deepEqual([slate.options.isPrivate, slate.options.isPublic, slate.options.isUnlisted], [true, false, false]);
  assert.equal(slate.options.name, idea.title, "the board names the untitled slate");
  assert.equal(slate.creative.model.workshop.title, idea.title);
  assert.deepEqual(slate.creative.model.workshop.lanes.map((lane) => lane.label), ["Linear backlog", "This sprint", "Shipped"]);
  const run = w.world.runs.find((row) => row.slateShareId === built.shareId);
  assert.deepEqual(run.plan.operations, [{ kind: "add_component", library: { itemId: built.itemId }, expectedRevision: 1 }]);
  // the idea says it was built; building it again opens the same slate, with no second draft
  assert.deepEqual((await owner("personal.ideas.list")).ideas[0].built, { shareId: built.shareId, itemId: built.itemId });
  const again = await owner("personal.ideas.build", { ideaId: idea.id });
  assert.deepEqual([again.built, again.shareId, again.itemId], [false, built.shareId, built.itemId]);
  assert.equal(w.drafted.length, 1);
  assert.equal(w.locks.size, 0);
});

test("Build it refuses: a draft the quality gate turns down, an idea About you no longer fits, one that is gone", async (t) => {
  const w = await makeWorld(t);
  await w.facts("owner", PM);
  const owner = w.as("owner");
  w.answers.push(answer(IDEAS));
  const { ideas } = await owner("personal.ideas.refresh");
  const before = (await w.world.library.items.find({ authorId: "owner" }).toArray()).length;
  // a board of numbered placeholders: refused, nothing saved, no slate
  w.stand.board = { ...BOARD, cards: BOARD.cards.map((card, i) => ({ ...card, label: `Piece ${i + 1}` })) };
  // the person reads plain words; what the gate found (written for the agent) stays in details
  await assert.rejects(owner("personal.ideas.build", { ideaId: ideas[1].id }), (error) => error.error === "weak_draft" && error.reason === IDEA_WORDS.weakDraft && error.details.details.problems.length > 0);
  assert.equal((await w.world.library.items.find({ authorId: "owner" }).toArray()).length, before);
  // a printable page idea that came back as lanes
  w.stand.board = BOARD;
  await assert.rejects(owner("personal.ideas.build", { ideaId: ideas[2].id }), (error) => error.error === "weak_draft" && error.reason === IDEA_WORDS.weakDraft && /not a printable page/.test(error.details.details.problems[0]));
  // About you changed since: a fact since hidden would still reach the draft through the idea
  const [fact] = (await w.profile.store.list("owner")).facts;
  await w.profile.store.setHidden("owner", fact.id, true);
  await assert.rejects(owner("personal.ideas.build", { ideaId: ideas[0].id }), (error) => error.error === "ideas_stale" && error.reason === IDEA_WORDS.stale);
  await assert.rejects(owner("personal.ideas.build", { ideaId: "i000000000000000" }), (error) => error.error === "not_found");
  await assert.rejects(owner("personal.ideas.build", { ideaId: "not-an-idea" }), (error) => error.error === "invalid_request");
  assert.equal(w.locks.size, 0);
});

test("agents: a token reads with profile:read, asks with profile:write, and builds only with slates:write too", async (t) => {
  const w = await makeWorld(t);
  await w.facts("owner", PM);
  const readOnly = await w.world.principalFor(["slates:read"]);
  await assert.rejects(w.run(readOnly, "personal.ideas.list"), (error) => error.code === "insufficient_scope");
  const reader = await w.world.principalFor(["profile:read"]);
  assert.deepEqual((await w.run(reader, "personal.ideas.list")).ideas, []);
  await assert.rejects(w.run(reader, "personal.ideas.refresh"), (error) => error.code === "insufficient_scope");
  const writer = await w.world.principalFor(["profile:read", "profile:write"]);
  w.answers.push(answer(IDEAS));
  const { ideas } = await w.run(writer, "personal.ideas.refresh");
  assert.equal(w.sent.at(-1).userId, "owner", "the token's own person");
  await assert.rejects(w.run(writer, "personal.ideas.build", { ideaId: ideas[0].id }), (error) => error.code === "insufficient_scope" && /slates:write/.test(error.message));
  assert.equal(w.drafted.length, 0);
  const builder = await w.world.principalFor(["profile:write", "slates:write"]);
  const built = await w.run(builder, "personal.ideas.build", { ideaId: ideas[0].id });
  assert.equal(w.world.slate(built.shareId).userId, "owner");
});

test("removed with the account; MIT core; the Meteor wiring: req inside runAIAction, rate limits, deps.personal, never published", async () => {
  const profile = await makeProfileWorld({ users: [{ _id: "ada" }] });
  const { createProfileStore } = await import("../web/app/server/profile/store.mjs");
  const ideas = memoryCollection();
  const store = createProfileStore({ facts: memoryCollection(), settings: memoryCollection(), users: profile.people, newId: () => "f1", ideas });
  await ideas.insertOne({ _id: "ada", userId: "ada", ideas: [] });
  await store.removeAll("ada");
  assert.equal(await ideas.findOne({ _id: "ada" }), null);
  assert.match(app("server/profile/meteor.js"), /ideas: PersonalIdeas\.rawCollection\(\)/);
  // MIT core: For you imports nothing from enterprise/; connected tools come through the profile seam
  for (const file of ["imports/api/common/personal-ideas.mjs", "server/personal/core.mjs", "server/personal/open-slate.mjs", "server/personal/meteor.js",
    "server/actions/personal.mjs", "server/ai-control/prompts/personal.mjs", "server/ai-control/fixtures/personal.mjs", "imports/ui/components/personal/ForYou.jsx"])
    assert.doesNotMatch(app(file), /enterprise/i, file);
  const meteor = app("server/personal/meteor.js");
  assert.match(meteor, /import \{ connectedTools \} from '\.\.\/profile\/integration-hooks\.mjs'/);
  assert.match(meteor, /run: refusing\(\(userId, fn\) => runAIAction\(\{ feature: FEATURE, userId \}, fn\)\)/);
  assert.match(meteor, /const FEATURE = 'personal\.suggest'/);
  assert.match(meteor, /surfaceOff: \(userId\) => surfaceOffFor\(\{ feature: FEATURE, userId \}\)/);
  assert.match(meteor, /draft: refusing\(\(input\) => draftForYou\(input\), DRAFT_WORDS\)/);
  // the drafting's own words (written for the board builder) read in For you's words on a card
  assert.match(meteor, /const DRAFT_WORDS = \{ 'sign-in': IDEA_WORDS\.guest, 'ai-unavailable': IDEA_WORDS\.buildOff, 'invalid-brief': IDEA_WORDS\.buildFailed, 'invalid-format': IDEA_WORDS\.buildFailed \}/);
  assert.match(app("server/actions/mount.js"), /deps\.personal = createAppPersonal\(deps\)/);
  // a person's calls per minute, and the two that ask a model are metered methods too
  assert.match(meteor, /for \(const \[name, count\] of Object\.entries\(PERSONAL_RATE_LIMITS\)\)/);
  assert.deepEqual(Object.keys(PERSONAL_RATE_LIMITS).sort(), [...IDS].sort());
  for (const method of ["personal.ideas.refresh", "personal.ideas.build"]) assert.ok(METER_RATE_LIMITS.some((rule) => rule.method === method && rule.per === "user"), method);
  // the ideas are never published to a page
  assert.doesNotMatch(app("server/publications.js"), /PersonalIdeas|personalIdeas/);
});

test("the For you cards: My slates, the library's first group, Ask Slatebox's library and the interview's summary", () => {
  const card = app("imports/ui/components/personal/ForYou.jsx");
  // signed-in people only; the title, the why, Build it and Not for me; a refresh; progress, then the new slate
  assert.match(card, /const signedIn = useTracker\(\(\) => Boolean\(Meteor\.userId\(\) && !Meteor\.user\(\)\?\.isAnonymous\)/);
  assert.match(card, /if \(!signedIn \|\| !state\) return null/);
  assert.match(card, />\{idea\.title\}<\/Typography>/);
  assert.match(card, />\{idea\.why\}<\/Typography>/);
  assert.match(card, /\{building \? 'Building…' : 'Build it'\}/);
  assert.match(card, /aria-label=\{`Not for me: \$\{idea\.title\}`\}[^>]*>Not for me</);
  assert.match(card, /'Get new ideas' : 'Get ideas made for you'/);
  assert.match(card, /navigate\(`\/canvas\/\$\{made\.shareId\}`\)/);
  // accessible: a labelled section and list, a live region, an alert for errors, focus back to the heading
  assert.match(card, /component="section" aria-labelledby=\{headingId\}/);
  assert.match(card, /component="ul" aria-label="Ideas made for you"/);
  assert.match(card, /role="status" aria-live="polite"/);
  assert.match(card, /role="alert"/);
  assert.match(card, /heading\.current\?\.focus\(\)/);
  // the library shows the group only when there are ideas
  assert.match(card, /if \(onlyIdeas && !ideas\.length\) return null/);
  // where it shows
  assert.match(app("imports/ui/components/DisplaySlates.jsx"), /\{type === 'mine' && <ForYou variant="page" fresh=\{location\.state\?\.forYou === 'fresh'\} \/>\}/);
  assert.match(app("imports/ui/pages/Library.jsx"), /\{!filters\.q && \(!filters\.kind \|\| filters\.kind === 'component'\) && <ForYou variant="library" \/>\}/);
  const view = app("imports/ui/components/library/LibraryView.jsx");
  assert.match(view, /\{!query\.trim\(\) && <ForYou variant="panel" \/>\}/);
  assert.ok(view.indexOf('<ForYou variant="panel" />') < view.indexOf('aria-label="Yours"'), "the first group, before Yours");
  const interview = app("imports/ui/components/profile/Interview.jsx");
  const summary = interview.slice(interview.indexOf("data-interview-summary"), interview.indexOf("</Box>", interview.indexOf("data-interview-for-you")));
  assert.match(summary, /\{kept\.length > 0 && \(\s*<Button[^]*navigate\('\/', \{ state: \{ forYou: 'fresh' \} \}\)\}>See ideas made for you</, "offered only once something was kept");
  // the hand-off is used once (cleared from history, so a reload or Back asks nothing), and focus lands on the section
  assert.match(card, /const freshAtMount = useRef\(fresh\)/);
  assert.match(card, /navigate\(`\$\{window\.location\.pathname\}\$\{window\.location\.search\}`, \{ replace: true, state: null \}\)/);
  assert.match(card, /if \(freshAtMount\.current && !asked\.current\) \{\n\s+asked\.current = true/);
  // personalization off: no section; a stale idea offers no Build it; buttons stay focusable while busy; names match what shows
  assert.match(card, /if \(state\.empty\?\.code === 'personalization-off'\) return null/);
  assert.match(card, /: !stale && <Button/);
  assert.doesNotMatch(card, /disabled=\{busy\}|disabled=\{Boolean\(busy\)\}/);
  assert.match(card, /aria-label=\{`Open it: \$\{idea\.title\}`\}>Open it</);
  assert.match(card, /aria-label=\{building \? words\.building : words\.button\}/);
  assert.match(card, /role="group"[^>]*aria-label="Uses"/);
  assert.match(card, /ideasMadeLine\(next\.ideas\.length\)/);
});

test("Build it once: a slate that failed to open reuses the saved draft; ideas suggested again keep what was built", async (t) => {
  const w = await makeWorld(t);
  await w.facts("owner", PM);
  const owner = w.as("owner");
  w.answers.push(answer(IDEAS));
  const { ideas } = await owner("personal.ideas.refresh");
  const count = async () => (await w.world.library.items.find({ authorId: "owner" }).toArray()).length;
  const before = await count();
  w.stand.openFails = 1;
  await assert.rejects(owner("personal.ideas.build", { ideaId: ideas[0].id }));
  assert.equal(await count(), before + 1, "the draft was saved");
  assert.equal(w.drafted.length, 1);
  const built = await owner("personal.ideas.build", { ideaId: ideas[0].id });
  assert.equal(built.built, true);
  assert.equal(w.drafted.length, 1, "no second draft (and no second charge)");
  assert.equal(await count(), before + 1, "no second library draft");
  assert.equal(w.world.slate(built.shareId).userId, "owner");
  // the same idea suggested again keeps its slate: building it opens that one, with no draft
  w.answers.push(answer(IDEAS));
  const again = await owner("personal.ideas.refresh");
  assert.deepEqual(again.ideas.find((idea) => idea.id === ideas[0].id).built, { shareId: built.shareId, itemId: built.itemId });
  const reopened = await owner("personal.ideas.build", { ideaId: ideas[0].id });
  assert.deepEqual([reopened.built, reopened.shareId], [false, built.shareId]);
  assert.equal(w.drafted.length, 1);
  assert.equal(w.locks.size, 0);
});

test("a sensitive line in About you reaches no request and no draft", async (t) => {
  const w = await makeWorld(t);
  await w.facts("owner", [...PM, ["other", "My salary is 52,000 a year"]]);
  const owner = w.as("owner");
  w.answers.push(answer(IDEAS));
  const { ideas } = await owner("personal.ideas.refresh");
  assert.doesNotMatch(w.sent[0].system, /salary|52,000/);
  await owner("personal.ideas.build", { ideaId: ideas[0].id });
  assert.doesNotMatch(w.drafted[0].personal.facts, /salary|52,000/);
  assert.match(w.drafted[0].personal.facts, /Product manager/);
});
