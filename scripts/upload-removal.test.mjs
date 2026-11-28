// Removing a person's uploaded files (store prep, 2026-11-27): an account's uploads when the
// account is removed, and a photo note's file when the note is deleted, only once nothing uses it.
//   - A deleted note's file waits out the grace period (undo, the 3-day snapshots) and is removed only
//     when no stored document names it: a copy, a duplicate note, a snapshot or an undo keeps it.
//   - A removed account's uploads are listed day by day in the bucket (u_<userId>_ in the name) and
//     removed at once, except one another slate still shows, which is checked again later.
//   - A failure is logged without a key, URL or credential and retried with a backoff; it never
//     blocks the account removal or the save.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  accountFileKeyFor,
  accountPrefixes,
  bucketUploadsOf,
  createUploadRemoval,
  dayFoldersBetween,
  failureOf,
  GRACE_MS,
  monthFoldersBetween,
  LEASE_MS,
  pagedKeys,
  referencedKeys,
  releasedUploadKeys,
  retryDelay,
  MAX_RETRY_MS,
  RETRY_MS,
  uploadKeysIn,
} from "../web/app/server/common/upload-removal.mjs";
import { dateFolder, uploadKey, uploadKeyFor } from "../web/app/server/common/upload-keys.mjs";
import { removeSuggestionsOn } from "../web/app/server/agents/suggestions.mjs";
import { memoryCollection } from "./exec-test-world.mjs";
import { cdnDistributionOf, cdnPathOf, createCdnInvalidator, PATHS_PER_INVALIDATION, UPLOAD_CACHE_CONTROL } from "../web/app/server/common/cdn-invalidation.mjs";
import { createSlateSaveCore } from "../web/app/server/slate-save-core.mjs";
import { memoryMongo } from "./memory-mongo.mjs";

const ALICE = "A1111111111111111";
const BOB = "B2222222222222222";
const id = (n) => `R${String(n).padStart(16, "0")}`;
const key = (user, n, day = new Date(2026, 10, 20, 12)) => uploadKey(user, id(n), "jpg", day);
const FILES = "https://files.slatebox.test";
const url = (k) => `${FILES}/${k}`;
const photoNote = (noteId, k) => ({ options: { id: noteId, image: url(k), imageFit: "cover", photo: { url: url(k), width: 40, height: 30 } } });
const textNote = (noteId, text) => ({ options: { id: noteId, text } });

// ---- fakes ------------------------------------------------------------------------------------

// The queue over plain memory, with the same claim rule as the Mongo one: an item due now is
// moved LEASE_MS ahead as it is claimed, so another run does not take it.
function memoryQueue() {
  const rows = new Map();
  return {
    rows,
    async put(item) { rows.set(item._id, { ...item }); },
    async claim({ at, limit, leaseMs }) {
      const due = [...rows.values()].filter((row) => row.dueAt <= at).sort((a, b) => a.dueAt - b.dueAt).slice(0, limit);
      for (const row of due) row.dueAt = at + leaseMs;
      return due.map((row) => ({ ...row }));
    },
    // only the row as it was claimed: one released again meanwhile keeps its new wait
    async done(item) { if (rows.get(item._id)?.dueAt === item.dueAt) rows.delete(item._id); },
    async later(item, change) { const row = rows.get(item._id); if (row?.dueAt === item.dueAt) Object.assign(row, change); },
  };
}

// A mock S3 bucket: ListObjectsV2 pages of two keys, DeleteObject, and a switch to make it fail.
function mockBucket(keys = []) {
  const objects = new Set(keys);
  const calls = { list: [], remove: [] };
  let failing = null;
  const send = async (command) => {
    if (failing) throw failing;
    if (command.type === "ListObjectsV2") {
      calls.list.push(command.Prefix);
      const all = [...objects].filter((k) => k.startsWith(command.Prefix)).sort();
      const start = Number(command.ContinuationToken || 0);
      const page = all.slice(start, start + 2);
      const more = start + 2 < all.length;
      return { Contents: page.map((Key) => ({ Key })), IsTruncated: more, ...(more && { NextContinuationToken: String(start + 2) }) };
    }
    if (command.type === "DeleteObject") {
      calls.remove.push(command.Key);
      objects.delete(command.Key);
      return {};
    }
    throw new Error("unexpected command");
  };
  const listPrefix = (prefix) => pagedKeys((ContinuationToken) => send({ type: "ListObjectsV2", Prefix: prefix, ContinuationToken }));
  return {
    objects,
    calls,
    fail(error) { failing = error; },
    heal() { failing = null; },
    files: {
      listUploadsOf: (userId, since) => bucketUploadsOf({ userId, since: since ?? Date.UTC(2026, 10, 1), until: clockNow(), listPrefix, dateFolder }),
      remove: (k) => send({ type: "DeleteObject", Key: k }),
    },
  };
}

let clockNow = () => Date.now();

// The database the reference check reads: named collections of documents.
function world({ docs = {}, bucketKeys = [], start = new Date(2026, 10, 27, 12).getTime(), cdn = null } = {}) {
  const clock = { t: start };
  clockNow = () => clock.t;
  const db = { slates: [], slateSnapshots: [], libraryItems: [], agentSuggestions: [], organizationSettings: [], ...docs };
  const queue = memoryQueue();
  const bucket = mockBucket(bucketKeys);
  const logs = [];
  let usedFails = null;
  const removal = createUploadRemoval({
    queue,
    files: bucket.files,
    isUsed: async (keys) => {
      if (usedFails) throw usedFails;
      return referencedKeys(Object.values(db).flat(), keys);
    },
    cdn,
    now: () => clock.t,
    log: (message, details) => logs.push({ message, details }),
  });
  return { clock, db, queue, bucket, logs, removal, failReferences(error) { usedFails = error; } };
}

