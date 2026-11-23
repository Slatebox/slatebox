// The sealed runner, for real: the runner child with Node's permission flags and an empty
// environment, `run` (QuickJS in WebAssembly) inside it, the gate and the registry behind it.
// Set EXEC_RUNNER_NODE to run the child on another Node (the image ships Node 24).
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXEC_LIMITS } from "../web/app/server/exec/limits.mjs";
import { createRunnerPool } from "../web/app/server/exec/runner-pool.mjs";
import { CHILD_PATH, makeExecWorld, RUN_ENTRY } from "./exec-test-world.mjs";

const fast = { ...EXEC_LIMITS, cpuMs: 1500, wallMs: 8000, killGraceMs: 2000 };
const nodePath = process.env.EXEC_RUNNER_NODE || process.execPath;

async function setup(t, limits = fast) {
  const world = makeExecWorld({ limits });
  t.after(() => world.close());
  const principal = await world.principalFor();
  const exec = (code, extra = {}) => world.exec.service.run({ principal, intent: "test", code, ...extra });
  return { world, principal, exec };
}

test("the runner child is sealed: no environment, no file reads, no processes, no addons", async (t) => {
  const { world } = await setup(t);
  const info = await world.exec.pool.selftest();
  assert.equal(info.selftest.envKeys, 0);
  assert.equal(info.selftest.fsDenied, true);
  assert.equal(info.selftest.fsWriteDenied, true);
  assert.equal(info.selftest.childProcessDenied, true);
  assert.equal(info.selftest.addonsDenied, true);
  assert.equal(info.selftest.workerAllowed, true);
  assert.equal(info.run, "2.1.13");
  assert.equal(info.node, process.env.EXEC_RUNNER_NODE ? info.node : process.version);
  // The network is denied by flags only from Node 25 on; the script has no network API either way.
  assert.equal(info.selftest.netDeniedByFlags, Number(info.node.slice(1).split(".")[0]) >= 25);
});

test("a script has no Node, no network, no modules and no eval", async (t) => {
  const { exec } = await setup(t);
  const globals = await exec('return [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof WebAssembly, typeof __sbx === "object"]');
  assert.equal(globals.status, "completed");
  assert.deepEqual(globals.result, ["undefined", "undefined", "undefined", "undefined", "undefined", true]);
  const escape = await exec('return globalThis.constructor.constructor("return process")()');
  assert.equal(escape.status, "failed");
  assert.equal(escape.error.code, "script_error");
  const fs = await exec('const fs = await import("node:fs"); return typeof fs');
  assert.equal(fs.status, "failed");
  assert.equal(fs.error.code, "script_error");
  const evil = await exec('return eval("1 + 1")');
  assert.equal(evil.status, "failed");
});

test("a script reads and writes through the client, with logs, TypeScript and line numbers", async (t) => {
  const { world, exec } = await setup(t);
  const run = await exec([
    'const slate: { nodeCount: number } = await slatebox.slates.get({ shareId: "demo" });',
    'console.log("notes", slate.nodeCount);',
    'const saved = await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, plan: { message: "Add", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "From a script" }] } });',
    'return { before: slate.nodeCount, created: saved.report.created.length, mode: saved.mode };',
  ].join("\n"));
  assert.equal(run.status, "completed", JSON.stringify(run.error));
  assert.deepEqual(run.result, { before: 2, created: 1, mode: "save" });
  assert.deepEqual(run.logs, ["notes 2"]);
  assert.deepEqual(run.calls.map((c) => [c.n, c.method, c.mode, c.ok, c.status]), [[1, "slates.get", null, true, 200], [2, "slates.applyOperations", "save", true, 201]]);
  assert.equal(world.slate("demo").nodes.at(-1).options.text, "From a script");
  assert.deepEqual(run.usage, { calls: 2, maxCalls: 64, operations: 1, notesCreated: 1, wallMs: run.usage.wallMs });
  const thrown = await exec('const a = 1;\nthrow new Error("on line two");');
  assert.equal(thrown.status, "failed");
  assert.equal(thrown.error.code, "script_error");
  assert.equal(thrown.error.line, 2);
  const syntax = await exec("const a = ;");
  assert.equal(syntax.error.code, "script_error");
  assert.equal(syntax.error.line, 1);
});

test("runaway scripts stop with their own codes", async (t) => {
  const { exec } = await setup(t);
  const loop = await exec("while (true) {}");
  assert.equal(loop.error.code, "cpu_timeout");
  const memory = await exec('const a = []; while (true) a.push("x".repeat(100000) + a.length);');
  assert.equal(memory.error.code, "memory");
  const calls = await exec('for (let i = 0; i < 65; i++) await slatebox.slates.get({ shareId: "demo" }); return 1');
  assert.equal(calls.status, "failed");
  assert.equal(calls.error.code, "call_limit");
  assert.equal(calls.calls.length, 64);
  const detached = await exec('slatebox.slates.get({ shareId: "demo" }); return 1');
  assert.equal(detached.error.code, "detached_call");
  const big = await exec('return "x".repeat(41000)');
  assert.equal(big.status, "completed");
  assert.deepEqual(big.truncated, { chars: 41002 });
  assert.equal(big.result.length, 40000);
  const notJson = await exec("return () => 1");
  assert.equal(notJson.error.code, "result_not_json");
});

