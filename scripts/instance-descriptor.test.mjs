// P08: each instance describes itself. GET /api/v1/instance (open to anyone, more with a token)
// and GET /api/v1/me run through the action registry, the same handlers the Developer tab and
// the profile menu call over DDP. Run: node --test scripts/instance-descriptor.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { API_TOKEN_SCOPES, createApiTokenService } from "../web/app/server/api-token-core.mjs";
import { actions, createAppRegistry } from "../web/app/server/actions/index.mjs";
import { defineAction } from "../web/app/server/actions/registry.mjs";
import { buildOpenApi } from "../web/app/server/actions/openapi.mjs";
import { buildContract } from "../web/app/server/actions/contract.mjs";
import { EXEC_LIMITS, publicLimits } from "../web/app/server/exec/limits.mjs";
import { mountDdp } from "../web/app/server/actions/ddp.mjs";
import { RATE_LIMITS } from "../web/app/server/actions/rate-limit.mjs";
import { principalFromToken } from "../web/app/server/actions/principal.mjs";
import { createInstanceDescriber, instanceCapabilities } from "../web/app/server/instance/describe.mjs";
import { resolveInstanceIdentity } from "../web/app/server/instance/identity.mjs";
import { createAccounts } from "../web/app/server/instance/account-summary.mjs";
import { packageVersion } from "../web/app/server/instance/package-version.mjs";
import { createClient } from "../packages/slatebox-mcp/src/client/index.js";
import { memoryDriverCollection, memoryMeteorCollection, serve } from "./action-test-stores.mjs";

const require = createRequire(new URL("../web/app/package.json", import.meta.url));
const { describeOperations, LIMITS } = require("slateboxjs/operations");
const { describeWorkshopEdits } = require("slateboxjs/workshops/model");
const engineVersion = packageVersion(require.resolve("slateboxjs/operations"), "slateboxjs");

// Every value here that is a secret must never appear in any answer.
const SECRETS = ["sk_live_never_shown", "deepinfra-key-never-shown", "daily-key-never-shown", "deepgram-never-shown", "aws-secret-never-shown", "noun-never-shown", "workshop-endpoint-key-never-shown", "slatebox-api-secret-never-shown"];
const cloudSettings = () => ({
  public: { env: "prod", baseUrl: "https://app.slatebox.com" },
  instance: { id: "6f1c2a4e-2d7b-4c55-9a43-6f1b1e0d9c11", name: "Slatebox Cloud" },
  build: { app: "a1b2c3d4e5f6", relay: "0f9e8d7c6b5a" },
  stripePrivateKey: SECRETS[0],
  deepinfra: { apiKey: SECRETS[1] },
  daily: { apiKey: SECRETS[2] },
  deepgram: { secret: SECRETS[3] },
  aws: { secretKey: SECRETS[4], accessKey: "AKIA-not-shown", imageBucket: "bucket", cloudUrl: "https://assets.example" },
  nounProject: { key: "noun", secret: SECRETS[5] },
  slateboxAPI: { publicKey: "pk", secretKey: SECRETS[7] },
  metering: { enabled: true },
});
const selfHostSettings = () => ({
  public: { env: "selfhost", baseUrl: "https://boards.example.org" },
  instance: { id: "0b5d7e8f-1a2b-4c3d-8e9f-a0b1c2d3e4f5" },
  selfHosted: { workshopAI: true },
  ai: { connections: { local: { type: "openai-compatible", baseUrl: "http://10.0.0.5:8080/v1", model: "local", apiKey: SECRETS[6] } }, use: { default: "local" } },
  slateboxAPI: { publicKey: "pk", secretKey: SECRETS[7] },
});


let world;

