// Parity: what a person does in the app, an agent can do with the same rule and the same words,
// on every surface. An action is declared once; REST, the exec client, the hosted and local
// MCP typed tools and the CLI's exec all come from it, so these tests check the declarations and
// the rules of the actions added for parity (slates.list, slates.copy over HTTP, slates.delete,
// comments.*).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createApiTokenService } from "../web/app/server/api-token-core.mjs";
import { createAppRegistry } from "../web/app/server/actions/index.mjs";
import { boundActions } from "../web/app/server/actions/exec-binding.mjs";
import { buildClientManifest, renderExecTool, DESCRIPTION_BUDGET } from "../web/app/server/actions/client-render.mjs";
import { buildOpenApi } from "../web/app/server/actions/openapi.mjs";
import { slateListSelector, slateListEntry } from "../web/app/server/actions/slate-list.mjs";
import { createGate } from "../web/app/server/exec/gate.mjs";

const note = (id, text) => ({ options: { id, text, xPos: 0, yPos: 0, width: 100, height: 60 }, relationships: { associations: [] } });

function makeWorld(overrides = {}) {
  const slates = [
    { _id: "s-own", shareId: "own", userId: "ana", orgId: "org", lastSaved: 3000, options: { id: "s-own", name: "Roadmap", isPrivate: true }, nodes: [note("n1", "Goal")] },
    { _id: "s-pub", shareId: "pub", userId: "ben", orgId: "org", lastSaved: 2000, options: { id: "s-pub", name: "Public plan", isPublic: true }, nodes: [note("p1", "Idea")] },
    { _id: "s-priv", shareId: "priv", userId: "ben", orgId: "org", lastSaved: 1000, options: { id: "s-priv", name: "Ben's notes", isPrivate: true }, nodes: [note("b1", "Secret")] },
  ];
  const comments = [];
  const deleted = [];
  const grants = [];
  const service = createApiTokenService({
    apiTokens: { findOneAsync: async () => null, find: () => ({ fetchAsync: async () => [] }), insertAsync: async () => {}, updateAsync: async () => {}, countAsync: async () => 0 },
    users: { findOneAsync: async () => null },
    slates: { findOneAsync: async ({ shareId }) => slates.find((s) => s.shareId === shareId) ?? null },
    slateAccess: { find: ({ slateId }) => ({ fetchAsync: async () => grants.filter((g) => g.slateId === slateId) }) },
    now: () => 5000,
  });
  let seq = 0;
  const deps = {
    authorizeTokenForSlate: service.authorizeTokenForSlate,
    appOrigin: () => "https://app.example",
    loadUser: async (id) => ({ _id: id, orgId: "org" }),
    userName: async (id) => ({ ana: "Ana", ben: "Ben" })[id],
    newId: () => `new-${++seq}`,
    generateShareId: async () => `copy-${seq}`,
    async listSlates({ userId, orgId, scope, q, limit }) {
      const selector = slateListSelector({ userId, orgId, scope, isAdmin: false, grantedIds: [], q });
      if (!selector) return [];
      const parts = selector.$and ?? [selector];
      const matches = (row) => parts.every((part) => {
        if (part.userId?.$ne) return row.orgId === part.orgId && row.userId !== part.userId.$ne &&
          (row.options.isPublic || (row.options.isPrivate && part.$or[1]._id?.$in?.includes(row._id)));
        if (part.userId) return row.userId === part.userId;
        if (part["options.name"]) return new RegExp(part["options.name"].$regex, "i").test(row.options.name);
        return false;
      });
      return slates.filter(matches).sort((a, b) => b.lastSaved - a.lastSaved).slice(0, limit);
    },
    async deleteSlate(slate) { deleted.push(slate.shareId); return { deleted: true }; },
    async resolveSlateForUser(shareId, userId) {
      const slate = slates.find((s) => s.shareId === shareId);
      if (!slate) return null;
      const own = slate.userId === userId;
      return { slate, canRead: own || slate.options.isPublic === true, canEdit: own };
    },
    publishedPresentation: async () => null,
    saveCore: { create: async ({ row }) => { slates.push(row); return { revision: 1 }; } },
    comments: {
      list: async ({ slateId, nodeId }) => comments.filter((c) => c.slateId === slateId && (!nodeId || c.nodeId === nodeId)),
      add: async (row) => { const _id = `c${comments.length + 1}`; comments.push({ ...row, _id }); return _id; },
      resolve: async ({ slateId, nodeId, resolved }) => {
        const hit = comments.filter((c) => c.slateId === slateId && c.nodeId === nodeId);
        for (const c of hit) c.resolved = resolved;
        return hit.length;
      },
      get: async ({ slateId, commentId }) => comments.find((c) => c._id === commentId && c.slateId === slateId) ?? null,
      remove: async ({ commentId }) => { comments.splice(comments.findIndex((c) => c._id === commentId), 1); return 1; },
    },
  };
  Object.assign(deps, overrides);
  const registry = createAppRegistry({ deps, now: () => 7000 });
  const agent = (userId, scopes = ["slates:read", "slates:write", "slates:delete"]) => ({ kind: "agent", userId, tokenId: `t-${userId}`, tokenName: "Agent", scopes });
  return { slates, comments, deleted, grants, registry, agent };
}

