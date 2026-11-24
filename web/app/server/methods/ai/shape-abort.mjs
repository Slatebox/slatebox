// What a chosen connection's answer is called when its answers never took the shape a feature needs (req.js). Only a
// model that never answered with a tool call is said to be unable to call tools; a model that called the tool with a
// change the feature turned down (a board's refused move, an unknown step) is named with that reason, and keeps its
// capability. 2026-11-23: a decision path's refused move ("move back to question", muse-ember-1.0 calling
// propose_map_edits correctly every time) was reported as "did not answer with a tool call ... may not support tool
// calls", sending the person to their AI settings for a board rule.

/**
 * `{ abortMessage, capability? }` for a shape-exhausted answer of a chosen connection, or null when the abort was
 * not a shape abort of a request with tools. `feature`: the feature's title in lower case ("conversation and edits").
 */
export function chosenShapeAbort({ result, label, feature, tools, calledTool, rejection }) {
  if (!result?.abort || !result.shape || !tools) return null
  if (!calledTool) {
    return {
      abortMessage: `${label} did not answer with a tool call, which ${feature} needs. It may not support tool calls: choose another model for ${feature} in your AI settings.`,
      capability: 'tools',
    }
  }
  return { abortMessage: `${label} proposed a change that could not be used${rejection?.reason ? ': ' + rejection.reason : '.'}` }
}
