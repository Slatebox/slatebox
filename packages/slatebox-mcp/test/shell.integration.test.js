// The real `slatebox` executable against a local HTTP server. Since 0.4.0 that command is the
// npm package slatebox's (packages/slatebox), which runs this package's ./commands in process;
// `slatebox-mcp exec|describe` runs the same code and is checked at the end.
// Restated (exec): the per-action commands (create, read, share, unshare, branch, outcome,
// order, move, preview, apply) are gone by the owner's decision; each is now a script run by
// `slatebox exec`. What the old tests asserted about requests (route, body, mode, retry key,
// redaction, exit codes) is asserted here for the requests a script makes: the caller's retry
// key travels as Slatebox-Exec-Key and the server derives each call's key from it, so the
// Idempotency-Key header is never sent from a script.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const command = fileURLToPath(new URL("../../slatebox/bin/slatebox.mjs", import.meta.url));
const mcpCommand = fileURLToPath(new URL("../" + manifest.bin["slatebox-mcp"], import.meta.url));
const token = "sbx_fake_command_fixture";
const plan = { message: "Place a note", operations: [{ kind: "add_nodes", count: 1, shape: "triangle" }] };

function run(args, { origin, input = "", credential = token, bin = command } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { env: {
      PATH: process.env.PATH, SLATEBOX_API_TOKEN: credential, SLATEBOX_BASE_URL: origin || "http://127.0.0.1:1",
    } });
    let out = "", err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.end(input);
  });
}

async function fakeSlatebox(t, reply) {
  const received = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    // The fake is a Slatebox that runs exec: the runner asks /api/v1/instance before sending anything.
    if (req.url === "/api/v1/instance") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ view: "account", limits: { exec: { callsPerScript: 64 } } }));
      return;
    }
    const request = { url: req.url, method: req.method, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
    received.push(request);
    const [status, body, headers = {}] = reply(request, received.length);
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { received, origin: "http://127.0.0.1:" + server.address().port };
}

// As the server's exec gate does: a run in preview mode previews every write.
const modeOf = (request) => request.headers["slatebox-exec-mode"] === "preview" ? "preview" : request.body?.mode ?? "save";
const saved = (request) => [modeOf(request) === "preview" ? 200 : 201,
  { ok: true, mode: modeOf(request), shareId: "board", message: "m", operations: plan.operations, report: {} }];
const reader = (request) => request.method === "GET" ? [200, { shareId: "board", nodeCount: 1 }] : saved(request);

