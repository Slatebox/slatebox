// Bindings as an administrator changes them (spec 1.4, 3.4): what one surface uses, versioned.
// A binding is an ordered model chain (the primary and fallbacks, each tried for the failure
// classes it names), parameters, prompts, allowed tools, limits that only tighten, and an on/off
// switch with the message people see. Drafts change nothing live; publishing copies a version into
// the head document the snapshot reads; a rollback publishes an earlier version again under a new
// number, so history only moves forward. Every publish is checked first against what exists now
// (models, connections, capabilities, prompts), with the same rules the snapshot applies when it
// loads, so a published binding is never skipped for a reason known at publish time.
//
// Pure apart from the injected store (store.mjs), the versions collection and the settings.
import { surface as surfaceById, SURFACES } from './catalogue.mjs'
import { CODE_PARAMS } from './resolve.mjs'
import { FAILURE_CLASSES, MAX_CHAIN, bindingProblem, parsePromptRef, scopeKey } from './snapshot.mjs'
import { ModelError } from './models.mjs'

export const BINDING_SCOPES = Object.freeze(['server'])
export const TOOL_MODES = Object.freeze(['forced', 'auto', 'none'])
export const PARAM_LIMITS = Object.freeze({
  timeoutMs: { min: 1000, max: 600000, whole: true },
  maxTokens: { min: 1, max: 1000000, whole: true },
  infraRetries: { min: 0, max: 10, whole: true },
  shapeRetries: { min: 1, max: 10, whole: true },
  temperature: { min: 0, max: 2, whole: false },
})
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/
const CONNECTION_REF = /^server:([a-z0-9][a-z0-9-]{0,39})$/
const MESSAGE_MAX = 300
const NOTE_MAX = 200
// what a version keeps of a binding (the head adds status, version and who published it)
const FIELDS = ['surface', 'scope', 'enabled', 'disabledMessage', 'chain', 'params', 'prompts', 'tools', 'limits']

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const fail = (message, status = 400, details) => {
  throw new ModelError(message, status, details)
}

/**
 * Surfaces an administrator can bind in this build: chosen per surface, not served by a built-in
 * service only, and sent by some call site (generation.notes has no request of its own yet, so a
 * binding of it would do nothing; default is what every other surface follows).
 */
export const BINDABLE_SURFACES = Object.freeze(SURFACES.filter((s) => s.useKey && s.inBuild && s.id !== 'admin.test' && (s.id === 'default' || s.requestFeatures.length)).map((s) => s.id))

/** The binding id of a surface at a scope: <surface>|<scope key>. */
export function bindingIdOf(surfaceId, scope = { level: 'server' }) {
  return `${surfaceId}|${scopeKey(scope)}`
}

/**
 * Checks a binding an administrator sends and returns the document fields to store.
 * input: { surface, scope?, enabled?, disabledMessage?, chain?, params?, prompts?, tools?, limits? }
 * ctx: { snapshot, connections: [{ name, status?, capabilities?, disabled? }] the server's
 *        connections (the settings file's and the app's), codePromptIds?: [ids], checkRefs: true }
 * With checkRefs false (a draft) only the shape is checked; models and connections are checked
 * when it is published.
 */
