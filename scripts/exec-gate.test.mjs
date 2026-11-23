// The exec gate on its own: the script rules, against the real registry and an in-memory
// database. No runner: each test plays the calls a script would make.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { deriveKey } from "../web/app/server/exec/keys.mjs";
import { makeExecWorld } from "./exec-test-world.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

async function setup(t, options) {
  const world = makeExecWorld(options);
  current = world;
  t.after(() => world.close());
  const principal = await world.principalFor(["slates:read", "slates:write", "slates:share"]);
  const gate = world.exec.gate;
  const context = (extra = {}) =>
    gate.newContext({ execId: uuid(), principal, surface: "api", codeSha256: sha("code"), intent: "test", ...extra });
  const confirmFor = async (ctx, execId) => {
    const claimed = await world.exec.store.claimConfirmation({ id: ctx.held.id, subject: principal.tokenId, codeSha256: sha("code"), execId });
    return { id: ctx.held.id, fingerprints: claimed.fingerprints, used: new Set() };
  };
  return { world, principal, gate, context, confirmFor };
}

// Every canvas edit names the revision it was made on (required since release/agentic): the
// helpers send the slate's current revision.
let current;
const revisionOf = (shareId) => current.slate(shareId)?.revision ?? 0;
const add = (shareId, text = "Added") => ({ shareId, expectedRevision: revisionOf(shareId), plan: { message: "Add", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text }] } });
const rename = (shareId, ids, text = "Renamed") => ({
  shareId,
  expectedRevision: revisionOf(shareId),
  plan: { message: "Rename", operations: ids.map((id) => ({ kind: "update_nodes", target: { ids: [id] }, changes: { text: `${text} ${id}` } })) },
});

test("derived keys: 'x' + 40 hex of sha256(subject \\n execKey) + ':' + n", () => {
  const prefix = "x" + sha("tok_a\nk1").slice(0, 40);
  assert.equal(deriveKey("tok_a", "k1", 3), prefix + ":3");
  assert.equal(deriveKey("tok_a", "k1", 4), prefix + ":4");
  assert.ok(deriveKey("tok_a", "k".repeat(128), 999999).length <= 128);
  assert.match(deriveKey("tok_a", "k1", 3), /^[!-~]{1,128}$/);
  assert.notEqual(deriveKey("tok_b", "k1", 3), deriveKey("tok_a", "k1", 3));
});

test("a preview run previews every write and stops at a write that cannot preview", async (t) => {
  const { world, gate, context } = await setup(t);
  const ctx = context({ mode: "preview" });
  const previewed = await gate.call(ctx, { seq: 1, method: "slates.applyOperations", input: add("demo") });
  assert.equal(previewed.ok, true);
  assert.equal(previewed.value.mode, "preview");
  assert.equal(world.slate("demo").nodes.length, 2, "nothing saved");
  const create = await gate.call(ctx, { seq: 2, method: "slates.create", input: { kind: "diagram", brief: "A → B" } });
  assert.equal(create.error.code, "preview_unavailable");
  assert.deepEqual(create.error.details, { method: "slates.create" });
  assert.equal(world.created.length, 0);
  assert.deepEqual(ctx.calls.map((c) => [c.n, c.mode, c.ok]), [[1, "preview", true], [2, null, false]]);
});

test("unknown methods, token management and non-plain inputs are refused before the registry", async (t) => {
  const { gate, context } = await setup(t);
  const ctx = context();
  assert.equal((await gate.call(ctx, { seq: 1, method: "apiTokens.list", input: {} })).error.code, "unknown_method");
  assert.equal((await gate.call(ctx, { seq: 2, method: "apiTokens.create", input: {} })).error.code, "unknown_method");
  assert.equal((await gate.call(ctx, { seq: 3, method: "exec.run", input: {} })).error.code, "unknown_method");
  assert.equal((await gate.call(ctx, { seq: 4, method: "slates.get", input: ["demo"] })).error.code, "invalid_request");
  assert.equal((await gate.call(ctx, { seq: 5, method: "slates.get", input: { shareId: "demo", extra: 1 } })).error.code, "invalid_request");
});