test("a held call makes the run confirmation_required; the same code with confirm saves it", async (t) => {
  const { world, exec } = await setup(t);
  const code = [
    'await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, plan: { message: "Add", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "Kept" }] } });',
    'await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, plan: { message: "Remove", operations: [{ kind: "delete_nodes", target: { ids: ["second"] } }] } });',
    'return "done";',
  ].join("\n");
  const first = await exec(code, { idempotencyKey: "tidy-1" });
  assert.equal(first.status, "confirmation_required");
  assert.equal(first.result, undefined);
  assert.equal(first.error, undefined);
  assert.deepEqual(first.confirmation.reasons, [{ n: 2, rule: "removes", shareId: "demo", count: 1 }]);
  assert.equal(world.slate("demo").nodes.length, 3);
  const second = await exec(code, { idempotencyKey: "tidy-1", confirm: first.confirmation.id });
  assert.equal(second.status, "completed", JSON.stringify(second));
  assert.equal(second.result, "done");
  assert.equal(second.calls[0].replayed, true, "the add replayed instead of saving twice");
  assert.equal(world.slate("demo").nodes.length, 2);
  assert.equal(world.slate("demo").nodes.filter((n) => n.options.text === "Kept").length, 1);
  await assert.rejects(exec(code, { idempotencyKey: "tidy-1", confirm: first.confirmation.id }), { code: "confirmation_invalid" });
  await assert.rejects(exec(code + "\n// changed", { confirm: first.confirmation.id }), { code: "confirmation_invalid" });
  // The audit record keeps intent, code, calls and outcome for the owner.
  const record = await world.exec.service.get(await world.principalFor(), first.execId).catch((e) => e);
  assert.equal(record.code, "not_found", "another token cannot read it");
});

test("one run at a time per account; a busy runner answers 429 and a dead one 503, then respawns", async (t) => {
  const { world, principal, exec } = await setup(t);
  assert.equal(await world.exec.store.lock("owner", "someone-else", 60000), true);
  await assert.rejects(exec("return 1"), { code: "exec_busy", status: 429 });
  await world.exec.store.unlock("owner", "someone-else");
  assert.equal((await exec("return 1")).result, 1);

  // Two runs at once per process. Restated (exec-fix-app, A5): a third run used to be refused
  // at once; it now waits up to slotWaitMs for a slot, and is refused only when none frees.
  const pool = createRunnerPool({ childPath: CHILD_PATH, runEntry: RUN_ENTRY, limits: { ...fast, slotWaitMs: 400 }, nodePath, log: () => {} });
  t.after(() => pool.close());
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const slow = () => pool.run({ source: 'return await __slatebox.call("x", {})', onCall: async () => { await gate; return { ok: true, value: 1 }; } });
  const [a, b] = [slow(), slow()];
  await new Promise((resolve) => setTimeout(resolve, 200));
  await assert.rejects(pool.run({ source: "return 1", onCall: async () => ({}) }), { code: "exec_busy", status: 429, retryAfter: 5 });
  const queued = pool.run({ source: "return 3", onCall: async () => ({}) });
  await new Promise((resolve) => setTimeout(resolve, 100));
  release();
  assert.deepEqual((await a).status, "completed");
  assert.deepEqual((await b).status, "completed");
  assert.deepEqual(await queued.then((o) => [o.status, o.value?.json ?? o.value]), ["completed", 3]);

  // Killing the child mid-run fails that run with 503; the next run starts a new child.
  const pid = world.exec.pool.pid();
  assert.ok(pid);
  const dying = exec('await slatebox.slates.get({ shareId: "demo" }); while (true) {}');
  await new Promise((resolve) => setTimeout(resolve, 300));
  process.kill(pid, "SIGKILL");
  await assert.rejects(dying, { code: "exec_unavailable", status: 503 });
  assert.equal((await exec("return 2")).result, 2);
  assert.notEqual(world.exec.pool.pid(), pid);
  assert.ok(principal);
});

// Restated (exec-fix-mcp, finding F1): a malformed call used to kill the shared child, which a
// script can cause at will, so it now fails only that call. Protocol faults still kill it.
test("a script's malformed call fails only that call, and no call is made for it", async (t) => {
  const pool = createRunnerPool({ childPath: CHILD_PATH, runEntry: RUN_ENTRY, limits: fast, nodePath, log: () => {} });
  t.after(() => pool.close());
  let calls = 0;
  // A method name longer than any client method is refused before it reaches the app.
  const out = await pool.run({ source: 'return await __slatebox.call("x".repeat(500), {})', onCall: async () => { calls += 1; return { ok: true, value: 1 }; } });
  assert.equal(out.status, "completed");
  assert.equal(out.value.error.code, "invalid_request");
  assert.equal(calls, 0);
  const pid = pool.pid();
  assert.ok(pid);
  assert.equal((await pool.run({ source: "return 2", onCall: async () => ({}) })).value, 2);
  assert.equal(pool.pid(), pid, "the same child answered");
});
