// ai-control-002: every model key lives in the backend, and providers, models and the one choice
// per part of Slatebox are data in AI control. Two parts, both before the first AI call
// (ai-control/index.mjs aiReady):
//
// 1. Key import (every boot, idempotent, no marker): each model key still found in the settings
//    file (or the environment variable a settings entry names, or API_KEY_DEEP_INFRA, or the voice
//    providers' API_KEY_OPENAI_REALTIME and API_KEY_GEMINI_LIVE) is sealed into
//    providerKeys under SLATEBOX_KEY_ENCRYPTION_KEY, as its provider's active key, unless the
//    backend already holds that key (in any status: a revoked key is never brought back) or holds
//    another active key for the provider (the backend wins). Each move is logged once with the
//    settings path to remove; the key is never logged. A key that cannot be stored (no encryption
//    key, the database refused) is used from memory for this boot only and shown in red on the
//    admin page. After this, nothing reads a key from the settings file.
//
// 2. Catalogue import (once per database, marker migration:ai-control-002): the providers and
//    models today's routing needs, the default binding (Meta Muse Ember), and a binding for each
//    part whose answer today differs from what the default would give it (on Slatebox Cloud:
//    shapes and reading images stay on their DeepInfra models). Older AI control documents
//    (bindings with model chains, models named by connection, server connections, the server's
//    choices, binding versions) are converted and removed. Before the marker is set, every part is
//    resolved with the new resolver and compared with today's answer; on any difference nothing is
//    written and the next boot tries again.
//
// Pure apart from the injected collections, stores and log.
import { followChain } from '../ai-control/catalogue.mjs'
import { BINDABLE_SURFACES } from '../ai-control/bindings.mjs'
import { buildSnapshot, capabilityGap, modelId } from '../ai-control/snapshot.mjs'
import { resolveModel } from '../ai-control/resolve.mjs'
import { BUILTIN_DEFAULT, PROVIDER_PRESETS, presetForUrl, providerFromPreset } from '../ai-control/provider-presets.mjs'
import { BUILTIN_PROVIDERS, normalizeProvider } from '../ai-control/providers.mjs'
import { keyFingerprint } from '../ai-control/keys.mjs'
import { open as openKey, seal } from '../metering/vault.mjs'

export const AI_CONTROL_002 = 'migration:ai-control-002'
export const SYSTEM_ACTOR = Object.freeze({ userId: null, principal: 'system', via: 'system' })
const REASON = 'Moved into AI control (ai-control-002)'

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)
// The capability flags a settings-file or server connection set (tools, vision, images), as a model row keeps them.
const CAPABILITY_FLAGS = ['tools', 'vision', 'images']
const flagsOf = (caps) => (isObject(caps) ? Object.fromEntries(CAPABILITY_FLAGS.filter((k) => typeof caps[k] === 'boolean').map((k) => [k, caps[k]])) : {})
const hostOf = (url) => {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}

// ---------- 1. the keys in the settings file ----------

// A settings-file connection's provider: the named preset its address belongs to (api.meta.ai →
// meta), the preset its type names, or an Other provider named like the connection.
function providerForConnection(name, raw) {
  const byUrl = raw.baseUrl ? presetForUrl(raw.baseUrl) : null
  if (byUrl) return { preset: byUrl.id, id: byUrl.id }
  if (PROVIDER_PRESETS[raw.type]?.baseUrlLocked && !raw.baseUrl) return { preset: raw.type, id: raw.type }
  if (raw.baseUrl) return { preset: 'other', id: name, baseUrl: String(raw.baseUrl).replace(/\/+$/, '') }
  return null
}

/**
 * Every model key the settings file (or the environment) still holds, with where it is and which
 * provider it belongs to. Values never leave this list except into the key store.
 * → [{ path, provider, preset?, baseUrl?, model?, value, source, aux? }] and skipped [{ path, why }]
 */
