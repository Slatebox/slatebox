// The in-app conversation, from the exec/app attack review (reports19/exec-attack-app.md); each
// test failed before its fix:
//   A4  the preview shows what Keep will save: the audience warning, the old and new text of
//       every rewritten note, the removed notes, and never the model's own summary
//   A9  a drawing that already has an interactive route can still be drawn on (a regression of
//       the move to exec: slates.applyOperations sent every plan on such a slate to the workshop)
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderExecTool } from "../web/app/server/actions/client-render.mjs";
import { createCanvasConversation, sessionPrincipal } from "../web/app/server/exec/conversation.mjs";
import { EXEC_LIMITS } from "../web/app/server/exec/limits.mjs";
import { makeExecWorld } from "./exec-test-world.mjs";

const fast = { ...EXEC_LIMITS, cpuMs: 1500, wallMs: 8000, killGraceMs: 2000 };
const REQ = "A".repeat(17);
const texts = (world, shareId) => world.slate(shareId).nodes.map((node) => node.options.text);

// A4 ---------------------------------------------------------------------------------------
function conversationWorld(t) {
  const world = makeExecWorld({ limits: fast });
  t.after(() => world.close());
  const tool = (({ name, description, inputSchema }) => ({ name, description, parameters: inputSchema }))(renderExecTool(world.exec.manifest).exec);
  const conversation = createCanvasConversation({ registry: world.registry, gate: world.exec.gate, service: world.exec.service, manifest: world.exec.manifest, tool });
  return { world, conversation, principal: sessionPrincipal("owner", "conn-1") };
}
const program = (code) => {
  let asked = 0;
  return async () => (++asked > 1 ? { abort: true } : { toolCall: { name: "exec", arguments: { intent: "Draw", code } } });
};
const ask = (s, shareId, code) =>
  s.conversation.preview({ principal: s.principal, shareId, board: structuredClone(s.world.slate(shareId)), message: "Please tidy up this drawing for the team", id: REQ, useAI: true, model: program(code) });

test("in-app: a program that copies a private slate's text into a public one is warned about", async (t) => {
  const s = conversationWorld(t);
  const preview = await ask(s, "open", `const d = await slatebox.slates.get({shareId:"demo"});
    return await slatebox.slates.applyOperations({shareId:"open", expectedRevision:0, plan:{message:"Added a title", operations:[{kind:"add_nodes", count:1, shape:"rectangle", text:"Title"},{kind:"update_nodes", target:{ids:["o1"]}, changes:{text:d.nodes.map(n=>n.text).join(" | ")}}]}})`);
  assert.ok(preview.warnings.some((w) => w.rule === "widens_audience"), JSON.stringify(preview.warnings));
  assert.deepEqual(preview.changes, [{ id: "o1", before: "Open note", after: "Welcome! | Second" }]);
});

test("in-app: rewritten notes are shown old and new, removed notes are named, and the model's summary is not shown", async (t) => {
  const s = conversationWorld(t);
  const ids = Array.from({ length: 10 }, (_, i) => `n${i + 1}`);
  const preview = await ask(s, "many", `return await slatebox.slates.applyOperations({shareId:"many", expectedRevision:0, plan:{message:"Tidied the layout", operations:[{kind:"update_nodes", target:{ids:${JSON.stringify(ids)}}, changes:{text:"PWNED"}}]}})`);
  assert.ok(!preview.labels.includes("Tidied the layout"), JSON.stringify(preview.labels));
  assert.deepEqual(preview.changes, ids.map((id, i) => ({ id, before: `Note ${i + 1}`, after: "PWNED" })));
  const removing = await ask(s, "demo", `return await slatebox.slates.applyOperations({shareId:"demo", expectedRevision:0, plan:{message:"Tidied", operations:[{kind:"delete_nodes", target:{ids:["second"]}}]}})`);
  assert.deepEqual(removing.removed, [{ id: "second", text: "Second" }]);
  assert.ok(!removing.labels.includes("Tidied"));
  assert.ok(removing.warnings.some((w) => w.rule === "removes"));
});

// A9 ---------------------------------------------------------------------------------------
test("a drawing that already has an interactive route can still be drawn on, and its route is kept", async (t) => {
  const s = conversationWorld(t);
  const routed = { ...structuredClone(s.world.slate("workshop")), _id: "slate-9", shareId: "routed", nativeCanvasDrawing: true, nodes: [structuredClone(s.world.slate("demo").nodes[1])] };
  s.world.slates.push(routed);
  const workshopBefore = structuredClone(routed.creative);
  const preview = await s.conversation.preview({ principal: s.principal, shareId: "routed", board: structuredClone(routed), message: "Second → Review", id: REQ, useAI: false });
  assert.deepEqual(preview.labels, ["Review"]);
  const saved = await s.conversation.keep({ principal: s.principal, writes: preview.writes, execId: preview.execId });
  assert.equal(saved[0].status, 201);
  assert.deepEqual(texts(s.world, "routed"), ["Second", "Review"]);
  assert.deepEqual(s.world.slate("routed").creative, workshopBefore, "the route is untouched");
  // Restated (release/agentic): a workshop slate that is not a drawing takes canvas plans too,
  // on the notes beside its workshop (production draws notes beside any workshop); its workshop
  // is untouched. Other creative slates still refuse canvas plans.
  const workshopModel = structuredClone(s.world.slate("workshop").creative);
  const beside = await s.world.registry.run(s.principal, "slates.applyOperations", { shareId: "workshop", mode: "save", expectedRevision: s.world.slate("workshop").revision ?? 0, plan: { message: "x", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "Beside" }] } });
  assert.equal(beside.status, 201);
  assert.deepEqual(texts(s.world, "workshop"), ["Beside"]);
  assert.deepEqual(s.world.slate("workshop").creative, workshopModel, "the workshop is untouched");
  s.world.slates.push({ ...structuredClone(s.world.slate("demo")), _id: "slate-10", shareId: "other-kind", creative: { revision: 0, model: { version: 1, kind: "story" } } });
  await assert.rejects(
    s.world.registry.run(s.principal, "slates.applyOperations", { shareId: "other-kind", mode: "preview", plan: { message: "x", operations: [{ kind: "add_nodes", count: 1, shape: "rectangle", text: "x" }] } }),
    (error) => error.code === "invalid_operation_plan"
  );
});
