// In-memory stand-ins used by the action registry tests: a MongoDB driver collection (the
// registry's idempotency and rate-limit stores) and a Meteor collection (the token service).
// Only the calls those modules make are implemented.
import express from "express";
import { mountHttp } from "../web/app/server/actions/http.mjs";

const matches = (doc, selector = {}) =>
  Object.entries(selector).every(([key, want]) => {
    const have = doc[key];
    if (want && typeof want === "object" && "$ne" in want) return have !== want.$ne;
    if (want === null) return have === null || have === undefined;
    return have === want;
  });

export function memoryDriverCollection() {
  const docs = new Map();
  const apply = (doc, update) => {
    for (const [key, value] of Object.entries(update.$set || {})) doc[key] = value;
    for (const key of Object.keys(update.$unset || {})) delete doc[key];
    for (const [key, value] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + value;
  };
  return {
    docs,
    async insertOne(doc) {
      if (docs.has(doc._id)) throw Object.assign(new Error("duplicate key"), { code: 11000 });
      docs.set(doc._id, structuredClone(doc));
      return { insertedId: doc._id };
    },
    async findOne(selector) {
      const found = [...docs.values()].find((doc) => matches(doc, selector));
      return found ? structuredClone(found) : null;
    },
    async updateOne(selector, update) {
      const found = [...docs.values()].find((doc) => matches(doc, selector));
      if (!found) return { matchedCount: 0 };
      apply(found, update);
      return { matchedCount: 1 };
    },
    async deleteOne(selector) {
      const found = [...docs.values()].find((doc) => matches(doc, selector));
      if (found) docs.delete(found._id);
      return { deletedCount: found ? 1 : 0 };
    },
    async findOneAndUpdate(selector, update, options) {
      let found = [...docs.values()].find((doc) => matches(doc, selector));
      if (!found && options?.upsert) {
        found = { ...selector, ...(update.$setOnInsert || {}) };
        docs.set(found._id, found);
      }
      if (!found) return null;
      apply(found, update);
      return structuredClone(found);
    },
  };
}

export function memoryMeteorCollection(prefix = "doc") {
  const docs = [];
  const project = (doc, fields) => {
    if (!fields) return { ...doc };
    const copy = { ...doc };
    for (const [key, keep] of Object.entries(fields)) if (!keep) delete copy[key];
    return copy;
  };
  return {
    docs,
    async insertAsync(doc) {
      const _id = `${prefix}-${docs.length + 1}`;
      docs.push({ _id, ...doc });
      return _id;
    },
    async findOneAsync(selector, options) {
      const found = docs.find((doc) => matches(doc, selector));
      return found ? project(found, options?.fields) : undefined;
    },
    find(selector, options) {
      const rows = docs.filter((doc) => matches(doc, selector));
      if (options?.sort?.createdAt === -1) rows.sort((a, b) => b.createdAt - a.createdAt);
      return {
        fetchAsync: async () => rows.map((doc) => project(doc, options?.fields)),
        countAsync: async () => rows.length,
      };
    },
    async updateAsync(selector, modifier) {
      const found = docs.filter((doc) => matches(doc, selector));
      for (const doc of found) Object.assign(doc, modifier.$set);
      return found.length;
    },
  };
}

// An express app with the registry mounted the way the Meteor app mounts it.
export async function serve(t, registry, authenticate, { forwardedCount } = {}) {
  const app = express();
  mountHttp(app, registry, { express, authenticate, forwardedCount });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async function call(path, { token, key, method = "GET", body, headers = {} } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined && { "content-type": "application/json" }),
        ...(token && { authorization: `Bearer ${token}` }),
        ...(key && { "idempotency-key": key }),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  call.base = base;
  return call;
}