export function settingsKeySources(settings = {}, env = {}) {
  const found = []
  const skipped = []
  for (const [name, raw] of Object.entries(settings?.ai?.connections || {})) {
    if (!isObject(raw)) continue
    const value = text(raw.apiKey) || (raw.apiKeyEnv ? text(env[raw.apiKeyEnv]) : null)
    const path = raw.apiKey ? `ai.connections.${name}.apiKey` : `ai.connections.${name}.apiKeyEnv (${raw.apiKeyEnv})`
    if (!value) continue
    const provider = providerForConnection(name, raw)
    if (!provider) {
      skipped.push({ path, why: 'it names no address Slatebox knows' })
      continue
    }
    found.push({ path, provider: provider.id, preset: provider.preset, ...(provider.baseUrl && { baseUrl: provider.baseUrl }), ...(text(raw.model) && { model: text(raw.model) }), value, source: 'settings-import', connection: name })
  }
  const top = [
    ['openai.apiKey', settings?.openai?.apiKey, 'openai'],
    ['anthropic.apiKey', settings?.anthropic?.apiKey, 'anthropic'],
    ['deepinfra.apiKey', settings?.deepinfra?.apiKey, 'deepinfra'],
    ['openrouter.apiKey', settings?.openrouter?.apiKey, 'openrouter'],
  ]
  for (const [path, value, preset] of top) if (text(value)) found.push({ path, provider: preset, preset, value: text(value), source: 'settings-import' })
  if (text(env.API_KEY_DEEP_INFRA)) found.push({ path: 'the environment variable API_KEY_DEEP_INFRA', provider: 'deepinfra', preset: 'deepinfra', value: text(env.API_KEY_DEEP_INFRA), source: 'env-import' })
  // the voice providers' keys (server/voice): their realtime presets, by variable
  for (const [variable, preset] of [['API_KEY_OPENAI_REALTIME', 'openai-realtime'], ['API_KEY_GEMINI_LIVE', 'gemini-live']]) {
    if (text(env[variable])) found.push({ path: `the environment variable ${variable}`, provider: preset, preset, value: text(env[variable]), source: 'env-import' })
  }
  if (text(settings?.stabilityai?.apiKey)) found.push({ path: 'stabilityai.apiKey', provider: 'stability', value: text(settings.stabilityai.apiKey), source: 'settings-import', aux: true })
  if (text(settings?.llama?.apiKey)) skipped.push({ path: 'llama.apiKey', why: 'it is a Llama API key, which Slatebox does not use' })
  return { found, skipped }
}

/**
 * Moves every key settingsKeySources finds into the backend. deps: { settings, env, keys
 * (keys.mjs), catalog (models.mjs createCatalogOps: ensureProvider), log, health?(entry) }.
 * → { moved, kept, ignored, revoked, failed, skipped } (each a list of { provider, path, fingerprint? })
 */
