// A whole in-memory Slatebox for the exec tests: accounts and tokens, three slates (yours,
// someone else's public one, and a workshop), the real action registry with the engine's
// canvas reducer and the real workshop core, the real gate, stores and sealed runner. Only the
// database is a stand-in, and it implements just the calls those modules make.
import express from "express";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createApiTokenService } from "../web/app/server/api-token-core.mjs";
import { createAppRegistry } from "../web/app/server/actions/index.mjs";
import { createIdempotencyStore } from "../web/app/server/actions/idempotency.mjs";
import { createRateLimiter } from "../web/app/server/actions/rate-limit.mjs";
import { principalFromToken } from "../web/app/server/actions/principal.mjs";
import { mountHttp } from "../web/app/server/actions/http.mjs";
import { createWorkshopOperations } from "../web/app/server/workshop-operation-api.mjs";
import { createSlateSaveCore } from "../web/app/server/slate-save-core.mjs";
import { createSlateReader } from "../web/app/server/slate-read.mjs";
import { slateVisibility } from "../web/app/server/methods/slate-role.mjs";
import { createExecSystem, gatedRegistry } from "../web/app/server/exec/system.mjs";
import { EXEC_LIMITS } from "../web/app/server/exec/limits.mjs";
import { createInstanceDescriber } from "../web/app/server/instance/describe.mjs";
import { createAccounts } from "../web/app/server/instance/account-summary.mjs";
import { resolveInstanceIdentity } from "../web/app/server/instance/identity.mjs";
import { actions } from "../web/app/server/actions/index.mjs";
import { RATE_LIMITS } from "../web/app/server/actions/rate-limit.mjs";
import { memoryMeteorCollection } from "./action-test-stores.mjs";
import { createAgentPresence } from "../web/app/server/presence/agentPresence.mjs";

const appRequire = createRequire(new URL("../web/app/package.json", import.meta.url));
const { applyPlanToJSON, describeOperations, LIMITS } = appRequire("slateboxjs/operations");
const { createWorkshopMap, describeWorkshopEdits } = appRequire("slateboxjs/workshops/model");

export const CHILD_PATH = fileURLToPath(new URL("../web/app/private/exec/runner-child.mjs", import.meta.url));
export const RUN_ENTRY = appRequire.resolve("run");

