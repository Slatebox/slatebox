// Findings from the exec/mcp attack review (reports19/exec-attack-mcp.md), each as a test that
// failed before its fix:
//   F1  a guest's malformed __slatebox.call fails only its own call; the shared runner lives
//   F2  the per-script caps hold when a script sends calls at once (sealed and local runs)
//   F3  a write's preview (or any call that names a slate) counts as reading that slate
//   F6  a held call's details carry expiresAt, which the exec tool's output schema requires
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { EXEC_LIMITS } from "../web/app/server/exec/limits.mjs";
import { createRunnerPool } from "../web/app/server/exec/runner-pool.mjs";
import { CHILD_PATH, makeExecWorld, RUN_ENTRY } from "./exec-test-world.mjs";

const fast = { ...EXEC_LIMITS, cpuMs: 1500, wallMs: 8000, killGraceMs: 2000 };
const sha = (text) => createHash("sha256").update(text).digest("hex");

// A real database answers after a round trip; the in-memory one answers at once, which hides
// races between a call's checks and its effects.
function withLatency(world, ms = 30) {
  const real = world.registry.run.bind(world.registry);
  world.registry.run = async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return real(...args);
  };
}

async function setup(t, options = {}) {
  const world = makeExecWorld({ limits: fast, ...options });
  current = world;
  t.after(() => world.close());
  const principal = await world.principalFor(["slates:read", "slates:write", "slates:share"]);
  const context = (extra = {}) =>
    world.exec.gate.newContext({ execId: randomUUID(), principal, surface: "api", codeSha256: sha("code"), intent: "test", ...extra });
  return { world, principal, gate: world.exec.gate, context };
}

// Every canvas edit names the revision it was made on (required since release/agentic): the
// helpers send the slate's current revision.
let current;
const revisionOf = (shareId) => current.slate(shareId)?.revision ?? 0;
const rename = (shareId, ids) => ({
  shareId,
  expectedRevision: revisionOf(shareId),
  plan: { message: "Rename", operations: ids.map((id) => ({ kind: "update_nodes", target: { ids: [id] }, changes: { text: `Renamed ${id}` } })) },
});
const addMany = (shareId, count, text = "flood") => ({ shareId, expectedRevision: revisionOf(shareId), plan: { message: "Add", operations: [{ kind: "add_nodes", count, shape: "rectangle", text }] } });
const renamed = (world) => world.slate("many").nodes.filter((node) => node.options.text.startsWith("Renamed")).length;

