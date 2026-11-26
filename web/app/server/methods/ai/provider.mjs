import {
  flattenDeepInfraContent,
  getDeepInfraToolArguments,
  normalizeDeepInfraMessages,
  toDeepInfraToolChoice,
  toDeepInfraTools,
} from './deepinfra.mjs'
import { textToolCall } from './text-tool-call.mjs'

export const AI_PROVIDERS = Object.freeze({
  anthropic: 'anthropic',
  deepinfra: 'deepinfra',
  openai: 'openai',
})

// The wire shapes a request's body and answer take. Which provider and model answer, and with
// which key, comes from Admin → AI control (ai-settings-core.mjs resolveFor), never from here.
export function isRetryableProviderFailure(status, message = '') {
  // Transient serving-side failures worth retrying against the SAME provider
  // before falling back to another model (DeepInfra cold-start/template flakes,
  // capacity blips, timeouts, rate limits). Deterministic auth/quota failures
  // are NOT retryable.
  if (status === 408 || status === 429) return true
  if (typeof status === 'number' && status >= 500) return true
  return /template error|chat template|no element|cold.?start|no available gpu|serverless/i.test(message)
}

/**
 * Which features keep the fallback model after SHAPE exhaustion (iter59,
 * live-audit evidence): generation/vision fallbacks demonstrably recovered
 * content (audit shares 383b6a/feaf46/f50c74/d8a1dd). Welcome-layer shapes
 * (welcome, *-route classifiers) never recovered via fallback in the whole
 * Oct 22–Nov 5 window — every FB chain on those duplicated a dead ladder.
 * Default for unknown features is BLOCK (cost-safe).
 */
// The failure classes after which another model may still help: infra = 5xx, 429, timeout; shape =
// answers that never took the shape the feature needs.
export const CODE_FALLBACK_ON = Object.freeze({
  generation: Object.freeze(['infra', 'shape']),
  vision: Object.freeze(['infra', 'shape']),
})
export const DEFAULT_FALLBACK_ON = Object.freeze(['infra'])
export function codeFallbackOn(feature) {
  return CODE_FALLBACK_ON[feature] || DEFAULT_FALLBACK_ON
}
export function keepsFallbackAfterShapeExhaustion(feature) {
  return codeFallbackOn(feature).includes('shape')
}

export function resolveAIRequestTimeout({ requested, settings = {} } = {}) {
  return Math.max(
    1000,
    Math.min(requested || settings.ai?.requestTimeoutMs || 90000, 180000)
  )
}

export function buildProviderTelemetry({
  provider,
  model,
  feature = 'unspecified',
  status,
  duration = 0,
  responseStatus = null,
  usage,
  errCount = 0,
  error,
  invalidPayloadLength,
  fallbackFromProvider,
  fallbackReason,
} = {}) {
  return {
    provider,
    model,
    feature,
    status,
    duration,
    responseStatus,
    usage,
    errCount,
    error: error?.slice?.(0, 500),
    invalidPayloadLength,
    fallbackFromProvider,
    fallbackReason: fallbackReason?.slice?.(0, 500),
  }
}