// ---- a MongoDB driver collection, in memory -------------------------------------------
const get = (doc, path) => path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), doc);
const set = (doc, path, value) => {
  const keys = path.split(".");
  let at = doc;
  for (const key of keys.slice(0, -1)) at = at[key] && typeof at[key] === "object" ? at[key] : (at[key] = {});
  at[keys.at(-1)] = value;
};
const unset = (doc, path) => {
  const keys = path.split(".");
  const parent = keys.length > 1 ? get(doc, keys.slice(0, -1).join(".")) : doc;
  if (parent) delete parent[keys.at(-1)];
};
const comparable = (value) => (value instanceof Date ? value.getTime() : value);
function matches(doc, selector = {}) {
  return Object.entries(selector).every(([path, want]) => {
    const have = get(doc, path);
    if (want && typeof want === "object" && !(want instanceof Date) && !Array.isArray(want)) {
      return Object.entries(want).every(([op, arg]) => {
        if (op === "$ne") return have !== arg;
        if (op === "$gte") return have !== undefined && comparable(have) >= comparable(arg);
        if (op === "$lte") return have !== undefined && comparable(have) <= comparable(arg);
        if (op === "$gt") return have !== undefined && comparable(have) > comparable(arg);
        if (op === "$lt") return have !== undefined && comparable(have) < comparable(arg);
        if (op === "$in") return arg.includes(have);
        if (op === "$exists") return (have !== undefined) === arg;
        throw new Error("memoryCollection: unsupported selector " + op);
      });
    }
    if (want === null) return have === null || have === undefined;
    return comparable(have) === comparable(want);
  });
}
function applyUpdate(doc, update, inserting) {
  for (const [op, fields] of Object.entries(update)) {
    for (const [path, value] of Object.entries(fields)) {
      if (op === "$set") set(doc, path, structuredClone(value));
      else if (op === "$setOnInsert") { if (inserting) set(doc, path, structuredClone(value)); }
      else if (op === "$inc") set(doc, path, (get(doc, path) || 0) + value);
      else if (op === "$unset") unset(doc, path);
      else if (op === "$min") { const have = get(doc, path); if (have === undefined || have === null || value < have) set(doc, path, value); }
      else if (op === "$push") {
        let list = get(doc, path) || [];
        if (value && typeof value === "object" && "$each" in value) list.push(...structuredClone(value.$each));
        else list.push(structuredClone(value));
        if (value && typeof value === "object" && Number.isInteger(value.$slice)) list = value.$slice < 0 ? list.slice(value.$slice) : list.slice(0, value.$slice);
        set(doc, path, list);
      } else throw new Error("memoryCollection: unsupported update " + op);
    }
  }
}
export function memoryCollection() {
  const docs = new Map();
  const find = (selector) => [...docs.values()].find((doc) => matches(doc, selector));
  return {
    docs,
    async insertOne(doc) {
      if (docs.has(doc._id)) throw Object.assign(new Error("duplicate key"), { code: 11000 });
      docs.set(doc._id, structuredClone(doc));
      return { insertedId: doc._id };
    },
    async findOne(selector) { const found = find(selector); return found ? structuredClone(found) : null; },
    // A cursor's toArray, with a one-key sort (enough for the stores under test).
    find(selector = {}, options = {}) {
      return {
        async toArray() {
          const rows = [...docs.values()].filter((doc) => matches(doc, selector)).map((doc) => structuredClone(doc));
          const [[key, dir] = []] = Object.entries(options.sort || {});
          if (key) rows.sort((a, b) => (comparable(get(a, key)) > comparable(get(b, key)) ? dir : -dir));
          return rows;
        },
      };
    },
    async updateOne(selector, update) {
      const found = find(selector);
      if (!found) return { matchedCount: 0 };
      applyUpdate(found, update, false);
      return { matchedCount: 1 };
    },
    async deleteOne(selector) {
      const found = find(selector);
      if (found) docs.delete(found._id);
      return { deletedCount: found ? 1 : 0 };
    },
    async findOneAndUpdate(selector, update, options = {}) {
      let found = find(selector);
      let inserting = false;
      if (!found && options.upsert) {
        const plain = Object.fromEntries(Object.entries(selector).filter(([, v]) => !v || typeof v !== "object"));
        if (docs.has(plain._id)) throw Object.assign(new Error("duplicate key"), { code: 11000 });
        found = plain;
        docs.set(found._id, found);
        inserting = true;
      }
      if (!found) return null;
      applyUpdate(found, update, inserting);
      return structuredClone(found);
    },
    async createIndex() {},
  };
}

// ---- the world -------------------------------------------------------------------------
const note = (id, text, x = 100) => ({
  options: { id, text, xPos: x, yPos: 100, width: 180, height: 100, vectorPath: "rectangle" },
  relationships: { associations: [] },
});

