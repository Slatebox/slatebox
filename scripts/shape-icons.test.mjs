// The custom shape pane's icon search and its one-shape AI create:
//   - shapes.searchIcons turns The Noun Project's icons (mocked answers here) into checked outlines
//     normalised to a 0..100 box, with the credit Noun Project asks for, keeps answers for a while,
//     and says plainly when it is not set up, busy or not answering (failures are never kept);
//   - an icon picked is kept in "Your shapes" with its credit; an unknown credit link is dropped;
//   - "Create a custom shape with AI" asks the shape feature for exactly one outline (count 1);
//   - agents reach the same search through the action contract (exec, MCP, HTTP).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { ICON_LIMITS, createIconSearch, iconToShape, svgToOutline } from "../web/app/server/shapes/icon-search.mjs";
import { cleanCredit, createShapeLibrary } from "../web/app/server/shapes/shape-library.mjs";
import { createShapeService } from "../web/app/server/shapes/shape-service.mjs";
import { makeExecWorld } from "./exec-test-world.mjs";

const appRequire = createRequire(new URL("../web/app/package.json", import.meta.url));
const { normalizeShapePath, parseShapePath, flattenShape } = appRequire("slateboxjs/shapes");

// ---- Noun Project answers, as its v2 API sends them ----------------------------------------
const BIRD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 125"><g transform="translate(10,5)"><circle cx="40" cy="40" r="30"/><rect x="30" y="70" width="20" height="20"/></g><text y="115">Created by Ann from the Noun Project</text></svg>`;
const FRAME_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200"><path fill-rule="evenodd" d="M100 100h1000v1000H100z M400 400h400v400H400z"/></svg>`;
const STROKE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="none" stroke="#000" d="M10 10L90 90"/></svg>`;
const icon = (id, term, extra = {}) => ({
  id,
  term,
  attribution: `${term} by Ann Example from Noun Project`,
  creator: { name: "Ann Example", username: "ann" },
  license_description: "creative-commons-attribution",
  permalink: `/icon/${term}-${id}/`,
  icon_url: `https://static.thenounproject.com/svg/${id}.svg`,
  ...extra,
});
const SVGS = { 1: BIRD_SVG, 2: FRAME_SVG, 3: STROKE_SVG, 4: BIRD_SVG };

function mockedSearch({ icons = [icon(1, "songbird"), icon(2, "frame"), icon(3, "line")], fail, clock = { t: 0 }, configured = true } = {}) {
  const requests = [];
  const fetched = [];
  const search = createIconSearch({
    configured,
    now: () => clock.t,
    requestJson: async (url) => {
      requests.push(url);
      if (fail) throw fail;
      return { icons, next_page: "x", total: icons.length };
    },
    fetchText: async (url) => {
      fetched.push(url);
      return SVGS[url.match(/(\d+)\.svg$/)?.[1]] ?? null;
    },
  });
  return { search, requests, fetched, clock };
}
const ada = { userId: "ada", teamId: "team1" };

// A stored outline is normalised: re-normalising leaves it as it is, bounds at 0,0, longer side 100.
function assertNormalised(d) {
  assert.equal(normalizeShapePath(d).d, d, "already normalised");
  const pts = flattenShape(parseShapePath(d)).flat();
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  assert.ok(Math.min(...xs) >= -0.2 && Math.min(...ys) >= -0.2, `starts at 0,0: ${d.slice(0, 40)}`);
  assert.ok(Math.max(...xs) <= 100.2 && Math.max(...ys) <= 100.2, `inside 0..100: ${d.slice(0, 40)}`);
  assert.ok(Math.abs(Math.max(Math.max(...xs), Math.max(...ys)) - 100) < 0.6, "longer side 100");
}

test("icon search: Noun Project icons become checked, normalised outlines with their credit", async () => {
  const { search, requests, fetched } = mockedSearch();
  const result = await search.search(ada, { q: "songbird", limit: 12 });
  assert.equal(requests.length, 1);
  const url = new URL(requests[0]);
  assert.equal(url.origin + url.pathname, "https://api.thenounproject.com/v2/icon");
  assert.equal(url.searchParams.get("query"), "songbird");
  assert.equal(url.searchParams.get("include_svg"), "1");
  assert.ok(Number(url.searchParams.get("limit")) >= 12, "asks for a few more than shown");
  assert.equal(fetched.length, 3);
  // The stroke-only line cannot be one filled outline: left out.
  assert.deepEqual(result.icons.map((i) => i.name), ["songbird", "frame"]);
  const [bird, frame] = result.icons;
  for (const shape of result.icons) assertNormalised(shape.d);
  assert.equal(bird.iconId, "1");
  assert.equal(bird.fillRule, "nonzero");
  assert.ok(bird.aspect > 0.5 && bird.aspect < 1, "the bird is taller than wide");
  assert.deepEqual(bird.credit, { text: "songbird by Ann Example from Noun Project", url: "https://thenounproject.com/icon/songbird-1/" });
  assert.equal(bird.license, "creative-commons-attribution");
  assert.equal(frame.fillRule, "evenodd", "a frame keeps its hole");
  assert.deepEqual(result.credit, { text: "Icons from Noun Project", url: "https://thenounproject.com" });
  assert.equal(result.cached, false);
  assert.equal(result.hasMore, false);
});

