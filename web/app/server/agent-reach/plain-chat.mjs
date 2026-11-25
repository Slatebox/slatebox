// One plain chat request to a model connection as AI control describes it ({type, baseUrl,
// apiKey, model}): no tools, a system message and a question, the answer as text. The wire shape
// follows the provider's protocol (connection-request.mjs): anthropic-messages, or an
// OpenAI-compatible chat. Used by the share-of-voice job and the pick-rate eval. A key never
// appears in an error: not the key, and not a provider's masked echo of it.
import { authFor, protocolOf, withQuery } from '../methods/ai/connection-request.mjs'

export function scrubKey(message, key) {
  const text = key ? String(message).split(key).join('[key]') : String(message)
  return text.replace(/\b(?:sk|rk|pk|key)[-_][A-Za-z0-9*_-]{4,}/gi, '[key]').replace(/(API key provided:)\s*\S+/i, '$1 [key]')
}

const retryable = (status) => status === 429 || status >= 500

/**
 * plainChat({ connection, system, user, fetchImpl, timeoutMs, maxTokens, retries })
 * -> { text, usage } ; throws Error('HTTP 4xx: ...') with the key scrubbed.
 */
export async function plainChat({ connection, system, user, fetchImpl = fetch, timeoutMs = 120000, maxTokens = 4096, retries = 1 }) {
  const base = String(connection.baseUrl).replace(/\/+$/, '')
  const anthropic = protocolOf(connection) === 'anthropic-messages'
  const { headers, query } = authFor(connection)
  const body = anthropic
    ? { model: connection.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }
    : { model: connection.model, max_tokens: maxTokens, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }
  const url = withQuery(anthropic ? `${base}/messages` : `${base}/chat/completions`, query)
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal })
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        const reason = json?.error?.message ?? (typeof json?.error === 'string' ? json.error : '')
        lastError = new Error(scrubKey(`HTTP ${response.status}${reason ? ': ' + String(reason).slice(0, 160) : ''}`, connection.apiKey))
        lastError.status = response.status
        if (retryable(response.status)) continue
        throw lastError
      }
      const text = anthropic
        ? (json?.content || []).filter((c) => c?.type === 'text').map((c) => c.text).join('')
        : json?.choices?.[0]?.message?.content ?? ''
      return { text: typeof text === 'string' ? text : '', usage: json?.usage ?? null }
    } catch (error) {
      if (error === lastError && !retryable(error.status)) throw error
      lastError = error?.name === 'AbortError' ? new Error('The model did not answer in time.') : error
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(scrubKey(lastError?.message || 'The request failed.', connection.apiKey))
}
