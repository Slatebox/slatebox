// The local runner: the person's own machine, no sandbox. The script runs in a child process
// only so a runaway script can be stopped and its output stays off the MCP stdio stream. Every call goes to
// the server with the Slatebox-Exec-* headers, and the server applies the script rules.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadGenerated } from "../src/generated.js";
import { runLocal, localLimits } from "../src/exec/local-runner.js";

const generated = loadGenerated();
const LOCAL_LIMITS = localLimits(generated);
const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

// The fake is a Slatebox that runs exec: the runner asks /api/v1/instance before sending anything.
function fakeServer(answer = () => json(200, { shareId: "demo", nodeCount: 1 })) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    if (new URL(url).pathname === "/api/v1/instance") return json(200, { view: "account", limits: { exec: { callsPerScript: 64 } } });
    const request = { url: String(url), method: init.method, headers: init.headers, body: init.body && JSON.parse(init.body) };
    requests.push(request);
    return answer(request, requests.length);
  };
  return { requests, fetchImpl };
}

const run = (code, server, extra = {}) =>
  runLocal({ code, intent: "Probe", baseUrl: "http://127.0.0.1:9", token: "sbx_local_secret", fetchImpl: server.fetchImpl, generated, ...extra });

test("a script runs with top-level await and return, and each call carries the exec headers", async () => {
  const server = fakeServer();
  const code = "const a = await slatebox.slates.get({ shareId: 'demo' });\nconst b = await slatebox.slates.get({ shareId: 'demo', include: 'full' });\nreturn { n: a.nodeCount, same: a.shareId === b.shareId };";
  const out = await run(code, server, { idempotencyKey: "retry-1" });
  assert.equal(out.status, "completed", JSON.stringify(out.error));
  assert.deepEqual(out.result, { n: 1, same: true });
  assert.equal(out.mode, "save");
  assert.equal(out.idempotencyKey, "retry-1");
  assert.match(out.execId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(server.requests.map((r) => [r.method, r.url]), [
    ["GET", "http://127.0.0.1:9/api/v1/slates/demo"],
    ["GET", "http://127.0.0.1:9/api/v1/slates/demo?include=full"],
  ]);
  const sha = createHash("sha256").update(code).digest("hex");
  server.requests.forEach((r, i) => {
    assert.equal(r.headers.authorization, "Bearer sbx_local_secret");
    assert.equal(r.headers["slatebox-exec-id"], out.execId);
    assert.equal(r.headers["slatebox-exec-key"], "retry-1");
    assert.equal(r.headers["slatebox-exec-call"], String(i + 1));
    assert.equal(r.headers["slatebox-exec-code-sha256"], sha);
    assert.equal(r.headers["slatebox-exec-mode"], "save");
    assert.equal(r.headers["slatebox-exec-intent"], "Probe");
    assert.equal(r.headers["slatebox-exec-confirm"], undefined);
    // Keys inside a script are derived by the server; the runner never sends one.
    assert.equal(r.headers["idempotency-key"], undefined);
  });
  assert.deepEqual(out.calls.map(({ ms, ...c }) => c), [
    { n: 1, method: "slates.get", mode: null, ok: true, status: 200 },
    { n: 2, method: "slates.get", mode: null, ok: true, status: 200 },
  ]);
  assert.equal(out.usage.calls, 2);
  assert.equal(out.usage.maxCalls, 64);
});

test("without a key the run uses its execId as the key; preview, confirm and intent travel as headers", async () => {
  const server = fakeServer((r) => json(200, { ok: true, mode: r.body.mode ?? "preview", shareId: "demo", message: "m", operations: [{ kind: "add_nodes" }], report: {} }));
  const out = await run("return await slatebox.slates.applyOperations({ shareId: 'demo', plan: { message: 'x', operations: [{ kind: 'add_nodes', count: 1 }] } })", server,
    { mode: "preview", confirm: "cf_" + "a".repeat(24), intent: "Add a note — beside the plan, 100%" });
  assert.equal(out.status, "completed", JSON.stringify(out.error));
  const [r] = server.requests;
  assert.equal(r.headers["slatebox-exec-key"], out.execId);
  assert.equal(out.idempotencyKey, out.execId);
  assert.equal(r.headers["slatebox-exec-mode"], "preview");
  assert.equal(r.headers["slatebox-exec-confirm"], "cf_" + "a".repeat(24));
  assert.equal(decodeURIComponent(r.headers["slatebox-exec-intent"]), "Add a note — beside the plan, 100%");
  assert.match(r.headers["slatebox-exec-intent"], /^[!-~]+$/, "percent-encoded, header-safe");
  assert.equal(r.method, "POST");
  assert.equal(r.url, "http://127.0.0.1:9/api/v1/slates/demo/operations");
  // Restated (release/agentic): a preview run sends each write as a preview as well, so the
  // body carries mode beside the plan; path fields still stay out of it.
  assert.deepEqual(Object.keys(r.body).sort(), ["mode", "plan"], "path fields stay out of the body");
  assert.equal(r.body.mode, "preview");
  assert.equal(out.calls[0].mode, "preview");
  assert.equal(out.usage.operations, 1);
});

test("console output lands in logs, never on this process's stdout", async () => {
  const server = fakeServer();
  const writes = [];
  const original = process.stdout.write;
  process.stdout.write = function (chunk, ...rest) { writes.push(String(chunk)); return original.call(this, chunk, ...rest); };
  let out;
  try {
    out = await run("console.log('hello', { a: 1 });\nconsole.warn('careful');\nprocess.stdout.write('raw\\n');\nreturn 1", server);
  } finally {
    process.stdout.write = original;
  }
  assert.equal(out.status, "completed", JSON.stringify(out.error));
  assert.ok(out.logs.includes('hello {"a":1}'), JSON.stringify(out.logs));
  assert.ok(out.logs.includes("careful"), JSON.stringify(out.logs));
  assert.ok(out.logs.some((line) => line.includes("raw")), "the script process's own stdout is captured too");
  assert.equal(writes.filter((w) => /hello|careful|raw/.test(w)).length, 0);
});

test("a failed call throws SlateboxError in the script with code, status and details", async () => {
  const server = fakeServer(() => json(409, { error: { code: "slate_changed", message: "Read again.", details: { revision: 4 } } }));
  const code = "try { await slatebox.slates.get({ shareId: 'demo' }) } catch (e) {\n  return [e instanceof SlateboxError, e.name, e.code, e.status, e.details.revision, e.message]\n}";
  const out = await run(code, server);
  assert.equal(out.status, "completed", JSON.stringify(out.error));
  assert.deepEqual(out.result, [true, "SlateboxError", "slate_changed", 409, 4, "Read again."]);
  assert.deepEqual(out.calls.map(({ ms, ...c }) => c), [{ n: 1, method: "slates.get", mode: null, ok: false, status: 409, code: "slate_changed" }]);
});

test("an uncaught throw fails the run with the line and column in the caller's code", async () => {
  const out = await run("const a = 1;\nconst b = 2;\n  null.boom;", fakeServer());
  assert.equal(out.status, "failed");
  assert.equal(out.error.code, "script_error");
  assert.equal(out.error.line, 3);
  assert.match(out.error.message, /Cannot read properties of null/);
  const syntax = await run("const a = 1;\nconst = ;", fakeServer());
  assert.equal(syntax.status, "failed");
  assert.equal(syntax.error.code, "script_error");
  assert.equal(syntax.error.line, 2);
  assert.equal(syntax.result, undefined);
});

test("TypeScript is stripped and runs, with line numbers kept", async () => {
  const code = "interface Count { n: number }\nconst read: Count = { n: (await slatebox.slates.get({ shareId: 'demo' })).nodeCount as number };\nreturn read.n + 1";
  const out = await run(code, fakeServer());
  assert.equal(out.status, "completed", JSON.stringify(out.error));
  assert.equal(out.result, 2);
  const bad = await run("const a: number = 1;\nnull.x", fakeServer());
  assert.equal(bad.error.line, 2);
});

test("every method takes exactly one plain object, and nothing is silently dropped", async () => {
  const server = fakeServer();
  const out = await run(`const codes = [];
for (const call of [() => slatebox.slates.get({ shareId: 'demo' }, { extra: true }), () => slatebox.slates.get(new Map()), () => slatebox.slates.get('demo')]) {
  try { await call(); codes.push('ok') } catch (e) { codes.push(e.code) }
}
return codes`, server);
  assert.equal(out.status, "completed", JSON.stringify(out.error));
  assert.deepEqual(out.result, ["invalid_request", "invalid_request", "invalid_request"]);
  assert.equal(server.requests.length, 0);
  assert.equal(typeof generated.methods.get("apiTokens.list"), "undefined");
  const tokens = await run("return typeof slatebox.apiTokens", server);
  assert.equal(tokens.result, "undefined", "token management is unreachable from scripts");
});

test("a runaway script is stopped at the wall-clock limit", async () => {
  const started = Date.now();
  const out = await run("while (true) {}", fakeServer(), { limits: { ...LOCAL_LIMITS, wallMs: 400 } });
  assert.equal(out.status, "failed");
  assert.equal(out.error.code, "timeout");
  assert.ok(Date.now() - started < 5000);
  assert.equal(LOCAL_LIMITS.wallMs, 30000);
});

test("the 65th call stops the script with call_limit", async () => {
  const server = fakeServer();
  const out = await run("for (let i = 0; i < 70; i++) await slatebox.slates.get({ shareId: 'demo' });\nreturn 'never'", server);
  assert.equal(out.status, "failed");
  assert.equal(out.error.code, "call_limit");
  assert.equal(server.requests.length, 64);
  assert.equal(out.usage.calls, 64);
  assert.equal(LOCAL_LIMITS.maxCalls, 64);
});

test("a large result is cut at 40,000 characters, logs at 16 KiB, and a non-JSON result fails", async () => {
  const big = await run("return 'x'.repeat(41000)", fakeServer());
  assert.equal(big.status, "completed");
  assert.equal(big.truncated.chars, 41002);
  assert.equal(typeof big.result, "string");
  assert.equal(big.result.length, 40000);
  const noisy = await run("for (let i = 0; i < 2000; i++) console.log('line ' + i + ' ' + 'y'.repeat(20));\nreturn 1", fakeServer());
  const size = noisy.logs.reduce((n, line) => n + line.length + 1, 0);
  assert.ok(size <= 16 * 1024 + 80, String(size));
  assert.equal(noisy.logs.at(-1), "[logs cut at 16 KiB]");
  const fn = await run("return { f: 1n }", fakeServer());
  assert.equal(fn.status, "failed");
  assert.equal(fn.error.code, "result_not_json");
  const none = await run("await slatebox.slates.get({ shareId: 'demo' })", fakeServer());
  assert.equal(none.status, "completed");
  assert.equal(none.result, null);
});

test("a held call ends the run as confirmation_required with the reasons, and earlier saves are listed", async () => {
  const id = "cf_" + "B".repeat(24);
  const server = fakeServer((r, n) => n === 1
    ? json(201, { ok: true, mode: "save", shareId: "demo", message: "m", operations: [{ kind: "add_nodes", count: 2 }], report: {} })
    : json(409, { error: { code: "confirmation_required", message: "Confirm first.", details: { confirmationId: id, expiresAt: "2026-11-19T21:00:00.000Z", reasons: [{ rule: "removes", shareId: "demo", count: 3 }] } } },
      { "slatebox-exec-held": id }));
  const plan = "{ message: 'x', operations: [{ kind: 'delete_nodes', target: { ids: ['a'] } }] }";
  const out = await run(`await slatebox.slates.applyOperations({ shareId: 'demo', plan: ${plan} });\nawait slatebox.slates.applyOperations({ shareId: 'demo', plan: ${plan} });\nreturn 'unreached'`, server);
  assert.equal(out.status, "confirmation_required");
  assert.equal(out.result, undefined);
  assert.equal(out.error, undefined);
  assert.deepEqual(out.confirmation, { id, expiresAt: "2026-11-19T21:00:00.000Z", reasons: [{ n: 2, rule: "removes", shareId: "demo", count: 3 }] });
  assert.deepEqual(out.calls.map(({ ms, ...c }) => c), [
    { n: 1, method: "slates.applyOperations", mode: "save", ok: true, status: 201 },
    { n: 2, method: "slates.applyOperations", mode: "save", ok: false, status: 409, code: "confirmation_required", held: true },
  ]);
});

test("a replayed save is marked replayed; a call left running when the script returns fails the run", async () => {
  const server = fakeServer(() => json(200, { ok: true, mode: "save", shareId: "demo", message: "m", operations: [], report: {} }, { "idempotent-replayed": "true" }));
  const out = await run("return await slatebox.slates.applyOperations({ shareId: 'demo', plan: { message: 'x', operations: [{ kind: 'add_nodes', count: 1 }] } })", server);
  assert.equal(out.calls[0].replayed, true);
  const slow = fakeServer(async () => { await new Promise((r) => setTimeout(r, 150)); return json(200, { shareId: "demo" }); });
  const detached = await run("slatebox.slates.get({ shareId: 'demo' });\nreturn 1", slow);
  assert.equal(detached.status, "failed");
  assert.equal(detached.error.code, "detached_call");
  assert.equal(detached.calls.length, 1, "the call that went out is still listed");
});

// Restated (exec-fix-mcp, F5): the script now runs in a child process, and macOS adds its
// text-encoding variable to every process (it carries no secret; the server's runner selftest
// makes the same exception). Every other variable, the token among them, is still absent.
test("the script runs with an empty environment, and the token never enters its messages", async () => {
  const out = await run("return [Object.keys(process.env).filter((name) => name !== '__CF_USER_TEXT_ENCODING').length, JSON.stringify(globalThis.__slatebox_messages ?? null)]", fakeServer());
  assert.equal(out.status, "completed", JSON.stringify(out.error));
  assert.equal(out.result[0], 0);
  assert.ok(!JSON.stringify(out).includes("sbx_local_secret"));
});

test("bad exec input is refused before anything runs", async () => {
  const server = fakeServer();
  for (const extra of [{ intent: "" }, { intent: "x".repeat(201) }, { code: "" }, { mode: "propose" }, { confirm: "cf_short" }, { idempotencyKey: "has space" }]) {
    await assert.rejects(() => run("return 1", server, extra), (e) => e.code === "invalid_request", JSON.stringify(extra));
  }
  assert.equal(server.requests.length, 0);
});

// exec-fix-mcp, finding F2: the published callsInFlight limit holds locally too.
test("at most 4 calls are in flight at once; the rest wait their turn", async () => {
  let active = 0;
  let most = 0;
  const server = fakeServer(async () => {
    active += 1;
    most = Math.max(most, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return json(200, { shareId: "demo" });
  });
  const out = await run("await Promise.all(Array.from({ length: 12 }, () => slatebox.slates.get({ shareId: 'demo' })));\nreturn 1", server);
  assert.equal(out.status, "completed", JSON.stringify(out.error));
  assert.equal(server.requests.length, 12);
  assert.equal(most, 4);
  assert.equal(LOCAL_LIMITS.callsInFlight, 4);
});

test("a script that runs out of memory fails with memory, and this process carries on", async () => {
  const out = await run("const keep = []; while (true) keep.push(new Array(1e6).fill(1));", fakeServer(), { limits: { ...LOCAL_LIMITS, maxOldGenerationSizeMb: 64 } });
  assert.equal(out.status, "failed");
  assert.equal(out.error.code, "memory");
});

// exec-fix-mcp, finding F7: a lone surrogate cannot be sent as a header, so it is bad input.
test("an intent with a lone surrogate is refused as invalid_request", async () => {
  const server = fakeServer();
  await assert.rejects(() => run("return 1", server, { intent: "Tidy \ud800 up" }), (e) => e.code === "invalid_request" && e.details?.field === "intent");
  assert.equal(server.requests.length, 0);
});

// Release/agentic, the lead's decision: a preview run never saves. Each write goes out as a
// preview even when the script asks to save, and a write that cannot be previewed is refused
// here without a request.
test("a preview run sends every write as a preview and refuses one that cannot preview, sending nothing", async () => {
  const server = fakeServer((r) => json(200, { ok: true, mode: r.body?.mode ?? "save", shareId: "demo", message: "m", operations: [], report: {} }));
  const out = await run(`await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, mode: "save", plan: { message: "x", operations: [{ kind: "add_nodes", count: 1 }] } });
try { await slatebox.slates.create({ brief: "A -> B", kind: "diagram" }) } catch (error) { return error.code }`, server, { mode: "preview" });
  assert.equal(out.status, "completed", JSON.stringify(out.error));
  assert.equal(out.result, "preview_unavailable");
  assert.deepEqual(server.requests.map((r) => [r.method, new URL(r.url).pathname, r.body?.mode]), [["POST", "/api/v1/slates/demo/operations", "preview"]]);
  assert.deepEqual(out.calls.map(({ ms, ...c }) => c), [
    { n: 1, method: "slates.applyOperations", mode: "preview", ok: true, status: 200 },
    { n: 2, method: "slates.create", mode: "preview", ok: false, status: 400, code: "preview_unavailable" },
  ]);
});

// The rules are the server's: a Slatebox that does not run exec would save each call as an
// ordinary API call (docs F1: a --preview run saved 2 notes there). Nothing is sent to it.
test("against a Slatebox that does not run exec, nothing is sent, in preview or save", async () => {
  for (const [port, instance] of [[8, () => json(404, { error: { code: "not_found", message: "No route." } })], [7, () => json(200, { view: "account", limits: { rate: {} } })]]) {
    const sent = [];
    const fetchImpl = async (url, init) => {
      if (new URL(url).pathname === "/api/v1/instance") return instance();
      sent.push(String(url));
      return json(201, { ok: true, mode: "save" });
    };
    for (const mode of ["preview", "save"]) {
      const out = await runLocal({ code: `await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, plan: { message: "x", operations: [{ kind: "add_nodes", count: 1 }] } })`,
        intent: "Probe", mode, baseUrl: `http://127.0.0.1:${port}`, token: "sbx_t", fetchImpl, generated });
      assert.equal(out.status, "failed");
      assert.equal(out.error.code, "exec_unavailable");
      assert.match(out.error.message, /does not run exec scripts/);
      assert.deepEqual(out.calls, []);
    }
    assert.deepEqual(sent, [], "no call reached the server");
  }
});
