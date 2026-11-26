// The library.* actions over every surface: the app's Meteor methods (a session), /api/v1 (a
// token, or nobody), and exec (the gate a script's calls meet). One allow-and-deny matrix:
// visitors read published items only, cached and readable from any origin; nobody but an
// administrator reviews or publishes; an author's submission waits for review; guests use what
// is published and never publish; forks and branches remember where they came from; a branch
// keeps its parent's category.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { makeExecWorld } from "./exec-test-world.mjs";
import { mountDdp } from "../web/app/server/actions/ddp.mjs";
import { principalFromUser } from "../web/app/server/actions/principal.mjs";
import { API_TOKEN_SCOPES } from "../web/app/server/api-token-core.mjs";
import { copyDocument } from "../web/app/server/actions/slate-copy.mjs";
import { tokenPermissions } from "../web/app/imports/api/common/token-permissions.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const REVIEW = ["library.review.queue", "library.review.open", "library.review.refine", "library.review.update", "library.review.approve",
  "library.review.requestChanges", "library.review.reject", "library.review.unpublish"];

async function setup(t) {
  const world = makeExecWorld();
  t.after(() => world.close());
  await world.libraryReady;
  world.users.docs.push({ _id: "guest1", isAnonymous: true });
  // Sessions, as the app's Meteor methods see them.
  let methods;
  mountDdp(world.registry, {
    defineMethods: (defined) => (methods = defined),
    makeError: (code, reason, details) => Object.assign(new Error(reason), { error: code, reason, details }),
    loadUser: async (id) => world.users.docs.find((user) => user._id === id) || null,
    scopes: API_TOKEN_SCOPES,
  });
  const ddp = (userId, method, input) => methods[method].call({ userId }, input);
  const person = (userId) => principalFromUser(world.users.docs.find((user) => user._id === userId), API_TOKEN_SCOPES);
  const run = (principal, id, input, options) => world.registry.run(principal, id, input, options).then((result) => result.body);
  return { world, ddp, person, run, methods };
}

// A builder slate with a saved component of Ada's (a branch of the built-in retro), submitted.
async function submitted(env, { title = "Weekly retro", submit = true } = {}) {
  const { run, person } = env;
  const ada = person("owner");
  const { shareId } = await run(ada, "library.branch", { itemId: "retro" });
  const draft = await run(ada, "library.saveDraft", { shareId, title, summary: "Went well, change, try" });
  if (submit) await run(ada, "library.submit", { kind: "component", itemId: draft.itemId, note: "First go" });
  return { itemId: draft.itemId, builder: shareId };
}

async function published(env, options) {
  const { run, person } = env;
  const made = await submitted(env, options);
  const root = person("admin");
  await run(root, "library.review.open", { itemId: made.itemId });
  await run(root, "library.review.approve", { itemId: made.itemId });
  return made;
}

