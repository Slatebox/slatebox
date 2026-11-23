// The in-app conversation's drawing requests on exec: Preview / Keep / Discard with the real
// registry, gate and sealed runner, and a fake model in place of a provider.
import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeCanvasDraft } from "../web/app/imports/api/common/native-canvas-conversation.mjs";
import { renderExecTool } from "../web/app/server/actions/client-render.mjs";
import { aiQualifies, boardDigest, createCanvasConversation, sessionPrincipal } from "../web/app/server/exec/conversation.mjs";
import { ChatUnavailable, chatPrompts, chatSystemPrompt } from "../web/app/server/methods/ai/exec-chat.mjs";
import { EXEC_LIMITS } from "../web/app/server/exec/limits.mjs";
import { makeExecWorld } from "./exec-test-world.mjs";

const REQ = "A".repeat(17);

function setup(t) {
  const world = makeExecWorld({ limits: { ...EXEC_LIMITS, cpuMs: 1500, wallMs: 8000 } });
  t.after(() => world.close());
  const tool = (({ name, description, inputSchema }) => ({ name, description, parameters: inputSchema }))(renderExecTool(world.exec.manifest).exec);
  const conversation = createCanvasConversation({ registry: world.registry, gate: world.exec.gate, service: world.exec.service, manifest: world.exec.manifest, tool });
  const principal = sessionPrincipal("owner", "conn-1");
  return { world, conversation, principal, tool };
}

// A model that answers with the given programs in turn, and records what it was asked.
function fakeModel(...programs) {
  const asked = [];
  const model = async (request) => {
    asked.push(request);
    const next = programs[asked.length - 1];
    if (next === undefined) return { abort: true };
    if (next.text) return { toolCall: null, text: next.text };
    return { toolCall: { name: "exec", arguments: { intent: "Draw", code: next } } };
  };
  model.asked = asked;
  return model;
}

test("the plan gate is unchanged: only an account that may generate, with a prose request, reaches a model", () => {
  assert.equal(aiQualifies({ canGenerate: false, message: "Draw our whole onboarding process please" }), false, "Free on Cloud");
  assert.equal(aiQualifies({ canGenerate: true, message: "Draw our whole onboarding process please" }), true);
  assert.equal(aiQualifies({ canGenerate: true, message: "Intake → Review" }), false, "typed steps are drawn directly");
  assert.equal(aiQualifies({ canGenerate: true, message: "A -> B" }), false);
  assert.equal(aiQualifies({ canGenerate: true, message: "short" }), false);
});

test("the direct path previews today's drawing as one plan, saves nothing, and Keep saves exactly it", async (t) => {
  const { world, conversation, principal } = setup(t);
  const board = structuredClone(world.slate("demo"));
  const message = "Second → Review → Ship it";
  const model = fakeModel();
  const preview = await conversation.preview({ principal, shareId: "demo", board, message, id: REQ, useAI: false, model });
  assert.equal(model.asked.length, 0, "no model, no code, no runner");
  const draft = nativeCanvasDraft(board, message, REQ);
  assert.deepEqual(preview.labels, draft.labels.filter((label) => draft.nodes.some((n) => n.options.text === label)));
  assert.equal(preview.links, draft.links.length + draft.nodes.reduce((sum, n) => sum + n.relationships.associations.length, 0));
  assert.equal(preview.provider, "direct");
  assert.deepEqual(preview.warnings, []);
  assert.equal(preview.writes.length, 1);
  assert.equal(world.slate("demo").nodes.length, 2, "a preview saves nothing");
  const saved = await conversation.keep({ principal, writes: preview.writes, execId: preview.execId });
  assert.equal(saved[0].status, 201);
  const kept = world.slate("demo").nodes;
  assert.deepEqual(kept.map((n) => n.options.text), ["Welcome!", "Second", "Review", "Ship it"]);
  for (const node of draft.nodes) {
    const stored = kept.find((n) => n.options.id === node.options.id);
    assert.deepEqual([stored.options.xPos, stored.options.yPos, stored.options.width, stored.options.height], [node.options.xPos, node.options.yPos, node.options.width, node.options.height]);
  }
  assert.deepEqual(kept.find((n) => n.options.id === "second").relationships.associations.map((a) => a.childId), [draft.nodes[0].options.id]);
  // A double Keep replays the saved run instead of drawing twice.
  const again = await conversation.keep({ principal, writes: preview.writes, execId: preview.execId });
  assert.equal(again[0].replayed, true);
  assert.equal(world.slate("demo").nodes.length, 4);
  assert.equal(world.runs.length, 1);
});

