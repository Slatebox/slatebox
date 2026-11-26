// The operator's AI, from the container's settings. Slatebox bundles no model and names none:
// the operator connects whatever they choose, mixed freely, and people may add their own unless
// the operator turns that off.
//
//   SLATEBOX_AI_URL + SLATEBOX_AI_MODEL (+ SLATEBOX_AI_KEY)  one OpenAI-compatible endpoint for every feature
//   SLATEBOX_AI_KEY alone                                     a DeepInfra key for the built-in AI
//   SLATEBOX_AI_CONFIG                                        any mix, as JSON (below)
//   SLATEBOX_AI_PROVIDERS (+ SLATEBOX_AI_DEFAULT)             any mix as the installer (npx slatebox) writes it:
//                                                             a JSON list, each key in its own variable (below)
//   SLATEBOX_AI_OWN_PROVIDERS=on|off                          whether people may connect their own AI (default on)
//   SLATEBOX_AI_PRIVATE_ENDPOINTS=on|off                      whether people's own AI may use private network
//                                                             addresses (default on; the operator's are not affected)
//
// SLATEBOX_AI_CONFIG = { "connections": { "<name>": { "type": "openai-compatible" | "openai" |
//   "anthropic" | "deepinfra" | "openai-realtime" | "gemini-live", "url": "...", "key": "...",
//   "model": "...", "tools": bool, "vision": bool, "images": bool, "maxTokens": n } }, "use": {
//   "default" | "chat" | "generation" | "presentation" | "vision" | "images" | "voice" | ...:
//   "<name>" | "builtin" }, "ownProviders": "on" | "off", "privateEndpoints": "on" | "off" }
// A voice connection (openai-realtime, gemini-live: talking with the agent) is chosen for voice,
// voice.chat or voice.interview only, and those take only a voice connection.
//
// SLATEBOX_AI_PROVIDERS = [{ "id": "<name>", "kind": "openai-compatible" | "deepinfra", "baseUrl": "...",
//   "model": "...", "toolChoice": "auto" | "named", "keyEnv": "SLATEBOX_AI_KEY_<NAME>" }, ...]
// Each key stays in the variable its keyEnv names (the installer's secrets file), never in the
// list. SLATEBOX_AI_DEFAULT names the provider every feature uses; with one provider it is that one.
// It becomes settings.ai, which the app reads (web/app/server/methods/ai/connections.mjs). Keys
// go only into the app's settings in app.env, never into the log.
import net from 'node:net'
import { Plain } from './common.mjs'
import { PROVIDER_KEY } from './settings.mjs'

const TYPES = {
  'openai-compatible': {},
  openai: { baseUrl: 'https://api.openai.com/v1', key: true },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', key: true },
  deepinfra: { baseUrl: 'https://api.deepinfra.com/v1/openai', key: true, modelOptional: true },
  // voice (talking with the agent): realtime providers the app's relay holds the socket to
  'openai-realtime': { baseUrl: 'wss://api.openai.com/v1/realtime', key: true, voice: true },
  'gemini-live': { baseUrl: 'wss://generativelanguage.googleapis.com', key: true, voice: true },
}
// The app's features (web/app/server/ai-control/catalogue.mjs USE_SURFACES); the app checks them again at start.
const USE = ['default', 'chat', 'chat.route', 'generation', 'generation.notes', 'presentation', 'vision', 'images', 'shape',
  'workshop', 'workshop.draft', 'canvas', 'agent.slatebox', 'library', 'connectors', 'interview', 'personal.suggest', 'voice', 'voice.chat', 'voice.interview']
// The parts that talk: they take only a voice connection, and a voice connection serves only them.
const VOICE_USE = ['voice', 'voice.chat', 'voice.interview']
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/
const CONNECTION_FIELDS = ['type', 'url', 'key', 'model', 'tools', 'vision', 'images', 'maxTokens', 'toolChoice']
// Instance metadata services hand out the machine's cloud credentials: no AI request goes there.
// AWS, GCP, Azure, ECS, AWS IPv6, Alibaba, Oracle (192.0.0.192), GCP IPv6 and Azure WireServer.
const METADATA_V4 = new Set(['169.254.169.254', '169.254.170.2', '169.254.170.23', '100.100.100.200', '192.0.0.192', '168.63.129.16'])
const METADATA_V6 = new Set(['fd00:ec2:0:0:0:0:0:254', 'fd00:ec2:0:0:0:0:0:23', 'fd20:ce:0:0:0:0:0:254'])
const METADATA_NAMES = new Set(['metadata', 'metadata.google.internal', 'metadata.goog', 'instance-data', 'instance-data.ec2.internal'])

