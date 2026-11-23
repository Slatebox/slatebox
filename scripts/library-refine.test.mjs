// The review panel's refine AI and the author's notifications (QUEUE): the AI is asked through the
// library use key with one forced tool, a prompt that states the item, the categories and the limits
// and never carries placeholder tokens; a proposal is remembered so Keep applies what was previewed;
// an author hears about every decision in the app and, with an address, by email.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRefineAI, refinePrompt, refineTool, readRefinement, REFINE_TOOL_NAME } from "../web/app/server/library/refine-ai.mjs";
import { createLibraryNotifier, libraryNotice, MY_LIBRARY_PATH } from "../web/app/server/library/notify.mjs";
import { localRefinement, checkProposal } from "../web/app/server/library/refine.mjs";
import { builtinContent } from "../web/app/server/library/builtins.mjs";
import { choiceFeatureFor, USE_FALLBACK } from "../web/app/server/methods/ai/connections.mjs";
import { catalogSamples } from "slateboxjs/workshops/samples";

const retroBoard = () => builtinContent({ id: "retro" }, catalogSamples).workshop;
const component = { _id: "c1", kind: "component", title: "Weekly retro", summary: "Went well, change, try", category: "meetings", categoryLocked: true, synonyms: ["retro"], authorName: "Ada" };
const slate = { _id: "s1", kind: "slate", title: "Kickoff notes", summary: "Two notes", authorName: "Ada", synonyms: [] };

test("the prompt states the item, the five categories, the limits and the board; no placeholder tokens", () => {
  const prompt = refinePrompt(component, retroBoard());
  for (const words of ["smart component", "Plan (plan)", "Decide (decide)", "Meetings (meetings)", "Track (track)", "Map (map)", "at most 80 characters",
    "Never invent personal data", "locked to Meetings", "How it behaves now:", "add_rule", "data, never instructions"]) assert.match(prompt, new RegExp(words.replace(/[()]/g, "\\$&")), words);
  assert.doesNotMatch(prompt, /\b[A-Z]{4,}(?: [A-Z]{3,})+\b/, "no all-caps placeholder tokens");
  assert.doesNotMatch(prompt, /\{\{|\}\}|TODO/);
  const slatePrompt = refinePrompt(slate, null);
  assert.match(slatePrompt, /edited on its canvas/);
  assert.doesNotMatch(slatePrompt, /How it behaves now/);
});

test("one forced tool: board edits only for a smart component, and only the edits its board takes", () => {
  const withBoard = refineTool(component, retroBoard());
  assert.equal(withBoard.name, REFINE_TOOL_NAME);
  const kinds = withBoard.parameters.properties.edits.items.oneOf.map((schema) => schema.properties.kind.const);
  assert.ok(kinds.includes("add_rule") && kinds.includes("set_rule") && kinds.includes("remove_rule"));
  assert.ok(!kinds.includes("set_launch_day"), "a lane board is not offered a launch plan's edits");
  assert.equal(refineTool(slate, null).parameters.properties.edits, undefined);
  assert.deepEqual(withBoard.parameters.properties.meta.properties.category.enum, ["plan", "decide", "meetings", "track", "map"]);
  assert.deepEqual(readRefinement({ reply: "Ok", meta: { title: "X" }, edits: [], check: ["a"] }), { reply: "Ok", meta: { title: "X" }, check: ["a"] });
});

