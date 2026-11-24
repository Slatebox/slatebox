// How req.js sends one request through a chosen connection. Every connection goes through the
// AI SDK (sdk-chat.cjs), by the wire protocol of its provider (ai-control/providers.mjs):
// anthropic-messages through the Anthropic SDK, everything else as an OpenAI-compatible endpoint
// (any host, cloud or local).
// An OpenAI-compatible server may ignore a named tool choice (Ollama does), so a generic endpoint
// gets tool_choice auto and the shape checks in req.js; the OpenAI and DeepInfra presets honour a
// named tool. The connection's toolChoice setting (auto, named or required) overrides either:
// required for an endpoint that forces a call but has no named form, auto for one that refuses
// anything else (workshop-provider.mjs and sdk-chat.cjs put it on the wire). Output is capped (16384 tokens unless the connection says otherwise) so a model
// that loops stops.
import { connectionType } from './connections.mjs'

export const DEFAULT_MAX_TOKENS = 16384

/** The wire protocol a connection speaks: its provider's, or for a type no longer listed, by its name. */
export function protocolOf(connection) {
  return connectionType(connection?.type)?.protocol || (connection?.type === 'anthropic' ? 'anthropic-messages' : 'openai-chat')
}

/**
 * How a connection's key and its provider's extra headers go on the wire, for a request made with
 * fetch: { headers, query } (query: parameters added to the URL, only for a provider whose key
 * goes in the query). The bearer style is the Authorization header.
 */
export function authFor(connection) {
  const type = connectionType(connection?.type)
  const protocol = protocolOf(connection)
  const headers = { ...(type?.extraHeaders || {}) }
  const query = {}
  const key = connection?.apiKey
  if (protocol === 'anthropic-messages') return { headers: { ...headers, 'x-api-key': key || '', 'anthropic-version': '2023-06-01' }, query }
  const auth = type?.auth || { style: 'bearer' }
  if (key && auth.style === 'bearer') headers.Authorization = `Bearer ${key}`
  else if (key && auth.style === 'header') headers[auth.name] = `${auth.prefix || ''}${key}`
  else if (key && auth.style === 'query') query[auth.name] = key
  return { headers, query }
}

/** A URL with the query parameters authFor gives (a key in the query, for providers that want one). */
export function withQuery(url, query = {}) {
  const entries = Object.entries(query)
  if (!entries.length) return url
  const next = new URL(url)
  for (const [name, value] of entries) next.searchParams.set(name, value)
  return next.toString()
}

export function connectionRequest(connection) {
  const base = connection.baseUrl.replace(/\/+$/, '')
  const type = connectionType(connection.type)
  if (protocolOf(connection) === 'anthropic-messages') {
    return {
      provider: 'anthropic', endpoint: `${base}/messages`, model: connection.model, apiKey: connection.apiKey,
      toolChoice: connection.toolChoice || 'named', maxTokens: connection.maxTokens || 8192,
      ...(connection.previousApiKey && { previousApiKey: connection.previousApiKey }),
    }
  }
  // an administrator's provider: its key style and extra headers (the built-in types send a bearer key as always)
  const auth = type?.auth || { style: 'bearer' }
  const custom = type && !type.builtin
  const { headers, query } = custom ? authFor({ ...connection, apiKey: auth.style === 'bearer' ? undefined : connection.apiKey }) : { headers: {}, query: {} }
  return {
    provider: 'connection', endpoint: `${base}/chat/completions`, model: connection.model,
    apiKey: custom && auth.style !== 'bearer' ? undefined : connection.apiKey,
    toolChoice: connection.toolChoice || type?.toolChoice || (connection.type === 'openai-compatible' || custom ? 'auto' : 'named'),
    maxTokens: connection.maxTokens || DEFAULT_MAX_TOKENS,
    ...(Object.keys(headers).length && { headers }),
    ...(Object.keys(query).length && { queryParams: query }),
    ...(connection.previousApiKey && { previousApiKey: connection.previousApiKey }),
  }
}