test("icon search: the credit is built from the creator when the API sends none", () => {
  const shape = iconToShape({ id: 9, term: "kite", creator: { name: "Bo" }, permalink: "https://evil.example/x" }, BIRD_SVG);
  assert.deepEqual(shape.credit, { text: "kite by Bo from Noun Project", url: "https://thenounproject.com" });
  assert.equal(svgToOutline("not an svg"), null);
  assert.equal(svgToOutline(STROKE_SVG), null);
});

test("icon search: answers are kept for a while, so the same words cost no second API call", async () => {
  const { search, requests, clock } = mockedSearch();
  await search.search(ada, { q: "Songbird" });
  const again = await search.search(ada, { q: "songbird " });
  assert.equal(requests.length, 1);
  assert.equal(again.cached, true);
  assert.equal(again.icons.length, 2);
  await search.search(ada, { q: "songbird", limit: 4 });
  assert.equal(requests.length, 2, "another page size is another request");
  clock.t += 7 * 60 * 60 * 1000;
  await search.search(ada, { q: "songbird" });
  assert.equal(requests.length, 3, "after six hours it asks again");
});

test("icon search: only Noun Project's own icon files are fetched", async () => {
  const { search, fetched } = mockedSearch({ icons: [icon(1, "songbird", { icon_url: "http://169.254.169.254/latest/1.svg" }), icon(4, "robin")] });
  const result = await search.search(ada, { q: "bird" });
  assert.deepEqual(fetched, ["https://static.thenounproject.com/svg/4.svg"]);
  assert.deepEqual(result.icons.map((i) => i.name), ["robin"]);
});

test("icon search: not set up, busy, failing and bad input each say so, and failures are not kept", async () => {
  await assert.rejects(mockedSearch({ configured: false }).search.search(ada, { q: "bird" }), { code: "icons_not_set_up", status: 503 });
  await assert.rejects(mockedSearch().search.search(null, { q: "bird" }), { code: "sign_in" });
  await assert.rejects(mockedSearch().search.search(ada, { q: "   " }), { code: "invalid_request" });
  await assert.rejects(mockedSearch().search.search(ada, { q: "x".repeat(ICON_LIMITS.query + 1) }), { code: "invalid_request" });
  await assert.rejects(mockedSearch({ fail: Object.assign(new Error("429"), { status: 429 }) }).search.search(ada, { q: "bird" }), { code: "icons_busy", status: 429 });
  const broken = mockedSearch({ fail: Object.assign(new Error("boom"), { status: 500 }) });
  await assert.rejects(broken.search.search(ada, { q: "bird" }), (error) => error.code === "icons_unavailable" && error.status === 502 && /create a shape with AI/.test(error.message));
  await assert.rejects(broken.search.search(ada, { q: "bird" }), { code: "icons_unavailable" });
  assert.equal(broken.requests.length, 2, "a failure is never kept");
  // Nothing found is an empty list, not an error.
  const none = await mockedSearch({ icons: [] }).search.search(ada, { q: "zzzz" });
  assert.deepEqual(none.icons, []);
  // A service built without a search says it is not set up.
  const bare = createShapeService({ shapes: memory(), newId: () => "x", request: async () => ({}), run: (fn) => fn() });
  await assert.rejects(bare.icons.search(ada, { q: "bird" }), { code: "icons_not_set_up" });
});

// ---- the library keeps an icon with its credit -------------------------------------------
function memory() {
  const docs = [];
  const matches = (doc, sel) => Object.entries(sel).every(([k, v]) => {
    if (k === "$and") return v.every((s) => matches(doc, s));
    if (k === "$or") return v.some((s) => matches(doc, s));
    if (v && typeof v === "object" && "$regex" in v) return new RegExp(v.$regex, v.$options).test(doc[k] ?? "");
    return doc[k] === v;
  });
  return {
    docs,
    async insertOne(doc) { docs.push(structuredClone(doc)); },
    async findOne(sel) { const d = docs.find((x) => matches(x, sel)); return d ? structuredClone(d) : null; },
    find(sel) {
      let rows = docs.filter((x) => matches(x, sel));
      const cursor = { sort: () => cursor, limit: (n) => { rows = rows.slice(0, n); return cursor; }, toArray: async () => structuredClone(rows) };
      return cursor;
    },
    async updateOne(sel, update) { const d = docs.find((x) => matches(x, sel)); if (d) Object.assign(d, update.$set || {}); },
    async countDocuments(sel) { return docs.filter((x) => matches(x, sel)).length; },
  };
}