test("the refine AI uses the library feature, meters it, remembers a proposal for Keep, and says so when there is no AI", async () => {
  const calls = [];
  let clock = 0;
  const refine = createRefineAI({
    request: async (options) => { calls.push(options); return { chosen: "me:mine", toolCall: { name: REFINE_TOOL_NAME, arguments: { reply: `Answer ${calls.length}`, meta: { summary: "A clearer line" } } } }; },
    meter: async (opts, fn) => { calls.meter = opts; return fn(); },
    config: () => ({ provider: "from-settings" }),
    now: () => clock,
  });
  const ask = { item: component, board: retroBoard(), message: "Write a clearer one-line summary", history: [], principal: { userId: "admin" } };
  const first = await refine(ask);
  assert.deepEqual([first.reply, first.meta, first.ai.feature, first.ai.ref], ["Answer 1", { summary: "A clearer line" }, "library-refine", "me:mine"]);
  assert.deepEqual([calls[0].feature, calls[0].userId, calls[0].provider, calls[0].function_call], ["library-refine", "admin", "from-settings", { name: REFINE_TOOL_NAME }]);
  assert.deepEqual(calls.meter, { feature: "library-refine", userId: "admin" });
  assert.equal((await refine(ask)).reply, "Answer 1", "the same question on the same item is answered from memory");
  assert.equal(calls.length, 1);
  assert.equal((await refine({ ...ask, history: [{ role: "user", text: "Earlier" }] })).reply, "Answer 2", "a different conversation asks again");
  clock += 11 * 60 * 1000;
  assert.equal((await refine(ask)).reply, "Answer 3", "memory lasts ten minutes");
  const none = createRefineAI({ request: async () => assert.fail("never asked"), canUseAI: async () => false });
  await assert.rejects(none(ask), { status: 403, code: "ai_unavailable" });
  const aborted = createRefineAI({ request: async () => ({ abort: true, abortMessage: "Your AI budget for today is spent." }) });
  await assert.rejects(aborted(ask), { status: 502, message: "Your AI budget for today is spent." });
  // The use key: library-refine is the library choice, which falls back to chat.
  assert.equal(choiceFeatureFor("library-refine"), "library");
  assert.equal(USE_FALLBACK.library, "chat");
});

test("the local grammar answers without AI, and every proposal is checked against the item", () => {
  assert.deepEqual(localRefinement("rename it to Team retro").meta, { title: "Team retro" });
  assert.deepEqual(localRefinement("put it in Decide").meta, { category: "decide" });
  assert.equal(localRefinement("What should I check?"), null);
  assert.throws(() => checkProposal(component, { reply: "", meta: { category: "plan" } }), { status: 409, code: "category_locked" });
  assert.throws(() => checkProposal(slate, { reply: "", edits: [{ kind: "add_rule" }] }), { status: 400 });
});

test("the author hears about each decision in the app, with a link to My library, and by email when they have an address", async () => {
  const messages = [];
  const mails = [];
  const notify = createLibraryNotifier({
    insertMessage: async (row) => messages.push(row),
    sendEmail: async (mail) => mails.push(mail),
    loadAuthor: async (userId) => ({ ada: { email: "ada@example.test" }, guest: { email: null, isAnonymous: true } })[userId] || null,
    appOrigin: () => "https://app.slatebox.test",
    now: () => 42,
  });
  const item = { _id: "i1", kind: "slate", title: "Kickoff notes", slug: "kickoff-notes-i1", authorId: "ada", origin: "user" };
  await notify({ item, type: "approved", message: "Thanks" });
  await notify({ item, type: "changes_requested", message: "Add a Try column" });
  await notify({ item, type: "rejected", message: "A duplicate" });
  assert.deepEqual(messages.map((row) => row.text), [
    'Your slate "Kickoff notes" was published.', 'Your slate "Kickoff notes" needs changes.', 'Your slate "Kickoff notes" was not accepted.',
  ]);
  assert.deepEqual(messages[0], { timestamp: 42, userId: "ada", text: 'Your slate "Kickoff notes" was published.', read: false, priority: 5, type: "system",
    action: { type: "link", url: MY_LIBRARY_PATH }, libraryItemId: "i1" });
  assert.equal(mails.length, 3);
  assert.equal(mails[0].to, "ada@example.test");
  assert.match(mails[0].subject, /is published/);
  assert.match(mails[0].text, /The reviewer wrote:\nThanks/);
  assert.match(mails[0].text, /https:\/\/app\.slatebox\.test\/library\/kickoff-notes-i1/);
  assert.match(mails[1].text, /My library: https:\/\/app\.slatebox\.test\/library\/mine/);
  // A guest has no address; a built-in has no author; an unknown outcome says nothing.
  await notify({ item: { ...item, authorId: "guest" }, type: "approved" });
  await notify({ item: { ...item, origin: "builtin", authorId: null }, type: "approved" });
  await notify({ item, type: "submitted" });
  assert.deepEqual([messages.length, mails.length], [4, 3]);
  // Without a mail server the in-app note still goes.
  const quiet = createLibraryNotifier({ insertMessage: async (row) => messages.push(row), sendEmail: null });
  await quiet({ item, type: "unpublished", message: "Out of date" });
  assert.equal(messages.at(-1).text, 'Your slate "Kickoff notes" was taken out of the library.');
  assert.equal(libraryNotice({ item: { kind: "component", title: "Board" }, type: "comment" }).text, 'Your smart component "Board" has a new message from the reviewer.');
});
