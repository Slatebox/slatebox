// The one resolver: what a surface uses for one person (its binding), from a snapshot. Pure, so
// the request path, the admin "effective config" view and the tests all run the same code.
//
// Order per field, highest first (spec 2.1):
//   1. DB bindings for the surface: me -> team -> plan -> server (me and team only when own
//      providers are on, as for AI choices today);
//   2. the same for what it follows, up to `default`;
//   3. the AI settings as they work today (connections.mjs resolveAIChoice over the person's,
//      team's and server's choices; the server's choices are the settings file overlaid by what an
//      administrator saved), then settings.ai.features / requestTimeoutMs / providerInfraRetries;
//   4. code: ai-defaults.json through the surface's builtinFrom, the catalogue's estimates and
//      ceilings, the built-in prompt text.
// Merge rules between scopes: chain, prompts and params come from the innermost scope that sets
// them; enabled is AND across scopes (an inner scope can turn a surface off, never on); limits and
// tools.allow only tighten (the lowest limit, the intersection of allow-lists). Team and person
// bindings may set only their models and on/off. A surface with no server or plan binding of its
// own takes the on/off of what it follows, as it takes its models.
//
// With no DB documents (an empty snapshot, or the DB layer switched off) the result is exactly
// what the AI settings resolve today.
import { followChain, rootSurface, surface as surfaceById, surfaceForRequest, builtinFeatureFor } from './catalogue.mjs'
import { resolveAIChoice } from '../methods/ai/connections.mjs'
import { DEFAULT_AI_FEATURES, resolveAIFeatureConfig } from '../methods/ai/feature-config.mjs'
import { EMPTY_SNAPSHOT, parsePromptRef } from './snapshot.mjs'
import { codeFallbackOn } from '../methods/ai/provider.mjs'

export const CODE_PARAMS = Object.freeze({
  temperature: null, maxTokens: null, timeoutMs: 90000, infraRetries: 2, shapeRetries: 3, toolChoice: null,
})
// The failure classes a built-in fallback model is tried for: provider.mjs codeFallbackOn (infra
// and shape for generation and vision, infra elsewhere), by the surface's top-level feature.
const STABILITY = Object.freeze({ provider: 'stabilityai', engine: 'stable-diffusion-v1-6' })

/** A surface id, or a request feature (lane-chat -> workshop), to its surface id; null for built-in-only paths. */
export function toSurface(name) {
  const at = surfaceById(name)
  if (at) return at.builtinOnly ? null : at.id
  return surfaceForRequest(name)
}

// The binding documents that apply to one surface, innermost first.
function scopedDocs(snapshot, surfaceId, { userId, orgId, plan, ownProviders, inner }) {
  const out = []
  const push = (doc, layer) => {
    if (doc) out.push({ doc, layer: `${layer}@v${doc.version ?? 1}` })
  }
  if (ownProviders) {
    if (userId) push(inner?.me?.[surfaceId] ?? snapshot.bindings[`${surfaceId}|me:${userId}`], 'db:me')
    if (orgId) push(inner?.team?.[surfaceId] ?? snapshot.bindings[`${surfaceId}|team:${orgId}`], 'db:team')
  }
  if (plan) push(snapshot.bindings[`${surfaceId}|plan:${plan}`], 'db:plan')
  push(snapshot.bindings[`${surfaceId}|server`], 'db:server')
  return out
}

const isInner = (layer) => layer.startsWith('db:me') || layer.startsWith('db:team')

// A chain entry as the request path reads it (never a key: keys are opened per request). An entry
// names a model registry row ({ model: '<connection>:<model>' }), or a connection with its own model
// ({ connection: 'server:<name>' }), or the surface's built-in model ({ connection: 'builtin' }).
function chainEntry(snapshot, entry, server, surfaceId, settings) {
  if (!entry?.model && entry?.connection) return connectionEntry(snapshot, entry, server, surfaceId, settings)
  const model = snapshot.models[entry.model]
  if (!model) return null
  const [scope, name] = model.connection.split(':')
  const on = entry.on?.length ? [...entry.on] : ['any']
  const base = { model: model.model, modelId: model._id, capabilities: { ...(model.capabilities || {}) }, prices: model.prices ?? null, on }
  if (scope === 'builtin') return { ...base, connection: 'builtin', provider: name, protocol: null, baseUrl: null, keyRef: { kind: 'builtin' } }
  const fromDb = snapshot.connections[name]
  const fromSettings = server?.connections?.find((c) => c.name === name)
  const connection = fromSettings || fromDb
  if (!connection) return null
  const provider = connection.type || connection.provider
  return {
    ...base, connection: `server:${name}`, provider, protocol: snapshot.providers[provider]?.protocol ?? null,
    baseUrl: connection.baseUrl ?? null,
    keyRef: connection.apiKeyEnv ? { kind: 'env', name: connection.apiKeyEnv }
      : connection.source === 'file' && connection.apiKey ? { kind: 'file' }
        : fromDb?.keyRef ?? { kind: connection.hasKey || fromDb?.hasKey ? 'sealed' : 'none' },
  }
}