test("an icon picked is kept in Your shapes as imported, normalised, with its credit", async () => {
  const { search } = mockedSearch();
  const [bird] = (await search.search(ada, { q: "songbird" })).icons;
  let n = 0;
  const library = createShapeLibrary({ collection: memory(), newId: () => `s${++n}` });
  const saved = await library.save(ada, { name: bird.name, d: bird.d, fillRule: bird.fillRule, source: "imported", credit: bird.credit });
  assert.equal(saved.d, bird.d);
  assertNormalised(saved.d);
  assert.deepEqual(saved.credit, bird.credit);
  const { shapes } = await library.list(ada, { scope: "mine" });
  assert.deepEqual(shapes.map((s) => [s.name, s.credit?.text]), [["songbird", "songbird by Ann Example from Noun Project"]]);
  // A drawn shape carries no credit; a credit link off Noun Project is dropped.
  assert.equal((await library.save(ada, { name: "Box", d: "M0 0H100V60H0Z" })).credit, undefined);
  assert.deepEqual(cleanCredit({ text: "x by y from Noun Project", url: "javascript:alert(1)" }), { text: "x by y from Noun Project", url: null });
  assert.equal(cleanCredit({ text: "  " }), null);
});

// ---- "Create a custom shape with AI": exactly one outline ---------------------------------
const ROCKET = "M50,0 C64,10 72,28 72,50 L72,74 L88,90 L88,100 L70,92 L30,92 L12,100 L12,90 L28,74 L28,50 C28,28 36,10 50,0 Z";
const toolAnswer = (shapes) => ({ json: { content: [{ type: "tool_use", name: "propose_shapes", input: { shapes } }] } });

test("create with AI: count 1 asks the shape feature for exactly one outline and returns one", async () => {
  const calls = [];
  let n = 0;
  const service = createShapeService({
    shapes: memory(),
    newId: () => `id${++n}`,
    request: async (options) => { calls.push(options); return toolAnswer([{ name: "Rocket", d: ROCKET, fillRule: "nonzero" }]); },
    run: async (fn) => fn(),
  });
  const { candidates, charged } = await service.generate(ada, { describe: "a rocket", count: 1 });
  assert.equal(candidates.length, 1);
  assert.equal(charged, true, "counted like other AI use");
  assert.equal(calls.length, 1);
  assert.match(calls[0].system, /exactly 1 /);
  assertNormalised(candidates[0].d);
});

test("the pane searches icons by default and creates one shape with AI (count 1)", async () => {
  const source = await readFile(new URL("../web/app/imports/ui/components/shapes/ShapeMaker.jsx", import.meta.url), "utf8");
  assert.match(source, /'shapes\.searchIcons'/);
  assert.match(source, /'shapes\.generate', \{ describe[^}]*count: 1[,\s}]/);
  assert.doesNotMatch(source, /count: 3/);
  assert.match(source, /Create a custom shape with AI/);
  assert.match(source, /source: 'imported'/);
});

// ---- agents: the same search through the action contract --------------------------------
test("agents: shapes.searchIcons answers icons with their credit, for a signed-in token", async (t) => {
  const world = makeExecWorld();
  t.after(() => world.close());
  const { search } = mockedSearch();
  world.deps.shapes = createShapeService({ shapes: memory(), newId: () => "x", request: async () => ({}), run: (fn) => fn(), icons: search });
  world.deps.loadUser = async (id) => ({ _id: id, orgId: null });
  const reader = await world.principalFor(["slates:read"]);
  const found = await world.registry.run(reader, "shapes.searchIcons", { q: "songbird", limit: 1 });
  const body = found.body ?? found;
  assert.deepEqual(body.icons.map((i) => i.name), ["songbird"]);
  assert.equal(body.icons[0].credit.url, "https://thenounproject.com/icon/songbird-1/");
  assertNormalised(body.icons[0].d);
  const action = world.registry.get("shapes.searchIcons");
  assert.equal(action.readOnly, true, "changes nothing");
  assert.equal(action.openWorld, true, "asks an outside service");
  world.deps.loadUser = async (id) => ({ _id: id, isAnonymous: true });
  await assert.rejects(world.registry.run(reader, "shapes.searchIcons", { q: "songbird" }), (error) => error.status === 401);
});
