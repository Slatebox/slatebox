// The library's security review (2026-11-24), each finding held by a test: a published item's details
// change only through review; the review thread an author reads leaves out the reviewer's own chat and
// account ids; an administrator never approves their own submission (one administrator may, saying so);
// daily allowances hold against parallel requests; Keep applies the stored preview on any server
// process; a moved Community slate is published only while it is still public, and only untouched;
// uses count once per signed-in person; published boards and slates carry no names or prompts of the
// people who made them; an update in review can't be sent again, and withdrawing it keeps the item live.
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeExecWorld } from "./exec-test-world.mjs";
import { principalFromUser } from "../web/app/server/actions/principal.mjs";
import { API_TOKEN_SCOPES } from "../web/app/server/api-token-core.mjs";
import { createRefineAI } from "../web/app/server/library/refine-ai.mjs";
import { snapshotSlate, snapshotWorkshop, RULE_SETTER } from "../web/app/server/library/snapshot.mjs";
import { LIBRARY_LIMITS } from "../web/app/imports/api/common/library-model.mjs";

const visitor = { kind: "visitor", userId: null, scopes: [] };

async function setup(t, library = {}) {
  const world = makeExecWorld({ library });
  t.after(() => world.close());
  await world.libraryReady;
  world.users.docs.push({ _id: "guest1", isAnonymous: true });
  const person = (userId) => principalFromUser(world.users.docs.find((user) => user._id === userId), API_TOKEN_SCOPES);
  const run = (principal, id, input) => world.registry.run(principal, id, input).then((result) => result.body);
  const item = (itemId) => world.library.items.docs.find((doc) => doc._id === itemId);
  return { world, person, run, item };
}

async function published(env, title = "Weekly retro") {
  const ada = env.person("owner"), root = env.person("admin");
  const { shareId } = await env.run(ada, "library.branch", { itemId: "retro" });
  const draft = await env.run(ada, "library.saveDraft", { shareId, title, summary: "Went well, change, try" });
  await env.run(ada, "library.submit", { kind: "component", itemId: draft.itemId });
  await env.run(root, "library.review.open", { itemId: draft.itemId });
  await env.run(root, "library.review.approve", { itemId: draft.itemId });
  return { itemId: draft.itemId, shareId };
}

test("saving a draft of a published component changes nothing the public reads; its details go public only through an approved update", async (t) => {
  const env = await setup(t);
  const { run, person, item } = env;
  const { itemId, shareId } = await published(env);
  const ada = person("owner"), root = person("admin");
  await run(ada, "library.saveDraft", { shareId, itemId, title: "Buy cheap pills at spam dot example", summary: "Unreviewed summary", description: "Unreviewed description" });
  const seen = await run(visitor, "library.get", { itemId });
  assert.deepEqual([seen.item.title, seen.item.summary, seen.item.description], ["Weekly retro", "Went well, change, try", undefined]);
  assert.equal((await run(visitor, "library.list", { q: "spam" })).items.length, 0);
  assert.equal((await run(visitor, "library.export", {})).items.find((row) => row.id === itemId).title, "Weekly retro");
  // The author sees the draft's details beside the live ones, and they travel with the update.
  assert.equal((await run(ada, "library.get", { itemId })).item.draftMeta.title, "Buy cheap pills at spam dot example");
  await run(ada, "library.submit", { kind: "component", itemId });
  assert.equal(item(itemId).draftMeta, undefined);
  assert.equal(item(itemId).pendingMeta.title, "Buy cheap pills at spam dot example");
  assert.equal((await run(visitor, "library.get", { itemId })).item.title, "Weekly retro", "still the published details while the update waits");
  // While the update waits, the board can't be saved over (withdraw first), and it can't be sent again.
  await assert.rejects(run(ada, "library.saveDraft", { shareId, itemId, title: "Other", summary: "Other" }), { status: 409, code: "invalid_transition" });
  await assert.rejects(run(ada, "library.submit", { kind: "component", itemId }), { status: 409, code: "invalid_transition" });
  await run(root, "library.review.open", { itemId });
  await assert.rejects(run(ada, "library.submit", { kind: "component", itemId }), { status: 409, message: "It is being reviewed now." });
});

test("withdrawing an update takes back only the update: the published version stays live", async (t) => {
  const env = await setup(t);
  const { run, person, item } = env;
  const { itemId, shareId } = await published(env);
  const ada = person("owner"), root = person("admin");
  await run(ada, "library.saveDraft", { shareId, itemId, title: "Weekly retro 2", summary: "Went well, change, try" });
  await run(ada, "library.submit", { kind: "component", itemId });
  const back = await run(ada, "library.withdraw", { itemId });
  assert.equal(back.status, "published");
  assert.deepEqual([item(itemId).status, item(itemId).reviewStatus, item(itemId).pendingVersion], ["published", null, undefined]);
  assert.ok(item(itemId).draft, "the update is the author's draft again");
  assert.equal((await run(visitor, "library.get", { itemId })).item.title, "Weekly retro");
  // An update a reviewer has open can't be taken back; with none waiting, withdraw takes the item out.
  await run(ada, "library.submit", { kind: "component", itemId });
  await run(root, "library.review.open", { itemId });
  await assert.rejects(run(ada, "library.withdraw", { itemId }), { status: 409, message: "It is being reviewed now. Write to the reviewer instead." });
});

