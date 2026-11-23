// POST /api/v1/exec and GET /api/v1/exec/{execId} on the in-memory app, and the
// Slatebox-Exec-* headers a local script's calls carry: the same gate decides both.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { EXEC_LIMITS } from "../web/app/server/exec/limits.mjs";
import { makeExecWorld } from "./exec-test-world.mjs";

const fast = { ...EXEC_LIMITS, cpuMs: 1500, wallMs: 8000 };
const sha = (text) => createHash("sha256").update(text).digest("hex");

async function setup(t, options = {}) {
  const world = makeExecWorld({ limits: fast, ...options });
  current = world;
  t.after(() => world.close());
  const call = await world.serve(t);
  const { token } = await world.mint();
  return { world, call, token };
}

// Every canvas edit names the revision it was made on (required since release/agentic): the
// helpers send the slate's current revision.
let current;
const revisionOf = (shareId) => current.slate(shareId)?.revision ?? 0;
const add = (text) => ({ shareId: "demo", expectedRevision: revisionOf("demo"), plan: { message: "Add", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text }] } });

test("POST /api/v1/exec answers 200 whenever the script ran, with its status", async (t) => {
  const { world, call, token } = await setup(t);
  const done = await call("/api/v1/exec", { token, method: "POST", body: { intent: "Count the notes", code: 'const s = await slatebox.slates.get({ shareId: "demo" }); return s.nodeCount' } });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, "completed");
  assert.equal(done.body.result, 2);
  assert.equal(done.body.mode, "save");
  assert.match(done.body.execId, /^[0-9a-f-]{36}$/);
  assert.equal(done.body.idempotencyKey, done.body.execId, "without a key, the run's id is its key");
  const failed = await call("/api/v1/exec", { token, method: "POST", body: { intent: "Fail", code: 'throw new Error("no")' } });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.status, "failed");
  assert.equal(failed.body.error.code, "script_error");
  const held = await call("/api/v1/exec", { token, method: "POST", body: { intent: "Tidy", idempotencyKey: "tidy", code: 'await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, plan: { message: "Remove", operations: [{ kind: "delete_nodes", target: { ids: ["second"] } }] } })' } });
  assert.equal(held.status, 200);
  assert.equal(held.body.status, "confirmation_required");
  assert.equal(held.body.confirmation.reasons[0].rule, "removes");
  const preview = await call("/api/v1/exec", { token, method: "POST", body: { intent: "Try", mode: "preview", code: `return (await slatebox.slates.applyOperations(${JSON.stringify(add("Tried"))})).mode` } });
  assert.equal(preview.body.result, "preview");
  assert.equal(world.slate("demo").nodes.length, 2);
  const confirmed = await call("/api/v1/exec", { token, method: "POST", body: { intent: "Tidy", idempotencyKey: "tidy", confirm: held.body.confirmation.id, code: 'await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, plan: { message: "Remove", operations: [{ kind: "delete_nodes", target: { ids: ["second"] } }] } })' } });
  assert.equal(confirmed.body.status, "completed");
  assert.equal(world.slate("demo").nodes.length, 1);
});

