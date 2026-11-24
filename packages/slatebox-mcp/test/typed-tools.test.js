// One typed tool per client method beside exec and describe, the prompts and the resources, as
// the local server serves them. A typed tool is an exec script of one call, so it goes through
// the same runner, sends the same exec headers and meets the same checks as a script; the
// package's copy of the mapping answers exactly as the app's (agent-surface.mjs).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadGenerated } from "../src/generated.js";
import { createSlateboxMcpServer, toolDefinitions } from "../src/server.js";
import { createExec } from "../src/exec/index.js";
import * as local from "../src/typed-tools.js";

const hosted = await import(new URL("../../../web/app/server/actions/agent-surface.mjs", import.meta.url));
const { listedTools } = await import(new URL("../../../web/app/server/actions/client-render.mjs", import.meta.url));
const generatedDir = new URL("../generated/", import.meta.url);
const generated = loadGenerated(generatedDir);
const file = JSON.parse(await readFile(new URL("exec-tool.json", generatedDir), "utf8"));

async function connected(t, answer, options = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    if (new URL(url).pathname === "/api/v1/instance")
      return new Response(JSON.stringify({ view: "account", limits: { exec: { callsPerScript: 64 } } }), { status: 200, headers: { "content-type": "application/json" } });
    requests.push({ url: String(url), method: init.method, headers: init.headers, body: init.body && JSON.parse(init.body) });
    const [status, body, headers] = answer(requests.at(-1));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  };
  const exec = createExec({ baseUrl: "http://127.0.0.1:9", token: "sbx_mcp_secret", fetchImpl, generated });
  const server = createSlateboxMcpServer({ exec, generated, ...options });
  const client = new Client({ name: "slatebox-mcp-test", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  t.after(async () => { await client.close(); await server.close(); });
  return { client, requests };
}

const slate = { shareId: "demo", revision: 4, nodes: [{ id: "a", text: "A" }] };
const ok = (r) => (r.url.includes("/mermaid") ? [200, { shareId: "demo", mermaid: "flowchart LR\n  a[\"A\"]" }] : [200, slate]);

test("tools/list: exec, describe, then one typed tool per method, as the hosted endpoint lists them", async (t) => {
  const { client } = await connected(t, ok);
  const { tools } = await client.listTools();
  // Restated (AI control S2): every method but the admin toolset's (hidden from the tool list, spec 4).
  assert.equal(tools.length, 2 + generated.manifest.methods.filter((method) => method.toolset !== "admin").length);
  assert.ok(generated.manifest.methods.some((method) => method.toolset === "admin"));
  assert.deepEqual(tools, JSON.parse(JSON.stringify(listedTools(file))));
  assert.deepEqual(toolDefinitions(generated), listedTools(file));
  assert.equal(client.getInstructions(), file.instructions);
  for (const tool of tools) for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"])
    assert.equal(typeof tool.annotations[hint], "boolean", `${tool.name}.${hint}`);
});

test("typedTools false (SLATEBOX_MCP_TYPED_TOOLS=off) lists exec and describe only", async (t) => {
  const { client, requests } = await connected(t, ok, { typedTools: false });
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["exec", "describe"]);
  assert.equal(client.getInstructions(), file.instructionsExecOnly);
  const refused = await client.callTool({ name: "get_slate", arguments: { shareId: "demo" } });
  assert.match(refused.content[0].text, /^unknown_tool/);
  assert.equal(requests.length, 0);
  assert.equal(local.typedToolsEnabled("off"), false);
  assert.equal(local.typedToolsEnabled(undefined), true);
});

test("a typed tool runs through exec: the same request and exec headers a script sends", async (t) => {
  const { client, requests } = await connected(t, ok);
  const typed = await client.callTool({ name: "get_slate", arguments: { shareId: "demo", fields: "text" } });
  assert.equal(typed.isError, false);
  assert.equal(typed.structuredContent.status, "completed");
  assert.deepEqual(typed.structuredContent.result, slate);
  assert.match(typed.content[0].text, /^get_slate: done\.\nresult: Data returned by Slatebox/);
  const script = await client.callTool({ name: "exec", arguments: { intent: "Read a slate", code: 'return await slatebox.slates.get({ shareId: "demo", fields: "text" })' } });
  assert.equal(requests.length, 2);
  const [viaTool, viaExec] = requests;
  assert.equal(viaTool.url, viaExec.url);
  assert.equal(viaTool.method, viaExec.method);
  assert.equal(viaTool.headers["slatebox-exec-intent"], "Read%20a%20slate");
  for (const header of ["authorization", "slatebox-exec-mode", "slatebox-exec-call"]) assert.equal(viaTool.headers[header], viaExec.headers[header], header);
  assert.ok(viaTool.headers["slatebox-exec-id"] && viaTool.headers["slatebox-exec-code-sha256"]);
  assert.deepEqual(typed.structuredContent.result, script.structuredContent.result);
});

