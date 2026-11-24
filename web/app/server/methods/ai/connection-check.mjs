// "Test connection": can Slatebox reach this endpoint, does it accept the key, which models does
// it list (where it lists them), does the chosen model answer, and does it call tools (which the
// canvas features need). Two small requests at most, plus the model list. The key is sent only to
// the connection's own address and never appears in the answer.
import { authFor, protocolOf, withQuery } from './connection-request.mjs'
import { redactText } from '../../exec/redact.mjs'

const PROBE_TOOL = { name: 'ping', description: 'Call this tool to answer.', parameters: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } }
const PROBE_PROMPT = 'Call the ping tool with ok set to true.'

// The key and the provider's extra headers as the provider wants them (connection-request.mjs):
// a bearer key, a named header, a query parameter, or Anthropic's x-api-key.
function headersFor(connection) {
  return { 'Content-Type': 'application/json', Accept: 'application/json', ...authFor(connection).headers }
}
const urlFor = (connection, url) => withQuery(url, authFor(connection).query)
const isAnthropic = (connection) => protocolOf(connection) === 'anthropic-messages'

function chatBody(connection, withTools) {
  if (isAnthropic(connection)) {
    return {
      model: connection.model, max_tokens: 64, messages: [{ role: 'user', content: PROBE_PROMPT }],
      ...(withTools && { tools: [{ name: PROBE_TOOL.name, description: PROBE_TOOL.description, input_schema: PROBE_TOOL.parameters }] }),
    }
  }
  return {
    model: connection.model, max_tokens: 64, stream: false, messages: [{ role: 'user', content: PROBE_PROMPT }],
    ...(withTools && { tools: [{ type: 'function', function: PROBE_TOOL }], tool_choice: 'auto' }),
  }
}

const calledTool = (connection, json) => isAnthropic(connection)
  ? Boolean(json?.content?.some?.((part) => part.type === 'tool_use'))
  : Boolean(json?.choices?.[0]?.message?.tool_calls?.length || json?.choices?.[0]?.message?.function_call)

const answered = (connection, json) => isAnthropic(connection)
  ? Array.isArray(json?.content)
  : Array.isArray(json?.choices) && json.choices.length > 0

// a provider's error text, without the key, any key-like value or a query string (spec 6.2)
const scrub = (text, connection) => redactText(text, { keys: [connection.apiKey], max: 300 })

async function call(fetcher, url, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, { ...init, redirect: 'error', signal: controller.signal })
    let json = null
    try {
      json = await response.json()
    } catch {}
    return { status: response.status, ok: response.ok, json }
  } catch (error) {
    return { status: null, ok: false, json: null, error: error.name === 'AbortError' ? 'timeout' : (['EndpointRefused', 'ResponseTooLarge'].includes(error.name) ? redactText(error.message) : 'unreachable') }
  } finally {
    clearTimeout(timer)
  }
}

function unreachableMessage(connection, result) {
  if (result.error === 'timeout') return `${connection.baseUrl} did not answer in time.`
  if (result.error && result.error !== 'unreachable') return result.error
  let host = ''
  try {
    host = new URL(connection.baseUrl).hostname
  } catch {}
  const hint = /^(localhost|127\.|\[::1\])/.test(host)
    ? ' Inside the Slatebox container, localhost is the container itself: use host.docker.internal for a model on the host.'
    : ''
  return `Slatebox could not reach ${connection.baseUrl}. Check the address and that the model server is running.${hint}`
}

/**
 * connection: a normalised connection with its key. options: { fetch (one that applies the
 * endpoint rules), timeoutMs }.
 * → { ok, reachable, models: string[] | null, modelListed: boolean | null, chat: 'ok'|'failed',
 *     tools: 'yes'|'no'|'unknown', message }
 */
