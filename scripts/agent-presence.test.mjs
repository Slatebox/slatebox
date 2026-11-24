// Agents on the canvas: the server's presence record (server/presence/agentPresence.mjs), how it
// is labelled, paced and ended, what a reader receives, and that exec runs and MCP clients reach it.
import assert from "node:assert/strict";
import express from "express";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  PRESENCE_LIMITS, agentKeyFor, agentLabel, cleanStepText, createAgentPresence, createPresenceReader, firstNameOf, publicRecord, sanitizeClientName,
} from "../web/app/server/presence/agentPresence.mjs";
import { AGENT_COLORS, nearAgentColor, personColor } from "../web/app/imports/api/common/agent-colors.mjs";
import { personColour, personCursorColour } from "../web/app/imports/api/common/guest-name.mjs";
import { clockOffset, onScreenClock } from "../web/app/imports/api/common/agent-clock.mjs";
import { renderExecTool } from "../web/app/server/actions/client-render.mjs";
import { mountMcp, reportedClientName } from "../web/app/server/mcp/endpoint.mjs";
import { EXEC_LIMITS } from "../web/app/server/exec/limits.mjs";
import { memoryCollection, makeExecWorld } from "./exec-test-world.mjs";
import { createRequire } from "node:module";

const appRequire = createRequire(new URL("../web/app/package.json", import.meta.url));
const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);
const LRI = String.fromCharCode(0x2066);

const agent = (over = {}) => ({ kind: "agent", userId: "owner", tokenId: "tok1", tokenName: "Agent", scopes: [], runId: "run-1", ...over });
const slateA = { _id: "slate-a", shareId: "a", nodes: [{ options: { id: "n1" } }, { options: { id: "n2" } }] };
const slateB = { _id: "slate-b", shareId: "b", nodes: [{ options: { id: "m1" } }] };

function store({ now = () => 1000, timers = [] } = {}) {
  const collection = memoryCollection();
  const presence = createAgentPresence({
    collection,
    secret: "k",
    findUser: async (id) => ({ owner: { profile: { firstName: "Ada" } }, ben: { emails: [{ address: "ben.smith@x.test" }] } })[id] ?? null,
    findToken: async (id) => (id === "tok-mcp" ? { lastClient: "Desk" + RLO + "top" } : null),
    now,
    setTimer: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearTimer: (timer) => { timer.cleared = true; },
  });
  return { collection, presence, docs: () => [...collection.docs.values()] };
}

test("a client's name is cleaned before it is shown: no direction or invisible characters, no markup, 40 characters", () => {
  assert.equal(sanitizeClientName("Cl" + RLO + "aude" + ZWSP + " Desktop"), "Claude Desktop");
  assert.equal(sanitizeClientName("<b>Bold</b> tool"), "bBoldb tool");
  assert.equal(sanitizeClientName("x".repeat(200)).length, 40);
  assert.equal(sanitizeClientName(LRI + "  Cursor   (beta) 1.2  "), "Cursor (beta) 1.2");
  assert.equal(sanitizeClientName("<>/\\" + RLO), null);
  assert.equal(sanitizeClientName(42), null);
  // Fullwidth letters fold to plain ones (NFKC).
  assert.equal(sanitizeClientName(String.fromCharCode(0xff21, 0xff22)), "AB");
});

test("the label is the owner's first name, then the client's name, never the client alone", () => {
  assert.equal(firstNameOf({ profile: { firstName: "Ada" } }), "Ada");
  assert.equal(firstNameOf({ emails: [{ address: "ben.smith@example.test" }] }), "Ben");
  assert.equal(firstNameOf({}), "Someone");
  assert.equal(agentLabel("Ada"), "Ada's agent");
  assert.equal(agentLabel("Ada", "<b>" + "y".repeat(200)), "Ada's agent · b" + "y".repeat(39));
  assert.equal(agentLabel("Ada", RLO), "Ada's agent");
});