function connectionEntry(snapshot, entry, server, surfaceId, settings) {
  const on = entry.on?.length ? [...entry.on] : ['any']
  if (entry.connection === 'builtin') {
    const primary = builtinChain(surfaceId, settings).chain[0]
    return primary ? { ...primary, on, builtinDefault: true } : null
  }
  const [scope, name] = String(entry.connection).split(':')
  if (scope !== 'server' || !name) return null
  const fromDb = snapshot.connections[name]
  const fromSettings = server?.connections?.find((c) => c.name === name)
  const connection = fromSettings || fromDb
  if (!connection) return null
  const provider = connection.type || connection.provider
  return {
    connection: `server:${name}`, provider, model: connection.model ?? null, modelId: null,
    protocol: snapshot.providers[provider]?.protocol ?? null, baseUrl: connection.baseUrl ?? null,
    keyRef: connection.apiKeyEnv ? { kind: 'env', name: connection.apiKeyEnv }
      : connection.source === 'file' && connection.apiKey ? { kind: 'file' }
        : fromDb?.keyRef ?? { kind: connection.hasKey || fromDb?.hasKey ? 'sealed' : 'none' },
    capabilities: { ...(connection.capabilities || {}) }, prices: null, on,
  }
}

// The built-in model of a surface (ai-defaults.json via builtinFrom, overlaid by settings.ai.features).
function builtinChain(surfaceId, settings) {
  const from = builtinFeatureFor(surfaceId)
  if (from === 'stability') {
    return { chain: [{ connection: 'builtin', provider: STABILITY.provider, model: STABILITY.engine, protocol: 'stability-images', baseUrl: null, keyRef: { kind: 'builtin' }, capabilities: { images: true }, prices: null, on: ['any'] }], layer: 'code', from }
  }
  if (!from || !DEFAULT_AI_FEATURES[from]) return { chain: [], layer: 'code', from }
  const config = resolveAIFeatureConfig(from, settings)
  const configured = settings?.ai?.features?.[from]
  const layer = configured && ['provider', 'engine', 'fallback'].some((key) => key in configured) ? 'file' : 'code'
  const chain = [{ connection: 'builtin', provider: config.provider ?? null, model: config.engine ?? null, protocol: null, baseUrl: null, keyRef: { kind: 'builtin' }, capabilities: {}, prices: null, on: ['any'] }]
  if (config.fallback) {
    chain.push({
      connection: 'builtin', provider: config.fallback.provider ?? config.provider ?? null, model: config.fallback.engine ?? null,
      protocol: null, baseUrl: null, keyRef: { kind: 'builtin' }, capabilities: {}, prices: null,
      on: [...codeFallbackOn(rootSurface(surfaceId))],
    })
  }
  return { chain, layer, from }
}

// The connection today's AI settings choose (resolveAIChoice), as a chain.
function legacyChain(surfaceId, holders, settings) {
  const { person = null, team = null, server = { connections: [], use: {} }, ownProviders = true, serverUseSource = {} } = holders || {}
  const choice = resolveAIChoice({ feature: surfaceId, person, team, server, ownProviders })
  if (!choice.connection) {
    const built = builtinChain(surfaceId, settings)
    // a choice of "builtin" made in the settings is still the settings' choice
    const chosenBuiltin = choice.scope === 'builtin' && choice.ref === 'builtin' && whereChosen(surfaceId, holders)
    return { ...built, choice, layer: chosenBuiltin || built.layer }
  }
  const c = choice.connection
  const layer = choice.scope === 'server'
    ? (serverUseSource[usedKey(surfaceId, server, choice.ref)] === 'file' ? 'file' : 'db:server:choice')
    : `db:${choice.scope}:choice`
  return {
    choice,
    layer,
    chain: [{
      connection: choice.ref, provider: c.type, model: c.model ?? null, protocol: null, baseUrl: c.baseUrl ?? null,
      // where its key lives: an environment variable, the settings file itself, sealed in the database, or none
      keyRef: c.apiKeyEnv ? { kind: 'env', name: c.apiKeyEnv } : c.source === 'file' && c.apiKey ? { kind: 'file' } : { kind: c.hasKey ? 'sealed' : 'none' },
      capabilities: { ...(c.capabilities || {}) }, prices: null, on: ['any'],
    }],
  }
}

