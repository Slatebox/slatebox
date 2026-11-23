// P05a: every writer saves through the one save core. These tests drive the registry actions
// the way the app mounts them (HTTP for a token, the Meteor method for a session) over in-memory
// stores, and read what the core stored: revision, event log, search fields, scoped conflict.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createAppRegistry } from "../web/app/server/actions/index.mjs";
import { createIdempotencyStore } from "../web/app/server/actions/idempotency.mjs";
import { createPrivateSlateOperation } from "../web/app/server/create-slate-api.mjs";
import { createSlateReader } from "../web/app/server/slate-read.mjs";
import { createSlateSaveCore } from "../web/app/server/slate-save-core.mjs";
import { memoryMongo } from "./memory-mongo.mjs";
import { serve } from "./action-test-stores.mjs";

const { applyPlanToJSON } = createRequire(new URL("../web/app/package.json", import.meta.url))("slateboxjs/operations");

const note = (id, text, x = 100) => ({
  options: { id, text, xPos: x, yPos: 100, width: 180, height: 100, vectorPath: "rectangle" },
  relationships: { associations: [] },
});

const owner = { kind: "person", userId: "owner", tokenId: null, scopes: ["slates:read", "slates:write"] };
const stranger = { kind: "person", userId: "stranger", tokenId: null, scopes: ["slates:read", "slates:write"] };

function app(t) {
  const slates = memoryMongo();
  const events = memoryMongo();
  const runs = memoryMongo();
  const presentations = memoryMongo();
  let clock = 5000;
  const now = () => clock++;
  const saveCore = createSlateSaveCore({ slates, events, now });
  let shareIds = 0;
  const registry = createAppRegistry({
    deps: {
      saveCore,
      authorizeTokenForSlate: async (token, shareId) => {
        const slate = await slates.findOne({ shareId });
        const authorized = Boolean(slate && slate.userId === token.userId);
        return { slate, authorized, access: authorized ? { role: "EDIT", canEdit: true, isOwner: true, linkRole: null, grantKey: null } : null };
      },
      // The session rule (getSlatesForUser and canEditNativeSlate in the app).
      resolveSlateForUser: async (shareId, userId) => {
        const slate = await slates.findOne({ shareId });
        if (!slate) return null;
        const mine = slate.userId === userId;
        const open = slate.options?.isPublic === true;
        const editor = (slate.editors ?? []).includes(userId);
        const viewer = (slate.viewers ?? []).includes(userId);
        return { slate, canRead: mine || open || editor || viewer, canEdit: mine || editor };
      },
      generateShareId: async () => "copy" + ++shareIds,
      newId: () => "id" + ++shareIds,
      publishedPresentation: (shareId) => presentations.findOne({ slateShareId: shareId, isPublished: true }),
      copyPresentation: (presentation, { shareId, sourceShareId, user, now: at }) =>
        presentations.insertOne({ ...structuredClone(presentation), _id: "p-" + shareId, slateShareId: shareId,
          originalSlateShareId: sourceShareId, userId: user._id, copiedOn: at, isPublic: false, isFeatured: false }),
      loadUser: async (userId) => ({ _id: userId, ...(userId === "owner" && { orgId: "team" }) }),
      // integrate-w2: the read is P07's slate read (it also carries the revision).
      readSlate: createSlateReader({
        listComments: async () => [],
        findPresentation: async () => null,
        appOrigin: () => "http://slatebox.test",
        embedOrigin: () => "http://slatebox.test",
      }),
      applySlateOperationPlanToJSON: applyPlanToJSON,
      // A Meteor collection in the app (findOneAsync, insertAsync).
      operationRuns: {
        findOneAsync: (selector) => runs.findOne(selector),
        insertAsync: (row) => runs.insertOne({ _id: "run-" + runs.docs().length, ...row }),
      },
      createPrivateSlate: createPrivateSlateOperation({
        users: { findOne: async ({ _id }) => ({ _id, orgId: "team" }) },
        slates,
        runs,
        saveCore,
        withTransaction: (action) => action(undefined),
        generateShareId: async () => "made" + ++shareIds,
        appOrigin: () => "http://slatebox.test",
        now,
      }),
    },
    idempotency: createIdempotencyStore({ collection: memoryMongo() }),
    now,
  });
  const authenticate = async (req) => {
    const raw = req.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!raw) return null;
    return { kind: "agent", tokenId: "token-" + raw, tokenName: "Planner", userId: raw, scopes: ["slates:read", "slates:write"] };
  };
  return { slates, events, runs, presentations, saveCore, registry, call: serve(t, registry, authenticate) };
}

