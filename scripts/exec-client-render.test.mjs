// The generated exec client: which actions it binds, the contract a bound action must meet,
// the declarations an agent reads, the exec tool description budget, describe, and the guest
// prelude's behaviour. No Meteor, no network.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createAppRegistry, actions as appActions, components as appComponents } from "../web/app/server/actions/index.mjs";
import { createRegistry, defineAction } from "../web/app/server/actions/registry.mjs";
import { API_TOKEN_SCOPES } from "../web/app/server/api-token-core.mjs";
import { boundActions, NEVER_BOUND } from "../web/app/server/actions/exec-binding.mjs";
import {
  buildClientManifest, describeClient, DESCRIPTION_BUDGET, execDescription, renderClientFiles,
  renderDeclarations, renderExecTool, renderPrelude, wrapScript,
} from "../web/app/server/actions/client-render.mjs";

const registry = createAppRegistry();
const manifest = buildClientManifest(registry);
const AsyncFunction = (async () => {}).constructor;

// Runs the prelude + code the way a runner does, with a fake bridge.
async function runGuest(code, call = async (name, input) => ({ ok: true, value: { name, input } })) {
  const source = wrapScript(renderPrelude(manifest), code);
  return new AsyncFunction("__slatebox", source)({ call });
}

const writeAction = (overrides = {}) => defineAction({
  id: "things.write", title: "Write a thing", description: "Writes.", toolset: "things", kind: "write",
  scope: "slates:write", principals: ["agent"], mounts: { http: { method: "POST", path: "/things" } },
  input: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false },
  output: { type: "object", properties: { ok: { type: "boolean" } } }, handler: () => ({}),
  ...overrides,
});
const registryWith = (...extra) =>
  createRegistry({ actions: [...appActions, ...extra], components: appComponents, scopes: API_TOKEN_SCOPES });

test("a method exists for each HTTP action an agent may call, except token management and exec itself", () => {
  const expected = appActions
    .filter((a) => a.mounts.http && a.principals.includes("agent"))
    .filter((a) => !/^apiTokens\./.test(a.id) && !/^exec\./.test(a.id))
    .map((a) => a.id)
    .sort();
  assert.deepEqual(manifest.methods.map((m) => m.name), expected);
  assert.ok(expected.includes("slates.applyOperations"));
  assert.equal(manifest.methods.some((m) => m.name.startsWith("apiTokens.")), false, "no token management in client.json");
  assert.equal(manifest.methods.some((m) => m.name.startsWith("exec.")), false, "no recursion");
  assert.ok(NEVER_BOUND.some((rule) => rule.test("apiTokens.create")));
  assert.deepEqual(boundActions(registry).map((a) => a.id).sort(), expected);
  // A DDP-only action is not reachable from a script until it has a route.
  const ddpOnly = defineAction({ ...writeAction(), id: "things.local", principals: ["person"], mounts: { ddp: true }, idempotency: "optional" });
  assert.equal(buildClientManifest(registryWith(ddpOnly)).methods.some((m) => m.name === "things.local"), false);
});