// cloudKey: whether the server is Slatebox Cloud by its signed Cloud key (server/cloud-lock.mjs).
// Restated (owner decision 2026-11-24): payments are on only with it, so Cloud's world says so.
function makeWorld(settings = cloudSettings(), { cloudKey = settings.public?.env === "prod" } = {}) {
  const users = memoryMeteorCollection("user");
  users.docs.push(
    { _id: "owner", emails: [{ address: "ada@example.com", verified: true }], profile: { firstName: "Ada", lastName: "Lovelace" }, requestingEducationCertification: true },
    { _id: "member", emails: [{ address: "bo@example.com", verified: false }], profile: {}, orgId: "org-1" },
    { _id: "guest", isAnonymous: true, emails: [{ address: "guest-x@anonymous.slatebox.invalid", verified: false }] },
  );
  const organizations = { "org-1": { _id: "org-1", name: "Acme" } };
  const permissions = { member: ["teamAdmin"] };
  const tokens = memoryMeteorCollection("token");
  const service = createApiTokenService({
    apiTokens: tokens,
    users,
    slates: { findOneAsync: async () => null },
    slateAccess: { find: () => ({ fetchAsync: async () => [] }) },
    now: () => 5000,
  });
  const identityRows = memoryDriverCollection();
  // What the meter says is included this month, per person (metering/meteor.js includedThisMonth),
  // and each person's Slatebox Pro (pro-billing.mjs proSummary): the owner has it, the member not.
  const pro = {
    owner: { active: true, status: "active", interval: "year", renewsOn: "2027-11-22T00:00:00.000Z", endsOn: null, cancelAtPeriodEnd: false, trialEndsOn: null, pastDue: false, onHold: false },
  };
  const free = {
    owner: { aiLeftToday: 27, aiPerDay: 30, aiMonthUsedUp: false, voiceHoursLeft: 10, videoHoursLeft: 2, resetsOn: "December 1", balanceCents: 1500, stageNote: null },
    member: { aiLeftToday: 0, aiPerDay: 30, aiMonthUsedUp: true, voiceHoursLeft: 10, videoHoursLeft: 2, resetsOn: "December 1", balanceCents: 0, stageNote: null },
  };
  const generateIds = ["generated-0001-instance"];
  const accounts = createAccounts({
    settings,
    origin: settings.public.baseUrl,
    findUser: async (id) => users.docs.find((user) => user._id === id) || null,
    findOrganization: async (id) => organizations[id] || null,
    listClaims: async (userId) => permissions[userId] || [],
    includedThisMonth: async (user) => free[user._id] ?? null,
    proSummary: (user) => pro[user._id] ?? null,
    canGenerate: async (user) => (free[user._id]?.aiLeftToday ?? 0) > 0,
  });
  const describer = createInstanceDescriber({
    settings,
    origin: settings.public.baseUrl,
    identity: () => resolveInstanceIdentity({ collection: identityRows, configuredId: settings.instance?.id, generateId: () => generateIds.shift() }),
    engine: { version: engineVersion, operations: describeOperations(), workshopEdits: describeWorkshopEdits(), limits: LIMITS },
    actions,
    rateLimits: RATE_LIMITS,
    mailAvailable: () => true,
    accounts,
    cloud: () => cloudKey,
    // the default model's provider has a key in Admin → AI control (the key store, not the settings file)
    aiAvailable: async () => true,
  });
  const deps = { apiTokens: service, instance: describer, accounts };
  const build = () => createAppRegistry({ deps });
  const authenticate = async (req) => principalFromToken(await service.authenticateApiRequest(req));
  const mint = (scopes = ["slates:read"], userId = "owner") => service.createApiToken({ userId, name: "Agent", scopes });
  return { settings, users, organizations, service, deps, build, authenticate, mint, identityRows, free, pro, accounts, describer };
}

beforeEach(() => {
  world = makeWorld();
});

const noSecret = (body) => {
  const text = JSON.stringify(body);
  for (const secret of SECRETS) assert.equal(text.includes(secret), false, `answer leaked ${secret}`);
  assert.equal(/priceId|price_|tokenHash|10\.0\.0\.5/.test(text), false, "answer leaked a price id, token hash or private endpoint");
};
const keysOf = (value, prefix = "") =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort().flatMap((key) => [prefix + key, ...keysOf(value[key], `${prefix}${key}.`)])
    : [];