// A write answers with the mode it ran in; these compare what it did.
const body = (result) => { const { mode: _mode, ...rest } = result.body ?? result; return rest; };

test("every action a token may call is on every surface: an HTTP route in OpenAPI, an exec client method, a typed MCP tool and a CLI name", () => {
  const registry = createAppRegistry();
  const manifest = buildClientManifest(registry);
  const tools = renderExecTool(manifest);
  const openapi = buildOpenApi(registry);
  const methods = new Set(manifest.methods.map((m) => m.name));
  const typed = new Map(tools.typed.map((t) => [t.method, t]));
  for (const action of boundActions(registry)) {
    const route = openapi.paths[action.mounts.http.path]?.[action.mounts.http.method.toLowerCase()];
    assert.equal(route?.["x-slatebox"].action, action.id, `${action.id}: OpenAPI`);
    assert.ok(methods.has(action.id), `${action.id}: exec client`);
    assert.ok(typed.has(action.id), `${action.id}: typed MCP tool`);
    assert.equal("cli" in action, false, `${action.id}: no CLI name (the CLI reaches it through slatebox exec)`);
  }
  // Every method is listed in exec's own description, within its budget.
  for (const method of manifest.methods) assert.ok(tools.exec.description.includes(method.index), method.name);
  assert.ok(tools.exec.description.length <= DESCRIPTION_BUDGET);
});

test("the parity actions are declared on the token surfaces with the app's scopes", () => {
  const registry = createAppRegistry();
  const want = {
    "slates.list": ["GET", "/slates", "slates:read", "list_slates"],
    "slates.copy": ["POST", "/slates/{shareId}/copy", "slates:write", "copy_slate"],
    "slates.delete": ["DELETE", "/slates/{shareId}", "slates:delete", "delete_slate"],
    "comments.list": ["GET", "/slates/{shareId}/comments", "slates:read", "list_comments"],
    "comments.add": ["POST", "/slates/{shareId}/comments", "slates:write", "add_comment"],
    "comments.resolve": ["POST", "/slates/{shareId}/comments/resolve", "slates:write", "resolve_comments"],
    "comments.remove": ["DELETE", "/slates/{shareId}/comments/{commentId}", "slates:delete", "remove_comment"],
  };
  for (const [id, [method, path, scope, tool]] of Object.entries(want)) {
    const action = registry.get(id);
    assert.deepEqual([action.mounts.http.method, action.mounts.http.path, action.scope, action.tool.name], [method, path, scope, tool], id);
    assert.ok(action.principals.includes("agent"), id);
  }
  // The app's own Copy still reaches it as a Meteor method.
  assert.equal(registry.get("slates.copy").mounts.ddp, true);
  assert.equal(registry.get("slates.delete").destructive, true);
  assert.equal(registry.get("comments.remove").destructive, true);
});