async function seeded(t) {
  const env = app(t);
  await env.saveCore.create({
    row: {
      _id: "s1", shareId: "share1", userId: "owner", lastSaved: 1,
      nodes: [note("a", "Alpha"), note("b", "Beta", 400)],
      options: { id: "s1", name: "Plan", description: "", isPrivate: true, isPublic: false, isUnlisted: false },
    },
    actor: owner,
    source: "create",
  });
  env.call = await env.call;
  return env;
}

const plan = (...operations) => ({ message: "Done.", operations });
const edit = (call, operations, extra = {}) =>
  call("/api/v1/slates/share1/operations", { token: "owner", method: "POST", body: { plan: plan(...operations), ...extra } });
const autosave = (env, nodes) =>
  env.saveCore.save({ slateId: "s1", actor: owner, source: "autosave", build: () => ({ set: { nodes } }) });

test("a slate made by a token is stored with its search fields, revision 1 and a create event", async (t) => {
  const env = app(t);
  const call = await env.call;
  const made = await call("/api/v1/slates", { token: "owner", key: "k1", method: "POST", body: { kind: "diagram", brief: "Draft -> Review" } });
  assert.equal(made.status, 201);
  const stored = await env.slates.findOne({ shareId: made.body.shareId });
  assert.equal(stored.revision, 1);
  assert.match(stored.options.searchText, /Draf Draft/);
  assert.match(stored.options.searchText, /Revi Revie Review/);
  assert.equal(typeof stored.options.searchName, "string");
  const [created] = env.events.docs();
  assert.deepEqual([created.slateId, created.revision, created.source, created.actor.tokenId], [stored._id, 1, "create", "token-owner"]);
});

test("GET returns the slate's revision", async (t) => {
  const { call } = await seeded(t);
  const read = await call("/api/v1/slates/share1", { token: "owner" });
  assert.equal(read.status, 200);
  assert.equal(read.body.revision, 1);
});

test("a saved edit raises the revision, rebuilds the search fields and logs the notes it touched with the token", async (t) => {
  const env = await seeded(t);
  const saved = await edit(env.call, [
    { kind: "update_nodes", target: { ids: ["b"] }, changes: { text: "Shipped" } },
    { kind: "update_slate", changes: { name: "Launch board" } },
  ], { expectedRevision: 1 });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.revision, 2);
  const stored = await env.slates.findOne({ _id: "s1" });
  assert.equal(stored.revision, 2);
  assert.match(stored.options.searchText, /Shipp Shippe Shipped/);
  assert.match(stored.options.searchName, /Laun Launc Launch/);
  const event = env.events.docs()[1];
  assert.deepEqual(
    { revision: event.revision, source: event.source, notes: event.notes, fields: event.fields, actor: event.actor },
    { revision: 2, source: "operations", notes: ["b"], fields: ["options.name"], actor: { kind: "agent", userId: "owner", tokenId: "token-owner", tokenName: "Planner" } },
  );
});

test("a preview answers the current revision and writes nothing", async (t) => {
  const env = await seeded(t);
  const preview = await edit(env.call, [{ kind: "update_nodes", target: { ids: ["a"] }, changes: { text: "x" } }], { mode: "preview", expectedRevision: 1 });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.revision, 1);
  assert.equal((await env.slates.findOne({ _id: "s1" })).revision, 1);
  assert.equal(env.events.docs().length, 1);
});

