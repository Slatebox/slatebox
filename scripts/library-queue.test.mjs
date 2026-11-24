// The review queue and publishing from slates and presentations (QUEUE): only an administrator
// opens the queue and a submission's thread; a request for changes goes to the author and comes back;
// approving publishes what is on the review canvas, and it is then public over the API; an AI
// refinement is a proposal until Keep, kept as previewed, and recorded; a slate and a presentation
// are published through the same queue, the presentation with its deck. The author is told each time.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { makeExecWorld } from "./exec-test-world.mjs";
import { mountDdp } from "../web/app/server/actions/ddp.mjs";
import { principalFromUser } from "../web/app/server/actions/principal.mjs";
import { API_TOKEN_SCOPES } from "../web/app/server/api-token-core.mjs";
import { createRefineAI } from "../web/app/server/library/refine-ai.mjs";

const app = (path) => readFileSync(new URL("../web/app/" + path, import.meta.url), "utf8");

async function setup(t, library = {}) {
  const world = makeExecWorld({ library });
  t.after(() => world.close());
  await world.libraryReady;
  world.users.docs.push({ _id: "guest1", isAnonymous: true });
  let methods;
  mountDdp(world.registry, {
    defineMethods: (defined) => (methods = defined),
    makeError: (code, reason, details) => Object.assign(new Error(reason), { error: code, reason, details }),
    loadUser: async (id) => world.users.docs.find((user) => user._id === id) || null,
    scopes: API_TOKEN_SCOPES,
  });
  const ddp = (userId, method, input) => methods[method].call({ userId }, input);
  const person = (userId) => principalFromUser(world.users.docs.find((user) => user._id === userId), API_TOKEN_SCOPES);
  const run = (principal, id, input) => world.registry.run(principal, id, input).then((result) => result.body);
  const item = (itemId) => world.library.items.docs.find((doc) => doc._id === itemId);
  const types = (itemId) => world.library.events.docs.filter((event) => event.itemId === itemId).map((event) => event.type);
  return { world, ddp, person, run, item, types };
}

// Ada's component: a branch of the built-in retro, saved and submitted.
async function component(env, title = "Weekly retro") {
  const ada = env.person("owner");
  const { shareId } = await env.run(ada, "library.branch", { itemId: "retro" });
  const draft = await env.run(ada, "library.saveDraft", { shareId, title, summary: "Went well, change, try" });
  await env.run(ada, "library.submit", { kind: "component", itemId: draft.itemId, note: "First go" });
  return draft.itemId;
}

