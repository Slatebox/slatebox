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
  bucketUploadsOf,
  createUploadRemoval,
  dayFoldersBetween,
  failureOf,
  GRACE_MS,
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
    async done(itemId) { rows.delete(itemId); },
    async later(itemId, change) { Object.assign(rows.get(itemId), change); },
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
      listUploadsOf: (userId, since) => bucketUploadsOf({ userId, since: since ?? Date.UTC(2026, 10, 1), until: clockNow(), listPrefix, dateFolder, uploadKeyFor }),
      remove: (k) => send({ type: "DeleteObject", Key: k }),
    },
  };
}

let clockNow = () => Date.now();

// The database the reference check reads: named collections of documents.
function world({ docs = {}, bucketKeys = [], start = new Date(2026, 10, 27, 12).getTime() } = {}) {
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
  assert.ok(w.bucket.calls.list.every((p) => p.endsWith(`/u_${ALICE}_`)));
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

test("both save cores release deleted notes' files, and a deleted slate releases its pictures", () => {
  const save = app("server/slate-save.js");
  assert.equal(save.match(/onReleased: \(keys\) => releaseUploads\(keys\)/g)?.length, 2);
  const slates = app("server/methods/slates.js");
  const del = slates.slice(slates.indexOf("export async function deleteOwnedSlate"));
  assert.ok(del.indexOf("await releaseUploadsOfSlates({ _id: slate._id })") < del.indexOf("await Slates.removeAsync({ _id: slate._id })"));
  // the bucket's listing is the tested one
  assert.match(app("server/common/s3Utils.js"), /return pagedKeys\(\(ContinuationToken\) => sendS3\(new ListObjectsV2Command\(\{ Bucket, Prefix: prefix, ContinuationToken \}\)\)\)/);
  assert.match(app("server/common/fileStore.js"), /return bucketUploadsOf\(\{ userId, since: since \?\? FIRST_UPLOAD_DAY, until: Date\.now\(\), listPrefix: listS3Keys, dateFolder, uploadKeyFor \}\)/);
});