test("GET /instance answers without a token with identity, contract and how to sign in, and nothing more", async (t) => {
  const call = await serve(t, world.build(), world.authenticate);
  const open = await call("/api/v1/instance");
  assert.equal(open.status, 200);
  assert.equal(open.headers.get("cache-control"), "no-store");
  assert.deepEqual(open.body, {
    view: "public",
    instance: { id: "6f1c2a4e-2d7b-4c55-9a43-6f1b1e0d9c11", name: "Slatebox Cloud", origin: "https://app.slatebox.com" },
    contract: { version: "1.0", major: 1, minor: 0 },
    api: {
      base: "https://app.slatebox.com/api/v1",
      openapi: "https://app.slatebox.com/api/v1/openapi.json",
    },
    signIn: { page: "https://app.slatebox.com/login", tokens: "https://app.slatebox.com/profile?tab=developer", registration: "open" },
    connect: {
      mcp: "npx --no-install slatebox-mcp --base-url https://app.slatebox.com",
      hosted: "https://app.slatebox.com/mcp",
      guide: "https://docs.slatebox.com/developers/slateboxapi/terminal-and-agents/",
    },
    link: { level: "none", policy: null },
  });
  noSecret(open.body);
  // A credential that fails is told so; it does not fall back to the public view.
  const bad = await call("/api/v1/instance", { token: "sbx_nope_nope" });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, "unauthorized");
  // /me is never public.
  const me = await call("/api/v1/me");
  assert.equal(me.status, 401);
});

test("with a token, GET /instance adds build, capabilities, limits, kinds, actions and the caller's account", async (t) => {
  const call = await serve(t, world.build(), world.authenticate);
  const { token } = await world.mint(["slates:read"]);
  const full = await call("/api/v1/instance", { token });
  assert.equal(full.status, 200);
  const body = full.body;
  assert.equal(body.view, "account");
  assert.equal(body.instance.lineage, body.instance.id);
  assert.deepEqual(body.build, { app: "a1b2c3d4e5f6", engine: engineVersion, relay: "0f9e8d7c6b5a" });
  assert.deepEqual(body.capabilities, {
    // transcription is off on a metered server until it is priced (pricing-fixes-switch #2)
    mail: true, calls: true, transcription: false, aiDrafting: { available: true, provider: "slatebox" },
    // Restated (owner decision 2026-11-24): businessCheckout says whether Business is sold in the
    // app (Cloud's key, and both Business prices named in settings: none here)
    billing: true, businessCheckout: false, fileStore: true, render: false, icons: true, customWorkshopKinds: false,
  });
  assert.deepEqual(body.limits, {
    rate: { perToken: 120, perAccount: 240, windowSeconds: 60 },
    canvas: LIMITS,
    // Restated (exec): the largest body a route takes is POST /exec's 128 KiB (a script and its
    // input), and the instance publishes exec's limits beside the others.
    requestBodyBytes: 131072,
    exec: publicLimits(EXEC_LIMITS),
  });
  assert.deepEqual(body.canvas, JSON.parse(JSON.stringify(describeOperations())));
  assert.deepEqual(body.workshops.edits, JSON.parse(JSON.stringify(describeWorkshopEdits())));
  // Every kind the engine plays, the launch plan, sales pipeline and budget among them.
  assert.deepEqual(body.workshops.boards, ["lanes", "release-plan", "customer-interviews", "experiment-budget", "map", "launch-plan", "pipeline", "budget", "hiring-plan", "nest"]);
  // The action list is the registry's own routed list, so an instance never advertises a
  // route it does not serve.
  const routed = actions.filter((action) => action.mounts.http);
  assert.deepEqual(body.actions.map((a) => a.id), routed.map((a) => a.id));
  const edit = body.actions.find((a) => a.id === "slates.applyOperations");
  assert.deepEqual(edit, {
    id: "slates.applyOperations", method: "POST", path: "/api/v1/slates/{shareId}/operations", scope: "slates:write",
    readOnly: false, destructive: true, openWorld: false, modes: ["save", "preview"], tool: "edit_slate",
  });
  // Slatebox has no plans, so the description has no plans field.
  assert.equal("plans" in body, false);
  assert.deepEqual(body.account, (await call("/api/v1/me", { token })).body);
  noSecret(body);
});