export function normalizeBinding(input, { snapshot, connections = [], codePromptIds = [], checkRefs = true } = {}) {
  if (!isObject(input)) fail('A binding is an object naming its surface.')
  const at = surfaceById(input.surface)
  if (!at || !BINDABLE_SURFACES.includes(at.id)) {
    fail(at && !at.inBuild ? `${at.title} is not in this build.` : `${input.surface} is not a part of Slatebox that can be bound. Bindable: ${BINDABLE_SURFACES.join(', ')}.`)
  }
  const scope = input.scope === undefined ? { level: 'server' } : input.scope
  if (!isObject(scope) || !BINDING_SCOPES.includes(scope.level)) {
    fail(isObject(scope) && ['plan', 'team', 'me'].includes(scope.level) ? 'Plan, team and person overrides are not in this build yet; bind the server scope.' : 'scope is { level: "server" }.')
  }
  const doc = { surface: at.id, scope: { level: 'server' } }

  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') fail('enabled is true or false.')
    doc.enabled = input.enabled
  } else {
    doc.enabled = true
  }
  if (input.disabledMessage !== undefined && input.disabledMessage !== null) {
    const message = typeof input.disabledMessage === 'string' ? input.disabledMessage.trim() : ''
    if (!message || message.length > MESSAGE_MAX || /[\r\n]/.test(message)) fail(`disabledMessage is one line of at most ${MESSAGE_MAX} characters: what people see while it is off.`)
    doc.disabledMessage = message
  }

  if (input.chain !== undefined && input.chain !== null) {
    if (!Array.isArray(input.chain)) fail('chain is a list: the primary model first, then fallbacks.')
    if (input.chain.length > MAX_CHAIN) fail(`chain holds at most ${MAX_CHAIN} entries.`)
    const seen = new Set()
    doc.chain = input.chain.map((entry, index) => {
      const n = index + 1
      if (!isObject(entry)) fail(`chain ${n}: an entry is { model } or { connection }.`)
      const extra = Object.keys(entry).find((key) => !['model', 'connection', 'on'].includes(key))
      if (extra) fail(`chain ${n}: ${extra} is not a chain field (model, connection, on).`)
      const hasModel = typeof entry.model === 'string' && entry.model
      const hasConnection = typeof entry.connection === 'string' && entry.connection
      if (hasModel === hasConnection) fail(`chain ${n}: name a model from the model list, or a connection (server:<name>, or builtin for the built-in AI).`)
      if (hasConnection && entry.connection !== 'builtin' && !CONNECTION_REF.test(entry.connection)) fail(`chain ${n}: a connection is server:<name> or builtin.`)
      const key = hasModel ? `m:${entry.model}` : `c:${entry.connection}`
      if (seen.has(key)) fail(`chain ${n}: ${entry.model || entry.connection} is already in the chain.`)
      seen.add(key)
      const out = hasModel ? { model: entry.model } : { connection: entry.connection }
      if (index > 0) {
        const on = entry.on === undefined ? ['infra'] : entry.on
        if (!Array.isArray(on) || !on.length || on.some((c) => !FAILURE_CLASSES.includes(c))) fail(`chain ${n}: on is a list of ${FAILURE_CLASSES.join(', ')}: when this fallback is tried.`)
        out.on = [...new Set(on)]
      }
      return out
    })
    if (!doc.chain.length) delete doc.chain
  }

  if (input.params !== undefined && input.params !== null) {
    if (!isObject(input.params)) fail('params is an object.')
    const params = {}
    for (const [key, value] of Object.entries(input.params)) {
      const limit = PARAM_LIMITS[key]
      if (!limit) fail(`params.${key} is not a parameter (${Object.keys(PARAM_LIMITS).join(', ')}).`)
      if (value === null) continue
      if (typeof value !== 'number' || !Number.isFinite(value) || value < limit.min || value > limit.max || (limit.whole && !Number.isInteger(value))) {
        fail(`params.${key} is ${limit.whole ? 'a whole number' : 'a number'} from ${limit.min} to ${limit.max}.`)
      }
      params[key] = value
    }
    if (Object.keys(params).length) doc.params = params
  }

  if (input.prompts !== undefined && input.prompts !== null) {
    if (!isObject(input.prompts)) fail('prompts is an object of slot: prompt id.')
    const prompts = {}
    for (const [slot, ref] of Object.entries(input.prompts)) {
      if (!/^[a-z][a-zA-Z0-9]{0,31}$/.test(slot)) fail(`prompt slot ${slot} is a short name, for example system.`)
      if (!parsePromptRef(ref)) fail(`prompt slot ${slot} names a prompt id, or id@version to pin one.`)
      prompts[slot] = ref
    }
    if (Object.keys(prompts).length) doc.prompts = prompts
  }

  if (input.tools !== undefined && input.tools !== null) {
    if (!isObject(input.tools)) fail('tools is { mode, allow }.')
    const tools = {}
    if (input.tools.mode !== undefined && input.tools.mode !== null) {
      if (!TOOL_MODES.includes(input.tools.mode)) fail(`tools.mode is ${TOOL_MODES.join(', ')}.`)
      if (input.tools.mode === 'none' && at.needs.includes('tools')) fail(`${at.title} needs tools; tools.mode none would leave it unable to answer.`)
      tools.mode = input.tools.mode
    }
    if (input.tools.allow !== undefined && input.tools.allow !== null) {
      if (!Array.isArray(input.tools.allow) || !input.tools.allow.length || input.tools.allow.length > 30 || input.tools.allow.some((t) => typeof t !== 'string' || !TOOL_NAME.test(t))) {
        fail('tools.allow is a list of up to 30 tool names; leave it out to allow every tool the feature uses.')
      }
      tools.allow = [...new Set(input.tools.allow)]
    }
    if (Object.keys(tools).length) doc.tools = tools
  }

  if (input.limits !== undefined && input.limits !== null) {
    if (!isObject(input.limits)) fail('limits is { estimate, ceiling } in micro-dollars.')
    const limits = {}
    for (const [key, value] of Object.entries(input.limits)) {
      if (!['estimate', 'ceiling'].includes(key)) fail(`limits.${key} is not a limit (estimate, ceiling).`)
      if (value === null) continue
      if (!Number.isInteger(value) || value < 1) fail(`limits.${key} is a whole number of micro-dollars above 0.`)
      const code = at[key]
      // limits only tighten: the built-in value is the most a binding may allow
      if (code !== null && code !== undefined && value > code) fail(`limits.${key} can only lower the built-in ${code}.`)
      limits[key] = value
    }
    if (Object.keys(limits).length) doc.limits = limits
  }

  if (checkRefs) {
    const problem = referenceProblem(doc, { snapshot, connections, codePromptIds })
    if (problem) fail(`This binding cannot be published: ${problem}.`, 409)
  }
  return doc
}

