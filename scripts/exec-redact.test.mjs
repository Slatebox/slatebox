// What a run's record keeps of its code: secret (writeOnly) input fields replaced, in a typed
// tool's one-call script and as literals in a hand-written one; everything else as written.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAppRegistry } from "../web/app/server/actions/index.mjs";
import { typedExecArgs } from "../web/app/server/actions/agent-surface.mjs";
import { createCodeRedactor, REDACTED } from "../web/app/server/exec/redact.mjs";

const redact = createCodeRedactor(createAppRegistry());
const update = { name: "update_ai_settings", title: "Change AI connections and choices", method: "ai.update", kind: "write" };
const check = { name: "check_ai_connection", title: "Test an AI connection", method: "ai.check", kind: "write" };
const get = { name: "get_slate", title: "Read a slate", method: "slates.get", kind: "read" };
const inner = (code) => JSON.parse(JSON.parse(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)\);$/.exec(code)[1]));

test("a typed tool's key is replaced; the rest of its arguments are kept as sent", () => {
  const { code } = typedExecArgs(update, {
    level: "me",
    connections: [{ name: "a", type: "openai", apiKey: "sk-secret-1" }, { name: "b", type: "anthropic", apiKey: "" }, { name: "c", type: "openai" }],
    use: { default: "me:a" },
  });
  const kept = redact(code);
  assert.doesNotMatch(kept, /sk-secret-1/);
  assert.deepEqual(inner(kept), {
    connections: [{ apiKey: REDACTED, name: "a", type: "openai" }, { apiKey: "", name: "b", type: "anthropic" }, { name: "c", type: "openai" }],
    level: "me",
    use: { default: "me:a" },
  });
  const tested = redact(typedExecArgs(check, { connection: { name: "x", type: "openai-compatible", baseUrl: "https://h.test/v1", apiKey: "sk-secret-2" } }).code);
  assert.equal(inner(tested).connection.apiKey, REDACTED);
  assert.equal(inner(tested).connection.baseUrl, "https://h.test/v1");
});

test("code with nothing secret is kept byte for byte", () => {
  for (const code of [
    typedExecArgs(get, { shareId: "demo" }).code,
    typedExecArgs(update, { level: "me", use: { default: "builtin" } }).code,
    'return await slatebox.slates.get({ shareId: "apiKey" })',
    "const apiKey = process.env.KEY; return 1",
  ])
    assert.equal(redact(code), code);
});

test("a key written as a literal in a hand-written script is replaced in every quoting", () => {
  const code = [
    'await slatebox.ai.check({ connection: { name: "a", type: "openai", apiKey: "sk-one" } })',
    "await slatebox.ai.check({ connection: { name: 'b', type: 'openai', 'apiKey': 'sk-two' } })",
    'await slatebox.ai.update({ level: "me", connections: [{ name: "c", type: "openai", "apiKey" : `sk-three` }] })',
    'const notAKey = { myapiKey: "keep-me" }',
  ].join("\n");
  const kept = redact(code);
  for (const secret of ["sk-one", "sk-two", "sk-three"]) assert.doesNotMatch(kept, new RegExp(secret));
  assert.match(kept, /apiKey: "\[redacted\]"/);
  assert.match(kept, /'apiKey': '\[redacted\]'/);
  assert.match(kept, /"apiKey" : `\[redacted\]`/);
  assert.match(kept, /myapiKey: "keep-me"/);
});

// ---------- AI control S3: keys in AI control actions and in provider error text (spec 6.2) ----------
test("a key sent to ai.keys.test is replaced in a run's record", () => {
  const code = 'await slatebox.ai.keys.test({ provider: "gemini", apiKey: "AIzaSyExample000000000000000000000" })';
  const kept = redact(code);
  assert.doesNotMatch(kept, /AIzaSyExample/);
  assert.match(kept, /apiKey: "\[redacted\]"/);
});

test("provider error text loses query strings, the keys it was sent and anything key-like, and is cut to 500 characters", async () => {
  const { redactText, stripQuery } = await import("../web/app/server/exec/redact.mjs");
  assert.equal(stripQuery("https://customsearch.googleapis.com/customsearch/v1?cx=1&key=AIzaSecret#frag"), "https://customsearch.googleapis.com/customsearch/v1");
  const text = redactText(
    'request to https://gen.example.com/v1/models?key=AIzaSy0123456789012345678901 failed; echoed headers: {"authorization":"Bearer sk-live-0123456789abcdefghijklmn","x-api-key":"anthropic-key-0123456789"} my-own-key-0123456789 and Qwen/Qwen3-235B-A22B-Instruct-2507',
    { keys: ["my-own-key-0123456789"] },
  );
  for (const secret of ["AIzaSy0", "sk-live", "anthropic-key-0123456789", "my-own-key-0123456789", "?key="]) assert.ok(!text.includes(secret), `${secret} in ${text}`);
  assert.match(text, /https:\/\/gen\.example\.com\/v1\/models failed/);
  // a model path is not a key
  assert.match(text, /Qwen\/Qwen3-235B-A22B-Instruct-2507/);
  assert.equal(redactText("word ".repeat(200)).length, 500);
  assert.equal(redactText(null), "");
});
