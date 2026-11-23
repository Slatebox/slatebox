// OAuth 2.1 on the hosted MCP endpoint (MCP authorization spec 2026-07-28): protected resource
// metadata (RFC 9728), authorization server metadata (RFC 8414), dynamic client registration
// (RFC 7591), the authorization code grant with PKCE S256 only, resource indicators (RFC 8707)
// binding every token to /mcp, refresh with rotation, revocation (RFC 7009 and Profile →
// Developer), and the consent a signed-in person (never a guest) gives in the Slatebox UI.
// The endpoints are the MCP SDK's own handlers over Slatebox's provider; the tests drive them
// over HTTP, and one drives the SDK's own OAuth client end to end.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import express from "express";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as types from "@modelcontextprotocol/sdk/types.js";
import * as errors from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { authorizationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import { clientRegistrationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/register.js";
import { revocationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/revoke.js";
import { metadataHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/metadata.js";
import { renderExecTool } from "../web/app/server/actions/client-render.mjs";
import { mountMcp } from "../web/app/server/mcp/endpoint.mjs";
import { mountHttp } from "../web/app/server/actions/http.mjs";
import { gatedRegistry } from "../web/app/server/exec/system.mjs";
import { EXEC_LIMITS } from "../web/app/server/exec/limits.mjs";
import { principalFromToken } from "../web/app/server/actions/principal.mjs";
import { API_TOKEN_SCOPES, ACTIVE_TOKEN_LIMIT, createApiTokenService, hashApiToken } from "../web/app/server/api-token-core.mjs";
import {
  ACCESS_TOKEN_SECONDS, CONNECTED_APP_LIMIT, DEFAULT_SCOPES, REFRESH_TOKEN_SECONDS, REQUEST_SECONDS,
  createOAuthCore, oauthUrls,
} from "../web/app/server/oauth/core.mjs";
import { mountOAuth } from "../web/app/server/oauth/routes.mjs";
import { makeExecWorld } from "./exec-test-world.mjs";
import { memoryMeteorCollection } from "./action-test-stores.mjs";

const handlers = { authorizationHandler, tokenHandler, clientRegistrationHandler, revocationHandler, metadataHandler };
const sdk = { Server, StreamableHTTPServerTransport, ...types };
const START = 1_800_000_000_000;

const base64url = (buffer) => buffer.toString("base64url");
const pkce = () => {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
};

async function setup(t) {
  const world = makeExecWorld({ limits: { ...EXEC_LIMITS, cpuMs: 1500, wallMs: 8000 } });
  t.after(() => world.close());
  world.users.docs.push({ _id: "guest", isAnonymous: true });
  let clock = START;
  const now = () => clock;
  const service = createApiTokenService({
    apiTokens: world.tokens,
    users: world.users,
    slates: { findOneAsync: async ({ shareId }) => world.slate(shareId) },
    slateAccess: { find: () => ({ fetchAsync: async () => [] }) },
    now,
  });
  const app = express();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Mongo refuses a second document with the same _id; the family store does too here.
  const family = memoryMeteorCollection("family");
  const insertFamily = family.insertAsync.bind(family);
  family.insertAsync = async (doc) => {
    if (doc._id && family.docs.some((d) => d._id === doc._id)) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    return insertFamily(doc);
  };
  const stores = { clients: memoryMeteorCollection("client"), requests: memoryMeteorCollection("request"), codes: memoryMeteorCollection("code"), refreshFamily: family };
  const core = createOAuthCore({ ...stores, apiTokens: world.tokens, users: world.users, origin, errors, now });
  mountOAuth(app, { express, handlers, core, rateLimit: false, scopes: world.registry.neededScopes() });
  const mcpAuthenticate = async (req) => principalFromToken(await service.authenticateApiRequest(req, { audience: core.urls.resource }));
  const apiAuthenticate = async (req) => principalFromToken(await service.authenticateApiRequest(req));
  mountMcp(app, {
    express, sdk, registry: world.registry, manifest: world.exec.manifest, tools: renderExecTool(world.exec.manifest),
    authenticate: mcpAuthenticate, appOrigin: origin, version: "1.0", resourceMetadata: core.urls.resourceMetadata,
  });
  mountHttp(app, gatedRegistry(world.registry, world.exec.gate), { express, authenticate: apiAuthenticate });

  const json = async (response) => ({ status: response.status, headers: response.headers, body: await response.json().catch(() => null) });
  const register = async (metadata = {}) =>
    json(await fetch(`${origin}/oauth/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Test Agent", redirect_uris: ["http://127.0.0.1:7777/callback"], token_endpoint_auth_method: "none", ...metadata }),
    }));
  // GET /oauth/authorize; the answer is a redirect (to consent, or an error to the client) or a 400.
  const authorize = async (params) => {
    const response = await fetch(`${origin}/oauth/authorize?${new URLSearchParams(params)}`, { redirect: "manual" });
    return { status: response.status, location: response.headers.get("location"), body: response.status === 400 ? await response.json() : null };
  };
  const tokenRequest = async (params) =>
    json(await fetch(`${origin}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) }));
  const revokeRequest = async (params) =>
    fetch(`${origin}/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const requestIdOf = (location) => new URL(location, origin).searchParams.get("request");
  const user = (id) => world.users.docs.find((doc) => doc._id === id);

  // The whole dance for one public client: register, authorize, consent as `as`, exchange.
  async function grant({ scope = "slates:read slates:write", as = "owner", allowScopes, redirect = "http://127.0.0.1:7777/callback" } = {}) {
    const client = (await register({ redirect_uris: [redirect] })).body;
    const { verifier, challenge } = pkce();
    const started = await authorize({
      response_type: "code", client_id: client.client_id, redirect_uri: redirect, code_challenge: challenge,
      code_challenge_method: "S256", state: "s-1", scope, resource: core.urls.resource,
    });
    const decided = await core.decide({ requestId: requestIdOf(started.location), user: user(as), allow: true, scopes: allowScopes });
    const code = new URL(decided.redirectTo).searchParams.get("code");
    const tokens = await tokenRequest({
      grant_type: "authorization_code", client_id: client.client_id, code, code_verifier: verifier, redirect_uri: redirect, resource: core.urls.resource,
    });
    return { client, verifier, code, tokens: tokens.body, status: tokens.status };
  }

  const mcp = async (bearer) => {
    const client = new Client({ name: "oauth-test", version: "1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } }));
    t.after(() => client.close());
    return client;
  };
  const rawMcp = (headers = {}) =>
    fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } } }),
    });
  // One tools/call as plain HTTP, to read the status and headers a host sees.
  const rawCall = async (bearer, name, args) => {
    const response = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }),
    });
    return { status: response.status, challenge: response.headers.get("www-authenticate"), body: await response.json().catch(() => null) };
  };
  const api = (path, bearer) => fetch(`${origin}/api/v1${path}`, { headers: { authorization: `Bearer ${bearer}` } });

  return {
    app, rawCall, world, core, origin, stores, service, register, authorize, tokenRequest, revokeRequest, requestIdOf, user, grant, mcp, rawMcp, api,
    tick: (seconds) => (clock += seconds * 1000),
  };
}

// ---- discovery ------------------------------------------------------------------------------

test("protected resource metadata names /mcp, this server as its authorization server, and the scopes", async (t) => {
  const { app, origin, world } = await setup(t);
  // Stands in for the app's own page, which Meteor serves after these middlewares.
  app.get(["/oauth/consent", "/oauth/consentx"], (_req, res) => res.type("html").send("<p>consent</p>"));
  for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    const body = await response.json();
    assert.equal(body.resource, `${origin}/mcp`);
    assert.deepEqual(body.authorization_servers, [origin]);
    assert.deepEqual(body.scopes_supported, world.registry.neededScopes());
    assert.deepEqual(body.bearer_methods_supported, ["header"]);
    assert.equal(body.resource_name, "Slatebox");
  }
});

test("authorization server metadata: code flow with PKCE S256 only, registration, revocation, iss", async (t) => {
  const { origin, world } = await setup(t);
  const body = await (await fetch(`${origin}/.well-known/oauth-authorization-server`)).json();
  assert.equal(body.issuer, origin);
  assert.equal(body.authorization_endpoint, `${origin}/oauth/authorize`);
  assert.equal(body.token_endpoint, `${origin}/oauth/token`);
  assert.equal(body.registration_endpoint, `${origin}/oauth/register`);
  assert.equal(body.revocation_endpoint, `${origin}/oauth/revoke`);
  assert.deepEqual(body.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(body.response_types_supported, ["code"]);
  assert.deepEqual(body.grant_types_supported, ["authorization_code", "refresh_token"]);
  assert.deepEqual(body.token_endpoint_auth_methods_supported, ["none", "client_secret_post"]);
  assert.deepEqual(body.scopes_supported, world.registry.neededScopes());
  assert.equal(body.authorization_response_iss_parameter_supported, true);
  // MCP clients refuse a server without code_challenge_methods_supported, so it is never absent.
  assert.ok(body.code_challenge_methods_supported.length);
});

test("other /.well-known OAuth and OpenID addresses answer 404 JSON, not the app's page", async (t) => {
  const { app, origin } = await setup(t);
  // Stands in for the app's own page, which Meteor serves after these middlewares.
  app.get(["/oauth/consent", "/oauth/consentx"], (_req, res) => res.type("html").send("<p>consent</p>"));
  for (const path of ["/.well-known/openid-configuration", "/.well-known/oauth-authorization-server/mcp", "/.well-known/oauth-anything"]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 404, path);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.equal((await response.json()).error, "not_found");
  }
});

test("/mcp without a token answers 401 with resource_metadata and every scope a tool needs; a bad token says invalid_token", async (t) => {
  const { rawMcp, core, world } = await setup(t);
  const none = await rawMcp();
  assert.equal(none.status, 401);
  const header = none.headers.get("www-authenticate");
  assert.match(header, /^Bearer /);
  assert.ok(header.includes(`resource_metadata="${core.urls.resourceMetadata}"`), header);
  // Every scope a tool may need, derived from the registry, so a client can ask for all of them
  // at once instead of meeting a 403 on the first share or settings tool.
  const advertised = /scope="([^"]*)"/.exec(header)[1].split(" ");
  assert.deepEqual(advertised, world.registry.neededScopes());
  for (const scope of DEFAULT_SCOPES) assert.ok(advertised.includes(scope), scope);
  assert.ok(advertised.includes("slates:share"), header);
  assert.doesNotMatch(header, /error=/);
  const bad = await rawMcp({ authorization: "Bearer sbo_nope_nope" });
  assert.equal(bad.status, 401);
  assert.match(bad.headers.get("www-authenticate"), /error="invalid_token"/);
  assert.ok(bad.headers.get("www-authenticate").includes(`resource_metadata="${core.urls.resourceMetadata}"`));
});

// ---- registration ---------------------------------------------------------------------------

test("registration: a public client gets no secret; a confidential one's secret is kept only as a hash", async (t) => {
  const { register, stores } = await setup(t);
  const pub = await register();
  assert.equal(pub.status, 201);
  assert.equal(pub.body.client_secret, undefined);
  assert.equal(pub.body.token_endpoint_auth_method, "none");
  assert.equal(pub.body.client_name, "Test Agent");
  const conf = await register({ token_endpoint_auth_method: "client_secret_post" });
  assert.equal(conf.status, 201);
  assert.match(conf.body.client_secret, /^[0-9a-f]{64}$/);
  assert.equal(conf.body.client_secret_expires_at, 0, "a registered secret does not lapse");
  const stored = stores.clients.docs.find((doc) => doc._id === conf.body.client_id);
  assert.ok(stored);
  assert.ok(!JSON.stringify(stored).includes(conf.body.client_secret), "the secret is never stored as sent");
  // No method named: RFC 7591's default (client_secret_basic) is not offered; the server says
  // which one it chose.
  const unnamed = await register({ token_endpoint_auth_method: undefined });
  assert.equal(unnamed.body.token_endpoint_auth_method, "client_secret_post");
});

test("registration refuses redirect addresses a browser could be tricked with", async (t) => {
  const { register } = await setup(t);
  for (const redirect of ["http://example.com/cb", "javascript:alert(1)", "data:text/html,x", "https://ok.example/cb#frag", "file:///etc/passwd"]) {
    const refused = await register({ redirect_uris: [redirect] });
    assert.equal(refused.status, 400, redirect);
    assert.equal(refused.body.error, "invalid_client_metadata", redirect);
  }
  for (const redirect of ["https://claude.ai/api/mcp/auth_callback", "http://localhost:3334/oauth/callback", "http://127.0.0.1:9/cb", "http://[::1]:9/cb", "cursor://anysphere.cursor-mcp/oauth/callback"]) {
    assert.equal((await register({ redirect_uris: [redirect] })).status, 201, redirect);
  }
  assert.equal((await register({ redirect_uris: [] })).status, 400);
  assert.equal((await register({ grant_types: ["client_credentials"] })).status, 400);
  assert.equal((await register({ token_endpoint_auth_method: "private_key_jwt" })).status, 400);
});

// ---- the authorization code flow ------------------------------------------------------------

test("the whole flow: consent as the person, a code bound to the client, tokens bound to /mcp", async (t) => {
  const { grant, mcp, core, world, register, authorize, requestIdOf, user } = await setup(t);
  // The consent screen's view of the request: the app's name, where it sends the person back, the scopes.
  const client = (await register({ client_name: "Claude" })).body;
  const { challenge } = pkce();
  const started = await authorize({
    response_type: "code", client_id: client.client_id, redirect_uri: "http://127.0.0.1:7777/callback", code_challenge: challenge,
    code_challenge_method: "S256", state: "xyz", scope: "slates:read slates:write", resource: core.urls.resource,
  });
  assert.equal(started.status, 302);
  assert.match(started.location, /^\/oauth\/consent\?request=[0-9a-f]{32}$/);
  const shown = await core.describeRequest(requestIdOf(started.location));
  assert.deepEqual(shown, {
    client: { name: "Claude", redirectHost: "127.0.0.1:7777" },
    scopes: ["slates:read", "slates:write"],
    expiresAt: START + REQUEST_SECONDS * 1000,
  });
  const decided = await core.decide({ requestId: requestIdOf(started.location), user: user("owner"), allow: true });
  const back = new URL(decided.redirectTo);
  assert.equal(back.origin + back.pathname, "http://127.0.0.1:7777/callback");
  assert.equal(back.searchParams.get("state"), "xyz");
  assert.equal(back.searchParams.get("iss"), core.urls.issuer);
  assert.match(back.searchParams.get("code"), /^[A-Za-z0-9_-]{43}$/);
  // A decided request cannot be decided again.
  await assert.rejects(core.decide({ requestId: requestIdOf(started.location), user: user("owner"), allow: true }), /no longer waiting/);

  const { tokens, status } = await grant();
  assert.equal(status, 200);
  assert.equal(tokens.token_type, "Bearer");
  assert.equal(tokens.expires_in, ACCESS_TOKEN_SECONDS);
  assert.equal(tokens.scope, "slates:read slates:write");
  assert.match(tokens.access_token, /^sbo_[0-9a-f]{8}_/);
  assert.match(tokens.refresh_token, /^sbr_[0-9a-f]{8}_/);
  const stored = world.tokens.docs.find((doc) => doc.tokenHash === hashApiToken(tokens.access_token));
  assert.equal(stored.kind, "oauth");
  assert.equal(stored.userId, "owner");
  assert.equal(stored.name, "Test Agent");
  assert.equal(stored.resource, core.urls.resource);
  assert.ok(!JSON.stringify(stored).includes(tokens.refresh_token));

  const session = await mcp(tokens.access_token);
  const got = await session.callTool({ name: "get_slate", arguments: { shareId: "demo" } });
  assert.equal(got.isError, false);
  assert.equal(got.structuredContent.status, "completed");
  // The run is the person's: audited under the token the app was given.
  const record = await world.exec.service.get({ tokenId: stored._id, userId: "owner" }, got.structuredContent.execId);
  assert.equal(record.surface, "mcp");
  assert.equal(record.tokenName, "Test Agent");
});

test("PKCE: a request without S256 is refused to the client; a wrong verifier gets invalid_grant", async (t) => {
  const { register, authorize, grant, tokenRequest, core, requestIdOf, user } = await setup(t);
  const client = (await register()).body;
  const params = { response_type: "code", client_id: client.client_id, redirect_uri: "http://127.0.0.1:7777/callback", state: "st" };
  const missing = await authorize(params);
  assert.equal(missing.status, 302);
  assert.equal(new URL(missing.location).searchParams.get("error"), "invalid_request");
  // (The SDK's handler leaves state off an error it finds before reading state; the client still
  // hears invalid_request.)
  const plain = await authorize({ ...params, code_challenge: "abc", code_challenge_method: "plain" });
  assert.equal(new URL(plain.location).searchParams.get("error"), "invalid_request");

  const { challenge } = pkce();
  const started = await authorize({ ...params, code_challenge: challenge, code_challenge_method: "S256" });
  const { redirectTo } = await core.decide({ requestId: requestIdOf(started.location), user: user("owner"), allow: true });
  const code = new URL(redirectTo).searchParams.get("code");
  const wrong = await tokenRequest({ grant_type: "authorization_code", client_id: client.client_id, code, code_verifier: pkce().verifier });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, "invalid_grant");
  const none = await tokenRequest({ grant_type: "authorization_code", client_id: client.client_id, code });
  assert.equal(none.status, 400);
  assert.equal(none.body.error, "invalid_request");
  // The happy path still works for a fresh grant.
  assert.equal((await grant()).status, 200);
});

test("redirects: an unregistered redirect_uri is refused without redirecting; a different one at the token step is invalid_grant", async (t) => {
  const { register, authorize, tokenRequest, core, requestIdOf, user } = await setup(t);
  const client = (await register()).body;
  const { verifier, challenge } = pkce();
  const base = { response_type: "code", client_id: client.client_id, code_challenge: challenge, code_challenge_method: "S256" };
  const evil = await authorize({ ...base, redirect_uri: "https://attacker.example/cb" });
  assert.equal(evil.status, 400);
  assert.equal(evil.location, null);
  assert.equal(evil.body.error, "invalid_request");
  const unknownClient = await authorize({ ...base, client_id: "nope", redirect_uri: "http://127.0.0.1:7777/callback" });
  assert.equal(unknownClient.status, 400);
  assert.equal(unknownClient.body.error, "invalid_client");
  // A loopback redirect may change only its port (RFC 8252).
  const otherPort = await authorize({ ...base, redirect_uri: "http://127.0.0.1:8888/callback" });
  assert.equal(otherPort.status, 302);
  const { redirectTo } = await core.decide({ requestId: requestIdOf(otherPort.location), user: user("owner"), allow: true });
  assert.ok(redirectTo.startsWith("http://127.0.0.1:8888/callback?"));
  const code = new URL(redirectTo).searchParams.get("code");
  const mismatch = await tokenRequest({ grant_type: "authorization_code", client_id: client.client_id, code, code_verifier: verifier, redirect_uri: "http://127.0.0.1:7777/callback" });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.body.error, "invalid_grant");
});

test("a code works once, for its own client, within two minutes; a replay revokes what it issued", async (t) => {
  const { grant, tokenRequest, register, mcp, rawMcp, tick, authorize, core, requestIdOf, user } = await setup(t);
  const first = await grant();
  const replay = await tokenRequest({ grant_type: "authorization_code", client_id: first.client.client_id, code: first.code, code_verifier: first.verifier });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, "invalid_grant");
  assert.equal((await rawMcp({ authorization: `Bearer ${first.tokens.access_token}` })).status, 401, "the replay revoked the first tokens");

  const other = (await register()).body;
  const client = (await register()).body;
  const { verifier, challenge } = pkce();
  const started = await authorize({ response_type: "code", client_id: client.client_id, code_challenge: challenge, code_challenge_method: "S256" });
  const code = new URL((await core.decide({ requestId: requestIdOf(started.location), user: user("owner"), allow: true })).redirectTo).searchParams.get("code");
  const stolen = await tokenRequest({ grant_type: "authorization_code", client_id: other.client_id, code, code_verifier: verifier });
  assert.equal(stolen.body.error, "invalid_grant");
  tick(121);
  const late = await tokenRequest({ grant_type: "authorization_code", client_id: client.client_id, code, code_verifier: verifier });
  assert.equal(late.body.error, "invalid_grant");
  void mcp;
});

test("the person can say no: the client hears access_denied with its state", async (t) => {
  const { register, authorize, core, requestIdOf, user, world } = await setup(t);
  const client = (await register()).body;
  const started = await authorize({ response_type: "code", client_id: client.client_id, code_challenge: pkce().challenge, code_challenge_method: "S256", state: "keep" });
  const { redirectTo } = await core.decide({ requestId: requestIdOf(started.location), user: user("owner"), allow: false });
  const back = new URL(redirectTo);
  assert.equal(back.searchParams.get("error"), "access_denied");
  assert.equal(back.searchParams.get("state"), "keep");
  assert.equal(back.searchParams.get("code"), null);
  assert.equal(world.tokens.docs.length, 0);
});

test("guests and signed-out visitors cannot authorize; the request waits for a real account", async (t) => {
  const { register, authorize, core, requestIdOf, user } = await setup(t);
  const client = (await register()).body;
  const started = await authorize({ response_type: "code", client_id: client.client_id, code_challenge: pkce().challenge, code_challenge_method: "S256" });
  const requestId = requestIdOf(started.location);
  await assert.rejects(core.decide({ requestId, user: user("guest"), allow: true }), (error) => error.code === "guest_account");
  await assert.rejects(core.decide({ requestId, user: null, allow: true }), (error) => error.code === "sign_in_required");
  // A guest cannot even say no on the person's behalf.
  await assert.rejects(core.decide({ requestId, user: user("guest"), allow: false }), (error) => error.code === "guest_account");
  const { redirectTo } = await core.decide({ requestId, user: user("owner"), allow: true });
  assert.ok(new URL(redirectTo).searchParams.get("code"));
});

test("a consent request lapses after ten minutes; an unknown one is refused", async (t) => {
  const { register, authorize, core, requestIdOf, user, tick } = await setup(t);
  const client = (await register()).body;
  const started = await authorize({ response_type: "code", client_id: client.client_id, code_challenge: pkce().challenge, code_challenge_method: "S256" });
  tick(REQUEST_SECONDS + 1);
  await assert.rejects(core.decide({ requestId: requestIdOf(started.location), user: user("owner"), allow: true }), /no longer waiting/);
  assert.equal(await core.describeRequest(requestIdOf(started.location)), null);
  assert.equal(await core.describeRequest("0".repeat(32)), null);
  assert.equal(await core.describeRequest({ $ne: null }), null);
});

// ---- scopes and audience --------------------------------------------------------------------

test("scopes: unknown ones are refused, none means the default, the person may narrow, and a read token cannot write", async (t) => {
  const { register, authorize, grant, mcp, core, requestIdOf, rawCall } = await setup(t);
  const client = (await register()).body;
  const unknown = await authorize({ response_type: "code", client_id: client.client_id, code_challenge: pkce().challenge, code_challenge_method: "S256", scope: "slates:read admin:all" });
  assert.equal(new URL(unknown.location).searchParams.get("error"), "invalid_scope");
  const defaulted = await authorize({ response_type: "code", client_id: client.client_id, code_challenge: pkce().challenge, code_challenge_method: "S256" });
  assert.deepEqual((await core.describeRequest(requestIdOf(defaulted.location))).scopes, DEFAULT_SCOPES);

  const narrowed = await grant({ scope: "slates:read slates:write", allowScopes: ["slates:read", "ai:admin"] });
  assert.equal(narrowed.tokens.scope, "slates:read", "a scope the app did not ask for is never added");
  const session = await mcp(narrowed.tokens.access_token);
  assert.equal((await session.callTool({ name: "get_slate", arguments: { shareId: "demo" } })).isError, false);
  // A read token cannot write, by a typed tool or by exec: refused with the scope challenge
  // (the next test), the refusal text still in the body.
  const edit = await rawCall(narrowed.tokens.access_token, "edit_slate", { shareId: "demo", expectedRevision: 0, plan: { message: "x", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "nope" }] } });
  assert.equal(edit.status, 403);
  assert.equal(edit.body.result.isError, true);
  assert.match(edit.body.result.content[0].text, /insufficient_scope/);
  const exec = await rawCall(narrowed.tokens.access_token, "exec", { intent: "Write", code: 'return await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, plan: { message: "x", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle" }] } })' });
  assert.equal(exec.status, 403);
  assert.match(exec.body.result.content[0].text, /insufficient_scope/);
  // Narrowing to nothing is not a grant.
  const again = await grant({ allowScopes: [] }).catch((error) => error);
  assert.match(String(again.message), /at least one/);
});

test("a connected app lacking a permission gets 403 insufficient_scope naming what to ask for, only when nothing was saved", async (t) => {
  const { grant, rawCall, core, world } = await setup(t);
  const { tokens } = await grant({ scope: "slates:read slates:write" });
  const invite = await rawCall(tokens.access_token, "create_slate_invite", { shareId: "demo", role: "viewer" });
  assert.equal(invite.status, 403);
  assert.match(invite.challenge, /^Bearer /);
  assert.match(invite.challenge, /error="insufficient_scope"/);
  // What the connection has plus what this call needs, so asking again loses nothing.
  assert.deepEqual(/scope="([^"]*)"/.exec(invite.challenge)[1].split(" ").sort(), ["slates:read", "slates:share", "slates:write"]);
  assert.ok(invite.challenge.includes(`resource_metadata="${core.urls.resourceMetadata}"`), invite.challenge);
  // The body is still the tool's result, for a host that reads it rather than the status.
  assert.equal(invite.body.id, 7);
  assert.equal(invite.body.result.isError, true);
  assert.match(invite.body.result.content[0].text, /^create_slate_invite: insufficient_scope: /);
  // An OAuth connection is told to reconnect and allow the permission, never to create a token.
  assert.match(invite.body.result.content[0].text, /Reconnect the app and allow slates:share/);
  assert.doesNotMatch(invite.body.result.content[0].text, /Create a token/);
  // exec: a read before the refused call saved nothing, so the same challenge.
  const read = await rawCall(tokens.access_token, "exec", { intent: "Share", code: 'await slatebox.slates.get({ shareId: "demo" }); return await slatebox.slates.issueInvite({ shareId: "demo", role: "viewer" })' });
  assert.equal(read.status, 403);
  assert.match(read.challenge, /scope="[^"]*slates:share/);
  // A script that saved a change before the refusal answers 200: retrying it after asking for
  // more would save that change twice.
  const before = world.slate("demo").nodes.length;
  const saved = await rawCall(tokens.access_token, "exec", { intent: "Add then share", code: 'await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, plan: { message: "x", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "kept" }] } }); return await slatebox.slates.issueInvite({ shareId: "demo", role: "viewer" })' });
  assert.equal(saved.status, 200);
  assert.equal(saved.challenge, null);
  assert.match(saved.body.result.content[0].text, /insufficient_scope/);
  assert.equal(world.slate("demo").nodes.length, before + 1);
  // A call the connection may make is never challenged.
  const ok = await rawCall(tokens.access_token, "get_slate", { shareId: "demo" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.result.isError, false);
});

test("a personal token keeps the refusal in the tool result (200): it has no sign-in to ask for more", async (t) => {
  const { world, rawCall } = await setup(t);
  const { token } = await world.mint(["slates:read", "slates:write"]);
  const invite = await rawCall(token, "create_slate_invite", { shareId: "demo", role: "viewer" });
  assert.equal(invite.status, 200);
  assert.equal(invite.challenge, null);
  assert.match(invite.body.result.content[0].text, /^create_slate_invite: insufficient_scope: /);
  // A personal token cannot gain a scope: it is told to create one that has it.
  assert.match(invite.body.result.content[0].text, /Create a token that has it/);
});

test("tokens are bound to /mcp: another resource is refused, and an OAuth token does not open /api/v1", async (t) => {
  const { register, authorize, grant, api, world } = await setup(t);
  const client = (await register()).body;
  const elsewhere = await authorize({ response_type: "code", client_id: client.client_id, code_challenge: pkce().challenge, code_challenge_method: "S256", resource: "https://other.example/mcp" });
  assert.equal(new URL(elsewhere.location).searchParams.get("error"), "invalid_target");
  const { tokens } = await grant();
  assert.equal((await api("/slates/demo", tokens.access_token)).status, 401);
  // A personal token keeps working on both.
  const { token } = await world.mint();
  assert.equal((await api("/slates/demo", token)).status, 200);
});

test("personal access tokens keep working on /mcp unchanged", async (t) => {
  const { world, mcp } = await setup(t);
  const { token } = await world.mint(["slates:read"]);
  const session = await mcp(token);
  assert.equal((await session.callTool({ name: "get_slate", arguments: { shareId: "demo" } })).isError, false);
});

test("the consent page is never shown inside another site's frame: both headers, before the app's page", async (t) => {
  const { app, origin } = await setup(t);
  // Stands in for the app's own page, which Meteor serves after these middlewares.
  app.get(["/oauth/consent", "/oauth/consentx"], (_req, res) => res.type("html").send("<p>consent</p>"));
  for (const path of ["/oauth/consent?request=0123456789abcdef0123456789abcdef", "/oauth/consent"]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.headers.get("x-frame-options"), "DENY", path);
    assert.equal(response.headers.get("content-security-policy"), "frame-ancestors 'none'", path);
  }
  // Only the consent page: other addresses keep their own headers.
  assert.equal((await fetch(`${origin}/oauth/consentx`)).headers.get("x-frame-options"), null);
});

// ---- lifetime, refresh and revocation ------------------------------------------------------

test("an access token lasts an hour; refresh rotates both tokens and a reused refresh token ends the connection", async (t) => {
  const { grant, rawMcp, tokenRequest, tick, core } = await setup(t);
  const { tokens, client } = await grant();
  const ok = (bearer) => rawMcp({ authorization: `Bearer ${bearer}` }).then((r) => r.status);
  assert.equal(await ok(tokens.access_token), 200);
  tick(ACCESS_TOKEN_SECONDS + 1);
  assert.equal(await ok(tokens.access_token), 401);

  const refreshed = await tokenRequest({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token, resource: core.urls.resource });
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.body.refresh_token, tokens.refresh_token);
  assert.equal(refreshed.body.expires_in, ACCESS_TOKEN_SECONDS);
  assert.equal(await ok(refreshed.body.access_token), 200);
  // A wider scope than granted is refused; another client cannot use the refresh token.
  const wider = await tokenRequest({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: refreshed.body.refresh_token, scope: "slates:read slates:share" });
  assert.equal(wider.body.error, "invalid_scope");
  // The old refresh token again: someone copied it, so the whole connection ends.
  const reused = await tokenRequest({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token });
  assert.equal(reused.body.error, "invalid_grant");
  assert.equal(await ok(refreshed.body.access_token), 401);
  const after = await tokenRequest({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: refreshed.body.refresh_token });
  assert.equal(after.body.error, "invalid_grant");
});

test("a narrowed refresh narrows that access token only; the connection keeps what the person granted", async (t) => {
  const { grant, tokenRequest } = await setup(t);
  const { tokens, client } = await grant();
  const refresh = (refresh_token, scope) =>
    tokenRequest({ grant_type: "refresh_token", client_id: client.client_id, refresh_token, ...(scope && { scope }) });
  const narrow = await refresh(tokens.refresh_token, "slates:read");
  assert.equal(narrow.status, 200);
  assert.equal(narrow.body.scope, "slates:read");
  // The next refresh without a scope gets the whole grant back, and may ask for any part of it.
  const whole = await refresh(narrow.body.refresh_token);
  assert.equal(whole.status, 200);
  assert.deepEqual(whole.body.scope.split(" ").sort(), ["slates:read", "slates:write"]);
  const write = await refresh(whole.body.refresh_token, "slates:write");
  assert.equal(write.status, 200);
  assert.equal(write.body.scope, "slates:write");
  // Still never more than the grant.
  assert.equal((await refresh(write.body.refresh_token, "slates:share")).body.error, "invalid_scope");
});

// ---- refresh token reuse (OAuth 2.1 §4.3.1, the security BCP's rotation) ----------------------

async function rotations(t, count) {
  const env = await setup(t);
  const { tokens, client } = await env.grant();
  const issued = [tokens];
  for (let i = 0; i < count; i++) {
    const next = await env.tokenRequest({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: issued.at(-1).refresh_token });
    assert.equal(next.status, 200, `rotation ${i + 1}`);
    issued.push(next.body);
  }
  const mcpStatus = (bearer) => env.rawMcp({ authorization: `Bearer ${bearer}` }).then((r) => r.status);
  const refresh = (refresh_token) => env.tokenRequest({ grant_type: "refresh_token", client_id: client.client_id, refresh_token });
  return { ...env, client, issued, mcpStatus, refresh };
}

for (const back of [1, 2, 3]) {
  test(`reusing a refresh token rotated ${back} step${back === 1 ? "" : "s"} back ends the whole connection`, async (t) => {
    const { issued, mcpStatus, refresh, world } = await rotations(t, 3);
    const current = issued.at(-1);
    assert.equal(await mcpStatus(current.access_token), 200);
    const reused = await refresh(issued.at(-1 - back).refresh_token);
    assert.equal(reused.status, 400);
    assert.equal(reused.body.error, "invalid_grant");
    // Every token of the connection is dead: the current access token and refresh token.
    assert.equal(await mcpStatus(current.access_token), 401);
    assert.equal((await refresh(current.refresh_token)).body.error, "invalid_grant");
    const row = world.tokens.docs.find((doc) => doc.kind === "oauth");
    assert.ok(row.revokedAt, "the connection is revoked");
  });
}

test("two refreshes racing with the same token: at most one wins, and the reuse ends the connection", async (t) => {
  const { issued, mcpStatus, refresh } = await rotations(t, 0);
  const [a, b] = await Promise.all([refresh(issued[0].refresh_token), refresh(issued[0].refresh_token)]);
  const won = [a, b].filter((r) => r.status === 200);
  assert.ok(won.length <= 1, "never two new token pairs from one refresh token");
  assert.ok([a, b].some((r) => r.body.error === "invalid_grant"));
  for (const w of won) {
    assert.equal(await mcpStatus(w.body.access_token), 401, "the winner's access token dies with the connection");
    assert.equal((await refresh(w.body.refresh_token)).body.error, "invalid_grant");
  }
  assert.equal(await mcpStatus(issued[0].access_token), 401);
});

test("the rotation family keeps only hashes, and old tokens stay refused after a revoke", async (t) => {
  const { issued, refresh, stores, client, revokeRequest } = await rotations(t, 3);
  const stored = JSON.stringify(stores.refreshFamily.docs);
  assert.equal(stores.refreshFamily.docs.length, 3, "one record per rotated refresh token");
  for (const set of issued) assert.ok(!stored.includes(set.refresh_token) && !stored.includes(set.access_token));
  for (const doc of stores.refreshFamily.docs) assert.match(doc._id, /^[0-9a-f]{64}$/);
  assert.equal((await revokeRequest({ client_id: client.client_id, token: issued.at(-1).refresh_token })).status, 200);
  for (const set of issued) assert.equal((await refresh(set.refresh_token)).body.error, "invalid_grant");
});

test("the family lives as long as the connection: an old token reused after months of refreshes still ends it", async (t) => {
  const { issued, stores, tick, tokenRequest, client } = await rotations(t, 1);
  let latest = issued.at(-1);
  for (let i = 0; i < 3; i++) {
    tick(29 * 24 * 3600);
    const next = await tokenRequest({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: latest.refresh_token });
    assert.equal(next.status, 200);
    latest = next.body;
  }
  // Every record is kept until the connection itself could lapse, never earlier.
  const lapse = Math.max(...stores.refreshFamily.docs.map((d) => d.purgeAt.getTime()));
  for (const doc of stores.refreshFamily.docs) assert.equal(doc.purgeAt.getTime(), lapse, "all records share the connection's lapse");
  const reused = await tokenRequest({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: issued[0].refresh_token });
  assert.equal(reused.body.error, "invalid_grant");
  assert.equal((await tokenRequest({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: latest.refresh_token })).body.error, "invalid_grant");
});

test("a rotated refresh token presented by another client does not end the connection", async (t) => {
  const { issued, register, tokenRequest, mcpStatus } = await rotations(t, 2);
  const stranger = (await register()).body;
  const tried = await tokenRequest({ grant_type: "refresh_token", client_id: stranger.client_id, refresh_token: issued[0].refresh_token });
  assert.equal(tried.body.error, "invalid_grant");
  assert.equal(await mcpStatus(issued.at(-1).access_token), 200);
});

test("a refresh token lapses after thirty days unused, and only its own client may use it", async (t) => {
  const { grant, tokenRequest, tick, register } = await setup(t);
  const { tokens, client } = await grant();
  const other = (await register()).body;
  assert.equal((await tokenRequest({ grant_type: "refresh_token", client_id: other.client_id, refresh_token: tokens.refresh_token })).body.error, "invalid_grant");
  tick(REFRESH_TOKEN_SECONDS + 1);
  assert.equal((await tokenRequest({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token })).body.error, "invalid_grant");
});

test("revocation: the client's own revoke ends the connection; so does Disconnect in Profile → Developer", async (t) => {
  const { grant, rawMcp, revokeRequest, tokenRequest, world } = await setup(t);
  const ok = (bearer) => rawMcp({ authorization: `Bearer ${bearer}` }).then((r) => r.status);
  const first = await grant();
  assert.equal((await revokeRequest({ client_id: first.client.client_id, token: first.tokens.refresh_token, token_type_hint: "refresh_token" })).status, 200);
  assert.equal(await ok(first.tokens.access_token), 401);
  assert.equal((await tokenRequest({ grant_type: "refresh_token", client_id: first.client.client_id, refresh_token: first.tokens.refresh_token })).body.error, "invalid_grant");

  const second = await grant();
  const doc = world.tokens.docs.find((d) => d.tokenHash === hashApiToken(second.tokens.access_token));
  const person = { kind: "person", userId: "owner", tokenId: null, tokenName: null, scopes: [...API_TOKEN_SCOPES] };
  const listed = (await world.registry.run(person, "apiTokens.list", {})).body.tokens;
  const row = listed.find((r) => r._id === doc._id);
  assert.equal(row.kind, "oauth");
  assert.equal(row.name, "Test Agent");
  for (const secret of ["tokenHash", "refreshHash", "refreshHashPrev", "codeHash", "clientId", "resource"]) assert.equal(secret in row, false, secret);
  assert.equal(typeof row.refreshExpiresAt, "number");
  await world.registry.run(person, "apiTokens.revoke", { tokenId: doc._id });
  assert.equal(await ok(second.tokens.access_token), 401);
  assert.equal((await tokenRequest({ grant_type: "refresh_token", client_id: second.client.client_id, refresh_token: second.tokens.refresh_token })).body.error, "invalid_grant");
  // Another client's revoke request for this token does nothing; revoking an unknown token is a 200.
  assert.equal((await revokeRequest({ client_id: second.client.client_id, token: "sbo_nope" })).status, 200);
});

test("connected apps do not use up personal tokens, and an account holds a bounded number of them", async (t) => {
  const { grant, world, service } = await setup(t);
  for (let i = 0; i < ACTIVE_TOKEN_LIMIT; i += 1) assert.equal((await grant()).status, 200);
  assert.equal(await service.countActiveApiTokens("owner"), 0, "app connections are not personal tokens");
  for (let i = ACTIVE_TOKEN_LIMIT; i < CONNECTED_APP_LIMIT; i += 1) await grant();
  await assert.rejects(grant(), /Disconnect one/);
  void world;
});

test("a client using client_secret_post must send its secret; a wrong one is invalid_client", async (t) => {
  const { register, authorize, tokenRequest, core, requestIdOf, user } = await setup(t);
  const client = (await register({ token_endpoint_auth_method: "client_secret_post" })).body;
  const { verifier, challenge } = pkce();
  const started = await authorize({ response_type: "code", client_id: client.client_id, code_challenge: challenge, code_challenge_method: "S256" });
  const code = new URL((await core.decide({ requestId: requestIdOf(started.location), user: user("owner"), allow: true })).redirectTo).searchParams.get("code");
  const params = { grant_type: "authorization_code", client_id: client.client_id, code, code_verifier: verifier };
  assert.equal((await tokenRequest(params)).body.error, "invalid_client");
  assert.equal((await tokenRequest({ ...params, client_secret: "f".repeat(64) })).body.error, "invalid_client");
  const ok = await tokenRequest({ ...params, client_secret: client.client_secret });
  assert.equal(ok.status, 200);
});

test("a deleted or guest account's tokens stop working", async (t) => {
  const { grant, rawMcp, world } = await setup(t);
  const { tokens } = await grant();
  world.users.docs.find((doc) => doc._id === "owner").isAnonymous = true;
  assert.equal((await rawMcp({ authorization: `Bearer ${tokens.access_token}` })).status, 401);
});

// ---- a real MCP client does the dance -------------------------------------------------------

test("the MCP SDK's own OAuth client: discovers, registers, signs in through consent, refreshes and calls a tool", async (t) => {
  const { origin, core, user } = await setup(t);
  const redirect = "http://127.0.0.1:7788/callback";
  const saved = {};
  let consentAt = null;
  const provider = {
    get redirectUrl() { return redirect; },
    get clientMetadata() { return { client_name: "SDK client", redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }; },
    state: () => "sdk-state",
    clientInformation: () => saved.client,
    saveClientInformation: (info) => { saved.client = info; },
    tokens: () => saved.tokens,
    saveTokens: (tokens) => { saved.tokens = tokens; },
    redirectToAuthorization: async (url) => {
      // What a browser does: open the authorize address, land on the consent page.
      const response = await fetch(url, { redirect: "manual" });
      consentAt = new URL(response.headers.get("location"), origin);
    },
    saveCodeVerifier: (verifier) => { saved.verifier = verifier; },
    codeVerifier: () => saved.verifier,
  };
  const first = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { authProvider: provider });
  await assert.rejects(new Client({ name: "sdk", version: "1" }).connect(first), UnauthorizedError);
  assert.equal(consentAt.pathname, "/oauth/consent");
  assert.equal(saved.client.client_name, "SDK client");
  // The person signs in and allows it.
  const { redirectTo } = await core.decide({ requestId: consentAt.searchParams.get("request"), user: user("owner"), allow: true });
  const back = new URL(redirectTo);
  assert.equal(back.searchParams.get("state"), "sdk-state");
  await first.finishAuth(back.searchParams.get("code"));
  assert.match(saved.tokens.access_token, /^sbo_/);
  const client = new Client({ name: "sdk", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { authProvider: provider }));
  t.after(() => client.close());
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "exec"));
  const got = await client.callTool({ name: "get_slate", arguments: { shareId: "demo" } });
  assert.equal(got.isError, false);
});
