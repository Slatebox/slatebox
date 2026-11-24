// P07: read what you can write. GET /api/v1/slates/{id} is the one read of a slate (server/
// slate-read.mjs over the engine's readSlate). These run the route as the app mounts it, with
// the real token service and role rule over in-memory stores.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createApiTokenService } from "../web/app/server/api-token-core.mjs";
import { createAppRegistry } from "../web/app/server/actions/index.mjs";
import { createIdempotencyStore } from "../web/app/server/actions/idempotency.mjs";
import { createRateLimiter } from "../web/app/server/actions/rate-limit.mjs";
import { principalFromToken } from "../web/app/server/actions/principal.mjs";
import { createSlateReader } from "../web/app/server/slate-read.mjs";
import { canvasStarters } from "../web/app/imports/api/common/native-canvas-conversation.mjs";
import { workshopStarters } from "../web/app/imports/api/common/workshop-starters.mjs";
import { boardCan } from "../web/app/imports/api/common/library.mjs";
import { memoryDriverCollection, memoryMeteorCollection, serve } from "./action-test-stores.mjs";

const requireApp = createRequire(new URL("../web/app/package.json", import.meta.url));
const { applyPlanToJSON, NODE_KEYS, contractLists } = requireApp("slateboxjs/operations");
const { releasePlan } = requireApp("slateboxjs/workshops/model");

const note = (id, text, xPos, yPos, extra = {}) => ({
  options: { id, text, xPos, yPos, width: 200, height: 100, vectorPath: "rectangle", shape: "rectangle", ...extra },
  relationships: { associations: [] },
});

function makeWorld({ limits } = {}) {
  const users = memoryMeteorCollection("user");
  users.docs.push({ _id: "owner" }, { _id: "reader" }, { _id: "stranger" });
  const demoNodes = [note("a", "Intake", 100, 100), note("b", "Review", 400, 100), note("c", "Send", 700, 100), note("m1", "?", 120, 120, { isComment: true })];
  demoNodes[0].relationships.associations.push({ id: "a->b", parentId: "a", childId: "b", lineColor: "#333333", lineWidth: 3, lineType: "bezier" });
  const slates = memoryMeteorCollection("slate");
  slates.docs.push(
    {
      _id: "demo-id", shareId: "demo", userId: "owner", lastSaved: 1,
      options: { id: "opt-demo", name: "Demo", description: "A flow", creationBrief: "Draw the intake flow", isPrivate: true, isPublic: false, isUnlisted: false, containerStyle: { backgroundColor: "#fafafa" } },
      nodes: demoNodes,
    },
    {
      _id: "shared-id", shareId: "shared", userId: "owner", lastSaved: 1,
      options: { id: "opt-shared", name: "Shared", isUnlisted: true },
      nodes: [note("s1", "One", 0, 0)],
    },
    {
      _id: "open-id", shareId: "open", userId: "owner", lastSaved: 1,
      options: { id: "opt-open", name: "Open", isPublic: true },
      nodes: [note("o1", "Public note", 0, 0)],
    },
    {
      _id: "release-id", shareId: "release", userId: "owner", lastSaved: 1,
      options: { id: "opt-release", name: "Release", isPrivate: true },
      nodes: [note("own", "My own note", 2000, 2000)],
      creative: { revision: 4, model: { version: 1, kind: "workshop", workshop: structuredClone(releasePlan) } },
    },
  );
  const grants = memoryMeteorCollection("grant");
  grants.docs.push(
    { slateId: "shared-id", type: "unlisted", accessKey: "linkkey", slateAccessPermissionId: "EDIT" },
    { slateId: "shared-id", type: "unlisted", userId: "reader", accessKey: "readerkey", slateAccessPermissionId: "READ" },
    { slateId: "release-id", type: "private", userId: "reader", accessKey: "relkey", slateAccessPermissionId: "READ" },
  );
  const comments = [
    { slateId: "opt-demo", nodeId: "a", resolved: false },
    { slateId: "opt-demo", nodeId: "a", resolved: true },
    { slateId: "opt-demo", nodeId: "b", resolved: true },
  ];
  const presentations = [
    { _id: "p-open", slateShareId: "open", isPublished: true },
    { _id: "p-release", slateShareId: "release", isPublished: true },
  ];
  const tokens = memoryMeteorCollection("token");
  const service = createApiTokenService({ apiTokens: tokens, users, slates, slateAccess: grants, now: () => 5000 });
  const readSlate = createSlateReader({
    listComments: async (slateId) => comments.filter((row) => row.slateId === slateId),
    findPresentation: async (selector) =>
      presentations.find((row) => Object.entries(selector).every(([key, value]) => row[key] === value)) ?? null,
    appOrigin: () => "https://app.example",
    embedOrigin: () => "https://api.example",
    now: () => 1000,
  });
  let clock = 0;
  const registry = createAppRegistry({
    deps: { authorizeTokenForSlate: service.authorizeTokenForSlate, readSlate },
    idempotency: createIdempotencyStore({ collection: memoryDriverCollection() }),
    limiter: createRateLimiter({ collection: memoryDriverCollection(), now: () => clock, limits }),
  });
  const authenticate = async (req) => principalFromToken(await service.authenticateApiRequest(req));
  const mint = async (userId = "owner") => (await service.createApiToken({ userId, name: "Agent", scopes: ["slates:read"] })).token;
  const slate = (shareId) => slates.docs.find((row) => row.shareId === shareId);
  return { registry, authenticate, mint, slate, comments, setClock: (ms) => (clock = ms) };
}