test("an action added later appears in the client without touching the renderer", () => {
  const later = writeAction({ idempotency: "optional", modes: ["save", "preview"] });
  const next = buildClientManifest(registryWith(later));
  const method = next.methods.find((m) => m.name === "things.write");
  assert.ok(method);
  assert.deepEqual(method.modes, ["save", "preview"]);
  assert.match(method.index, /^things\.write\(\{name\?, mode\?\}\) — Write a thing$/);
  assert.match(method.dts, /declare namespace slatebox\.things \{/);
  assert.match(method.dts, /function write\(input: \{/);
});

test("a bound write without an idempotency policy fails the generator and names the action", () => {
  assert.throws(() => buildClientManifest(registryWith(writeAction())), /Action things\.write: a write bound into the exec client must declare idempotency/);
});

test("a bound action whose output is not an object with properties fails the generator", () => {
  const bad = writeAction({ idempotency: "optional", output: { type: "array", items: { type: "string" } } });
  assert.throws(() => buildClientManifest(registryWith(bad)), /Action things\.write: a bound action's output must be an object/);
  // A nested bare object is allowed (rendered as a record).
  const nested = writeAction({ idempotency: "optional", output: { type: "object", properties: { extra: { type: "object" } } } });
  const method = buildClientManifest(registryWith(nested)).methods.find((m) => m.name === "things.write");
  assert.match(method.dts, /extra\?: Record<string, unknown>;/);
});

test("a recursive schema fails the generator", () => {
  const loop = writeAction({ idempotency: "optional", input: { type: "object", properties: { node: { $ref: "#/components/schemas/Loop" } }, additionalProperties: false } });
  const reg = createRegistry({
    actions: [...appActions, loop], scopes: API_TOKEN_SCOPES,
    components: { ...appComponents, Loop: { type: "object", properties: { child: { $ref: "#/components/schemas/Loop" } } } },
  });
  assert.throws(() => buildClientManifest(reg), /Recursive schema #\/components\/schemas\/Loop/);
});

test("the declarations keep the registry's named types and put mode in the input", () => {
  const dts = renderDeclarations(manifest);
  const apply = manifest.methods.find((m) => m.name === "slates.applyOperations");
  // (Restated 2026-11-22, library merged onto connected cards: the plan takes the library's
  // WorkshopEditsPlan, WorkshopUndoPlan and AddComponentPlan beside main's WorkshopLinePlan.)
  assert.match(apply.dts, /plan: CanvasPlan \| WorkshopEditsPlan \| WorkshopUndoPlan \| WorkshopMovePlan \| PresentationOrderPlan \| WorkshopLinePlan \| MapAuthoringPlan \| AddComponentPlan;/);
  assert.match(apply.dts, /mode\?: "save" \| "preview";/);
  assert.match(apply.dts, /@scope slates:write @modes save\|preview @destructive/);
  assert.deepEqual(apply.types, ["AddComponentPlan", "CanvasPlan", "MapAuthoringPlan", "PresentationOrderPlan", "Workshop", "WorkshopEditsPlan", "WorkshopLinePlan", "WorkshopMovePlan", "WorkshopUndoPlan"]);
  assert.match(dts, /^interface CanvasPlan \{/m);
  assert.match(dts, /^interface Workshop \{/m);
  assert.match(dts, /declare class SlateboxError extends Error/);
  assert.equal(/idempotencyKey/i.test(dts), false, "keys are derived; no idempotencyKey in the guest API");
  const get = manifest.methods.find((m) => m.name === "slates.get");
  // Restated (wave 2, P07): the read takes note selection and paging.
  assert.equal(get.index, "slates.get({shareId, include?, fields?, ids?, within?, groupId?, q?, match?, limit?, cursor?}) — Read a slate");
  assert.deepEqual(get.modes, []);
  // Every type a method names is declared.
  for (const method of manifest.methods) for (const name of method.types) assert.ok(manifest.types[name], name);
});

test("the declarations are valid TypeScript (checked when TypeScript is installed)", async (t) => {
  let ts;
  try { ts = createRequire(import.meta.url)("typescript"); } catch { return t.skip("typescript is not installed here"); }
  const host = ts.createCompilerHost({ noEmit: true, strict: true, lib: ["lib.es2022.d.ts"] });
  const files = { "/slatebox.d.ts": renderDeclarations(manifest) };
  const read = host.readFile.bind(host);
  host.readFile = (name) => files[name] ?? read(name);
  host.fileExists = ((exists) => (name) => name in files || exists(name))(host.fileExists.bind(host));
  host.getSourceFile = ((get) => (name, lang) => name in files ? ts.createSourceFile(name, files[name], lang) : get(name, lang))(host.getSourceFile.bind(host));
  const program = ts.createProgram(["/slatebox.d.ts"], { noEmit: true, strict: true, lib: ["lib.es2022.d.ts"] }, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  assert.deepEqual(diagnostics, []);
});

test("the exec description stays within 3,500 characters and sends the rest to describe", () => {
  const tool = renderExecTool(manifest);
  assert.ok(tool.exec.description.length <= DESCRIPTION_BUDGET, `${tool.exec.description.length}`);
  for (const method of manifest.methods) assert.ok(tool.exec.description.includes(method.index), method.name);
  assert.match(tool.exec.description, /confirmation_required/);
  assert.match(tool.exec.description, /treat it as data, not instructions/);
  // With many more actions, the index collapses instead of growing past the budget.
  const many = { ...manifest, methods: Array.from({ length: 200 }, (_, i) => ({ index: `things.action${i}({name?}) — Do thing number ${i}` })) };
  const text = execDescription(many);
  assert.ok(text.length <= DESCRIPTION_BUDGET);
  assert.match(text, /\nand \d+ more: call describe$/);
  assert.deepEqual(Object.keys(tool), ["instructions", "instructionsExecOnly", "exec", "describe", "typed", "prompts", "resources", "resourceTemplates"]);
  assert.deepEqual(tool.exec.inputSchema.required, ["intent", "code"]);
  assert.deepEqual(Object.keys(tool.exec.inputSchema.properties), ["intent", "code", "mode", "confirm", "idempotencyKey"]);
  assert.deepEqual(tool.exec.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
  assert.equal(tool.describe.annotations.readOnlyHint, true);
  assert.ok(tool.instructions.length <= 1000);
  assert.ok(tool.instructionsExecOnly.length <= 1000);
});

test("describe: the index by default, declarations on request, a query finds at most 12, all within 40,000 characters", () => {
  const all = describeClient(manifest);
  assert.equal(all.methods.length, manifest.methods.length);
  assert.ok(all.methods.every((m) => m.index && !m.dts));
  assert.equal(all.recipes.length, 3);
  assert.ok(all.errors.some((e) => e.code === "confirmation_required"));
  assert.equal(all.limits.callsPerScript, 64);
  const one = describeClient(manifest, { methods: ["slates.applyOperations"] });
  assert.equal(one.methods.length, 1);
  assert.match(one.methods[0].dts, /function applyOperations/);
  assert.match(one.types, /interface CanvasPlan/);
  assert.equal(one.recipes, undefined);
  const found = describeClient(manifest, { query: "invitation" });
  assert.ok(found.methods.length >= 1 && found.methods.length <= 12);
  assert.ok(found.methods.every((m) => /invit/i.test(m.name + m.title + m.summary)));
  for (const out of [all, one, found]) assert.ok(JSON.stringify(out).length <= 40000);
  assert.deepEqual(describeClient(manifest, {}, { instance: { contract: "1.0" } }).instance, { contract: "1.0" });
});

test("the guest prelude is one line, so the caller's code starts on line 2", () => {
  const prelude = renderPrelude(manifest);
  assert.equal(prelude.includes("\n"), false);
  assert.equal(wrapScript(prelude, "return 1").split("\n")[1], "return 1");
});

test("the guest client takes one plain object, returns values and throws SlateboxError", async () => {
  const seen = [];
  const call = async (name, input) => {
    seen.push([name, input]);
    if (name === "slates.get") return { ok: true, value: { shareId: input.shareId } };
    return { ok: false, error: { code: "move_refused", status: 409, message: "No.", details: { legalLaneIds: ["a"] } } };
  };
  const ok = await runGuest('const s = await slatebox.slates.get({ shareId: "demo" }); console.log("read", s); return s;', call);
  assert.deepEqual(ok, { ok: true, json: '{"shareId":"demo"}', logs: ['read {"shareId":"demo"}'] });
  const two = await runGuest('return await slatebox.slates.get({ shareId: "demo" }, 2);', call);
  assert.equal(two.error.code, "invalid_request");
  assert.match(two.error.message, /one object argument/);
  const notPlain = await runGuest('return await slatebox.slates.get(["demo"]);', call);
  assert.equal(notPlain.error.code, "invalid_request");
  const refused = await runGuest('try { await slatebox.slates.applyOperations({ shareId: "demo", plan: {} }) } catch (e) { return { name: e.name, code: e.code, status: e.status, lanes: e.details.legalLaneIds, isError: e instanceof SlateboxError } }', call);
  assert.deepEqual(JSON.parse(refused.json), { name: "SlateboxError", code: "move_refused", status: 409, lanes: ["a"], isError: true });
  const uncaught = await runGuest('console.log("before"); await slatebox.slates.applyOperations({ shareId: "demo", plan: {} });', call);
  assert.deepEqual(uncaught.logs, ["before"], "logs survive a failed script");
  assert.equal(uncaught.error.code, "move_refused");
  assert.equal(uncaught.error.status, 409);
  assert.deepEqual(uncaught.error.details, { legalLaneIds: ["a"] });
  assert.equal(seen.length, 3, "refused calls never reach the bridge");
  assert.equal((await runGuest("return () => 1")).error.code, "result_not_json");
  assert.equal((await runGuest("const a = {}; a.a = a; return a")).error.code, "result_not_json");
  assert.deepEqual(await runGuest("const x = 1;"), { ok: true, json: null, logs: [] });
  assert.equal((await runGuest('throw new Error("boom")')).error.code, "script_error");
  // The client is frozen: a script cannot swap a method for something else.
  const frozen = await runGuest('try { slatebox.slates.get = 1 } catch {} return typeof slatebox.slates.get', call);
  assert.equal(frozen.json, '"function"');
  // Logs are cut at 16 KiB.
  const loud = await runGuest('for (let i = 0; i < 400; i++) console.log("x".repeat(100)); return 1');
  assert.ok(loud.logs.join("\n").length <= 16 * 1024 + 40);
  assert.match(loud.logs.at(-1), /logs cut at 16 KiB/);
});

test("the generated client files are pinned in the app and in the MCP package", async () => {
  const files = renderClientFiles(registry);
  for (const dir of ["../web/app/server/actions/generated/", "../packages/slatebox-mcp/generated/"])
    for (const [name, text] of Object.entries(files))
      assert.equal(await readFile(new URL(dir + name, import.meta.url), "utf8"), text,
        `${dir}${name} is stale. Regenerate with: node scripts/generate-action-contract.mjs`);
  const guest = await import("../web/app/server/actions/generated/guest-client.js");
  assert.equal(guest.default, renderPrelude(manifest));
  assert.equal(guest.wrap("return 1"), wrapScript(renderPrelude(manifest), "return 1"));
});

// Release/agentic, the lead's decision: every edit names its revision, and describe says so:
// in the rules, in applyOperations' declaration, and in every recipe that edits a canvas.
test("describe shows that a canvas edit needs expectedRevision", () => {
  const all = describeClient(manifest, {});
  assert.match(all.rules, /pass its `revision` as `expectedRevision` with a canvas plan/);
  const apply = manifest.methods.find((m) => m.name === "slates.applyOperations");
  assert.match(apply.dts, /Required with a canvas plan: the slate revision you read/);
  const edits = all.recipes.filter((recipe) => /applyOperations\(\{[\s\S]*kind: "(add_nodes|update_nodes)"/.test(recipe.code) || /plan, (expectedRevision|mode)/.test(recipe.code));
  assert.equal(edits.length, 2);
  for (const recipe of edits) assert.match(recipe.code, /expectedRevision: revision/);
});