export function makeExecWorld({ limits = EXEC_LIMITS, rateLimits, nodePath = process.env.EXEC_RUNNER_NODE || process.execPath, grants = [] } = {}) {
  const users = memoryMeteorCollection("user");
  users.docs.push(
    { _id: "owner", profile: { firstName: "Ada" }, emails: [{ address: "ada@example.test" }] },
    { _id: "other", emails: [{ address: "ben.smith@example.test" }] },
  );
  const tokens = memoryMeteorCollection("token");
  const many = Array.from({ length: 14 }, (_, i) => note(`n${i + 1}`, `Note ${i + 1}`, 100 + i * 220));
  const slates = [
    { _id: "slate-1", shareId: "demo", userId: "owner", lastSaved: 1000, options: { name: "Demo", description: "", containerStyle: {} }, nodes: [note("welcome", "Welcome!"), note("second", "Second", 400)] },
    { _id: "slate-2", shareId: "theirs", userId: "other", lastSaved: 1000, options: { name: "Theirs", description: "", containerStyle: {}, isPublic: true }, nodes: [note("t1", "Their note")] },
    { _id: "slate-3", shareId: "many", userId: "owner", lastSaved: 1000, options: { name: "Many", description: "", containerStyle: {} }, nodes: many },
    { _id: "slate-4", shareId: "workshop", userId: "owner", lastSaved: 1000, options: { name: "Workshop", isPrivate: true }, nodes: [],
      creative: { revision: 3, model: { version: 1, kind: "workshop", workshop: createWorkshopMap() } } },
    { _id: "slate-5", shareId: "open", userId: "owner", lastSaved: 1000, options: { name: "Open", description: "", containerStyle: {}, isPublic: true }, nodes: [note("o1", "Open note")] },
  ];
  slates[0].nodes[0].relationships.associations = [{ id: "welcome->second", parentId: "welcome", childId: "second" }];
  const bySlateId = (shareId) => slates.find((slate) => slate.shareId === shareId) || null;
  const runs = [];
  const workshopRuns = [];
  const service = createApiTokenService({
    apiTokens: tokens,
    users,
    slates: { findOneAsync: async ({ shareId }) => bySlateId(shareId) },
    // Access grants on slates (none unless a test gives them): { slateId, type, userId, slateAccessPermissionId }.
    slateAccess: { find: (query = {}) => ({ fetchAsync: async () => grants.filter((grant) => grant.slateId === query.slateId) }) },
    now: () => 5000,
  });
  const created = [];
  const invites = [];
  // Wave 2: every writer saves through the save core (P05a), here over the same slate rows the
  // tests read, and the slate read is P07's.
  const slateRows = {
    async findOne(selector) { const found = slates.find((doc) => matches(doc, selector)); return found ? structuredClone(found) : null; },
    async updateOne(selector, update) {
      const found = slates.find((doc) => matches(doc, selector));
      if (!found) return { matchedCount: 0 };
      applyUpdate(found, update, false);
      return { matchedCount: 1 };
    },
    async insertOne(doc) { slates.push(structuredClone(doc)); return { insertedId: doc._id }; },
  };
  const saveCore = createSlateSaveCore({ slates: slateRows, events: memoryCollection(), now: () => 6000 });
  // GET /api/v1/instance (P08): the world is a self-hosted instance that runs exec, which a
  // local runner checks before it sends anything.
  const settings = { public: { env: "selfhost", baseUrl: "https://slatebox.test" }, selfHosted: { workshopAI: false } };
  const accounts = createAccounts({
    settings, origin: "https://slatebox.test",
    findUser: async (id) => ({ _id: id, emails: [{ address: id + "@example.test", verified: true }], profile: { firstName: id } }),
    findOrganization: async () => null, listClaims: async () => [], canGenerate: async () => false,
  });
  const instance = createInstanceDescriber({
    settings, origin: "https://slatebox.test", accounts, actions, rateLimits: RATE_LIMITS, mailAvailable: () => false, execLimits: limits,
    identity: () => resolveInstanceIdentity({ collection: memoryCollection(), configuredId: "exec-world-0001" }),
    engine: { version: "test", operations: describeOperations(), workshopEdits: describeWorkshopEdits(), limits: LIMITS },
  });
  // Agents on the canvas: the real store over an in-memory collection, with a clock the tests set.
  const presenceRows = memoryCollection();
  let presenceClock = 10000;
  const presence = createAgentPresence({
    collection: presenceRows,
    findUser: async (id) => users.docs.find((user) => user._id === id) || null,
    findToken: async (id) => tokens.docs.find((token) => token._id === id) || null,
    secret: "test-presence-key",
    now: () => presenceClock,
  });
  const deps = {
    presence,
    instance,
    accounts,
    apiTokens: service,
    authorizeTokenForSlate: service.authorizeTokenForSlate,
    readSlate: createSlateReader({
      listComments: async () => [],
      findPresentation: async () => null,
      appOrigin: () => "https://slatebox.test",
      embedOrigin: () => "https://slatebox.test",
    }),
    saveCore,
    applySlateOperationPlanToJSON: applyPlanToJSON,
    applyWorkshopOperations: createWorkshopOperations({
      slates: slateRows,
      saveCore,
      runs: {
        findOne: async (q) => structuredClone(workshopRuns.find((r) => matches(r, q)) || null),
        insertOne: async (row) => { workshopRuns.push(row); return { insertedId: row._id }; },
      },
      withTransaction: (action) => action({}),
    }),
    createPrivateSlate: async ({ token, key, body }) => {
      const shareId = "new" + (created.length + 1);
      created.push({ shareId, userId: token.userId, key, body });
      return { status: 201, body: { shareId, url: `https://slatebox.test/canvas/${shareId}`, diagram: { name: body.brief, description: "", nodeCount: 0, nodes: [], connections: [] } } };
    },
    manageInvite: async ({ shareId, revoke, inviteId, body }) => {
      invites.push({ shareId, revoke, inviteId, body });
      return revoke
        ? { status: 200, body: { shareId, inviteId, revoked: true } }
        : { status: 201, body: { shareId, inviteId: "a".repeat(32), role: body.role, url: `https://slatebox.test/canvas/${"a".repeat(32)}` } };
    },
    operationRuns: {
      findOneAsync: async (q) => runs.find((r) => r.tokenId === q.tokenId && r.idempotencyKey === q.idempotencyKey),
      insertAsync: async (run) => runs.push(run),
    },
  };
  let clock = 0;
  const idempotencyRows = memoryCollection();
  const idempotency = createIdempotencyStore({ collection: idempotencyRows, now: () => 2000 + clock });
  const registry = createAppRegistry({
    deps,
    now: () => 2000 + clock,
    idempotency,
    limiter: createRateLimiter({ collection: memoryCollection(), now: () => clock, ...(rateLimits && { limits: rateLimits }) }),
  });
  const collections = { runs: memoryCollection(), confirmations: memoryCollection(), locks: memoryCollection() };
  const logs = [];
  const exec = createExecSystem({
    registry,
    idempotency,
    collections,
    readSlate: async (shareId) => bySlateId(shareId),
    audienceOf: (slate) => (slateVisibility(slate) === "public" ? "public" : slateVisibility(slate) === "unlisted" ? "invite" : "private"),
    childPath: CHILD_PATH,
    runEntry: RUN_ENTRY,
    nodePath,
    limits,
    log: (line) => logs.push(line),
    presence,
  });
  deps.exec = exec.service;
  const authenticate = async (req) => principalFromToken(await service.authenticateApiRequest(req));
  const mint = (scopes = ["slates:read", "slates:write"], userId = "owner") => service.createApiToken({ userId, name: "Agent", scopes });
  const principalFor = async (scopes, userId) => {
    const { id } = await mint(scopes, userId);
    return { kind: "agent", userId: userId || "owner", tokenId: id, tokenName: "Agent", scopes: scopes || ["slates:read", "slates:write"] };
  };
  async function serve(t) {
    const app = express();
    mountHttp(app, gatedRegistry(registry, exec.gate), { express, authenticate });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (path, { token, key, method = "GET", body, headers = {} } = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(body !== undefined && { "content-type": "application/json" }),
          ...(token && { authorization: `Bearer ${token}` }),
          ...(key && { "idempotency-key": key }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, headers: response.headers, body: await response.json() };
    };
    call.base = base;
    return call;
  }
  return {
    users, tokens, slates, slate: bySlateId, saveCore, runs, workshopRuns, created, invites, deps, registry, idempotency,
    collections, exec, logs, mint, principalFor, authenticate, serve, setClock: (ms) => (clock = ms),
    presence, presenceRows, setPresenceClock: (ms) => (presenceClock = ms),
    close: () => exec.pool.close(),
  };
}