test("open-slate / collab:see-visibility / conv:conv-eligibility: the owner reads access, address, brief and every note key", async (t) => {
  const world = makeWorld();
  const call = await serve(t, world.registry, world.authenticate);
  const token = await world.mint();
  const { status, body } = await call("/api/v1/slates/demo", { token });
  assert.equal(status, 200);
  assert.deepEqual(body.access, { visibility: "private", yourRole: "EDIT", isOwner: true, canEdit: true, linkRole: null });
  assert.equal(body.url, "https://app.example/canvas/demo");
  assert.equal(body.brief, "Draw the intake flow");
  assert.deepEqual(body.background, { color: "#fafafa" });
  assert.equal(body.nodeCount, 3);
  assert.deepEqual(body.nodes.map((n) => n.id), ["a", "b", "c"]);
  for (const key of Object.keys(NODE_KEYS)) assert.ok(key in body.nodes[0], `note key ${key} is read`);
  assert.deepEqual(body.connections.map((c) => c.id), ["a->b"]);
  assert.equal(body.nextCursor, null);
  assert.equal(body.conversation.available, true);
  assert.equal("summary" in body || "slate" in body, false);
});

test("open-slate: every key a write accepts reads back equal through the route", async (t) => {
  const world = makeWorld();
  const call = await serve(t, world.registry, world.authenticate);
  const token = await world.mint();
  const lists = contractLists();
  const changes = {
    text: "Changed", shape: "ellipse", x: 10, y: 20, width: 150, height: 90, rotationAngle: 15,
    backgroundColor: "#112233", foregroundColor: "#445566", borderColor: "#778899", borderWidth: 2, borderOpacity: 0.5,
    borderStyle: "dotted", opacity: 0.9, fontFamily: lists.fonts[1], fontSize: 22, textXAlign: "right", textYAlign: "bottom",
    animation: lists.animations[0],
    // integrate-w2: P10's note keys, so every key a write sets is in the round trip.
    textOpacity: 0.4, link: "https://example.com/c", effect: lists.effects[0], groupId: "g2",
    // retire-custom-behavior: what the retired dialog kept, now set by chat and exec.
    templateCategory: "Costs", hiddenControls: ["color", "ask"],
  };
  assert.deepEqual([...Object.keys(changes), "locked"].sort(), Object.keys(NODE_KEYS).sort());
  const row = world.slate("demo");
  row.nodes = applyPlanToJSON(row, { message: "Done.", operations: [
    { kind: "update_nodes", target: { ids: ["c"] }, changes },
    { kind: "update_nodes", target: { ids: ["c"] }, changes: { locked: true } },
  ] }, { userMessage: "change c" }).slate.nodes;
  const { body } = await call("/api/v1/slates/demo?ids=c", { token });
  // Restated (integrate-w2): groupId and link are write keys now (P10), so they are part of the
  // round trip; only image and comments are read-only extras.
  // Restated (video notes): media is a read-only extra too (a video note reads as its video; any
  // other note reads null). A video is added by add_nodes media or slates.addMedia, never changed.
  const { id, comments, image, media, ...keys } = body.nodes[0];
  assert.equal(media, null);
  assert.deepEqual(keys, { ...changes, locked: true });
});

