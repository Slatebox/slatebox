// How req.js sends one request through a chosen connection. Every connection goes through the
// AI SDK (sdk-chat.cjs): an OpenAI-compatible endpoint (any host, cloud or local) or Anthropic.
// An OpenAI-compatible server may ignore a named tool choice (Ollama does), so a generic endpoint
// gets tool_choice auto and the shape checks in req.js; the OpenAI and DeepInfra presets honour a
// named tool. The connection's toolChoice setting (auto, named or required) overrides either:
// required for an endpoint that forces a call but has no named form, auto for one that refuses
// anything else (workshop-provider.mjs and sdk-chat.cjs put it on the wire). Output is capped (16384 tokens unless the connection says otherwise) so a model
// that loops stops.
export const DEFAULT_MAX_TOKENS = 16384

export function connectionRequest(connection) {
  const base = connection.baseUrl.replace(/\/+$/, '')
  if (connection.type === 'anthropic') {
    return {
      provider: 'anthropic', endpoint: `${base}/messages`, model: connection.model, apiKey: connection.apiKey,
      toolChoice: connection.toolChoice || 'named', maxTokens: connection.maxTokens || 8192,
    }
  }
  return {
    provider: 'connection', endpoint: `${base}/chat/completions`, model: connection.model, apiKey: connection.apiKey,
    toolChoice: connection.toolChoice || (connection.type === 'openai-compatible' ? 'auto' : 'named'),
    maxTokens: connection.maxTokens || DEFAULT_MAX_TOKENS,
  }
}
