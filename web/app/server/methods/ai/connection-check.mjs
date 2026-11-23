// "Test connection": can Slatebox reach this endpoint, does it accept the key, which models does
// it list (where it lists them), does the chosen model answer, and does it call tools (which the
// canvas features need). Two small requests at most, plus the model list. The key is sent only to
// the connection's own address and never appears in the answer.
const PROBE_TOOL = { name: 'ping', description: 'Call this tool to answer.', parameters: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } }
const PROBE_PROMPT = 'Call the ping tool with ok set to true.'

function headersFor(connection) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (connection.type === 'anthropic') return { ...headers, 'x-api-key': connection.apiKey || '', 'anthropic-version': '2023-06-01' }
  return connection.apiKey ? { ...headers, Authorization: `Bearer ${connection.apiKey}` } : headers
}

function chatBody(connection, withTools) {
  if (connection.type === 'anthropic') {
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

const calledTool = (connection, json) => connection.type === 'anthropic'
  ? Boolean(json?.content?.some?.((part) => part.type === 'tool_use'))
  : Boolean(json?.choices?.[0]?.message?.tool_calls?.length || json?.choices?.[0]?.message?.function_call)

const answered = (connection, json) => connection.type === 'anthropic'
  ? Array.isArray(json?.content)
  : Array.isArray(json?.choices) && json.choices.length > 0

const scrub = (text, connection) => {
  let out = String(text ?? '').slice(0, 300)
  if (connection.apiKey) out = out.split(connection.apiKey).join('***')
  return out
}

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
    return { status: null, ok: false, json: null, error: error.name === 'AbortError' ? 'timeout' : (['EndpointRefused', 'ResponseTooLarge'].includes(error.name) ? error.message : 'unreachable') }
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

  const listed = await call(fetcher, `${base}/models`, { method: 'GET', headers }, timeoutMs)
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

  const chatUrl = connection.type === 'anthropic' ? `${base}/messages` : `${base}/chat/completions`
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