test("agentKey is stable per token and slate, differs across slates, and is never the token id", () => {
  const a = agentKeyFor("secret", "tok1", "slate-a");
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.equal(a, agentKeyFor("secret", "tok1", "slate-a"));
  assert.notEqual(a, agentKeyFor("secret", "tok1", "slate-b"));
  assert.notEqual(a, agentKeyFor("other", "tok1", "slate-a"));
  assert.ok(!a.includes("tok1"));
});

test("agent colours: people never get one, and the app's list is the engine's", async () => {
  const engine = await import(appRequire.resolve("slateboxjs"));
  assert.deepEqual(AGENT_COLORS, [...(engine.AGENT_PALETTE ?? engine.default.AGENT_PALETTE)]);
  for (const color of AGENT_COLORS) assert.equal(nearAgentColor(color), true);
  const rolls = ["#6d28d9", "#0f766f", "#ff8800"];
  assert.equal(personColor(() => rolls.shift()), "#ff8800");
});

test("a person's cursor colour is never near an agent's and reads on white (3:1 or better), over many keys", () => {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const onWhite = (hex) => 1.05 / (luminance(hex) + 0.05);
  const hues = new Set();
  let kept = 0;
  for (let i = 0; i < 5000; i++) {
    const key = `person-${i}`;
    const color = personCursorColour(key);
    assert.match(color, /^#[0-9a-f]{6}$/);
    assert.equal(nearAgentColor(color), false, `${key}: ${color} is near an agent's colour`);
    assert.ok(onWhite(color) >= 3, `${key}: ${color} is ${onWhite(color).toFixed(2)}:1 on white`);
    assert.equal(personCursorColour(key), color, "the same on every tab");
    hues.add(personColour(key));
    if (color === personColour(key)) kept += 1;
  }
  assert.ok(hues.size >= 300, "the keys cover the hues");
  assert.ok(kept > 0, "a colour not near an agent's keeps 38%");
  // The fallback when nothing usable rolled reads on white and is not an agent's either.
  const fallback = personColor(() => AGENT_COLORS[0]);
  assert.equal(nearAgentColor(fallback), false);
  assert.ok(onWhite(fallback) >= 4.5);
});

test("the canvas entry carries no agent drawing: the listener loads slateboxjs/presence when an agent arrives, slateboxjs/suggestions when a suggestion waits", async () => {
  const core = await import(appRequire.resolve("slateboxjs"));
  const named = { ...core, ...(core.default || {}) };
  assert.equal(named.createAgentPresence, undefined);
  assert.equal(named.createAgentSuggestions, undefined);
  assert.equal(typeof named.visibleAgents, "function");
  const drawing = await import(appRequire.resolve("slateboxjs/presence"));
  assert.equal(typeof drawing.createAgentPresence, "function");
  // The suggestions are their own lazy entry: the pointers' entry does not carry them.
  assert.equal(drawing.createAgentSuggestions, undefined);
  const ghosts = await import(appRequire.resolve("slateboxjs/suggestions"));
  assert.equal(typeof ghosts.createAgentSuggestions, "function");
  const { readFile } = await import("node:fs/promises");
  const listener = await readFile(new URL("../web/app/imports/ui/components/AgentPresenceListener.jsx", import.meta.url), "utf8");
  assert.match(listener, /import\('slateboxjs\/presence'\)/);
  assert.match(listener, /import\('slateboxjs\/suggestions'\)/);
  assert.doesNotMatch(listener, /^import [^\n]*createAgent(Presence|Suggestions)/m);
});

test("a save shows the run: label, initial, colour, targets and the save's message; MCP clients are named", async () => {
  const { presence, docs } = store();
  await presence.saved(agent(), slateA, { targets: ["n1", "n2"], message: "Add the brief" });
  const [doc] = docs();
  assert.deepEqual([doc.label, doc.initial, doc.status, doc.targets, doc.message], ["Ada's agent", "A", "live", ["n1", "n2"], "Add the brief"]);
  assert.equal(doc.agentKey, agentKeyFor("k", "tok1", "slate-a"));
  assert.ok(doc.colorIndex >= 0 && doc.colorIndex < 6);
  assert.equal(new Date(doc.expiresAt).getTime() - new Date(doc.updatedAt).getTime(), PRESENCE_LIMITS.silentMs);
  await presence.saved(agent({ tokenId: "tok-mcp", runId: "run-2" }), slateA, { targets: [] });
  assert.equal(docs()[1].label, "Ada's agent · Desktop");
  // A person or a visitor never makes one.
  await presence.saved({ kind: "person", userId: "owner", tokenId: null }, slateA, { targets: ["n1"] });
  assert.equal(docs().length, 2);
});

test("writes are paced to 4 a second per run: the latest wins, with a trailing write", async () => {
  let clock = 1000;
  const timers = [];
  const { presence, docs } = store({ now: () => clock, timers });
  await presence.saved(agent(), slateA, { targets: ["n1"] });
  for (const id of ["n2", "n1", "n2"]) { clock += 20; await presence.saved(agent(), slateA, { targets: [id] }); }
  assert.deepEqual(docs()[0].targets, ["n1"], "only the first write landed");
  assert.equal(timers.length, 1, "one trailing write is waiting");
  assert.ok(timers[0].ms <= PRESENCE_LIMITS.writeGapMs);
  clock = 1250;
  await timers[0].fn();
  assert.deepEqual(docs()[0].targets, ["n2"], "the latest write won");
});

test("a plan of up to 8 steps, ticked in order; at most 3 plans and 40 ticks per run", async () => {
  const { presence, docs } = store();
  const plan = await presence.plan(agent(), slateA, ["Read the interview notes", "Draft a brief", "Map the new signup flow", "Shorten the flow"]);
  assert.deepEqual(plan.steps.map((step) => step.status), ["doing", "todo", "todo", "todo"]);
  const next = await presence.step(agent(), slateA, 0, "done");
  assert.deepEqual(next.steps.map((step) => step.status), ["done", "doing", "todo", "todo"]);
  const skip = await presence.step(agent(), slateA, 3, "doing");
  assert.deepEqual(skip.steps.map((step) => step.status), ["done", "done", "todo", "doing"]);
  await assert.rejects(presence.plan(agent(), slateA, ["<script>", ""]), { code: "invalid_request" });
  await assert.rejects(presence.plan(agent(), slateA, Array(9).fill("x")), { code: "invalid_request" });
  await presence.plan(agent(), slateA, ["Two"]);
  await presence.plan(agent(), slateA, ["Three"]);
  await assert.rejects(presence.plan(agent(), slateA, ["Four"]), { status: 429, code: "presence_limit" });
  await assert.rejects(presence.step(agent(), slateA, 5, "done"), { code: "invalid_request" });
  for (let i = docs()[0].stepCount; i < PRESENCE_LIMITS.steps; i++) await presence.step(agent(), slateA, 0, i % 2 ? "done" : "doing");
  await assert.rejects(presence.step(agent(), slateA, 0, "done"), { status: 429, code: "presence_limit" });
  await assert.rejects(presence.step(agent({ runId: "fresh" }), slateA, 0, "done"), { code: "no_plan" });
});

test("a run's end finishes the step under way, or marks it stopped when the run failed", async () => {
  let clock = 1000;
  const { presence, docs } = store({ now: () => clock });
  await presence.plan(agent(), slateA, ["One", "Two"]);
  await presence.plan(agent({ runId: "run-9" }), slateB, ["Only"]);
  clock = 5000;
  await presence.end("run-1", "done");
  await presence.end("run-9", "stopped");
  const [done, stopped] = docs();
  assert.equal(done.status, "done");
  assert.deepEqual(done.plan.steps.map((step) => step.status), ["done", "todo"]);
  assert.equal(new Date(done.expiresAt).getTime(), 5000 + PRESENCE_LIMITS.endedMs);
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.plan.steps[0].status, "stopped");
});