test("a refusal and a hold come back as they do for exec; confirm is sent as exec sends it", async (t) => {
  const id = "cf_" + "D".repeat(24);
  const { client, requests } = await connected(t, (r) => r.method === "GET" ? [403, { error: { code: "insufficient_scope", message: "This token lacks slates:read.", details: { requiredScope: "slates:read" } } }]
    : [409, { error: { code: "confirmation_required", message: "Confirm.", details: { confirmationId: id, expiresAt: "2026-11-22T21:00:00.000Z", reasons: [{ rule: "removes", shareId: "demo", count: 1 }] } } }, { "slatebox-exec-held": id }]);
  const refused = await client.callTool({ name: "get_slate", arguments: { shareId: "demo" } });
  assert.equal(refused.isError, true);
  assert.equal(refused.structuredContent.error.code, "insufficient_scope");
  assert.match(refused.content[0].text, /^get_slate: insufficient_scope: /);
  const args = { shareId: "demo", expectedRevision: 4, plan: { message: "x", operations: [{ kind: "delete_nodes", target: { ids: ["a"] } }] } };
  const held = await client.callTool({ name: "edit_slate", arguments: { ...args, idempotencyKey: "del-1" } });
  assert.equal(held.isError, false);
  assert.equal(held.structuredContent.status, "confirmation_required");
  assert.match(held.content[0].text, new RegExp(`call edit_slate again with the same arguments plus confirm "${id}" and idempotencyKey "del-1"`));
  assert.equal(requests.at(-1).body.confirm, undefined, "confirm and idempotencyKey are exec's, never the method's");
  assert.equal(requests.at(-1).body.idempotencyKey, undefined);
  await client.callTool({ name: "edit_slate", arguments: { ...args, confirm: id, idempotencyKey: "del-1" } });
  assert.equal(requests.at(-1).headers["slatebox-exec-confirm"], id);
  assert.equal(requests.at(-1).headers["slatebox-exec-key"], "del-1");
});

test("prompts and resources: listed, filled and read (a slate through exec)", async (t) => {
  const { client, requests } = await connected(t, ok);
  assert.deepEqual((await client.listPrompts()).prompts.map((p) => p.name), ["mind_map", "flowchart", "project_plan", "presentation"]);
  const filled = await client.getPrompt({ name: "project_plan", arguments: { project: "a launch", weeks: "6 weeks" } });
  assert.match(filled.messages[0].content.text, /project plan for a launch, over 6 weeks/);
  await assert.rejects(() => client.getPrompt({ name: "flowchart", arguments: {} }), /needs process/);
  assert.deepEqual((await client.listResources()).resources.map((r) => r.uri), ["slatebox://client/slatebox.d.ts", "slatebox://client/guide.md"]);
  assert.equal((await client.listResourceTemplates()).resourceTemplates.length, 2);
  const types = await client.readResource({ uri: "slatebox://client/slatebox.d.ts" });
  assert.equal(types.contents[0].text, await readFile(new URL("slatebox.d.ts", generatedDir), "utf8"));
  const guide = await client.readResource({ uri: "slatebox://client/guide.md" });
  assert.equal(guide.contents[0].text, hosted.clientGuide(generated.manifest));
  const json = await client.readResource({ uri: "slatebox://slates/demo" });
  assert.deepEqual(JSON.parse(json.contents[0].text), slate);
  const mermaid = await client.readResource({ uri: "slatebox://slates/demo/mermaid" });
  assert.equal(mermaid.contents[0].text, "flowchart LR\n  a[\"A\"]");
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /\/api\/v1\/slates\/demo\/mermaid/);
  await assert.rejects(() => client.readResource({ uri: "slatebox://nope" }), /no resource/);
});

test("the same arguments in another key order are the same code, so a confirmation still matches", () => {
  const tool = file.typed.find((t) => t.name === "update_ai_settings");
  const held = local.typedExecArgs(tool, { level: "me", connections: [{ name: "a", type: "openai", capabilities: { tools: true, vision: false } }] });
  const confirmed = local.typedExecArgs(tool, { confirm: "cf_" + "a".repeat(24), idempotencyKey: "k", connections: [{ capabilities: { vision: false, tools: true }, type: "openai", name: "a" }], level: "me" });
  assert.equal(confirmed.code, held.code);
  assert.equal(JSON.parse(JSON.parse(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)/.exec(held.code)[1])).connections[0].name, "a");
  assert.ok(held.code.indexOf("capabilities") < held.code.indexOf("name") && held.code.indexOf("connections") < held.code.indexOf("level"));
});

test("the package's typed-tool mapping answers exactly as the app's", () => {
  for (const tool of file.typed) {
    for (const args of [{}, { shareId: "demo" }, { shareId: "x", plan: { a: [1, "two"] }, confirm: "cf_" + "a".repeat(24), idempotencyKey: "k" }, { text: " \"'`${x}`" },
      { z: 1, a: { y: [{ b: 2, a: 1 }], x: null } }])
      assert.deepEqual(local.typedExecArgs(tool, args), hosted.typedExecArgs(tool, args), `${tool.name} ${JSON.stringify(args)}`);
    for (const output of [{ status: "completed", result: { a: 1 } }, { status: "failed", error: { code: "x", message: "y" } },
      { status: "confirmation_required", idempotencyKey: "k", confirmation: { id: "cf_1", reasons: [{ rule: "removes", shareId: "s", count: 2 }] } }])
      assert.deepEqual(local.typedToolResult(tool, output), hosted.typedToolResult(tool, output));
  }
  for (const prompt of file.prompts)
    for (const args of [{ topic: "t", process: "p", project: "q" }, { topic: "t", process: "p", project: "q", weeks: "3 weeks", slides: "4 slides" }])
      assert.deepEqual(local.promptMessages(prompt, args), hosted.promptMessages(prompt, args));
  for (const uri of ["slatebox://slates/demo", "slatebox://slates/demo/mermaid", "slatebox://slates/a/b", "x"]) {
    const [a, b] = [local.matchSlateResource(uri, file.resourceTemplates), hosted.matchSlateResource(uri)];
    assert.deepEqual(a && { ...a, template: a.template.name }, b && { ...b, template: b.template.name }, uri);
    if (a) assert.deepEqual(local.resourceExecArgs(a.template, a.shareId), hosted.resourceExecArgs(b.template, b.shareId));
  }
  assert.equal(local.clientGuide(generated.manifest), hosted.clientGuide(generated.manifest));
  assert.deepEqual([...local.PROMOTIONAL_WORDS], hosted.PROMOTIONAL_WORDS);
});