// The snapshot's own load check (snapshot.mjs bindingProblem), against what exists now.
function referenceProblem(doc, { snapshot, connections, codePromptIds }) {
  const byName = Object.fromEntries(connections.map((c) => [c.name, { ...c, status: c.status === 'disabled' || c.disabled ? 'disabled' : 'active', capabilities: c.capabilities || {} }]))
  const connectionRefs = new Set(connections.map((c) => `server:${c.name}`))
  return bindingProblem({ ...doc, _id: bindingIdOf(doc.surface, doc.scope), status: 'published' }, {
    models: snapshot?.models || {}, prompts: snapshot?.prompts || {}, promptVersions: snapshot?.promptVersions || {},
    codePromptIds: new Set(codePromptIds), connectionRefs, connections: byName,
  })
}

const pickFields = (doc) => Object.fromEntries(FIELDS.filter((key) => doc?.[key] !== undefined).map((key) => [key, doc[key]]))

/** Whether a binding sets nothing (no chain, parameters, prompts, tools or limits, and is on). */
export function isEmptyBinding(doc) {
  return doc.enabled !== false && !doc.chain?.length && !doc.params && !doc.prompts && !doc.tools && !doc.limits
}

/**
 * deps: {
 *   store       store.mjs createControlStore (write: document + audit row + generation)
 *   bindings    the aiBindings collection (findOne, find → toArray)
 *   versions    the aiBindingVersions collection (findOne, find → toArray, updateOne)
 *   snapshot()  the current snapshot
 *   connections() → the server's connections (settings file and app) [{ name, status, capabilities }]
 *   codePromptIds?() → prompt ids with built-in text
 *   breaker?    breaker.mjs (a publish closes the surface's breaker on this pod)
 *   now?()      → Date
 * }
 */