test("slates.list lists your own slates, newest first, or your team's that you may open, and filters by name", async () => {
  const { registry, agent, grants } = makeWorld();
  const mine = body(await registry.run(agent("ana", ["slates:read"]), "slates.list", {}));
  assert.deepEqual(mine.slates.map((s) => [s.shareId, s.owner, s.visibility]), [["own", "you", "private"]]);
  assert.equal(mine.slates[0].url, "https://app.example/canvas/own");
  const team = body(await registry.run(agent("ana", ["slates:read"]), "slates.list", { scope: "team" }));
  assert.deepEqual(team.slates.map((s) => s.shareId), ["pub"], "a teammate's private slate stays out until it is shared");
  grants.push({ slateId: "s-priv", userId: "ana" });
  const named = body(await registry.run(agent("ben"), "slates.list", { q: "PLAN" }));
  assert.deepEqual(named.slates.map((s) => s.shareId), ["pub"]);
  await assert.rejects(registry.run(agent("ana", []), "slates.list", {}), { code: "insufficient_scope" });
});

test("the team list follows the Slates page rule: public, and private ones shared with you or all for an admin", () => {
  const base = { userId: "ana", orgId: "org", scope: "team" };
  assert.deepEqual(slateListSelector({ ...base, grantedIds: ["s1"] }), {
    orgId: "org", userId: { $ne: "ana" }, $or: [{ "options.isPublic": true }, { "options.isPrivate": true, _id: { $in: ["s1"] } }],
  });
  assert.deepEqual(slateListSelector({ ...base, isAdmin: true }).$or[1], { "options.isPrivate": true });
  assert.equal(slateListSelector({ ...base, orgId: null }), null, "no team, no team list");
  assert.deepEqual(slateListSelector({ userId: "ana", q: "a.b" }).$and[1], { "options.name": { $regex: "a\\.b", $options: "i" } });
  assert.equal(slateListEntry({ shareId: "x", userId: "ana", options: { isUnlisted: true } }, "ana", "https://a.example").visibility, "unlisted");
});

test("slates.copy over HTTP copies by the app's rule: your own or a public slate, never a private one of someone else's", async () => {
  const { registry, agent, slates } = makeWorld();
  const made = body(await registry.run(agent("ana"), "slates.copy", { shareId: "pub", name: "Mine now" }));
  const copy = slates.find((s) => s.shareId === made.shareId);
  assert.equal(copy.userId, "ana");
  assert.equal(copy.options.name, "Mine now");
  assert.equal(copy.options.isPrivate, true);
  await assert.rejects(registry.run(agent("ana"), "slates.copy", { shareId: "priv" }), { code: "not_found" });
  await assert.rejects(registry.run(agent("ana", ["slates:read"]), "slates.copy", { shareId: "pub" }), { code: "insufficient_scope" });
});

test("slates.delete deletes only the owner's slate", async () => {
  const { registry, agent, deleted } = makeWorld();
  await assert.rejects(registry.run(agent("ana"), "slates.delete", { shareId: "pub" }), (error) => error.status === 403);
  assert.deepEqual(deleted, []);
  assert.deepEqual(body(await registry.run(agent("ana"), "slates.delete", { shareId: "own" })), { shareId: "own", deleted: true });
  assert.deepEqual(deleted, ["own"]);
});