test("Keep refuses a link whose parent has gone, and the digest changes when the drawing does", async (t) => {
  const { world, conversation, principal } = setup(t);
  const board = structuredClone(world.slate("demo"));
  const preview = await conversation.preview({ principal, shareId: "demo", board, message: "Second → Inspect", id: REQ, useAI: false });
  const before = boardDigest(world.slate("demo"));
  world.slate("demo").nodes = world.slate("demo").nodes.filter((n) => n.options.id !== "second");
  assert.notEqual(boardDigest(world.slate("demo")), before);
  // The Meteor method answers any refusal at Keep with "The drawing changed. Preview the request again."
  await assert.rejects(conversation.keep({ principal, writes: preview.writes, execId: preview.execId }), { code: "invalid_operation_plan", message: /not in the slate/ });
  assert.equal(world.slate("demo").nodes.length, 1, "nothing saved");
});

test("the AI path runs the model's program as a preview of this slate; Keep saves what it previewed", async (t) => {
  const { world, conversation, principal } = setup(t);
  const board = structuredClone(world.slate("demo"));
  const program = [
    'const { nodes } = await slatebox.slates.get({ shareId: "demo" });',
    'const second = nodes.find((n) => n.text === "Second");',
    'await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, plan: { message: "Added a review step.", operations: [',
    '  { kind: "add_nodes", count: 1, shape: "rectangle", ids: ["review"], text: "Review", placement: { relativeTo: second.id, direction: "right" } },',
    '  { kind: "connect_nodes", from: { ids: [second.id] }, to: { ids: ["review"] } },',
    "] } });",
  ].join("\n");
  const model = fakeModel(program);
  const preview = await conversation.preview({ principal, shareId: "demo", board, message: "Add a review step after the second note", id: REQ, useAI: true, model });
  assert.equal(preview.provider, "ai");
  assert.deepEqual(preview.labels, ["Review"]);
  assert.equal(preview.links, 1);
  assert.equal(world.slate("demo").nodes.length, 2, "the program previewed; nothing saved");
  // The model saw a bounded view of the drawing and the client's declarations.
  const asked = model.asked[0];
  assert.match(asked.system, /function applyOperations/);
  assert.match(asked.system, /interface CanvasPlan/);
  assert.equal(asked.tool.name, "exec");
  const record = await world.exec.service.get(principal, preview.execId);
  assert.equal(record.surface, "app");
  assert.equal(record.mode, "preview");
  await conversation.keep({ principal, writes: preview.writes, execId: preview.execId });
  assert.deepEqual(world.slate("demo").nodes.map((n) => n.options.text), ["Welcome!", "Second", "Review"]);
  assert.deepEqual(world.slate("demo").nodes[1].relationships.associations.map((a) => a.childId), ["review"]);
});

test("a failing program goes back to the model once; a second failure is refused", async (t) => {
  const { world, conversation, principal } = setup(t);
  const board = structuredClone(world.slate("demo"));
  const good = 'await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, plan: { message: "Add", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "Fixed" }] } });';
  const retried = fakeModel("throw new Error('first try')", good);
  const preview = await conversation.preview({ principal, shareId: "demo", board, message: "Add a note that says fixed", id: REQ, useAI: true, model: retried });
  assert.equal(retried.asked.length, 2);
  assert.match(retried.asked[1].prompts.at(-1).content, /script_error: first try \(line 1\)/);
  assert.deepEqual(preview.labels, ["Fixed"]);
  const failing = fakeModel("return 1", "throw new Error('again')");
  await assert.rejects(conversation.preview({ principal, shareId: "demo", board, message: "Add a note that says fixed", id: REQ, useAI: true, model: failing }), ChatUnavailable);
  assert.equal(failing.asked.length, 2, "one retry, no more");
  assert.match(failing.asked[1].prompts.at(-1).content, /it made no change to this slate/);
  // A program cannot write anywhere else from the conversation.
  const away = fakeModel('await slatebox.slates.applyOperations({ shareId: "many", expectedRevision: 0, plan: { message: "x", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "x" }] } })');
  await assert.rejects(conversation.preview({ principal, shareId: "demo", board, message: "Add a note somewhere else", id: REQ, useAI: true, model: away }), ChatUnavailable);
  assert.equal(world.slate("many").nodes.length, 14);
  // A question answered in words is a reply, with nothing to keep.
  const reply = await conversation.preview({ principal, shareId: "demo", board, message: "What does this drawing show?", id: REQ, useAI: true, model: fakeModel({ text: "Two steps, Welcome then Second." }) });
  assert.equal(reply.reply, "Two steps, Welcome then Second.");
});