export function createBindingOps({ store, bindings, versions, snapshot, connections, codePromptIds = () => [], breaker = null, now = () => new Date() }) {
  const ctx = async (checkRefs = true) => ({ snapshot: snapshot(), connections: await connections(), codePromptIds: codePromptIds(), checkRefs })

  async function versionsOf(bindingId) {
    const rows = await versions.find({ bindingId }).toArray()
    return rows.sort((a, b) => b.version - a.version)
  }
  async function nextVersion(bindingId) {
    const [rows, head] = await Promise.all([versionsOf(bindingId), bindings.findOne({ _id: bindingId })])
    return Math.max(rows[0]?.version ?? 0, head?.version ?? 0) + 1
  }

  async function writeVersion({ bindingId, version, doc, status, note, actor, action, reason, extra = {} }) {
    const row = { bindingId, version, doc, status, note: note ?? null, createdBy: actor.userId ?? null, createdByPrincipal: actor.principal, createdAt: now(), ...extra }
    await store.write({ kind: 'bindingVersions', id: `${bindingId}@${version}`, doc: row, action, actor, reason, target: { kind: 'binding', id: bindingId } })
    return row
  }

  // makes one version the published head; the version it replaces becomes superseded
  async function publishVersion({ bindingId, version, doc, actor, reason, action }) {
    const previous = await bindings.findOne({ _id: bindingId })
    const head = { ...doc, status: 'published', version, publishedAt: now(), publishedBy: actor.userId ?? null }
    const result = await store.write({ kind: 'bindings', id: bindingId, doc: head, action, actor, reason, target: { kind: 'binding', id: bindingId } })
    await versions.updateOne({ _id: `${bindingId}@${version}` }, { $set: { status: 'published' } })
    if (previous?.version && previous.version !== version) await versions.updateOne({ _id: `${bindingId}@${previous.version}` }, { $set: { status: 'superseded' } })
    breaker?.reset(doc.surface)
    return { bindingId, version, generation: result.generation, binding: { ...head, _id: bindingId } }
  }

  /** Saves a draft: a new version, not live. → { bindingId, version } */
  async function saveDraft({ actor, input, note = null }) {
    const doc = normalizeBinding(input, await ctx(false))
    const bindingId = bindingIdOf(doc.surface, doc.scope)
    const version = await nextVersion(bindingId)
    await writeVersion({ bindingId, version, doc, status: 'draft', note: checkNote(note), actor, action: 'ai.bindings.saveDraft', extra: actor.principal === 'agent' ? { origin: 'ai-proposal' } : {} })
    return { bindingId, version, status: 'draft', binding: doc }
  }

  /**
   * Publishes a binding: a draft by version, or a binding sent with the call (saved as a version
   * and published at once). Checked against what exists now. → { bindingId, version, generation }
   */
  async function publish({ actor, surface, scope = { level: 'server' }, version = null, input = null, reason, note = null, action = 'ai.bindings.publish', extra = {} }) {
    if (!reason || !String(reason).trim()) fail('Say why: publishing needs a reason.')
    if (input) {
      const doc = normalizeBinding({ ...input, surface: input.surface ?? surface, scope: input.scope ?? scope }, await ctx(true))
      const bindingId = bindingIdOf(doc.surface, doc.scope)
      const next = await nextVersion(bindingId)
      await writeVersion({ bindingId, version: next, doc, status: 'published', note: checkNote(note), actor, action, reason, extra })
      return publishVersion({ bindingId, version: next, doc, actor, reason, action })
    }
    const bindingId = bindingIdOf(surface, scope)
    const row = await versions.findOne({ _id: `${bindingId}@${version}` })
    if (!row) fail(`There is no version ${version} of ${bindingId}.`, 404)
    const doc = normalizeBinding(row.doc, await ctx(true))
    return publishVersion({ bindingId, version, doc, actor, reason, action })
  }

  /**
   * Publishes an earlier version again, as a new version. It is checked as a publish is: a version
   * whose model or connection is gone is refused, and the answer offers the built-in AI instead.
   */
  async function rollback({ actor, surface, scope = { level: 'server' }, toVersion, reason }) {
    if (!reason || !String(reason).trim()) fail('Say why: a rollback needs a reason.')
    const bindingId = bindingIdOf(surface, scope)
    const row = await versions.findOne({ _id: `${bindingId}@${toVersion}` })
    if (!row) fail(`There is no version ${toVersion} of ${bindingId}.`, 404)
    let doc
    try {
      doc = normalizeBinding(row.doc, await ctx(true))
    } catch (error) {
      if (error instanceof ModelError) fail(`Version ${toVersion} cannot be published again: ${error.message.replace(/^This binding cannot be published: /, '')} Return ${surfaceById(surface)?.title || surface} to the built-in AI instead (ai.control.reset target binding).`, 409, { builtinInstead: true })
      throw error
    }
    const version = await nextVersion(bindingId)
    await writeVersion({ bindingId, version, doc, status: 'published', note: `Rollback to version ${toVersion}`, actor, action: 'ai.bindings.rollback', reason, extra: { rollbackOf: toVersion } })
    return publishVersion({ bindingId, version, doc, actor, reason, action: 'ai.bindings.rollback' })
  }

  /** Removes a published head (back to what it follows, the settings file and built-in AI). Versions stay. */
  async function remove({ actor, surface, scope = { level: 'server' }, reason, action = 'ai.control.reset' }) {
    const bindingId = bindingIdOf(surface, scope)
    const head = await bindings.findOne({ _id: bindingId })
    if (!head) return { bindingId, removed: false }
    const result = await store.write({ kind: 'bindings', id: bindingId, doc: null, action, actor, reason, target: { kind: 'binding', id: bindingId } })
    if (head.version) await versions.updateOne({ _id: `${bindingId}@${head.version}` }, { $set: { status: 'superseded' } })
    breaker?.reset(surface)
    return { bindingId, removed: true, generation: result.generation }
  }

  /** Every server binding head. */
  async function heads() {
    return (await bindings.find({}).toArray()).filter((doc) => doc.scope?.level === 'server')
  }

  /**
   * The bindings page: each bindable surface with its published head (as stored, even one the
   * snapshot skipped), its versions newest first (at most `limit`), and why the snapshot skipped it.
   */
  async function list({ limit = 20 } = {}) {
    const snap = snapshot()
    const stored = Object.fromEntries((await heads()).map((doc) => [doc._id, doc]))
    const out = []
    for (const id of BINDABLE_SURFACES) {
      const bindingId = bindingIdOf(id)
      const rows = await versionsOf(bindingId)
      const skipped = (snap.health || []).find((h) => h.kind === 'binding' && h.id === bindingId)
      out.push({
        surface: id, bindingId, head: stored[bindingId] ?? null,
        versions: rows.slice(0, limit).map((row) => ({ version: row.version, status: row.status, note: row.note ?? null, createdBy: row.createdBy ?? null, createdAt: row.createdAt ?? null, rollbackOf: row.rollbackOf ?? null, origin: row.origin ?? null, doc: row.doc })),
        ...(skipped && { skipped: skipped.problem }),
      })
    }
    return { generation: snap.generation, surfaces: out }
  }

  /**
   * ai.update at the server level writes the server's bindings too (spec 4: a thin wrapper), so a
   * choice made in AI settings and a published binding never disagree. changes: { [surface]: ref |
   * null } (server:<name>, builtin, or null to clear). A binding keeps its other fields; one left
   * with nothing set is removed.
   */
  async function syncServerUse({ actor, changes, reason = null }) {
    const done = []
    for (const [surface, ref] of Object.entries(changes || {})) {
      if (!BINDABLE_SURFACES.includes(surface)) continue
      const bindingId = bindingIdOf(surface)
      const head = await bindings.findOne({ _id: bindingId })
      if (!head && ref === null) continue
      const doc = { ...pickFields(head || {}), surface, scope: { level: 'server' }, enabled: head?.enabled ?? true }
      if (ref === null) delete doc.chain
      else doc.chain = [{ connection: ref === 'builtin' ? 'builtin' : ref }]
      if (head && isEmptyBinding(doc)) {
        await remove({ actor, surface, reason, action: 'ai.bindings.sync' })
        done.push({ surface, removed: true })
        continue
      }
      const checked = normalizeBinding(doc, await ctx(true))
      const version = await nextVersion(bindingId)
      await writeVersion({ bindingId, version, doc: checked, status: 'published', note: 'From AI settings', actor, action: 'ai.bindings.sync', reason, extra: { origin: 'ai.update' } })
      await publishVersion({ bindingId, version, doc: checked, actor, reason, action: 'ai.bindings.sync' })
      done.push({ surface, version })
    }
    return done
  }

  return { saveDraft, publish, rollback, remove, list, heads, versionsOf, syncServerUse, normalize: async (input, checkRefs = true) => normalizeBinding(input, await ctx(checkRefs)) }
}

function checkNote(note) {
  if (note === null || note === undefined) return null
  if (typeof note !== 'string' || note.length > NOTE_MAX || /[\r\n]/.test(note)) fail(`note is one line of at most ${NOTE_MAX} characters.`)
  return note.trim() || null
}

/**
 * The tighter estimate and ceiling a published server binding sets for a meter feature
 * (metering/prices.mjs setLimitSource): the binding of the surface that owns the meter feature,
 * then what it follows. → { estimate, ceiling } (each null when no binding sets one)
 */
export function limitsFor(snapshot, meterFeature) {
  const owner = SURFACES.find((s) => s.meterFeatures.includes(meterFeature))
  if (!owner || snapshot?.dbLayer === 'off') return { estimate: null, ceiling: null }
  const out = { estimate: null, ceiling: null }
  for (let at = owner; at; at = surfaceById(at.follows)) {
    const limits = snapshot?.bindings?.[`${at.id}|server`]?.limits
    for (const key of ['estimate', 'ceiling']) {
      const value = limits?.[key]
      if (Number.isFinite(value) && (out[key] === null || value < out[key])) out[key] = value
    }
  }
  return out
}

export { CODE_PARAMS }