test("GET /me returns the caller's account and what is included this month and their Slatebox Pro, and no plan", async (t) => {
  const call = await serve(t, world.build(), world.authenticate);
  const { token, id } = await world.mint(["slates:read", "slates:write"]);
  const me = await call("/api/v1/me", { token });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, {
    id: "owner",
    name: "Ada Lovelace",
    email: "ada@example.com",
    emailVerified: true,
    team: null,
    education: "requested",
    // The meter's own numbers, the ones Profile → Credits shows, and the person's Slatebox Pro.
    ai: { canDraftWorkshops: true, included: world.free.owner, pro: world.pro.owner },
    token: { id, name: "Agent", scopes: ["slates:read", "slates:write"] },
    links: {
      profile: "https://app.slatebox.com/profile",
      developer: "https://app.slatebox.com/profile?tab=developer",
      credits: "https://app.slatebox.com/profile?tab=credits",
      // the in-app pay sheet on Credits (design §3.4): a person pays there, never a token; the
      // owner has Pro, so it opens Your Pro
      pay: "https://app.slatebox.com/profile?tab=credits&pay=manage",
      topUp: "https://app.slatebox.com/profile?tab=credits&pay=topup",
    },
  });
  world.free.owner.aiLeftToday = 0;
  assert.deepEqual((await call("/api/v1/me", { token })).body.ai, { canDraftWorkshops: false, included: { ...world.free.owner, aiLeftToday: 0 }, pro: world.pro.owner });

  // A team member: the team and their claims; no plan, no seats, no billing link.
  const member = await world.mint(["slates:read"], "member");
  const theirs = (await call("/api/v1/me", { token: member.token })).body;
  assert.deepEqual(theirs.team, { id: "org-1", name: "Acme", owner: false, claims: ["teamAdmin"] });
  assert.equal("plan" in theirs, false);
  assert.equal(theirs.emailVerified, false);
  assert.equal(theirs.education, "none");
  assert.equal(theirs.links.billing, undefined);
  assert.equal(theirs.links.plans, undefined);
  assert.equal(theirs.ai.included.aiMonthUsedUp, true);
  // Slatebox Pro is personal: a member without it reads null, and nothing speaks of team plans or seats
  assert.equal(theirs.ai.pro, null);
  assert.doesNotMatch(JSON.stringify(theirs), /Team plan|seat|subscriptionId|customerId/i);
});

test("Cloud and a self-hosted instance answer the same shape with different facts, and self-host has no plans", async (t) => {
  const cloud = await serve(t, world.build(), world.authenticate);
  const cloudToken = (await world.mint()).token;
  const cloudFull = (await cloud("/api/v1/instance", { token: cloudToken })).body;
  const cloudOpen = (await cloud("/api/v1/instance")).body;

  const selfWorld = makeWorld(selfHostSettings());
  const self = await serve(t, selfWorld.build(), selfWorld.authenticate);
  const selfToken = (await selfWorld.mint()).token;
  const selfFull = (await self("/api/v1/instance", { token: selfToken })).body;
  const selfOpen = (await self("/api/v1/instance")).body;

  assert.deepEqual(keysOf(selfOpen), keysOf(cloudOpen));
  // Neither has plans; what is free this month is the meter's, and self-host has no meter.
  const shape = (body) => keysOf(body).filter((key) => !/^(account\.team|account\.links|account\.ai\.included|account\.ai\.pro)\./.test(key));
  assert.deepEqual(shape(selfFull), shape(cloudFull));
  assert.equal(selfOpen.instance.name, "boards.example.org", "the address names an instance that set no name");
  assert.equal(selfFull.instance.id, "0b5d7e8f-1a2b-4c3d-8e9f-a0b1c2d3e4f5");
  assert.deepEqual(selfFull.build, { app: null, engine: engineVersion, relay: null });
  assert.deepEqual(selfFull.capabilities, {
    mail: true, calls: false, transcription: false, aiDrafting: { available: true, provider: "instance" },
    billing: false, businessCheckout: false, fileStore: false, render: false, icons: false, customWorkshopKinds: false,
  });
  assert.equal("plans" in selfFull, false);
  // No plan prompts on self-host: no plan, no education, no meter, no Pro, no Credits link.
  assert.equal("plan" in selfFull.account, false);
  assert.equal(selfFull.account.education, null);
  assert.equal(selfFull.account.ai.included, null);
  assert.equal(selfFull.account.ai.pro, null);
  assert.deepEqual(selfFull.account.links, { profile: "https://boards.example.org/profile", developer: "https://boards.example.org/profile?tab=developer" });
  noSecret(selfFull);
  noSecret(selfOpen);
});

