// The aiControl facade without Meteor: which model a part of Slatebox uses for a person, render a
// prompt, and the read views an administrator gets (the snapshot, what every part resolves to,
// health). index.mjs builds the one instance with the real collections; the tests build their own.
import { SURFACES, surface as surfaceById } from './catalogue.mjs'
import { defaultRoute, resolveModel, toSurface } from './resolve.mjs'
import { PromptVarsError, TemplateError, renderPrompt } from './render.mjs'
import { connectionLabel, resolveAIChoice } from '../methods/ai/connections.mjs'
import { presetsView, providersView } from './models.mjs'

const publicSurface = (s) => ({
  id: s.id, title: s.title, follows: s.follows, followsTitle: s.follows ? surfaceById(s.follows)?.title ?? null : null,
  needs: [...s.needs], builtinOnly: s.builtinOnly, bindable: s.useKey,
  inBuild: s.inBuild, ...(s.branch && { branch: s.branch }), ...(s.edition && { edition: s.edition }),
  estimate: s.estimate, ceiling: s.ceiling,
})

// A route as an administrator reads it: what the provider IS and the model's name, never a key.
const publicRoute = (route) => {
  if (!route) return null
  if (route.error) return { error: route.error }
  if (route.aux) return { provider: route.provider, providerLabel: route.label, model: route.model, label: route.label, aux: true }
  return {
    provider: route.provider, providerLabel: route.providerLabel, preset: route.preset, model: route.model, modelId: route.modelId,
    label: route.label, baseUrl: route.baseUrl, protocol: route.protocol, capabilities: route.capabilities, prices: route.prices,
    hasKey: Boolean(route.keyFingerprint), keyFingerprint: route.keyFingerprint ?? null,
  }
}

/**
 * What needs an administrator's attention without breaking anything (the amber banner): models
 * with no price (charged at the dearest rate), and providers a part of Slatebox uses that have no
 * active key. isPriced(model) → whether the model has a price anywhere; keyed(provider) → whether
 * a key a request can use exists outside the snapshot (a settings-file key kept for this boot).
 */
export function warningsOf(snapshot, { isPriced = () => true, keyed = () => false } = {}) {
  const out = []
  for (const model of Object.values(snapshot.models || {})) {
    if (model.status === 'disabled') continue
    const own = model.prices && ((Number.isFinite(model.prices.inputPerM) && Number.isFinite(model.prices.outputPerM)) || Number.isFinite(model.prices.imageEach))
    if (!own && !isPriced(model.model)) out.push({ kind: 'unpriced', id: model._id, problem: `${model.label || model.model} has no price. Until you add one, Slatebox charges it at its highest rate.` })
  }
  const used = new Map()
  const note = (route) => {
    if (route && !route.error && !route.aux && route.provider) used.set(route.provider, route.providerLabel)
  }
  note(defaultRoute(snapshot))
  for (const doc of Object.values(snapshot.bindings || {})) if (doc.use === 'model') note(resolveModel(snapshot, { surface: doc.surface }).route)
  for (const [provider, label] of used) {
    if (!snapshot.keys?.[provider] && !keyed(provider)) out.push({ kind: 'no-key', id: provider, problem: `${label} has no active key, so the parts that use it do not answer. Add a key on Providers and keys.` })
  }
  return out
}

/**
 * deps: {
 *   holder          snapshot.mjs createSnapshotHolder
 *   choiceHolders(userId) → a person's own AI (ai-settings-core.mjs choiceHolders)
 *   codePrompts?    { [promptId]: { body, variables } } built-in prompt text
 *   isPriced?, keyed?(provider), extraHealth?() → more health entries (the key import's)
 * }
 */
