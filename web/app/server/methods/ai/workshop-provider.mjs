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

// controlMaxTokens and temperature: what an administrator's published binding sets (AI control);
// the answer size only ever shrinks below the connection's own cap.
export function localWorkshopRequest(config, { prompts, system, functions, functionCall, controlMaxTokens, temperature }) {
  const maxTokens = Number.isFinite(controlMaxTokens) ? Math.min(config.maxTokens || Infinity, controlMaxTokens) : config.maxTokens
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
      ...(maxTokens && { max_tokens: maxTokens }),
      ...(Number.isFinite(temperature) && { temperature }),
      stream: false,
    }),
  }
}
