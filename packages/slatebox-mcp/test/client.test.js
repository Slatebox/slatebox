// The typed HTTP client generated at runtime from client.json.
// Restated (exec): SlateboxClient's hand-written methods (getSlate, applyOperations, ...) are
// replaced by createClient's methods, one per bound action, named by action id. The same
// three behaviours are asserted: the authenticated operation envelope, structured failures,
// and no anonymous access.
import assert from "node:assert/strict";
import test from "node:test";
import { buildRequest, createClient, SlateboxError } from "../src/client/index.js";
import { loadGenerated } from "../src/generated.js";

const generated = loadGenerated();

test("client authenticates and sends the shared operation envelope", async () => {
  let captured;
  const client = createClient({
    baseUrl: "https://slatebox.example.test/",
    token: "sbx_test_secret",
    generated,
    fetch: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    },
  });
  const plan = { message: "Done — three triangles added.", operations: [
    { kind: "add_nodes", count: 3, shape: "triangle", placement: { relativeTo: "welcome", direction: "right" } }] };
  await client.slates.applyOperations(
    { shareId: "abc 123", plan, userMessage: "Add 3 triangles to the right of the welcome node" },
    { idempotencyKey: "request-1" },
  );
  assert.equal(captured.url, "https://slatebox.example.test/api/v1/slates/abc%20123/operations");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.authorization, "Bearer sbx_test_secret");
  assert.equal(captured.options.headers["idempotency-key"], "request-1");
  assert.equal(captured.options.headers["slatebox-exec-id"], undefined, "an ordinary call carries no exec headers");
  const body = JSON.parse(captured.options.body);
  assert.equal(body.plan.operations[0].count, 3);
  assert.equal(body.plan.operations[0].shape, "triangle");
  assert.equal(body.plan.operations[0].placement.relativeTo, "welcome");
  assert.equal(body.userMessage, "Add 3 triangles to the right of the welcome node");
  assert.equal(body.shareId, undefined, "a path field is not repeated in the body");
});

test("client surfaces structured Slatebox API failures", async () => {
  const client = createClient({
    token: "sbx_test_secret",
    generated,
    fetch: async () => new Response(JSON.stringify({ error: { code: "slate_changed", message: "Refresh and retry.", details: { revision: 2 } } }),
      { status: 409, headers: { "retry-after": "3" } }),
  });
  await assert.rejects(
    () => client.slates.get({ shareId: "abc" }),
    (error) => error instanceof SlateboxError && error.status === 409 && error.code === "slate_changed"
      && error.details.revision === 2 && error.retryAfter === 3 && error.message === "Refresh and retry.",
  );
});

test("client requires an API token and never falls back to anonymous access", () => {
  assert.throws(() => createClient({ token: "", generated }), /SLATEBOX_API_TOKEN/);
});

test("the client has a method per bound action and none for token management", () => {
  const client = createClient({ token: "t", generated, fetch: async () => new Response("{}") });
  // Later actions appear on their own (wave 2 adds account and instance); these must be there.
  assert.ok(!("apiTokens" in client) && !("exec" in client));
  for (const name of ["applyOperations", "create", "get", "issueInvite", "revokeInvite"]) assert.equal(typeof client.slates[name], "function", name);
  assert.deepEqual(Object.keys(client).flatMap((area) => Object.keys(client[area]).map((fn) => area + "." + fn)).sort(), [...generated.methods.keys()].sort());
  assert.ok(Object.isFrozen(client) && Object.isFrozen(client.slates));
});

// Restated (release/agentic): with no baseUrl the client calls Slatebox Cloud's app origin,
// which serves /api/v1 (api.slatebox.com is the embed Worker and answers 410 there).
test("a field the route does not carry in its body goes in the query, so the server refuses it by name", async () => {
  const urls = [];
  const client = createClient({ token: "t", generated, fetch: async (url) => { urls.push(String(url)); return new Response("{}"); } });
  await client.slates.get({ shareId: "a", include: "full" });
  await client.slates.get({ shareId: "a", surprise: "x" });
  await client.slates.revokeInvite({ shareId: "a", inviteId: "b", mode: "save" });
  assert.deepEqual(urls, [
    "https://app.slatebox.com/api/v1/slates/a?include=full",
    "https://app.slatebox.com/api/v1/slates/a?surprise=x",
    "https://app.slatebox.com/api/v1/slates/a/invite/b?mode=save",
  ]);
});

// exec-fix-mcp, finding F7: "." and ".." are path segments, not ids, so a URL built from them
// would name another route after normalisation.
test("a path parameter of . or .. is refused before any request", async () => {
  const method = { name: "slates.get", http: { method: "GET", path: "/api/v1/slates/{shareId}", pathParams: ["shareId"], queryParams: [], bodyParams: [] } };
  for (const shareId of [".", ".."]) {
    assert.throws(() => buildRequest("http://127.0.0.1:9", method, { shareId }), (e) => e.code === "invalid_request" && e.details?.field === "shareId", shareId);
  }
  assert.equal(buildRequest("http://127.0.0.1:9", method, { shareId: "a.b" }).url, "http://127.0.0.1:9/api/v1/slates/a.b");
});