test("comments: anyone who may open the slate reads, adds and resolves; only the author removes", async () => {
  const { registry, agent, comments } = makeWorld();
  const added = body(await registry.run(agent("ana"), "comments.add", { shareId: "pub", noteId: "p1", text: "  Who owns this?  " }));
  assert.deepEqual({ ...added, commentId: undefined }, { commentId: undefined, noteId: "p1", author: "Ana", yours: true, text: "Who owns this?", resolved: false, created: new Date(7000).toISOString() });
  assert.equal(comments[0].slateId, "s-pub");
  assert.equal(comments[0].createdByUserId, "ana");

  const read = body(await registry.run(agent("ben", ["slates:read"]), "comments.list", { shareId: "pub" }));
  assert.deepEqual(read.comments.map((c) => [c.author, c.yours, c.text]), [["Ana", false, "Who owns this?"]]);

  assert.deepEqual(body(await registry.run(agent("ben"), "comments.resolve", { shareId: "pub", noteId: "p1" })), { noteId: "p1", resolved: true, comments: 1 });
  assert.equal(comments[0].resolved, true);

  await assert.rejects(registry.run(agent("ben"), "comments.remove", { shareId: "pub", commentId: added.commentId }), (error) => error.status === 403);
  assert.deepEqual(body(await registry.run(agent("ana"), "comments.remove", { shareId: "pub", commentId: added.commentId })), { commentId: added.commentId, removed: true });
  assert.equal(comments.length, 0);

  await assert.rejects(registry.run(agent("ana"), "comments.add", { shareId: "pub", noteId: "nope", text: "x" }), { code: "not_found" });
  await assert.rejects(registry.run(agent("ana"), "comments.list", { shareId: "priv" }), (error) => error.status === 403);
  await assert.rejects(registry.run(agent("ana", ["slates:read"]), "comments.add", { shareId: "pub", noteId: "p1", text: "x" }), { code: "insufficient_scope" });
});

test("in an exec script, deleting a slate or a comment is held for the person to agree", async () => {
  const registry = createAppRegistry();
  const gate = createGate({ registry, manifest: buildClientManifest(registry) });
  const evaluateGate = async (action, input) => (await gate.assess({}, action, input)).reasons;
  for (const id of ["slates.delete", "comments.remove"]) {
    const reasons = await evaluateGate(registry.get(id), { shareId: "own" });
    assert.ok(reasons.some((r) => r.rule === "removes"), id);
  }
  for (const id of ["comments.add", "comments.resolve", "slates.copy", "slates.list"]) {
    const reasons = await evaluateGate(registry.get(id), { shareId: "own" });
    assert.deepEqual(reasons, [], id);
  }
});

test("the Slates page's Delete and slates.delete delete through one function", async () => {
  const source = await readFile(new URL("../web/app/server/methods/slates.js", import.meta.url), "utf8");
  assert.match(source, /export async function deleteOwnedSlate\(slate\)/);
  assert.match(source.slice(source.indexOf("methods.slates.remove]")), /await deleteOwnedSlate\(slate\)/);
  const mount = await readFile(new URL("../web/app/server/actions/mount.js", import.meta.url), "utf8");
  assert.match(mount, /deleteSlate: \(slate\) => deleteOwnedSlate\(slate\)/);
});

// Owner decision (2026-11-23): commenting follows the sharing comment role, on every surface.
test("comments follow the slate's comment role: a reader may read but not comment or resolve; commenters and editors may", async () => {
  const { registry, agent, grants, comments } = makeWorld();
  grants.push({ slateId: "s-pub", type: "public", slateAccessPermissionId: "READ" });
  const read = body(await registry.run(agent("ben"), "comments.list", { shareId: "pub" }));
  assert.deepEqual(read.comments, []);
  await assert.rejects(registry.run(agent("ana"), "comments.add", { shareId: "pub", noteId: "p1", text: "Spam" }), (error) => error.status === 403 && error.code === "comment_role_required" && /comment/i.test(error.message));
  await assert.rejects(registry.run(agent("ana"), "comments.resolve", { shareId: "pub", noteId: "p1" }), (error) => error.code === "comment_role_required");
  assert.equal(comments.length, 0);
  grants[0].slateAccessPermissionId = "COMMENT";
  assert.equal(body(await registry.run(agent("ana"), "comments.add", { shareId: "pub", noteId: "p1", text: "Fine" })).text, "Fine");
  assert.equal(body(await registry.run(agent("ana"), "comments.resolve", { shareId: "pub", noteId: "p1" })).comments, 1);
  // The owner always may.
  assert.equal(body(await registry.run(agent("ben"), "comments.add", { shareId: "pub", noteId: "p1", text: "Mine" })).text, "Mine");
});