test("exec runs a file, standard input and -e, and prints the result as JSON with a summary on stderr", async (t) => {
  const { received, origin } = await fakeSlatebox(t, reader);
  const dir = await mkdtemp(path.join(tmpdir(), "slatebox-exec-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "my script.ts");
  await writeFile(file, "const s: { nodeCount: number } = await slatebox.slates.get({ shareId: 'board' });\nreturn s.nodeCount");
  const fromFile = await run(["exec", file], { origin });
  assert.equal(fromFile.code, 0, fromFile.err);
  assert.equal(JSON.parse(fromFile.out), 1);
  assert.equal(fromFile.err, "completed · 1 call: slates.get 200\n");
  const fromStdin = await run(["exec", "-"], { origin, input: "return (await slatebox.slates.get({ shareId: 'board', include: 'full' })).shareId" });
  assert.equal(fromStdin.code, 0, fromStdin.err);
  assert.equal(JSON.parse(fromStdin.out), "board");
  const inline = await run(["exec", "-e", "console.log('to logs'); return { ok: true }", "--json"], { origin });
  assert.equal(inline.code, 0, inline.err);
  const full = JSON.parse(inline.out);
  assert.equal(full.status, "completed");
  assert.deepEqual(full.result, { ok: true });
  assert.deepEqual(full.logs, ["to logs"]);
  assert.equal(inline.err, "");
  assert.deepEqual(received.map((r) => [r.method, r.url]), [["GET", "/api/v1/slates/board"], ["GET", "/api/v1/slates/board?include=full"]]);
  assert.ok(received.every((r) => r.headers.authorization === "Bearer " + token));
  assert.equal(decodeURIComponent(received[0].headers["slatebox-exec-intent"]), "slatebox exec " + file);
  assert.equal(received[1].headers["slatebox-exec-intent"], "slatebox%20exec%20-");
});

test("--preview previews every write; a retry with the same key sends the same exec key and call numbers", async (t) => {
  const { received, origin } = await fakeSlatebox(t, reader);
  const script = `return slatebox.slates.applyOperations({ shareId: "board", plan: ${JSON.stringify(plan)}, userMessage: "Place one note beside the proposal" })`;
  const preview = await run(["exec", "-", "--preview", "--intent", "Place a note"], { origin, input: script });
  assert.equal(preview.code, 0, preview.err);
  assert.equal(JSON.parse(preview.out).mode, "preview");
  assert.equal(received[0].headers["slatebox-exec-mode"], "preview");
  for (let i = 0; i < 2; i += 1) {
    const result = await run(["exec", "-", "--idempotency-key", "step-47"], { origin, input: script });
    assert.equal(result.code, 0, result.err);
    assert.equal(JSON.parse(result.out).mode, "save");
  }
  const [, first, second] = received;
  for (const call of [first, second]) {
    assert.deepEqual(call.body, { plan, userMessage: "Place one note beside the proposal" });
    assert.equal(call.headers["slatebox-exec-key"], "step-47");
    assert.equal(call.headers["slatebox-exec-call"], "1");
    assert.equal(call.headers["slatebox-exec-mode"], "save");
    assert.equal(call.headers["idempotency-key"], undefined);
  }
  assert.equal(first.headers["slatebox-exec-code-sha256"], second.headers["slatebox-exec-code-sha256"]);
  assert.notEqual(first.headers["slatebox-exec-id"], second.headers["slatebox-exec-id"]);
});

test("a held save prints the reasons and the exact command to confirm, exits 6, and --confirm resends", async (t) => {
  const id = "cf_" + "D".repeat(24);
  const { received, origin } = await fakeSlatebox(t, (request) => request.headers["slatebox-exec-confirm"] === id ? saved(request)
    : [409, { error: { code: "confirmation_required", message: "Confirm.", details: { confirmationId: id, reasons: [{ rule: "removes", shareId: "board", count: 2 }] } } },
      { "slatebox-exec-held": id }]);
  const code = "return slatebox.slates.applyOperations({ shareId: 'board', plan: { message: 'x', operations: [{ kind: 'delete_nodes', target: { all: true } }] } })";
  const held = await run(["exec", "-e", code], { origin });
  assert.equal(held.code, 6, held.err);
  assert.equal(held.out, "");
  assert.match(held.err, /^confirmation_required · 1 call: slates\.applyOperations 409 save · confirm cf_D+: removes\n/);
  assert.match(held.err, /call 1: removes on board \(2\)/);
  const key = received[0].headers["slatebox-exec-key"];
  const suggested = held.err.match(/To save, run:\n {2}(.+)\n/)[1];
  assert.equal(suggested, `slatebox exec -e '${code.replaceAll("'", `'\\''`)}' --confirm ${id} --idempotency-key ${key}`);
  const confirmed = await run(["exec", "-e", code, "--confirm", id, "--idempotency-key", key], { origin });
  assert.equal(confirmed.code, 0, confirmed.err);
  assert.equal(received[1].headers["slatebox-exec-confirm"], id);
  assert.equal(received[1].headers["slatebox-exec-key"], key);
});

test("each exit code 0 to 7 is produced, and the token never reaches the terminal", async (t) => {
  const { origin } = await fakeSlatebox(t, (request) => {
    const status = { "signed-out": 401, denied: 403, taken: 409, busy: 429 }[request.body?.intent];
    if (status) return [status, { error: { code: "refused_" + status, message: "No " + token } }];
    return reader(request);
  });
  const remote = (intent) => run(["exec", "-e", "return 1", "--remote", "--intent", intent], { origin });
  const results = {
    0: await run(["exec", "-e", "return 1"], { origin }),
    1: await remote("busy"),
    2: await run(["exec"], { origin }),
    3: await remote("signed-out"),
    4: await remote("denied"),
    5: await remote("taken"),
    7: await run(["exec", "-e", "throw new Error('" + token + "')"], { origin }),
  };
  for (const [code, result] of Object.entries(results)) {
    assert.equal(result.code, Number(code), `${code}: ${result.err}`);
    assert.ok(!(result.out + result.err).includes(token), `${code} leaked the token`);
  }
  assert.match(results[3].err, /^slatebox: HTTP 401 refused_401: No \[redacted\]\n/);
  assert.match(results[7].err, /^failed · 0 calls · script_error: \[redacted\] \(line 1\)\n/);
  // 6 is produced in the confirmation test above.
});

test("--remote sends the script to POST /api/v1/exec and prints the server's result", async (t) => {
  const { received, origin } = await fakeSlatebox(t, (request) => [200, { execId: "e", status: "completed", mode: request.body.mode,
    idempotencyKey: request.body.idempotencyKey ?? "e", result: { sealed: true }, logs: [], calls: [], usage: { calls: 0, maxCalls: 64 } }]);
  const result = await run(["exec", "-e", "return 1", "--remote", "--preview", "--idempotency-key", "r1"], { origin });
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(JSON.parse(result.out), { sealed: true });
  assert.deepEqual(received.map((r) => [r.method, r.url]), [["POST", "/api/v1/exec"]]);
  assert.deepEqual(received[0].body, { intent: "slatebox exec -e", code: "return 1", mode: "preview", idempotencyKey: "r1" });
  assert.equal(received[0].headers["idempotency-key"], undefined);
});

test("help and describe work without credentials; bad usage fails locally and sends nothing", async (t) => {
  const { received, origin } = await fakeSlatebox(t, reader);
  // `slatebox --help` is the whole command's help; exec's own is `slatebox exec --help`.
  const help = await run(["exec", "--help"], { credential: "" });
  assert.equal(help.code, 0);
  assert.match(help.out, /slatebox exec FILE \| - \| -e CODE/);
  assert.match(help.out, /there is no sandbox/);
  assert.match(help.out, /Exit codes: 0 completed, 1 other failure, 2 usage, 3 sign-in, 4 access, 5 refused \(409\/422\),\n6 confirmation required, 7 the script failed\./);
  const listing = await run(["describe"], { credential: "" });
  assert.equal(listing.code, 0, listing.err);
  assert.match(listing.out, /^slates\.get\s+Read a slate$/m);
  assert.ok(!/apiTokens/.test(listing.out));
  const one = await run(["describe", "--method", "slates.get"], { credential: "" });
  // Restated (wave 2, P07): slates.get also takes the note selection and paging inputs, and
  // answers the flat slate read.
  assert.match(one.out, /function get\(input: \{\n[^}]*shareId: string;\n\s+include\?: "full" \| "suggestions";\n[^}]*\}\): Promise<SlateRead>;/);
  for (const args of [["exec"], ["exec", "a.js", "-e", "1"], ["read", "board"], ["exec", "-e", "1", "--method", "x"],
    ["exec", "-e", "1", "--confirm", "nope"], ["exec", "-e", "1", "--idempotency-key", "has space"],
    ["exec", "-e", "1", "--base-url", "https://name:" + token + "@example.test"], ["exec", "missing-file.js"], ["exec", "-e", "1", "--dry-run"]]) {
    const failed = await run(args, { origin });
    assert.equal(failed.code, 2, args.join(" ") + ": " + failed.err);
    assert.equal(failed.out, "");
    assert.ok(!failed.err.includes(token));
  }
  const unsigned = await run(["exec", "-e", "return 1"], { origin, credential: "" });
  assert.equal(unsigned.code, 2);
  assert.match(unsigned.err, /SLATEBOX_API_TOKEN/);
  assert.equal(received.length, 0);
});

test("slatebox-mcp exec and describe are the same commands, named for slatebox-mcp", async (t) => {
  const { received, origin } = await fakeSlatebox(t, reader);
  const help = await run(["exec", "--help"], { credential: "", bin: mcpCommand });
  assert.equal(help.code, 0, help.err);
  assert.match(help.out, /slatebox-mcp exec and slatebox-mcp describe are the same commands/);
  const listing = await run(["describe"], { credential: "", bin: mcpCommand });
  assert.equal(listing.code, 0, listing.err);
  assert.match(listing.out, /^slates\.get\s+Read a slate$/m);
  const unsigned = await run(["exec", "-e", "return 1"], { origin, credential: "", bin: mcpCommand });
  assert.equal(unsigned.code, 2);
  assert.match(unsigned.err, /^slatebox-mcp: Set SLATEBOX_API_TOKEN/m);
  assert.match(unsigned.err, /Run slatebox-mcp exec --help for usage/);
  assert.equal(received.length, 0);
});