test("at most three live agents of one owner on one slate: the oldest is ended", async () => {
  let clock = 1000;
  const { presence, docs } = store({ now: () => clock });
  for (const runId of ["r1", "r2", "r3", "r4"]) { clock += 1000; await presence.saved(agent({ runId }), slateA, { targets: ["n1"] }); }
  const live = docs().filter((doc) => doc.status === "live").map((doc) => doc.runId);
  assert.deepEqual(live.sort(), ["r2", "r3", "r4"]);
});

test("a reader of slate A receives slate A's agents only, public fields only, targets on A only", async () => {
  const { presence, collection } = store();
  await presence.saved(agent(), slateA, { targets: ["n1", "m1", "gone"] });
  await presence.saved(agent({ runId: "run-b" }), slateB, { targets: ["m1"] });
  const read = createPresenceReader({
    resolve: async (shareId, userId) => (userId === "reader-a" && shareId === "a" ? slateA : userId === "reader-b" && shareId === "b" ? slateB : null),
    list: async (slateId) => collection.find({ slateId }).toArray(),
    now: () => 2000,
  });
  const forA = await read("a", "reader-a");
  assert.equal(forA.records.length, 1);
  const [record] = forA.records;
  assert.deepEqual(record.targets, ["n1"]);
  for (const hidden of ["tokenId", "userId", "ownerId", "runId", "planCount", "stepCount", "createdAt"]) assert.ok(!(hidden in record), hidden);
  assert.ok(!JSON.stringify(forA).includes("tok1") && !JSON.stringify(forA).includes("owner"));
  assert.equal(await read("b", "reader-a"), null, "no access to B: nothing at all");
  assert.equal((await read("b", "reader-b")).records[0].targets[0], "m1");
  // Workshop cards and lanes are targets by the names the canvas draws them under.
  assert.deepEqual(
    publicRecord({ targets: ["card-x", "lane-y", "card-z"] }, new Set(["card-x", "lane-y"])).targets,
    ["card-x", "lane-y"]
  );
  // An expired record is not sent.
  const later = createPresenceReader({ resolve: async () => slateA, list: async (slateId) => collection.find({ slateId }).toArray(), now: () => 10_000_000 });
  assert.deepEqual((await later("a", "reader-a")).records, []);
});