test("only an administrator opens the queue and reads a submission's thread; the pages are guarded too", async (t) => {
  const env = await setup(t);
  const { run, person } = env;
  const itemId = await component(env);
  const root = person("admin"), ada = person("owner"), ben = person("other");
  const visitor = { kind: "visitor", userId: null, scopes: [] };
  // The queue: an administrator only, over a session.
  assert.equal((await env.ddp("admin", "library.review.queue", {})).items[0].id, itemId);
  for (const userId of ["owner", "other", "guest1"]) await assert.rejects(env.ddp(userId, "library.review.queue", {}), (error) => ["reviewer_required", "registration_required"].includes(error.error));
  // The thread travels with library.get, to the author and to reviewers only.
  const forReviewer = await run(root, "library.get", { itemId });
  assert.deepEqual(forReviewer.thread.map((event) => event.type), ["created", "submitted"]);
  assert.equal(forReviewer.thread[1].message, "First go");
  assert.ok((await run(ada, "library.get", { itemId })).thread);
  await assert.rejects(run(ben, "library.get", { itemId }), { status: 404 });
  await assert.rejects(run(visitor, "library.get", { itemId }), { status: 404 });
  // A published built-in has no thread to show anyone.
  assert.equal((await run(root, "library.get", { itemId: "retro" })).thread, undefined);
  // The routes: the review queue sits behind the administrator check, My library behind sign-in.
  const routes = app("imports/ui/SBRoutes.jsx");
  assert.match(routes, /isElevatedUser && \(\s*<Route\s+path="\/admin\/library"/);
  assert.match(routes, /path="\/library\/mine"\s+element=\{\s*<PrivateRoute>\s*<MyLibrary \/>/);
});

test("request changes goes to the author with its message, and the resubmission comes back to the queue", async (t) => {
  const env = await setup(t);
  const { run, person, world, item } = env;
  const itemId = await component(env);
  const root = person("admin"), ada = person("owner");
  const first = await run(root, "library.review.open", { itemId });
  await assert.rejects(run(root, "library.review.requestChanges", { itemId }), { status: 400 });
  await run(root, "library.review.requestChanges", { itemId, message: "Add a Try column" });
  // The author is told, sees it in My library, and the queue shows it waiting on them.
  assert.deepEqual(world.library.notices.at(-1), { type: "changes_requested", itemId, message: "Add a Try column" });
  const mine = (await run(ada, "library.mine", {})).items.find((row) => row.id === itemId);
  assert.deepEqual([mine.status, mine.reviewStatus, mine.lastMessage.by, mine.lastMessage.text], ["changes_requested", "changes_requested", "reviewer", "Add a Try column"]);
  assert.equal(mine.events.at(-1).type, "changes_requested");
  assert.deepEqual((await run(root, "library.review.queue", { status: "changes_requested" })).items.map((row) => row.id), [itemId]);
  // The author replies and sends it again: version 2 waits, and opening it makes a fresh review copy.
  await run(ada, "library.comment", { itemId, message: "Added it" });
  const again = await run(ada, "library.submit", { kind: "component", itemId });
  assert.deepEqual([again.status, again.version], ["submitted", 2]);
  assert.deepEqual((await run(root, "library.review.queue", {})).items.map((row) => row.id), [itemId]);
  const second = await run(root, "library.review.open", { itemId });
  assert.notEqual(second.reviewShareId, first.reviewShareId);
  assert.ok(world.slate(first.reviewShareId).archivedDate, "the old review copy is archived, never deleted");
  const approved = await run(root, "library.review.approve", { itemId, message: "Thanks" });
  assert.deepEqual([approved.status, item(itemId).status, item(itemId).reviewStatus], ["published", "published", null]);
  assert.deepEqual(world.library.notices.at(-1), { type: "approved", itemId, message: "Thanks" });
  assert.deepEqual(env.types(itemId), ["created", "submitted", "review_opened", "changes_requested", "comment", "submitted", "review_opened", "approved"]);
});

test("approve publishes what is on the review canvas, and the public API shows it at once", async (t) => {
  const env = await setup(t);
  const { run, person, world } = env;
  const call = await world.serve(t);
  const ada = person("owner"), root = person("admin");
  // Ada publishes her slate "Demo" to the library.
  const sent = await run(ada, "library.submit", { kind: "slate", shareId: "demo", title: "Kickoff notes", summary: "Two notes to start a kickoff" });
  assert.deepEqual([sent.status, sent.version], ["submitted", 1]);
  assert.equal((await call("/api/v1/library?kind=slate")).body.total, 0, "nothing is public before review");
  const { reviewShareId } = await run(root, "library.review.open", { itemId: sent.itemId });
  // The reviewer moves a note on the review canvas; the author's own slate is never touched.
  const review = world.slate(reviewShareId);
  const moved = review.nodes[0];
  moved.options.xPos = 777;
  moved.options.yPos = 333;
  const before = structuredClone(world.slate("demo").nodes[0].options);
  await run(root, "library.review.approve", { itemId: sent.itemId });
  assert.deepEqual(world.slate("demo").nodes[0].options, before);
  const list = await call("/api/v1/library?kind=slate");
  assert.deepEqual([list.status, list.body.total, list.body.items[0].title, list.body.items[0].authorName], [200, 1, "Kickoff notes", "Ada"]);
  assert.equal(list.headers.get("cache-control"), "public, max-age=60, s-maxage=60", "what is taken out leaves shared caches within a minute");
  const got = await call("/api/v1/library/" + list.body.items[0].slug);
  const note = got.body.version.content.slate.nodes.find((node) => node.options.id === moved.options.id);
  assert.deepEqual([note.options.xPos, note.options.yPos], [777, 333]);
  assert.equal(got.body.thread, undefined, "a visitor never sees the thread");
  assert.equal((await call("/api/v1/library/stats")).body.slates, 1);
});

test("an AI refinement is a proposal until Keep, kept exactly as previewed, and recorded with its connection", async (t) => {
  const requests = [];
  const refineWithAI = createRefineAI({
    request: async (options) => {
      requests.push(options);
      return {
        chosen: "server:main",
        toolCall: { name: "propose_library_refinement", arguments: {
          reply: "A clearer line, and one column at a time.",
          meta: { summary: "What went well, what to change, what to try" },
          edits: [{ kind: "add_rule", rule: { kind: "path", from: "any", noSkip: true } }],
          check: ["The sample cards name a customer: Acme."],
        } },
      };
    },
    meter: (opts, fn) => { requests.metered = opts; return fn(); },
  });
  const env = await setup(t, { refineWithAI });
  const { run, person, world, item } = env;
  const itemId = await component(env);
  const root = person("admin");
  const { reviewShareId } = await run(root, "library.review.open", { itemId });
  const preview = await run(root, "library.review.refine", { itemId, message: "Tighten the rules", mode: "preview" });
  assert.equal(preview.reply, "A clearer line, and one column at a time.");
  assert.deepEqual(preview.diff.meta.summary, ["Went well, change, try", "What went well, what to change, what to try"]);
  assert.ok(preview.diff.rules.some((line) => line.startsWith("+ ")), "the rule change is shown as a diff line");
  assert.deepEqual(preview.proposal.check, ["The sample cards name a customer: Acme."]);
  assert.equal(item(itemId).summary, "Went well, change, try", "a preview changes nothing");
  const rulesOf = () => world.slate(reviewShareId).creative.model.workshop.behaviour?.rules ?? [];
  const had = rulesOf().length;
  const added = () => rulesOf().find((rule) => rule.kind === "path" && rule.noSkip === true);
  assert.equal(added(), undefined);
  // Keep names the preview: the same proposal (no second AI call), on the item and the review board.
  assert.ok(preview.previewId, "a preview answers the id Keep names");
  const kept = await run(root, "library.review.refine", { itemId, message: "Tighten the rules", mode: "save", previewId: preview.previewId });
  assert.equal(kept.kept, true);
  assert.equal(requests.length, 1, "Keep applies what was previewed, without asking the AI again");
  assert.equal(item(itemId).summary, "What went well, what to change, what to try");
  assert.equal(rulesOf().length, had + 1);
  assert.equal(added().set.via, "chat");
  // Recorded: the turn with its connection (never a key), and the keep with its diff.
  const proposed = world.library.events.docs.filter((event) => event.itemId === itemId && event.type === "refine_proposed");
  assert.deepEqual(proposed[0].ai, { feature: "library-refine", ref: "server:main", request: "Tighten the rules", reply: "A clearer line, and one column at a time." });
  const keptEvent = world.library.events.docs.find((event) => event.itemId === itemId && event.type === "refine_kept");
  assert.ok(keptEvent.diff.meta.summary && keptEvent.diff.rules.length);
  // The AI was asked the library way: its feature, one forced tool, and a prompt with no placeholder tokens.
  assert.deepEqual([requests.metered.feature, requests[0].feature, requests[0].function_call.name], ["library-refine", "library-refine", "propose_library_refinement"]);
  assert.ok(requests[0].functions[0].parameters.properties.edits, "a component's board edits are offered");
  assert.doesNotMatch(requests[0].system, /\b[A-Z]{4,}(?: [A-Z]{3,})+\b/, "no all-caps placeholder tokens in the prompt");
  assert.match(requests[0].system, /Never invent personal data/);
  // Approve publishes the refined board.
  await run(root, "library.review.approve", { itemId });
  const published = await run({ kind: "visitor", userId: null, scopes: [] }, "library.get", { itemId });
  assert.equal(published.version.content.workshop.behaviour.rules.length, had + 1);
  assert.equal(published.item.summary, "What went well, what to change, what to try");
});

test("when the AI fails, the reviewer is told so in plain words, with the changes that need no AI, and nothing changes", async (t) => {
  // A provider that is not set up answers an abort naming itself; the reviewer never sees that, nor a bare "could not be completed".
  const refineWithAI = createRefineAI({
    request: async () => ({ abort: true, abortMessage: "provider-x is not configured for this AI request." }),
    meter: (_opts, fn) => fn(),
  });
  const env = await setup(t, { refineWithAI });
  const { run, person, item } = env;
  const itemId = await component(env);
  const root = person("admin");
  await run(root, "library.review.open", { itemId });
  for (const call of [
    () => run(root, "library.review.refine", { itemId, message: "Write a clearer one-line summary", mode: "preview" }),
    () => env.ddp("admin", "library.review.refine", { itemId, message: "Write a clearer one-line summary", mode: "preview" }),
  ]) {
    await assert.rejects(call(), (error) => {
      const code = error.code ?? error.error, message = error.message ?? error.reason;
      assert.equal(code, "refine_failed");
      assert.match(message, /The AI could not answer just now/);
      assert.match(message, /rename it to/);
      assert.doesNotMatch(message, /provider-x|could not be completed/);
      return true;
    });
  }
  assert.equal(item(itemId).summary, "Went well, change, try");
  // The changes that need no AI still work.
  const renamed = await run(root, "library.review.refine", { itemId, message: "rename it to Friday retro", mode: "save" });
  assert.equal(renamed.kept, true);
});

test("a presentation is published with its deck through the same queue, and a copy brings the deck along, private", async (t) => {
  const decks = new Map();
  const copies = [];
  const env = await setup(t, {
    latestPresentation: async (shareId, userId) => decks.get(`${shareId}:${userId}`) || null,
    publishedPresentation: async () => null,
    copyPresentation: async (deck, where) => { copies.push({ deck, ...where }); },
  });
  const { run, person } = env;
  const ada = person("owner"), root = person("admin");
  await assert.rejects(run(ada, "library.submit", { kind: "presentation", shareId: "demo", summary: "A short talk" }), { status: 409, code: "no_presentation" });
  decks.set("demo:owner", { _id: "deck1", slateShareId: "demo", userId: "owner", name: "Kickoff talk", viewpoints: [{ nodeIds: ["welcome"], duration: 3000 }], direction: { title: "Kickoff" }, showNarrative: true, isPublished: true, isPublic: false });
  const sent = await run(ada, "library.submit", { kind: "presentation", shareId: "demo", summary: "A short talk", note: "For new teams" });
  assert.equal(sent.status, "submitted");
  const queued = (await run(root, "library.review.queue", { kind: "presentation" })).items;
  assert.deepEqual(queued.map((row) => [row.id, row.kind, row.title]), [[sent.itemId, "presentation", "Demo"]]);
  const { reviewShareId } = await run(root, "library.review.open", { itemId: sent.itemId });
  assert.equal(copies.at(-1).shareId, reviewShareId, "the review copy gets the deck as a private presentation");
  decks.set(`${reviewShareId}:admin`, { ...decks.get("demo:owner"), _id: "deck2", slateShareId: reviewShareId, userId: "admin", name: "Kickoff talk, tidied" });
  await run(root, "library.review.approve", { itemId: sent.itemId });
  const visitor = { kind: "visitor", userId: null, scopes: [] };
  const published = await run(visitor, "library.get", { itemId: sent.itemId });
  assert.equal(published.version.content.kind, "presentation");
  assert.equal(published.version.content.deck.name, "Kickoff talk, tidied", "the deck as the reviewer left it");
  assert.equal(published.version.content.deck.userId, undefined, "the deck keeps nothing of its owner");
  // Someone else opens a copy: a private slate, with the deck as a private presentation of it.
  const fork = await run(person("other"), "library.fork", { itemId: sent.itemId });
  assert.ok(fork.shareId);
  assert.deepEqual([copies.at(-1).shareId, copies.at(-1).deck.isPublished, copies.at(-1).deck.isPublic], [fork.shareId, false, false]);
  assert.equal(env.world.slate(fork.shareId).libraryOrigin.itemId, sent.itemId);
});

test("a guest is asked to sign up before publishing a slate; a stranger cannot publish someone's slate", async (t) => {
  const env = await setup(t);
  const { run, person } = env;
  await assert.rejects(env.ddp("guest1", "library.submit", { kind: "slate", shareId: "demo", summary: "x" }), (error) => error.error === "sign_in_to_publish");
  await assert.rejects(run(person("other"), "library.submit", { kind: "slate", shareId: "open", summary: "Not mine" }), { status: 403, code: "owner_required" });
  assert.equal((await run(person("admin"), "library.review.queue", {})).total, 0);
});