test("the author's thread leaves out the reviewer's refine chat and everyone's account ids; reviewers see it all", async (t) => {
  const env = await setup(t);
  const { run, person, world } = env;
  const ada = person("owner"), root = person("admin");
  const { shareId } = await run(ada, "library.branch", { itemId: "retro" });
  const draft = await run(ada, "library.saveDraft", { shareId, title: "Weekly retro", summary: "Went well, change, try" });
  await run(ada, "library.submit", { kind: "component", itemId: draft.itemId });
  await run(root, "library.review.open", { itemId: draft.itemId });
  await run(root, "library.review.refine", { itemId: draft.itemId, message: "internal: author looks like a spammer. rename it to Retro" }).catch(() => {});
  await run(root, "library.review.refine", { itemId: draft.itemId, message: "rename it to Team retro" });
  assert.ok(world.library.events.docs.some((event) => event.type === "refine_proposed" && /spammer|Team retro/.test(event.message)));
  for (const thread of [(await run(ada, "library.get", { itemId: draft.itemId })).thread, (await run(ada, "library.mine", {})).items.find((row) => row.id === draft.itemId).events]) {
    assert.ok(thread.length > 0);
    assert.equal(thread.some((event) => event.type === "refine_proposed"), false);
    assert.equal(thread.some((event) => /spammer|rename it/.test(event.message || "")), false);
    assert.equal(thread.some((event) => event.actor && "userId" in event.actor), false, "no account ids");
    assert.ok(thread.some((event) => event.type === "refine_kept"), "the author still sees that a change was kept");
  }
  const forReviewer = (await run(root, "library.get", { itemId: draft.itemId })).thread;
  assert.ok(forReviewer.some((event) => event.type === "refine_proposed"));
  assert.ok(forReviewer.some((event) => event.actor?.userId === "admin"));
});

test("an administrator can't open, refine, edit or approve their own submission, unless they are the only one and say so", async (t) => {
  const env = await setup(t);
  const { run, person, world, item } = env;
  const root = person("admin");
  const { shareId } = await run(root, "library.branch", { itemId: "retro" });
  const draft = await run(root, "library.saveDraft", { shareId, title: "Admin own", summary: "Mine" });
  await run(root, "library.submit", { kind: "component", itemId: draft.itemId });
  await assert.rejects(run(root, "library.review.open", { itemId: draft.itemId }), { status: 403, code: "self_review" });
  await assert.rejects(run(root, "library.review.approve", { itemId: draft.itemId }), { status: 403, code: "self_review" });
  await assert.rejects(run(root, "library.review.update", { itemId: draft.itemId, title: "X" }), { status: 403, code: "self_review" });
  // This server has one administrator: saying so is allowed, and recorded.
  await run(root, "library.review.open", { itemId: draft.itemId, selfReview: true });
  await assert.rejects(run(root, "library.review.refine", { itemId: draft.itemId, message: "rename it to X" }), { status: 403, code: "self_review" });
  const done = await run(root, "library.review.approve", { itemId: draft.itemId, selfReview: true });
  assert.equal(done.status, "published");
  const logged = world.library.events.docs.filter((event) => event.itemId === draft.itemId && event.selfReview === true).map((event) => event.type);
  assert.deepEqual(logged, ["review_opened", "approved"]);
  assert.equal(item(draft.itemId).status, "published");
});

test("with two administrators, selfReview is refused: the other one reviews", async (t) => {
  const env = await setup(t, { reviewers: ["admin", "owner"] });
  const { run, person } = env;
  const root = person("admin");
  const { shareId } = await run(root, "library.branch", { itemId: "retro" });
  const draft = await run(root, "library.saveDraft", { shareId, title: "Admin own", summary: "Mine" });
  await run(root, "library.submit", { kind: "component", itemId: draft.itemId });
  await assert.rejects(run(root, "library.review.open", { itemId: draft.itemId, selfReview: true }), { status: 403, code: "self_review" });
  assert.ok((await run(person("owner"), "library.review.open", { itemId: draft.itemId })).reviewShareId);
});