test("AI drafting reads off, or a key in Admin → AI control, as data and never the key; a settings-file key alone does not count", () => {
  const off = selfHostSettings();
  off.selfHosted = { workshopAI: false };
  delete off.ai;
  assert.deepEqual(instanceCapabilities(off, { mailAvailable: () => false }).aiDrafting, { available: false, provider: "none" });
  assert.equal(instanceCapabilities(off, { mailAvailable: () => false }).mail, false);
  const vendor = selfHostSettings();
  vendor.selfHosted = { workshopAI: true };
  delete vendor.ai;
  assert.deepEqual(instanceCapabilities(vendor, { mailAvailable: () => true }).aiDrafting, { available: true, provider: "instance" });
  const cloudNoKey = cloudSettings();
  delete cloudNoKey.deepinfra;
  assert.deepEqual(instanceCapabilities(cloudNoKey, { mailAvailable: () => true }).aiDrafting, { available: false, provider: "none" });
  assert.deepEqual(instanceCapabilities(cloudSettings(), { mailAvailable: () => true }).aiDrafting, { available: false, provider: "none" }, "settings.deepinfra.apiKey is not read");
  assert.deepEqual(instanceCapabilities(cloudNoKey, { mailAvailable: () => true, aiAvailable: true }).aiDrafting, { available: true, provider: "slatebox" });
  const selfOff = selfHostSettings();
  selfOff.selfHosted = { workshopAI: false };
  assert.deepEqual(instanceCapabilities(selfOff, { mailAvailable: () => true, aiAvailable: true }).aiDrafting, { available: true, provider: "instance" }, "a self-hosted server with a model key in Admin → AI control");
});

test("the identity: two starts keep the id; a restore into a new container changes the id and keeps the lineage", async () => {
  const rows = memoryDriverCollection();
  const first = await resolveInstanceIdentity({ collection: rows, configuredId: "aaaaaaaa-0000-4000-8000-000000000001" });
  assert.deepEqual(first, { id: "aaaaaaaa-0000-4000-8000-000000000001", lineage: "aaaaaaaa-0000-4000-8000-000000000001" });
  assert.deepEqual(await resolveInstanceIdentity({ collection: rows, configuredId: "aaaaaaaa-0000-4000-8000-000000000001" }), first);
  // The database restored into a new container, which made its own id at first start.
  const restored = await resolveInstanceIdentity({ collection: rows, configuredId: "bbbbbbbb-0000-4000-8000-000000000002" });
  assert.deepEqual(restored, { id: "bbbbbbbb-0000-4000-8000-000000000002", lineage: "aaaaaaaa-0000-4000-8000-000000000001" });
  const record = [...rows.docs.values()][0];
  assert.deepEqual(record.ids.map((entry) => entry.id), ["aaaaaaaa-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002"]);

  // An install whose settings name no id keeps one generated id in its database.
  const bare = memoryDriverCollection();
  let made = 0;
  const generateId = () => `cccccccc-0000-4000-8000-00000000000${++made}`;
  const once = await resolveInstanceIdentity({ collection: bare, generateId });
  assert.deepEqual(await resolveInstanceIdentity({ collection: bare, generateId }), once);
  assert.equal(made, 1);
  await assert.rejects(resolveInstanceIdentity({ collection: bare, configuredId: "no spaces allowed" }), /instance\.id/);
  // The id is served as a string, so settings must name it as one (review-P08 finding 3).
  await assert.rejects(resolveInstanceIdentity({ collection: bare, configuredId: 12345678 }), /instance\.id/);
});

// The monthly AI credit allowance (counted from AIContent by local month) is gone with the plans:
// the meter counts AI and calls by UTC day and month (scripts/meter-policy.test.mjs).

test("the Developer tab and the profile menu call the same two actions over DDP", async () => {
  const registry = world.build();
  let methods;
  mountDdp(registry, {
    defineMethods: (defined) => (methods = defined),
    makeError: (code, reason, details) => Object.assign(new Error(reason), { error: code, reason, details }),
    loadUser: async (id) => world.users.docs.find((user) => user._id === id),
    scopes: API_TOKEN_SCOPES,
  });
  const signedIn = await methods["instance.describe"].call({ userId: "owner" }, {});
  assert.equal(signedIn.view, "account");
  assert.equal(signedIn.account.token, null, "a session is not a token");
  assert.equal(signedIn.account.name, "Ada Lovelace");
  const signedOut = await methods["instance.describe"].call({ userId: null }, {});
  assert.equal(signedOut.view, "public");
  // A guest account is anyone: it gets the public view, as a stranger does.
  assert.equal((await methods["instance.describe"].call({ userId: "guest" }, {})).view, "public");
  const me = await methods["account.get"].call({ userId: "owner" }, {});
  assert.deepEqual(me, signedIn.account);
  await assert.rejects(methods["account.get"].call({ userId: "guest" }, {}), { error: "registration_required" });
  await assert.rejects(methods["account.get"].call({ userId: null }, {}), { error: "unauthorized" });
});

