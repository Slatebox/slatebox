// The one resolver: which model answers a part of Slatebox, from a snapshot. Pure, so the request
// path, the admin pages and the tests all run the same code.
//
// Order, first match wins:
//   1. AI turned off for everyone (the global switch);
//   2. the part's own binding: a model, or turned off;
//   3. the binding of the part it follows, and so on up (workshop follows chat), but not default;
//   4. Generating images with nothing set: the built-in Stability image service (Ember cannot draw);
//   5. the default binding ("Everything not set");
//   6. the built-in default: Meta Muse Ember (provider-presets.mjs BUILTIN_DEFAULT).
// A person's or team's own AI (self-hosted, ai-settings-core.mjs) comes before 2 to 6 for them, and
// never before 1 or a part an administrator turned off.
//
// The request path keeps its own sensible values (no administrator knobs): a 90 second time limit,
// 2 retries for a failing service, 3 tries for an answer of the right shape, the provider's tool
// choice, and the call site's temperature and answer size.
import { followChain, surface as surfaceById, surfaceForRequest } from './catalogue.mjs'
import { EMPTY_SNAPSHOT, modelId, parsePromptRef } from './snapshot.mjs'
import { BUILTIN_DEFAULT, PROVIDER_PRESETS, providerFromPreset } from './provider-presets.mjs'

export { BUILTIN_DEFAULT }

/** What every request keeps, with no administrator setting for it. */
export const CODE_LIMITS = Object.freeze({ timeoutMs: 90000, infraRetries: 2, shapeRetries: 3 })

/** The built-in image service generated pictures use while nothing is set for them. */
export const STABILITY_ROUTE = Object.freeze({ provider: 'stability', model: 'stable-diffusion-v1-6', label: 'Stability AI (built in)', aux: true })

/** A surface id, or a request feature (lane-chat -> workshop), to its surface id; null for built-in-only paths. */
export function toSurface(name) {
  const at = surfaceById(name)
  if (at) return at.builtinOnly ? null : at.id
  return surfaceForRequest(name)
}

/** The provider the built-in default uses: a stored provider made from the Meta preset, else the preset itself. */
export function builtinProvider(snapshot) {
  const stored = Object.values(snapshot?.providers || {}).filter((p) => p.preset === BUILTIN_DEFAULT.preset && p.status !== 'archived')
  const chosen = stored.find((p) => p._id === BUILTIN_DEFAULT.preset) || stored[0]
  return chosen || providerFromPreset(BUILTIN_DEFAULT.preset)
}

// A model row as the request path reads it (never a key: keys are opened per request).
function routeOf(snapshot, model, provider) {
  const preset = PROVIDER_PRESETS[provider.preset]
  return {
    provider: provider._id, providerLabel: provider.label, preset: provider.preset ?? null,
    model: model.model, modelId: model._id ?? modelId(provider._id, model.model), label: model.label || model.model,
    protocol: provider.protocol, baseUrl: provider.baseUrl, toolChoice: provider.toolChoice || preset?.toolChoice || 'auto',
    capabilities: { ...(model.capabilities || {}) }, prices: model.prices ?? null, maxOutput: model.maxOutput ?? null,
    keyFingerprint: snapshot?.keys?.[provider._id]?.keyFingerprint ?? null,
  }
}

function fromModelId(snapshot, id) {
  const model = snapshot.models[id]
  if (!model) return { error: `The model ${id} is no longer in Admin → AI control.` }
  const provider = snapshot.providers[model.provider]
  if (!provider || provider.status === 'archived') return { error: `The provider of ${model.label || model.model} is no longer in Admin → AI control.` }
  return routeOf(snapshot, model, provider)
}