// ---- reading keys ----------------------------------------------------------------------------------

test("an upload key is read wherever a document names it, however its URL is written", () => {
  const k = key(ALICE, 1);
  assert.deepEqual([...uploadKeysIn({ nodes: [photoNote("n", k)] })], [k]);
  assert.deepEqual([...uploadKeysIn(`/files/${k}`)], [k]);
  assert.deepEqual([...uploadKeysIn({ img: `${FILES}/${k.replace(/\//g, "%2F")}` })], [k]);
  assert.deepEqual([...uploadKeysIn({ img: `${FILES}/${k.replace(/\//g, "%2f")}` })], [k]);
  // a snapshot keeps the slate as a JSON string, written again inside the row
  assert.deepEqual([...uploadKeysIn({ snapshot: JSON.stringify({ nodes: [photoNote("n", k)] }) })], [k]);
  assert.deepEqual([...uploadKeysIn({ snapshot: JSON.stringify({ u: url(k).replace(/\//g, "\\/") }) })], [k]);
  // a server-drawn image, a slate preview, someone's text: not an upload
  assert.equal(uploadKeysIn({ img: `${FILES}/2026/11/27/preview_123.png`, text: "u_ is not a key" }).size, 0);
  assert.equal(uploadKeysIn(null).size, 0);
});

test("a save releases a key only when the slate stops naming it everywhere the save writes", () => {
  const k1 = key(ALICE, 1);
  const k2 = key(ALICE, 2);
  const current = { nodes: [photoNote("a", k1), photoNote("b", k2), textNote("c", "x")] };
  // the photo note a is deleted
  assert.deepEqual(releasedUploadKeys(current, { nodes: [photoNote("b", k2), textNote("c", "x")] }), [k1]);
  // a duplicate note shows the same photo: nothing is released
  assert.deepEqual(releasedUploadKeys(current, { nodes: [photoNote("b", k2), photoNote("a2", k1)] }), []);
  // the picture moved to another path in the same save
  assert.deepEqual(releasedUploadKeys(current, { nodes: [photoNote("b", k2)], "options.background": url(k1) }), []);
  // a save of a setting never releases a note's picture
  assert.deepEqual(releasedUploadKeys(current, { "options.name": "Renamed", lastSaved: 5 }), []);
  // a picture replaced in its note releases the old one
  assert.deepEqual(releasedUploadKeys({ "options": { background: url(k1) } }, { "options.background": url(k2) }), [k1]);
  assert.deepEqual(releasedUploadKeys(null, { nodes: [] }), []);
});

test("the save core tells onReleased what a deleted photo note used, after the save, and a failure there never fails the save", async () => {
  const k1 = key(ALICE, 1);
  const released = [];
  const errors = [];
  const slates = memoryMongo();
  const events = memoryMongo();
  let fail = false;
  const core = createSlateSaveCore({
    slates, events,
    onEventError: (error) => errors.push(error.message),
    onReleased: async (keys, at) => {
      if (fail) throw new Error("queue down");
      released.push({ keys, slateId: at.slateId, stored: (await slates.findOne({ _id: "s1" })).revision });
    },
  });
  const person = { kind: "person", userId: ALICE };
  await core.create({ row: { _id: "s1", userId: ALICE, nodes: [photoNote("a", k1), textNote("b", "x")], options: {} }, actor: person, source: "create" });
  // adding a note releases nothing
  await core.save({ slateId: "s1", actor: person, source: "autosave", build: (s) => ({ set: { nodes: [...s.nodes, textNote("c", "y")] } }) });
  assert.deepEqual(released, []);
  // deleting the photo note releases its file, once the save is written (revision 3 stored)
  await core.save({ slateId: "s1", actor: person, source: "autosave", build: (s) => ({ set: { nodes: s.nodes.filter((n) => n.options.id !== "a") } }) });
  assert.deepEqual(released, [{ keys: [k1], slateId: "s1", stored: 3 }]);
  // undo puts it back; deleting it again with the queue down still saves
  await core.save({ slateId: "s1", actor: person, source: "autosave", build: (s) => ({ set: { nodes: [...s.nodes, photoNote("a", k1)] } }) });
  fail = true;
  const saved = await core.save({ slateId: "s1", actor: person, source: "autosave", build: (s) => ({ set: { nodes: s.nodes.filter((n) => n.options.id !== "a") } }) });
  assert.equal(saved.saved, true);
  assert.equal((await slates.findOne({ _id: "s1" })).nodes.some((n) => n.options.id === "a"), false);
  assert.deepEqual(errors, ["queue down"]);
});

// ---- a deleted note's file ---------------------------------------------------------------------

test("a released file waits out the grace period, then is removed when nothing names it", async () => {
  const k = key(ALICE, 1);
  const w = world({ bucketKeys: [k] });
  await w.removal.released([k]);
  await w.removal.sweep();
  assert.ok(w.bucket.objects.has(k), "not removed inside the grace period");
  w.clock.t += GRACE_MS - 1;
  await w.removal.sweep();
  assert.ok(w.bucket.objects.has(k));
  w.clock.t += 1;
  await w.removal.sweep();
  assert.equal(w.bucket.objects.has(k), false);
  assert.equal(w.queue.rows.size, 0);
  assert.ok(GRACE_MS > 3 * 24 * 60 * 60 * 1000, "past the 3-day snapshots");
});

test("a copy, a duplicated slate, a snapshot, a library item, a suggestion or a team logo that still names the file keeps it", async () => {
  const places = {
    slates: [{ _id: "copy", userId: BOB, nodes: [photoNote("a", "K")] }],
    slateSnapshots: [{ slateId: "s1", snapshot: JSON.stringify({ nodes: [photoNote("a", "K")] }) }],
    libraryItems: [{ _id: "lib", model: { nodes: [photoNote("a", "K")] } }],
    agentSuggestions: [{ _id: "sug", items: [{ kind: "add", node: photoNote("a", "K") }] }],
    organizationSettings: [{ _id: "logo", value: { url: "/files/K" } }],
  };
  for (const [collection, rows] of Object.entries(places)) {
    const k = key(ALICE, 7);
    const docs = { [collection]: JSON.parse(JSON.stringify(rows).replaceAll("K", k)) };
    const w = world({ docs, bucketKeys: [k] });
    await w.removal.released([k]);
    w.clock.t += GRACE_MS;
    await w.removal.sweep();
    assert.ok(w.bucket.objects.has(k), `${collection} keeps the file`);
    assert.equal(w.bucket.calls.remove.length, 0);
    // kept and off the queue: a later save that releases it queues it again
    assert.equal(w.queue.rows.size, 0);
  }
});

test("undo inside the grace period keeps the file; releasing it again starts the grace period again", async () => {
  const k = key(ALICE, 2);
  const w = world({ bucketKeys: [k] });
  await w.removal.released([k]);
  w.clock.t += GRACE_MS / 2;
  // undo: the note is back on the slate
  w.db.slates.push({ _id: "s1", nodes: [photoNote("a", k)] });
  w.clock.t += GRACE_MS / 2;
  await w.removal.sweep();
  assert.ok(w.bucket.objects.has(k));
  // deleted again later: queued again, removed a full grace period after that
  w.db.slates.length = 0;
  await w.removal.released([k]);
  w.clock.t += GRACE_MS / 2;
  await w.removal.released([k]);
  w.clock.t += GRACE_MS / 2;
  await w.removal.sweep();
  assert.ok(w.bucket.objects.has(k), "the second release started the wait again");
  w.clock.t += GRACE_MS / 2;
  await w.removal.sweep();
  assert.equal(w.bucket.objects.has(k), false);
});

test("a failed delete is logged without the key, URL or credentials and retried with a backoff", async () => {
  const k = key(ALICE, 3);
  const w = world({ bucketKeys: [k] });
  await w.removal.released([k]);
  w.clock.t += GRACE_MS;
  const error = Object.assign(new Error(`Access Denied for ${k} in bucket slatebox-images key AKIAIOSFODNN7EXAMPLE`), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
  w.bucket.fail(error);
  await w.removal.sweep();
  assert.ok(w.bucket.objects.has(k));
  const row = w.queue.rows.get(`file:${k}`);
  assert.equal(row.attempts, 1);
  assert.equal(row.dueAt, w.clock.t + RETRY_MS);
  assert.deepEqual(row.failure, { name: "AccessDenied", status: 403 });
  const said = JSON.stringify(w.logs);
  assert.doesNotMatch(said, /u_A1111111111111111|AKIA|slatebox-images|Access Denied|files\.slatebox/);
  assert.match(said, /retried/);
  // retried after the backoff, and removed once the store answers again
  w.bucket.heal();
  w.clock.t += RETRY_MS;
  await w.removal.sweep();
  assert.equal(w.bucket.objects.has(k), false);
  assert.equal(w.queue.rows.size, 0);
});

test("a failed reference check removes nothing and retries every item", async () => {
  const k1 = key(ALICE, 4);
  const k2 = key(ALICE, 5);
  const w = world({ bucketKeys: [k1, k2] });
  await w.removal.released([k1, k2]);
  w.clock.t += GRACE_MS;
  w.failReferences(Object.assign(new Error("connection reset"), { name: "MongoNetworkError" }));
  await w.removal.sweep();
  assert.equal(w.bucket.calls.remove.length, 0);
  assert.deepEqual([...w.queue.rows.values()].map((row) => row.attempts), [1, 1]);
});

test("the backoff doubles up to a day; a claimed item is not taken by a second run before its lease ends", async () => {
  assert.equal(retryDelay(1), RETRY_MS);
  assert.equal(retryDelay(2), RETRY_MS * 2);
  assert.equal(retryDelay(40), MAX_RETRY_MS);
  const queue = memoryQueue();
  await queue.put({ _id: "file:x", kind: "file", key: "x", dueAt: 0, attempts: 0 });
  assert.equal((await queue.claim({ at: 10, limit: 5, leaseMs: LEASE_MS })).length, 1);
  assert.equal((await queue.claim({ at: 11, limit: 5, leaseMs: LEASE_MS })).length, 0);
  assert.equal((await queue.claim({ at: 10 + LEASE_MS, limit: 5, leaseMs: LEASE_MS })).length, 1);
  assert.deepEqual(failureOf({ name: "X", code: "ECONNRESET", message: "secret" }), { name: "X", code: "ECONNRESET" });
});

// ---- a removed account's uploads ---------------------------------------------------------------

test("a removed account's uploads are listed day by day (u_<id>_ in the name) and removed at once", async () => {
  const created = new Date(2026, 10, 18, 9).getTime();
  const mine = [key(ALICE, 1, new Date(2026, 10, 18, 10)), key(ALICE, 2, new Date(2026, 10, 20)), key(ALICE, 3, new Date(2026, 10, 20)), key(ALICE, 4, new Date(2026, 10, 20)), uploadKey(ALICE, id(5), "png", new Date(2026, 10, 27, 11))];
  const theirs = [key(BOB, 9, new Date(2026, 10, 20))];
  const other = ["2026/11/20/preview_1.png", `2026/11/20/u_${ALICE}_short.jpg`];
  const w = world({ bucketKeys: [...mine, ...theirs, ...other] });
  await w.removal.accountRemoved({ userId: ALICE, createdAt: new Date(created) });
  await w.removal.sweep();
  assert.deepEqual(w.bucket.calls.remove.sort(), [...mine].sort());
  assert.deepEqual([...w.bucket.objects].sort(), [...theirs, ...other].sort());
  // one prefix per day folder, from the day before the account was made to the day after today
  assert.equal(w.bucket.calls.list.filter((p) => p === `2026/11/20/u_${ALICE}_`).length, 2, "two pages of two keys");
  assert.ok(w.bucket.calls.list.includes(`2026/11/17/u_${ALICE}_`));
  assert.ok(w.bucket.calls.list.includes(`2026/11/28/u_${ALICE}_`));
  // and the agent's pictures by day, a presentation's copied pictures by UTC month: nothing else
  assert.ok(w.bucket.calls.list.includes(`2026/11/20/ai_${ALICE}_`));
  assert.ok(w.bucket.calls.list.includes(`2026/11/presentation_${ALICE}_`));
  assert.ok(w.bucket.calls.list.every((p) => new RegExp(`^(\\d{4}/\\d{2}/\\d{2}/(u|ai)|\\d{4}/\\d{2}/presentation)_${ALICE}_$`).test(p)), "only this person's names");
  assert.equal(w.queue.rows.size, 0);
  assert.deepEqual(w.logs.at(-1), { message: "account uploads removed", details: { removed: 5, kept: 0 } });
});

test("an account's upload another slate still shows is kept, checked again after the grace period", async () => {
  const shown = key(ALICE, 1);
  const alone = key(ALICE, 2);
  const w = world({ bucketKeys: [shown, alone], docs: { slates: [{ _id: "bobs-copy", userId: BOB, nodes: [photoNote("a", shown)] }] } });
  await w.removal.accountRemoved({ userId: ALICE, createdAt: new Date(2026, 10, 19) });
  await w.removal.sweep();
  assert.deepEqual([...w.bucket.objects], [shown]);
  assert.ok(w.queue.rows.has(`file:${shown}`));
  // Bob deletes his copy; at the recheck nothing names it
  w.db.slates.length = 0;
  w.clock.t += GRACE_MS;
  await w.removal.sweep();
  assert.equal(w.bucket.objects.size, 0);
});

test("queuing an account removal never touches the file store, and a store that is down is retried", async () => {
  const k = key(ALICE, 1);
  const w = world({ bucketKeys: [k] });
  w.bucket.fail(Object.assign(new Error("socket hang up"), { name: "TimeoutError" }));
  // the removal itself only queues: it answers even with the store down
  await w.removal.accountRemoved({ userId: ALICE, createdAt: new Date(2026, 10, 19) });
  assert.equal(w.bucket.calls.list.length, 0);
  await w.removal.sweep();
  const row = w.queue.rows.get(`account:${ALICE}`);
  assert.equal(row.attempts, 1);
  assert.deepEqual(row.failure, { name: "TimeoutError" });
  w.bucket.heal();
  w.clock.t += RETRY_MS;
  await w.removal.sweep();
  assert.equal(w.bucket.objects.size, 0);
  assert.equal(w.queue.rows.size, 0);
  // nothing for a missing id
  await w.removal.accountRemoved({ userId: "" });
  assert.equal(w.queue.rows.size, 0);
});

test("day folders cover the day before and after, once each", () => {
  const folders = dayFoldersBetween(new Date(2026, 10, 30, 23, 59), new Date(2026, 11, 2, 0, 1), dateFolder);
  assert.deepEqual(folders, ["2026/11/29", "2026/11/30", "2026/12/01", "2026/12/02", "2026/12/03"]);
});

// ---- the agent's pictures and a presentation's copied pictures --------------------------------

const aiKey = (user, n, day = new Date(2026, 10, 20, 12)) => `${dateFolder(day)}/ai_${user}_${id(n)}.png`;
const deckKey = (user, n, year = 2026, month = 11) => `${year}/${String(month).padStart(2, "0")}/presentation_${user}_${id(n)}.jpg`;

test("the agent's pictures and a presentation's copied pictures are read, released and kept like uploads", async () => {
  const a = aiKey(ALICE, 1);
  const p = deckKey(ALICE, 2);
  assert.deepEqual([...uploadKeysIn({ nodes: [photoNote("n", a)], deck: JSON.stringify({ img: url(p).replace(/\//g, "\\/") }) })].sort(), [a, p].sort());
  assert.deepEqual(releasedUploadKeys({ nodes: [photoNote("n", a)] }, { nodes: [] }), [a]);
  assert.equal(accountFileKeyFor(a, ALICE), a);
  assert.equal(accountFileKeyFor(p, ALICE), p);
  assert.equal(accountFileKeyFor(a, BOB), null);
  assert.equal(accountFileKeyFor(`2026/11/20/ai_${ALICE}_short.png`, ALICE), null);
  assert.equal(accountFileKeyFor(`2026/11/20/presentation_${ALICE}_${id(3)}.jpg`, ALICE), null, "a presentation's picture is in a month folder");
  // a presentation that still shows it keeps it
  const w = world({ bucketKeys: [a, p], docs: { slatePresentations: [{ _id: "deck", presentationData: JSON.stringify({ nodes: [photoNote("x", a), photoNote("y", p)] }) }] } });
  await w.removal.released([a, p]);
  w.clock.t += GRACE_MS;
  await w.removal.sweep();
  assert.equal(w.bucket.objects.size, 2);
  w.db.slatePresentations.length = 0;
  await w.removal.released([a, p]);
  w.clock.t += GRACE_MS;
  await w.removal.sweep();
  assert.equal(w.bucket.objects.size, 0);
});

test("a removed account's agent pictures and presentation pictures go with it; anyone else's stay", async () => {
  const mine = [aiKey(ALICE, 1, new Date(2026, 10, 19, 8)), aiKey(ALICE, 2), deckKey(ALICE, 3), deckKey(ALICE, 4, 2026, 10)];
  const theirs = [aiKey(BOB, 5), deckKey(BOB, 6)];
  const shown = aiKey(ALICE, 7);
  const w = world({ bucketKeys: [...mine, ...theirs, shown], docs: { slates: [{ _id: "bobs", userId: BOB, nodes: [photoNote("a", shown)] }] } });
  // made on the last day of October (UTC): October's month folder is listed too
  await w.removal.accountRemoved({ userId: ALICE, createdAt: new Date(Date.UTC(2026, 9, 31, 12)) });
  await w.removal.sweep();
  assert.deepEqual(w.bucket.calls.remove.sort(), [...mine].sort());
  assert.deepEqual([...w.bucket.objects].sort(), [...theirs, shown].sort());
  assert.ok(w.queue.rows.has(`file:${shown}`), "the one Bob's slate shows is checked again later");
});

test("month folders are UTC months, from the day before to the day after, once each", () => {
  assert.deepEqual(monthFoldersBetween(Date.UTC(2026, 10, 1, 1), Date.UTC(2026, 11, 31, 1)), ["2026/10", "2026/11", "2026/12", "2027/01"]);
  assert.deepEqual(monthFoldersBetween(Date.UTC(2026, 10, 15), Date.UTC(2026, 10, 16)), ["2026/11"]);
  const prefixes = accountPrefixes({ userId: ALICE, since: new Date(2026, 10, 20, 12), until: new Date(2026, 10, 20, 12), dateFolder });
  assert.deepEqual(prefixes.filter((p) => p.includes("presentation_")), [`2026/11/presentation_${ALICE}_`]);
  assert.equal(prefixes.filter((p) => p.includes("/u_")).length, 3);
  assert.equal(prefixes.filter((p) => p.includes("/ai_")).length, 3);
});

test("a file released again while a run holds it keeps its new wait", async () => {
  const k = key(ALICE, 8);
  const w = world({ bucketKeys: [k], docs: { slates: [{ _id: "s1", nodes: [photoNote("a", k)] }] } });
  await w.removal.released([k]);
  w.clock.t += GRACE_MS;
  // during the run's reference check, the slate stops showing it and the save releases it again
  const claimed = await w.queue.claim({ at: w.clock.t, limit: 5, leaseMs: LEASE_MS });
  await w.removal.released([k]);
  await w.queue.done(claimed[0]);
  assert.equal(w.queue.rows.get(`file:${k}`)?.dueAt, w.clock.t + GRACE_MS, "the new release is not dropped");
  await w.queue.later(claimed[0], { dueAt: 0, attempts: 1 });
  assert.equal(w.queue.rows.get(`file:${k}`).dueAt, w.clock.t + GRACE_MS, "nor moved by the old run's retry");
});

// ---- the wiring ---------------------------------------------------------------------------------

const app = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), "utf8");

test("every path that removes a saved account removes its uploads after the account, and its snapshots", () => {
  const paths = {
    "server/methods/users.js": ["Meteor.users.removeAsync({ _id: user._id })", "await removeUploadsOfAccount(user)", "await SlateSnapshots.removeAsync(owner)"],
    "server/methods/organizations.js": ["Meteor.users.removeAsync({ _id: user._id })", "await removeUploadsOfAccount(user)", "await SlateSnapshots.removeAsync({ userId: user._id })"],
    "server/methods/team-member-slates.js": ["Meteor.users.removeAsync({ _id: memberId, orgId })", "await removeUploadsOfAccount(removed)", "await SlateSnapshots.removeAsync({ userId: memberId })"],
  };
  for (const [file, [removal, uploads, snapshots]] of Object.entries(paths)) {
    const text = app(file);
    assert.match(text, /import \{ releaseUploadsOfSlates, removeUploadsOfAccount \} from '\.\.\/upload-removal'/, file);
    assert.ok(text.indexOf(uploads) > text.indexOf(removal) && text.indexOf(removal) > 0, `${file}: uploads go after the account`);
    assert.ok(text.includes(snapshots), `${file}: snapshots`);
    assert.ok(text.indexOf("await releaseUploadsOfSlates(") < text.indexOf("await Slates.removeAsync("), `${file}: slates read before they go`);
  }
  // queuing never throws and never waits on the store
  const glue = app("server/upload-removal.js");
  assert.match(glue, /export async function removeUploadsOfAccount\(user\) \{\n  try \{/);
  assert.match(glue, /Meteor\.defer\(\(\) => \{ sweepSoon\(\) \}\)/);
  assert.match(glue, /Meteor\.setInterval\(sweepSoon, 60 \* 60 \* 1000\)/);
  // the queue and the stored files are not read as references; everything else is
  assert.match(glue, /'uploadRemovals'/);
  assert.match(glue, /'files\.files', 'files\.chunks'/);
});

test("every account removal removes the account's tokens, presentations, AI keys and passkeys", () => {
  const rows = app("server/methods/account-rows.js");
  for (const line of [
    "await JoinedSlates.removeAsync(userId)", "await SlateApiTokens.removeAsync(owner)", "await SlateOperationRuns.removeAsync(owner)",
    "await SlatePresentations.removeAsync(owner)", "await SlatePresentationConversations.removeAsync(owner)",
    "await ProviderKeys.removeAsync({ ownerType: 'user', ownerId: userId })", "await AIChoices.removeAsync({ _id: 'user:' + userId })",
    "await removePasskeysOf(userId)",
  ]) assert.ok(rows.includes(line), line);
  for (const [file, call, removal] of [
    ["server/methods/organizations.js", "await removeAccountRows(user._id)", "Meteor.users.removeAsync({ _id: user._id })"],
    ["server/methods/team-member-slates.js", "await removeAccountRows(memberId)", "Meteor.users.removeAsync({ _id: memberId, orgId })"],
  ]) {
    const text = app(file);
    assert.match(text, /import \{ removeAccountRows \} from '\.\/account-rows'/, file);
    assert.ok(text.indexOf(call) > 0 && text.indexOf(call) < text.indexOf(removal), `${file}: before the account goes`);
  }
  // deleting a team removes every slate of the owner's, inside the team and out (Team settings lists both)
  const org = app("server/methods/organizations.js");
  assert.ok(org.includes("await releaseUploadsOfSlates({ userId: user._id })"));
  assert.ok(org.includes("await Slates.removeAsync({ userId: user._id })"));
  // users.delete keeps its own list: every presentation, not only a workshop's
  const users = app("server/methods/users.js");
  assert.ok(users.includes("await SlatePresentations.removeAsync(owner)"));
  assert.ok(users.includes("await SlatePresentationConversations.removeAsync(owner)"));
});

test("both save cores release deleted notes' files, and a deleted slate releases its pictures", () => {
  const save = app("server/slate-save.js");
  assert.equal(save.match(/onReleased: \(keys\) => releaseUploads\(keys\)/g)?.length, 2);
  const slates = app("server/methods/slates.js");
  const del = slates.slice(slates.indexOf("export async function deleteOwnedSlate"));
  assert.ok(del.indexOf("await releaseUploadsOfSlates({ _id: slate._id })") < del.indexOf("await Slates.removeAsync({ _id: slate._id })"));
  // a removed upload or team logo is released, never deleted at once: a slate that shows it keeps it
  const images = app("server/methods/images.js");
  const remove = images.slice(images.indexOf("async function removeImage"), images.indexOf("async function removeImage") + 400);
  assert.ok(remove.includes("await releaseUploads([key])") && !remove.includes("deleteStoredFile"), "images.removeImage releases");
  // the bucket's listing is the tested one
  assert.match(app("server/common/s3Utils.js"), /return pagedKeys\(\(ContinuationToken\) => sendS3\(new ListObjectsV2Command\(\{ Bucket, Prefix: prefix, ContinuationToken \}\)\)\)/);
  assert.match(app("server/common/fileStore.js"), /return bucketUploadsOf\(\{ userId, since: since \?\? FIRST_UPLOAD_DAY, until: Date\.now\(\), listPrefix: listS3Keys, dateFolder \}\)/);
  // a self-host's database files: the same three names, filtered by the same rule
  const store = app("server/common/fileStore.js");
  assert.match(store, /\(\?:u\|ai\)\|presentation\)_\$\{userId\}_/);
  assert.match(store, /\.filter\(\(key\) => accountFileKeyFor\(key, userId\)\)/);
});

// ---- the CDN in front of the bucket (2026-11-28: a deleted photo stayed public at files.slatebox.com, a
// CloudFront distribution, for as long as its cached copy lived: no Cache-Control, no invalidation) ----

// A CloudFront that records each CreateInvalidation, and a switch to make it fail.
function mockCloudFront() {
  const calls = [];
  let failing = null;
  return {
    calls,
    fail(error) { failing = error; },
    send: async (input) => {
      if (failing) throw failing;
      calls.push(structuredClone(input));
      return { Invalidation: { Id: `I${calls.length}`, Status: "InProgress" } };
    },
  };
}

test("the distribution comes from aws.cloudFrontDistributionId; a CDN path keeps cloudUrl's own path", () => {
  assert.equal(cdnDistributionOf({ aws: { cloudFrontDistributionId: " E2ABC3DEF4GHIJ " } }), "E2ABC3DEF4GHIJ");
  for (const settings of [{}, { aws: {} }, { aws: { cloudFrontDistributionId: "" } }, { aws: { cloudFrontDistributionId: "not an id" } }, { aws: { cloudFrontDistributionId: 7 } }]) {
    assert.equal(cdnDistributionOf(settings), null, JSON.stringify(settings));
  }
  const k = key(ALICE, 1);
  assert.equal(cdnPathOf(k, FILES), `/${k}`);
  assert.equal(cdnPathOf(k, `${FILES}/`), `/${k}`);
  assert.equal(cdnPathOf(k, "https://cdn.example/files/"), `/files/${k}`);
  assert.equal(UPLOAD_CACHE_CONTROL, "public, max-age=86400");
});

test("a released file the sweep removes is dropped from the CDN; one still named is not", async () => {
  const gone = key(ALICE, 1);
  const kept = key(ALICE, 2);
  const cf = mockCloudFront();
  const cdn = createCdnInvalidator({ distributionId: "E2ABC3DEF4GHIJ", cloudUrl: FILES, send: cf.send, now: () => 1795800000000 });
  const w = world({ bucketKeys: [gone, kept], docs: { slates: [{ _id: "s", nodes: [photoNote("n", kept)] }] }, cdn });
  await w.removal.released([gone, kept]);
  w.clock.t += GRACE_MS;
  await w.removal.sweep();
  assert.deepEqual([...w.bucket.objects], [kept]);
  assert.equal(cf.calls.length, 1);
  const [call] = cf.calls;
  assert.equal(call.DistributionId, "E2ABC3DEF4GHIJ");
  assert.deepEqual(call.InvalidationBatch.Paths, { Quantity: 1, Items: [`/${gone}`] });
  assert.match(call.InvalidationBatch.CallerReference, /^slatebox-removal-1795800000000-[0-9a-f]{8}-\d+$/);
  // nothing removed: nothing asked
  await w.removal.released([kept]);
  w.clock.t += GRACE_MS;
  await w.removal.sweep();
  assert.equal(cf.calls.length, 1);
});

test("a removed account's files are dropped from the CDN in batches, each with its own reference", async () => {
  const mine = Array.from({ length: 5 }, (_, n) => key(ALICE, n + 1));
  const cf = mockCloudFront();
  const cdn = createCdnInvalidator({ distributionId: "E2ABC3DEF4GHIJ", cloudUrl: FILES, send: cf.send, perRequest: 2 });
  const w = world({ bucketKeys: [...mine, key(BOB, 9)], cdn });
  await w.removal.accountRemoved({ userId: ALICE, createdAt: new Date(2026, 10, 18) });
  await w.removal.sweep();
  assert.deepEqual(cf.calls.map((c) => c.InvalidationBatch.Paths.Quantity), [2, 2, 1]);
  assert.deepEqual(cf.calls.flatMap((c) => c.InvalidationBatch.Paths.Items).sort(), mine.map((k) => `/${k}`).sort());
  assert.equal(new Set(cf.calls.map((c) => c.InvalidationBatch.CallerReference)).size, 3, "CloudFront takes each reference once");
  assert.ok(PATHS_PER_INVALIDATION <= 3000, "CloudFront's limit on file paths in progress");
});

test("a CDN that fails never fails the removal: logged without a key or path, not retried", async () => {
  const k = key(ALICE, 1);
  const cf = mockCloudFront();
  cf.fail(Object.assign(new Error(`AccessDenied for /${k}`), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }));
  const logs = [];
  const cdn = createCdnInvalidator({ distributionId: "E2ABC3DEF4GHIJ", cloudUrl: FILES, send: cf.send, log: (message, details) => logs.push({ message, details }) });
  const w = world({ bucketKeys: [k], cdn });
  await w.removal.released([k]);
  w.clock.t += GRACE_MS;
  await w.removal.sweep();
  assert.equal(w.bucket.objects.has(k), false, "removed from the bucket");
  assert.equal(w.queue.rows.size, 0, "done, not retried");
  assert.deepEqual(logs, [{ message: "CDN invalidation failed; the cached copies expire within a day", details: { paths: 1, name: "AccessDenied", status: 403 } }]);
  assert.doesNotMatch(JSON.stringify([...logs, ...w.logs]), /R0000|u_A111/);
  // a CDN object that throws outright is caught by the queue as well
  const w2 = world({ bucketKeys: [k], cdn: { invalidate: async () => { throw new Error(k); } } });
  await w2.removal.released([k]);
  w2.clock.t += GRACE_MS;
  await w2.removal.sweep();
  assert.equal(w2.queue.rows.size, 0);
  assert.doesNotMatch(JSON.stringify(w2.logs), /R0000/);
});

test("without a distribution nothing is asked; a removal failing part way still drops what went", async () => {
  const cf = mockCloudFront();
  const none = createCdnInvalidator({ distributionId: null, cloudUrl: FILES, send: cf.send });
  assert.equal(await none.invalidate([key(ALICE, 1)]), 0);
  assert.equal(cf.calls.length, 0);
  // the account's second removal fails: the first is dropped from the CDN now, the rest retried
  const mine = [key(ALICE, 1), key(ALICE, 2)];
  const cdn = createCdnInvalidator({ distributionId: "E2ABC3DEF4GHIJ", cloudUrl: FILES, send: cf.send });
  const w = world({ bucketKeys: mine, cdn });
  const remove = w.bucket.files.remove;
  let n = 0;
  w.bucket.files.remove = async (k) => { if (++n === 2) throw Object.assign(new Error("down"), { name: "ServiceUnavailable" }); return remove(k); };
  await w.removal.accountRemoved({ userId: ALICE, createdAt: new Date(2026, 10, 18) });
  await w.removal.sweep();
  assert.equal(cf.calls.length, 1);
  assert.equal(cf.calls[0].InvalidationBatch.Paths.Quantity, 1);
  assert.equal(w.queue.rows.size, 1, "the account is retried");
});

test("the app wires the CDN from the settings, only with files in the bucket, and every bucket upload carries Cache-Control", () => {
  const glue = app("server/upload-removal.js");
  assert.match(glue, /const cdnConfig = storedFileCdn\(\)\nconst cdn = cdnConfig \? createCdnInvalidator\(\{ \.\.\.cdnConfig, log \}\) : null/);
  assert.match(glue, /\n  cdn,\n/);
  const store = app("server/common/fileStore.js");
  assert.match(store, /const distributionId = inBucket\(\) \? cdnDistributionOf\(Meteor\.settings\) : null/);
  assert.match(store, /\{ distributionId, cloudUrl: storedFileBase\(\), send: createCloudFrontInvalidation \}/);
  const s3 = app("server/common/s3Utils.js");
  const put = s3.slice(s3.indexOf("export async function putS3Object"), s3.indexOf("export async function deleteS3Object"));
  assert.match(put, /CacheControl: UPLOAD_CACHE_CONTROL,/);
  assert.match(s3, /new CreateInvalidationCommand\(input\)/);
  assert.equal(JSON.parse(app("settings.example.json")).aws.cloudFrontDistributionId, "");
});

// 2026-11-28, on test.slatebox.com: users.delete left the account's own personal-token suggestion
// (a photo it kept: the action stays for undo) on its deleted slate, and its photo address held the
// file in the store until the suggestion expired.
test("deleting slates removes every agent's suggestions on them, kept or waiting; other slates' stay", async () => {
  const k = key(ALICE, 1);
  const suggestions = memoryCollection();
  const controls = memoryCollection();
  const action = (id, slateId, ownerId, state) => ({ _id: id, slateId, ownerId, agentId: "token:t1", items: [{ id: "i", kind: "add", state, nodeId: "n", node: photoNote("n", k) }] });
  await suggestions.insertOne(action("kept", "aliceSlate", ALICE, "kept"));
  await suggestions.insertOne(action("waiting", "aliceSlate", BOB, "pending"));
  await suggestions.insertOne(action("elsewhere", "bobSlate", BOB, "pending"));
  await controls.insertOne({ _id: "aliceSlate", paused: true });
  await controls.insertOne({ _id: "bobSlate", paused: false });
  // before: the suggestion keeps the deleted slate's photo in the store
  const before = world({ bucketKeys: [k], docs: { agentSuggestions: [...suggestions.docs.values()].filter((d) => d.slateId === "aliceSlate") } });
  await before.removal.accountRemoved({ userId: ALICE, createdAt: new Date(2026, 10, 18) });
  await before.removal.sweep();
  assert.ok(before.bucket.objects.has(k), "held by the suggestion");

  assert.deepEqual(await removeSuggestionsOn(["aliceSlate", "aliceSlate", null], { suggestions, controls }), { removed: 2 });
  assert.deepEqual([...suggestions.docs.keys()], ["elsewhere"]);
  assert.deepEqual([...controls.docs.keys()], ["bobSlate"]);
  assert.deepEqual(await removeSuggestionsOn([], { suggestions, controls }), { removed: 0 });
  // after: nothing names the photo, so the account's removal removes it at once
  const after = world({ bucketKeys: [k], docs: { agentSuggestions: [...suggestions.docs.values()].filter((d) => d.slateId === "aliceSlate") } });
  await after.removal.accountRemoved({ userId: ALICE, createdAt: new Date(2026, 10, 18) });
  await after.removal.sweep();
  assert.equal(after.bucket.objects.has(k), false);
});

test("every path that deletes slates removes their suggestions first", () => {
  const paths = {
    "server/methods/users.js": ["await removeSuggestionsOfSlates(owner)", "await Slates.removeAsync(owner)"],
    "server/methods/organizations.js": ["await removeSuggestionsOfSlates({ userId: user._id })", "await Slates.removeAsync({ userId: user._id })"],
    "server/methods/team-member-slates.js": ["await removeSuggestionsOfSlates({ _id: { $in: ids } })", "await Slates.removeAsync({ _id: { $in: ids } })"],
    "server/methods/slates.js": ["await removeSuggestionsOfSlates({ _id: slate._id })", "await Slates.removeAsync({ _id: slate._id })"],
  };
  for (const [file, [suggestions, slates]] of Object.entries(paths)) {
    const text = app(file);
    assert.match(text, /import \{ removeSuggestionsOfSlates \} from '\.\.\/agents\/suggestions-removal'/, file);
    assert.ok(text.indexOf(suggestions) > 0 && text.indexOf(suggestions) < text.indexOf(slates), `${file}: suggestions before the slates go`);
  }
  // only the collections: no action layer (suggestions-meteor.js loads server/actions/mount)
  const glue = app("server/agents/suggestions-removal.js");
  assert.deepEqual(glue.match(/^import .* from '([^']+)'$/gm).map((line) => line.replace(/.* from /, "")), ["'meteor/mongo'", "'../../imports/api/common/models'", "'./suggestions.mjs'"]);
  assert.match(glue, /return removeSuggestionsOn\(ids, \{ suggestions: AgentSuggestions\.rawCollection\(\), controls: controls\(\) \}\)/);
});