export async function importSettingsKeys({ settings, env = {}, keys, catalog, log = console, health = () => {} }) {
  const { found, skipped } = settingsKeySources(settings, env)
  const report = { moved: [], kept: [], ignored: [], revoked: [], failed: [], skipped }
  for (const entry of skipped) log.info?.(`ai-control-002: settings.${entry.path} is not moved: ${entry.why}`)
  for (const entry of found) {
    const fingerprint = keyFingerprint(entry.value)
    const where = entry.path.startsWith('the ') ? entry.path : `settings.${entry.path}`
    const item = { provider: entry.provider, path: entry.path, fingerprint }
    try {
      if (!entry.aux) await catalog.ensureProvider({ actor: SYSTEM_ACTOR, preset: entry.preset, id: entry.provider, baseUrl: entry.baseUrl ?? null, reason: REASON, trusted: true })
      const same = await keys.findByFingerprint(entry.provider, fingerprint)
      if (same?.status === 'revoked') {
        // never answers again, not even from memory
        keys.forgetFromSettings(entry.provider)
        report.revoked.push(item)
        log.warn?.(`ai-control-002: ${where} still holds a ${entry.provider} key (${fingerprint}) that was revoked in Admin → AI control. It is not used; remove it from ${where.startsWith('the ') ? 'the environment' : 'the settings file'}.`)
        health({ kind: 'keys-settings', id: entry.provider, problem: `${where} still holds a key you revoked (${fingerprint}). It is not used; remove it there.` })
        continue
      }
      if (same) {
        report.kept.push(item)
        log.info?.(`ai-control-002: the ${entry.provider} key in ${where} (${fingerprint}) is already in the backend; you can remove ${where} now`)
        continue
      }
      const active = await keys.activeOf(entry.provider)
      if (active) {
        report.ignored.push(item)
        log.warn?.(`ai-control-002: the backend has its own ${entry.provider} key (${active.keyFingerprint}); the key in ${where} (${fingerprint}) is ignored, remove it`)
        continue
      }
      try {
        await keys.add({ actor: SYSTEM_ACTOR, provider: entry.provider, apiKey: entry.value, source: entry.source, action: 'ai.keys.import', label: `From ${entry.path}`.slice(0, 80) })
      } catch (error) {
        // another server moved it a moment ago (the unique index): it is in the backend. Any other
        // refusal (an older index the key collides with) means it is not, and it is kept from memory.
        if (error?.status === 409 && await keys.findByFingerprint(entry.provider, fingerprint)) {
          report.kept.push(item)
          continue
        }
        throw error
      }
      keys.forgetFromSettings(entry.provider)
      report.moved.push(item)
      log.info?.(`ai-control-002: moved the ${entry.provider} key (${fingerprint}) from ${where} into the backend; you can remove ${where} now`)
    } catch (error) {
      // never lost for this boot: used from memory, never written or logged
      keys.keepFromSettings(entry.provider, entry.value)
      report.failed.push({ ...item, problem: error.message })
      const label = PROVIDER_PRESETS[entry.preset]?.label || BUILTIN_PROVIDERS[entry.provider]?.label || entry.provider
      log.error?.(`ai-control-002: the ${entry.provider} key in ${where} (${fingerprint}) could not be moved into the backend (${error.message}); it is used from the settings file for now`)
      health({ kind: 'keys-import', id: entry.provider, problem: `The ${label} key in ${where} could not be moved to the backend (${error.message}). Slatebox is using it from the settings file until it is moved. Fix: set SLATEBOX_KEY_ENCRYPTION_KEY and check the database, then restart.` })
    }
  }
  return report
}

// ---------- 2. today's routing, and the catalogue that gives the same answers ----------

// What each part answered with before AI control's data model changed: the built-in model of each
// part (the block of the old built-in defaults it took), unless the settings file's or the
// server's choices named a connection. Kept here, frozen, only to compare.
const OLD_DEFAULTS = Object.freeze({
  presentation: { provider: 'deepinfra', engine: 'google/gemini-3.5-flash' },
  layout: { provider: 'deepinfra', engine: 'Qwen/Qwen3-235B-A22B-Instruct-2507' },
  vision: { provider: 'deepinfra', engine: 'Qwen/Qwen3-235B-A22B-Instruct-2507' },
  welcome: { provider: 'deepinfra', engine: 'Qwen/Qwen3-235B-A22B-Instruct-2507' },
  generation: { provider: 'deepinfra', engine: 'Qwen/Qwen3-235B-A22B-Instruct-2507' },
  shape: { provider: 'deepinfra', engine: 'google/gemini-3.5-flash' },
  library: { provider: 'deepinfra', engine: 'Qwen/Qwen3-235B-A22B-Instruct-2507' },
})
const OLD_BUILTIN_FROM = Object.freeze({
  chat: 'welcome', 'chat.route': 'welcome', generation: 'generation', 'generation.notes': 'generation', presentation: 'presentation',
  vision: 'vision', images: 'stability', shape: 'shape', workshop: 'generation', 'workshop.draft': 'generation', canvas: 'generation',
  'agent.slatebox': 'generation', library: 'library', connectors: 'generation',
})
const builtinFromOf = (surfaceId) => {
  for (const at of followChain(surfaceId)) if (OLD_BUILTIN_FROM[at]) return OLD_BUILTIN_FROM[at]
  return null
}
const useChainOf = (surfaceId) => {
  const chain = followChain(surfaceId)
  return chain.includes('default') ? chain : [...chain, 'default']
}

/**
 * The route each part had: { kind: 'connection', provider, preset, baseUrl, model, keyed, connection }
 * | { kind: 'stability' } | null. inputs: { settings, env, serverUse (the server's saved choices),
 * serverConnections (the server's connection documents, with hasKey), oldBindings ({ [id]: doc }),
 * oldModels ({ [id]: doc }) }
 */
