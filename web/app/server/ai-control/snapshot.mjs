// The AI control snapshot: every document of the AI configuration (providers, which provider has
// an active key (never the key), models, the one binding per part of Slatebox, prompt heads with
// their published versions, agents and the global switch), checked one document at a time and
// frozen. resolve.mjs reads only this, so a request never waits on the database for its route.
//
// Safety: a document that fails its checks is skipped and named in `health`; that part uses the
// default binding, then the built-in default. A reload that throws keeps the last good snapshot. A
// cold start with the database down runs on the built-in default (Meta Muse Ember), with the key a
// settings file still held if it could not be moved yet (keys.mjs keepFromSettings).
//
// Pure apart from the injected readers and timers: index.mjs gives it the Meteor collections.
import { SURFACES, surface as surfaceById } from './catalogue.mjs'
import { checkVariables, parseTemplate } from './render.mjs'
import { BUILTIN_PROVIDERS, PROTOCOLS, ProviderError, normalizeProvider } from './providers.mjs'

export { PROTOCOLS }
export const PROMPT_KINDS = Object.freeze(['system', 'user', 'retry', 'tool-description', 'mcp-instructions', 'mcp-prompt', 'envelope'])
export const AGENT_KINDS = Object.freeze(['builtin-agent', 'inbound-mcp', 'outbound-connector'])
export const BINDING_USES = Object.freeze(['model', 'off'])
export const POLL_MS = 5000
const MAX_BACKOFF_MS = 60000
const PROMPT_ID = /^[a-z0-9][a-z0-9_.-]{0,95}$/
const ID_CHARS = /^[A-Za-z0-9_.:/@|-]{1,260}$/
const CAPS = ['tools', 'vision', 'images', 'json', 'reasoning']

const DEFAULT_STATE = Object.freeze({ generation: 0, aiEnabled: true, aiDisabledMessage: null })

function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value) || value instanceof Date) return value
  for (const inner of Object.values(value)) frozen(inner)
  return Object.freeze(value)
}

/** The snapshot with no documents: every part resolves to the built-in default. */
export function emptySnapshot({ source = 'empty', health = [], generation = 0, global = null } = {}) {
  return frozen({
    generation, source, loadedAt: null,
    state: { ...DEFAULT_STATE, ...(global && { aiEnabled: global.aiEnabled !== false, aiDisabledMessage: global.aiDisabledMessage ?? null }), generation },
    providers: {}, keys: {}, models: {}, bindings: {}, prompts: {}, promptVersions: {}, agents: {},
    health,
  })
}
export const EMPTY_SNAPSHOT = emptySnapshot()

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isInt = (value) => Number.isInteger(value) && value >= 0

/** A model row's id: <provider>:<model>. */
export const modelId = (provider, model) => `${provider}:${model}`

// ---------- per-document checks: each returns a problem sentence, or null ----------
function providerProblem(doc) {
  if (BUILTIN_PROVIDERS[doc._id]) return `${doc._id} is a service of this server, not a model provider`
  try {
    normalizeProvider(doc)
  } catch (error) {
    if (error instanceof ProviderError) return error.message
    throw error
  }
  return null
}

function capabilitiesProblem(caps) {
  if (caps === undefined || caps === null) return null
  if (!isObject(caps)) return 'capabilities is an object of true/false flags'
  for (const [key, value] of Object.entries(caps)) if (!CAPS.includes(key) || typeof value !== 'boolean') return `capability ${key} is not a true/false flag this build knows`
  return null
}

function modelProblem(doc, providers) {
  if (!ID_CHARS.test(doc._id || '')) return 'a model id is <provider>:<model>'
  if (typeof doc.model !== 'string' || !doc.model) return 'a model names the model it serves'
  if (typeof doc.provider !== 'string' || !providers[doc.provider]) return `provider ${doc.provider} does not exist`
  if (doc._id !== modelId(doc.provider, doc.model)) return `the id should be ${modelId(doc.provider, doc.model)}`
  if (doc.status !== undefined && !['enabled', 'disabled'].includes(doc.status)) return 'status is enabled or disabled'
  const caps = capabilitiesProblem(doc.capabilities)
  if (caps) return caps
  if (doc.prices != null) {
    if (!isObject(doc.prices)) return 'prices is an object'
    for (const key of ['inputPerM', 'outputPerM', 'imageEach']) {
      const value = doc.prices[key]
      if (value !== undefined && value !== null && !(Number.isFinite(value) && value >= 0)) return `prices.${key} is a price of 0 or more`
    }
  }
  return null
}