function v6Words(address) {
  let a = address.toLowerCase().split('%')[0]
  if (a.includes('.')) {
    const i = a.lastIndexOf(':')
    const n = a.slice(i + 1).split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0)
    a = `${a.slice(0, i)}:${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const [head, tail] = a.split('::')
  const h = head ? head.split(':') : []
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : []
  const fill = tail !== undefined ? new Array(8 - h.length - t.length).fill('0') : []
  return [...h, ...fill, ...t].map((x) => parseInt(x || '0', 16))
}

const v4 = (hi, lo) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`

function metadataHost(host) {
  const lower = host.toLowerCase()
  if (METADATA_NAMES.has(lower) || METADATA_V4.has(lower)) return true
  if (!net.isIPv6(host)) return false
  const w = v6Words(host)
  if (METADATA_V6.has(w.map((x) => x.toString(16)).join(':'))) return true
  // IPv4 inside IPv6: mapped (::ffff:a.b.c.d), compatible, NAT64 (64:ff9b::/96, 64:ff9b:1::/48) and 6to4 (2002::/16)
  const embedded = []
  if (w.slice(0, 5).every((x) => x === 0)) embedded.push(v4(w[6], w[7]))
  if (w[0] === 0x64 && w[1] === 0xff9b) embedded.push(v4(w[6], w[7]), v4(w[3], ((w[4] & 0xff) << 8) | (w[5] >> 8)))
  if (w[0] === 0x2002) embedded.push(v4(w[1], w[2]))
  return embedded.some((address) => METADATA_V4.has(address))
}

function endpoint(where, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Plain(`${where} needs the address of the endpoint, for example http://host.docker.internal:11434/v1`)
  let url
  try { url = new URL(value.trim()) } catch { throw new Plain(`${where} is not a valid address`) }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Plain(`${where} must start with http:// or https://`)
  if (url.username || url.password) throw new Plain(`${where}: put the key in "key" (or SLATEBOX_AI_KEY), not in the address`)
  if (url.search || url.hash) throw new Plain(`${where} ends at the path, for example /v1, with nothing after it`)
  if (metadataHost(url.hostname.replace(/^\[|\]$/g, ''))) throw new Plain(`${where} is a cloud metadata address. AI requests are never sent there.`)
  return url.href.replace(/\/+$/, '')
}

function connectionFrom(name, raw, where = `SLATEBOX_AI_CONFIG connection ${name}`) {
  if (!NAME.test(name)) throw new Plain(`SLATEBOX_AI_CONFIG: name each connection with lowercase letters, digits and dashes (not "${name.slice(0, 40)}")`)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Plain(`${where} must be an object`)
  for (const key of Object.keys(raw)) if (!CONNECTION_FIELDS.includes(key)) throw new Plain(`${where}: ${key.slice(0, 40)} is not a field (${CONNECTION_FIELDS.join(', ')})`)
  const type = TYPES[raw.type]
  if (!type) throw new Plain(`${where}: type must be one of ${Object.keys(TYPES).join(', ')}`)
  const out = { type: raw.type }
  if (type.baseUrl) {
    if (raw.url !== undefined && endpoint(where, raw.url) !== type.baseUrl) throw new Plain(`${where}: ${raw.type} has its own address; for another host use the type openai-compatible`)
  } else {
    out.baseUrl = endpoint(where, raw.url)
  }
  if (raw.model !== undefined && (typeof raw.model !== 'string' || !raw.model.trim() || raw.model.length > 200)) throw new Plain(`${where}: model must be the model name the endpoint serves`)
  if (raw.model) out.model = raw.model.trim()
  else if (!type.modelOptional) throw new Plain(`${where} needs a model, the model name the endpoint serves`)
  if (raw.key !== undefined && (typeof raw.key !== 'string' || /[\r\n]/.test(raw.key) || raw.key.length > 400)) throw new Plain(`${where}: key must be one line of text (not shown)`)
  if (raw.key) out.apiKey = raw.key
  else if (type.key) throw new Plain(`${where}: ${raw.type} needs a key`)
  const capabilities = {}
  for (const capability of ['tools', 'vision', 'images']) {
    if (raw[capability] === undefined) continue
    if (typeof raw[capability] !== 'boolean') throw new Plain(`${where}: ${capability} must be true or false`)
    capabilities[capability] = raw[capability]
  }
  if (Object.keys(capabilities).length) out.capabilities = capabilities
  if (raw.maxTokens !== undefined) {
    if (!Number.isInteger(raw.maxTokens) || raw.maxTokens < 256 || raw.maxTokens > 200000) throw new Plain(`${where}: maxTokens must be a whole number from 256 to 200000`)
    out.maxTokens = raw.maxTokens
  }
  if (raw.toolChoice !== undefined) {
    if (!['auto', 'named'].includes(raw.toolChoice)) throw new Plain(`${where}: toolChoice must be auto or named`)
    out.toolChoice = raw.toolChoice
  }
  return out
}

const PROVIDER_FIELDS = ['id', 'kind', 'baseUrl', 'model', 'toolChoice', 'keyEnv']
const PROVIDER_KINDS = { 'openai-compatible': 'openai-compatible', deepinfra: 'deepinfra' }

// SLATEBOX_AI_PROVIDERS, as connections; keys read from each provider's own variable.
function providersFrom(raw, setting, ai) {
  let list
  try { list = JSON.parse(raw) } catch { throw new Plain('SLATEBOX_AI_PROVIDERS must be a JSON list') }
  if (!Array.isArray(list) || !list.length || list.length > 20) throw new Plain('SLATEBOX_AI_PROVIDERS must be a JSON list of 1 to 20 providers')
  const keyVariables = []
  list.forEach((entry, index) => {
    const where = `SLATEBOX_AI_PROVIDERS[${index}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Plain(`${where} must be an object`)
    for (const key of Object.keys(entry)) if (!PROVIDER_FIELDS.includes(key)) throw new Plain(`${where}: ${key.slice(0, 40)} is not a field (${PROVIDER_FIELDS.join(', ')})`)
    const name = entry.id
    if (typeof name !== 'string' || !NAME.test(name)) throw new Plain(`${where}: id must be lowercase letters, digits and dashes`)
    if (ai.connections[name]) throw new Plain(`${where}: the name ${name} is already used${name === 'server' ? ' by SLATEBOX_AI_URL' : ''}; choose another`)
    const type = PROVIDER_KINDS[entry.kind]
    if (!type) throw new Plain(`${where}: kind must be openai-compatible or deepinfra`)
    let key
    if (entry.keyEnv !== undefined) {
      if (typeof entry.keyEnv !== 'string' || !PROVIDER_KEY.test(entry.keyEnv)) throw new Plain(`${where}: keyEnv must name a variable SLATEBOX_AI_KEY_<NAME> (capitals, digits, _)`)
      key = setting(entry.keyEnv)
      if (!key) throw new Plain(`${where}: ${entry.keyEnv} is not set (it holds this provider's key)`)
      keyVariables.push(entry.keyEnv)
    }
    ai.connections[name] = connectionFrom(name, {
      type, ...(type === 'deepinfra' ? {} : { url: entry.baseUrl }), ...(entry.model !== undefined && { model: entry.model }),
      ...(key && { key }), ...(entry.toolChoice !== undefined && { toolChoice: entry.toolChoice }),
    }, where)
  })
  return { names: list.map((entry) => entry.id), keyVariables }
}

function switchValue(value, where) {
  if (value === undefined) return undefined
  const lower = String(value).toLowerCase()
  if (!['on', 'off'].includes(lower)) throw new Plain(`${where} must be on or off`)
  return lower
}

const hostOf = (connection) => {
  try { return new URL(connection.baseUrl || TYPES[connection.type].baseUrl).host } catch { return connection.type }
}

/**
 * setting(name) → the trimmed value or undefined.
 * → { settings: settings.ai or null, deepInfraKey?, legacy?: { baseUrl, model, apiKey? } (the older
 *     selfHosted.workshopProvider, still written for apps that read it), on, summary: [lines] }
 */
export function operatorAI(setting) {
  const key = setting('SLATEBOX_AI_KEY')
  const url = setting('SLATEBOX_AI_URL')
  const model = setting('SLATEBOX_AI_MODEL')
  const rawConfig = setting('SLATEBOX_AI_CONFIG')
  const own = switchValue(setting('SLATEBOX_AI_OWN_PROVIDERS'), 'SLATEBOX_AI_OWN_PROVIDERS')
  const privateEndpoints = switchValue(setting('SLATEBOX_AI_PRIVATE_ENDPOINTS'), 'SLATEBOX_AI_PRIVATE_ENDPOINTS')

  const ai = { connections: {}, use: {} }
  let legacy
  if (url) {
    const baseUrl = endpoint('SLATEBOX_AI_URL', url)
    if (!model) throw new Plain('SLATEBOX_AI_URL also needs SLATEBOX_AI_MODEL, the model name your endpoint serves')
    ai.connections.server = { type: 'openai-compatible', baseUrl, model, ...(key && { apiKey: key }) }
    ai.use.default = 'server'
    legacy = { baseUrl: url, model, ...(key && { apiKey: key }) }
  } else if (model) {
    throw new Plain('SLATEBOX_AI_MODEL only applies together with SLATEBOX_AI_URL')
  }

  if (rawConfig) {
    let config
    try { config = JSON.parse(rawConfig) } catch { throw new Plain('SLATEBOX_AI_CONFIG must be a JSON object') }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Plain('SLATEBOX_AI_CONFIG must be a JSON object')
    for (const field of Object.keys(config)) {
      if (!['connections', 'use', 'ownProviders', 'privateEndpoints'].includes(field)) throw new Plain(`SLATEBOX_AI_CONFIG: ${field.slice(0, 40)} is not a field (connections, use, ownProviders, privateEndpoints)`)
    }
    const connections = config.connections ?? {}
    if (typeof connections !== 'object' || Array.isArray(connections)) throw new Plain('SLATEBOX_AI_CONFIG connections must be an object of named connections')
    for (const [name, raw] of Object.entries(connections)) {
      if (ai.connections[name]) throw new Plain(`SLATEBOX_AI_CONFIG connection ${name}: the name server is taken by SLATEBOX_AI_URL; choose another`)
      ai.connections[name] = connectionFrom(name, raw)
    }
    const use = config.use ?? {}
    if (typeof use !== 'object' || Array.isArray(use)) throw new Plain(`SLATEBOX_AI_CONFIG use must be an object of ${USE.join(', ')}`)
    for (const [feature, choice] of Object.entries(use)) {
      if (!USE.includes(feature)) throw new Plain(`SLATEBOX_AI_CONFIG use: ${feature.slice(0, 40)} is not a feature (${USE.join(', ')})`)
      if (choice !== 'builtin' && !ai.connections[choice]) throw new Plain(`SLATEBOX_AI_CONFIG use.${feature}: ${String(choice).slice(0, 40)} is not one of the connections (or builtin)`)
      if (choice !== 'builtin') {
        const talks = Boolean(TYPES[ai.connections[choice].type]?.voice)
        if (talks && !VOICE_USE.includes(feature)) throw new Plain(`SLATEBOX_AI_CONFIG use.${feature}: ${choice} is a voice connection; choose it for ${VOICE_USE.join(', ')} only`)
        if (!talks && VOICE_USE.includes(feature)) throw new Plain(`SLATEBOX_AI_CONFIG use.${feature}: ${choice} cannot talk; choose an openai-realtime or gemini-live connection for it`)
      }
      ai.use[feature] = choice
    }
    const fromConfig = switchValue(config.ownProviders, 'SLATEBOX_AI_CONFIG ownProviders')
    if (fromConfig) ai.ownProviders = fromConfig
    const privateFromConfig = switchValue(config.privateEndpoints, 'SLATEBOX_AI_CONFIG privateEndpoints')
    if (privateFromConfig) ai.privateEndpoints = privateFromConfig
  }
  const rawProviders = setting('SLATEBOX_AI_PROVIDERS')
  const chosenDefault = setting('SLATEBOX_AI_DEFAULT')
  let keyVariables = []
  if (rawProviders) {
    const listed = providersFrom(rawProviders, setting, ai)
    keyVariables = listed.keyVariables
    if (chosenDefault) {
      if (!listed.names.includes(chosenDefault)) throw new Plain(`SLATEBOX_AI_DEFAULT: ${chosenDefault.slice(0, 40)} is not one of SLATEBOX_AI_PROVIDERS (${listed.names.join(', ')})`)
      ai.use.default = chosenDefault
    } else if (listed.names.length === 1 && !ai.use.default) {
      ai.use.default = listed.names[0]
    } else if (!ai.use.default) {
      throw new Plain(`SLATEBOX_AI_PROVIDERS lists ${listed.names.length} providers: set SLATEBOX_AI_DEFAULT to the one every feature uses (${listed.names.join(', ')})`)
    }
  } else if (chosenDefault) {
    throw new Plain('SLATEBOX_AI_DEFAULT only applies together with SLATEBOX_AI_PROVIDERS')
  }
  if (own) ai.ownProviders = own
  if (privateEndpoints) ai.privateEndpoints = privateEndpoints

  const names = Object.keys(ai.connections)
  const settings = names.length || Object.keys(ai.use).length || ai.ownProviders || ai.privateEndpoints ? ai : null
  const deepInfraKey = url ? undefined : key
  const on = Boolean(names.length || deepInfraKey)
  const summary = []
  if (!on) {
    summary.push('AI drafts: off (set SLATEBOX_AI_URL and SLATEBOX_AI_MODEL, SLATEBOX_AI_PROVIDERS, SLATEBOX_AI_CONFIG or SLATEBOX_AI_KEY to turn them on)')
  } else {
    const listed = names.map((name) => `${hostOf(ai.connections[name])} (${name}${ai.connections[name].model ? `, ${ai.connections[name].model}` : ''})`)
    const uses = Object.entries(ai.use).map(([feature, name]) => `${feature}: ${name}`)
    summary.push(`AI drafts: on, using ${[...listed, ...(deepInfraKey ? ['DeepInfra'] : [])].join(', ')}${uses.length ? `; ${uses.join(', ')}` : ''}`)
  }
  summary.push(ai.ownProviders === 'off'
    ? 'Own AI:    off, people use the AI set here (SLATEBOX_AI_OWN_PROVIDERS=off)'
    : 'Own AI:    on, people may connect their own models and keys (SLATEBOX_AI_OWN_PROVIDERS=off turns this off)')
  if (ai.privateEndpoints === 'off' && ai.ownProviders !== 'off') summary.push('           people\'s own AI may use public addresses only (SLATEBOX_AI_PRIVATE_ENDPOINTS=off)')
  return { settings, deepInfraKey, legacy, on, summary, keyVariables }
}

// ---------- slatebox ai check ----------
const PROBE = { model: null, max_tokens: 64, stream: false, messages: [{ role: 'user', content: 'Call the ping tool with ok set to true.' }],
  tools: [{ type: 'function', function: { name: 'ping', description: 'Call this tool to answer.', parameters: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } } }], tool_choice: 'auto' }