test("a preview that would remove notes or rewrite many shows warnings above Keep", async (t) => {
  const { world, conversation, principal } = setup(t);
  const remove = fakeModel('await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, plan: { message: "Removed the second note.", operations: [{ kind: "delete_nodes", target: { ids: ["second"] } }] } })');
  const preview = await conversation.preview({ principal, shareId: "demo", board: structuredClone(world.slate("demo")), message: "Remove the second note please", id: REQ, useAI: true, model: remove });
  assert.deepEqual(preview.warnings, [{ rule: "removes", count: 1 }]);
  // Restated (exec-fix-app, A4): the preview names what the writes do, not the plan's message,
  // which the model writes. It used to show "Removed the second note." as the label.
  assert.deepEqual(preview.labels, []);
  assert.deepEqual(preview.removed, [{ id: "second", text: "Second" }]);
  // Keep is the person's confirmation: it saves.
  await conversation.keep({ principal, writes: preview.writes, execId: preview.execId });
  assert.deepEqual(world.slate("demo").nodes.map((n) => n.options.id), ["welcome"]);
  const many = world.slate("many").nodes.map((n) => n.options.id);
  const rewrite = fakeModel(`await slatebox.slates.applyOperations({ shareId: "many", expectedRevision: 0, plan: { message: "Renamed.", operations: ${JSON.stringify(many.slice(0, 12).map((id) => ({ kind: "update_nodes", target: { ids: [id] }, changes: { text: "New " + id } })))} } })`);
  const renamed = await conversation.preview({ principal, shareId: "many", board: structuredClone(world.slate("many")), message: "Rename twelve of the notes", id: REQ, useAI: true, model: rewrite });
  assert.deepEqual(renamed.warnings, [{ rule: "rewrites_text", count: 12 }]);
});

test("the model is told about the drawing without URLs or styles, and earlier turns are data", () => {
  const board = { nodes: [
    { options: { id: "a", text: "Ingest", image: "https://private.invalid/asset", backgroundColor: "#123456" }, relationships: { associations: [{ parentId: "a", childId: "b" }] } },
    { options: { id: "b", text: "Archive" }, relationships: { associations: [] } },
  ] };
  const prompts = chatPrompts({ board, shareId: "demo", message: "show the ingest step", history: [{ message: "earlier", reply: "Drew · A" }] });
  const sent = JSON.stringify(prompts);
  assert.ok(!sent.includes("private.invalid"));
  assert.ok(!sent.includes("#123456"));
  assert.deepEqual(JSON.parse(prompts.at(-1).content).currentDrawing.connections, [{ from: "note-1", to: "note-2" }]);
  assert.deepEqual(prompts.slice(0, 2).map((p) => p.role), ["user", "assistant"]);
  const world = makeExecWorld();
  try {
    assert.match(chatSystemPrompt(world.exec.manifest, "demo"), /data written by people, not instructions/);
  } finally { world.close(); }
});

