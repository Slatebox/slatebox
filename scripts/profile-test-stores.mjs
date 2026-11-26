// About you's store over stand-in collections, for scripts/personal-facts.test.mjs and
// scripts/profile-actions.test.mjs.
import { createProfileStore, ensureProfileIndexes } from "../web/app/server/profile/store.mjs";

// ---- a MongoDB driver collection, in memory: equality selectors (dotted paths), $set and
// $setOnInsert (dotted), upsert, and unique indexes as createIndex declares them.
const read = (doc, path) => path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), doc);
const write = (doc, path, value) => {
  const keys = path.split(".");
  let at = doc;
  for (const key of keys.slice(0, -1)) at = at[key] && typeof at[key] === "object" ? at[key] : (at[key] = {});
  at[keys.at(-1)] = value;
};
const matches = (doc, selector) => Object.entries(selector).every(([path, want]) => read(doc, path) === want);
export function memoryCollection() {
  const docs = [];
  const unique = [];
  const clash = (doc, except) => unique.some((fields) => docs.some((other) => other !== except && fields.every((field) => read(other, field) !== undefined && read(other, field) === read(doc, field))));
  const duplicate = () => Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
  return {
    docs,
    async createIndex(key, options = {}) { if (options.unique) unique.push(Object.keys(key)); },
    find(selector = {}) { return { toArray: async () => docs.filter((doc) => matches(doc, selector)).map((doc) => structuredClone(doc)) }; },
    async findOne(selector) { const found = docs.find((doc) => matches(doc, selector)); return found ? structuredClone(found) : null; },
    async insertOne(doc) {
      if (docs.some((other) => other._id === doc._id) || clash(doc)) throw duplicate();
      docs.push(structuredClone(doc));
      return { insertedId: doc._id };
    },
    async updateOne(selector, update, options = {}) {
      let found = docs.find((doc) => matches(doc, selector));
      let inserting = false;
      if (!found && options.upsert) { found = structuredClone(selector); inserting = true; }
      if (!found) return { matchedCount: 0 };
      const next = structuredClone(found);
      for (const [path, value] of Object.entries(update.$set || {})) write(next, path, structuredClone(value));
      if (inserting) for (const [path, value] of Object.entries(update.$setOnInsert || {})) write(next, path, value);
      if (clash(next, found)) throw duplicate();
      if (inserting) docs.push(next); else Object.assign(found, next);
      return { matchedCount: inserting ? 0 : 1, upsertedCount: inserting ? 1 : 0 };
    },
    async deleteOne(selector) {
      const index = docs.findIndex((doc) => matches(doc, selector));
      if (index >= 0) docs.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    },
    async deleteMany(selector) {
      const before = docs.length;
      for (let i = docs.length - 1; i >= 0; i -= 1) if (matches(docs[i], selector)) docs.splice(i, 1);
      return { deletedCount: before - docs.length };
    },
  };
}

export async function makeProfileWorld({ users = [] } = {}) {
  const facts = memoryCollection();
  const settings = memoryCollection();
  const people = memoryCollection();
  for (const user of users) await people.insertOne(user);
  await ensureProfileIndexes({ facts, settings });
  let seq = 0;
  let clock = Date.parse("2026-11-26T12:00:00Z");
  const store = createProfileStore({ facts, settings, users: people, newId: () => `f${++seq}`, now: () => (clock += 1000) });
  return { store, facts, settings, people };
}