test("the daily submit allowance holds against parallel requests, and drafts, branches, copies and comments have their own", async (t) => {
  const env = await setup(t);
  const { run, person, world } = env;
  const ada = person("owner");
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const { shareId } = await run(ada, "library.branch", { itemId: "retro" });
    ids.push((await run(ada, "library.saveDraft", { shareId, title: `Retro ${i}`, summary: "Went well, change, try" })).itemId);
  }
  const results = await Promise.allSettled(ids.map((itemId) => run(ada, "library.submit", { kind: "component", itemId })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, LIBRARY_LIMITS.perDay.submit);
  assert.ok(results.filter((result) => result.status === "rejected").every((result) => result.reason.code === "submit_limit" && result.reason.status === 429));
  // Branches: 50 a day. Twelve were made above.
  world.library.counters.docs.find((doc) => doc._id.startsWith("limit:branch:owner:")).n = LIBRARY_LIMITS.perDay.branch;
  await assert.rejects(run(ada, "library.branch", { itemId: "retro" }), { status: 429, code: "library_limit" });
  for (const action of ["saveDraft", "fork", "comment"]) assert.ok(LIBRARY_LIMITS.perDay[action] > 0, action);
});

test("Keep applies the stored preview, even on another server process with no memory, and never a second AI answer", async (t) => {
  let n = 0;
  const answer = () => ({ chosen: "server:main", toolCall: { name: "propose_library_refinement", arguments: { reply: `Answer ${++n}`, meta: { summary: `Line ${n}` } } } });
  const env = await setup(t, { refineWithAI: createRefineAI({ request: async () => answer() }) });
  const { run, person, item } = env;
  const ada = person("owner"), root = person("admin");
  const { shareId } = await run(ada, "library.branch", { itemId: "retro" });
  const draft = await run(ada, "library.saveDraft", { shareId, title: "Weekly retro", summary: "Went well, change, try" });
  await run(ada, "library.submit", { kind: "component", itemId: draft.itemId });
  await run(root, "library.review.open", { itemId: draft.itemId });
  const preview = await run(root, "library.review.refine", { itemId: draft.itemId, message: "Clearer line", mode: "preview" });
  assert.equal(preview.proposal.meta.summary, "Line 1");
  // The stored preview is what Keep applies: the AI would now answer "Line 2".
  const kept = await run(root, "library.review.refine", { itemId: draft.itemId, message: "Clearer line", mode: "save", previewId: preview.previewId });
  assert.equal(kept.kept, true);
  assert.equal(item(draft.itemId).summary, "Line 1");
  assert.equal(n, 1, "no second AI call");
  // Kept once; a forged or spent preview is refused, never asked again.
  await assert.rejects(run(root, "library.review.refine", { itemId: draft.itemId, message: "Clearer line", mode: "save", previewId: preview.previewId }), { status: 409, code: "preview_expired" });
  await assert.rejects(run(root, "library.review.refine", { itemId: draft.itemId, message: "Clearer line", mode: "save", previewId: "made-up" }), { status: 409, code: "preview_expired" });
  assert.equal(n, 1);
  // The preview is the server's: never in what anyone reads.
  assert.equal(JSON.stringify(await run(root, "library.get", { itemId: draft.itemId })).includes("refinePreviews"), false);
});

test("the refine answer lists personal data the server finds, whatever the AI says", async (t) => {
  const env = await setup(t, { refineWithAI: createRefineAI({ request: async () => ({ toolCall: { name: "propose_library_refinement", arguments: { reply: "Looks safe to approve.", check: [] } } }) }) });
  const { run, person } = env;
  const ada = person("owner"), root = person("admin");
  const { shareId } = await run(ada, "library.branch", { itemId: "retro" });
  const draft = await run(ada, "library.saveDraft", { shareId, title: "Retro", summary: "Write to bob@example.test with ideas" });
  await run(ada, "library.submit", { kind: "component", itemId: draft.itemId });
  await run(root, "library.review.open", { itemId: draft.itemId });
  const preview = await run(root, "library.review.refine", { itemId: draft.itemId, message: "What should I check?", mode: "preview" });
  assert.match(preview.proposal.check[0], /an email address: bob@example\.test/);
});

