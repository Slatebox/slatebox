// The canvas contract itself (validator, applier, summary, tool schema) lives
// in the engine, slateboxjs/operations, and is tested there. This file keeps
// the app's own use of it: the model router that checks a proposed plan.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { validateSlateMessageRoute } from "../web/app/server/methods/ai/welcome-response.mjs";

// slateboxjs is the app's dependency (web/app), not the repository root's.
const { SLATE_OPERATION_TOOL } = createRequire(
  new URL("../web/app/package.json", import.meta.url),
)("slateboxjs/operations");

const screenshotRequest = "3 triangles, to the right of the welcome node";
const trianglePlan = {
  message: "Done — I added three triangles to the right of Welcome.",
  operations: [
    {
      kind: "add_nodes",
      count: 3,
      shape: "triangle",
      placement: {
        relativeTo: "welcome-node",
        direction: "right",
        arrangement: "column",
      },
    },
  ],
};

test("the model is offered the engine's applySlateOperations tool", () => {
  assert.equal(SLATE_OPERATION_TOOL.name, "applySlateOperations");
  assert.equal(
    SLATE_OPERATION_TOOL.parameters.properties.operations.items.properties.shape.enum.includes("triangle"),
    true,
  );
});

test("the active-conversation router accepts safe edits and explicit delegation only", () => {
  assert.equal(
    validateSlateMessageRoute(
      { toolCall: { name: "applySlateOperations", arguments: trianglePlan } },
      {
        userMessage: screenshotRequest,
        existingNodeIds: ["welcome-node", "flower-node"],
      },
    ),
    null,
  );
  assert.equal(
    validateSlateMessageRoute({
      toolCall: {
        name: "delegateToConversation",
        arguments: { reason: "The user asked for research." },
      },
    }),
    null,
  );
  assert.match(
    validateSlateMessageRoute({ toolCall: null }).retryPrompt,
    /applySlateOperations/,
  );
});

test("the router refuses a plan the engine refuses, with a retry prompt that says why", () => {
  const refused = validateSlateMessageRoute(
    { toolCall: { name: "applySlateOperations", arguments: { message: "Done.", operations: [{ kind: "update_nodes", target: { ids: ["invented-node"] }, changes: { text: "Nope" } }] } } },
    { userMessage: "Rename Welcome", existingNodeIds: ["welcome-node"] },
  );
  assert.equal(refused.code, "slateOperationPlanInvalid");
  assert.match(refused.retryPrompt, /^Call applySlateOperations again with a safe, valid plan\. .*not in the slate/);
});
