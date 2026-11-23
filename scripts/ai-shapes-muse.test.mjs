// Custom shapes through a connection shaped like Slatebox Cloud's (test and prod): 'meta-muse',
// openai-compatible, model muse-ember-1.0, toolChoice 'auto' (Meta refuses a named or required
// tool choice). A stub OpenAI-compatible server answers the way Muse does: sometimes a real tool
// call, often the JSON in text (a sentence, a ``` fence, or its tool call written out).
//
// The request runs the same modules req.js runs for a chosen connection: connectionRequest,
// localWorkshopRequest (the wire body), sdkChatRequest (the AI SDK), normalizeProviderResponse
// and isAllowedPlainTextResponse. req.js itself needs Meteor, so the two branches it takes after
// normalising are mirrored here, and source guards pin them (and allowPlainText in shapes/meteor.js).
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { connectionRequest } from "../web/app/server/methods/ai/connection-request.mjs";
import { localWorkshopRequest } from "../web/app/server/methods/ai/workshop-provider.mjs";
import { isAllowedPlainTextResponse, normalizeProviderResponse } from "../web/app/server/methods/ai/provider.mjs";
import { operatorConfig, resolveAIChoice } from "../web/app/server/methods/ai/connections.mjs";
import { resolveAIFeatureConfig } from "../web/app/server/methods/ai/feature-config.mjs";
import { SHAPE_FEATURE, readCandidates } from "../web/app/server/shapes/shape-core.mjs";
import { createShapeService } from "../web/app/server/shapes/shape-service.mjs";

const app = (path) => readFile(new URL(`../web/app/${path}`, import.meta.url), "utf8");

const ROCKET = "M50,0 C64,10 72,28 72,50 L72,74 L88,90 L88,100 L70,92 L30,92 L12,100 L12,90 L28,74 L28,50 C28,28 36,10 50,0 Z M41,34 A9,9 0 1 1 59,34 A9,9 0 1 1 41,34 Z M40,92 L50,100 L60,92 Z";
const BUBBLE = "M28,0 H92 Q100,0 100,8 V62 Q100,70 92,70 H28 Q20,70 20,62 V44 L0,52 L20,30 V8 Q20,0 28,0 Z";
const SHIELD = "M50,0 L92,12 V45 C92,72 74,90 50,100 C26,90 8,72 8,45 V12 Z";
const three = [
  { name: "Classic rocket", d: ROCKET, fillRule: "evenodd" },
  { name: "Speech bubble", d: BUBBLE, fillRule: "nonzero" },
  { name: "Shield", d: SHIELD, fillRule: "nonzero" },
];

// What Muse sends back with tool_choice auto, in the forms seen from Llama-family models.
const usage = { prompt_tokens: 812, completion_tokens: 640, total_tokens: 1452 };
const textAnswer = (content) => ({
  id: "chatcmpl-muse-1", object: "chat.completion", created: 1763870000, model: "muse-ember-1.0",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage,
});
const toolCallAnswer = (args) => ({
  id: "chatcmpl-muse-2", object: "chat.completion", created: 1763870000, model: "muse-ember-1.0",
  choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "", tool_calls: [{ id: "call_0", type: "function", function: { name: "propose_shapes", arguments: JSON.stringify(args) } }] } }],
  usage,
});
const MUSE = {
  fenced: textAnswer(
    "Here are three takes on a rocket, each with room in the middle for a short label:\n\n```json\n" +
    JSON.stringify({ shapes: three }, null, 2) +
    "\n```\n\nLet me know if you want a slimmer one {or a different style}.",
  ),
  writtenToolCall: textAnswer(JSON.stringify({ type: "function", name: "propose_shapes", parameters: { shapes: three } })),
  toolCall: toolCallAnswer({ shapes: three }),
  chatty: textAnswer("Sure! A rocket is a great shape for a launch note. I'll draw it as a tall body with fins and a round window."),
};

