// AI providers as the installer stores them, and as the image takes them.
//
// The installer never picks a provider. A person gives any mix: a cloud key
// (OpenAI, Anthropic, DeepInfra, OpenRouter, Groq, Together, Mistral) or an
// OpenAI-compatible endpoint they run (Ollama, LM Studio, vLLM, a gateway).
// Every kind but DeepInfra is stored as an OpenAI-compatible endpoint with its
// address filled in, so the image needs to know only two kinds.
//
// Images differ in what they accept, and the installer asks the image (see
// image.mjs probeImage). An image that lists SLATEBOX_AI_PROVIDERS takes a
// JSON list and one key variable per provider; an older image takes one
// provider as SLATEBOX_AI_KEY / SLATEBOX_AI_URL / SLATEBOX_AI_MODEL. Key values
// are never written here: secrets hold references (env:NAME, file:/path,
// prompt) that secret-values.mjs reads only when it writes the secrets file.
import { EXIT, InstallError } from '../errors.mjs'

/** The settings every one-container image so far accepts. */
export const LEGACY_SETTINGS = Object.freeze([
  'SLATEBOX_URL', 'SLATEBOX_HTTPS', 'SLATEBOX_ACME_CA', 'SLATEBOX_MAIL_URL', 'SLATEBOX_MAIL_FROM',
  'SLATEBOX_AI_KEY', 'SLATEBOX_AI_URL', 'SLATEBOX_AI_MODEL', 'SLATEBOX_SETTINGS', 'SLATEBOX_SSO', 'SLATEBOX_SSO_ONLY',
  'SLATEBOX_SSO_ADMIN', 'SLATEBOX_KEY_ENCRYPTION_KEY', 'MONGO_URL', 'MONGO_OPLOG_URL',
])

