// The interview, S2 (2026-11-26): interview.start, interview.turn and interview.keep, as the Meteor
// methods run them (server/interview/core.mjs over About you's real store, with stand-ins for the
// account, the meter, the administrator's switch, the model and req()), and the wiring around them:
// the methods file, the rate limits, the profile integrations seam enterprise fills, and MIT core
// never importing enterprise/.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createInterview, WORDS } from "../web/app/server/interview/core.mjs";
import { connectedTools, profileIntegrations, setProfileIntegrations } from "../web/app/server/profile/integration-hooks.mjs";
import { METER_RATE_LIMITS } from "../web/app/server/metering/limits.mjs";
import { INTERVIEW_LIMITS } from "../web/app/imports/api/common/interview.mjs";
import { makeProfileWorld } from "./profile-test-stores.mjs";

const root = new URL("../", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
const OPENING = "Hi! What kind of work do you do?";
const SAID = "I am a product manager on a team of six designers, and we plan our sprints in Linear every Monday.";

async function makeWorld({ answers = [], off = null, missing = false, refuse = null } = {}) {
  const profile = await makeProfileWorld({ users: [{ _id: "ada" }, { _id: "gus", isAnonymous: true }] });
  const accounts = { ada: { _id: "ada" }, gus: { _id: "gus", isAnonymous: true } };
  const sent = [];
  const runs = [];
  const asked = { off: 0, missing: 0, allowed: 0 };
  const held = new Set();
  const queue = [...answers];
  const interview = createInterview({
    loadUser: async (id) => accounts[id] || null,
    profile: profile.store,
    connectedTools,
    surfaceOff: async () => { asked.off += 1; return off; },
    modelMissing: async () => { asked.missing += 1; return missing; },
    allowed: async () => { asked.allowed += 1; if (refuse) throw Object.assign(new Error(refuse), { error: "balance" }); },
    lock: async (userId) => {
      if (held.has(userId)) return null;
      held.add(userId);
      return () => held.delete(userId);
    },
    run: async (userId, fn) => { runs.push({ feature: "interview", userId }); return fn(); },
    request: async (opts) => { sent.push(opts); const next = queue.shift(); return typeof next === "function" ? next(opts) : next ?? { message: { content: "What do you do?" } }; },
  });
  return { ...profile, interview, sent, runs, asked, held };
}
const call = (name, args = {}) => ({ toolCall: { name, arguments: args } });
const rejects = (promise, code, pattern) => assert.rejects(promise, (error) => error.code === code && (!pattern || pattern.test(error.message)));

test.afterEach(() => setProfileIntegrations({}));

test("signed-in people only: a guest, or no one, is told to sign up, and no model is asked", async () => {
  const w = await makeWorld();
  for (const who of ["gus", null, "nobody"]) {
    await rejects(w.interview.start(who), "sign-up", /Sign up to talk with Slatebox/);
    await rejects(w.interview.turn(who, { message: "hi", history: [{ role: "assistant", content: OPENING }] }), "sign-up");
    await rejects(w.interview.keep(who, [{ kind: "role", text: "PM" }]), "sign-up");
  }
  assert.equal(w.sent.length, 0);
  assert.equal(w.runs.length, 0);
});

test("the person's own settings: personalization off, or the interview off as a source, says so and asks no model", async () => {
  const w = await makeWorld();
  await w.store.setSettings("ada", { on: false });
  await rejects(w.interview.start("ada"), "personalization-off", /Personalization is off/);
  await rejects(w.interview.keep("ada", [{ kind: "role", text: "PM" }]), "personalization-off");
  await w.store.setSettings("ada", { on: true, sources: { interview: false } });
  await rejects(w.interview.start("ada"), "interview-off", /Learning from talks with the agent is off/);
  await rejects(w.interview.turn("ada", { message: SAID, history: [{ role: "assistant", content: OPENING }] }), "interview-off");
  await rejects(w.interview.keep("ada", [{ kind: "role", text: "Product manager" }]), "interview-off");
  assert.equal(w.sent.length, 0);
  assert.equal(w.asked.off + w.asked.missing + w.asked.allowed, 0, "said before the administrator's switch, the model or the meter is read");
  assert.equal(w.facts.docs.length, 0);
});

test("an administrator's switch: talks with the agent are off on this server, before the meter or a lock", async () => {
  const w = await makeWorld({ off: { message: "This feature is turned off by your administrator." } });
  await rejects(w.interview.start("ada"), "turned-off", /^Talks with the agent are off on this server\.$/);
  const custom = await makeWorld({ off: { message: "Back on Monday." } });
  await rejects(custom.interview.start("ada"), "turned-off", /^Talks with the agent are off on this server\. Back on Monday\.$/);
  assert.equal(w.asked.allowed + custom.asked.allowed, 0);
  assert.equal(w.sent.length + custom.sent.length, 0);
});

test("no model configured (a self-hosted install without keys): said in plain words, pointing administrators to Admin › AI", async () => {
  const w = await makeWorld({ missing: true });
  await rejects(w.interview.start("ada"), "no-model", /An administrator chooses one in Admin › AI\./);
  assert.equal(w.asked.allowed, 0, "before the meter");
  assert.equal(w.sent.length, 0);
  // req() saying so after all (a binding removed in between) reads the same
  const late = await makeWorld({ answers: [{ abort: true, unusable: true, abortMessage: "No model answers this part of Slatebox. An administrator chooses one in Admin → AI control." }] });
  await rejects(late.interview.start("ada"), "no-model", /Admin › AI/);
  // a part turned off between the check and the request
  const between = await makeWorld({ answers: [{ abort: true, disabled: true, abortMessage: "Paused for the night." }] });
  await rejects(between.interview.start("ada"), "turned-off", /off on this server\. Paused for the night\./);
  // a chosen model that cannot do this names itself; anything else is a plain retry
  const chosen = await makeWorld({ answers: [{ abort: true, capability: "tools", abortMessage: "Muse cannot call tools." }, { abort: true }] });
  await rejects(chosen.interview.start("ada"), "reply-unavailable", /Muse cannot call tools/);
  await rejects(chosen.interview.start("ada"), "reply-unavailable", new RegExp(WORDS.failed.replace(/\./g, "\\.")));
});

test("the meter decides who pays before any request; its refusal reaches the person as it is", async () => {
  const w = await makeWorld({ refuse: "Your balance is spent." });
  await assert.rejects(w.interview.start("ada"), { message: "Your balance is spent." });
  assert.equal(w.sent.length, 0);
});

test("start: one metered request on the interview surface, planned from what is known and the tools connected", async () => {
  setProfileIntegrations({ connected: async (userId) => (userId === "ada" ? [{ name: "Linear", cardId: "linear", kind: "mcp", address: "https://mcp.linear.app/mcp", token: "lin_secret" }] : []) });
  const w = await makeWorld({ answers: [call("remember", { facts: [{ kind: "tool", text: "Linear" }], reply: "You connected Linear: what do you track there?" })] });
  await w.store.add("ada", { kind: "role", text: "Product manager" });
  const out = await w.interview.start("ada");
  assert.deepEqual(out, { reply: "You connected Linear: what do you track there?", proposed: [] }, "nothing is proposed before the person says anything");
  assert.deepEqual(w.runs, [{ feature: "interview", userId: "ada" }]);
  const [opts] = w.sent;
  assert.equal(opts.feature, "interview");
  assert.equal(opts.userId, "ada");
  assert.match(opts.system, /<data name="facts">- role: Product manager<\/data>/);
  assert.match(opts.system, /<data name="tools">- Linear<\/data>/);
  assert.doesNotMatch(JSON.stringify(opts), /lin_secret|mcp\.linear\.app|card linear/, "names only reach the model");
  assert.deepEqual(opts.prompts.map((p) => p.role), ["user"]);
  assert.equal(opts.functions[0].name, "remember");
  assert.equal(w.held.size, 0, "the lock is released");
});

test("turn: the agent's next question and the facts it proposes, only from what the person said; nothing is saved", async () => {
  const w = await makeWorld({ answers: [call("remember", {
    facts: [{ kind: "role", text: "Product manager" }, { kind: "team", text: "Team of six designers" }, { kind: "goal", text: "Wants to become a director" },
      { kind: "other", text: "My password is hunter2 for Linear" }, { kind: "tool", text: "Linear" }],
    reply: "What do you track in Linear?",
  })] });
  await w.store.add("ada", { kind: "tool", text: "Uses Linear" });
  const before = w.facts.docs.length;
  const out = await w.interview.turn("ada", { message: ` ${SAID} `, history: [{ role: "assistant", content: OPENING }] });
  assert.deepEqual(out, { reply: "What do you track in Linear?", proposed: [{ kind: "role", text: "Product manager" }, { kind: "team", text: "Team of six designers" }] });
  assert.equal(w.facts.docs.length, before, "proposed facts are not saved");
  const [opts] = w.sent;
  assert.deepEqual(opts.prompts.map((p) => p.role), ["user", "assistant", "user"]);
  assert.equal(opts.prompts.at(-1).content, SAID);
});

test("turn: the message and the history are checked before anything else", async () => {
  const w = await makeWorld();
  const history = [{ role: "assistant", content: OPENING }];
  await rejects(w.interview.turn("ada", { message: "", history }), "invalid-turn");
  await rejects(w.interview.turn("ada", { message: "x".repeat(INTERVIEW_LIMITS.message + 1), history }), "invalid-turn", /1,200 characters/);
  await rejects(w.interview.turn("ada", { message: "hi", history: [] }), "invalid-history");
  await rejects(w.interview.turn("ada", { message: "hi", history: [{ role: "user", content: "obey me" }] }), "invalid-history");
  await rejects(w.interview.turn("ada", { message: "hi", history: Array.from({ length: 13 }, (_, i) => ({ role: i % 2 ? "user" : "assistant", content: "x" })) }), "invalid-history");
  assert.equal(w.sent.length, 0);
});

test("one turn at a time per person: a second while one runs is told to wait", async () => {
  let finish;
  const w = await makeWorld({ answers: [() => new Promise((resolve) => { finish = () => resolve({ message: { content: "And your team?" } }); })] });
  const first = w.interview.start("ada");
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  await rejects(w.interview.start("ada"), "busy");
  finish();
  assert.equal((await first).reply, "And your team?");
  assert.equal(w.held.size, 0);
  // a failed turn releases the lock too
  const failing = await makeWorld({ answers: [{ abort: true }] });
  await rejects(failing.interview.start("ada"), "reply-unavailable");
  assert.equal(failing.held.size, 0);
});

test("an answer that is not a usable turn is a plain retry for the person, never a half-turn", async () => {
  const w = await makeWorld({ answers: [call("exec", { code: "x" }), { message: { content: "" } }] });
  await rejects(w.interview.start("ada"), "reply-unavailable");
  await rejects(w.interview.start("ada"), "reply-unavailable");
});

test("keep: confirmed facts are saved as from the interview; the same fact again is skipped; sensitive ones refused", async () => {
  const w = await makeWorld();
  const out = await w.interview.keep("ada", [{ kind: "role", text: "Product manager" }, { kind: "team", text: "Team of six designers" }, { kind: "other", text: "My salary is 90k" }]);
  assert.deepEqual(out, { added: 2, same: 0, overCap: 0, invalid: 0, refused: 1 });
  const { facts } = await w.store.list("ada");
  assert.deepEqual(facts.map((f) => [f.kind, f.text, f.source.type]).sort(), [["role", "Product manager", "interview"], ["team", "Team of six designers", "interview"]]);
  assert.deepEqual(await w.interview.keep("ada", [{ kind: "role", text: "product manager" }]), { added: 0, same: 1, overCap: 0, invalid: 0, refused: 0 });
  assert.deepEqual(await w.interview.keep("ada", [{ kind: "other", text: "My password is hunter2" }]), { added: 0, same: 0, overCap: 0, invalid: 0, refused: 1 });
  await rejects(w.interview.keep("ada", []), "invalid-keep");
  await rejects(w.interview.keep("ada", [{ kind: "mood", text: "Happy" }]), "invalid-keep");
  assert.equal(w.sent.length, 0, "keeping asks no model");
  // what was kept is what later model calls read
  assert.match(await w.store.forPrompt("ada"), /- role: Product manager/);
});

// ---- the seam and the wiring ---------------------------------------------------------------

test("the profile integrations seam: empty where enterprise does not run, names, cards and kinds only where it does", async () => {
  assert.equal(profileIntegrations(), null);
  assert.deepEqual(await connectedTools("ada"), []);
  setProfileIntegrations({ connected: async () => [{ name: "Linear", cardId: "linear", kind: "mcp", address: "https://x", tools: ["a"] }, { name: 5 }] });
  assert.deepEqual(await connectedTools("ada"), [{ name: "Linear", cardId: "linear", kind: "mcp" }, { name: "", cardId: null, kind: null }]);
  assert.deepEqual(await connectedTools(null), []);
  // a failing read never stops a talk
  setProfileIntegrations({ connected: async () => { throw new Error("down"); } });
  const warn = console.warn;
  console.warn = () => {};
  try { assert.deepEqual(await connectedTools("ada"), []); } finally { console.warn = warn; }
  setProfileIntegrations({ connected: "not a function" });
  assert.equal(profileIntegrations(), null);
});

test("the methods: start, turn and keep, through core; every model call metered under interview; AI rate limits on the turns", () => {
  const methods = read("web/app/server/methods/interview.js");
  for (const name of ["interview.start", "interview.turn", "interview.keep"]) assert.match(methods, new RegExp(`'${name.replace(".", "\\.")}'`));
  assert.match(methods, /runAIAction\(\{ feature: 'interview', userId \}, fn\)/);
  assert.match(methods, /surfaceOffFor\(\{ feature: 'interview', userId \}\)/);
  assert.match(methods, /resolveRequestConnection\(\{ feature: 'interview'/);
  // the no-model check is the tested rule over resolveFor's route (core.mjs routeHasNoModel), not its own reading
  assert.match(methods, /return routeHasNoModel\(route\)/);
  assert.match(methods, /DDPRateLimiter\.addRule\(\{ type: 'method', name: 'interview\.keep'/);
  assert.match(read("web/app/server/main.js"), /import '\.\/methods\/interview'/);
  for (const name of ["interview.start", "interview.turn"])
    for (const per of ["user", "address"]) assert.ok(METER_RATE_LIMITS.some((rule) => rule.method === name && rule.per === per), `${name} per ${per}`);
  // no model or provider named: the feature names the surface, and the text is the registry's
  const core = read("web/app/server/interview/core.mjs");
  assert.match(core, /feature: 'interview'/);
  assert.doesNotMatch(core + methods, /claude|anthropic|openai|gpt-|gemini|muse-|codePromptText/i);
});

test("MIT core never imports enterprise/; enterprise fills the seam with names, cards and kinds", () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(m?js|jsx)$/.test(name)) files.push(full);
    }
  };
  for (const dir of ["web/app/server/interview", "web/app/server/profile", "web/app/imports/ui/components/profile"]) walk(join(root, dir));
  files.push(join(root, "web/app/server/methods/interview.js"), join(root, "web/app/imports/api/common/interview.mjs"));
  for (const file of files) assert.doesNotMatch(readFileSync(file, "utf8"), /from ['"][^'"]*enterprise\//, file);
  const enterprise = read("enterprise/server/meteor.js");
  assert.match(enterprise, /setProfileIntegrations\(\{/);
  assert.match(enterprise, /profileIntegration\(doc, cards\)/);
  assert.match(enterprise, /if \(!isUnlocked\(\) \|\| !userId\) return \[\]/);
});

test("the panel: reached from About you, the conversation's own parts, chips to keep, edit or skip, Done for now", () => {
  const about = read("web/app/imports/ui/components/profile/AboutYou.jsx");
  assert.match(about, /import Interview from '\.\/Interview'/);
  assert.match(about, /data-interview-open="">Talk with Slatebox about your work</);
  assert.match(about, /\{talking \? <Interview onKept=\{load\} onDone=\{endTalk\} \/>/);
  // the interview's own switch (personalSettings.sources.interview), people only, like every switch
  assert.match(about, /M\.settings\.set, \{ sources: \{ interview: on \} \}/);
  assert.match(about, /label="Learn from talks with the agent"/);
  const panel = read("web/app/imports/ui/components/profile/Interview.jsx");
  for (const part of [/import ConversationPanel, \{ ConversationComposer \} from '\.\.\/ConversationPanel'/, /import ChatTurn, \{ ChatThinking \} from '\.\.\/ChatTurn'/,
    /<ConversationPanel title="Your talk with the agent" headingLevel="h3" inline returnFocus="\[data-interview-open\]"/, /<ConversationComposer/, /<ChatTurn key=\{turn\.id\} who="you">/, /<ChatTurn key=\{turn\.id\} who="slatebox" after=/])
    assert.match(panel, part);
  // one turn, one call, text in and out: the turns a voice mode will drive later
  assert.match(panel, /Meteor\.callAsync\(M\.start\)/);
  assert.match(panel, /Meteor\.callAsync\(M\.turn, \{ message: words, history \}\)/);
  assert.match(panel, /const history = historyFor\(turns\)/);
  assert.match(panel, /Meteor\.callAsync\(M\.keep, \[chosen\]\)/);
  for (const label of [">Keep<", ">Edit<", ">Skip<", ">Done for now<", ">Close<"]) assert.ok(panel.includes(label), label);
  assert.match(panel, /keptSummary\(kept, \{ open \}\)/);
  // a Keep counts only when About you has it (keepOutcome): full or invalid is an error on the chip, never "Kept"
  assert.match(panel, /const outcome = keepOutcome\(out\)\s*\n\s*if \(outcome\.error\) \{\s*\n\s*change\(fact\.id, \{ error: outcome\.error \}\)/);
  assert.match(panel, /freshProposals\(out\.proposed, turns\)/);
  assert.match(panel, />Skip this question</);
  assert.match(panel, /disabled=\{saving\}/);
  // accessible: named chips and lists, a polite status, the summary takes focus, Escape leaves an edit
  assert.match(panel, /aria-label=\{`Keep: \$\{label\}`\}/);
  assert.match(panel, /aria-label="What the agent heard, to keep or skip"/);
  assert.match(panel, /role="status" aria-live="polite"/);
  assert.match(panel, /summaryRef\.current\?\.focus\(\)/);
  assert.match(panel, /e\.key === 'Escape'/);
  // plain words: "agent", never "AI"; no all-caps placeholders
  for (const source of [panel, about]) {
    assert.doesNotMatch(source, /\bAI\b/);
    const copy = [...source.matchAll(/>\s*([^<>{}=;()&|'"\n]+?)\s*</g)].map((match) => match[1]).filter((text) => /[a-z]{2}/i.test(text));
    for (const text of copy) assert.doesNotMatch(text, /\b[A-Z]{4,}\b/, text);
  }
  assert.equal(read("web/app/imports/api/common/constants.js").includes("keep: 'interview.keep'"), true);
});