test("exec refuses what did not run: no token 401, bad input 400, rate limit 429", async (t) => {
  const { call, token } = await setup(t, { rateLimits: { perToken: 3, perAccount: 100, windowSeconds: 60 } });
  const anonymous = await call("/api/v1/exec", { method: "POST", body: { intent: "x", code: "return 1" } });
  assert.equal(anonymous.status, 401);
  const bad = await call("/api/v1/exec", { token, method: "POST", body: { code: "return 1" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "invalid_request");
  const huge = await call("/api/v1/exec", { token, method: "POST", body: { intent: "x", code: "x".repeat(70000) } });
  assert.equal(huge.status, 400);
  const propose = await call("/api/v1/exec", { token, method: "POST", body: { intent: "x", code: "return 1", mode: "propose" } });
  assert.equal(propose.body.error.code, "mode_unavailable");
  const limited = await call("/api/v1/exec", { token, method: "POST", body: { intent: "x", code: "return 1" } });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "rate_limited");
});

test("a local script's header calls get the same rules as a sealed run", async (t) => {
  const { world, call, token } = await setup(t);
  const execId = randomUUID();
  const code = "local script source";
  const headers = (n, extra = {}) => ({
    "slatebox-exec-id": execId, "slatebox-exec-key": "local-1", "slatebox-exec-call": String(n),
    "slatebox-exec-code-sha256": sha(code), "slatebox-exec-mode": "save",
    "slatebox-exec-intent": encodeURIComponent("Tidy the board"), ...extra,
  });
  const added = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: { plan: add("Local").plan, expectedRevision: revisionOf("demo") }, headers: headers(1) });
  assert.equal(added.status, 201);
  const held = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: { expectedRevision: revisionOf("demo"), plan: { message: "Remove", operations: [{ kind: "delete_nodes", target: { ids: ["second"] } }] } }, headers: headers(2) });
  assert.equal(held.status, 409);
  assert.equal(held.body.error.code, "confirmation_required");
  const id = held.headers.get("slatebox-exec-held");
  assert.match(id, /^cf_[A-Za-z0-9]{24}$/);
  assert.equal(held.body.error.details.confirmationId, id);
  assert.equal(world.slate("demo").nodes.length, 3);
  // Token management is not part of the client, so a script cannot reach it.
  const tokens = await call("/api/v1/tokens", { token, headers: headers(3) });
  assert.equal(tokens.status, 404);
  assert.equal(tokens.body.error.code, "unknown_method");
  // Keys inside scripts are derived: an Idempotency-Key with exec headers is refused.
  const keyed = await call("/api/v1/slates/demo/operations", { token, key: "mine", method: "POST", body: { plan: add("x").plan, expectedRevision: revisionOf("demo") }, headers: headers(4) });
  assert.equal(keyed.status, 400);
  // Changing the run's headers mid-run is refused.
  const changed = await call("/api/v1/slates/demo", { token, headers: headers(5, { "slatebox-exec-mode": "preview" }) });
  assert.equal(changed.status, 400);
  // Confirm: a new run of the same code, same key, presenting the id.
  const rerunId = randomUUID();
  const again = (n) => ({ ...headers(n), "slatebox-exec-id": rerunId, "slatebox-exec-confirm": id });
  const replay = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: { plan: add("Local").plan, expectedRevision: revisionOf("demo") }, headers: again(1) });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("idempotent-replayed"), "true");
  const saved = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: { expectedRevision: revisionOf("demo"), plan: { message: "Remove", operations: [{ kind: "delete_nodes", target: { ids: ["second"] } }] } }, headers: again(2) });
  assert.equal(saved.status, 201);
  assert.equal(world.slate("demo").nodes.length, 2);
  // Another token cannot take over this run id.
  const { token: other } = await world.mint();
  const taken = await call("/api/v1/slates/demo", { token: other, headers: headers(6) });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error.code, "exec_id_taken");
  // A request without exec headers is still an agent's call: its removal waits for a yes too.
  const removeWelcome = () => ({ expectedRevision: revisionOf("demo"), plan: { message: "Remove", operations: [{ kind: "delete_nodes", target: { ids: ["welcome"] } }] } });
  const plain = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: removeWelcome(), headers: { "idempotency-key": "plain-remove" } });
  assert.equal(plain.status, 409);
  assert.equal(plain.body.error.code, "confirmation_required");
  assert.deepEqual(plain.body.error.details.reasons.map((reason) => reason.rule), ["removes"]);
  assert.equal(world.slate("demo").nodes.length, 2, "nothing removed before the yes");
  const plainId = plain.body.error.details.confirmationId;
  // The same request again with the person's yes saves it, once.
  const yes = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: removeWelcome(), headers: { "idempotency-key": "plain-remove", "slatebox-confirm": plainId } });
  assert.equal(yes.status, 201);
  assert.equal(world.slate("demo").nodes.length, 1);
  // An addition needs no yes.
  const plainAdd = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: { plan: add("Plain").plan, expectedRevision: revisionOf("demo") }, headers: { "idempotency-key": "plain-add" } });
  assert.equal(plainAdd.status, 201, JSON.stringify(plainAdd.body));
  // A yes is used once: it does not carry over to another removal.
  const plainNote = world.slate("demo").nodes.find((node) => node.options.text === "Plain").options.id;
  const reused = await call("/api/v1/slates/demo/operations", { token, method: "POST", body: { expectedRevision: revisionOf("demo"), plan: { message: "Remove", operations: [{ kind: "delete_nodes", target: { ids: [plainNote] } }] } }, headers: { "idempotency-key": "plain-remove-2", "slatebox-confirm": plainId } });
  assert.equal(reused.status, 409);
  assert.equal(reused.body.error.code, "confirmation_invalid");
  assert.ok(world.slate("demo").nodes.some((node) => node.options.id === plainNote), "nothing removed");
  // The local run's record: calls, no code.
  const record = await call(`/api/v1/exec/${execId}`, { token });
  assert.equal(record.status, 200);
  assert.equal(record.body.surface, "local");
  assert.equal(record.body.code, undefined);
  assert.equal(record.body.intent, "Tidy the board");
  // Refusals before the gate (no such method, a key, changed headers) are not calls of the run.
  assert.deepEqual(record.body.calls.map((c) => [c.n, c.ok, c.held ?? false]), [[1, true, false], [2, false, true]]);
  assert.equal(record.body.status, "confirmation_required");
});

test("GET /api/v1/exec/{execId} returns your own run, with its code, and nobody else's", async (t) => {
  const { world, call, token } = await setup(t);
  const ran = await call("/api/v1/exec", { token, method: "POST", body: { intent: "Read demo", code: 'return (await slatebox.slates.get({ shareId: "demo" })).shareId' } });
  const record = await call(`/api/v1/exec/${ran.body.execId}`, { token });
  assert.equal(record.status, 200);
  assert.equal(record.body.surface, "api");
  assert.equal(record.body.intent, "Read demo");
  assert.match(record.body.code, /slates\.get/);
  assert.equal(record.body.status, "completed");
  assert.equal(record.body.calls.length, 1);
  assert.equal(record.body.calls[0].runKey, undefined);
  const { token: other } = await world.mint(["slates:read"], "other");
  const hidden = await call(`/api/v1/exec/${ran.body.execId}`, { token: other });
  assert.equal(hidden.status, 404);
});

test("exec.run and exec.get are API routes but never client methods", async (t) => {
  const { world } = await setup(t);
  assert.ok(world.registry.get("exec.run"));
  assert.equal(world.exec.manifest.methods.some((m) => m.name.startsWith("exec.")), false);
});