test("canvas:comment-badges / collab:comment-badges: comment counts per note and in total; markers stay out", async (t) => {
  const world = makeWorld();
  const call = await serve(t, world.registry, world.authenticate);
  const { body } = await call("/api/v1/slates/demo", { token: await world.mint() });
  assert.deepEqual(body.nodes.map((n) => [n.id, n.comments]), [
    ["a", { count: 2, unresolved: 1 }],
    ["b", { count: 1, unresolved: 0 }],
    ["c", { count: 0, unresolved: 0 }],
  ]);
  assert.deepEqual(body.comments, { count: 3, unresolved: 1 });
  assert.equal(JSON.stringify(body).includes('"m1"'), false);
});

test("collab:see-visibility / collab:copy-address-as-visitor: a reader sees their own role and invitation address, not the owner's", async (t) => {
  const world = makeWorld();
  const call = await serve(t, world.registry, world.authenticate);
  const token = await world.mint("reader");
  const { status, body } = await call("/api/v1/slates/shared", { token });
  assert.equal(status, 200);
  assert.deepEqual(body.access, { visibility: "unlisted", yourRole: "READ", isOwner: false, canEdit: false });
  assert.equal(body.url, "https://app.example/canvas/readerkey");
  assert.equal(body.conversation.available, false);
  // The owner sees what the share link gives.
  const owner = await call("/api/v1/slates/shared", { token: await world.mint() });
  assert.equal(owner.body.access.linkRole, "EDIT");
  assert.equal(owner.body.url, "https://app.example/canvas/shared");
  // A stranger, who has no invitation on the account, is refused as before.
  assert.equal((await call("/api/v1/slates/shared", { token: await world.mint("stranger") })).status, 403);
});

test("canvas:view-embedded: a public slate reads without a token, limited per address; nothing else does", async (t) => {
  const world = makeWorld({ limits: { perToken: 120, perAccount: 240, perAddress: 2, windowSeconds: 60 } });
  const call = await serve(t, world.registry, world.authenticate);
  const open = await call("/api/v1/slates/open");
  assert.equal(open.status, 200);
  assert.deepEqual(open.body.access, { visibility: "public", yourRole: "READ", isOwner: false, canEdit: false });
  assert.equal(open.body.conversation.available, false);
  assert.equal(open.headers.get("ratelimit-limit"), "2");
  assert.equal((await call("/api/v1/slates/open")).status, 200);
  const limited = await call("/api/v1/slates/open");
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "rate_limited");
  world.setClock(60000);
  // Private and unlisted slates answer as a missing token always has: 401, saying nothing more.
  const priv = await call("/api/v1/slates/demo");
  assert.equal(priv.status, 401);
  assert.equal(priv.body.error.code, "unauthorized");
  assert.equal((await call("/api/v1/slates/shared")).status, 401);
  // Every call counts against the address, whatever it answers.
  world.setClock(120000);
  assert.equal((await call("/api/v1/slates/nothing-here")).status, 401);
  // A token that does not authenticate is refused, not read as a visitor.
  assert.equal((await call("/api/v1/slates/open", { token: "sbx_bad_bad" })).status, 401);
  // A visitor cannot write.
  const write = await call("/api/v1/slates/open/operations", { method: "POST", body: { plan: { message: "x", operations: [] } } });
  assert.equal(write.status, 401);
});