test("an in-app run writes only to its own slate", async (t) => {
  const { world, gate, context } = await setup(t);
  const ctx = context({ writableShareIds: ["demo"] });
  const away = await gate.call(ctx, { seq: 1, method: "slates.applyOperations", input: add("many") });
  assert.equal(away.error.code, "out_of_scope");
  assert.equal(away.error.status, 403);
  assert.equal((await gate.call(ctx, { seq: 2, method: "slates.create", input: { kind: "diagram", brief: "A" } })).error.code, "out_of_scope");
  assert.equal((await gate.call(ctx, { seq: 3, method: "slates.get", input: { shareId: "many" } })).ok, true, "reads stay open");
  assert.equal((await gate.call(ctx, { seq: 4, method: "slates.applyOperations", input: add("demo") })).ok, true);
  assert.equal(world.slate("many").nodes.length, 14);
});

test("a save that deletes notes is held; confirming releases exactly that call, once", async (t) => {
  const { world, gate, context, confirmFor } = await setup(t);
  const remove = { shareId: "demo", expectedRevision: revisionOf("demo"), plan: { message: "Remove", operations: [{ kind: "delete_nodes", target: { ids: ["second"] } }] } };
  const first = context({ execKey: "run-1" });
  const added = await gate.call(first, { seq: 1, method: "slates.applyOperations", input: add("demo", "Kept") });
  assert.equal(added.ok, true);
  const held = await gate.call(first, { seq: 2, method: "slates.applyOperations", input: remove });
  assert.equal(held.error.code, "confirmation_required");
  assert.equal(held.error.status, 409);
  assert.deepEqual(held.error.details.reasons, [{ rule: "removes", shareId: "demo", count: 1 }]);
  assert.match(held.error.details.confirmationId, /^cf_[A-Za-z0-9]{24}$/);
  assert.equal(world.slate("demo").nodes.length, 3, "the add saved, the delete did not");
  assert.equal(first.calls[1].held, true);
  assert.deepEqual(first.held.reasons, [{ n: 2, rule: "removes", shareId: "demo", count: 1 }]);

  // The same code with confirm and the same key: call 1 replays, call 2 saves.
  const again = context({ execKey: "run-1" });
  again.confirmation = await confirmFor(first, again.execId);
  const replayed = await gate.call(again, { seq: 1, method: "slates.applyOperations", input: add("demo", "Kept") });
  assert.equal(replayed.ok, true);
  assert.equal(again.calls[0].replayed, true);
  const saved = await gate.call(again, { seq: 2, method: "slates.applyOperations", input: remove });
  assert.equal(saved.ok, true);
  assert.equal(world.slate("demo").nodes.length, 2);
  assert.equal(world.slate("demo").nodes.some((node) => node.options.id === "second"), false);
  // The confirmation covered that one call: another delete in the same run is held again.
  const more = await gate.call(again, { seq: 3, method: "slates.applyOperations", input: { shareId: "demo", expectedRevision: revisionOf("demo"), plan: { message: "Remove", operations: [{ kind: "delete_nodes", target: { ids: ["welcome"] } }] } } });
  assert.equal(more.error.code, "confirmation_required");
  assert.notEqual(more.error.details.confirmationId, first.held.id);
  // And it is single-use: another run cannot present it.
  await assert.rejects(
    world.exec.store.claimConfirmation({ id: first.held.id, subject: again.subject, codeSha256: sha("code"), execId: uuid() }),
    { code: "confirmation_invalid", status: 409 },
  );
});