test("an exec run: plan, save, tick — the record follows it, and ends with it", async (t) => {
  const world = makeExecWorld({ limits: { ...EXEC_LIMITS, cpuMs: 1500, wallMs: 8000 } });
  t.after(() => world.close());
  const principal = await world.principalFor(["slates:read", "slates:write"]);
  const code = `
await slatebox.presence.plan({ shareId: "demo", steps: ["Read the interview notes", "Draft a brief", "Map the new signup flow", "Shorten the flow"] })
const r = await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, plan: { message: "Draft a brief", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "Brief" }] } })
await slatebox.presence.step({ shareId: "demo", index: 0, status: "done" })
return r.report.created`;
  const out = await world.exec.service.run({ principal, intent: "Draft a brief", code });
  assert.equal(out.status, "completed", JSON.stringify(out.error));
  const [doc] = [...world.presenceRows.docs.values()];
  assert.equal(doc.runId, out.execId);
  assert.equal(doc.label, "Ada's agent");
  assert.deepEqual(doc.targets, out.result);
  assert.equal(doc.status, "done", "the run ended");
  assert.deepEqual(doc.plan.steps.map((step) => step.status), ["done", "done", "todo", "todo"]);
  assert.deepEqual(out.usage.operations, 1, "presence calls are not operations");
  assert.equal(out.calls.length, 3);
  // A preview run shows nothing.
  world.presenceRows.docs.clear();
  const preview = await world.exec.service.run({ principal, intent: "Preview", code, mode: "preview" });
  assert.equal(preview.status, "completed", JSON.stringify(preview.error));
  assert.equal(world.presenceRows.docs.size, 0);
  // A held plan shows nothing either.
  const held = await world.exec.service.run({ principal, intent: "Remove", code: `return slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 1, plan: { message: "Remove", operations: [{ kind: "delete_nodes", target: { ids: ["second"] } }] } })` });
  assert.equal(held.status, "confirmation_required");
  assert.equal(world.presenceRows.docs.size, 0);
});