test("a visitor is counted by the address the operator's proxies saw, never by the proxy or a forged hop", async (t) => {
  const world = makeWorld({ limits: { perToken: 120, perAccount: 240, perAddress: 1, windowSeconds: 60 } });
  // One proxy in front (HTTP_FORWARDED_COUNT=1): it appends the address it saw, rightmost.
  const call = await serve(t, world.registry, world.authenticate, { forwardedCount: 1 });
  const from = (chain) => call("/api/v1/slates/open", { headers: { "x-forwarded-for": chain } });
  // Different readers behind the same proxy each have their own allowance.
  assert.equal((await from("203.0.113.1")).status, 200);
  assert.equal((await from("198.51.100.7")).status, 200);
  assert.equal((await from("198.51.100.8")).status, 200);
  // The same reader is limited, whatever it writes to the left of the proxy's entry.
  assert.equal((await from("203.0.113.1")).status, 429);
  assert.equal((await from("192.0.2.99, 203.0.113.1")).status, 429);
  assert.equal((await from("192.0.2.98, 203.0.113.1")).status, 429);
  // A request that skipped the proxy is counted by its own peer, not by a header it wrote.
  assert.equal((await call("/api/v1/slates/open")).status, 200);
  assert.equal((await call("/api/v1/slates/open")).status, 429);
});

test("with no proxy configured, X-Forwarded-For is the caller's own writing and is ignored", async (t) => {
  const world = makeWorld({ limits: { perToken: 120, perAccount: 240, perAddress: 1, windowSeconds: 60 } });
  const call = await serve(t, world.registry, world.authenticate);
  assert.equal((await call("/api/v1/slates/open", { headers: { "x-forwarded-for": "203.0.113.1" } })).status, 200);
  assert.equal((await call("/api/v1/slates/open", { headers: { "x-forwarded-for": "203.0.113.2" } })).status, 429);
});

test("canvas:get-embed-code: a published board carries its embed address and code; an unpublished one null", async (t) => {
  const world = makeWorld();
  const call = await serve(t, world.registry, world.authenticate);
  const open = await call("/api/v1/slates/open");
  assert.equal(open.body.embed.url, "https://api.example/embed/open");
  assert.match(open.body.embed.code, /^<iframe title="Published Slatebox board" src="https:\/\/api\.example\/embed\/open"/);
  const demo = await call("/api/v1/slates/demo", { token: await world.mint() });
  assert.equal(demo.body.embed, null);
});

test("include=full returns the engine's document: no visibility flags, access keys, record fields or comment markers", async (t) => {
  const world = makeWorld();
  const call = await serve(t, world.registry, world.authenticate);
  const { body } = await call("/api/v1/slates/demo?include=full", { token: await world.mint() });
  assert.deepEqual(Object.keys(body.document).sort(), ["nodes", "options", "shareId"]);
  assert.deepEqual(body.document.nodes.map((n) => n.options.id), ["a", "b", "c"]);
  const text = JSON.stringify(body.document);
  for (const leak of ["isPublic", "isPrivate", "isUnlisted", "accessKey", "isComment", "creationBrief", "userId", "lastSaved"])
    assert.equal(text.includes(leak), false, `${leak} does not leak`);
});

test("canvas:search-within-canvas / critic:result-size-and-selection: ids, within, q, fields and cursor paging", async (t) => {
  const world = makeWorld();
  const call = await serve(t, world.registry, world.authenticate);
  const token = await world.mint();
  const ids = (body) => body.nodes.map((n) => n.id);
  assert.deepEqual(ids((await call("/api/v1/slates/demo?ids=c,a", { token })).body), ["c", "a"]);
  assert.deepEqual(ids((await call("/api/v1/slates/demo?within=0,0,650,300", { token })).body), ["a", "b"]);
  assert.deepEqual(ids((await call("/api/v1/slates/demo?q=REVIEW", { token })).body), ["b"]);
  assert.deepEqual(ids((await call("/api/v1/slates/demo?q=ev&match=contains", { token })).body), ["b"]);
  const fields = await call("/api/v1/slates/demo?fields=text,x,y&ids=a", { token });
  assert.deepEqual(fields.body.nodes, [{ id: "a", text: "Intake", x: 100, y: 100 }]);
  const bad = await call("/api/v1/slates/demo?ids=a&q=Intake", { token });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "invalid_selection");
  assert.equal((await call("/api/v1/slates/demo?fields=isPublic", { token })).body.error.code, "invalid_selection");

  const row = world.slate("demo");
  row.nodes = Array.from({ length: 400 }, (_, i) => note(`n${i}`, `Note ${i}`, (i % 20) * 220, Math.floor(i / 20) * 120));
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = await call(`/api/v1/slates/demo?limit=150${cursor ? `&cursor=${cursor}` : ""}`, { token });
    assert.equal(page.status, 200);
    assert.equal(page.body.nodeCount, 400);
    seen.push(...ids(page.body));
    cursor = page.body.nextCursor;
    pages += 1;
  } while (cursor);
  assert.ok(pages >= 3);
  assert.deepEqual(seen, row.nodes.map((n) => n.options.id));
});