// F6 ---------------------------------------------------------------------------------------
test("a held call says when its confirmation expires", async (t) => {
  const { world, gate, context } = await setup(t);
  const ctx = context();
  const held = await gate.call(ctx, { seq: 1, method: "slates.applyOperations", input: { shareId: "demo", expectedRevision: revisionOf("demo"), plan: { message: "Remove", operations: [{ kind: "delete_nodes", target: { ids: ["second"] } }] } } });
  assert.equal(held.error.code, "confirmation_required");
  assert.match(held.error.details.expiresAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(held.error.details.expiresAt, ctx.held.expiresAt);
  assert.equal(world.slate("demo").nodes.length, 2);
});

// F2 ---------------------------------------------------------------------------------------
test("rewrites sent at once in one sealed run still count together: the 11th is held", async (t) => {
  const { world, gate, context } = await setup(t);
  withLatency(world);
  const ids = world.slate("many").nodes.map((node) => node.options.id);
  const ctx = context();
  const [a, b] = await Promise.all([
    gate.call(ctx, { seq: 1, method: "slates.applyOperations", input: rename("many", ids.slice(0, 7)) }),
    gate.call(ctx, { seq: 2, method: "slates.applyOperations", input: rename("many", ids.slice(7, 14)) }),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.error?.code, "confirmation_required");
  assert.deepEqual(b.error.details.reasons, [{ rule: "rewrites_text", shareId: "many", count: 14 }]);
  assert.equal(renamed(world), 7);
});

test("new notes sent at once in one sealed run stay under the note cap", async (t) => {
  const { world, gate, context } = await setup(t, { limits: { ...fast, notesCreated: 30 } });
  withLatency(world);
  const ctx = context();
  const results = await Promise.all(
    [1, 2, 3, 4].map((seq) => gate.call(ctx, { seq, method: "slates.applyOperations", input: addMany("demo", 20) })),
  );
  assert.deepEqual(results.map((r) => r.ok || r.error.code), [true, "note_limit", "note_limit", "note_limit"]);
  assert.equal(world.slate("demo").nodes.filter((node) => node.options.text === "flood").length, 20);
});

test("a sealed script that rewrites 14 notes with Promise.all is held at the 11th", async (t) => {
  const { world, principal } = await setup(t);
  withLatency(world);
  const ids = world.slate("many").nodes.map((node) => node.options.id);
  const write = (part) => `slatebox.slates.applyOperations(${JSON.stringify(rename("many", part))})`;
  const out = await world.exec.service.run({ principal, intent: "race", code: `await Promise.all([${write(ids.slice(0, 7))}, ${write(ids.slice(7, 14))}]); return 1` });
  assert.equal(out.status, "confirmation_required");
  assert.deepEqual(out.confirmation.reasons, [{ n: 2, rule: "rewrites_text", shareId: "many", count: 14 }]);
  assert.equal(renamed(world), 7);
});

test("a local run's header calls arriving at once still count together", async (t) => {
  const { world } = await setup(t);
  withLatency(world);
  const call = await world.serve(t);
  const { token } = await world.mint();
  const ids = world.slate("many").nodes.map((node) => node.options.id);
  const execId = randomUUID();
  const headers = (n) => ({
    "slatebox-exec-id": execId, "slatebox-exec-key": "race-1", "slatebox-exec-call": String(n),
    "slatebox-exec-code-sha256": sha("race"), "slatebox-exec-mode": "save", "slatebox-exec-intent": "race",
  });
  const send = (n, part) => call("/api/v1/slates/many/operations", { token, method: "POST", body: { plan: rename("many", part).plan, expectedRevision: revisionOf("many") }, headers: headers(n) });
  const answers = await Promise.all([send(1, ids.slice(0, 7)), send(2, ids.slice(7, 14))]);
  assert.deepEqual(answers.map((a) => a.status).sort(), [201, 409]);
  const held = answers.find((a) => a.status === 409);
  assert.equal(held.body.error.code, "confirmation_required");
  assert.deepEqual(held.body.error.details.reasons, [{ rule: "rewrites_text", shareId: "many", count: 14 }]);
  assert.equal(renamed(world), 7);
});

// F3 ---------------------------------------------------------------------------------------
test("previewing a write on a private slate counts as reading it: saving to a public slate is held", async (t) => {
  const { world, gate, context } = await setup(t);
  const ctx = context();
  const probe = { shareId: "demo", expectedRevision: revisionOf("demo"), mode: "preview", plan: { message: "Probe", operations: [{ kind: "update_nodes", target: { text: "Welcome!" }, changes: { width: 210 } }] } };
  const previewed = await gate.call(ctx, { seq: 1, method: "slates.applyOperations", input: probe });
  assert.equal(previewed.ok, true);
  assert.equal(ctx.minReadRank, 0, "demo is private");
  const leak = await gate.call(ctx, { seq: 2, method: "slates.applyOperations", input: addMany("open", 1, "Welcome! exists") });
  assert.equal(leak.error.code, "confirmation_required");
  assert.deepEqual(leak.error.details.reasons, [{ rule: "widens_audience", shareId: "open" }]);
  assert.equal(world.slate("open").nodes.length, 1);
});

test("a saved write on a private slate counts as reading it too", async (t) => {
  const { world, gate, context } = await setup(t);
  const ctx = context();
  const probe = { shareId: "demo", expectedRevision: revisionOf("demo"), plan: { message: "Probe", operations: [{ kind: "update_nodes", target: { text: "Welcome!" }, changes: { width: 210 } }] } };
  assert.equal((await gate.call(ctx, { seq: 1, method: "slates.applyOperations", input: probe })).ok, true);
  const leak = await gate.call(ctx, { seq: 2, method: "slates.applyOperations", input: addMany("open", 1, "copied") });
  assert.equal(leak.error.code, "confirmation_required");
  assert.deepEqual(leak.error.details.reasons, [{ rule: "widens_audience", shareId: "open" }]);
  // A slate the caller cannot open teaches nothing, so it does not count.
  const stranger = await world.principalFor(["slates:read", "slates:write"], "stranger");
  const other = world.exec.gate.newContext({ execId: randomUUID(), principal: stranger, surface: "api", codeSha256: sha("code"), intent: "test" });
  const refused = await gate.call(other, { seq: 1, method: "slates.applyOperations", input: { ...probe, mode: "preview" } });
  assert.equal(refused.ok, false);
  assert.equal(other.minReadRank, null);
});

test("a local run's preview of a private slate makes its save to a public slate held", async (t) => {
  const { world } = await setup(t);
  const call = await world.serve(t);
  const { token } = await world.mint();
  const execId = randomUUID();
  const headers = (n) => ({
    "slatebox-exec-id": execId, "slatebox-exec-key": "taint-1", "slatebox-exec-call": String(n),
    "slatebox-exec-code-sha256": sha("taint"), "slatebox-exec-mode": "save", "slatebox-exec-intent": "taint",
  });
  const preview = await call("/api/v1/slates/demo/operations", { token, method: "POST", headers: headers(1),
    body: { mode: "preview", expectedRevision: revisionOf("demo"), plan: { message: "Probe", operations: [{ kind: "update_slate", changes: { name: "Demo" } }] } } });
  assert.equal(preview.status, 200);
  const leak = await call("/api/v1/slates/open/operations", { token, method: "POST", headers: headers(2), body: { plan: addMany("open", 1, "x").plan, expectedRevision: revisionOf("open") } });
  assert.equal(leak.status, 409);
  assert.deepEqual(leak.body.error.details.reasons, [{ rule: "widens_audience", shareId: "open" }]);
});

// F1 ---------------------------------------------------------------------------------------
test("a guest's malformed call fails only that call; other accounts' runs and the runner live", async (t) => {
  const { world, principal } = await setup(t);
  const run = (code, who = principal) => world.exec.service.run({ principal: who, intent: "test", code });
  assert.equal((await run("return 1")).result, 1);
  const pid = world.exec.pool.pid();
  const victim = await world.principalFor(["slates:read"], "victim");
  const slow = run("let x = 0; for (let i = 0; i < 2e7; i++) x += i; return x > 0", victim);
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (const bad of ['"slates.get", null', '"slates.get", [1]', '"slates.get", "x"', '42, {}', '{}, {}', '"x".repeat(500), {}']) {
    const out = await run(`return await __slatebox.call(${bad})`);
    assert.equal(out.status, "completed", bad);
    assert.equal(out.result.ok, false, bad);
    assert.equal(out.result.error.code, "invalid_request", bad);
    assert.equal(out.result.error.status, 400, bad);
  }
  assert.equal((await slow).result, true, "the other account's run finished");
  assert.equal(world.exec.pool.pid(), pid, "the runner was not restarted");
  assert.equal(world.logs.some((line) => /stopping the runner/.test(line)), false);
  // The client still answers normally afterwards.
  assert.equal((await run('return typeof (await slatebox.slates.get({ shareId: "demo" }))')).result, "object");
});

// The parent's own checks, with a stand-in child that says whatever a compromised child could.
function fakeChild(onRun) {
  return () => {
    const proc = new EventEmitter();
    proc.pid = 4242;
    proc.killed = null;
    proc.kill = (signal) => { proc.killed = signal; queueMicrotask(() => proc.emit("exit", null, signal)); };
    proc.disconnect = () => {};
    proc.replies = [];
    proc.send = (message) => {
      if (message.t === "selftest")
        queueMicrotask(() => proc.emit("message", { v: 1, t: "selftest", envKeys: 0, fsDenied: true, fsWriteDenied: true, childProcessDenied: true, addonsDenied: true, workerAllowed: true }));
      if (message.t === "run") queueMicrotask(() => onRun(proc, message));
      if (message.t === "reply") proc.replies.push(message);
    };
    queueMicrotask(() => proc.emit("message", { v: 1, t: "ready", node: "fake", run: "fake" }));
    return proc;
  };
}

test("the parent answers a malformed method or input with invalid_request, and kills the child only for protocol faults", async (t) => {
  let child;
  const logs = [];
  const pool = createRunnerPool({
    childPath: CHILD_PATH, runEntry: RUN_ENTRY, limits: fast, log: (line) => logs.push(line),
    fork: fakeChild((proc, { runId }) => {
      child = proc;
      if (proc.runs === undefined) proc.runs = 0;
      proc.runs += 1;
      if (proc.runs === 1) {
        for (const [seq, method, input] of [[1, 42, {}], [2, "x".repeat(121), {}], [3, "slates.get", null], [4, "slates.get", [1]]])
          proc.emit("message", { v: 1, t: "call", runId, seq, method, input });
        setTimeout(() => proc.emit("message", { v: 1, t: "done", runId, outcome: { status: "completed", value: 1 } }), 20);
      } else {
        proc.emit("message", { v: 1, t: "call", runId: "not-a-run", seq: 1, method: "slates.get", input: {} });
      }
    }),
  });
  t.after(() => pool.close());
  let calls = 0;
  const first = await pool.run({ source: "x", onCall: async () => { calls += 1; return { ok: true, value: 1 }; } });
  assert.equal(first.status, "completed");
  assert.equal(calls, 0);
  assert.deepEqual(child.replies.map((r) => [r.seq, r.envelope.error.code, r.envelope.error.status]), [[1, "invalid_request", 400], [2, "invalid_request", 400], [3, "invalid_request", 400], [4, "invalid_request", 400]]);
  assert.equal(child.killed, null);
  const second = await pool.run({ source: "x", onCall: async () => ({ ok: true, value: 1 }) });
  assert.equal(second.status, "failed");
  assert.equal(second.error.code, "exec_unavailable");
  assert.equal(child.killed, "SIGKILL");
  assert.ok(logs.some((line) => /a malformed call/.test(line)));
});