export async function checkConnection(connection, { fetch: fetcher, timeoutMs = 20000 }) {
  const base = connection.baseUrl.replace(/\/+$/, '')
  const headers = headersFor(connection)
  const out = { ok: false, reachable: false, models: null, modelListed: null, chat: 'failed', tools: 'unknown', message: '' }

  const listed = await call(fetcher, urlFor(connection, `${base}/models`), { method: 'GET', headers }, timeoutMs)
  if (listed.status === null && listed.error) {
    out.message = unreachableMessage(connection, listed)
    return out
  }
  out.reachable = true
  if (listed.status === 401 || listed.status === 403) {
    out.message = 'The endpoint did not accept the key.'
    return out
  }
  const ids = Array.isArray(listed.json?.data) ? listed.json.data.map((m) => m?.id).filter((id) => typeof id === 'string') : null
  if (listed.ok && ids) {
    out.models = ids.slice(0, 200)
    out.modelListed = connection.model ? ids.includes(connection.model) : null
  }
  if (!connection.model) {
    out.ok = listed.ok
    out.message = listed.ok ? 'Connected. Choose a model.' : `The endpoint answered HTTP ${listed.status} for its model list.`
    return out
  }

  const chatUrl = urlFor(connection, isAnthropic(connection) ? `${base}/messages` : `${base}/chat/completions`)
  let probe = await call(fetcher, chatUrl, { method: 'POST', headers, body: JSON.stringify(chatBody(connection, true)) }, timeoutMs)
  if (probe.status === null) {
    out.message = unreachableMessage(connection, probe)
    return out
  }
  if (probe.status === 401 || probe.status === 403) {
    out.message = 'The endpoint did not accept the key.'
    return out
  }
  const errorText = scrub(probe.json?.error?.message ?? probe.json?.error ?? '', connection)
  if (!probe.ok && /tool|function/i.test(errorText)) {
    out.tools = 'no'
    probe = await call(fetcher, chatUrl, { method: 'POST', headers, body: JSON.stringify(chatBody(connection, false)) }, timeoutMs)
  } else if (probe.ok && answered(connection, probe.json)) {
    out.tools = calledTool(connection, probe.json) ? 'yes' : 'unknown'
  }
  if (!probe.ok || !answered(connection, probe.json)) {
    const notServed = out.modelListed === false ? ` ${connection.model} is not among the models it lists.` : ''
    out.message = `The model did not answer (HTTP ${probe.status}).${notServed}`
    return out
  }
  out.chat = 'ok'
  out.ok = true
  const notes = []
  if (out.modelListed === false) notes.push(`${connection.model} is not in the endpoint's model list, but it answered.`)
  if (out.tools === 'no') notes.push('This model does not call tools, so conversation, drafts and presentations cannot use it. It can still serve other features.')
  if (out.tools === 'unknown') notes.push('The model answered without calling the test tool. Features that edit the canvas may not work with it.')
  out.message = ['Connected.', ...notes].join(' ')
  return out
}

/**
 * The models a connection lists (ai.models.discover): GET <base>/models, OpenAI-compatible
 * providers only, through the guarded fetch (no redirects). Writes nothing.
 * → { ok, models: [{ id, ownedBy? }], message }
 */
export async function listModels(connection, { fetch: fetcher, timeoutMs = 20000 }) {
  if (protocolOf(connection) !== 'openai-chat') return { ok: false, models: [], message: 'Only OpenAI-compatible providers list their models.' }
  const base = connection.baseUrl.replace(/\/+$/, '')
  const listed = await call(fetcher, urlFor(connection, `${base}/models`), { method: 'GET', headers: headersFor(connection) }, timeoutMs)
  if (listed.status === null) return { ok: false, models: [], message: unreachableMessage(connection, listed) }
  if (listed.status === 401 || listed.status === 403) return { ok: false, models: [], message: 'The endpoint did not accept the key.' }
  if (!listed.ok || !Array.isArray(listed.json?.data)) return { ok: false, models: [], message: `The endpoint answered HTTP ${listed.status} for its model list.` }
  const models = listed.json.data
    .filter((m) => typeof m?.id === 'string' && m.id.length <= 200 && !/[\r\n]/.test(m.id))
    .slice(0, 500)
    .map((m) => ({ id: m.id, ...(typeof m.owned_by === 'string' && { ownedBy: m.owned_by.slice(0, 80) }) }))
  return { ok: true, models, message: `${models.length} model${models.length === 1 ? '' : 's'} listed.` }
}
