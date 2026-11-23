const { createRequire } = require('node:module')
const { join } = require('node:path')
const { flattenDeepInfraContent } = require('./deepinfra.mjs')

// The Meteor module loader does not resolve ESM-only package export subpaths.
// Load the pinned server dependencies through Node's native package resolver.
const load = createRequire(typeof __meteor_bootstrap__ === 'undefined'
  ? __filename : join(__meteor_bootstrap__.serverDir, 'npm', 'package.json'))
const { generateText, jsonSchema, tool } = load('ai')
const { createOpenAICompatible } = load('@ai-sdk/openai-compatible')
const { createAnthropic } = load('@ai-sdk/anthropic')

// The existing canvas assistant stores Anthropic-format tool exchanges and images.
// Convert that history to SDK messages without executing the historical tools.
function sdkMessages(prompts) {
  const result = [], toolNames = new Map()
  for (const message of prompts) {
    if (message.role === 'system') continue
    if (!Array.isArray(message.content)) {
      result.push({ role: message.role, content: message.content })
      continue
    }
    let parts = []
    function flush() {
      if (parts.length) result.push({ role: message.role, content: parts })
      parts = []
    }
    for (const part of message.content) {
      if (typeof part === 'string') parts.push({ type: 'text', text: part })
      else if (part.type === 'tool_use') {
        toolNames.set(part.id, part.name)
        parts.push({ type: 'tool-call', toolCallId: part.id, toolName: part.name, input: part.input })
      } else if (part.type === 'tool_result' && toolNames.has(part.tool_use_id)) {
        flush()
        result.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: part.tool_use_id,
          toolName: toolNames.get(part.tool_use_id), output: { type: 'text', value: flattenDeepInfraContent(part.content) } }] })
      } else if (part.type === 'image' && part.source?.type === 'base64') {
        parts.push({ type: 'file', data: part.source.data, mediaType: part.source.media_type })
      } else if (part.type === 'image_url') {
        parts.push({ type: 'file', data: new URL(part.image_url.url), mediaType: 'image' })
      } else {
        const text = flattenDeepInfraContent([part])
        if (text) parts.push({ type: 'text', text })
      }
    }
    flush()
  }
  return result
}

async function sdkChatRequest({ provider, endpoint, apiKey, body, functions, signal, local, fetcher }) {
  const anthropic = provider === 'anthropic'
  // the Anthropic SDK falls back to the server's ANTHROPIC_API_KEY when no key is given: a
  // request that brought no key of its own must not be paid with the platform's
  if (anthropic && !apiKey) throw new Error('No Anthropic key was given for this request.')
  const baseURL = endpoint.replace(anthropic ? /\/messages$/ : /\/chat\/completions$/, '')
  const fetch = local ? (url, init) => (fetcher || globalThis.fetch)(url, { ...init, redirect: 'error' }) : fetcher
  const model = anthropic
    ? createAnthropic({ apiKey, baseURL, fetch, headers: { 'anthropic-beta': 'output-128k-2025-02-19' } })(body.model)
    : createOpenAICompatible({ name: provider, baseURL, apiKey: apiKey || undefined, fetch, transformRequestBody: body.user ? args => ({ ...args, user: body.user }) : undefined })(body.model)
  const tools = Object.fromEntries((functions || []).map(def => [def.name,
    tool({ description: def.description, inputSchema: jsonSchema(def.parameters) })]))
  const chosen = body.tool_choice?.function?.name || body.tool_choice?.name || body.function_call?.name
  // a named tool; required (some tool, for an endpoint with no named form); auto as sent (for an
  // endpoint that refuses anything else); otherwise the SDK's default
  const offered = Object.keys(tools).length > 0
  let toolChoice
  if (chosen && tools[chosen]) toolChoice = { type: 'tool', toolName: chosen }
  else if (offered && (body.tool_choice === 'required' || body.tool_choice === 'auto')) toolChoice = body.tool_choice
  const instructions = [body.system, ...body.messages.filter(m => m.role === 'system').map(m => flattenDeepInfraContent(m.content))].filter(Boolean).join('\n\n')
  const response = await generateText({
    model, instructions: instructions || undefined, messages: sdkMessages(body.messages),
    tools, toolChoice,
    maxOutputTokens: body.max_tokens, temperature: body.temperature, abortSignal: signal,
    experimental_download: async files => files.map(() => null),
    maxRetries: 0, include: { responseBody: true },
  })
  return response.response.body
}

exports.sdkChatRequest = sdkChatRequest
