// The real slatebox-mcp executable: over stdio a script's output never corrupts the JSON-RPC
// stream; over --http it listens on loopback only and answers only its own token.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const bin = fileURLToPath(new URL("../" + manifest.bin["slatebox-mcp"], import.meta.url));
const token = "sbx_fake_mcp_fixture";

async function fakeSlatebox(t) {
  const received = [];
  const server = createServer((req, res) => {
    // The fake is a Slatebox that runs exec: the runner asks /api/v1/instance before sending anything.
    if (req.url === "/api/v1/instance") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ view: "account", limits: { exec: { callsPerScript: 64 } } }));
      return;
    }
    received.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ shareId: "board", nodeCount: 3 }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { received, origin: "http://127.0.0.1:" + server.address().port };
}

function start(t, args, origin) {
  const child = spawn(process.execPath, [bin, ...args], { env: { PATH: process.env.PATH, SLATEBOX_API_TOKEN: token, SLATEBOX_BASE_URL: origin } });
  const out = { stdout: "", stderr: "" };
  child.stdout.on("data", (chunk) => { out.stdout += chunk; });
  child.stderr.on("data", (chunk) => { out.stderr += chunk; });
  const exited = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  t.after(() => { if (child.exitCode === null) child.kill(); return exited; });
  return { child, out, exited };
}

const until = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test("over stdio, a script's console and process output stay out of the JSON-RPC stream", async (t) => {
  const { received, origin } = await fakeSlatebox(t);
  const { child, out } = start(t, [], origin);
  const send = (message) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "1" } } });
  await until(() => out.stdout.includes('"id":1'));
  send({ method: "notifications/initialized" });
  send({ id: 2, method: "tools/list" });
  send({ id: 3, method: "tools/call", params: { name: "exec", arguments: { intent: "Count notes",
    code: "console.log('noise'); process.stdout.write('more noise\\n'); console.error('err');\nreturn (await slatebox.slates.get({ shareId: 'board' })).nodeCount" } } });
  await until(() => out.stdout.includes('"id":3'));
  const lines = out.stdout.trim().split("\n");
  const messages = lines.map((line) => JSON.parse(line));
  assert.ok(messages.every((m) => m.jsonrpc === "2.0"), "every stdout line is JSON-RPC");
  const listed = messages.find((m) => m.id === 2).result.tools.map((tool) => tool.name);
  assert.deepEqual(listed.slice(0, 2), ["exec", "describe"]);
  assert.ok(listed.includes("get_slate") && listed.includes("import_mermaid"), "the typed tools are listed by default");
  const call = messages.find((m) => m.id === 3).result;
  assert.equal(call.structuredContent.result, 3);
  assert.deepEqual(call.structuredContent.logs.sort(), ["err", "more noise", "noise"]);
  assert.equal(received.length, 1);
  assert.equal(received[0].headers.authorization, "Bearer " + token);
  assert.ok(!out.stderr.includes(token));
});

function raw(port, { host, origin, authorization, body = "{}" }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: "/mcp", method: "POST", headers: {
      host: host ?? `127.0.0.1:${port}`, "content-type": "application/json", accept: "application/json, text/event-stream",
      ...(origin ? { origin } : {}), ...(authorization ? { authorization } : {}) } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("--http listens on loopback only and answers only the token it was started with", async (t) => {
  const { origin } = await fakeSlatebox(t);
  const refused = start(t, ["--http", "--host", "0.0.0.0", "--port", "0"], origin);
  assert.equal(await refused.exited, 2);
  assert.match(refused.out.stderr, /127\.0\.0\.1 only/);
  const unclear = start(t, ["--typed-tools", "maybe"], origin);
  assert.equal(await unclear.exited, 2);
  assert.match(unclear.out.stderr, /--typed-tools .* is on or off/);

  const { out } = start(t, ["--http", "--port", "0", "--typed-tools", "off"], origin);
  await until(() => /listening at http:\/\/127\.0\.0\.1:\d+\/mcp/.test(out.stderr));
  const url = out.stderr.match(/(http:\/\/127\.0\.0\.1:(\d+)\/mcp)/);
  const port = Number(url[2]);
  const good = "Bearer " + token;
  assert.equal((await raw(port, { authorization: good, host: "evil.example:" + port })).status, 403, "DNS rebinding: foreign Host");
  assert.equal((await raw(port, { authorization: good, origin: "https://evil.example" })).status, 403, "a web page's Origin");
  assert.equal((await raw(port, { authorization: "Bearer sbx_someone_else" })).status, 401);
  assert.equal((await raw(port, {})).status, 401);

  const client = new Client({ name: "probe", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url[1]), { requestInit: { headers: { authorization: good } } }));
  t.after(() => client.close());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), ["exec", "describe"], "--typed-tools off: exec and describe only");
  const result = await client.callTool({ name: "exec", arguments: { intent: "Count", code: "return (await slatebox.slates.get({ shareId: 'board' })).nodeCount" } });
  assert.equal(result.structuredContent.result, 3);
});

test("without a token, over stdio: the install_slatebox prompt works, every tool answers sign_in_required, nothing is sent", async (t) => {
  const { received, origin } = await fakeSlatebox(t);
  const child = spawn(process.execPath, [bin], { env: { PATH: process.env.PATH, SLATEBOX_BASE_URL: origin } });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.on("close", resolve));
  t.after(() => { if (child.exitCode === null) child.kill(); return exited; });
  const send = (message) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "1" } } });
  await until(() => stdout.includes('"id":1'));
  send({ method: "notifications/initialized" });
  send({ id: 2, method: "prompts/get", params: { name: "install_slatebox", arguments: { where: "my Ubuntu server" } } });
  send({ id: 3, method: "tools/call", params: { name: "exec", arguments: { intent: "Count", code: "return 1" } } });
  await until(() => stdout.includes('"id":3'));
  const messages = stdout.trim().split("\n").map((line) => JSON.parse(line));
  const text = messages.find((m) => m.id === 2).result.messages[0].content.text;
  assert.match(text, /install my own Slatebox on my Ubuntu server/);
  assert.match(text, /npx slatebox/);
  const call = messages.find((m) => m.id === 3).result;
  assert.equal(call.isError, true);
  assert.match(call.content[0].text, /sign_in_required: No Slatebox token/);
  assert.equal(received.length, 0, "nothing reached a Slatebox");
  assert.match(stderr, /SLATEBOX_API_TOKEN is not set/);
});

test("without a token, --http refuses to start (its token is the bearer)", async (t) => {
  const child = spawn(process.execPath, [bin, "--http", "--port", "0"], { env: { PATH: process.env.PATH } });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 2);
  assert.match(stderr, /Set SLATEBOX_API_TOKEN/);
});