test("rewriting more than 10 notes' text in one script is held; 10 save", async (t) => {
  const { world, gate, context } = await setup(t);
  const ids = world.slate("many").nodes.map((node) => node.options.id);
  const ctx = context();
  const ten = await gate.call(ctx, { seq: 1, method: "slates.applyOperations", input: rename("many", ids.slice(0, 6)) });
  assert.equal(ten.ok, true);
  const next = await gate.call(ctx, { seq: 2, method: "slates.applyOperations", input: rename("many", ids.slice(6, 10)) });
  assert.equal(next.ok, true, "6 + 4 = 10 is allowed");
  const over = await gate.call(ctx, { seq: 3, method: "slates.applyOperations", input: rename("many", ids.slice(10, 11)) });
  assert.equal(over.error.code, "confirmation_required");
  assert.deepEqual(over.error.details.reasons, [{ rule: "rewrites_text", shareId: "many", count: 11 }]);
  assert.equal(world.slate("many").nodes[10].options.text, "Note 11");
  // Setting a note's text to what it already says is not a rewrite.
  const same = await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: { shareId: "many", expectedRevision: revisionOf("many"), plan: { message: "Same", operations: ids.slice(0, 11).map((id) => ({ kind: "update_nodes", target: { ids: [id] }, changes: { text: world.slate("many").nodes.find((x) => x.options.id === id).options.text } })) } } });
  assert.equal(same.ok, true);
});

test("changing someone else's notes is held; adding to their slate is not", async (t) => {
  const { world, gate, context } = await setup(t);
  const ctx = context();
  assert.equal((await gate.call(ctx, { seq: 1, method: "slates.applyOperations", input: add("theirs") })).ok, true);
  const changed = await gate.call(ctx, { seq: 2, method: "slates.applyOperations", input: rename("theirs", ["t1"]) });
  assert.equal(changed.error.code, "confirmation_required");
  assert.deepEqual(changed.error.details.reasons, [{ rule: "others_notes", shareId: "theirs", count: 1 }]);
  assert.equal(world.slate("theirs").nodes[0].options.text, "Their note");
});

test("saving to a slate more people can see than the slates the script read is held", async (t) => {
  const { world, gate, context } = await setup(t);
  const ctx = context();
  assert.equal((await gate.call(ctx, { seq: 1, method: "slates.get", input: { shareId: "demo" } })).ok, true);
  assert.equal(ctx.minReadRank, 0, "demo is private");
  const widened = await gate.call(ctx, { seq: 2, method: "slates.applyOperations", input: add("open", "Copied from demo") });
  assert.equal(widened.error.code, "confirmation_required");
  assert.deepEqual(widened.error.details.reasons, [{ rule: "widens_audience", shareId: "open" }]);
  assert.equal(world.slate("open").nodes.length, 1);
  // Writing back to the private slate is fine; so is writing to a public slate without reading.
  assert.equal((await gate.call(ctx, { seq: 3, method: "slates.applyOperations", input: add("demo") })).ok, true);
  assert.equal((await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: add("open") })).ok, true);
});

test("granting access and withdrawing an invitation are held", async (t) => {
  const { world, gate, context } = await setup(t);
  const ctx = context();
  const invite = await gate.call(ctx, { seq: 1, method: "slates.issueInvite", input: { shareId: "demo", role: "edit" } });
  assert.equal(invite.error.code, "confirmation_required");
  assert.deepEqual(invite.error.details.reasons, [{ rule: "widens_access", shareId: "demo" }]);
  const revoke = await gate.call(ctx, { seq: 2, method: "slates.revokeInvite", input: { shareId: "demo", inviteId: "b".repeat(32) } });
  assert.deepEqual(revoke.error.details.reasons, [{ rule: "removes", shareId: "demo" }]);
  assert.equal(world.invites.length, 0);
  assert.equal(revoke.error.details.confirmationId, invite.error.details.confirmationId, "one confirmation per run");
  assert.equal(ctx.held.reasons.length, 2);
});

test("a rerun that diverges gets 409 at that call and keeps what saved before it", async (t) => {
  const { world, gate, context } = await setup(t);
  const first = context({ execKey: "same" });
  assert.equal((await gate.call(first, { seq: 1, method: "slates.applyOperations", input: add("demo", "One") })).ok, true);
  assert.equal((await gate.call(first, { seq: 2, method: "slates.applyOperations", input: add("demo", "Two") })).ok, true);
  const rerun = context({ execKey: "same" });
  assert.equal((await gate.call(rerun, { seq: 1, method: "slates.applyOperations", input: add("demo", "One") })).ok, true);
  assert.equal(rerun.calls[0].replayed, true);
  const diverged = await gate.call(rerun, { seq: 2, method: "slates.applyOperations", input: add("demo", "Changed") });
  assert.equal(diverged.error.code, "idempotency_conflict");
  assert.equal(diverged.error.status, 409);
  assert.deepEqual(world.slate("demo").nodes.map((x) => x.options.text).slice(2), ["One", "Two"]);
});

