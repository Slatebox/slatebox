// The shared library over in-memory stores, for the library tests, the exec world and the MCP
// package's integration test: a MongoDB driver collection that answers the queries the library
// core makes, and the core wired to it with the engine's catalogue seeded as built-in items.
import { createLibraryCore } from "../web/app/server/library/core.mjs";
import { seedBuiltins } from "../web/app/server/library/builtins.mjs";

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
  if (parent && typeof parent === "object") delete parent[keys.at(-1)];
};
const comparable = (value) => (value instanceof Date ? value.getTime() : value);
const same = (a, b) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
const isOperatorObject = (want) => want && typeof want === "object" && !(want instanceof Date) && !Array.isArray(want) &&
  Object.keys(want).length > 0 && Object.keys(want).every((key) => key.startsWith("$"));

function fieldMatches(have, want) {
  if (isOperatorObject(want)) {
    return Object.entries(want).every(([op, arg]) => {
      const values = Array.isArray(have) ? have : [have];
      if (op === "$options") return true;
      if (op === "$ne") return Array.isArray(have) ? !have.some((v) => same(v, arg)) : !same(have ?? null, arg);
      if (op === "$exists") return (have !== undefined) === Boolean(arg);
      if (op === "$in") return values.some((v) => arg.some((a) => same(v ?? null, a)));
      if (op === "$nin") return !values.some((v) => arg.some((a) => same(v ?? null, a)));
      if (op === "$gte") return have !== undefined && have !== null && comparable(have) >= comparable(arg);
      if (op === "$gt") return have !== undefined && have !== null && comparable(have) > comparable(arg);
      if (op === "$lte") return have !== undefined && have !== null && comparable(have) <= comparable(arg);
      if (op === "$lt") return have !== undefined && have !== null && comparable(have) < comparable(arg);
      if (op === "$type") return arg === "string" ? values.some((v) => typeof v === "string") : arg === "array" ? Array.isArray(have) : typeof have === arg;
      if (op === "$regex") {
        const pattern = new RegExp(arg, want.$options || "");
        return values.some((v) => typeof v === "string" && pattern.test(v));
      }
      throw new Error("libraryCollection: unsupported selector " + op);
    });
  }
  if (want === null) return have === null || have === undefined;
  if (Array.isArray(have) && !Array.isArray(want)) return have.some((v) => same(v, want));
  return same(have, want);
}

export function matches(doc, selector = {}) {
  return Object.entries(selector).every(([path, want]) => {
    if (path === "$or") return want.some((part) => matches(doc, part));
    if (path === "$and") return want.every((part) => matches(doc, part));
    return fieldMatches(get(doc, path), want);
  });
}

function applyUpdate(doc, update, inserting) {
  for (const [op, fields] of Object.entries(update)) {
    for (const [path, value] of Object.entries(fields)) {
      if (op === "$set") set(doc, path, structuredClone(value));
      else if (op === "$setOnInsert") { if (inserting) set(doc, path, structuredClone(value)); }
      else if (op === "$inc") set(doc, path, (get(doc, path) || 0) + value);
      else if (op === "$unset") unset(doc, path);
      else if (op === "$push") {
        const list = get(doc, path) || [];
        if (value && typeof value === "object" && "$each" in value) list.push(...structuredClone(value.$each));
        else list.push(structuredClone(value));
        set(doc, path, list);
      } else throw new Error("libraryCollection: unsupported update " + op);
    }
  }
}

const sorter = (sort = {}) => (a, b) => {
  for (const [key, dir] of Object.entries(sort)) {
    const x = comparable(get(a, key)), y = comparable(get(b, key));
    if (x === y) continue;
    if (x === undefined || x === null) return dir;
    if (y === undefined || y === null) return -dir;
    return x > y ? dir : -dir;
  }
  return 0;
};