function builtinRoute(snapshot) {
  const provider = builtinProvider(snapshot)
  const stored = snapshot.models[modelId(provider._id, BUILTIN_DEFAULT.model)]
  const suggestion = PROVIDER_PRESETS[BUILTIN_DEFAULT.preset].models.find((m) => m.model === BUILTIN_DEFAULT.model)
  const model = stored || { _id: modelId(provider._id, BUILTIN_DEFAULT.model), model: BUILTIN_DEFAULT.model, label: suggestion?.label, capabilities: suggestion?.capabilities, prices: suggestion?.prices }
  return routeOf(snapshot, model, provider)
}

/**
 * The route of one part of Slatebox.
 * → { surface, builtinOnly, enabled, disabledMessage, disabledBy, source, followed, route }
 *   source: 'off-global' | 'off' | 'part' | 'followed' | 'stability' | 'default' | 'builtin'
 *   route: { provider, providerLabel, preset, model, modelId, label, protocol, baseUrl, toolChoice,
 *            capabilities, prices, maxOutput, keyFingerprint } | { error } | STABILITY_ROUTE | null
 */
export function resolveModel(snapshot, { surface } = {}) {
  const snap = snapshot || EMPTY_SNAPSHOT
  const id = toSurface(surface)
  const global = snap.state
  const off = global?.aiEnabled === false
  const offMessage = global?.aiDisabledMessage || 'AI is turned off on this server by its administrator.'
  if (id === null) {
    return { surface, builtinOnly: true, enabled: !off, disabledMessage: off ? offMessage : null, disabledBy: null, source: off ? 'off-global' : 'builtin', followed: null, route: null }
  }
  const base = { surface: id, builtinOnly: false, disabledBy: null, followed: null }
  if (off) return { ...base, enabled: false, disabledMessage: offMessage, source: 'off-global', route: null }
  for (const sid of followChain(id)) {
    if (sid === 'default') break
    const doc = snap.bindings[sid]
    if (!doc) continue
    const followed = sid === id ? null : sid
    if (doc.use === 'off') {
      return { ...base, enabled: false, disabledMessage: `${surfaceById(sid)?.title || sid} is turned off by your administrator.`, disabledBy: followed, source: 'off', followed, route: null }
    }
    return { ...base, enabled: true, disabledMessage: null, source: followed ? 'followed' : 'part', followed, route: fromModelId(snap, doc.model) }
  }
  if (followChain(id).includes('images')) return { ...base, enabled: true, disabledMessage: null, source: 'stability', route: STABILITY_ROUTE }
  const fallback = snap.bindings.default
  if (fallback?.use === 'model') return { ...base, enabled: true, disabledMessage: null, source: 'default', route: fromModelId(snap, fallback.model) }
  return { ...base, enabled: true, disabledMessage: null, source: 'builtin', route: builtinRoute(snap) }
}

/** The default route ("Everything not set"), for the one retry after a failing service. */
export function defaultRoute(snapshot) {
  const snap = snapshot || EMPTY_SNAPSHOT
  const fallback = snap.bindings.default
  return fallback?.use === 'model' ? fromModelId(snap, fallback.model) : builtinRoute(snap)
}

/**
 * The text a prompt is served with: its published version, or null (the caller uses the built-in
 * text). prompt: the registry row { id, surface, slot }.
 * → { id, version, body, variables, source: 'published' } | null
 */
export function promptFor(snapshot, prompt, codePrompts = {}) {
  if (!snapshot || !prompt) return null
  const found = resolvePromptRef(snapshot, prompt.id, codePrompts)
  return found && found.version > 0 ? found : null
}

export function resolvePromptRef(snapshot, ref, codePrompts) {
  const pin = parsePromptRef(ref)
  if (!pin) return null
  const head = snapshot.prompts?.[pin.id]
  const code = codePrompts?.[pin.id] ?? null
  const version = pin.version ?? head?.labels?.published ?? null
  const stored = version ? snapshot.promptVersions?.[`${pin.id}@${version}`] : null
  if (stored) return { id: pin.id, version, body: stored.body, variables: stored.variables ?? null, source: 'published' }
  if (code) return { id: pin.id, version: 0, body: code.body, variables: code.variables ?? null, source: 'code' }
  return null
}
