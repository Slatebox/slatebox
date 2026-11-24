// An in-memory stand-in for a MongoDB driver collection, with the calls the save core and its
// callers make: findOne (selectors on dotted paths, null matching a missing field, $ne, $in, $lt,
// $gt, and a top-level $or),
// insertOne (duplicate _id answers code 11000), updateOne ($set, $unset, $inc on dotted paths;
// $push with $each and $slice) and find().toArray().

const get = (doc, path) => path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), doc);

function put(doc, path, value) {
  const keys = path.split(".");
  const parent = keys.slice(0, -1).reduce((record, key) => {
    if (record[key] == null || typeof record[key] !== "object") record[key] = {};
    return record[key];
  }, doc);
  if (value === undefined) delete parent[keys.at(-1)];
  else parent[keys.at(-1)] = value;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function matches(doc, selector = {}) {
  return Object.entries(selector).every(([path, want]) => {
    if (path === "$or") return want.some((branch) => matches(doc, branch));
    const have = get(doc, path);
    if (want && typeof want === "object" && !Array.isArray(want)) {
      if ("$ne" in want) return !same(have, want.$ne);
      if ("$in" in want) return want.$in.some((item) => (Array.isArray(have) ? have.some((h) => same(h, item)) : same(have, item)));
      if ("$exists" in want) return (have !== undefined) === want.$exists;
      if ("$gt" in want) return have > want.$gt;
      if ("$lt" in want) return have != null && have < want.$lt;
    }
    if (want === null) return have === null || have === undefined;
    if (Array.isArray(have) && !Array.isArray(want)) return have.some((h) => same(h, want));
    return same(have, want);
  });
}

export function memoryMongo() {
  const rows = new Map();
  const apply = (doc, update) => {
    for (const [path, value] of Object.entries(update.$set || {})) put(doc, path, structuredClone(value));
    for (const path of Object.keys(update.$unset || {})) put(doc, path, undefined);
    for (const [path, value] of Object.entries(update.$inc || {})) put(doc, path, (get(doc, path) || 0) + value);
    for (const [path, value] of Object.entries(update.$push || {})) {
      const list = [...(get(doc, path) || [])];
      const items = value && typeof value === "object" && "$each" in value ? value.$each : [value];
      list.push(...structuredClone(items));
      const slice = value?.$slice;
      put(doc, path, slice === undefined ? list : slice < 0 ? list.slice(slice) : list.slice(0, slice));
    }
  };
  const find = (selector) => [...rows.values()].find((doc) => matches(doc, selector));
  return {
    docs: () => [...rows.values()].map((doc) => structuredClone(doc)),
    async insertOne(doc) {
      if (rows.has(doc._id)) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      rows.set(doc._id, structuredClone(doc));
      return { insertedId: doc._id };
    },
    async findOne(selector) {
      const found = find(selector);
      return found ? structuredClone(found) : null;
    },
    find(selector) {
      return { toArray: async () => [...rows.values()].filter((doc) => matches(doc, selector)).map((doc) => structuredClone(doc)) };
    },
    async updateOne(selector, update) {
      const found = find(selector);
      if (!found) return { matchedCount: 0, modifiedCount: 0 };
      apply(found, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(selector) {
      const found = find(selector);
      if (found) rows.delete(found._id);
      return { deletedCount: found ? 1 : 0 };
    },
  };
}