// Restated (integrate-w2): P07's visitor and P08's public principal are one caller with no
// session and no token, named visitor. A visitor read may need a scope (slates.get): the scope
// is a token's, and what a visitor may read is decided per resource. So the "no scope" half of
// this rule is gone; only a read may admit a visitor, and only beside a token.
test("only a read may be open to a visitor; OpenAPI says the token is optional there", () => {
  const base = {
    id: "things.read", title: "Read", description: "Read.", toolset: "x", kind: "read",
    principals: ["visitor", "agent"], mounts: { http: { method: "GET", path: "/things" } },
    input: { type: "object", properties: {}, additionalProperties: false }, output: { type: "object" }, handler: () => ({}),
  };
  assert.ok(defineAction(base));
  assert.throws(() => defineAction({ ...base, kind: "write", mounts: { http: { method: "POST", path: "/things" } } }), /a visitor only reads/);
  assert.throws(() => defineAction({ ...base, principals: ["visitor", "person"], mounts: { ddp: true } }), /a visitor only reads/);
  const doc = buildOpenApi(world.build());
  assert.deepEqual(doc.paths["/instance"].get.security, [{}, { personalToken: [] }]);
  assert.equal(doc.paths["/me"].get.security, undefined);
  const contract = buildContract(world.build());
  assert.deepEqual(contract.actions.find((a) => a.id === "instance.describe").tool, {
    name: "describe_instance", title: "Describe this instance",
    description: "Describe the Slatebox server these tools talk to: its name, version, what it can do and where its API is.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  });
  assert.equal(contract.actions.find((a) => a.id === "account.get").tool.name, "get_account");
  // The registry's draft CLI names are gone: the CLI reaches every action through slatebox exec.
  assert.ok(contract.actions.every((a) => !("cli" in a)), "no action in the contract carries a cli field");
});

// Restated (exec): the MCP server and the CLI reach these reads through the generated client
// (slatebox.instance.describe and slatebox.account.get in a script), not SlateboxClient methods.
test("the MCP and CLI client reads the instance and the account through the registry's routes", async (t) => {
  const call = await serve(t, world.build(), world.authenticate);
  const { token } = await world.mint();
  const client = createClient({ baseUrl: call.base, token });
  const described = await client.instance.describe({});
  assert.equal(described.view, "account");
  assert.equal(described.instance.id, "6f1c2a4e-2d7b-4c55-9a43-6f1b1e0d9c11");
  assert.equal((await client.account.get({})).email, "ada@example.com");
});

test("the engine version is read from the installed package", () => {
  assert.match(engineVersion, /^\d+\.\d+\.\d+/);
  assert.equal(packageVersion("relative/path.js", "slateboxjs"), null);
});

test("the self-hosted first start writes an instance id with the other secrets", async () => {
  const init = await readFile(new URL("../self-host/init.mjs", import.meta.url), "utf8");
  assert.match(init, /instance: \{ id: randomUUID\(\) \}/);
});

// review-P08 finding 2: the developer link lands on the Developer tab, not on Profile.
test("the developer link opens the profile page on its Developer tab", async () => {
  const page = await readFile(new URL("../web/app/imports/ui/pages/Profile.jsx", import.meta.url), "utf8");
  const developerTab = page.match(/<Tab label="Developer" value=\{(\d+)\} \/>/)?.[1];
  assert.ok(developerTab, "the Developer tab");
  assert.match(page, new RegExp(`TABS = \\{[^}]*developer: ${developerTab}[^}]*\\}`));
  assert.match(page, /useState\(TABS\[searchParams\.get\('tab'\)\] \?\? TABS\.profile\)/);
});
