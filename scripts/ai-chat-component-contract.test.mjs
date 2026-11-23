import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The legacy chat window is gone (the slate's one AI surface is the "Ask Slatebox" panel). What
// it ran without a window — the prompt a person arrives with, its welcome turn and the plan the
// server answers with — is SlateAIRunner.
const chatPath = new URL(
  "../web/app/imports/ui/components/ai/SlateAIRunner.jsx",
  import.meta.url,
);
const openaiPath = new URL(
  "../web/app/server/methods/openai.js",
  import.meta.url,
);
const operationExecutorPath = new URL(
  "../web/app/imports/api/client/executeSlateOperations.js",
  import.meta.url,
);
const canvasPath = new URL(
  "../web/app/imports/ui/pages/Canvas.jsx",
  import.meta.url,
);
const aiContentListenerPath = new URL(
  "../web/app/imports/ui/components/ai/AIContentListener.jsx",
  import.meta.url,
);

test("the AI runner announces its progress and passes current slate state", async () => {
  const source = await readFile(chatPath, "utf8");
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /summarizeSlateForAI\(slate\)/);
  assert.match(source, /setRequestStatus\('Applying those changes…'\)/);
});

test("chat reports completion only after the operation executor resolves", async () => {
  const source = await readFile(chatPath, "utf8");
  const executeIndex = source.indexOf("await executeSlateOperations");
  const completeIndex = source.indexOf(
    "Meteor.callAsync(CONSTANTS.methods.openai.operationCompleted",
  );
  assert.ok(executeIndex >= 0);
  assert.ok(completeIndex > executeIndex);
  assert.match(
    source,
    /operationRequestId: resp\.operationRequestId,[\s\S]*status: 'error'/,
  );
});

test("background application is explicitly gated and operation tools do not pre-announce success", async () => {
  const chat = await readFile(chatPath, "utf8");
  const server = await readFile(openaiPath, "utf8");
  assert.match(chat, /resp\.background && resp\.applyBackground/);
  assert.match(server, /toolName !== 'applySlateOperations'/);
  assert.match(server, /never change the theme unless explicitly requested/i);
});

test("terminal operation messages require the server-issued request id", async () => {
  const chat = await readFile(chatPath, "utf8");
  const server = await readFile(openaiPath, "utf8");
  assert.doesNotMatch(chat, /shareId: slate\.shareId,\s*status: 'error'/);
  const pendingLookup = server.indexOf(
    "const pending = pendingSlateOperations.get(operationRequestId)",
  );
  const errorBranch = server.indexOf("if (status === 'error')", pendingLookup);
  assert.ok(pendingLookup >= 0);
  assert.ok(errorBranch > pendingLookup);
});

test("the app delegates live operation execution to SlateboxJS", async () => {
  const source = await readFile(operationExecutorPath, "utf8");
  assert.match(source, /import \{ SlateOperations \} from 'slateboxjs'/);
  assert.match(
    source,
    // RESTATED: the executor also passes replay, which the run listener sets
    // for a saved run's carried-out plan (review-P03 F2).
    /SlateOperations\.applySlateOperations\(slate, plan, \{ userMessage, replay \}\)/,
  );
  assert.doesNotMatch(source, /function addNodes|function updateNodes/);
});

test("onboarding passes the generated AI context directly to the canvas listener", async () => {
  const chat = await readFile(chatPath, "utf8");
  const canvas = await readFile(canvasPath, "utf8");
  const listener = await readFile(aiContentListenerPath, "utf8");

  assert.match(chat, /onAIContextReady\?\.\(entireAIContext\)/);
  assert.match(canvas, /onAIContextReady=\{setLocalAIContext\}/);
  assert.match(canvas, /aiContext=\{effectiveAIContext\}/);
  assert.match(listener, /aiContext\?\.aid \? aiContext : atomAIContext/);
  assert.match(listener, /onAIContextChange\?\.\(nextContext\)/);
});
