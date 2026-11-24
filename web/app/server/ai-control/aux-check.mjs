// "Test connection" for the services beside the models: Stability (pictures), Google picture search,
// Noun Project (icons) and Deepgram (call transcription). One small request each, sent only to the
// service's own address, with no redirects; the answer never carries the key.
//
// Pure apart from the injected fetch (the guarded one: endpoint rules, no redirects, a size cap).
import { createHmac, randomBytes } from 'node:crypto'
import { redactText } from '../exec/redact.mjs'

const rfc3986 = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/**
 * The OAuth 1.0a Authorization header (HMAC-SHA1) the Noun Project API takes, for a GET of url.
 * nonce and timestamp may be given (tests).
 */
export function oauth1Header({ method = 'GET', url, key, secret, nonce = randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000) }) {
  const parsed = new URL(url)
  const oauth = { oauth_consumer_key: key, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(timestamp), oauth_version: '1.0' }
  const params = [...parsed.searchParams.entries(), ...Object.entries(oauth)].map(([k, v]) => [rfc3986(k), rfc3986(v)]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
  const base = [method.toUpperCase(), rfc3986(`${parsed.origin}${parsed.pathname}`), rfc3986(params.map(([k, v]) => `${k}=${v}`).join('&'))].join('&')
  const signature = createHmac('sha1', `${rfc3986(secret)}&`).update(base).digest('base64')
  return `OAuth ${Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${rfc3986(k)}="${rfc3986(v)}"`).join(', ')}`
}

// What each service is asked: a request that proves the key without generating anything.
function probeFor(connection) {
  const base = connection.baseUrl.replace(/\/+$/, '')
  const key = connection.apiKey || ''
  switch (connection.type) {
    case 'stability':
      return { url: `${base}/v1/user/account`, headers: { Authorization: key } }
    case 'deepgram':
      return { url: `${base}/v1/projects`, headers: { Authorization: `Token ${key}` } }
    case 'google-cse': {
      // one picture search for a plain word (Google counts it as a query)
      const url = `${base}/customsearch/v1?cx=${encodeURIComponent(connection.model || '')}&num=1&searchType=image&safe=ACTIVE&q=slatebox&key=${encodeURIComponent(key)}`
      return { url, headers: { Referer: 'https://slatebox.com' } }
    }
    case 'nounproject': {
      const [consumerKey, secret] = key.split(':')
      const url = `${base}/v2/client/usage`
      return { url, headers: { Authorization: oauth1Header({ url, key: consumerKey, secret }) } }
    }
    default:
      return null
  }
}

/**
 * connection: { type, baseUrl, apiKey, model? } (an aux connection with its key);
 * options: { fetch (the guarded fetch), timeoutMs }.
 * → { ok, reachable, models: null, modelListed: null, chat: 'ok'|'failed', tools: 'unknown', message }
 * (the same shape as a model connection's test, so ai.check answers alike).
 */
export async function checkAuxConnection(connection, { fetch: fetcher, timeoutMs = 15000 }) {
  const out = { ok: false, reachable: false, models: null, modelListed: null, chat: 'failed', tools: 'unknown', message: '' }
  const probe = probeFor(connection)
  if (!probe) {
    out.message = `Slatebox does not know how to test ${connection.type}.`
    return out
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetcher(probe.url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', ...probe.headers } })
  } catch (error) {
    out.message = error.name === 'AbortError' ? `${new URL(connection.baseUrl).host} did not answer in time.` : `Slatebox could not reach ${new URL(connection.baseUrl).host}.`
    return out
  } finally {
    clearTimeout(timer)
  }
  out.reachable = true
  let json = null
  try {
    json = await response.json()
  } catch {}
  if (response.status === 401 || response.status === 403) {
    out.message = 'The service did not accept the key.'
    return out
  }
  if (!response.ok) {
    const said = redactText(json?.error?.message ?? json?.message ?? json?.err_msg ?? '', { keys: [connection.apiKey, ...(connection.apiKey || '').split(':')], max: 200 })
    out.message = `The service answered HTTP ${response.status}.${said ? ` ${said}` : ''}`
    return out
  }
  out.ok = true
  out.chat = 'ok'
  out.message = 'Connected. The key works.'
  return out
}
