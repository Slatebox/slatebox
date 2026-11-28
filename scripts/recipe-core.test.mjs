// The small core (MIT) changes recipes rely on: a recipe's run saves directly only when its
// principal says so (canvasEdit, server/actions/slate-operations.mjs), it is named on the canvas
// for the person it runs for (server/presence/agentPresence.mjs), "Pause all agents" stops it too,
// and signed webhook paths keep their raw body (server/raw-body-paths.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createSuggestionStore } from "../web/app/server/agents/suggestions.mjs";
import { isRawBodyPath, RAW_BODY_PREFIXES } from "../web/app/server/raw-body-paths.mjs";
import { isNeverBound } from "../web/app/server/actions/exec-binding.mjs";
import { recipeHooks, setRecipeHooks } from "../web/app/server/recipes-hooks.mjs";
import { memoryCollection, makeExecWorld } from "./exec-test-world.mjs";

const appRequire = createRequire(new URL("../web/app/package.json", import.meta.url));
await import(appRequire.resolve("slateboxjs/operations"));

function world() {
  const w = makeExecWorld({});
  let n = 0;
  w.deps.suggestions = createSuggestionStore({
    collection: memoryCollection(),
    controls: memoryCollection(),
    identify: w.presence.identify,
    applyPlan: async () => { throw new Error("not used"); },
    findName: async (id) => ({ owner: "Ada" })[id] ?? "Someone",
    newId: () => `s${++n}`,
  });
  w.deps.agentOptions = { editDirectly: () => false };
  w.deps.resolveSlateForUser = async (shareId, userId) => {
    const slate = w.slate(shareId);
    return slate ? { slate, canRead: slate.userId === userId, canEdit: slate.userId === userId } : null;
  };
  return w;
}

const recipe = (direct) => ({
  kind: "agent", builtin: "recipe", userId: "owner", tokenId: "recipe:inst1", scopes: ["slates:read", "slates:write", "projects:read"], runId: "run1", direct,
  agent: { name: "GitHub architect", onBehalfOf: "owner", colorIndex: 2, recipeId: "github-architecture", instanceId: "inst1" },
});
const plan = (text, id) => ({ message: "Keep the map", operations: [{ kind: "add_nodes", count: 1, ids: [id], shape: "rectangle", text, x: 900, y: 900, width: 160, height: 70 }] });

test("a recipe's run suggests unless its principal says direct; direct saves as one undoable action", async (t) => {
  const w = world();
  t.after(() => w.close());
  const suggested = await w.registry.run(recipe(false), "slates.applyOperations", { shareId: "demo", expectedRevision: w.slate("demo").revision ?? 0, plan: plan("api", "ga_aaaaaaaaaaaa") }, { idempotencyKey: "run1:a" });
  assert.equal(suggested.body.outcome, "suggested");
  assert.ok(!w.slate("demo").nodes.some((node) => node.options.id === "ga_aaaaaaaaaaaa"));
  const saved = await w.registry.run(recipe(true), "slates.applyOperations", { shareId: "demo", expectedRevision: w.slate("demo").revision ?? 0, plan: plan("db", "ga_bbbbbbbbbbbb") }, { idempotencyKey: "run1:b" });
  assert.equal(saved.body.outcome, "saved");
  assert.ok(w.slate("demo").nodes.some((node) => node.options.id === "ga_bbbbbbbbbbbb"));
  // direct on any other agent's principal means nothing: only a recipe's
  const other = { ...recipe(true), builtin: undefined, tokenId: (await w.principalFor(["slates:read", "slates:write"])).tokenId };
  const notDirect = await w.registry.run(other, "slates.applyOperations", { shareId: "demo", expectedRevision: w.slate("demo").revision ?? 0, plan: plan("web", "ga_cccccccccccc") }, { idempotencyKey: "x:c" });
  assert.equal(notDirect.body.outcome, "suggested");
});

test("people on a slate who pause all agents stop a recipe's saves too", async (t) => {
  const w = world();
  t.after(() => w.close());
  await w.deps.suggestions.pause(w.slate("demo")._id, true, { kind: "person", userId: "owner" });
  await assert.rejects(
    w.registry.run(recipe(true), "slates.applyOperations", { shareId: "demo", expectedRevision: w.slate("demo").revision ?? 0, plan: plan("api", "ga_dddddddddddd") }, { idempotencyKey: "run1:d" }),
    { status: 423, code: "agents_paused" }
  );
});

test("a recipe is named on the canvas for the person it runs for", async (t) => {
  const w = world();
  t.after(() => w.close());
  const who = await w.presence.identify(recipe(false), w.slate("demo"));
  assert.match(who.label, /^GitHub architect · runs for \S+$/);
  assert.equal(who.origin, "recipe");
  assert.equal(who.colorIndex, 2);
  const again = await w.presence.identify({ ...recipe(true), runId: "run2" }, w.slate("demo"));
  assert.equal(again.agentId, who.agentId, "one agent across its runs on a slate");
});

test("signed webhook paths keep their raw body; everything else is parsed as before", () => {
  assert.deepEqual([...RAW_BODY_PREFIXES], ["/hooks/recipes/", "/integrations/github/events", "/integrations/google/watch", "/integrations/slack/", "/integrations/linear/events"]);
  assert.equal(isRawBodyPath("/integrations/linear/events"), true, "Linear's webhook, signed by Linear");
  assert.equal(isRawBodyPath("/integrations/slack/events"), true, "Slack's events, signed by Slack");
  assert.equal(isRawBodyPath("/hooks/recipes/rh_abc"), true);
  assert.equal(isRawBodyPath("/integrations/github/events"), true);
  assert.equal(isRawBodyPath("/connectors/oauth/callback"), false);
  assert.equal(isRawBodyPath(undefined), false);
});

test("permissions to change things outside Slatebox, their approval and the server switch are never a script's", () => {
  for (const id of ["recipes.grant", "recipes.revoke", "recipes.decideWrite", "recipes.admin.setEnabled", "recipes.admin.status"]) assert.equal(isNeverBound(id), true, id);
  for (const id of ["recipes.run", "recipes.list", "recipes.hooks.add"]) assert.equal(isNeverBound(id), false, id);
});

test("the app tells recipes when someone loses access; with no enterprise code nothing listens", async () => {
  assert.equal(await recipeHooks.ownerLostAccess("u1"), null);
  const told = [];
  setRecipeHooks({ ownerLostAccess: async (userId, projectId) => { told.push([userId, projectId]); return { stopped: 1 } } });
  await recipeHooks.ownerLostAccess("u1", "p1");
  assert.deepEqual(told, [["u1", "p1"]]);
});