export function oldRoutes({ settings = {}, env = {}, serverUse = {}, serverConnections = [], oldBindings = {}, oldModels = {} }) {
  const fileConnections = Object.fromEntries(Object.entries(settings?.ai?.connections || {}).filter(([, raw]) => isObject(raw)).map(([name, raw]) => [name, raw]))
  const fileUse = {}
  for (const [key, value] of Object.entries(settings?.ai?.use || {})) fileUse[key] = value === 'builtin' ? 'builtin' : `server:${value}`
  const use = { ...fileUse, ...(serverUse || {}) }
  const builtinKeyed = {
    deepinfra: Boolean(text(settings?.deepinfra?.apiKey) || text(env.API_KEY_DEEP_INFRA)),
    openai: Boolean(text(settings?.openai?.apiKey)),
    anthropic: Boolean(text(settings?.anthropic?.apiKey)),
  }
  const connectionRoute = (name, modelOverride = null) => {
    const raw = fileConnections[name]
    if (raw) {
      const p = providerForConnection(name, raw)
      if (!p) return null
      const keyed = Boolean(text(raw.apiKey) || (raw.apiKeyEnv && text(env[raw.apiKeyEnv])))
      return { kind: 'connection', provider: p.id, preset: p.preset, baseUrl: p.baseUrl || PROVIDER_PRESETS[p.preset].baseUrl, model: modelOverride || text(raw.model), keyed, connection: name, capabilities: flagsOf(raw.capabilities) }
    }
    const doc = serverConnections.find((c) => c.name === name)
    if (!doc) return null
    const p = providerForConnection(name, { type: doc.provider, baseUrl: doc.baseUrl })
    if (!p) return null
    return { kind: 'connection', provider: p.id, preset: p.preset, baseUrl: p.baseUrl || PROVIDER_PRESETS[p.preset].baseUrl, model: modelOverride || doc.model || null, keyed: Boolean(doc.hasKey), connection: name, capabilities: flagsOf(doc.capabilities) }
  }
  const builtinRoute = (surfaceId) => {
    const from = builtinFromOf(surfaceId)
    if (from === 'stability') return { kind: 'stability' }
    const config = { ...(OLD_DEFAULTS[from] || {}), ...(settings?.ai?.features?.[from] || {}) }
    const preset = PROVIDER_PRESETS[config.provider]
    if (!preset || !config.engine) return null
    return { kind: 'connection', provider: preset.id, preset: preset.id, baseUrl: preset.baseUrl, model: config.engine, keyed: builtinKeyed[preset.id] ?? false, connection: 'builtin' }
  }
  const entryRoute = (entry, surfaceId) => {
    if (!entry) return null
    if (entry.model) {
      const row = oldModels[entry.model]
      if (!row) return null
      const [scope, name] = String(row.connection || '').split(':')
      if (scope === 'builtin') {
        const preset = PROVIDER_PRESETS[name]
        return preset ? { kind: 'connection', provider: preset.id, preset: preset.id, baseUrl: preset.baseUrl, model: row.model, keyed: builtinKeyed[name] ?? false, connection: 'builtin' } : null
      }
      return connectionRoute(name, row.model)
    }
    if (entry.connection === 'builtin') return builtinRoute(surfaceId)
    return connectionRoute(String(entry.connection || '').replace(/^server:/, ''))
  }
  const out = {}
  for (const id of BINDABLE_SURFACES) {
    if (id === 'default') continue
    let route
    let found = false
    for (const at of useChainOf(id)) {
      const doc = oldBindings[`${at}|server`]
      if (doc?.enabled === false) {
        route = { kind: 'off' }
        found = true
        break
      }
      if (Array.isArray(doc?.chain) && doc.chain.length) {
        route = entryRoute(doc.chain[0], id)
        found = true
        break
      }
    }
    if (!found) {
      const key = useChainOf(id).find((at) => use[at])
      const ref = key ? use[key] : null
      route = ref && ref !== 'builtin' ? connectionRoute(ref.replace(/^server:/, '')) : builtinRoute(id)
    }
    out[id] = route ?? null
  }
  // what "everything not set" answered with: the server's own default binding or choice of a
  // connection (a self-hosted server set up with one model for everything), else nothing
  const defaultDoc = oldBindings['default|server']
  if (defaultDoc?.enabled !== false && Array.isArray(defaultDoc?.chain) && defaultDoc.chain.length) out.default = entryRoute(defaultDoc.chain[0], 'default')
  else if (use.default && use.default !== 'builtin') out.default = connectionRoute(String(use.default).replace(/^server:/, ''))
  else out.default = null
  if (out.default?.kind !== 'connection') out.default = null
  return out
}

