// The aiControl facade without Meteor: bind a surface for a person, render a prompt, and the
// read views an administrator gets (the snapshot, the effective binding of every surface, health).
// index.mjs builds the one instance with the real collections; the tests build their own.
import { SURFACES, surface as surfaceById } from './catalogue.mjs'
import { resolveBinding, toSurface } from './resolve.mjs'
import { PromptVarsError, TemplateError, renderPrompt } from './render.mjs'

const publicSurface = (s) => ({
  id: s.id, title: s.title, follows: s.follows, followsTitle: s.follows ? surfaceById(s.follows)?.title ?? null : null,
  needs: [...s.needs], builtinFrom: s.builtinFrom, builtinOnly: s.builtinOnly, bindable: s.useKey,
  inBuild: s.inBuild, ...(s.branch && { branch: s.branch }), ...(s.edition && { edition: s.edition }),
  estimate: s.estimate, ceiling: s.ceiling,
})

// What an administrator may read about a connection in the snapshot: never a key or a cipher.
const publicConnection = (c) => ({
  name: c.name, provider: c.provider, baseUrl: c.baseUrl, model: c.model, capabilities: c.capabilities || {},
  status: c.status, hasKey: Boolean(c.hasKey), keyFingerprint: c.keyFingerprint ?? null, keyRef: c.keyRef ?? null, lastCheck: c.lastCheck ?? null,
})

/**
 * What needs an administrator's attention without breaking anything (the amber banner, spec 3.1):
 * models with no price (charged at the dearest rate) and connections whose last test failed.
 * isPriced(model) → whether the model has a price anywhere (metering/prices.mjs isPriced).
 */
export function warningsOf(snapshot, { isPriced = () => true } = {}) {
  const out = []
  for (const model of Object.values(snapshot.models || {})) {
    if (model.status === 'disabled') continue
    const own = model.prices && ((Number.isFinite(model.prices.inputPerM) && Number.isFinite(model.prices.outputPerM)) || Number.isFinite(model.prices.imageEach))
    if (!own && !isPriced(model.model)) out.push({ kind: 'unpriced', id: model._id, problem: `${model.label || model.model} has no price. Until you add one, Slatebox charges it at its highest rate.` })
  }
  for (const c of Object.values(snapshot.connections || {})) {
    if (c.status !== 'disabled' && c.lastCheck && c.lastCheck.ok === false) out.push({ kind: 'connection', id: c.name, problem: `Its last test failed: ${c.lastCheck.error || 'no answer'}` })
  }
  return out
}

/**
 * deps: {
 *   holder          snapshot.mjs createSnapshotHolder
 *   choiceHolders(userId) → today's AI settings for the person (ai-settings-core.mjs choiceHolders)
 *   settings        Meteor.settings
 *   codePrompts?    { [promptId]: { body, variables } } built-in prompt text (none until the prompts move)
 *   codeSlots?      { [surface]: { slot: promptId } }
 *   innerBindings?(userId, orgId) → { me, team } team and person bindings (read per request)
 * }
 */
export function createAIControl({ holder, choiceHolders, settings = {}, codePrompts = {}, codeSlots = {}, innerBindings = async () => null, isPriced = () => true, providerView = null }) {
  // Problems found while serving (a published prompt that would not render), newest last; shown
  // with the snapshot's own health. Per pod, in memory, bounded.
  const runtimeHealth = []
  const noteHealth = (entry) => {
    runtimeHealth.push({ ...entry, at: new Date() })
    if (runtimeHealth.length > 50) runtimeHealth.shift()
  }

  async function bind({ surface, userId = null, orgId, plan = null } = {}) {
    const snapshot = await holder.ready()
    const holders = await choiceHolders(userId)
    const team = orgId === undefined ? holders.orgId ?? null : orgId
    const inner = holders.ownProviders ? await innerBindings(userId, team) : null
    return resolveBinding(snapshot, { surface, userId, orgId: team, plan, holders, inner, settings, codePrompts, codeSlots })
  }

  /** Every surface (or one) as it resolves for a person (userId null = someone not signed in). */
  async function effective({ surface = null, userId = null, orgId, plan = null } = {}) {
    const snapshot = await holder.ready()
    const rows = surface ? [surfaceById(surface) || surfaceById(toSurface(surface))].filter(Boolean) : SURFACES
    const out = []
    for (const s of rows) {
      if (!s.useKey || s.id === 'default') {
        out.push({ ...publicSurface(s), binding: null, note: s.builtinOnly ? 'Served by a built-in service' : s.id === 'default' ? 'Applies to every surface not set below' : 'Names its model per call' })
        continue
      }
      if (!s.inBuild) {
        out.push({ ...publicSurface(s), binding: null, note: 'Not in this build' })
        continue
      }
      out.push({ ...publicSurface(s), binding: await bind({ surface: s.id, userId, orgId, plan }) })
    }
    return { generation: snapshot.generation, dbLayer: snapshot.dbLayer, source: snapshot.source, userId, plan, surfaces: out }
  }

  /** The snapshot as an administrator reads it: never a key. */
  function get() {
    const snap = holder.current()
    return {
      generation: snap.generation,
      dbLayer: snap.dbLayer,
      source: snap.source,
      loadedAt: snap.loadedAt,
      global: { aiEnabled: snap.state.aiEnabled !== false, aiDisabledMessage: snap.state.aiDisabledMessage ?? null },
      surfaces: SURFACES.map(publicSurface),
      // the built-in providers with the administrators' (providers.mjs), when the caller gives the view
      providers: providerView ? providerView(snap) : Object.values(snap.providers),
      connections: Object.values(snap.connections).map(publicConnection),
      models: Object.values(snap.models),
      bindings: Object.values(snap.bindings),
      agents: Object.values(snap.agents),
      prompts: Object.values(snap.prompts).map((p) => ({ id: p._id, surface: p.surface ?? null, kind: p.kind ?? null, title: p.title ?? null, labels: p.labels ?? { published: null } })),
      health: [...snap.health, ...runtimeHealth],
      warnings: warningsOf(snap, { isPriced }),
    }
  }

  /**
   * Renders one prompt slot of a binding. If a published version does not render (a required value
   * missing, a wrong type), the built-in text (v0) is used instead, once, and the fallback is noted in
   * health; people never see a broken prompt (spec 2.3).
   * → { text, ref: 'id@v', fallback: null | 'id@v4 -> v0' }
   */
  function renderSlot(binding, slot, values = {}) {
    const prompt = binding?.prompts?.[slot]
    if (!prompt) throw new PromptVarsError(`${binding?.surface ?? 'This surface'} has no ${slot} prompt.`)
    try {
      return { text: renderPrompt(prompt, values), ref: `${prompt.id}@v${prompt.version}`, fallback: null }
    } catch (error) {
      const code = codePrompts[prompt.id]
      if (!(error instanceof PromptVarsError || error instanceof TemplateError) || prompt.version === 0 || !code) throw error
      const fallback = `${prompt.id}@v${prompt.version} -> v0`
      noteHealth({ kind: 'prompt', id: prompt.id, problem: `Version ${prompt.version} could not be rendered (${error.message}); the built-in text was used.` })
      return { text: renderPrompt({ ...code, id: prompt.id, version: 0 }, values), ref: `${prompt.id}@v0`, fallback }
    }
  }

  return {
    bind,
    renderSlot,
    effective,
    get,
    health: () => [...holder.current().health, ...runtimeHealth],
    warnings: () => warningsOf(holder.current(), { isPriced }),
    render: renderPrompt,
    snapshot: () => holder.current(),
    refresh: (options) => holder.refresh(options),
  }
}