test("a signed-in page comments through the same action (the drawer), by the session's comment role", async () => {
  const roles = { ana: "COMMENT", cy: "READ" };
  const { registry, comments } = makeWorld({ canComment: async (_slate, userId) => roles[userId] === "COMMENT" || userId === "ben" });
  const person = (userId) => ({ kind: "person", userId, tokenId: null, tokenName: null, scopes: ["slates:read", "slates:write"] });
  assert.equal(body(await registry.run(person("ana"), "comments.add", { shareId: "pub", noteId: "p1", text: "From the drawer" })).author, "Ana");
  await assert.rejects(registry.run(person("cy"), "comments.add", { shareId: "pub", noteId: "p1", text: "x" }), (error) => error.code === "comment_role_required");
  assert.equal(comments.length, 1);
});

test("@Slatebox in a comment asks the Slatebox agent from the server, on every surface; a commenter who cannot edit is told why", async () => {
  const asked = [];
  const started = [];
  const agentTasks = {
    store: { create: async ({ slate, by, text, assignee, nodeId, commentId }) => { const doc = { _id: "task" + (asked.length + 1), slateId: slate._id, shareId: slate.shareId, text, assignee, nodeId, commentId, askedBy: by, status: "submitted" }; asked.push(doc); return doc; } },
    labelOf: async (principal) => (principal.kind === "agent" ? "Ana's agent" : "Ana"),
    onAssigned: (doc) => started.push(doc._id),
  };
  const { registry, agent, grants } = makeWorld({ agentTasks });
  const added = body(await registry.run(agent("ana"), "comments.add", { shareId: "own", noteId: "n1", text: "@Slatebox add notes: Risks, Owners" }));
  assert.equal(added.agentTask, "task1");
  assert.deepEqual([asked[0].text, asked[0].assignee, asked[0].nodeId, asked[0].commentId], ["add notes: Risks, Owners", "slatebox", "n1", added.commentId]);
  assert.deepEqual(started, ["task1"]);
  // A plain comment asks nothing.
  assert.equal(body(await registry.run(agent("ana"), "comments.add", { shareId: "own", noteId: "n1", text: "email ana@slatebox.com" })).agentTask, undefined);
  // On Ben's public slate Ana may comment (COMMENT role) but not edit: the comment stays, no task.
  grants.push({ slateId: "s-pub", type: "public", slateAccessPermissionId: "COMMENT" });
  const refused = body(await registry.run(agent("ana"), "comments.add", { shareId: "pub", noteId: "p1", text: "@Slatebox delete everything" }));
  assert.equal(refused.agentTask, undefined);
  assert.match(refused.agentNote, /can edit/);
  assert.equal(asked.length, 1);
});

test("the Slatebox agent's replies can be removed by whoever may edit the slate", async () => {
  const { registry, agent, comments } = makeWorld();
  comments.push({ _id: "c-agent", slateId: "s-own", nodeId: "n1", createdByUserId: "slatebox-agent", createdByUserName: "Slatebox agent", text: "Done", fromAgent: true });
  assert.deepEqual(body(await registry.run(agent("ana"), "comments.remove", { shareId: "own", commentId: "c-agent" })), { commentId: "c-agent", removed: true });
  assert.equal(comments.length, 0);
});

// Owner decision (2026-11-23): deleting is its own permission, slates:delete.
test("deleting a slate or a comment needs slates:delete; slates:write alone is refused with the scope to ask for", async () => {
  const { registry, agent, comments } = makeWorld();
  const writer = agent("ana", ["slates:read", "slates:write"]);
  await assert.rejects(registry.run(writer, "slates.delete", { shareId: "own" }), (error) => error.code === "insufficient_scope" && /slates:delete/.test(JSON.stringify(error.details ?? error.message)));
  const added = body(await registry.run(writer, "comments.add", { shareId: "own", noteId: "n1", text: "Mine" }));
  await assert.rejects(registry.run(writer, "comments.remove", { shareId: "own", commentId: added.commentId }), (error) => error.code === "insufficient_scope");
  assert.equal(comments.length, 1);
  const deleter = agent("ana", ["slates:read", "slates:write", "slates:delete"]);
  assert.equal(body(await registry.run(deleter, "comments.remove", { shareId: "own", commentId: added.commentId })).removed, true);
});