const sameRoute = (a, b) => Boolean(a && b) && hostOf(a.baseUrl) === hostOf(b.baseUrl) && a.model === b.model

/**
 * The providers, models and bindings that answer every part as it was answered (the parts whose
 * route had a key; a route without one could not answer, so it follows the default). → { providers:
 * { [id]: doc }, models: { [id]: doc }, bindings: { [surface]: doc }, expected: { [surface]: route } }
 */
export function planCatalogue(routes) {
  const providers = {}
  const models = {}
  const bindings = {}
  const addProvider = (route) => {
    if (!providers[route.provider]) {
      const row = providerFromPreset(route.preset, { id: route.provider, baseUrl: route.baseUrl })
      providers[route.provider] = normalizeProvider(row)
    }
    return providers[route.provider]
  }
  const addModel = (route) => {
    const id = modelId(route.provider, route.model)
    if (!models[id]) {
      const suggestion = PROVIDER_PRESETS[route.preset]?.models.find((m) => m.model === route.model)
      models[id] = { _id: id, provider: route.provider, model: route.model, label: suggestion?.label ?? null, capabilities: { ...(suggestion?.capabilities || { tools: true }), ...(route.capabilities || {}) }, maxOutput: null, prices: suggestion?.prices ? { ...suggestion.prices } : null, status: 'enabled' }
    }
    return id
  }
  // the default: Meta Muse Ember, the owner's choice, unless the server answered everything not set
  // with a model of its own (a self-hosted server's one model for everything), which stays its default
  const ember = { provider: BUILTIN_DEFAULT.preset, preset: BUILTIN_DEFAULT.preset, baseUrl: PROVIDER_PRESETS.meta.baseUrl, model: BUILTIN_DEFAULT.model }
  addProvider(ember)
  const emberId = addModel(ember)
  const own = routes.default?.kind === 'connection' && routes.default.keyed && routes.default.model ? routes.default : null
  if (own) addProvider(own)
  bindings.default = { _id: 'default', surface: 'default', use: 'model', model: own ? addModel(own) : emberId }
  const expected = {}
  const snapshotOf = () => buildSnapshot({ providers: Object.values(providers), models: Object.values(models), bindings: Object.values(bindings) })
  for (const id of BINDABLE_SURFACES) {
    if (id === 'default') continue
    const route = routes[id]
    if (!route) continue
    if (route.kind === 'off') {
      bindings[id] = { _id: id, surface: id, use: 'off' }
      expected[id] = { off: true }
      continue
    }
    // generated pictures with nothing set use the built-in image service, as before
    if (route.kind === 'stability') continue
    if (!route.keyed || !route.model) continue
    // a model that cannot do what the part needs (a chat model chosen for everything, asked to draw
    // pictures) never answered it: the part keeps what it does with nothing set
    if (capabilityGap(id, { capabilities: { ...(PROVIDER_PRESETS[route.preset]?.models.find((m) => m.model === route.model)?.capabilities || { tools: true }), ...(route.capabilities || {}) } })) continue
    expected[id] = route
    const now = resolveModel(snapshotOf(), { surface: id }).route
    if (sameRoute(now, route)) continue
    addProvider(route)
    bindings[id] = { _id: id, surface: id, use: 'model', model: addModel(route) }
  }
  return { providers, models, bindings, expected }
}

/** Every part whose answer under the plan differs from today's. → [{ surface, was, now }] */
export function selfCheck(plan) {
  const snap = buildSnapshot({ providers: Object.values(plan.providers), models: Object.values(plan.models), bindings: Object.values(plan.bindings) })
  const differences = []
  if (snap.health.length) for (const h of snap.health) differences.push({ surface: h.id, was: 'valid', now: h.problem })
  for (const [id, was] of Object.entries(plan.expected)) {
    const resolved = resolveModel(snap, { surface: id })
    if (was.off) {
      if (resolved.enabled) differences.push({ surface: id, was: 'off', now: 'on' })
      continue
    }
    if (!sameRoute(resolved.route, was)) differences.push({ surface: id, was: `${hostOf(was.baseUrl)} ${was.model}`, now: resolved.route ? `${hostOf(resolved.route.baseUrl)} ${resolved.route.model}` : resolved.source })
  }
  return differences
}