test("a token that may only read the slate cannot put a pointer on it", async (t) => {
  const world = makeExecWorld();
  t.after(() => world.close());
  const reader = await world.principalFor(["slates:read"]);
  await assert.rejects(world.registry.run(reader, "presence.plan", { shareId: "demo", steps: ["Hi"] }), { code: "insufficient_scope" });
  const other = await world.principalFor(["slates:read", "slates:write"], "other");
  await assert.rejects(world.registry.run(other, "presence.plan", { shareId: "demo", steps: ["Hi"] }), { status: 403 });
  assert.equal(world.presenceRows.docs.size, 0);
});

test("an MCP client's reported name is kept on the token, cleaned", async (t) => {
  assert.equal(reportedClientName({ jsonrpc: "2.0", method: "initialize", params: { clientInfo: { name: "Tool" } } }), "Tool");
  assert.equal(reportedClientName({ jsonrpc: "2.0", method: "tools/list" }), null);
  const world = makeExecWorld();
  t.after(() => world.close());
  const recorded = [];
  const app = express();
  mountMcp(app, {
    express, sdk: { Server, StreamableHTTPServerTransport, ListToolsRequestSchema, CallToolRequestSchema },
    registry: world.registry, manifest: world.exec.manifest, tools: renderExecTool(world.exec.manifest),
    authenticate: world.authenticate, appOrigin: "https://app.slatebox.test", version: "1.0",
    recordClient: (principal, name) => recorded.push([principal.tokenId, sanitizeClientName(name)]),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { token, id } = await world.mint();
  const client = new Client({ name: LRI + "<b>Spoof</b>" + "z".repeat(200), version: "1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  t.after(() => client.close());
  assert.deepEqual(recorded, [[id, "bSpoofb" + "z".repeat(33)]]);
});

test("a run that ended stays ended: a save still pending when it ended does not bring its pointer back", async () => {
  let clock = 10_000;
  const { presence, docs } = store({ now: () => clock });
  const run = agent({ runId: "exec-1" });
  await presence.plan(run, slateA, ["Map the flow", "Shorten it"]);
  await presence.saved(run, slateA, { targets: ["n1"] });
  clock += 1000;
  await presence.end("exec-1", "stopped");
  const ended = docs()[0];
  assert.equal(ended.status, "stopped");
  clock += 500;
  await presence.saved(run, slateA, { targets: ["n2"] });
  const after = docs()[0];
  assert.equal(after.status, "stopped", "still ended");
  assert.ok(after.endedAt, "still has its end");
  assert.equal(after.expiresAt.getTime(), ended.expiresAt.getTime(), "still leaves when it was going to");
  assert.deepEqual(after.targets, ["n1"]);
  await assert.rejects(presence.plan(run, slateA, ["Again"]), { code: "run_ended" });
  await assert.rejects(presence.step(run, slateA, 1, "done"), { code: "run_ended" });
  // A run the owner cap ended (not the run itself) may come back when it saves again.
  for (const id of ["r1", "r2", "r3", "r4"]) { clock += 300; await presence.saved(agent({ runId: id }), slateA, { targets: ["n1"] }); }
  assert.equal(docs().find((doc) => doc.runId === "r1").status, "done");
  clock += 300;
  await presence.saved(agent({ runId: "r1" }), slateA, { targets: ["n2"] });
  assert.equal(docs().find((doc) => doc.runId === "r1").status, "live");
});

test("two runs of one token on one slate are two pointers, each under its own public id", async () => {
  let clock = 1000;
  const { presence, collection } = store({ now: () => clock });
  await presence.saved(agent({ runId: "exec-a" }), slateA, { targets: ["n1"] });
  clock += 1000;
  await presence.saved(agent({ runId: "exec-b" }), slateA, { targets: ["n2"] });
  const read = createPresenceReader({ resolve: async () => slateA, list: async (slateId) => collection.find({ slateId }).toArray(), now: () => clock });
  const { records } = await read("a", "reader");
  assert.equal(records.length, 2);
  assert.equal(new Set(records.map((record) => record._id)).size, 2);
  assert.deepEqual(records.map((record) => record.agentKey), records.map((record) => record._id));
  assert.equal(records[0].colorIndex, records[1].colorIndex, "one token, one colour");
  assert.ok(records.every((record) => /^[0-9a-f]{16}$/.test(record._id) && record._id !== agentKeyFor("k", "tok1", "slate-a")));
});

test("a token's pacing entry is let go once its run has been silent as long as a record lasts", async () => {
  let clock = 1000;
  const timers = [];
  const { presence } = store({ now: () => clock, timers });
  for (let i = 0; i < 50; i++) { clock += 300; await presence.saved(agent({ runId: undefined, tokenId: "tok-" + i }), slateA, { targets: ["n1"] }); }
  clock += PRESENCE_LIMITS.silentMs + 1;
  await presence.saved(agent({ runId: "fresh" }), slateA, { targets: ["n1"] });
  // Only the fresh run is still paced; nothing else waits.
  assert.equal(presence.pacingSize?.() ?? 1, 1);
});

test("a screen whose clock is off reads expiry and endings on the server's time", () => {
  const serverNow = 1_000_000;
  // The screen's clock is 45 s ahead of the server's.
  const offset = clockOffset({ serverNow }, serverNow + 45_000);
  assert.equal(offset, -45_000);
  const record = { agentKey: "a", expiresAt: new Date(serverNow + 30_000), endedAt: null, updatedAt: new Date(serverNow) };
  const local = onScreenClock(record, offset);
  assert.equal(local.expiresAt.getTime(), serverNow + 75_000, "still 30 s left on the screen's clock");
  assert.equal(local.endedAt, null);
  assert.equal(onScreenClock(record, 0), record);
  // Remembered for that server time: a later re-read does not drift.
  assert.equal(clockOffset({ serverNow }, serverNow + 90_000), -45_000);
});

test("a label cannot pass for someone else: look-alike letters, blank symbols and claims are cleaned", async () => {
  // A Cyrillic А reads as "Ada".
  assert.equal(firstNameOf({ profile: { firstName: "\u0410da" } }), "Ada");
  assert.equal(firstNameOf({ profile: { firstName: "\u0410\u043d\u043d\u0430" } }), "\u0410\u043d\u043d\u0430", "a name in one script is kept");
  assert.equal(sanitizeClientName("Slatebox (official)"), null);
  assert.equal(sanitizeClientName("Ben (person)"), null);
  assert.equal(sanitizeClientName("S\u0406atebox"), null);
  assert.equal(sanitizeClientName("Desk tool"), "Desk tool");
  assert.equal(cleanStepText("Read\u2800\u2800 notes"), "Read notes");
  assert.equal(cleanStepText("\u2800\u2800"), "");
  // Another Ada's agent on Ada's slate is told apart by an initial.
  const collection = memoryCollection();
  const presence = createAgentPresence({
    collection, secret: "k",
    findUser: async (id) => ({ ada: { profile: { firstName: "Ada" } }, spoof: { profile: { firstName: "\u0410da", lastName: "Byron" } }, ben: { profile: { firstName: "Ben" } } })[id] ?? null,
    now: () => 1000, setTimer: () => 1, clearTimer: () => {},
  });
  const adaSlate = { _id: "slate-ada", userId: "ada", nodes: [] };
  await presence.saved(agent({ userId: "spoof", tokenId: "t-s", runId: "s" }), adaSlate, {});
  await presence.saved(agent({ userId: "ben", tokenId: "t-b", runId: "b" }), adaSlate, {});
  await presence.saved(agent({ userId: "ada", tokenId: "t-a", runId: "a" }), adaSlate, {});
  const labels = Object.fromEntries([...collection.docs.values()].map((doc) => [doc.runId, doc.label]));
  assert.deepEqual(labels, { s: "Ada B.'s agent", b: "Ben's agent", a: "Ada's agent" });
});
