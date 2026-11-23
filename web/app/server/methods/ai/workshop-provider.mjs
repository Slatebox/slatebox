import { toDeepInfraTools, toDeepInfraToolChoice } from './deepinfra.mjs'

// The request body for an OpenAI-compatible connection (req.js): config is the resolved
// connection's { endpoint, model, apiKey, toolChoice, maxTokens, agent }.

// The connection's toolChoice setting (connections.mjs), never a provider name: named sends the
// function; required forces some tool where the feature forces one (an endpoint with no named
// form); auto lets the model decide (an endpoint that refuses anything else). A wrong or missing
// call is caught by req.js's shape checks and retried.
function toolChoiceFor(config, functionCall) {
  if (config.toolChoice === 'named') return toDeepInfraToolChoice(functionCall)
  if (config.toolChoice === 'required' && functionCall?.name) return 'required'
  return 'auto'
}

export function localWorkshopRequest(config, { prompts, system, functions, functionCall }) {
  return {
    method: 'POST',
    redirect: 'error', // Keep the brief and authorization on the operator-selected endpoint.
    // a person's own endpoint connects only to public addresses (metering/own-endpoint.mjs)
    ...(config.agent && { agent: config.agent }),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'system', content: system }, ...prompts],
      tools: toDeepInfraTools(functions),
      tool_choice: toolChoiceFor(config, functionCall),
      ...(config.maxTokens && { max_tokens: config.maxTokens }),
      stream: false,
    }),
  }
}