export function createAIControl({ holder, choiceHolders = async () => ({ ownProviders: false }), codePrompts = {}, isPriced = () => true, keyed = () => false, extraHealth = () => [] }) {
  // Problems found while serving (a published prompt that would not render), newest last; shown
  // with the snapshot's own health. Per pod, in memory, bounded.
  const runtimeHealth = []
  const noteHealth = (entry) => {
    const at = runtimeHealth.findIndex((h) => h.kind === entry.kind && h.id === entry.id)
    if (at >= 0) runtimeHealth.splice(at, 1)
    runtimeHealth.push({ ...entry, at: new Date() })
    if (runtimeHealth.length > 50) runtimeHealth.shift()
  }
  const clearHealth = (kind, id) => {
    const at = runtimeHealth.findIndex((h) => h.kind === kind && h.id === id)
    if (at >= 0) runtimeHealth.splice(at, 1)
  }

  /** What one part resolves to for a person: their own connection first (self-hosted), then AI control. */
  async function bind({ surface, userId = null } = {}) {
    const snapshot = await holder.ready()
    const resolved = resolveModel(snapshot, { surface })
    if (!resolved.enabled || resolved.builtinOnly || !userId) return { ...resolved, own: null }
    const holders = await choiceHolders(userId)
    const choice = resolveAIChoice({ feature: resolved.surface, person: holders.person, team: holders.team, ownProviders: holders.ownProviders })
    return { ...resolved, own: choice.connection ? { ref: choice.ref, scope: choice.scope, label: connectionLabel(choice.connection) } : null }
  }

  /** Every part (or one) as it resolves for a person (userId null = someone not signed in). */
  async function effective({ surface = null, userId = null } = {}) {
    const snapshot = await holder.ready()
    const rows = surface ? [surfaceById(surface) || surfaceById(toSurface(surface))].filter(Boolean) : SURFACES
    const out = []
    for (const s of rows) {
      if (!s.useKey) {
        out.push({ ...publicSurface(s), resolved: null, note: s.builtinOnly ? 'Served by a built-in service' : 'Names its model per call' })
        continue
      }
      if (!s.inBuild) {
        out.push({ ...publicSurface(s), resolved: null, note: 'Not in this build' })
        continue
      }
      if (s.id === 'default') {
        out.push({ ...publicSurface(s), resolved: { enabled: true, source: snapshot.bindings.default ? 'default' : 'builtin', followed: null, route: publicRoute(defaultRoute(snapshot)), own: null } })
        continue
      }
      const resolved = await bind({ surface: s.id, userId })
      out.push({ ...publicSurface(s), resolved: { enabled: resolved.enabled, disabledMessage: resolved.disabledMessage ?? null, disabledBy: resolved.disabledBy ?? null, source: resolved.source, followed: resolved.followed, route: publicRoute(resolved.route), own: resolved.own } })
    }
    return { generation: snapshot.generation, source: snapshot.source, userId, surfaces: out }
  }

  const health = () => [...holder.current().health, ...runtimeHealth, ...extraHealth()]

  /** The snapshot as an administrator reads it: never a key. */
  function get() {
    const snap = holder.current()
    return {
      generation: snap.generation,
      source: snap.source,
      loadedAt: snap.loadedAt,
      global: { aiEnabled: snap.state.aiEnabled !== false, aiDisabledMessage: snap.state.aiDisabledMessage ?? null },
      surfaces: SURFACES.map(publicSurface),
      providers: providersView(snap),
      presets: presetsView(),
      keys: Object.fromEntries(Object.entries(snap.keys || {}).map(([provider, k]) => [provider, { keyFingerprint: k.keyFingerprint }])),
      models: Object.values(snap.models),
      bindings: Object.values(snap.bindings),
      defaultRoute: publicRoute(defaultRoute(snap)),
      agents: Object.values(snap.agents),
      prompts: Object.values(snap.prompts).map((p) => ({ id: p._id, surface: p.surface ?? null, kind: p.kind ?? null, title: p.title ?? null, labels: p.labels ?? { published: null } })),
      health: health(),
      warnings: warningsOf(snap, { isPriced, keyed }),
    }
  }

  /**
   * Renders a prompt. If a published version does not render (a required value missing, a wrong
   * type), the built-in text (v0) is used instead, and the fallback is noted in health.
   * → { text, ref: 'id@v', fallback: null | 'id@v4 -> v0' }
   */
  function renderVersion(prompt, values = {}) {
    try {
      return { text: renderPrompt(prompt, values), ref: `${prompt.id}@v${prompt.version}`, fallback: null }
    } catch (error) {
      const code = codePrompts[prompt.id]
      if (!(error instanceof PromptVarsError || error instanceof TemplateError) || prompt.version === 0 || !code) throw error
      noteHealth({ kind: 'prompt', id: prompt.id, problem: `Version ${prompt.version} could not be rendered (${error.message}); the built-in text was used.` })
      return { text: renderPrompt({ ...code, id: prompt.id, version: 0 }, values), ref: `${prompt.id}@v0`, fallback: `${prompt.id}@v${prompt.version} -> v0` }
    }
  }

  return {
    bind,
    renderVersion,
    noteHealth,
    clearHealth,
    effective,
    get,
    health,
    warnings: () => warningsOf(holder.current(), { isPriced, keyed }),
    render: renderPrompt,
    snapshot: () => holder.current(),
    refresh: (options) => holder.refresh(options),
  }
}