// Which use key of the server's served a surface with this ref (for where a server choice came from).
function usedKey(surfaceId, server, ref) {
  const chain = followChain(surfaceId)
  return (chain.includes('default') ? chain : [...chain, 'default']).find((key) => server?.use?.[key] === ref) ?? null
}
function whereChosen(surfaceId, holders) {
  const { person, team, server, ownProviders = true, serverUseSource = {} } = holders || {}
  const chain = followChain(surfaceId)
  const keys = chain.includes('default') ? chain : [...chain, 'default']
  if (ownProviders && keys.some((k) => person?.use?.[k] === 'builtin')) return 'db:me:choice'
  if (ownProviders && keys.some((k) => team?.use?.[k] === 'builtin')) return 'db:team:choice'
  const key = keys.find((k) => server?.use?.[k])
  if (key && server.use[key] === 'builtin') return serverUseSource[key] === 'file' ? 'file' : 'db:server:choice'
  return null
}

// The lowest value set, with the layer that set it.
const tightestOf = (entries) => entries.reduce((best, entry) => (Number.isFinite(entry.value) && (!best || entry.value < best.value) ? entry : best), null)

/**
 * The text a prompt is served with (spec 2.1: published DB version, then code): a version a published
 * server binding of the prompt's surface pins for its slot, else the prompt's published version, else
 * null (the caller uses the code text). prompt: the registry row { id, surface, slot }. With the DB
 * layer off there are no documents, so it is always null.
 * → { id, version, body, variables, source: 'pinned' | 'published' } | null
 */
export function promptFor(snapshot, prompt, codePrompts = {}) {
  if (!snapshot || snapshot.dbLayer === 'off' || !prompt) return null
  const pinned = snapshot.bindings?.[`${prompt.surface}|server`]?.prompts?.[prompt.slot]
  const found = resolvePromptRef(snapshot, pinned || prompt.id, codePrompts)
  return found && found.version > 0 ? found : null
}

export function resolvePromptRef(snapshot, ref, codePrompts) {
  const pin = parsePromptRef(ref)
  if (!pin) return null
  const head = snapshot.prompts[pin.id]
  const code = codePrompts?.[pin.id] ?? null
  const version = pin.version ?? head?.labels?.published ?? null
  const stored = version ? snapshot.promptVersions[`${pin.id}@${version}`] : null
  if (stored) return { id: pin.id, version, body: stored.body, variables: stored.variables ?? null, source: pin.version ? 'pinned' : 'published' }
  if (code) return { id: pin.id, version: 0, body: code.body, variables: code.variables ?? null, source: 'code' }
  return null
}

/**
 * The binding a surface resolves to for one person.
 * args: {
 *   surface        a surface id, or a request feature (lane-chat), resolved through the catalogue
 *   userId, orgId, plan
 *   holders        today's AI settings for this person (ai-settings-core.mjs choiceHolders):
 *                  { person, team, server, ownProviders, serverUseSource }
 *   inner?         { me: { [surface]: doc }, team: { [surface]: doc } } team and person bindings
 *                  read per request (they are not in the snapshot)
 *   settings       Meteor.settings (the file layer)
 *   codePrompts?   { [promptId]: { body, variables } } built-in prompt text (v0)
 *   codeSlots?     { [surface]: { slot: promptId } } the prompts a surface uses by default
 * }
 * → { surface, enabled, disabledMessage, disabledBy, chain, params, prompts, tools, limits,
 *     provenance, followed, bindingVersion, builtinOnly }
 */