/** What a part of Slatebox needs that a model cannot do, or null. */
export function capabilityGap(surfaceId, model) {
  const at = surfaceById(surfaceId)
  const caps = model?.capabilities || {}
  return (at?.needs || []).find((need) => (need === 'images' ? caps.images !== true : caps[need] === false)) || null
}

function bindingProblem(doc, { models }) {
  const at = surfaceById(doc.surface)
  if (!at || !at.useKey) return `${doc.surface} is not a part of Slatebox that can be bound`
  if (doc._id !== doc.surface) return `the id should be ${doc.surface}`
  if (!BINDING_USES.includes(doc.use)) return 'use is model or off'
  if (doc.use === 'off') return doc.surface === 'default' ? 'everything not set cannot be turned off here; use the switch for everyone' : null
  const model = models[doc.model]
  if (!model) return `model ${doc.model} does not exist`
  if (model.status === 'disabled') return `model ${doc.model} is disabled`
  const gap = capabilityGap(doc.surface, model)
  if (gap) return `${doc.model} cannot do ${gap}, which ${at.title.toLowerCase()} needs`
  return null
}

function promptProblem(head, version) {
  if (!PROMPT_ID.test(head._id || '')) return 'a prompt id is a dotted slug'
  if (head.kind !== undefined && !PROMPT_KINDS.includes(head.kind)) return `kind ${head.kind} is not a prompt kind`
  const published = head.labels?.published ?? null
  if (published === null) return null
  if (!isInt(published) || published < 1) return 'labels.published is a version number or null'
  if (!version) return `published version ${published} is missing`
  return promptVersionProblem(version)
}

function promptVersionProblem(version) {
  if (typeof version.body !== 'string') return 'a prompt version has a body'
  if (version.body.length > 32 * 1024) return 'a prompt body is at most 32 KB'
  try {
    parseTemplate(version.body)
  } catch (error) {
    return error.message
  }
  const problems = checkVariables(version.variables)
  return problems.length ? problems[0] : null
}

function agentProblem(doc) {
  if (!ID_CHARS.test(doc._id || '')) return 'an agent id is a slug'
  if (!AGENT_KINDS.includes(doc.kind)) return `kind ${doc.kind} is not an agent kind`
  if (doc.enabled !== undefined && typeof doc.enabled !== 'boolean') return 'enabled is true or false'
  return null
}

const parsePin = (ref) => {
  const match = typeof ref === 'string' && /^([^@]+)(?:@(\d+))?$/.exec(ref)
  return match ? { id: match[1], version: match[2] ? Number(match[2]) : null } : null
}
export { parsePin as parsePromptRef }
export { bindingProblem }

/**
 * Builds a snapshot from raw documents. raw: { state, providers[], keys: { [provider]: { id,
 * keyFingerprint } }, models[], bindings[], prompts[], promptVersions[], agents[] }. Each document
 * that fails is skipped and named in health.
 */