/** A MongoDB driver collection in memory: find (sort, skip, limit), countDocuments, the updates the library makes. */
export function libraryCollection(rows = []) {
  const docs = rows.map((row) => structuredClone(row));
  const first = (selector) => docs.find((doc) => matches(doc, selector));
  return {
    docs,
    async insertOne(doc) {
      if (doc._id !== undefined && docs.some((have) => have._id === doc._id)) throw Object.assign(new Error("duplicate key"), { code: 11000 });
      docs.push(structuredClone(doc));
      return { insertedId: doc._id };
    },
    async findOne(selector = {}) { const found = first(selector); return found ? structuredClone(found) : null; },
    find(selector = {}, options = {}) {
      return {
        async toArray() {
          let out = docs.filter((doc) => matches(doc, selector)).sort(sorter(options.sort));
          if (options.skip) out = out.slice(options.skip);
          if (options.limit) out = out.slice(0, options.limit);
          return out.map((doc) => structuredClone(doc));
        },
      };
    },
    async countDocuments(selector = {}) { return docs.filter((doc) => matches(doc, selector)).length; },
    async updateOne(selector, update, options = {}) {
      const found = first(selector);
      if (!found && options.upsert) {
        // As MongoDB does: the selector's plain fields, then the update with $setOnInsert; a taken _id fails.
        const doc = {};
        for (const [path, want] of Object.entries(selector)) if (!path.startsWith("$") && !isOperatorObject(want)) set(doc, path, structuredClone(want));
        applyUpdate(doc, update, true);
        await this.insertOne(doc);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: doc._id };
      }
      if (!found) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(found, update, false);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(selector) {
      const index = docs.findIndex((doc) => matches(doc, selector));
      if (index >= 0) docs.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    },
    async createIndex() {},
  };
}

let counter = 0;
/**
 * The library core over in-memory stores, its built-ins seeded. Pass the slates collection and save core
 * the rest of the world uses, and who reviews. → { library, items, versions, events, notices, decks, ready } (ready: the seed).
 */
export function makeLibrary({ slates, saveCore, reviewers = ["admin"], users = {}, teamAdmins = [], resolveSlateForUser, latestPresentation, publishedPresentation,
  copyPresentation, applyWorkshopOperations, refineWithAI, listingGate, agentsPaused, now = () => Date.parse("2026-11-23T12:00:00.000Z"), seed = true } = {}) {
  const items = libraryCollection();
  const versions = libraryCollection();
  const events = libraryCollection();
  const counters = libraryCollection();
  const notices = [];
  const decks = [];
  let share = 0;
  const library = createLibraryCore({
    items, versions, events, counters, slates, saveCore,
    isLibraryReviewer: async (userId) => reviewers.includes(userId),
    countReviewers: async () => reviewers.length,
    loadUser: async (userId) => (userId ? { _id: userId, orgId: users[userId]?.orgId ?? null, isAnonymous: Boolean(users[userId]?.isAnonymous), name: users[userId]?.name ?? "" } : null),
    isTeamAdmin: async (userId, orgId) => teamAdmins.some((admin) => admin.userId === userId && admin.orgId === orgId),
    resolveSlateForUser: resolveSlateForUser || (async (shareId, userId) => {
      const slate = await slates.findOne({ shareId });
      if (!slate) return null;
      const own = slate.userId === userId;
      return { slate, canRead: own || slate.options?.isPublic === true, canEdit: own };
    }),
    latestPresentation: latestPresentation || (async () => null),
    publishedPresentation: publishedPresentation || (async () => null),
    copyPresentation: copyPresentation || (async (deck, where) => { decks.push({ deck, ...where }); }),
    applyWorkshopOperations: applyWorkshopOperations || null,
    ...(refineWithAI && { refineWithAI }),
    ...(listingGate && { listingGate }),
    ...(agentsPaused && { agentsPaused }),
    notify: async (notice) => { notices.push({ type: notice.type, itemId: notice.item._id, message: notice.message }); },
    generateShareId: async () => "lib" + (++share),
    newId: () => "id" + String(++counter).padStart(8, "0"),
    now,
    appOrigin: () => "https://slatebox.test",
  });
  const ready = seed ? seedBuiltins({ items, versions, events, newId: () => "ev" + String(++counter).padStart(8, "0"), now }) : Promise.resolve(null);
  return { library, items, versions, events, counters, notices, decks, ready };
}