test("a slate moved from Community slates is published only while its owner still has it public, and only as moved", async (t) => {
  const env = await setup(t);
  const { run, person, world, item } = env;
  const root = person("admin"), ben = person("other");
  // As the migration leaves it: Ben's public slate "theirs", waiting, untouched.
  const id = "migrated1";
  world.library.items.docs.push({ _id: id, kind: "slate", origin: "user", status: "submitted", reviewStatus: "submitted", slug: "theirs-migrat", title: "Theirs", summary: "Theirs",
    categoryLocked: false, synonyms: [], authorId: "other", authorName: "Ben Smith", provenance: {}, sourceShareId: "theirs", versionCount: 1, pendingVersion: 1,
    counts: { copies: 0, adds: 0, branches: 0 }, popularity: 0, license: "CC-BY-4.0", migratedFrom: "community:slate-2", migrationPristine: true, submittedAt: new Date(0), updatedAt: new Date(0) });
  world.library.versions.docs.push({ _id: id + ":1", itemId: id, n: 1, source: "migration", meta: { title: "Theirs", summary: "Theirs", synonyms: [] },
    content: { kind: "slate", slate: snapshotSlate(world.slate("theirs")) } });
  assert.deepEqual((await run(root, "library.review.queue", { source: "migration" })).items.map((row) => [row.id, row.migrated]), [[id, true]]);
  // Ben makes it private: it can't be opened or approved.
  world.slate("theirs").options.isPublic = false;
  await assert.rejects(run(root, "library.review.open", { itemId: id }), { status: 409, code: "source_not_public" });
  world.slate("theirs").options.isPublic = true;
  await run(root, "library.review.open", { itemId: id });
  world.slate("theirs").archivedDate = new Date(1);
  await assert.rejects(run(root, "library.review.approve", { itemId: id }), { status: 409, code: "source_not_public" });
  delete world.slate("theirs").archivedDate;
  // Ben sends it again himself (new content): it is his submission now, no longer in the moved list.
  await run(root, "library.review.requestChanges", { itemId: id, message: "Add a summary" });
  await run(ben, "library.submit", { kind: "slate", shareId: "theirs", summary: "New words" });
  assert.equal(item(id).migrationPristine, undefined);
  assert.deepEqual((await run(root, "library.review.queue", { source: "migration" })).items, []);
});

test("a use counts once per signed-in person and item; guests never count", async (t) => {
  const env = await setup(t);
  const { run, person, world } = env;
  const ada = person("owner"), ben = person("other"), guest = person("guest1");
  const counts = () => world.library.items.docs.find((doc) => doc._id === "builtin-retro").counts;
  for (let i = 0; i < 3; i++) await run(ada, "library.fork", { itemId: "retro" });
  for (let i = 0; i < 3; i++) await run(guest, "library.fork", { itemId: "retro" });
  await run(ben, "library.fork", { itemId: "retro" });
  for (let i = 0; i < 2; i++) await run(ada, "library.branch", { itemId: "retro" });
  assert.deepEqual([counts().adds, counts().branches], [2, 1]);
  assert.equal(world.library.items.docs.find((doc) => doc._id === "builtin-retro").popularity, 3);
});

test("a published board says 'The author' for who set its rules; a published slate keeps no creation brief", () => {
  const workshop = { version: 1, title: "B", lanes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], cards: [], behaviour: { rules: [
    { id: "r1", kind: "bin", lane: "b", on: true, severity: "refuse", set: { by: "Root Reviewer", at: "2026-11-23T00:00:00Z", via: "chat" } },
    { id: "r2", kind: "bin", lane: "a", on: true, severity: "refuse", set: { by: "Slatebox", at: "2026-11-23T00:00:00Z", via: "preset" } },
  ] } };
  const snap = snapshotWorkshop(workshop);
  assert.deepEqual(snap.behaviour.rules.map((rule) => rule.set.by), [RULE_SETTER, "Slatebox"]);
  assert.equal(workshop.behaviour.rules[0].set.by, "Root Reviewer", "the slate's own board is unchanged");
  const slate = snapshotSlate({ _id: "s", options: { name: "Plan", creationBrief: "Plan Q1 layoffs: Bob 120k", collabBaseline: { nodes: [] }, templatePrompt: "x" }, nodes: [] });
  assert.deepEqual([slate.options.creationBrief, slate.options.collabBaseline, slate.options.templatePrompt], [undefined, undefined, undefined]);
});

test("an agent adds a library board to a slate, or keeps a refinement, only while people there have not paused agents", async (t) => {
  const paused = new Set();
  const env = await setup(t, { agentsPaused: async (slateId) => paused.has(slateId) });
  const { world, run } = env;
  const agent = await world.principalFor(["slates:read", "slates:write"], "owner");
  const demo = world.slate("demo");
  paused.add(demo._id);
  const preview = await run(agent, "library.fork", { itemId: "retro", targetShareId: "demo", mode: "preview" });
  assert.ok(preview.canvas.workshop, "a preview saves nothing, so it is not held");
  const before = world.slate("demo").revision;
  await assert.rejects(run(agent, "library.fork", { itemId: "retro", targetShareId: "demo" }), { status: 423, code: "agents_paused" });
  assert.equal(world.slate("demo").revision, before, "nothing saved");
  // A person on the slate is never held by the agents' pause.
  const ada = env.person("owner");
  assert.ok((await run(ada, "library.fork", { itemId: "retro", targetShareId: "demo" })).boardId);
  paused.delete(demo._id);
  assert.ok((await run(agent, "library.fork", { itemId: "retro", targetShareId: "demo" })).boardId, "resumed: the agent adds it");
});