test("expectedRevision is scoped: refused only when a note the plan changes changed after it", async (t) => {
  const env = await seeded(t);
  // A person's autosave changes note a (revision 2).
  await autosave(env, [note("a", "Alpha by a person"), note("b", "Beta", 400)]);
  // The agent read revision 1. Its edit of b (untouched since) saves.
  const untouched = await edit(env.call, [{ kind: "update_nodes", target: { ids: ["b"] }, changes: { text: "Beta by the agent" } }], { expectedRevision: 1 });
  assert.equal(untouched.status, 201);
  assert.equal(untouched.body.revision, 3);
  // Its edit of a is refused with the current revision and the note that changed.
  const touched = await edit(env.call, [{ kind: "update_nodes", target: { ids: ["a"] }, changes: { text: "Alpha by the agent" } }], { expectedRevision: 1 });
  assert.equal(touched.status, 409);
  assert.equal(touched.body.error.code, "slate_changed");
  assert.deepEqual(touched.body.error.details, { revision: 3, notes: ["a"], fields: [] });
  assert.equal((await env.slates.findOne({ _id: "s1" })).nodes[0].options.text, "Alpha by a person");
  // Deleting a is a change to a: refused too.
  const removed = await edit(env.call, [{ kind: "delete_nodes", target: { ids: ["a"] } }], { expectedRevision: 1 });
  assert.equal(removed.status, 409);
  // A pure addition saves with the old revision.
  assert.equal((await edit(env.call, [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "New", ids: ["n1"], x: 700, y: 100 }], { expectedRevision: 1 })).status, 201);
  // Restated (release/agentic, the lead's decision): every edit names its revision. Without one
  // the edit is refused with 400 naming expectedRevision, where it was made on the slate as it
  // stood; with the current revision it saves.
  const unnamed = await edit(env.call, [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "New 2", ids: ["n2"], x: 900, y: 100 }]);
  assert.deepEqual([unnamed.status, unnamed.body.error.code, unnamed.body.error.details.field], [400, "invalid_request", "expectedRevision"]);
  const latest = (await env.slates.findOne({ _id: "s1" })).revision;
  assert.equal((await edit(env.call, [{ kind: "update_nodes", target: { ids: ["a"] }, changes: { text: "Alpha by the agent" } }], { expectedRevision: latest })).status, 201);
});

test("the person's own settings go through slates.updateSettings, are logged, and nobody else may write them", async (t) => {
  const env = await seeded(t);
  const set = (principal, input) => env.registry.run(principal, "slates.updateSettings", { shareId: "share1", ...input });
  const result = await set(owner, { aiConversation: { active: true, dormant: false }, welcomeAid: "aid-123" });
  assert.equal(result.body.revision, 2);
  const stored = await env.slates.findOne({ _id: "s1" });
  assert.deepEqual(stored.options.ai, { isConversation: { active: true, dormant: false } });
  assert.equal(stored.options.welcomeAid, "aid-123");
  assert.deepEqual(env.events.docs()[1].fields.sort(), ["options.ai.isConversation.active", "options.ai.isConversation.dormant", "options.welcomeAid"]);
  // The same values again change nothing and raise nothing.
  assert.equal((await set(owner, { welcomeAid: "aid-123" })).body.revision, 2);
  const files = [{ fileName: "brief.pdf", url: "https://files.slatebox.test/brief.pdf", pending: false }];
  assert.equal((await set(owner, { uploadedFiles: files })).body.revision, 3);
  assert.deepEqual((await env.slates.findOne({ _id: "s1" })).options.uploadedFiles, files);
  await assert.rejects(set(stranger, { welcomeAid: "x" }), (error) => error.status === 404);
  await assert.rejects(set(owner, { isPublic: true }), (error) => error.status === 400 && error.code === "invalid_request");
  await assert.rejects(set(owner, { uploadedFiles: [{ url: "javascript:alert(1)", fileName: "x" }] }), (error) => error.status === 400);
});

test("a copy is made by the server through the save core: private, the caller's, at revision 1", async (t) => {
  const env = await seeded(t);
  await env.slates.updateOne({ _id: "s1" }, { $set: { "options.isPublic": true, "options.isPrivate": false } });
  const copied = await env.registry.run(stranger, "slates.copy", { shareId: "share1", name: "My copy" });
  const copy = await env.slates.findOne({ shareId: copied.body.shareId });
  assert.equal(copy.userId, "stranger");
  assert.notEqual(copy._id, "s1");
  assert.equal(copy.options.id, copy._id);
  assert.deepEqual([copy.options.isPrivate, copy.options.isPublic, copy.options.isUnlisted], [true, false, false]);
  assert.equal(copy.options.name, "My copy");
  assert.equal(copy.revision, 1);
  assert.match(copy.options.searchName, /My cop copy/);
  assert.deepEqual(copy.nodes.map((n) => n.options.text), ["Alpha", "Beta"]);
  assert.equal(env.events.docs().at(-1).source, "copy");
  // A slate the caller cannot open is not copied.
  await env.slates.updateOne({ _id: "s1" }, { $set: { "options.isPublic": false, "options.isPrivate": true } });
  await assert.rejects(env.registry.run(stranger, "slates.copy", { shareId: "share1" }), (error) => error.status === 404);
});

