// The chat knows which plain notes are selected: "make these notes rockets" or "make this note
// red" changes exactly the selection. The browser sends the selected notes' ids (capped), the
// server keeps only ids on this slate, and the planner prompt names them with their text. No
// selection keeps the text matching as before.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { MAX_SELECTED_NOTES, noteSelection, selectedNotesContext, validSelection } from "../web/app/imports/api/common/chat-selection.mjs";
import { chatPrompts, chatSystemPrompt } from "../web/app/server/methods/ai/exec-chat.mjs";
import { makeExecWorld } from "./exec-test-world.mjs";

const app = (path) => readFile(new URL(`../web/app/${path}`, import.meta.url), "utf8");
const node = (id, text) => ({ options: { id, text, width: 180, height: 100, x: 0, y: 0 } });
const board = { nodes: [node("a1", "Plan"), node("b2", "Ship"), node("c3", "Plan v2"), node("d4", "Retro")], associations: [] };
const contentOf = (prompts) => JSON.parse(prompts.at(-1).content);

test("the browser sends the selected notes' ids, capped, with how many were selected", () => {
  assert.equal(noteSelection([]), null);
  assert.equal(noteSelection(null), null);
  assert.deepEqual(noteSelection(["a1", "b2"]), { kind: "notes", ids: ["a1", "b2"], count: 2 });
  const many = Array.from({ length: 400 }, (_, i) => `n${i}`);
  const capped = noteSelection(many);
  assert.equal(capped.ids.length, MAX_SELECTED_NOTES);
  assert.equal(capped.count, 400);
  assert.deepEqual(noteSelection(["a1", "a1", "", 7, "b2"]).ids, ["a1", "b2"], "only distinct string ids");
});

test("the server takes a notes selection only in its checked shape; card, lane and line still pass", () => {
  assert.ok(validSelection(null));
  assert.ok(validSelection({ kind: "notes", ids: ["a1", "b2"], count: 2 }));
  assert.ok(validSelection({ kind: "card", label: "Todo" }));
  assert.ok(validSelection({ kind: "line", id: "l1", label: "" }));
  assert.ok(!validSelection({ kind: "line", label: "" }), "a line needs its id");
  assert.ok(!validSelection({ kind: "notes", ids: [] }));
  assert.ok(!validSelection({ kind: "notes", ids: Array.from({ length: MAX_SELECTED_NOTES + 1 }, (_, i) => `n${i}`), count: 60 }), "over the cap");
  assert.ok(!validSelection({ kind: "notes", ids: ["<script>"], count: 1 }), "ids are plain");
  assert.ok(!validSelection({ kind: "notes", ids: ["a".repeat(65)], count: 1 }));
  assert.ok(!validSelection({ kind: "notes", ids: ["a1"], count: 0 }), "count covers the ids");
  assert.ok(!validSelection({ kind: "notes", ids: ["a1"], count: 1e9 }));
  assert.ok(!validSelection({ kind: "everything" }));
});

test("the planner prompt names exactly the selected notes on this slate, by id and text", () => {
  const prompts = chatPrompts({ board, shareId: "demo", message: "make these notes rockets", selection: { kind: "notes", ids: ["a1", "d4", "gone"], count: 3 } });
  const { selected } = contentOf(prompts);
  assert.deepEqual(selected, { kind: "notes", notes: [{ id: "a1", text: "Plan" }, { id: "d4", text: "Retro" }], count: 2 });
  assert.match(chatSystemPrompt({ methods: [], types: {}, rules: "" }, "demo"), /selected\.notes.*exactly those notes/s);
});

test("a huge selection is listed up to the cap and says how many more there are", () => {
  const big = { nodes: Array.from({ length: 120 }, (_, i) => node(`n${i}`, `Note ${i}`)) };
  const selection = noteSelection(big.nodes.map((n) => n.options.id));
  assert.ok(validSelection(selection));
  const { selected } = contentOf(chatPrompts({ board: big, shareId: "demo", message: "make these red", selection }));
  assert.equal(selected.notes.length, MAX_SELECTED_NOTES);
  assert.equal(selected.count, 120);
  assert.equal(selected.notListed, 120 - MAX_SELECTED_NOTES);
  assert.ok(JSON.stringify(selected).length < 8000, "bounded prompt");
  assert.equal(selectedNotesContext(big, { kind: "notes", ids: ["x"], count: 1 }), null, "nothing on the slate: no selection");
});

test("no selection: no selected notes in the prompt, and the text matching stays", () => {
  const { selected, currentDrawing } = contentOf(chatPrompts({ board, shareId: "demo", message: "make the plan note a rocket" }));
  assert.equal(selected, undefined);
  assert.ok(currentDrawing.notes.some((n) => n.text === "Plan"));
  assert.match(chatSystemPrompt({ methods: [], types: {}, rules: "" }, "demo"), /find them in its nodes by text/);
});

test("canvasConversation.preview hands the selection to the model; a program on the selected ids changes only them", async (t) => {
  const { renderExecTool } = await import("../web/app/server/actions/client-render.mjs");
  const { createCanvasConversation, sessionPrincipal } = await import("../web/app/server/exec/conversation.mjs");
  const world = makeExecWorld();
  t.after(() => world.close());
  const tool = (({ name, description, inputSchema }) => ({ name, description, parameters: inputSchema }))(renderExecTool(world.exec.manifest).exec);
  const conversation = createCanvasConversation({ registry: world.registry, gate: world.exec.gate, service: world.exec.service, manifest: world.exec.manifest, tool });
  const slate = world.slate("many");
  const [first, , third] = slate.nodes.map((n) => n.options.id);
  assert.ok(first && third, "the many slate has 14 notes");
  const seen = [];
  // A model that does what the prompt says: the selected ids, nothing else.
  const model = async ({ prompts }) => {
    const { selected } = JSON.parse(prompts.at(-1).content);
    seen.push(selected);
    const ids = selected.notes.map((n) => n.id);
    const code = `const s = await slatebox.slates.get({ shareId: "many" });
return await slatebox.slates.applyOperations({ shareId: "many", expectedRevision: s.revision, plan: { message: "Made them diamonds.", operations: [{ kind: "update_nodes", target: { ids: ${JSON.stringify(ids)} }, changes: { shape: "diamond" } }] } });`;
    return { toolCall: { name: "exec", arguments: { intent: "Make these notes diamonds", code } } };
  };
  const principal = sessionPrincipal("owner", "conn-1");
  const selection = { kind: "notes", ids: [first, third], count: 2 };
  const preview = await conversation.preview({ principal, shareId: "many", board: structuredClone(slate), message: "make these notes diamonds", id: "C".repeat(17), useAI: true, model, selection });
  assert.deepEqual(seen[0].notes.map((n) => n.id), [first, third]);
  await conversation.keep({ principal, writes: preview.writes, execId: preview.execId });
  for (const n of world.slate("many").nodes) {
    assert.equal(n.options.shape === "diamond", [first, third].includes(n.options.id), `${n.options.id}`);
  }
});

test("source guards: the canvas sends its selected notes, and the method checks the shape", async () => {
  const canvas = await app("imports/ui/pages/Canvas.jsx");
  assert.match(canvas, /readSelection=\{\(\) => \{[\s\S]{0,600}noteSelection\(/);
  const method = await app("server/methods/canvas-conversation.js");
  assert.match(method, /validSelection\(selection\)/);
});