export function resolveBinding(snapshot, args = {}) {
  const snap = snapshot && snapshot.dbLayer !== 'off' ? snapshot : EMPTY_SNAPSHOT
  const { userId = null, orgId = null, plan = null, holders = {}, inner = null, settings = {}, codePrompts = {}, codeSlots = {} } = args
  const id = toSurface(args.surface)
  if (id === null) {
    return { surface: args.surface, builtinOnly: true, enabled: true, disabledMessage: null, disabledBy: null, chain: [], params: { ...CODE_PARAMS }, prompts: {}, tools: { mode: null, allow: null }, limits: { estimate: surfaceById(args.surface)?.estimate ?? null, ceiling: surfaceById(args.surface)?.ceiling ?? null }, provenance: { chain: 'code' }, followed: null, bindingVersion: null }
  }
  const at = surfaceById(id)
  const ownProviders = holders.ownProviders !== false
  const walk = followChain(id)
  const surfaces = walk.includes('default') ? walk : [...walk, 'default']
  const scope = { userId, orgId, plan, ownProviders, inner }
  const docsBySurface = surfaces.map((sid) => ({ sid, docs: scopedDocs(snap, sid, scope) }))
  const provenance = {}

  // enabled: the global switch, then AND over the bindings of the surface and of what it follows,
  // walking `follows` as the model chain does, as far as the first surface with a server or plan
  // binding of its own: a part with no binding of its own takes the Off (and its message) of the part
  // it follows, and a part's own binding wins over its parent's. Team and person bindings met on the
  // way only ever turn a part off.
  let enabled = true
  let disabledMessage = null
  let disabledBy = null
  // the global switch holds even with the DB layer switched off at runtime (it is break-glass state)
  const global = snapshot?.state ?? snap.state
  if (global?.aiEnabled === false) {
    enabled = false
    disabledMessage = global.aiDisabledMessage || 'AI is turned off on this server by its administrator.'
    provenance.enabled = 'db:global'
  }
  for (const { sid, docs } of docsBySurface) {
    for (const { doc, layer } of docs) {
      if (doc.enabled === false && enabled) {
        enabled = false
        disabledMessage = doc.disabledMessage || `${surfaceById(sid)?.title || at.title} is turned off by your administrator.`
        provenance.enabled = layer
        disabledBy = sid === id ? null : sid
      }
    }
    if (!enabled || docs.some(({ layer }) => !isInner(layer))) break
  }
  if (!provenance.enabled) provenance.enabled = 'code'

  // first value walking surface by surface, innermost scope first
  const firstSet = (pick, { innerAllowed = false } = {}) => {
    for (const { sid, docs } of docsBySurface) {
      for (const { doc, layer } of docs) {
        if (!innerAllowed && isInner(layer)) continue
        const value = pick(doc)
        if (value !== undefined && value !== null) return { value, layer, sid, doc }
      }
    }
    return null
  }

  // chain
  let chain
  let followed = null
  let bindingVersion = null
  const fromDb = firstSet((doc) => (Array.isArray(doc.chain) && doc.chain.length ? doc.chain : null), { innerAllowed: true })
  const resolvedDb = fromDb ? fromDb.value.map((entry) => chainEntry(snap, entry, holders.server, id, settings)).filter(Boolean) : []
  // A person's or team's own choice in their AI settings is their layer (me, team): it outranks the
  // server's and a plan's bindings, as it outranks the server's choices today.
  const legacy = legacyChain(id, holders, settings)
  const ownChoice = ['me', 'team'].includes(legacy.choice.scope)
  let choiceLike = false
  let onTrip = 'report'
  if (fromDb && resolvedDb.length && (isInner(fromDb.layer) || !ownChoice)) {
    // One entry is a choice, as AI settings made it (and as ai.update and ai-control-001 write
    // it): the request keeps the call site's own fallback model, exactly as the choice did, and the
    // circuit breaker never moves it. The built-in AI's entry shows that fallback here too. A
    // longer chain is the whole list: the call site's fallback does not apply.
    choiceLike = fromDb.value.length === 1
    const onlyBuiltin = choiceLike && fromDb.value[0]?.connection === 'builtin' && !fromDb.value[0]?.model
    chain = onlyBuiltin ? builtinChain(id, settings).chain.map((entry, index) => (index === 0 ? { ...entry, builtinDefault: true } : { ...entry, builtinFallback: true })) : resolvedDb
    provenance.chain = fromDb.layer
    followed = fromDb.sid === id ? null : fromDb.sid
    bindingVersion = `${fromDb.doc._id}@v${fromDb.doc.version ?? 1}`
    onTrip = tripRule(fromDb.doc)
  } else {
    chain = legacy.chain
    provenance.chain = legacy.layer
    followed = legacy.choice.feature && legacy.choice.feature !== id ? legacy.choice.feature : null
  }

  // params: per field
  const params = {}
  const fileParams = {
    timeoutMs: settings?.ai?.requestTimeoutMs ?? null,
    infraRetries: settings?.ai?.providerInfraRetries ?? null,
  }
  for (const key of Object.keys(CODE_PARAMS)) {
    const found = firstSet((doc) => doc.params?.[key])
    if (found) {
      params[key] = found.value
      provenance[`params.${key}`] = found.layer
    } else if (fileParams[key] !== undefined && fileParams[key] !== null) {
      params[key] = fileParams[key]
      provenance[`params.${key}`] = 'file'
    } else {
      params[key] = CODE_PARAMS[key]
      provenance[`params.${key}`] = 'code'
    }
  }

  // prompts: slots from the surface's code defaults, overlaid by bindings (server or plan)
  const slots = { ...(codeSlots[id] || {}) }
  const slotLayer = Object.fromEntries(Object.keys(slots).map((slot) => [slot, 'code']))
  for (const { docs } of [...docsBySurface].reverse()) {
    for (const { doc, layer } of [...docs].reverse()) {
      if (isInner(layer) || !doc.prompts) continue
      for (const [slot, ref] of Object.entries(doc.prompts)) {
        slots[slot] = ref
        slotLayer[slot] = layer
      }
    }
  }
  const prompts = {}
  for (const [slot, ref] of Object.entries(slots)) {
    const resolved = resolvePromptRef(snap, ref, codePrompts)
    if (resolved) {
      prompts[slot] = resolved
      provenance[`prompts.${slot}`] = resolved.source === 'code' ? 'code' : slotLayer[slot]
    }
  }

  // tools: mode from the innermost server/plan binding; allow-lists intersect
  const mode = firstSet((doc) => doc.tools?.mode)
  let allow = null
  for (const { docs } of docsBySurface) {
    for (const { doc, layer } of docs) {
      if (isInner(layer) || !Array.isArray(doc.tools?.allow)) continue
      allow = allow === null ? [...doc.tools.allow] : allow.filter((t) => doc.tools.allow.includes(t))
      provenance['tools.allow'] = provenance['tools.allow'] ? `${provenance['tools.allow']}+${layer}` : layer
    }
  }
  const tools = { mode: mode?.value ?? null, allow }
  provenance['tools.mode'] = mode?.layer ?? 'code'
  if (!provenance['tools.allow']) provenance['tools.allow'] = 'code'

  // limits: catalogue default, tightened by any binding that sets one
  const limits = {}
  for (const key of ['estimate', 'ceiling']) {
    const set = docsBySurface.flatMap(({ docs }) => docs.filter(({ layer }) => !isInner(layer)).map(({ doc, layer }) => ({ value: doc.limits?.[key], layer })))
    const tightest = tightestOf(set)
    const code = at[key] ?? null
    const fromDoc = tightest && (code === null || tightest.value < code)
    limits[key] = fromDoc ? tightest.value : code
    provenance[`limits.${key}`] = fromDoc ? tightest.layer : 'code'
  }

  return {
    surface: id, builtinOnly: false, enabled, disabledMessage, chain, params, prompts, tools, limits,
    provenance, followed, bindingVersion, builtinFrom: builtinFeatureFor(id),
    // off because the part it follows is off (it has no binding of its own): that part's id
    disabledBy,
    // the model chain came from a published binding (not an AI settings choice, the file or code)
    chainFromBinding: Boolean(bindingVersion),
    // a one-entry chain is served as a choice (no chain walk, the call site's fallback kept)
    choiceLike,
    // what this pod's circuit breaker does when the chain keeps failing (breaker.mjs)
    onTrip,
  }
}

/**
 * What the circuit breaker does for a published binding that keeps failing: 'fallback' serves the
 * surface from the settings file and the built-in AI for a while; 'report' keeps the chain and
 * only says so (health, rollback). The binding's own onTrip wins. Otherwise only a chain of two or
 * more that already lists the built-in AI falls back: an administrator who bound a surface to their
 * own connections alone (to keep data on site, say) never has it sent elsewhere by the breaker.
 */
export function tripRule(doc) {
  if (doc?.onTrip === 'fallback' || doc?.onTrip === 'report') return doc.onTrip
  const chain = Array.isArray(doc?.chain) ? doc.chain : []
  return chain.length > 1 && chain.some((entry) => entry?.connection === 'builtin' || String(entry?.model || '').startsWith('builtin:')) ? 'fallback' : 'report'
}

/** A short form for comparing with what the AI settings resolve: the primary connection and model. */
export function primaryOf(binding) {
  const first = binding.chain[0] || null
  return first ? { connection: first.connection, provider: first.provider, model: first.model } : null
}