test("conv:conv-starter-flow / -workshop / -interactive / conv:conv-opening-brief: the panel's starters, from one list", async (t) => {
  const world = makeWorld();
  const call = await serve(t, world.registry, world.authenticate);
  const { body } = await call("/api/v1/slates/demo", { token: await world.mint() });
  assert.deepEqual(body.conversation.starters, canvasStarters(world.slate("demo").nodes));
  assert.deepEqual(body.conversation.starters, [
    { label: "Draw a flow", text: "Send → Next step", select: [7, 16] },
    { label: "Build a workshop", text: "Make a workshop with Now, Next and Later", select: [21, 40] },
    { label: "Add interactive behavior", text: "Make this drawing interactive" },
  ]);
  assert.deepEqual(canvasStarters([]), [
    { label: "Draw a flow", text: "Intake → Review → Send a reply", select: [0, 30] },
    { label: "Build a workshop", text: "Make a workshop with Now, Next and Later", select: [21, 40] },
    { label: "Add interactive behavior", text: "Make this interactive: Intake → Review", select: [23, 38] },
  ]);
});

test("ws rows: a release plan reads with kind, what it keeps, captions, load, points, dependencies, scenes, starters and its notes", async (t) => {
  const world = makeWorld();
  const call = await serve(t, world.registry, world.authenticate);
  const { status, body } = await call("/api/v1/slates/release", { token: await world.mint() });
  assert.equal(status, 200);
  const w = body.workshop;
  assert.equal(w.kind, "release-plan");
  assert.equal(w.revision, 4);
  assert.equal(w.fixed.lanes, "A release plan keeps the releases it came with. You can rename them and set how many points each holds.");
  assert.equal(w.fixed.cards, "A release plan keeps the features it came with. You can rename them, move them and set their points.");
  const friday = w.lanes.find((lane) => lane.id === "friday");
  assert.deepEqual([friday.caption, friday.held, friday.load, friday.capacity], ["3 / 8 points", 1, 3, 8]);
  const invite = w.cards.find((card) => card.id === "invite");
  assert.deepEqual([invite.points, invite.dependsOn], [3, ["guardrails"]]);
  assert.deepEqual(w.scenes.map((scene) => scene.laneId), w.presentationOrder);
  assert.ok(w.scenes[0].nodeIds.includes("lane-" + w.scenes[0].laneId));
  assert.deepEqual(w.operations, ["workshop_edits", "undo_workshop_edit", "move_workshop_card", "set_presentation_order"]);
  // The edits a release plan takes, read from the engine's table for this board.
  assert.ok(w.edits.includes("set_card_points") && w.edits.includes("move_card") && !w.edits.includes("add_card"));
  // Boards S2a: what this board takes in plain words, with a phrase each (the gear's "What else can this board do?").
  assert.deepEqual(w.can, boardCan(releasePlan));
  assert.equal(w.livePresentation, null);
  // Restated 2026-11-21: a slate with a workshop publishes its presentation like any slate (no
  // workshop-only publication in the read); its published board carries the embed, as any board's.
  assert.equal("publication" in w, false);
  assert.equal(body.embed.url, "https://api.example/embed/release");
  // conv:ws-starters / ws:use-a-starter-message: the starters the workshop conversation offers.
  assert.deepEqual(body.conversation.starters, workshopStarters(releasePlan));
  assert.ok(body.conversation.starters.length > 0);
  // ws:see-workshop-as-notes: the lanes and cards are read where the canvas draws them, beside the slate's own notes.
  const noteIds = body.nodes.map((n) => n.id);
  assert.ok(noteIds.includes("own"));
  assert.ok(noteIds.includes("card-invite"));
  assert.ok(noteIds.includes("caption-friday"));
  assert.equal(body.nodes.find((n) => n.id === "caption-friday").text, "3 / 8 points");
});

