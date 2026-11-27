// The server side of the Slatebox viewer app (iOS and Android), whichever shell wraps it:
//   - a first-party public OAuth client (web/app/server/oauth/viewer.mjs): authorization code with
//     PKCE S256 back to the app's own scheme, no registration, slates:read and (when the app asks and
//     the person allows) slates:add-photo, its tokens taken on /api/v1 for the viewer's read actions and
//     its one write, slates.addPhoto, and nowhere else (no other write, never /mcp), refresh rotation,
//     and Disconnect in Profile › Developer;
//   - slates.live (GET /api/v1/slates/{shareId}/live): a read-only relay seat after the same access
//     check collaborators.init runs (web/app/server/common/relay-live.mjs);
//   - /.well-known/apple-app-site-association and /.well-known/assetlinks.json from settings.mobile
//     (web/app/server/mobile/app-links.mjs), 404 JSON when not set up;
//   - passkeys from the Android app: android:apk-key-hash origins (web/app/server/passkeys/core.mjs).
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import express from "express";
import { test } from "node:test";
import * as errors from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { authorizationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import { clientRegistrationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/register.js";
import { revocationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/revoke.js";
import { metadataHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/metadata.js";
import { mountHttp } from "../web/app/server/actions/http.mjs";
import { gatedRegistry } from "../web/app/server/exec/system.mjs";
import { EXEC_LIMITS } from "../web/app/server/exec/limits.mjs";
import { principalFromToken } from "../web/app/server/actions/principal.mjs";
import { createAppRegistry } from "../web/app/server/actions/index.mjs";
import { API_TOKEN_SCOPES, createApiTokenService, hashApiToken } from "../web/app/server/api-token-core.mjs";
import { createOAuthCore } from "../web/app/server/oauth/core.mjs";
import { mountOAuth } from "../web/app/server/oauth/routes.mjs";
import { MOVE_ACTIONS, MOVE_RESOURCE_PATH } from "../web/app/server/oauth/device.mjs";
import {
  VIEWER_ACTIONS, VIEWER_CLIENT_ID, VIEWER_CONSENT_NAME, VIEWER_READ_ACTIONS, VIEWER_REDIRECTS, VIEWER_RESOURCE_PATH, VIEWER_SCOPES, apiAudiences, viewerClient,
} from "../web/app/server/oauth/viewer.mjs";
import { createRelayLive } from "../web/app/server/common/relay-live.mjs";
import { verifyRoomToken } from "../web/app/server/common/relay-token.mjs";
import { APP_LINK_PATHS, appleAppSiteAssociation, assetLinks, mountAppLinks } from "../web/app/server/mobile/app-links.mjs";
import { ANDROID_APP_ORIGIN, relyingParty } from "../web/app/server/passkeys/core.mjs";
import { makeExecWorld } from "./exec-test-world.mjs";
import { memoryMeteorCollection } from "./action-test-stores.mjs";

const handlers = { authorizationHandler, tokenHandler, clientRegistrationHandler, revocationHandler, metadataHandler };
const START = 1_800_000_000_000;
const RELAY = { publicKey: "pk-test", secretKey: "sk-test-secret" };
const WS_URL = "wss://relay.slatebox.test";
const APP_REDIRECT = VIEWER_REDIRECTS[0];

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

async function setup(t, { settings: extra = {} } = {}) {
  const world = makeExecWorld({ limits: { ...EXEC_LIMITS, cpuMs: 1500, wallMs: 8000 } });
  t.after(() => world.close());
  world.users.docs.push({ _id: "guest", isAnonymous: true });
  let clock = START;
  const now = () => clock;
  // The viewer is off until its redirects are set, so every world sets them unless a test says otherwise.
  const settings = { slateboxAPI: RELAY, public: { wsUrl: WS_URL }, mobile: { redirects: [APP_REDIRECT] }, ...extra };
  const service = createApiTokenService({
    apiTokens: world.tokens,
    users: world.users,
    slates: { findOneAsync: async ({ shareId }) => world.slate(shareId) },
    slateAccess: { find: () => ({ fetchAsync: async () => [] }) },
    now,
  });
  // The reads a viewer makes, over the world's slates (the app's own stores in server/actions/mount.js).
  world.deps.listSlates = async ({ userId }) => world.slates.filter((slate) => slate.userId === userId);
  world.deps.appOrigin = () => "https://slatebox.test";
  world.deps.loadUser = async (userId) => world.users.docs.find((doc) => doc._id === userId) || null;
  world.deps.comments = { list: async () => [] };
  world.deps.userName = async () => "Ada";
  world.deps.latestPresentation = async () => null;
  // slates.live: relayAccess over the world's slates; nobody holds a grant.
  const findSlate = async (query) => {
    const or = query.$or || [query];
    return world.slates.find((slate) => or.some((q) => (q.shareId && slate.shareId === q.shareId) || (q._id && slate._id === q._id) || (q["options.url_name"] && slate.options?.url_name === q["options.url_name"]))) || null;
  };
  world.deps.relayLive = createRelayLive({
    stores: { findSlate, findGrant: async () => null, listGrants: async () => [], isTeamAdmin: async () => false, access: { find: () => ({ toArray: async () => [] }) }, guestViews: { findOne: async () => null } },
    loadUser: async (userId) => world.users.docs.find((user) => user._id === userId) || null,
    settings: () => settings,
    now,
  });
  const app = express();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const family = memoryMeteorCollection("family");
  const insertFamily = family.insertAsync.bind(family);
  family.insertAsync = async (doc) => {
    if (doc._id && family.docs.some((d) => d._id === doc._id)) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    return insertFamily(doc);
  };
  const stores = { clients: memoryMeteorCollection("client"), requests: memoryMeteorCollection("request"), codes: memoryMeteorCollection("code"), refreshFamily: family };
  const viewer = viewerClient(settings);
  const core = createOAuthCore({ ...stores, apiTokens: world.tokens, users: world.users, origin, errors, now, firstParty: [viewer].filter(Boolean) });
  mountOAuth(app, { express, handlers, core, rateLimit: false, scopes: world.registry.neededScopes() });
  // /api/v1 as server/actions/mount.js authenticates it.
  const audiences = apiAudiences({ origin, viewer });
  const authenticate = async (req) => principalFromToken(await service.authenticateApiRequest(req, { audience: Object.keys(audiences) }), { audiences });
  mountHttp(app, gatedRegistry(world.registry, world.exec.gate), { express, authenticate });
  // /mcp as server/mcp/meteor.js authenticates it: the /mcp resource only.
  const mcpPrincipal = async (bearer) =>
    principalFromToken(await service.authenticateApiRequest({ headers: { authorization: `Bearer ${bearer}` } }, { audience: core.urls.resource }));

  const json = async (response) => ({ status: response.status, headers: response.headers, body: await response.json().catch(() => null) });
  const authorize = async (params) => {
    const response = await fetch(`${origin}/oauth/authorize?${new URLSearchParams(params)}`, { redirect: "manual" });
    return { status: response.status, location: response.headers.get("location"), body: response.status === 400 ? await response.json() : null };
  };
  const tokenRequest = async (params) =>
    json(await fetch(`${origin}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) }));
  const requestIdOf = (location) => new URL(location, origin).searchParams.get("request");
  const user = (id) => world.users.docs.find((doc) => doc._id === id);

  // The viewer's sign-in: no registration, the system browser to consent, back to the app's scheme.
  async function signIn({ scope, as = "owner", redirect = APP_REDIRECT, clientId = viewer?.clientId ?? VIEWER_CLIENT_ID, resource } = {}) {
    const { verifier, challenge } = pkce();
    const started = await authorize({
      response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "s-1",
      ...(scope !== undefined && { scope }), ...(resource && { resource }),
    });
    if (started.status !== 302 || !requestIdOf(started.location)) return { started };
    const decided = await core.decide({ requestId: requestIdOf(started.location), user: user(as), allow: true });
    const back = new URL(decided.redirectTo);
    const tokens = await tokenRequest({ grant_type: "authorization_code", client_id: clientId, code: back.searchParams.get("code"), code_verifier: verifier, redirect_uri: redirect });
    return { started, back, tokens: tokens.body, status: tokens.status };
  }
  const api = async (path, bearer, { method = "GET", body } = {}) =>
    json(await fetch(`${origin}/api/v1${path}`, {
      method,
      headers: { ...(bearer && { authorization: `Bearer ${bearer}` }), ...(body !== undefined && { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  return { app, world, core, origin, settings, viewer, service, stores, authorize, tokenRequest, signIn, api, mcpPrincipal, user, tick: (seconds) => (clock += seconds * 1000), now };
}

// ---- the viewer client -------------------------------------------------------------------------

test("the viewer client: off until settings.mobile.redirects is set, 'slatebox-viewer' by default, from settings.mobile otherwise, off when disabled", () => {
  // Restated 2026-11-26 (review finding 1): no default redirect. A server never offers a sign-in back
  // to an app scheme that no released app claims, so with no redirects set the client does not exist.
  assert.equal(viewerClient({}), null);
  assert.equal(viewerClient({ mobile: {} }), null);
  assert.equal(viewerClient({ mobile: { enabled: true } }), null);
  const plain = viewerClient({ mobile: { redirects: [...VIEWER_REDIRECTS] } });
  assert.equal(plain.clientId, "slatebox-viewer");
  assert.deepEqual(plain.redirects, ["com.slatebox.viewer://oauth"]);
  // Restated 2026-11-27 (photos from the phone, owner request): the viewer may also ask to add photos;
  // a sign-in that names no scope still gets reading only.
  assert.deepEqual(plain.scopes, ["slates:read", "slates:add-photo"]);
  assert.deepEqual(plain.defaultScopes, ["slates:read"]);
  assert.equal(plain.resourcePath, VIEWER_RESOURCE_PATH);
  const named = viewerClient({ mobile: { clientId: "acme-viewer", name: "Acme boards", redirects: ["com.acme.boards", "com.acme.boards:/cb", "https://boards.acme.example/app/oauth", "http://evil.example/cb", "javascript:alert(1)", "x://cb#frag", "https", "http", "ftp", "acme"] } });
  assert.equal(named.clientId, "acme-viewer");
  assert.equal(named.name, "Acme boards");
  // A bare reverse-DNS scheme means <scheme>://oauth; https (a universal link) is allowed; never http,
  // script or a fragment. A bare word without a dot ("https", "ftp") is never read as <word>://oauth.
  assert.deepEqual(named.redirects, ["com.acme.boards://oauth", "com.acme.boards:/cb", "https://boards.acme.example/app/oauth"]);
  assert.deepEqual(named.ignored, ["http://evil.example/cb", "javascript:alert(1)", "x://cb#frag", "https", "http", "ftp", "acme"]);
  assert.ok(!named.redirects.some((uri) => uri.endsWith("//oauth") && /^(https?|ftp|acme):/.test(uri)));
  // Nothing usable: off, never a fallback. A malformed id: the default id.
  assert.equal(viewerClient({ mobile: { redirects: ["http://x.example/cb"] } }), null);
  assert.equal(viewerClient({ mobile: { redirects: ["https"] } }), null);
  assert.equal(viewerClient({ mobile: { redirects: [...VIEWER_REDIRECTS], clientId: "a b" } }).clientId, VIEWER_CLIENT_ID);
  assert.equal(viewerClient({ mobile: { enabled: false, redirects: [...VIEWER_REDIRECTS] } }), null);
});

// Restated 2026-11-27 (owner request: take photos with the phone app and drop them into slates): the
// viewer was read only; it now has exactly one write, slates.addPhoto, under its own narrow scope.
test("every viewer action is a read the registry has, except its one write, slates.addPhoto", () => {
  const registry = createAppRegistry();
  for (const id of VIEWER_ACTIONS) {
    const action = registry.get(id);
    assert.ok(action, id);
    assert.ok(action.principals.includes("agent"), id);
    assert.ok(action.mounts.http, id);
    assert.ok(action.scope === null || VIEWER_SCOPES.includes(action.scope), `${id}: ${action.scope}`);
  }
  for (const id of VIEWER_READ_ACTIONS) assert.equal(registry.get(id).kind, "read", id);
  assert.deepEqual([...VIEWER_READ_ACTIONS].sort(), ["account.get", "comments.list", "presentations.get", "slates.get", "slates.list", "slates.live"]);
  assert.deepEqual([...VIEWER_ACTIONS].sort(), [...VIEWER_READ_ACTIONS, "slates.addPhoto"].sort());
  assert.deepEqual(VIEWER_ACTIONS.filter((id) => registry.get(id).kind !== "read"), ["slates.addPhoto"]);
  const photo = registry.get("slates.addPhoto");
  assert.equal(photo.scope, "slates:add-photo");
  assert.deepEqual(photo.alsoScopes, []);
  assert.equal(photo.destructive, false);
});

test("the viewer signs in with PKCE back to its scheme, with no registration, and its token is bound to the viewer resource", async (t) => {
  const { signIn, world, origin, stores } = await setup(t);
  const { back, tokens, status } = await signIn();
  assert.equal(status, 200);
  assert.equal(`${back.protocol}//${back.host}${back.pathname}`, APP_REDIRECT);
  assert.equal(back.searchParams.get("state"), "s-1");
  assert.equal(back.searchParams.get("iss"), origin);
  assert.match(tokens.access_token, /^sbo_/);
  assert.match(tokens.refresh_token, /^sbr_/);
  assert.equal(tokens.scope, "slates:read");
  assert.equal(stores.clients.docs.length, 0, "nothing was registered");
  const row = world.tokens.docs.find((doc) => doc.tokenHash === hashApiToken(tokens.access_token));
  assert.equal(row.kind, "oauth");
  assert.equal(row.clientId, VIEWER_CLIENT_ID);
  assert.equal(row.name, "Slatebox viewer");
  assert.equal(row.resource, origin + VIEWER_RESOURCE_PATH);
  assert.deepEqual(row.scopes, ["slates:read"]);
});

test("the viewer may ask for its own scopes only, at its own resource, back to its own redirects", async (t) => {
  const { authorize, signIn, origin } = await setup(t);
  for (const scope of ["slates:write", "slates:read slates:write", "slates:delete", "team:export", "profile:read"]) {
    const { started } = await signIn({ scope });
    assert.equal(new URL(started.location).searchParams.get("error"), "invalid_scope", scope);
  }
  const mcp = await signIn({ resource: `${origin}/mcp` });
  assert.equal(new URL(mcp.started.location).searchParams.get("error"), "invalid_target");
  // An address the viewer does not own is refused without sending the person anywhere.
  const elsewhere = await authorize({ response_type: "code", client_id: VIEWER_CLIENT_ID, redirect_uri: "com.evil.app://oauth", code_challenge: pkce().challenge, code_challenge_method: "S256" });
  assert.equal(elsewhere.status, 400);
  assert.equal(elsewhere.location, null);
  // PKCE S256 is required.
  const plain = await authorize({ response_type: "code", client_id: VIEWER_CLIENT_ID, redirect_uri: APP_REDIRECT, code_challenge: "x".repeat(43), code_challenge_method: "plain" });
  assert.notEqual(plain.status, 200);
  assert.ok(plain.status === 400 || new URL(plain.location).searchParams.get("error"), "plain PKCE is refused");
  // Its own resource, named explicitly, is fine.
  assert.equal((await signIn({ resource: origin + VIEWER_RESOURCE_PATH, scope: "slates:read" })).status, 200);
});

test("no registration can take the viewer's client id", async (t) => {
  const { core } = await setup(t);
  await assert.rejects(core.provider.clientsStore.registerClient({ client_id: VIEWER_CLIENT_ID, redirect_uris: ["https://evil.example/cb"], token_endpoint_auth_method: "none" }), /taken/);
  const client = await core.provider.clientsStore.getClient(VIEWER_CLIENT_ID);
  assert.deepEqual(client.redirect_uris, [APP_REDIRECT]);
  assert.equal(client.token_endpoint_auth_method, "none");
  assert.equal(client.client_secret, undefined);
});

test("a viewer token reads on /api/v1: account, slates, a slate, its comments, its deck and its live seat", async (t) => {
  const { signIn, api } = await setup(t);
  const { tokens } = await signIn();
  const bearer = tokens.access_token;
  assert.equal((await api("/me", bearer)).status, 200);
  const list = await api("/slates", bearer);
  assert.equal(list.status, 200);
  assert.ok(list.body.slates.some((slate) => slate.shareId === "demo"));
  assert.equal((await api("/slates/demo", bearer)).status, 200);
  assert.equal((await api("/slates/demo/comments", bearer)).status, 200);
  // No deck yet: the action ran and found none (not a refusal of the token).
  const deck = await api("/slates/demo/presentation", bearer);
  assert.ok(![401, 403].includes(deck.status), `presentations.get ${deck.status} ${JSON.stringify(deck.body)}`);
  assert.equal((await api("/slates/demo/live", bearer)).status, 200);
});

test("a viewer token is refused on everything else: every write, and every read it was not made for", async (t) => {
  const { signIn, api, world } = await setup(t);
  const { tokens } = await signIn();
  const bearer = tokens.access_token;
  const refused = (result, what) => {
    assert.equal(result.status, 403, `${what}: ${result.status} ${JSON.stringify(result.body)}`);
    assert.equal(result.body.error.code, "token_not_for_this", what);
    assert.match(result.body.error.message, /mobile app, which reads slates and adds photos/, what);
  };
  refused(await api("/slates/demo/operations", bearer, { method: "POST", body: { plan: { operations: [] } } }), "slates.applyOperations");
  refused(await api("/slates", bearer, { method: "POST", body: { brief: "x" } }), "slates.create");
  refused(await api("/slates/demo", bearer, { method: "DELETE" }), "slates.delete");
  refused(await api("/slates/demo/comments", bearer, { method: "POST", body: { noteId: "welcome", text: "hi" } }), "comments.add");
  refused(await api("/tokens", bearer), "apiTokens.list");
  refused(await api("/exec", bearer, { method: "POST", body: { intent: "x", code: "1" } }), "exec.run");
  // Another server's viewer resource is not this token's.
  const elsewhere = await world.deps.apiTokens.authenticateApiRequest({ headers: { authorization: `Bearer ${bearer}` } }, { audience: Object.keys(apiAudiences({ origin: "http://x.test", viewer: viewerClient({ mobile: { redirects: [APP_REDIRECT] } }) })) });
  assert.equal(elsewhere, null);
});

// The viewer's one write (owner request 2026-11-27): with slates:add-photo, a photo saves as the
// person's own edit; without it the same token reads only. Every other write and /mcp stay refused.
test("a viewer token with slates:add-photo adds a photo and nothing else; one without it is refused for photos", async (t) => {
  const { signIn, api, world, mcpPrincipal } = await setup(t);
  const { cleanPhoto } = await import("../web/app/server/common/photo-clean.mjs");
  const { createHourlyLimit } = await import("../web/app/server/media/media-lookup.mjs");
  const stored = [];
  world.deps.photos = {
    clean: cleanPhoto,
    store: async ({ ext, dryRun }) => { const key = `2026/11/27/u_owner_P${String(stored.length).padStart(16, "0")}.${ext}`; if (!dryRun) stored.push(key); return { key, url: `https://files.slatebox.test/${key}` }; },
    remove: async () => {},
    limit: createHourlyLimit(),
  };
  // A 2 by 2 PNG.
  const photo = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DwHwyBNAMDAE/MB/kL3B0EAAAAAElFTkSuQmCC";
  const { tokens } = await signIn({ scope: "slates:read slates:add-photo" });
  assert.equal(tokens.scope, "slates:read slates:add-photo");
  const bearer = tokens.access_token;
  const added = await api("/slates/demo/photos", bearer, { method: "POST", body: { photo, center: { x: 100, y: 100 } } });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.outcome, "saved");
  assert.ok(world.slate("demo").nodes.some((node) => node.options.id === added.body.nodeId && node.options.image === added.body.url));
  assert.equal(stored.length, 1);
  // Still no other write, and never /mcp.
  const refused = await api("/slates/demo/operations", bearer, { method: "POST", body: { expectedRevision: 0, plan: { message: "x", operations: [] } } });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.code, "token_not_for_this");
  assert.equal(await mcpPrincipal(bearer), null);
  // Signed in for reading only (an older app, or the person unticked photos): photos are refused.
  const readOnly = (await signIn({ scope: "slates:read" })).tokens.access_token;
  const denied = await api("/slates/demo/photos", readOnly, { method: "POST", body: { photo } });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "insufficient_scope");
  assert.match(denied.body.error.message, /Reconnect the app and allow slates:add-photo/);
  assert.equal(stored.length, 1);
});

test("the person may untick photos on the consent page: the viewer then reads only", async (t) => {
  const { authorize, core, tokenRequest, user } = await setup(t);
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const started = await authorize({ response_type: "code", client_id: VIEWER_CLIENT_ID, redirect_uri: APP_REDIRECT, code_challenge: challenge, code_challenge_method: "S256", scope: "slates:read slates:add-photo" });
  const requestId = new URL(started.location, "https://x.test").searchParams.get("request");
  assert.deepEqual((await core.describeRequest(requestId)).scopes, ["slates:read", "slates:add-photo"]);
  const decided = await core.decide({ requestId, user: user("owner"), allow: true, scopes: ["slates:read"] });
  const code = new URL(decided.redirectTo).searchParams.get("code");
  const tokens = await tokenRequest({ grant_type: "authorization_code", client_id: VIEWER_CLIENT_ID, code, code_verifier: verifier, redirect_uri: APP_REDIRECT });
  assert.equal(tokens.body.scope, "slates:read");
});

test("each action outside the viewer's list is refused before it runs", async (t) => {
  const { signIn, api } = await setup(t);
  const { tokens } = await signIn();
  // Every route in the OpenAPI document that is not one of the viewer's actions.
  const openapi = (await api("/openapi.json", tokens.access_token)).body;
  let checked = 0;
  for (const [path, methods] of Object.entries(openapi.paths)) {
    for (const [method, route] of Object.entries(methods)) {
      const id = route["x-slatebox"]?.action;
      if (!id || VIEWER_ACTIONS.includes(id)) continue;
      const concrete = path.replace(/\{[^}]+\}/g, (name) => (name === "{shareId}" ? "demo" : "x1"));
      const result = await api(concrete, tokens.access_token, { method: method.toUpperCase(), ...(method !== "get" && method !== "delete" && { body: {} }) });
      assert.equal(result.status, 403, `${method.toUpperCase()} ${path} (${id}): ${result.status} ${JSON.stringify(result.body)}`);
      assert.equal(result.body.error.code, "token_not_for_this", id);
      checked += 1;
    }
  }
  assert.ok(checked > 40, `checked ${checked}`);
});

test("a viewer token never opens /mcp, an MCP token never opens /api/v1, and a move token stays a move token", async (t) => {
  const { signIn, mcpPrincipal, api, core, world, origin } = await setup(t);
  const { tokens } = await signIn();
  assert.equal(await mcpPrincipal(tokens.access_token), null);
  // An MCP connection (bound to /mcp) is refused on /api/v1, as before.
  const mcpRow = { userId: "owner", kind: "oauth", name: "An MCP app", clientId: "c1", prefix: "p", tokenHash: hashApiToken("sbo_mcp_token"), scopes: [...API_TOKEN_SCOPES], resource: core.urls.resource, createdAt: START, expiresAt: START + 3600_000, refreshExpiresAt: START + 86400_000, revokedAt: null };
  await world.tokens.insertAsync(mcpRow);
  assert.ok(await mcpPrincipal("sbo_mcp_token"));
  assert.equal((await api("/slates/demo", "sbo_mcp_token")).status, 401);
  assert.equal((await api("/me", "sbo_mcp_token")).status, 401);
  // A move's device token: the move actions only, with its own words.
  await world.tokens.insertAsync({ ...mcpRow, tokenHash: hashApiToken("sbo_move_token"), resource: origin + MOVE_RESOURCE_PATH, scopes: ["team:export", "team:move"] });
  const moved = await api("/slates/demo", "sbo_move_token");
  assert.equal(moved.status, 403);
  assert.match(moved.body.error.message, /move a team/);
  assert.ok(MOVE_ACTIONS.length);
  // A personal token is unchanged.
  const { token } = await world.mint(["slates:read", "slates:write"]);
  assert.equal((await api("/slates/demo", token)).status, 200);
});

test("viewer tokens: an hour each, refresh rotates both, a reused refresh token ends the connection", async (t) => {
  const { signIn, tokenRequest, api, tick } = await setup(t);
  const { tokens } = await signIn();
  assert.equal(tokens.expires_in, 3600);
  tick(3601);
  assert.equal((await api("/me", tokens.access_token)).status, 401, "an access token lasts an hour");
  const next = await tokenRequest({ grant_type: "refresh_token", client_id: VIEWER_CLIENT_ID, refresh_token: tokens.refresh_token });
  assert.equal(next.status, 200);
  assert.notEqual(next.body.access_token, tokens.access_token);
  assert.notEqual(next.body.refresh_token, tokens.refresh_token);
  assert.equal(next.body.scope, "slates:read");
  assert.equal((await api("/me", next.body.access_token)).status, 200);
  // A refresh may not widen the viewer's scopes.
  assert.equal((await tokenRequest({ grant_type: "refresh_token", client_id: VIEWER_CLIENT_ID, refresh_token: next.body.refresh_token, scope: "slates:write" })).body.error, "invalid_scope");
  // The first refresh token again: someone holds a copy, so the whole connection ends.
  assert.equal((await tokenRequest({ grant_type: "refresh_token", client_id: VIEWER_CLIENT_ID, refresh_token: tokens.refresh_token })).body.error, "invalid_grant");
  assert.equal((await api("/me", next.body.access_token)).status, 401);
  assert.equal((await tokenRequest({ grant_type: "refresh_token", client_id: VIEWER_CLIENT_ID, refresh_token: next.body.refresh_token })).body.error, "invalid_grant");
});

test("the viewer shows under Profile › Developer › Connected apps, and Disconnect ends it", async (t) => {
  const { signIn, api, tokenRequest, world } = await setup(t);
  const { tokens } = await signIn();
  const person = { kind: "person", userId: "owner", tokenId: null, tokenName: null, scopes: [...API_TOKEN_SCOPES] };
  const listed = (await world.registry.run(person, "apiTokens.list", {})).body.tokens;
  const row = listed.find((r) => r.kind === "oauth" && r.name === "Slatebox viewer");
  assert.ok(row, JSON.stringify(listed));
  assert.deepEqual(row.scopes, ["slates:read"]);
  for (const secret of ["tokenHash", "refreshHash", "clientId", "resource"]) assert.equal(secret in row, false, secret);
  await world.registry.run(person, "apiTokens.revoke", { tokenId: row._id });
  assert.equal((await api("/me", tokens.access_token)).status, 401);
  assert.equal((await tokenRequest({ grant_type: "refresh_token", client_id: VIEWER_CLIENT_ID, refresh_token: tokens.refresh_token })).body.error, "invalid_grant");
});

test("with the viewer turned off, its client id is unknown and nothing is taken for it", async (t) => {
  // Off by enabled: false, and off because no redirect is set (no settings.mobile at all).
  for (const mobile of [{ enabled: false, redirects: [APP_REDIRECT] }, undefined]) {
    const { authorize, viewer } = await setup(t, { settings: { mobile } });
    assert.equal(viewer, null);
    const started = await authorize({ response_type: "code", client_id: VIEWER_CLIENT_ID, redirect_uri: APP_REDIRECT, code_challenge: pkce().challenge, code_challenge_method: "S256" });
    assert.equal(started.status, 400);
    assert.equal(started.body.error, "invalid_client");
  }
});

test("the consent page names the app's scheme as where the person goes back to, not the redirect's host", async (t) => {
  const { authorize, core } = await setup(t);
  const started = await authorize({ response_type: "code", client_id: VIEWER_CLIENT_ID, redirect_uri: APP_REDIRECT, code_challenge: pkce().challenge, code_challenge_method: "S256", scope: "slates:read" });
  assert.equal(started.status, 302);
  const shown = await core.describeRequest(new URL(started.location, "https://x.test").searchParams.get("request"));
  assert.equal(shown.client.redirectHost, "com.slatebox.viewer");
});

test("the consent page names the viewer as Slatebox's own, verified, with its read-only scope", async (t) => {
  const { authorize, core } = await setup(t);
  const started = await authorize({ response_type: "code", client_id: VIEWER_CLIENT_ID, redirect_uri: APP_REDIRECT, code_challenge: pkce().challenge, code_challenge_method: "S256" });
  assert.equal(started.status, 302);
  const shown = await core.describeRequest(new URL(started.location, "https://x.test").searchParams.get("request"));
  assert.deepEqual(shown.client, { name: "Slatebox for iPhone and Android", redirectHost: "com.slatebox.viewer", verified: true });
  assert.deepEqual(shown.scopes, ["slates:read"]);
  assert.equal(VIEWER_CONSENT_NAME, "Slatebox for iPhone and Android");
  // A server that names its viewer shows that name; an unnamed one the consent name.
  assert.equal(viewerClient({ mobile: { redirects: [APP_REDIRECT], name: "Acme boards" } }).consentName, "Acme boards");
  assert.equal(viewerClient({ mobile: { redirects: [APP_REDIRECT] } }).consentName, VIEWER_CONSENT_NAME);
  // settings.example.json (and test and prod) spell out the default name: still the consent name.
  assert.equal(viewerClient({ mobile: { redirects: [APP_REDIRECT], name: "Slatebox viewer" } }).consentName, VIEWER_CONSENT_NAME);
  assert.equal(viewerClient({ mobile: { redirects: [APP_REDIRECT], name: " Slatebox viewer " } }).consentName, VIEWER_CONSENT_NAME);
  assert.equal(viewerClient({ mobile: { redirects: [APP_REDIRECT] } }).name, "Slatebox viewer", "the connection keeps its listed name");
});

// ---- slates.live -------------------------------------------------------------------------------

test("slates.live: a read-only seat in the slate's own room, which the relay accepts for that room only", async (t) => {
  const { signIn, api, world, now } = await setup(t);
  const { tokens } = await signIn();
  const seat = await api("/slates/demo/live", tokens.access_token);
  assert.equal(seat.status, 200);
  assert.equal(seat.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(seat.body).sort(), ["exp", "role", "room", "token", "wsUrl"]);
  assert.equal(seat.body.wsUrl, WS_URL);
  assert.equal(seat.body.role, "read");
  assert.equal(seat.body.room, "slate-1");
  const secretFor = (pk) => (pk === RELAY.publicKey ? RELAY.secretKey : null);
  const claims = verifyRoomToken(seat.body.token, { room: "slate-1", secretFor, now: now() });
  assert.equal(claims.role, "read");
  assert.equal(claims.exp, seat.body.exp);
  // The same token is no good for another slate's room.
  assert.equal(verifyRoomToken(seat.body.token, { room: "slate-3", secretFor, now: now() }), null);
  // Even the owner, who may edit, gets read here; so does a personal token with write.
  const { token } = await world.mint(["slates:read", "slates:write"]);
  const owner = await api("/slates/demo/live", token);
  assert.equal(owner.status, 200);
  assert.equal(owner.body.role, "read");
  assert.equal(verifyRoomToken(owner.body.token, { room: "slate-1", secretFor, now: now() }).role, "read");
});

test("slates.live: no access means nothing: someone else's slate, a made-up one, a signed-out caller on a private one", async (t) => {
  const { api, world } = await setup(t);
  const { token: otherToken } = await world.mint(["slates:read"], "other");
  const theirs = await api("/slates/demo/live", otherToken);
  assert.equal(theirs.status, 403);
  assert.equal(theirs.body.token, undefined);
  assert.ok(!JSON.stringify(theirs.body).includes("wsUrl"));
  const madeUp = await api("/slates/no-such-slate/live", otherToken);
  assert.equal(madeUp.status, 404);
  assert.ok(!JSON.stringify(madeUp.body).includes("token\""));
  const visitor = await api("/slates/demo/live");
  assert.equal(visitor.status, 401);
  assert.equal((await api("/slates/no-such-slate/live")).status, 401);
  // A public slate: a visitor gets a read seat, as the canvas gives a signed-out person.
  const open = await api("/slates/theirs/live");
  assert.equal(open.status, 200);
  assert.equal(open.body.role, "read");
  assert.equal(open.body.room, "slate-2");
  // A token without slates:read gets nothing.
  const { token: bare } = await world.mint(["profile:read"]);
  assert.equal((await api("/slates/demo/live", bare)).status, 403);
});

test("slates.live: the relay's own check is asked too, and a refusal there gives nothing", async (t) => {
  const { api, world } = await setup(t);
  const { token } = await world.mint(["slates:read"]);
  const live = world.deps.relayLive.live;
  world.deps.relayLive.live = async () => ({ code: "no-access" });
  const refused = await api("/slates/demo/live", token);
  assert.equal(refused.status, 404);
  assert.equal(refused.body.token, undefined);
  world.deps.relayLive.live = live;
  assert.equal((await api("/slates/demo/live", token)).status, 200);
});

test("slates.live: 503 when the relay is not set up", async (t) => {
  const { api, world } = await setup(t, { settings: { slateboxAPI: {} } });
  const { token } = await world.mint(["slates:read"]);
  const off = await api("/slates/demo/live", token);
  assert.equal(off.status, 503);
  assert.equal(off.body.error.code, "unavailable");
});

test("relay-live core: always readOnly, role read, and only for an account that exists", async () => {
  const asked = [];
  const slate = { _id: "s1", shareId: "share-1", userId: "u1", options: { id: "room-1" } };
  const stores = {
    findSlate: async (query) => (query.$or?.some((q) => q.shareId === "share-1") || query._id === "s1" ? slate : null),
    findGrant: async () => null, listGrants: async () => [], isTeamAdmin: async () => false,
    access: { find: () => { asked.push("access"); return { toArray: async () => [] }; } },
    guestViews: { findOne: async () => { asked.push("guestViews"); return null; } },
  };
  const live = createRelayLive({ stores, loadUser: async (id) => (id === "u1" ? { _id: "u1" } : null), settings: () => ({ slateboxAPI: RELAY, public: { wsUrl: WS_URL } }) });
  const seat = await live.live({ userId: "u1", shareId: "share-1" });
  assert.equal(seat.code, "ok");
  assert.equal(seat.role, "read");
  assert.equal(seat.room, "room-1");
  // The write check (canEditNativeSlate) never runs: read only was asked.
  assert.deepEqual(asked, []);
  assert.deepEqual(await live.live({ userId: "gone", shareId: "share-1" }), { code: "no-access" });
  assert.deepEqual(await live.live({ userId: null, shareId: "share-1" }), { code: "no-access" });
  assert.deepEqual(await live.live({ userId: "u1", shareId: "nope" }), { code: "slate-not-found" });
  assert.deepEqual(await live.live({ userId: "u1" }), { code: "invalid-slate" });
});

// ---- the well-known files ------------------------------------------------------------------------

const IOS = ["ABCDE12345.com.slatebox.viewer"];
const FINGERPRINT = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");
const MOBILE = { ios: { appIds: IOS }, android: { package: "com.slatebox.viewer", sha256: [FINGERPRINT.toLowerCase()] } };

async function linkServer(t, settings) {
  const app = express();
  mountAppLinks(app, { settings: () => settings });
  // Stands in for the app's own page, which Meteor serves after these routes.
  app.use((_req, res) => res.type("html").send("<!doctype html><p>app</p>"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("apple-app-site-association: applinks for /canvas/* and /present/*, and webcredentials, as application/json", async (t) => {
  const base = await linkServer(t, { mobile: MOBILE });
  const response = await fetch(base + APP_LINK_PATHS.apple, { redirect: "manual" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/json/);
  const body = await response.json();
  assert.deepEqual(body, {
    applinks: { details: [{ appIDs: IOS, components: [{ "/": "/canvas/*" }, { "/": "/present/*" }] }] },
    webcredentials: { apps: IOS },
  });
});

test("assetlinks.json: App Links and shared sign-ins for the package and its fingerprints, as application/json", async (t) => {
  const base = await linkServer(t, { mobile: MOBILE });
  const response = await fetch(base + APP_LINK_PATHS.android, { redirect: "manual" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/json/);
  assert.deepEqual(await response.json(), [{
    relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
    target: { namespace: "android_app", package_name: "com.slatebox.viewer", sha256_cert_fingerprints: [FINGERPRINT] },
  }]);
});

test("not set up (or malformed): both files answer 404 JSON, never the app's page", async (t) => {
  for (const settings of [{}, { mobile: {} }, { mobile: { ios: { appIds: ["com.slatebox.viewer", "abcde12345.x.y"] }, android: { package: "viewer", sha256: ["AB:CD"] } } }, { mobile: { android: { package: "com.slatebox.viewer" } } }]) {
    const base = await linkServer(t, settings);
    for (const path of [APP_LINK_PATHS.apple, APP_LINK_PATHS.android, APP_LINK_PATHS.apple + "/x", APP_LINK_PATHS.android + "/x"]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 404, `${path} ${JSON.stringify(settings)}`);
      assert.match(response.headers.get("content-type"), /^application\/json/, path);
      assert.equal((await response.json()).error, "not_found", path);
    }
  }
  // Something set up, beneath them: still only the exact file.
  const base = await linkServer(t, { mobile: MOBILE });
  assert.equal((await fetch(base + APP_LINK_PATHS.apple + "/extra")).status, 404);
  assert.equal((await fetch(base + "/canvas/abc")).status, 200, "the app's own pages are untouched");
});

test("the documents keep good ids only, without repeats", () => {
  const aasa = appleAppSiteAssociation({ mobile: { ios: { appIds: [...IOS, IOS[0], "bad", "ABCDE12345.", "ZZZZZ99999.com.acme.app"] } } });
  assert.deepEqual(aasa.applinks.details[0].appIDs, [IOS[0], "ZZZZZ99999.com.acme.app"]);
  assert.equal(appleAppSiteAssociation({ mobile: { ios: { appIds: "ABCDE12345.com.slatebox.viewer" } } }).webcredentials.apps[0], IOS[0]);
  const links = assetLinks({ mobile: { android: { package: "com.slatebox.viewer", sha256: [FINGERPRINT, FINGERPRINT.toLowerCase(), "nope"] } } });
  assert.deepEqual(links[0].target.sha256_cert_fingerprints, [FINGERPRINT]);
  assert.equal(assetLinks({ mobile: { android: { package: "1bad.package", sha256: [FINGERPRINT] } } }), null);
});

test("a write to a well-known file is refused", async (t) => {
  const base = await linkServer(t, { mobile: MOBILE });
  const response = await fetch(base + APP_LINK_PATHS.apple, { method: "POST" });
  assert.equal(response.status, 405);
  assert.match(response.headers.get("content-type"), /^application\/json/);
});

// ---- passkeys from the app --------------------------------------------------------------------

test("passkeys: the Android app's android:apk-key-hash origins join the web origins; anything else there is left out", () => {
  const hash = createHash("sha256").update("signing cert").digest("base64url");
  assert.match(`android:apk-key-hash:${hash}`, ANDROID_APP_ORIGIN);
  const rp = relyingParty({
    rootUrl: "https://app.slatebox.com",
    settings: { mobile: { android: { passkeyOrigins: [`android:apk-key-hash:${hash}`, `android:apk-key-hash:${hash}`, "android:apk-key-hash:short", `ios:bundle-id:${hash}`, "https://evil.example", `android:apk-key-hash:${hash}=`, ` android:apk-key-hash:${hash}`, 42] } } },
  });
  assert.equal(rp.rpId, "app.slatebox.com", "the relying party is unchanged");
  assert.deepEqual(rp.origins, ["https://app.slatebox.com", `android:apk-key-hash:${hash}`]);
  assert.deepEqual(rp.ignored, ["android:apk-key-hash:short", `ios:bundle-id:${hash}`, "https://evil.example", `android:apk-key-hash:${hash}=`, ` android:apk-key-hash:${hash}`, "42"]);
});

test("passkeys: the web rules do not loosen; an app origin is never a web origin, and extraOrigins still refuses app origins", () => {
  const hash = createHash("sha256").update("signing cert").digest("base64url");
  const rp = relyingParty({ rootUrl: "https://app.slatebox.com", settings: { passkeys: { extraOrigins: [`android:apk-key-hash:${hash}`, "https://other.example"] } } });
  assert.deepEqual(rp.origins, ["https://app.slatebox.com"]);
  assert.deepEqual(rp.ignored, [`android:apk-key-hash:${hash}`, "https://other.example"]);
  // Turned off still means off, whatever the app settings say.
  assert.ok(relyingParty({ rootUrl: "https://app.slatebox.com", settings: { passkeys: { enabled: false }, mobile: { android: { passkeyOrigins: [`android:apk-key-hash:${hash}`] } } } }).off);
  assert.ok(relyingParty({ rootUrl: "http://boards.example.com", settings: { mobile: { android: { passkeyOrigins: [`android:apk-key-hash:${hash}`] } } } }).off);
  // Not a list: nothing added.
  assert.deepEqual(relyingParty({ rootUrl: "https://app.slatebox.com", settings: { mobile: { android: { passkeyOrigins: `android:apk-key-hash:${hash}` } } } }).origins, ["https://app.slatebox.com"]);
});