export function buildProviderBody({
  provider,
  model,
  prompts = [],
  system,
  functions,
  functionCall,
  userId,
  maxTokens,
  temperature,
} = {}) {
  const embeddedSystem = prompts
    .filter((prompt) => prompt?.role === 'system')
    .map((prompt) => flattenDeepInfraContent(prompt?.content))
    .filter(Boolean)
    .join('\n\n')
  let messages = prompts
  if (provider === AI_PROVIDERS.deepinfra) {
    messages = normalizeDeepInfraMessages(prompts, system)
  } else if (provider === AI_PROVIDERS.anthropic) {
    messages = prompts.filter((prompt) => prompt?.role !== 'system')
  }
  const body = {
    model,
    messages,
  }

  if (provider === AI_PROVIDERS.anthropic) {
    body.max_tokens = model?.includes('claude-3-7') ? 128000 : 8192
    body.system = [system, embeddedSystem].filter(Boolean).join('\n\n')
  } else if (provider === AI_PROVIDERS.deepinfra) {
    body.max_tokens = 16384
    body.temperature = 0.2
  } else if (userId) {
    body.user = userId
  }

  // a connection's own output cap
  if (maxTokens) body.max_tokens = maxTokens
  // a call site's sampling temperature
  if (Number.isFinite(temperature)) body.temperature = temperature

  if (functions?.length) {
    if (provider === AI_PROVIDERS.anthropic) {
      body.tools = functions.map((definition) => ({
        name: definition.name,
        description: definition.description,
        input_schema: definition.parameters,
      }))
    } else if (provider === AI_PROVIDERS.deepinfra) {
      body.tools = toDeepInfraTools(functions)
    } else {
      body.functions = functions
    }
  }

  if (functionCall?.name && !functions?.some((f) => f?.name === functionCall.name)) {
    // Guard: a forced tool_choice naming a function absent from tools crashes
    // provider-side chat-template rendering (DeepInfra "template error: list
    // object has no element 0"). Stale handoff payloads can reuse a
    // function_call whose tools are not on this request; downgrade to auto.
    functionCall = undefined
  }

  if (functionCall) {
    if (provider === AI_PROVIDERS.anthropic) {
      body.tool_choice = {
        ...functionCall,
        type: functionCall.type || 'tool',
      }
    } else if (provider === AI_PROVIDERS.deepinfra) {
      body.tool_choice = toDeepInfraToolChoice(functionCall)
    } else {
      body.function_call = functionCall
    }
  }

  return body
}

function normalizeToolCall(provider, message) {
  if (provider === AI_PROVIDERS.anthropic) {
    const toolUse = message?.content?.find((part) => part.type === 'tool_use')
    if (!toolUse) return null
    return {
      id: toolUse.id,
      name: toolUse.name,
      arguments: toolUse.input,
    }
  }

  const toolCall = message?.tool_calls?.[0]
  const legacyCall = message?.function_call
  const name = toolCall?.function?.name || legacyCall?.name
  const rawArguments =
    toolCall?.function?.arguments || legacyCall?.arguments || undefined
  if (!name && rawArguments == null) return null

  let args = rawArguments
  if (typeof rawArguments === 'string') {
    try {
      args = JSON.parse(rawArguments)
    } catch (error) {
      args = rawArguments
    }
  }

  return {
    id: toolCall?.id,
    name,
    arguments: args,
  }
}

export function normalizeProviderUsage(provider, response = {}) {
  const usage = response.usage || {}
  if (provider === AI_PROVIDERS.anthropic) {
    return {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
    }
  }

  return {
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    totalTokens:
      usage.total_tokens ||
      (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    // DeepInfra reports its own price for the call; the meter prefers it to the table.
    ...(typeof usage.estimated_cost === 'number' && { providerCostUsd: usage.estimated_cost }),
  }
}

// textTools: the offered tools ({ name, parameters }) whose calls may be read from the message text, when the answer
// has no tool_calls (text-tool-call.mjs). Empty unless the caller opts in (req's textToolCalls): none by default.
export function normalizeProviderResponse({ provider, response = {}, textTools = [] } = {}) {
  const message =
    provider === AI_PROVIDERS.anthropic
      ? response
      : response?.choices?.[0]?.message
  const toolCall = normalizeToolCall(provider, message) ||
    (provider !== AI_PROVIDERS.anthropic ? textToolCall(message?.content, textTools) : null)

  let jsonCandidate = message?.content || message?.function_call
  if (provider === AI_PROVIDERS.anthropic) jsonCandidate = message
  if (provider === AI_PROVIDERS.deepinfra) {
    jsonCandidate = getDeepInfraToolArguments(message)
  }

  return {
    message,
    toolCall,
    jsonCandidate,
    usage: normalizeProviderUsage(provider, response),
  }
}

export function getNormalizedAssistantContent({ message, toolCall } = {}) {
  if (Array.isArray(message?.content)) return message.content

  const content = []
  if (typeof message?.content === 'string' && message.content.trim()) {
    content.push({ type: 'text', text: message.content })
  }
  if (toolCall) {
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.arguments,
    })
  }
  return content
}

/** Allow conversational text only when the caller explicitly opts in. */
export function isAllowedPlainTextResponse({
  allowPlainText,
  message,
  toolCall,
} = {}) {
  return Boolean(
    allowPlainText &&
      !toolCall &&
      typeof message?.content === 'string' &&
      message.content.trim()
  )
}