// fix-P05a (review finding 1): slates.copy replaced the session's asCopy route, so it keeps that
// route's rule: an editor, a public slate, or a slate whose presentation is public. A view
// invitation alone does not allow a copy.
test("a copy needs edit rights, a public slate or a public presentation: a view invitation alone is refused", async (t) => {
  const env = await seeded(t);
  const copy = (principal) => env.registry.run(principal, "slates.copy", { shareId: "share1" });
  await env.slates.updateOne({ _id: "s1" }, { $set: { viewers: ["stranger"] } });
  await assert.rejects(copy(stranger), (error) => error.status === 404 && error.code === "not_found");
  // A published, public presentation allows it, and goes with the copy as the copier's, private.
  await env.presentations.insertOne({ _id: "p1", slateShareId: "share1", isPublished: true, isPublic: true, isFeatured: true, title: "Talk" });
  const viaPresentation = await copy(stranger);
  const carried = await env.presentations.findOne({ slateShareId: viaPresentation.body.shareId });
  assert.deepEqual([carried.userId, carried.isPublic, carried.isFeatured, carried.title, carried.originalSlateShareId], ["stranger", false, false, "Talk", "share1"]);
  // An editor may copy.
  await env.presentations.updateOne({ _id: "p1" }, { $set: { isPublic: false } });
  await assert.rejects(copy(stranger), (error) => error.status === 404);
  await env.slates.updateOne({ _id: "s1" }, { $set: { editors: ["stranger"] } });
  assert.equal((await copy(stranger)).status, 201);
});

// fix-P05a (review findings 6 and the missing test): a copy is an ordinary private slate of the
// copier's, and leaves behind what belongs to the source's author: the AI conversation it started,
// that conversation's files, and its Google Doc export.
test("a copy cannot come out approved, featured or public, and leaves the author's conversation, files and export behind", async (t) => {
  const env = await seeded(t);
  await env.slates.updateOne({ _id: "s1" }, { $set: {
    "options.isPublic": true, "options.isPrivate": false, "options.isTemplate": true, "options.templateApproved": true,
    "options.isFeatured": true, "options.isCommunity": true, "options.welcomeAid": "aid-author",
    "options.uploadedFiles": [{ fileName: "author.pdf", url: "https://files.slatebox.test/author.pdf" }],
    "options.lastSavedGoogleDocUrl": "https://docs.google.com/document/d/author", "options.staticImage": "https://img/author.png",
    "options.staticImageTimestamp": 9, "options.staticFrameImage": "https://img/author-frame.png", "options.showZoom": false,
  } });
  // A copy is an ordinary private slate: never a template, whatever its source was (templates are
  // gone; the library replaces them), and the old template switches are refused as unknown fields.
  const copied = await env.registry.run(stranger, "slates.copy", { shareId: "share1" });
  const copy = await env.slates.findOne({ shareId: copied.body.shareId });
  assert.deepEqual(
    [copy.options.isPrivate, copy.options.isPublic, copy.options.isUnlisted, copy.options.isCommunity, copy.options.isFeatured, copy.options.templateApproved],
    [true, false, false, false, false, undefined],
  );
  assert.equal(copy.options.isTemplate, undefined);
  for (const key of ["welcomeAid", "uploadedFiles", "lastSavedGoogleDocUrl", "staticImage", "staticImageTimestamp", "staticFrameImage"])
    assert.equal(copy.options[key], undefined, key);
  // The slate's own settings come with it.
  assert.equal(copy.options.showZoom, false);
  for (const field of ["keepTemplate", "fromTemplate", "projectName"])
    await assert.rejects(env.registry.run(stranger, "slates.copy", { shareId: "share1", [field]: field === "projectName" ? "X" : true }), { status: 400, code: "invalid_request" });
});