test("a reader of a workshop reads the live presentation as it runs: the step, not the deck", async (t) => {
  const world = makeWorld();
  // Restated 2026-11-21: one live session per slate (the slate's own livePresentation), whose step
  // is the presenter's viewpoint index; the deck it plays is not part of the read.
  world.slate("release").livePresentation = { sessionId: "s", step: 1, revision: 2, expiresAt: 6000,
    deck: { name: "Friday", viewpoints: [{ nodeIds: ["lane-friday"], narrative: "Friday release", duration: 2200 },
      { nodeIds: ["lane-next"], narrative: "Next week", duration: 2200 }] } };
  const call = await serve(t, world.registry, world.authenticate);
  const { body } = await call("/api/v1/slates/release", { token: await world.mint("reader") });
  assert.equal(body.access.yourRole, "READ");
  assert.equal("publication" in body.workshop, false);
  assert.deepEqual(body.workshop.livePresentation, { sessionId: "s", step: 1, revision: 2, expiresAt: 6000 });
  assert.equal(body.url, "https://app.example/canvas/relkey");
});

test("a saved workshop that cannot be read answers 422 invalid_workshop", async (t) => {
  const world = makeWorld();
  world.slate("release").creative.model.workshop = { version: 1, title: "", lanes: [], cards: [] };
  const call = await serve(t, world.registry, world.authenticate);
  const { status, body } = await call("/api/v1/slates/release", { token: await world.mint() });
  assert.equal(status, 422);
  assert.equal(body.error.code, "invalid_workshop");
});

test("a stored row whose notes are not a list reads as a slate with no notes, as it did before P07", async (t) => {
  const world = makeWorld();
  world.slate("demo").nodes = "x";
  const call = await serve(t, world.registry, world.authenticate);
  const { status, body } = await call("/api/v1/slates/demo", { token: await world.mint() });
  assert.equal(status, 200);
  assert.equal(body.nodeCount, 0);
  assert.deepEqual(body.nodes, []);
  assert.deepEqual(body.conversation.starters.map((s) => s.label), ["Draw a flow", "Build a workshop", "Add interactive behavior"]);
});

// The staging release check (scripts/verify-agent-surfaces.mjs) targets a live host, so it is
// not run here; what it reads from the slate read is. Review P07 F1: it still read {slate}.
test("the release verifier reads only what the slate read returns", async (t) => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./verify-agent-surfaces.mjs", import.meta.url), "utf8");
  const paths = [...new Set([...source.matchAll(/\.((?:document|access|slate|summary)(?:\.\w+)+)/g)].map((m) => m[1]))];
  assert.ok(paths.includes("document.nodes") || paths.some((p) => p.startsWith("document.nodes.")), "it reads the notes");
  const world = makeWorld();
  const call = await serve(t, world.registry, world.authenticate);
  const { body } = await call("/api/v1/slates/demo?include=full", { token: await world.mint() });
  for (const path of paths) {
    const value = path.split(".").reduce((at, key) => at?.[key], body);
    assert.notEqual(value, undefined, `the verifier reads ${path}, which the read does not return`);
  }
  assert.ok(body.document.nodes.every((n) => typeof n.options.id === "string" && "text" in n.options));
});

// Release/agentic: the self-hosted app gets the operator's HTTP_FORWARDED_COUNT (it was read only
// from the process environment, which Compose did not pass), and the README says what to set.
test("self-host passes HTTP_FORWARDED_COUNT to the app and says what to set it to", async () => {
  const { readFile } = await import("node:fs/promises");
  const compose = await readFile(new URL("../self-host/compose.yaml", import.meta.url), "utf8");
  const app = compose.slice(compose.indexOf("\n  app:\n"));
  assert.match(app.slice(0, app.indexOf("\n    ports:")), /\n {6}HTTP_FORWARDED_COUNT: \$\{HTTP_FORWARDED_COUNT:-\}$/m);
  const readme = await readFile(new URL("../self-host/README.md", import.meta.url), "utf8");
  assert.match(readme, /Set `HTTP_FORWARDED_COUNT` in `\.state\/instance\.env`/);
  assert.match(readme, /`1` behind the bundled Caddy/);
});