async function call(url, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal })
    let json = null
    try { json = await response.json() } catch {}
    return { status: response.status, ok: response.ok, json }
  } catch (error) {
    return { status: null, error: error.name === 'AbortError' ? 'timeout' : 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

/** One line per connection of settings.ai: reachable, key accepted, model listed, answers, calls tools. Never a key. */
export async function checkConnections(ai, { timeoutMs = 20000 } = {}) {
  const lines = []
  for (const [name, connection] of Object.entries(ai?.connections || {})) {
    // a voice connection speaks a realtime socket, not this check's requests: it is tried by talking
    if (TYPES[connection.type]?.voice) {
      lines.push(`${name}: a voice connection (${connection.model || 'no model'}); try it by talking with the agent`)
      continue
    }
    const base = (connection.baseUrl || TYPES[connection.type]?.baseUrl || '').replace(/\/+$/, '')
    const anthropic = connection.type === 'anthropic'
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json',
      ...(anthropic ? { 'x-api-key': connection.apiKey || '', 'anthropic-version': '2023-06-01' } : connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {}) }
    const listed = await call(`${base}/models`, { method: 'GET', headers }, timeoutMs)
    if (listed.status === null) {
      const hint = /\/\/(localhost|127\.)/.test(base) ? ' (inside the container localhost is the container itself; use host.docker.internal for a model on the host)' : ''
      lines.push(`${name}: could not reach ${base}${listed.error === 'timeout' ? ' in time' : ''}${hint}`)
      continue
    }
    if (listed.status === 401 || listed.status === 403) {
      lines.push(`${name}: the endpoint did not accept the key`)
      continue
    }
    const ids = Array.isArray(listed.json?.data) ? listed.json.data.map((m) => m?.id) : null
    const listedNote = !ids ? 'no model list' : connection.model && ids.includes(connection.model) ? `${connection.model} listed` : `${connection.model || 'no model'} not listed`
    if (!connection.model) {
      lines.push(`${name}: connected, ${listedNote}`)
      continue
    }
    const body = anthropic
      ? { model: connection.model, max_tokens: 64, messages: PROBE.messages, tools: [{ name: 'ping', description: 'Call this tool to answer.', input_schema: PROBE.tools[0].function.parameters }] }
      : { ...PROBE, model: connection.model }
    const chat = await call(`${base}/${anthropic ? 'messages' : 'chat/completions'}`, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs)
    if (!chat.ok) {
      lines.push(`${name}: reached, ${listedNote}, but the model did not answer (HTTP ${chat.status ?? 'none'})`)
      continue
    }
    const tools = anthropic ? chat.json?.content?.some?.((part) => part.type === 'tool_use') : Boolean(chat.json?.choices?.[0]?.message?.tool_calls?.length)
    lines.push(`${name}: connected, ${listedNote}, ${tools ? 'calls tools' : 'answered without calling the test tool (canvas features may not work with it)'}`)
  }
  if (!lines.length) lines.push('No server AI connections are set (SLATEBOX_AI_URL or SLATEBOX_AI_CONFIG).')
  return lines
}