/**
 * The catalogue import, once per database. deps: {
 *   raw: { providers, models, bindings, bindingVersions?, state, keys (providerKeys), choices (aiChoices) }
 *   store (store.mjs: write, record), master, settings, env, log, health?(entry), drop?(name) drops a collection
 * } → { done: boolean, written?, differences?, converted? }
 */
export async function runAIControl002({ raw, store, master, settings = {}, env = {}, log = console, health = () => {}, drop = null }) {
  if (await raw.state.findOne({ _id: AI_CONTROL_002 })) return { done: false, already: true }
  const serverConnections = (await raw.keys.find({ ownerType: 'server', ownerId: 'server', name: { $type: 'string' } }).toArray())
  const oldBindings = Object.fromEntries((await raw.bindings.find({}).toArray()).filter((doc) => String(doc._id).includes('|')).map((doc) => [doc._id, doc]))
  const oldModels = Object.fromEntries((await raw.models.find({}).toArray()).filter((doc) => doc.connection).map((doc) => [doc._id, doc]))
  const serverChoices = await raw.choices.findOne({ _id: 'server:server' })
  const serverUse = Object.fromEntries(Object.entries(serverChoices?.use || {}).map(([key, ref]) => [key.replaceAll('__', '.'), ref]))
  const routes = oldRoutes({
    settings, env, serverUse, oldBindings, oldModels,
    serverConnections: serverConnections.filter((doc) => !BUILTIN_PROVIDERS[doc.provider]).map((doc) => ({ name: doc.name, provider: doc.provider, baseUrl: doc.baseUrl, model: doc.model, hasKey: Boolean(doc.cipher && doc.last4) })),
  })
  const plan = planCatalogue(routes)
  const differences = selfCheck(plan)
  if (differences.length) {
    log.error?.(`ai-control-002: nothing was written; these parts would answer differently: ${differences.map((d) => `${d.surface} (${d.was} → ${d.now})`).join('; ')}`)
    health({ kind: 'migration', id: 'ai-control-002', problem: `The move to the new AI control was not made: ${differences.map((d) => `${d.surface} would change from ${d.was} to ${d.now}`).join('; ')}. It is tried again at the next start.` })
    return { done: false, differences }
  }
  const actor = SYSTEM_ACTOR
  const written = { providers: [], models: [], bindings: [] }
  for (const doc of Object.values(plan.providers)) {
    const existing = await raw.providers.findOne({ _id: doc._id })
    if (existing && existing.preset) continue
    const { _id, ...rest } = doc
    await store.write({ kind: 'providers', id: _id, doc: { ...rest, version: (existing?.version ?? 0) + 1 }, action: 'ai.providers.add', actor, reason: REASON })
    written.providers.push(_id)
  }
  for (const doc of Object.values(plan.models)) {
    const existing = await raw.models.findOne({ _id: doc._id })
    if (existing && existing.provider) continue
    const { _id, ...rest } = doc
    await store.write({ kind: 'models', id: _id, doc: { ...rest, version: 1 }, action: 'ai.models.save', actor, reason: REASON })
    written.models.push(_id)
  }
  // the older documents go once their routes are in place
  const converted = { bindings: [], models: [], connections: [], choices: false, versions: 0 }
  for (const id of Object.keys(oldBindings)) {
    await store.write({ kind: 'bindings', id, doc: null, action: 'ai.bindings.remove', actor, reason: REASON })
    converted.bindings.push(id)
  }
  for (const doc of Object.values(plan.bindings)) {
    const { _id, ...rest } = doc
    await store.write({ kind: 'bindings', id: _id, doc: { ...rest, version: 1 }, action: 'ai.bindings.set', actor, reason: REASON, target: { kind: 'binding', id: _id } })
    written.bindings.push(_id)
  }
  for (const id of Object.keys(oldModels)) {
    if (plan.models[id]) continue
    await store.write({ kind: 'models', id, doc: null, action: 'ai.models.remove', actor, reason: REASON })
    converted.models.push(id)
  }
  // the server's connections: each key becomes a key of its provider (sealed again when the
  // provider's id differs), the connection document goes
  for (const doc of serverConnections) {
    const provider = BUILTIN_PROVIDERS[doc.provider] ? doc.provider : providerForConnection(doc.name, { type: doc.provider, baseUrl: doc.baseUrl })?.id
    if (provider && doc.cipher && doc.last4 && master) {
      try {
        const value = openKey({ master, owner: { ownerType: 'server', ownerId: 'server', provider: doc.provider }, cipher: doc.cipher })
        const fingerprint = keyFingerprint(value)
        const exists = await raw.keys.findOne({ ownerType: 'server', ownerId: 'server', kind: 'key', provider, keyFingerprint: fingerprint })
        if (!exists) {
          if (!BUILTIN_PROVIDERS[provider] && !(await raw.providers.findOne({ _id: provider }))) {
            const p = providerForConnection(doc.name, { type: doc.provider, baseUrl: doc.baseUrl })
            const row = normalizeProvider(providerFromPreset(p.preset, { id: p.id, baseUrl: p.baseUrl }))
            const { _id, ...rest } = row
            await store.write({ kind: 'providers', id: _id, doc: { ...rest, version: 1 }, action: 'ai.providers.add', actor, reason: REASON })
          }
          const active = await raw.keys.findOne({ ownerType: 'server', ownerId: 'server', kind: 'key', provider, status: 'active' })
          const at = new Date()
          await raw.keys.insertOne({
            _id: `key-${doc._id}`, ownerType: 'server', ownerId: 'server', kind: 'key', provider, status: active || doc.status === 'disabled' ? 'standby' : 'active',
            cipher: seal({ master, owner: { ownerType: 'server', ownerId: 'server', provider }, plaintext: value }), last4: value.slice(-4), keyFingerprint: fingerprint,
            label: `From the connection ${doc.name}`, source: 'connection-import', ...(BUILTIN_PROVIDERS[provider] && doc.model && { model: doc.model }),
            createdAt: at, createdBy: null, activatedAt: active ? null : at, revokedAt: null, revokedBy: null, lastTest: doc.lastCheck ?? null, lastUsedAt: null,
          })
          await store.record({ action: 'ai.keys.import', actor, target: { kind: 'key', id: provider }, after: { provider, keyFingerprint: fingerprint, source: 'connection-import' }, reason: REASON })
        }
      } catch (error) {
        log.warn?.(`ai-control-002: the key of the server connection ${doc.name} could not be moved (${error.message}); add it again in Admin → AI control`)
      }
    }
    await raw.keys.deleteOne({ _id: doc._id })
    converted.connections.push(doc.name)
  }
  if (serverChoices?.use) {
    const { use: _use, ...rest } = serverChoices
    await raw.choices.replaceOne({ _id: 'server:server' }, rest)
    converted.choices = true
  }
  if (raw.bindingVersions) {
    const versions = await raw.bindingVersions.find({}).toArray()
    if (versions.length) {
      const summary = versions.map((v) => ({ bindingId: v.bindingId, version: v.version, status: v.status, at: v.createdAt ?? v.publishedAt ?? null, by: v.createdBy ?? v.publishedBy ?? null, note: v.note ?? null }))
      await store.record({ action: 'ai.bindings.history', actor, target: { kind: 'binding', id: 'all' }, after: { versions: summary.slice(0, 500) }, reason: 'Binding versions are no longer kept; their summary is kept here (ai-control-002)' })
      converted.versions = versions.length
    }
    if (drop) await drop('aiBindingVersions').catch(() => {})
  }
  await raw.state.updateOne({ _id: AI_CONTROL_002 }, { $set: { at: new Date(), written, converted } }, { upsert: true })
  log.info?.(`ai-control-002: the AI catalogue is in place (default ${modelId(BUILTIN_DEFAULT.preset, BUILTIN_DEFAULT.model)}; bindings ${written.bindings.join(', ') || 'none'})`)
  return { done: true, written, converted }
}