/** Each kind a person may name, with the address it stands for. */
export const PRESETS = Object.freeze({
  openai: Object.freeze({ kind: 'openai-compatible', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true }),
  anthropic: Object.freeze({ kind: 'openai-compatible', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', needsKey: true }),
  deepinfra: Object.freeze({ kind: 'deepinfra', label: 'DeepInfra', baseUrl: 'https://api.deepinfra.com/v1/openai', needsKey: true }),
  openrouter: Object.freeze({ kind: 'openai-compatible', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true }),
  groq: Object.freeze({ kind: 'openai-compatible', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true }),
  together: Object.freeze({ kind: 'openai-compatible', label: 'Together', baseUrl: 'https://api.together.xyz/v1', needsKey: true }),
  mistral: Object.freeze({ kind: 'openai-compatible', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', needsKey: true }),
  ollama: Object.freeze({ kind: 'openai-compatible', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', needsKey: false }),
  lmstudio: Object.freeze({ kind: 'openai-compatible', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', needsKey: false }),
  'openai-compatible': Object.freeze({ kind: 'openai-compatible', label: 'OpenAI-compatible endpoint', baseUrl: null, needsKey: false }),
})

export const PROVIDER_KINDS = Object.freeze(Object.keys(PRESETS))

/**
 * One provider in its stored form: DeepInfra stays DeepInfra; every other kind
 * becomes an OpenAI-compatible endpoint with its address. `vendor` keeps the
 * kind the person named (for labels and the key check). Idempotent.
 */
export function normalizeProvider(provider) {
  const preset = PRESETS[provider?.kind]
  if (!preset) return { ...provider }
  const keyFrom = provider.keyFrom ?? 'none'
  if (preset.kind === 'deepinfra') {
    return { id: provider.id || 'deepinfra', kind: 'deepinfra', ...(provider.model ? { model: provider.model } : {}), keyFrom }
  }
  const vendor = provider.vendor ?? (provider.kind === 'openai-compatible' ? undefined : provider.kind)
  const out = { id: provider.id || provider.kind, kind: 'openai-compatible', baseUrl: provider.baseUrl ?? preset.baseUrl ?? undefined }
  if (out.baseUrl === undefined) delete out.baseUrl
  if (provider.model) out.model = provider.model
  out.keyFrom = keyFrom
  if (provider.toolChoice) out.toolChoice = provider.toolChoice
  if (vendor) out.vendor = vendor
  return out
}

/** Whether this provider cannot work without a key. */
export function needsKey(provider) {
  return Boolean(PRESETS[provider?.vendor ?? provider?.kind]?.needsKey)
}

export function providerLabel(provider) {
  return PRESETS[provider?.vendor ?? provider?.kind]?.label ?? provider?.kind ?? 'AI'
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

// An endpoint on this computer is reached from inside the container through
// Docker's host gateway. On Kubernetes "localhost" is the pod itself: refused.
function locate(baseUrl, target, notes) {
  let url
  try { url = new URL(baseUrl) } catch { return { baseUrl, gateway: false } }
  if (!LOOPBACK.has(url.hostname)) return { baseUrl, gateway: false }
  if (target === 'k8s' || target === 'export-k8s') {
    throw new InstallError(EXIT.USAGE, `The AI endpoint ${baseUrl} is on localhost, which inside a pod is the pod itself. Give the endpoint's Service address, for example http://ollama.ai.svc:11434/v1.`)
  }
  url.hostname = 'host.docker.internal'
  const located = url.href.replace(/\/$/, baseUrl.endsWith('/') ? '/' : '')
  notes.push(`${baseUrl} is on this computer: the container reaches it as ${located} (host.docker.internal). Make sure the endpoint listens on an address Docker can reach, not only 127.0.0.1.`)
  return { baseUrl: located, gateway: true }
}

const keyVariable = id => `SLATEBOX_AI_KEY_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`

/**
 * The settings and secret references for the AI answers, in the form this image takes.
 * @param {{mode: string, providers?: object[], default?: string}} ai
 * @param {{settings: string[]}|null} caps what the image accepts (null: an older image)
 * @param {{target: string}} where
 * @returns {{env: Record<string,string>, secrets: Record<string,string>, notes: string[], hostGateway: boolean}}
 */
export function aiEnv(ai, caps, { target } = {}) {
  const out = { env: {}, secrets: {}, notes: [], hostGateway: false }
  if (!ai || ai.mode !== 'providers' || !ai.providers?.length) return out
  const providers = ai.providers.map(normalizeProvider)
  const multi = Boolean(caps?.settings?.includes('SLATEBOX_AI_PROVIDERS'))
  if (!multi) {
    if (providers.length > 1) {
      throw new InstallError(EXIT.USAGE, `This Slatebox image supports one AI provider at a time; ${providers.length} were given (${providers.map(provider => provider.id).join(', ')}). Keep one, or use a newer image.`)
    }
    const [provider] = providers
    if (provider.kind === 'deepinfra') {
      if (provider.keyFrom !== 'none') out.secrets.SLATEBOX_AI_KEY = provider.keyFrom
      return out
    }
    const { baseUrl, gateway } = locate(provider.baseUrl, target, out.notes)
    out.hostGateway = gateway
    out.env.SLATEBOX_AI_URL = baseUrl
    if (provider.model) out.env.SLATEBOX_AI_MODEL = provider.model
    if (provider.keyFrom !== 'none') out.secrets.SLATEBOX_AI_KEY = provider.keyFrom
    return out
  }
  const list = providers.map(provider => {
    const entry = { id: provider.id, kind: provider.kind }
    if (provider.kind !== 'deepinfra') {
      const { baseUrl, gateway } = locate(provider.baseUrl, target, out.notes)
      if (gateway) out.hostGateway = true
      entry.baseUrl = baseUrl
    }
    if (provider.model) entry.model = provider.model
    if (provider.toolChoice) entry.toolChoice = provider.toolChoice
    if (provider.keyFrom !== 'none') {
      entry.keyEnv = keyVariable(provider.id)
      out.secrets[entry.keyEnv] = provider.keyFrom
    }
    return entry
  })
  out.env.SLATEBOX_AI_PROVIDERS = JSON.stringify(list)
  if (ai.default) out.env.SLATEBOX_AI_DEFAULT = ai.default
  return out
}

/**
 * What an image accepts, from `slatebox settings --json`, or (older images)
 * from configure.mjs refusing an unknown setting and the command usage text.
 * @returns {{settings: string[], commands: string[], source: string}|null}
 */
export function capabilitiesFromProbe({ settingsJson, configureOutput, usage } = {}) {
  if (settingsJson) {
    try {
      const parsed = JSON.parse(settingsJson)
      if (Array.isArray(parsed?.settings)) {
        return { settings: parsed.settings.map(String), commands: Array.isArray(parsed.commands) ? parsed.commands.map(String) : [], source: 'settings --json' }
      }
    } catch { /* fall through to the probe */ }
  }
  const listed = /The settings are: (.+?) \(in capitals\)/.exec(configureOutput || '')
  if (!listed) return null
  const settings = listed[1].split(',').map(name => name.trim()).filter(Boolean)
  const commands = []
  for (const match of String(usage || '').matchAll(/docker exec \S+ slatebox ([a-z][a-z-]*)/g)) {
    if (!commands.includes(match[1])) commands.push(match[1])
  }
  return { settings, commands, source: 'probe' }
}

/**
 * A script run with node inside the container, arguments [baseUrl, model, keyEnv]:
 * lists models, asks for one forced tool call, and prints one JSON line. The
 * key is read from the container's environment, never passed as an argument.
 */
export function aiTestScript() {
  return `
const [baseUrl, model, keyEnv] = process.argv.slice(2)
const key = keyEnv ? process.env[keyEnv] : ''
const headers = { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) }
const root = baseUrl.replace(/\\/$/, '')
const report = { baseUrl, models: [], toolCalls: null, toolChoiceHonoured: null, latencyMs: null }
try {
  const listed = await fetch(root + '/models', { headers, signal: AbortSignal.timeout(15000) })
  report.models = listed.ok ? ((await listed.json()).data || []).map(m => m.id).filter(Boolean) : 'HTTP ' + listed.status
  if (model) {
    const started = Date.now()
    // The same probe as the image's own \`slatebox ai check\`: one forced call of a ping tool.
    const tool = { type: 'function', function: { name: 'ping', description: 'Call this tool to answer.', parameters: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } } }
    const answer = await fetch(root + '/chat/completions', {
      method: 'POST', headers, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Call the ping tool with ok set to true.' }], tools: [tool], tool_choice: { type: 'function', function: { name: 'ping' } }, max_tokens: 64 }),
    })
    report.latencyMs = Date.now() - started
    if (!answer.ok) report.error = 'chat completions answered HTTP ' + answer.status
    else {
      const calls = (await answer.json()).choices?.[0]?.message?.tool_calls || []
      report.toolCalls = calls.length > 0
      report.toolChoiceHonoured = calls.some(call => call.function?.name === 'ping')
    }
  }
} catch (error) {
  report.error = error.name === 'TimeoutError' ? 'the endpoint did not answer in time' : String(error.cause?.code || error.message)
}
console.log(JSON.stringify(report))
`
}