// The owner's rule, applied by the release lead: the limit counts per script, over every slate
// the script writes to (it counted per slate).
test("the text-rewrite limit counts the whole script, across slates", async (t) => {
  const { world, gate, context } = await setup(t);
  const ids = world.slate("many").nodes.map((node) => node.options.id);
  const ctx = context();
  assert.equal((await gate.call(ctx, { seq: 1, method: "slates.applyOperations", input: rename("many", ids.slice(0, 10)) })).ok, true);
  const other = await gate.call(ctx, { seq: 2, method: "slates.applyOperations", input: rename("demo", ["second"]) });
  assert.equal(other.error.code, "confirmation_required");
  assert.deepEqual(other.error.details.reasons, [{ rule: "rewrites_text", shareId: "demo", count: 11 }]);
  assert.equal(world.slate("demo").nodes[1].options.text, "Second");
  // A new script starts again from none.
  assert.equal((await gate.call(context(), { seq: 1, method: "slates.applyOperations", input: rename("demo", ["second"]) })).ok, true);
});

test("caps: 64 calls, 200 plan operations and 200 new notes per script", async (t) => {
  const { world, gate, context } = await setup(t, { rateLimits: { perToken: 1000, perAccount: 1000, windowSeconds: 60 } });
  const ctx = context();
  for (let i = 1; i <= 64; i += 1) assert.equal((await gate.call(ctx, { seq: i, method: "slates.get", input: { shareId: "demo" } })).ok, true);
  const over = await gate.call(ctx, { seq: 65, method: "slates.get", input: { shareId: "demo" } });
  assert.equal(over.error.code, "call_limit");

  const ops = context();
  const fifty = { shareId: "many", expectedRevision: revisionOf("many"), plan: { message: "Arrange", operations: Array.from({ length: 50 }, () => ({ kind: "arrange_nodes", target: { all: true }, layout: "row" })) } };
  for (let i = 1; i <= 4; i += 1) assert.equal((await gate.call(ops, { seq: i, method: "slates.applyOperations", input: { ...fifty, mode: "preview" } })).ok, true);
  assert.equal((await gate.call(ops, { seq: 5, method: "slates.applyOperations", input: { ...fifty, mode: "preview" } })).error.code, "operation_limit");

  const notes = context();
  const twenty = { shareId: "demo", expectedRevision: revisionOf("demo"), plan: { message: "Add", operations: [{ kind: "add_nodes", count: 20, shape: "rectangle", text: "x" }] } };
  for (let i = 1; i <= 10; i += 1) assert.equal((await gate.call(notes, { seq: i, method: "slates.applyOperations", input: { ...twenty, mode: "preview" } })).ok, true, `call ${i}`);
  assert.equal((await gate.call(notes, { seq: 11, method: "slates.applyOperations", input: { ...twenty, mode: "preview" } })).error.code, "note_limit");
  assert.equal(world.slate("demo").nodes.length, 2);
});

test("every call is the caller's own: scope and slate access come from the registry", async (t) => {
  const { world, gate } = await setup(t);
  const reader = await world.principalFor(["slates:read"]);
  const ctx = gate.newContext({ execId: uuid(), principal: reader, surface: "api", codeSha256: sha("c"), intent: "i" });
  const denied = await gate.call(ctx, { seq: 1, method: "slates.applyOperations", input: add("demo") });
  assert.equal(denied.error.code, "insufficient_scope");
  const stranger = await world.principalFor(["slates:read", "slates:write"], "other");
  const theirs = gate.newContext({ execId: uuid(), principal: stranger, surface: "api", codeSha256: sha("c"), intent: "i" });
  assert.equal((await gate.call(theirs, { seq: 1, method: "slates.get", input: { shareId: "demo" } })).error.code, "forbidden");
});