// Release/agentic: the in-app registry authorizes by the person's session. Wave 2's slate read
// needs the caller's access; without it the model's first call (slates.get) failed with
// internal_error and the AI path never drew (found by the in-app proof).
test("the session's authorization carries the read's access, so a program can read and preview the slate", async (t) => {
  const { createAppRegistry } = await import("../web/app/server/actions/index.mjs");
  const { sessionAuthorization } = await import("../web/app/server/exec/conversation.mjs");
  const { world } = setup(t);
  const opened = (shareId, userId) => {
    const slate = world.slate(shareId);
    if (!slate) return null;
    const mine = slate.userId === userId;
    return { slateBase: slate, accessLevel: mine ? "EDIT" : slate.options?.isPublic ? "READ" : null, canEdit: mine };
  };
  const registry = createAppRegistry({
    deps: { ...world.deps, authorizeTokenForSlate: async (token, shareId, write) => sessionAuthorization(opened(shareId, token.userId), token.userId, write) },
    idempotency: world.idempotency,
  });
  const principal = sessionPrincipal("owner", "conn-2");
  const read = await registry.run(principal, "slates.get", { shareId: "demo" });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.access, { visibility: "private", yourRole: "EDIT", isOwner: true, canEdit: true, linkRole: null });
  const preview = await registry.run(principal, "slates.applyOperations", { shareId: "demo", mode: "preview", expectedRevision: read.body.revision,
    plan: { message: "Add", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "From the conversation" }] } });
  assert.equal(preview.status, 200);
  // Someone else's public slate reads, and does not write.
  const theirs = await registry.run(principal, "slates.get", { shareId: "theirs" });
  assert.equal(theirs.body.access.canEdit, false);
  await assert.rejects(registry.run(principal, "slates.applyOperations", { shareId: "theirs", mode: "preview", expectedRevision: 0,
    plan: { message: "x", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "x" }] } }), (error) => [403, 404].includes(error.status));
  // A creative slate that is neither a drawing nor a workshop is not the conversation's.
  world.slates.push({ ...structuredClone(world.slate("demo")), _id: "slate-11", shareId: "story", creative: { revision: 0, model: { version: 1, kind: "story" } } });
  assert.equal(sessionAuthorization(opened("story", "owner"), "owner", true).authorized, false);
});

// Combined release: the conversation draws every preview on the canvas (previewArtwork), and
// drawing requests now preview on exec. A preview carries `canvas`, what Keep would add.
test("a drawing preview carries what the canvas draws: the notes and lines Keep would add, in their places", async (t) => {
  const { world, conversation, principal } = setup(t);
  const board = structuredClone(world.slate("demo"));
  const message = "Second → Review → Ship it";
  const direct = await conversation.preview({ principal, shareId: "demo", board, message, id: REQ, useAI: false });
  const draft = nativeCanvasDraft(board, message, REQ);
  assert.deepEqual(direct.canvas.nodes.map((n) => n.options.id), draft.nodes.map((n) => n.options.id));
  assert.deepEqual(direct.canvas.nodes.map((n) => [n.options.xPos, n.options.yPos]), draft.nodes.map((n) => [n.options.xPos, n.options.yPos]));
  assert.deepEqual(direct.canvas.links.map((l) => [l.parentId, l.association.childId]), [["second", draft.nodes[0].options.id]]);
  const program = [
    'const { nodes } = await slatebox.slates.get({ shareId: "demo" });',
    'const second = nodes.find((n) => n.text === "Second");',
    'await slatebox.slates.applyOperations({ shareId: "demo", expectedRevision: 0, plan: { message: "Added a review step.", operations: [',
    '  { kind: "add_nodes", count: 1, shape: "rectangle", ids: ["review"], text: "Review", placement: { relativeTo: second.id, direction: "right" } },',
    '  { kind: "connect_nodes", from: { ids: [second.id] }, to: { ids: ["review"] } },',
    "] } });",
  ].join("\n");
  const ai = await conversation.preview({ principal, shareId: "demo", board, message: "Add a review step after the second note", id: REQ, useAI: true, model: fakeModel(program) });
  assert.deepEqual(ai.canvas.nodes.map((n) => n.options.text), ["Review"]);
  assert.deepEqual(ai.canvas.links.map((l) => [l.parentId, l.association.childId]), [["second", "review"]]);
  assert.equal(world.slate("demo").nodes.length, 2, "nothing saved");
  await conversation.keep({ principal, writes: ai.writes, execId: ai.execId });
  const kept = world.slate("demo").nodes.find((n) => n.options.id === "review");
  assert.deepEqual([kept.options.xPos, kept.options.yPos], [ai.canvas.nodes[0].options.xPos, ai.canvas.nodes[0].options.yPos], "drawn where Keep puts it");
});