test("a visitor reads published items over HTTP, cached and readable from any origin; a token's reads stay no-store", async (t) => {
  const env = await setup(t);
  const call = await env.world.serve(t);
  const stats = await call("/api/v1/library/stats");
  assert.equal(stats.status, 200);
  assert.deepEqual(stats.body.components, { builtin: 20, community: 0, total: 20 });
  assert.equal(stats.headers.get("cache-control"), "public, max-age=60, s-maxage=300");
  assert.equal(stats.headers.get("access-control-allow-origin"), "*");
  assert.equal(stats.headers.get("vary"), "Authorization");
  const preflight = await fetch(call.base + "/api/v1/library", { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-methods"), "GET");
  assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
  const list = await call("/api/v1/library?kind=component&limit=5");
  assert.deepEqual([list.status, list.body.items.length, list.body.total, list.body.next], [200, 5, 20, "5"]);
  assert.equal((await call("/api/v1/library?cursor=15&kind=component")).body.items.length, 5);
  const retro = await call("/api/v1/library/retro");
  assert.deepEqual([retro.status, retro.body.item.authorName, retro.body.item.status], [200, "Slatebox", undefined]);
  assert.equal(retro.body.version.content.kind, "component");
  const exported = await call("/api/v1/library/export");
  assert.equal(exported.body.items.length, 20);
  assert.equal(exported.headers.get("cache-control"), "public, max-age=60, s-maxage=120");
  // With a token: the same answer, never cached.
  const { token } = await env.world.mint(["slates:read"]);
  const signed = await call("/api/v1/library/stats", { token });
  assert.deepEqual([signed.status, signed.headers.get("cache-control"), signed.headers.get("access-control-allow-origin")], [200, "no-store", null]);
  // A refusal to a visitor is readable cross-origin and never cached.
  const missing = await call("/api/v1/library/nothing-here");
  assert.deepEqual([missing.status, missing.body.error.code, missing.headers.get("cache-control")], [404, "not_found", "no-store"]);
  // A visitor never writes, nor reads anyone's own items.
  assert.equal((await call("/api/v1/library/retro/fork", { method: "POST", body: {} })).status, 401);
  assert.equal((await call("/api/v1/library/mine")).status, 401);
  assert.equal((await call("/api/v1/library/review")).status, 401);
});

test("an unpublished item never leaks to the public: list, get, export, stats and a guessed slug", async (t) => {
  const env = await setup(t);
  const call = await env.world.serve(t);
  const { itemId } = await submitted(env, { title: "Secret retro" });
  const item = env.world.library.items.docs.find((doc) => doc._id === itemId);
  for (const ref of [itemId, item.slug]) assert.equal((await call("/api/v1/library/" + ref)).status, 404, ref);
  assert.equal((await call("/api/v1/library?q=Secret")).body.total, 0);
  assert.ok(!(await call("/api/v1/library/export")).body.items.some((entry) => entry.id === itemId));
  assert.equal((await call("/api/v1/library/stats")).body.components.community, 0);
  // Someone else signed in sees nothing either; its author and a reviewer do.
  const ben = await env.world.mint(["slates:read"], "other");
  assert.equal((await call("/api/v1/library/" + itemId, { token: ben.token })).status, 404);
  const ada = await env.world.mint(["slates:read"], "owner");
  const own = await call("/api/v1/library/" + itemId, { token: ada.token });
  assert.deepEqual([own.status, own.body.item.status, own.body.version.n], [200, "submitted", 1]);
  assert.equal((await env.ddp("admin", "library.get", { itemId })).item.status, "submitted");
  assert.equal((await env.ddp(null, "library.get", { itemId: "retro" })).item.title, "Retro", "a signed-out page reads published items over DDP");
  await assert.rejects(env.ddp(null, "library.get", { itemId }), { error: "not_found" });
  // Published, it is public, counted, and listed.
  await env.run(env.person("admin"), "library.review.open", { itemId });
  await env.run(env.person("admin"), "library.review.approve", { itemId });
  assert.equal((await call("/api/v1/library/" + item.slug)).status, 200);
  assert.equal((await call("/api/v1/library/stats")).body.components.community, 1);
  assert.equal((await call("/api/v1/library?q=secret")).body.items[0].id, itemId);
});

test("only an administrator reviews: every review action refuses anyone else, over DDP, HTTP and exec", async (t) => {
  const env = await setup(t);
  const call = await env.world.serve(t);
  const { itemId } = await submitted(env);
  const inputs = { "library.review.queue": {}, "library.review.refine": { itemId, message: "rename it to X" }, "library.review.update": { itemId, title: "X" },
    "library.review.requestChanges": { itemId, message: "No" }, "library.review.reject": { itemId, message: "No" }, "library.review.unpublish": { itemId, message: "No" } };
  const input = (id) => inputs[id] || { itemId };
  // A session of the item's own author (who is no administrator), and of someone else.
  for (const userId of ["owner", "other", "guest1"]) {
    for (const id of REVIEW) await assert.rejects(env.ddp(userId, id, input(id)), (error) => ["reviewer_required", "registration_required"].includes(error.error), `${userId} ${id}`);
  }
  // A token that holds library:review, of an account that is no administrator.
  const ada = await env.world.mint(["slates:read", "slates:write", "slates:share", "library:review"], "owner");
  const routes = { "library.review.queue": ["GET", "/library/review"], "library.review.open": ["POST", `/library/review/${itemId}/open`],
    "library.review.refine": ["POST", `/library/review/${itemId}/refine`], "library.review.update": ["PATCH", `/library/review/${itemId}`],
    "library.review.approve": ["POST", `/library/review/${itemId}/approve`], "library.review.requestChanges": ["POST", `/library/review/${itemId}/changes`],
    "library.review.reject": ["POST", `/library/review/${itemId}/reject`], "library.review.unpublish": ["POST", `/library/review/${itemId}/unpublish`] };
  for (const id of REVIEW) {
    const [method, path] = routes[id];
    const { itemId: _skip, ...body } = input(id);
    const answer = await call("/api/v1" + path, { token: ada.token, method, ...(method !== "GET" && { body }) });
    assert.deepEqual([answer.status, answer.body.error?.code], [403, "reviewer_required"], id);
  }
  // An administrator's token without library:review is refused for the permission.
  const rootNoScope = await env.world.mint(["slates:read", "slates:write"], "admin");
  assert.deepEqual([(await call("/api/v1/library/review", { token: rootNoScope.token })).status], [403]);
  // exec: the same refusal reaches a script's call.
  const principal = await env.world.principalFor(["slates:read", "slates:write", "slates:share", "library:review"], "owner");
  const ctx = env.world.exec.gate.newContext({ execId: uuid(), principal, surface: "api", codeSha256: sha("code"), intent: "test" });
  for (const [seq, id] of REVIEW.entries()) {
    const out = await env.world.exec.gate.call(ctx, { seq: seq + 1, method: id, input: input(id) });
    assert.equal(out.ok, false, id);
    assert.equal(out.error.code, ["library.review.approve", "library.review.unpublish"].includes(id) && out.error.code === "confirmation_required" ? "confirmation_required" : "reviewer_required", id);
  }
  // Nothing moved: the item is still waiting, and its author never published it.
  const item = env.world.library.items.docs.find((doc) => doc._id === itemId);
  assert.deepEqual([item.status, item.reviewStatus, item.publishedVersion], ["submitted", "submitted", undefined]);
  // An administrator's token with library:review reviews.
  const root = await env.world.mint(["slates:read", "library:review"], "admin");
  const queue = await call("/api/v1/library/review", { token: root.token });
  assert.deepEqual([queue.status, queue.body.items.map((row) => row.id)], [200, [itemId]]);
  assert.equal(queue.body.items[0].waitingSince, "2026-11-23T12:00:00.000Z");
});

test("the lifecycle, one event per action: submit, open, refine, request changes, resubmit, approve, update, reject, unpublish", async (t) => {
  const env = await setup(t);
  const { run, person, world } = env;
  const ada = person("owner"), root = person("admin");
  const { itemId, builder } = await submitted(env);
  const events = () => world.library.events.docs.filter((event) => event.itemId === itemId).map((event) => event.type);
  assert.deepEqual(events(), ["created", "submitted"]);
  // An author can't submit twice, approve or open their own.
  await assert.rejects(run(ada, "library.submit", { kind: "component", itemId }), { status: 409, code: "invalid_transition" });
  const opened = await run(root, "library.review.open", { itemId });
  assert.deepEqual([opened.status, opened.version], ["in_review", 1]);
  assert.equal((await run(root, "library.review.open", { itemId })).reviewShareId, opened.reviewShareId, "opening again answers the same copy");
  const review = world.slate(opened.reviewShareId);
  assert.deepEqual([review.userId, review.library.mode, review.library.itemId, review.library.version, review.options.isPrivate], ["admin", "review", itemId, 1, true]);
  // Withdraw is refused while in review; request changes needs a message.
  await assert.rejects(run(ada, "library.withdraw", { itemId }), { status: 409 });
  await assert.rejects(run(root, "library.review.requestChanges", { itemId }), { status: 400 });
  const preview = await run(root, "library.review.refine", { itemId, message: "rename it to Team retro", mode: "preview" });
  assert.deepEqual(preview.diff.meta.title, ["Weekly retro", "Team retro"]);
  assert.equal(world.library.items.docs.find((doc) => doc._id === itemId).title, "Weekly retro", "a preview changes nothing");
  await run(root, "library.review.refine", { itemId, message: "rename it to Team retro" });
  await run(root, "library.review.requestChanges", { itemId, message: "Add a Try column" });
  assert.deepEqual(world.library.notices.at(-1), { type: "changes_requested", itemId, message: "Add a Try column" });
  await run(ada, "library.comment", { itemId, message: "Done, see the board" });
  await run(ada, "library.submit", { kind: "component", itemId });
  await run(root, "library.review.open", { itemId });
  assert.notEqual(world.library.items.docs.find((doc) => doc._id === itemId).reviewShareId, opened.reviewShareId, "a new version gets a fresh review copy");
  assert.ok(world.slate(opened.reviewShareId).archivedDate, "the old copy is archived, never deleted");
  const approved = await run(root, "library.review.approve", { itemId, message: "Thanks" });
  // Approve publishes the version the author sent (2), the reviewer's changes kept in it: no number of its own.
  assert.deepEqual([approved.status, approved.publishedVersion, approved.publishedCount], ["published", 2, 1]);
  const stored = world.library.versions.docs.filter((doc) => doc.itemId === itemId);
  assert.deepEqual(stored.map((doc) => doc.n), [1, 2]);
  assert.deepEqual([stored[1].meta.title, stored[1].reviewedBy, stored[1].submitted], ["Team retro", "admin", undefined], "sent as it was published: nothing kept beside it");
  const thread = world.library.events.docs.filter((event) => event.itemId === itemId && event.type === "approved");
  assert.deepEqual(thread.map((event) => event.version), [2], "the thread names the version published");
  // An update to a published item: the published version stays public until the update is approved.
  const visitor = { kind: "visitor", userId: null, scopes: [] };
  await run(ada, "library.submit", { kind: "component", itemId, title: "Team retro, again" });
  const live = await run(visitor, "library.get", { itemId });
  assert.deepEqual([live.version.n, live.item.publishedVersion, live.item.title, live.item.pendingMeta], [2, 2, "Team retro", undefined], "the public sees what was published");
  assert.equal((await run(ada, "library.get", { itemId })).item.pendingMeta.title, "Team retro, again", "its author sees the update waiting");
  assert.equal((await run(ada, "library.get", { itemId })).version.n, 3);
  const queued = await run(root, "library.review.queue", {});
  assert.equal(queued.items.find((row) => row.id === itemId).isUpdate, true);
  await run(root, "library.review.open", { itemId });
  await run(root, "library.review.update", { itemId, summary: "A shorter line" });
  assert.equal((await run(visitor, "library.get", { itemId })).item.summary, "Went well, change, try", "a reviewer's edit to an update waits with it");
  await run(root, "library.review.reject", { itemId, message: "Keep the first name" });
  const after = world.library.items.docs.find((doc) => doc._id === itemId);
  assert.deepEqual([after.status, after.reviewStatus, after.publishedVersion, after.title, after.pendingMeta], ["published", "rejected", 2, "Team retro", undefined]);
  assert.equal((await run(visitor, "library.get", { itemId })).version.n, 2);
  await run(root, "library.review.unpublish", { itemId, message: "Duplicate" });
  await assert.rejects(run(visitor, "library.get", { itemId }), { status: 404 });
  assert.deepEqual(events(), ["created", "submitted", "review_opened", "refine_proposed", "refine_proposed", "refine_kept", "changes_requested", "comment",
    "submitted", "review_opened", "approved", "submitted", "review_opened", "edited", "rejected", "unpublished"]);
  // The builder slate was never touched by review.
  assert.equal(world.slate(builder).library.mode, "build");
});

test("withdraw, discard and the draft: a withdrawn submission is a draft again; only a draft is discarded", async (t) => {
  const env = await setup(t);
  const { run, person, world } = env;
  const ada = person("owner"), ben = person("other");
  const { itemId, builder } = await submitted(env);
  await assert.rejects(run(ben, "library.withdraw", { itemId }), { status: 404 });
  await assert.rejects(run(ada, "library.discard", { itemId }), { status: 409 });
  assert.equal((await run(ada, "library.withdraw", { itemId })).status, "draft");
  await assert.rejects(run(ben, "library.discard", { itemId }), { status: 404 });
  assert.deepEqual(await run(ada, "library.discard", { itemId }), { itemId, discarded: true, mode: "save" });
  assert.equal(world.library.items.docs.some((doc) => doc._id === itemId), false);
  assert.equal(world.slate(builder).library.itemId, undefined);
  // Built-ins are Slatebox's: nothing but reading, forking and branching.
  await assert.rejects(run(ada, "library.withdraw", { itemId: "builtin-retro" }), { status: 409, code: "builtin" });
  await assert.rejects(run(person("admin"), "library.review.update", { itemId: "builtin-retro", title: "X" }), { status: 409, code: "builtin" });
});

test("guests use what is published and never publish: fork and branch yes, submit no; nobody forks what they can't read", async (t) => {
  const env = await setup(t);
  const { run, person, world, ddp } = env;
  const { itemId } = await submitted(env, { title: "Pending retro" });
  const forked = await ddp("guest1", "library.fork", { itemId: "pros-cons" });
  const copy = world.slate(forked.shareId);
  assert.deepEqual([copy.userId, copy.options.isPrivate, copy.libraryOrigin], ["guest1", true, { itemId: "builtin-pros-cons", version: 1, kind: "component", title: "Pros and cons", authorName: "Slatebox" }]);
  assert.equal(world.library.items.docs.find((doc) => doc._id === "builtin-pros-cons").counts.adds, 0, "a guest's use is never counted");
  await assert.rejects(ddp("guest1", "library.fork", { itemId }), { error: "not_found" });
  await assert.rejects(run(person("other"), "library.fork", { itemId }), { status: 404 });
  const branch = await ddp("guest1", "library.branch", { itemId: "retro" });
  const draft = await ddp("guest1", "library.saveDraft", { shareId: branch.shareId, title: "Guest retro", summary: "Mine" });
  assert.equal(draft.status, "draft");
  await assert.rejects(ddp("guest1", "library.submit", { kind: "component", itemId: draft.itemId }), { error: "sign_in_to_publish" });
  await assert.rejects(ddp("guest1", "library.comment", { itemId: draft.itemId, message: "hi" }), { error: "registration_required" });
  // Someone else's builder slate is not yours to save from.
  await assert.rejects(run(person("other"), "library.saveDraft", { shareId: branch.shareId, title: "Mine now", summary: "x" }), { status: 403, code: "owner_required" });
});

test("approving publishes the version its author sent, as the reviewer left it: the number shown, stored and branched from is one", async (t) => {
  const env = await setup(t);
  const { run, person, world } = env;
  const root = person("admin"), visitor = { kind: "visitor", userId: null, scopes: [] };
  const { itemId } = await submitted(env);
  await run(root, "library.review.open", { itemId });
  await run(root, "library.review.update", { itemId, title: "Reviewed retro" });
  const approved = await run(root, "library.review.approve", { itemId });
  assert.deepEqual([approved.publishedVersion, approved.publishedCount], [1, 1]);
  const rows = world.library.versions.docs.filter((doc) => doc.itemId === itemId);
  assert.equal(rows.length, 1, "the review adds no version of its own");
  assert.deepEqual([rows[0].n, rows[0].meta.title, rows[0].submitted.meta.title, rows[0].reviewedBy], [1, "Reviewed retro", "Weekly retro", "admin"]);
  const page = await run(visitor, "library.get", { itemId });
  assert.deepEqual([page.item.publishedVersion, page.version.n, page.item.title], [1, 1, "Reviewed retro"]);
  const { versionLine } = await import("../web/app/imports/ui/components/library/gallery/galleryCopy.mjs");
  assert.match(versionLine(page.item, page.version), /^Version 1\b/);
  // A branch names the same version the page shows.
  const branch = await run(person("other"), "library.branch", { itemId });
  assert.equal(world.slate(branch.shareId).library.parent.version, page.item.publishedVersion);
  // The review panel says the version it is about to publish, and the one it published, from the same numbers.
  const panel = readFileSync(new URL("../web/app/imports/ui/components/library/review/ReviewPanel.jsx", import.meta.url), "utf8");
  assert.match(panel, /const nextVersion = item\?\.pendingVersion \?\? null/);
  assert.match(panel, /version: result\.publishedVersion \?\? nextVersion/);
  assert.doesNotMatch(panel, /result\.publishedCount/);
});

test("a fork remembers its item through later copies and is credited when published; a branch keeps its parent's category, locked", async (t) => {
  const env = await setup(t);
  const { run, person, world } = env;
  const ada = person("owner"), ben = person("other"), root = person("admin");
  // Ada publishes her slate.
  const slateItem = await run(ada, "library.submit", { kind: "slate", shareId: "demo", summary: "A demo slate", category: "plan" });
  await run(root, "library.review.open", { itemId: slateItem.itemId });
  await run(root, "library.review.approve", { itemId: slateItem.itemId });
  // Ben forks it: a private slate of his, remembering the item.
  const forked = await run(ben, "library.fork", { itemId: slateItem.itemId, name: "Ben's demo" });
  const copy = world.slate(forked.shareId);
  assert.deepEqual([copy.userId, copy.options.name, copy.libraryOrigin], ["other", "Ben's demo", { itemId: slateItem.itemId, version: 1, kind: "slate", title: "Demo", authorName: "Ada" }]);
  assert.equal(copy.nodes.length, world.slate("demo").nodes.length);
  assert.equal(world.library.items.docs.find((doc) => doc._id === slateItem.itemId).counts.copies, 1);
  // A later copy of the fork still remembers it; a builder's mode never travels.
  const again = copyDocument({ ...copy, library: { mode: "build" } }, { id: "x", shareId: "x", user: { _id: "cy" }, now: 1 });
  assert.deepEqual([again.libraryOrigin, again.library], [copy.libraryOrigin, undefined]);
  // Ben publishes his fork: credited to Ada's item.
  const benItem = await run(ben, "library.submit", { kind: "slate", shareId: forked.shareId, summary: "My take" });
  assert.deepEqual(world.library.items.docs.find((doc) => doc._id === benItem.itemId).provenance, { forkedFrom: { itemId: slateItem.itemId, version: 1, title: "Demo" } });
  // A branch of a Decide component stays in Decide: on save, on review edits and on refinement.
  const branch = await run(ada, "library.branch", { itemId: "pros-cons" });
  assert.deepEqual(world.slate(branch.shareId).library.parent, { itemId: "builtin-pros-cons", version: 1, title: "Pros and cons", category: "decide" });
  await assert.rejects(run(ada, "library.saveDraft", { shareId: branch.shareId, title: "Mine", summary: "x", category: "plan" }),
    { status: 409, code: "category_locked", message: "A branch stays in its parent's category, Decide." });
  const draft = await run(ada, "library.saveDraft", { shareId: branch.shareId, title: "Weighted pros and cons", summary: "Pros and cons with weights" });
  const item = world.library.items.docs.find((doc) => doc._id === draft.itemId);
  assert.deepEqual([item.category, item.categoryLocked, item.provenance], ["decide", true, { branchedFrom: { itemId: "builtin-pros-cons", version: 1, title: "Pros and cons" } }]);
  assert.equal(world.library.items.docs.find((doc) => doc._id === "builtin-pros-cons").counts.branches, 1);
  await run(ada, "library.submit", { kind: "component", itemId: draft.itemId });
  await run(root, "library.review.open", { itemId: draft.itemId });
  await assert.rejects(run(root, "library.review.update", { itemId: draft.itemId, category: "plan" }), { status: 409, code: "category_locked" });
  await assert.rejects(run(root, "library.review.refine", { itemId: draft.itemId, message: "put it in Plan" }), { status: 409, code: "category_locked" });
  // A component from scratch needs a category to be submitted.
  const fresh = await run(ada, "library.branch", { itemId: "new" });
  assert.deepEqual(world.slate(fresh.shareId).library, { mode: "build" });
  await assert.rejects(run(ada, "library.saveDraft", { shareId: fresh.shareId, title: "Empty", summary: "x" }), { status: 409, code: "no_board" });
});

test("a published component is added to a slate like a catalogue entry (add_component library), and both count the add", async (t) => {
  const env = await setup(t);
  const { run, person, world } = env;
  const { itemId } = await published(env);
  const gate = world.exec.gate;
  const principal = await world.principalFor(["slates:read", "slates:write"], "owner");
  const ctx = gate.newContext({ execId: uuid(), principal, surface: "api", codeSha256: sha("code"), intent: "test" });
  const plan = (op) => ({ shareId: "demo", plan: { message: "Add", operations: [{ kind: "add_component", expectedRevision: world.slate("demo").revision ?? 0, ...op }] } });
  const added = await gate.call(ctx, { seq: 1, method: "slates.applyOperations", input: plan({ library: { itemId } }) });
  assert.equal(added.ok, true, JSON.stringify(added.error));
  assert.equal(added.value.report.library.itemId, itemId);
  assert.equal(world.slate("demo").creative.model.workshop.title, "Weekly retro");
  assert.equal(world.library.items.docs.find((doc) => doc._id === itemId).counts.adds, 1);
  const catalogue = await gate.call(ctx, { seq: 2, method: "slates.applyOperations", input: plan({ component: "triage" }) });
  assert.equal(catalogue.ok, true, JSON.stringify(catalogue.error));
  assert.equal(world.library.items.docs.find((doc) => doc._id === "builtin-triage").counts.adds, 1);
  // A draft of someone else's is nobody else's to add.
  const pending = await submitted(env, { title: "Not yet" });
  const refused = await gate.call(gate.newContext({ execId: uuid(), principal: await world.principalFor(["slates:read", "slates:write"], "other"), surface: "api", codeSha256: sha("c"), intent: "t" }),
    { seq: 1, method: "slates.applyOperations", input: { shareId: "theirs", plan: { message: "Add", operations: [{ kind: "add_component", library: { itemId: pending.itemId }, expectedRevision: 0 }] } } });
  assert.equal(refused.error.code, "not_found");
  // library.fork with targetShareId: a preview shows the board and where it goes; save puts it beside the boards.
  const ada = person("owner");
  const before = world.slate("demo").revision;
  const preview = await run(ada, "library.fork", { itemId, targetShareId: "demo", mode: "preview" });
  assert.equal(preview.boardId, "b3", "beside the two boards it holds");
  assert.ok(preview.canvas.workshop && preview.canvas.origin);
  assert.equal(world.slate("demo").revision, before, "a preview saves nothing");
  await assert.rejects(run(ada, "library.fork", { itemId, targetShareId: "demo", expectedRevision: before - 1 }), { status: 409, code: "slate_changed" });
  const saved = await run(ada, "library.fork", { itemId, targetShareId: "demo", topic: "Q3", expectedRevision: before });
  assert.deepEqual([saved.boardId, saved.revision], ["b3", before + 1]);
  assert.equal(world.slate("demo").boards.b3.model.workshop.title, "Weekly retro: Q3");
  await assert.rejects(run(person("other"), "library.fork", { itemId, targetShareId: "demo" }), { status: 404 });
});

test("submit and approve wait for the person's yes when a script makes them; discard and unpublish are held as removals", async (t) => {
  const env = await setup(t);
  const { world } = env;
  const { itemId } = await submitted(env, { submit: false });
  const gate = world.exec.gate;
  const ada = await world.principalFor(["slates:read", "slates:write", "slates:share"], "owner");
  const ctx = gate.newContext({ execId: uuid(), principal: ada, surface: "api", codeSha256: sha("code"), intent: "test" });
  const held = await gate.call(ctx, { seq: 1, method: "library.submit", input: { kind: "component", itemId } });
  assert.equal(held.error.code, "confirmation_required");
  assert.equal(held.error.details.reasons[0].rule, "widens_access");
  const discard = await gate.call(ctx, { seq: 2, method: "library.discard", input: { itemId } });
  assert.equal(discard.error.details.reasons.at(-1).rule, "removes");
  assert.equal(world.library.items.docs.find((doc) => doc._id === itemId).status, "draft", "nothing was sent");
  // Reads and a fork run at once.
  assert.equal((await gate.call(ctx, { seq: 3, method: "library.list", input: { kind: "component" } })).ok, true);
  assert.equal((await gate.call(ctx, { seq: 4, method: "library.mine", input: {} })).value.items[0].id, itemId);
  await env.run(env.person("owner"), "library.submit", { kind: "component", itemId });
  await env.run(env.person("admin"), "library.review.open", { itemId });
  const root = await world.principalFor(["slates:read", "library:review"], "admin");
  const rctx = gate.newContext({ execId: uuid(), principal: root, surface: "api", codeSha256: sha("code"), intent: "test" });
  const approve = await gate.call(rctx, { seq: 1, method: "library.review.approve", input: { itemId } });
  assert.equal(approve.error.code, "confirmation_required");
  const queue = await gate.call(rctx, { seq: 2, method: "library.review.queue", input: { status: "in_review" } });
  assert.deepEqual(queue.value.items.map((row) => row.id), [itemId]);
});

test("the library permission has its words, and instance.describe tells a reviewer so", async (t) => {
  const env = await setup(t);
  assert.ok(API_TOKEN_SCOPES.includes("library:review"));
  assert.equal(tokenPermissions.find((item) => item.scope === "library:review").label, "Review library submissions (administrators)");
  const root = await env.world.principalFor(["slates:read"], "admin");
  const ada = await env.world.principalFor(["slates:read"], "owner");
  assert.deepEqual((await env.run(root, "instance.describe", {})).library, { categories: ["plan", "decide", "meetings", "track", "map", "make"], reviewer: true });
  assert.equal((await env.run(ada, "instance.describe", {})).library.reviewer, false);
  assert.equal((await env.run({ kind: "visitor", userId: null, scopes: [] }, "instance.describe", {})).library, undefined);
});