// fix-P05a (review finding 2): a note text the contract allows saves; the search text is bounded.
test("an edit with one very long word saves, with bounded search text", async (t) => {
  const env = await seeded(t);
  for (const length of [6000, 10000]) {
    const saved = await edit(env.call, [{ kind: "update_nodes", target: { ids: ["a"] }, changes: { text: "x".repeat(length) } }], { expectedRevision: (await env.slates.findOne({ _id: "s1" })).revision });
    assert.equal(saved.status, 201, JSON.stringify(saved.body).slice(0, 200));
  }
  const stored = await env.slates.findOne({ _id: "s1" });
  assert.equal(stored.nodes[0].options.text.length, 10000);
  assert.ok(stored.options.searchText.length < 400);
});

// fix-P05a (review finding 9): a preview with a stale revision answers the 409 its save would.
test("a preview with expectedRevision reports the conflict its save would meet", async (t) => {
  const env = await seeded(t);
  await autosave(env, [note("a", "Alpha by a person"), note("b", "Beta", 400)]);
  const fine = await edit(env.call, [{ kind: "update_nodes", target: { ids: ["b"] }, changes: { text: "Beta by the agent" } }], { expectedRevision: 1, mode: "preview" });
  assert.equal(fine.status, 200);
  const stale = await edit(env.call, [{ kind: "update_nodes", target: { ids: ["a"] }, changes: { text: "Alpha by the agent" } }], { expectedRevision: 1, mode: "preview" });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body.error.details, { revision: 2, notes: ["a"], fields: [] });
  assert.equal((await env.slates.findOne({ _id: "s1" })).revision, 2);
});

// fix-P05a (review finding 9): a collaborator's setting lands only while sharing is as it was
// read, like every other content writer.
test("a collaborator's setting is refused when sharing changed after it was read", async (t) => {
  const env = await seeded(t);
  await env.slates.updateOne({ _id: "s1" }, { $set: { editors: ["stranger"], sharingRevision: 1 } });
  assert.equal((await env.registry.run(stranger, "slates.updateSettings", { shareId: "share1", welcomeAid: "aid-1" })).body.revision, 2);
  // Sharing changes between the read and the save (the owner revokes the link).
  const findOne = env.slates.findOne.bind(env.slates);
  let revoked = false;
  env.slates.findOne = async (selector, ...rest) => {
    if (!revoked && selector._id === "s1") {
      revoked = true;
      await env.slates.updateOne({ _id: "s1" }, { $inc: { sharingRevision: 1 } });
    }
    return findOne(selector, ...rest);
  };
  await assert.rejects(env.registry.run(stranger, "slates.updateSettings", { shareId: "share1", welcomeAid: "aid-2" }),
    (error) => error.status === 404);
  assert.equal((await findOne({ _id: "s1" })).options.welcomeAid, "aid-1");
});

// A signed copy link (/ai?slateIdToCopy=) asks slates.copy, the same action the API and an exec
// script reach. Once the owner makes a public slate private, a stranger's copy is refused on every
// path, as Not Found, and nothing is stored; the owner may still copy their own slate.
test("a slate made private stops being copied: the session, the HTTP API and an agent's call are all refused", async (t) => {
  const env = await seeded(t);
  const agent = { kind: "agent", userId: "stranger", tokenId: "token-stranger", tokenName: "Planner", scopes: ["slates:read", "slates:write"] };
  const http = () => env.call("/api/v1/slates/share1/copy", { token: "stranger", method: "POST", body: {} });
  await env.slates.updateOne({ _id: "s1" }, { $set: { "options.isPublic": true, "options.isPrivate": false } });
  assert.equal((await env.registry.run(stranger, "slates.copy", { shareId: "share1" })).status, 201);
  assert.equal((await http()).status, 201);
  const copies = env.slates.docs().length;
  await env.slates.updateOne({ _id: "s1" }, { $set: { "options.isPublic": false, "options.isPrivate": true } });
  await assert.rejects(env.registry.run(stranger, "slates.copy", { shareId: "share1" }), (error) => error.status === 404 && error.code === "not_found");
  await assert.rejects(env.registry.run(agent, "slates.copy", { shareId: "share1" }), (error) => error.status === 404 && error.code === "not_found");
  const refused = await http();
  assert.equal(refused.status, 404);
  assert.equal(refused.body.error.code, "not_found");
  assert.equal(env.slates.docs().length, copies, "nothing is stored for a refused copy");
  assert.equal((await env.registry.run(owner, "slates.copy", { shareId: "share1" })).status, 201);
});