async function stubMuse(t, answers) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
    const next = answers.shift();
    res.writeHead(next ? 200 : 500, { "content-type": "application/json" });
    res.end(JSON.stringify(next || { error: { message: "no more answers" } }));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${server.address().port}/v1`, seen };
}

// Cloud's connection, as the settings file on test and prod declares it.
const museConnection = (baseUrl) => ({
  name: "meta-muse", type: "openai-compatible", baseUrl, model: "muse-ember-1.0", apiKey: "stub-key-0123456789",
  capabilities: { tools: true }, toolChoice: "auto",
});

// req.js's chosen-connection path (see the header), for one connection.
function viaConnection(connection) {
  return async (options) => {
    const { sdkChatRequest } = await import("../web/app/server/methods/ai/sdk-chat.cjs");
    const config = connectionRequest(connection);
    const ai = localWorkshopRequest(config, { prompts: options.prompts, system: options.system, functions: options.functions, functionCall: options.function_call });
    const raw = await sdkChatRequest({ provider: "connection", endpoint: config.endpoint, apiKey: config.apiKey, body: JSON.parse(ai.body), functions: options.functions, local: true });
    const normalized = normalizeProviderResponse({ provider: "connection", response: raw });
    const { message, toolCall } = normalized;
    if (isAllowedPlainTextResponse({ allowPlainText: options.allowPlainText, message, toolCall })) return { json: { content: message.content }, message, toolCall };
    const json = toolCall ? toolCall.arguments : JSON.parse(normalized.jsonCandidate);
    return { json: typeof json === "string" ? JSON.parse(json) : json, message, toolCall };
  };
}

function museService(connection) {
  let id = 0;
  const request = viaConnection(connection);
  return createShapeService({
    newId: () => `id${++id}`,
    // shapes/meteor.js adds allowPlainText to every shape request
    request: (options) => request({ ...options, allowPlainText: true }),
    run: (fn) => fn(),
    model: "server:meta-muse:muse-ember-1.0",
  });
}
const ada = { userId: "ada", teamId: "team1" };

test("Muse via meta-muse: tool_choice auto on the wire (never named or required), and JSON in a fence after a sentence is read", async (t) => {
  const stub = await stubMuse(t, [MUSE.fenced]);
  const result = await museService(museConnection(stub.base)).generate(ada, { describe: "a rocket", count: 3 });
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(result.candidates.map((c) => c.name), ["Classic rocket", "Speech bubble", "Shield"]);
  assert.equal(result.candidates[0].fillRule, "evenodd");
  const sent = stub.seen[0].body;
  assert.equal(stub.seen.length, 1, "one request, no strict-JSON retries");
  assert.equal(sent.model, "muse-ember-1.0");
  assert.equal(sent.tool_choice, "auto");
  assert.doesNotMatch(JSON.stringify(sent.tool_choice), /required|propose_shapes/);
  assert.equal(sent.tools[0].function.name, "propose_shapes", "the tool is offered");
  assert.equal(stub.seen[0].headers.authorization, "Bearer stub-key-0123456789");
});

test("Muse via meta-muse: a real tool call and a tool call written out as text both work", async (t) => {
  const stub = await stubMuse(t, [MUSE.toolCall, MUSE.writtenToolCall]);
  const service = museService(museConnection(stub.base));
  const first = await service.generate(ada, { describe: "a rocket", count: 3 });
  const second = await service.generate(ada, { describe: "a speech bubble", count: 3 });
  assert.equal(first.candidates.length, 3);
  assert.equal(second.candidates.length, 3);
  for (const seen of stub.seen) assert.equal(seen.body.tool_choice, "auto");
});

test("Muse via meta-muse: a chatty answer with no shapes gets the one retry, which then works", async (t) => {
  const stub = await stubMuse(t, [MUSE.chatty, MUSE.fenced]);
  const result = await museService(museConnection(stub.base)).generate(ada, { describe: "a rocket", count: 3 });
  assert.equal(result.candidates.length, 3);
  assert.equal(stub.seen.length, 2);
  assert.match(JSON.stringify(stub.seen[1].body.messages), /could not be used/);
});

test("readCandidates: wrapped and odd forms (double-encoded arguments, a bare list, path and fill_rule)", () => {
  const encoded = { json: { content: [{ type: "tool_use", name: "propose_shapes", input: JSON.stringify({ shapes: three }) }] } };
  assert.equal(readCandidates(encoded).length, 3);
  assert.equal(readCandidates({ json: JSON.stringify({ shapes: JSON.stringify(three) }) }).length, 3);
  assert.equal(readCandidates({ json: { content: "```\n" + JSON.stringify(three) + "\n```" } }).length, 3);
  const odd = readCandidates({ json: { content: JSON.stringify({ shapes: [{ name: "Shield", path: SHIELD, fill_rule: "evenodd" }] }) } });
  assert.deepEqual(odd, [{ name: "Shield", path: SHIELD, fill_rule: "evenodd", d: SHIELD, fillRule: "evenodd" }]);
  assert.deepEqual(readCandidates({ json: { content: "no shapes {here} at all" } }), []);
  assert.deepEqual(readCandidates(null), []);
});

test("the settings key: ai.use.shape picks the connection, else ai.use.default, else the built-in shape model", () => {
  const connections = [museConnection("https://api.meta.ai/v1")];
  const pick = (use) => resolveAIChoice({ feature: SHAPE_FEATURE, server: { connections, use }, ownProviders: false }).ref;
  assert.equal(pick({ shape: "server:meta-muse" }), "server:meta-muse");
  assert.equal(pick({ default: "server:meta-muse" }), "server:meta-muse");
  // prod today names presentation, generation and chat only: shapes stay on the built-in model
  assert.equal(pick({ presentation: "server:meta-muse", generation: "server:meta-muse", chat: "server:meta-muse" }), "builtin");
  const builtin = resolveAIFeatureConfig(SHAPE_FEATURE, {});
  assert.ok(builtin.provider && builtin.engine, "the built-in shape model is data (ai-defaults.json)");
  assert.equal(resolveAIFeatureConfig(SHAPE_FEATURE, { ai: { features: { shape: { engine: "other" } } } }).engine, "other", "settings.ai.features.shape overrides it");
  // the settings file shape Cloud uses validates with use.shape
  const config = operatorConfig({ ai: { connections: { "meta-muse": { type: "openai-compatible", baseUrl: "https://api.meta.ai/v1", model: "muse-ember-1.0", apiKeyEnv: "META_LLAMA_API_KEY", capabilities: { tools: true }, toolChoice: "auto" } }, use: { shape: "meta-muse" } } });
  assert.ok(config);
});

test("source guards: shape requests take plain text; req.js returns plain text before its strict JSON check", async () => {
  const meteor = await app("server/shapes/meteor.js");
  assert.match(meteor, /req\(\{[^}]*allowPlainText: true/);
  const req = await app("server/methods/ai/req.js");
  const plain = req.indexOf("isAllowedPlainTextResponse({");
  const strict = req.indexOf("if (!utils.isJSON(jsonString))");
  assert.ok(plain > 0 && strict > plain, "plain text is returned before the strict JSON retries");
  assert.match(req, /let jsonString = \(localWorkshop \|\| sdkPath\) && toolCall \? toolCall\.arguments : normalized\.jsonCandidate/);
});