export function buildSnapshot(raw = {}, { now = Date.now, source = 'db' } = {}) {
  const health = []
  const skip = (kind, id, problem) => health.push({ kind, id: String(id ?? '(no id)').slice(0, 200), problem })
  const state = { ...DEFAULT_STATE, ...(isObject(raw.state) ? raw.state : {}) }
  if (!isInt(state.generation)) state.generation = 0
  if (typeof state.aiEnabled !== 'boolean') state.aiEnabled = true
  delete state._id

  const pick = (list, kind, problemOf, keyOf = (doc) => doc._id) => {
    const out = {}
    for (const doc of Array.isArray(list) ? list : []) {
      if (!isObject(doc)) continue
      const problem = problemOf(doc)
      if (problem) skip(kind, keyOf(doc), problem)
      else out[keyOf(doc)] = doc
    }
    return out
  }

  const providers = pick(raw.providers, 'provider', providerProblem)
  // which provider has an active key: never a key or a cipher
  const keys = {}
  for (const [provider, summary] of Object.entries(isObject(raw.keys) ? raw.keys : {})) {
    if (isObject(summary)) keys[provider] = { id: String(summary.id ?? ''), keyFingerprint: summary.keyFingerprint ?? null }
  }
  const models = pick(raw.models, 'model', (doc) => modelProblem(doc, providers))
  const allVersions = {}
  for (const version of Array.isArray(raw.promptVersions) ? raw.promptVersions : []) {
    if (isObject(version) && typeof version.promptId === 'string' && isInt(version.version)) allVersions[`${version.promptId}@${version.version}`] = version
  }
  const prompts = pick(raw.prompts, 'prompt', (head) => promptProblem(head, allVersions[`${head._id}@${head.labels?.published}`]))
  const promptVersions = {}
  for (const head of Object.values(prompts)) {
    const published = head.labels?.published
    if (published) promptVersions[`${head._id}@${published}`] = allVersions[`${head._id}@${published}`]
  }
  const bindings = pick(raw.bindings, 'binding', (doc) => bindingProblem(doc, { models }))
  const agents = pick(raw.agents, 'agent', agentProblem)

  return frozen({
    generation: state.generation, source, loadedAt: now(), state,
    providers, keys, models, bindings, prompts, promptVersions, agents, health,
  })
}

/**
 * Holds the current snapshot and keeps it fresh. read: { generation() → number|null (one indexed
 * findOne), all() → raw documents for buildSnapshot }. Every pollMs it reads the generation; when
 * it changed it reloads in the background and swaps (stale-while-revalidate). A pod that writes
 * calls refresh({ force: true }) and swaps at once.
 */
export function createSnapshotHolder({ read, pollMs = POLL_MS, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now, log = console }) {
  let current = null
  let lastGood = null
  let loading = null
  let timer = null
  let failures = 0
  let warnedCold = false
  let stopped = true

  const build = async () => buildSnapshot(await read.all(), { now, source: 'db' })

  async function reload() {
    try {
      const next = await build()
      current = next
      lastGood = next
      failures = 0
      return next
    } catch (error) {
      failures += 1
      if (lastGood) {
        log.warn?.(`ai-control: reload failed, keeping generation ${lastGood.generation}: ${error.message}`)
        current = lastGood
      } else {
        if (!warnedCold) log.warn?.(`ai-control: running on the built-in default (${error.message})`)
        warnedCold = true
        current = emptySnapshot({ source: 'builtin', health: [{ kind: 'snapshot', id: 'load', problem: 'The AI settings could not be read; every part uses the built-in default (Meta Muse Ember).' }] })
      }
      return current
    }
  }

  function refresh({ force = false } = {}) {
    if (loading) return loading
    loading = (async () => {
      try {
        if (!force && current && lastGood) {
          const generation = await read.generation()
          if (generation === lastGood.generation) {
            failures = 0
            return current
          }
        }
        return await reload()
      } catch (error) {
        failures += 1
        log.warn?.(`ai-control: generation check failed: ${error.message}`)
        if (!current) current = emptySnapshot({ source: 'builtin' })
        return current
      } finally {
        loading = null
      }
    })()
    return loading
  }

  function schedule() {
    if (stopped) return
    const wait = failures ? Math.min(pollMs * 2 ** failures, MAX_BACKOFF_MS) : pollMs
    timer = setTimer(async () => {
      await refresh()
      schedule()
    }, wait)
    timer?.unref?.()
  }

  return {
    /** The snapshot now (the empty one until the first load finishes). */
    current: () => current || EMPTY_SNAPSHOT,
    /** The first load, or the current one when already loaded. */
    ready: () => (current ? Promise.resolve(current) : refresh()),
    refresh,
    start() {
      if (!stopped) return
      stopped = false
      refresh().finally(schedule)
    },
    stop() {
      stopped = true
      if (timer) clearTimer(timer)
      timer = null
    },
  }
}

/** Surfaces this build serves (for summaries): the catalogue rows in this build. */
export const SURFACES_IN_BUILD = Object.freeze(SURFACES.filter((s) => s.inBuild).map((s) => s.id))
