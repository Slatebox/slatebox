// The AI control snapshot: every published document of the DB layer (providers, server
// connections without their keys, models, bindings, prompt heads with their published versions,
// agents and the global state), checked one document at a time and frozen. resolve.mjs reads only
// this, so a request never waits on the database for AI configuration.
//
// Safety (spec 2.3): a document that fails its checks is skipped and named in `health`; resolution
// falls through to the settings file and code for that surface only. A reload that throws keeps
// the last good snapshot. A cold start with the database down runs on the settings file and code.
// settings.ai.control.dbLayer 'off' (file, restart) never reads the DB layer at all; the global
// state's dbLayer 'off' (runtime) ignores its documents.
//
// Pure apart from the injected readers and timers: index.mjs gives it the Meteor collections.
import { SURFACES, surface as surfaceById } from './catalogue.mjs'
import { checkVariables, parseTemplate } from './render.mjs'

export const PROTOCOLS = Object.freeze(['openai-chat', 'anthropic-messages', 'openai-images', 'stability-images'])
export const SCOPE_LEVELS = Object.freeze(['server', 'plan', 'team', 'me'])
export const FAILURE_CLASSES = Object.freeze(['infra', 'shape', 'context', 'any'])
export const PROMPT_KINDS = Object.freeze(['system', 'user', 'retry', 'tool-description', 'mcp-instructions', 'mcp-prompt', 'envelope'])
export const AGENT_KINDS = Object.freeze(['builtin-agent', 'inbound-mcp', 'outbound-connector'])
export const POLL_MS = 5000
const MAX_BACKOFF_MS = 60000
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/
const PROMPT_ID = /^[a-z0-9][a-z0-9_.-]{0,95}$/
const ID_CHARS = /^[A-Za-z0-9_.:/@|-]{1,200}$/
const CAPS = ['tools', 'vision', 'images', 'json', 'reasoning']

/** The file switch: settings.ai.control.dbLayer, 'on' (the default) or 'off'. Throws on anything else. */
export function fileDbLayer(settings = {}) {
  const value = settings?.ai?.control?.dbLayer
  if (value === undefined || value === null) return 'on'
  if (value !== 'on' && value !== 'off') throw new Error('settings ai.control.dbLayer is on or off')
  return value
}

const DEFAULT_STATE = Object.freeze({ generation: 0, aiEnabled: true, aiDisabledMessage: null, dbLayer: 'on' })

function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const inner of Object.values(value)) frozen(inner)
  return Object.freeze(value)
}

/** The snapshot with no DB layer: resolution uses the settings file and code only. */
export function emptySnapshot({ dbLayer = 'on', source = 'empty', health = [], generation = 0 } = {}) {
  return frozen({
    generation, dbLayer, source, loadedAt: null,
    state: { ...DEFAULT_STATE, generation, dbLayer },
    providers: {}, connections: {}, models: {}, bindings: {}, prompts: {}, promptVersions: {}, agents: {},
    health,
  })
}
export const EMPTY_SNAPSHOT = emptySnapshot()

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isInt = (value) => Number.isInteger(value) && value >= 0
const optionalPositive = (value) => value === undefined || value === null || (Number.isFinite(value) && value > 0)

/** scope { level, id? } -> the key in a binding's _id: server | plan:<id> | team:<id> | me:<id>. */
export function scopeKey(scope) {
  if (!isObject(scope) || !SCOPE_LEVELS.includes(scope.level)) return null
  if (scope.level === 'server') return 'server'
  return typeof scope.id === 'string' && ID_CHARS.test(scope.id) ? `${scope.level}:${scope.id}` : null
}
export const bindingId = (surfaceId, scope) => `${surfaceId}|${scopeKey(scope)}`

// ---------- per-document checks: each returns a problem sentence, or null ----------
function providerProblem(doc) {
  if (!SLUG.test(doc._id || '')) return 'a provider id is lowercase letters, digits and dashes'
  if (!PROTOCOLS.includes(doc.protocol)) return `protocol ${doc.protocol} is not one this build speaks`
  if (doc.baseUrl != null && typeof doc.baseUrl !== 'string') return 'baseUrl is an address'
  if (doc.status !== undefined && !['active', 'archived'].includes(doc.status)) return 'status is active or archived'
  return null
}

function connectionProblem(doc) {
  if (!SLUG.test(doc.name || '')) return 'a connection name is lowercase letters, digits and dashes'
  if (typeof doc.provider !== 'string' || !doc.provider) return 'a connection names its provider'
  if (doc.status !== undefined && !['active', 'disabled'].includes(doc.status)) return 'status is active or disabled'
  return null
}

function capabilitiesProblem(caps) {
  if (caps === undefined || caps === null) return null
  if (!isObject(caps)) return 'capabilities is an object of true/false flags'
  for (const [key, value] of Object.entries(caps)) if (!CAPS.includes(key) || typeof value !== 'boolean') return `capability ${key} is not a true/false flag this build knows`
  return null
}

function modelProblem(doc, connectionRefs) {
  if (!ID_CHARS.test(doc._id || '')) return 'a model id is <connection>:<model>'
  if (typeof doc.model !== 'string' || !doc.model) return 'a model names the model it serves'
  if (typeof doc.connection !== 'string' || !connectionRefs.has(doc.connection)) return `connection ${doc.connection} does not exist`
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

function bindingProblem(doc, { models, prompts, promptVersions, codePromptIds }) {
  const at = surfaceById(doc.surface)
  if (!at || !at.useKey) return `${doc.surface} is not a surface that can be bound`
  const key = scopeKey(doc.scope)
  if (!key) return 'scope is server, plan, team or me (with an id)'
  if (doc._id !== `${doc.surface}|${key}`) return `the id should be ${doc.surface}|${key}`
  if (doc.status !== undefined && doc.status !== 'published') return 'only a published binding is used'
  if (doc.enabled !== undefined && typeof doc.enabled !== 'boolean') return 'enabled is true or false'
  const inner = doc.scope.level === 'team' || doc.scope.level === 'me'
  if (inner && (doc.params || doc.prompts || doc.tools || doc.limits)) return 'a team or person binding sets only its models and on/off'
  if (doc.chain !== undefined) {
    if (!Array.isArray(doc.chain)) return 'chain is a list of models'
    for (const [index, entry] of doc.chain.entries()) {
      const model = models[entry?.model]
      if (!model) return `chain ${index + 1}: model ${entry?.model} does not exist`
      if (model.status === 'disabled') return `chain ${index + 1}: model ${entry.model} is disabled`
      if (entry.on !== undefined && (!Array.isArray(entry.on) || entry.on.some((c) => !FAILURE_CLASSES.includes(c)))) return `chain ${index + 1}: on is a list of ${FAILURE_CLASSES.join(', ')}`
      const caps = model.capabilities || {}
      const gap = at.needs.find((need) => (need === 'images' ? caps.images !== true : caps[need] === false))
      if (gap) return `chain ${index + 1}: ${entry.model} cannot do ${gap}, which ${at.id} needs`
    }
  }
  if (doc.params !== undefined && doc.params !== null) {
    if (!isObject(doc.params)) return 'params is an object'
    for (const key of ['maxTokens', 'timeoutMs']) if (!optionalPositive(doc.params[key])) return `params.${key} is a number above 0`
    for (const key of ['infraRetries', 'shapeRetries']) if (doc.params[key] != null && !(isInt(doc.params[key]) && doc.params[key] <= 10)) return `params.${key} is a whole number from 0 to 10`
    if (doc.params.temperature != null && !(Number.isFinite(doc.params.temperature) && doc.params.temperature >= 0 && doc.params.temperature <= 2)) return 'params.temperature is from 0 to 2'
  }
  if (doc.prompts !== undefined && doc.prompts !== null) {
    if (!isObject(doc.prompts)) return 'prompts is an object of slot: prompt id'
    for (const [slot, ref] of Object.entries(doc.prompts)) {
      const pin = parsePin(ref)
      if (!pin) return `prompt slot ${slot} names no prompt`
      const known = prompts[pin.id] || codePromptIds.has(pin.id)
      if (!known) return `prompt ${pin.id} does not exist`
      if (pin.version && !promptVersions[`${pin.id}@${pin.version}`]) return `prompt ${pin.id}@${pin.version} does not exist`
    }
  }
  if (doc.tools !== undefined && doc.tools !== null) {
    if (!isObject(doc.tools)) return 'tools is an object'
    if (doc.tools.mode != null && !['forced', 'auto', 'none'].includes(doc.tools.mode)) return 'tools.mode is forced, auto or none'
    if (doc.tools.allow != null && (!Array.isArray(doc.tools.allow) || doc.tools.allow.some((t) => typeof t !== 'string'))) return 'tools.allow is a list of tool names'
  }
  if (doc.limits !== undefined && doc.limits !== null) {
    if (!isObject(doc.limits)) return 'limits is an object'
    for (const key of ['estimate', 'ceiling']) if (!optionalPositive(doc.limits[key])) return `limits.${key} is an amount above 0`
  }
  return null
}

/**
 * Builds a snapshot from raw documents. raw: { state, providers[], connections[], models[],
 * bindings[], prompts[], promptVersions[], agents[] }; fileConnections: the names of the settings
 * file's connections (a model may name server:<file connection>); codePromptIds: prompt ids with
 * built-in text. Each document that fails is skipped and named in health.
 */
export function buildSnapshot(raw = {}, { fileConnections = [], codePromptIds = [], now = Date.now, source = 'db' } = {}) {
  const health = []
  const skip = (kind, id, problem) => health.push({ kind, id: String(id ?? '(no id)').slice(0, 200), problem })
  const state = { ...DEFAULT_STATE, ...(isObject(raw.state) ? raw.state : {}) }
  if (!isInt(state.generation)) state.generation = 0
  if (typeof state.aiEnabled !== 'boolean') state.aiEnabled = true
  if (state.dbLayer !== 'off') state.dbLayer = 'on'
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

  // A dbLayer switched off at runtime ignores every document but keeps counting generations.
  if (state.dbLayer === 'off') return emptySnapshot({ dbLayer: 'off', source, generation: state.generation })

  const providers = pick(raw.providers, 'provider', providerProblem)
  // server connections: never a key, a cipher or anything sealed
  const connections = pick((raw.connections || []).map((doc) => (isObject(doc) ? {
    name: doc.name, provider: doc.provider, baseUrl: doc.baseUrl ?? null, model: doc.model ?? null,
    capabilities: doc.capabilities || {}, status: doc.status ?? 'active', keyFingerprint: doc.keyFingerprint ?? null,
    hasKey: Boolean(doc.cipher || doc.hasKey), keyRef: doc.keyRef?.kind ? { kind: doc.keyRef.kind, ...(doc.keyRef.kind === 'env' && { name: doc.keyRef.name }) } : null,
  } : doc)), 'connection', connectionProblem, (doc) => doc.name)
  const connectionRefs = new Set([
    ...Object.keys(connections).map((name) => `server:${name}`),
    ...fileConnections.map((name) => `server:${name}`),
    ...['deepinfra', 'openai', 'anthropic', 'stabilityai'].map((p) => `builtin:${p}`),
  ])
  const models = pick(raw.models, 'model', (doc) => modelProblem(doc, connectionRefs))
  const allVersions = {}
  for (const version of Array.isArray(raw.promptVersions) ? raw.promptVersions : []) {
    if (isObject(version) && typeof version.promptId === 'string' && isInt(version.version)) allVersions[`${version.promptId}@${version.version}`] = version
  }
  const prompts = pick(raw.prompts, 'prompt', (head) => promptProblem(head, allVersions[`${head._id}@${head.labels?.published}`]))
  // only the versions something uses: the published ones, and any a binding pins (checked below)
  const promptVersions = {}
  for (const head of Object.values(prompts)) {
    const published = head.labels?.published
    if (published) promptVersions[`${head._id}@${published}`] = allVersions[`${head._id}@${published}`]
  }
  for (const doc of Array.isArray(raw.bindings) ? raw.bindings : []) {
    for (const ref of Object.values(isObject(doc?.prompts) ? doc.prompts : {})) {
      const pin = parsePin(ref)
      const version = pin?.version && allVersions[`${pin.id}@${pin.version}`]
      if (version && !promptVersionProblem(version)) promptVersions[`${pin.id}@${pin.version}`] = version
    }
  }
  const codeIds = new Set(codePromptIds)
  const bindings = pick(raw.bindings, 'binding', (doc) => bindingProblem(doc, { models, prompts, promptVersions, codePromptIds: codeIds }))
  const agents = pick(raw.agents, 'agent', agentProblem)

  return frozen({
    generation: state.generation, dbLayer: 'on', source, loadedAt: now(), state,
    providers, connections, models, bindings, prompts, promptVersions, agents, health,
  })
}

/**
 * Holds the current snapshot and keeps it fresh. read: { generation() → number|null (one indexed
 * findOne), all() → raw documents for buildSnapshot }. Every pollMs it reads the generation; when
 * it changed it reloads in the background and swaps (stale-while-revalidate). A pod that writes
 * calls refresh({ force: true }) and swaps at once.
 */
export function createSnapshotHolder({
  read, settings = {}, codePromptIds = () => [], fileConnections = () => [], pollMs = POLL_MS,
  setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now, log = console,
}) {
  const fileSwitch = fileDbLayer(settings)
  let current = fileSwitch === 'off' ? emptySnapshot({ dbLayer: 'off', source: 'file-switch' }) : null
  let lastGood = null
  let loading = null
  let timer = null
  let failures = 0
  let warnedCold = false
  let stopped = true

  const build = async () => buildSnapshot(await read.all(), {
    fileConnections: fileConnections(), codePromptIds: codePromptIds(), now, source: 'db',
  })

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
        if (!warnedCold) log.warn?.(`ai-control: running without DB layer (${error.message})`)
        warnedCold = true
        current = emptySnapshot({ source: 'file+code', health: [{ kind: 'snapshot', id: 'load', problem: 'The AI control settings could not be read; the settings file and built-in defaults apply.' }] })
      }
      return current
    }
  }

  function refresh({ force = false } = {}) {
    if (fileSwitch === 'off') return Promise.resolve(current)
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
        // the generation read itself failed: keep what there is
        failures += 1
        log.warn?.(`ai-control: generation check failed: ${error.message}`)
        if (!current) current = emptySnapshot({ source: 'file+code' })
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
      if (!stopped || fileSwitch === 'off') return
      stopped = false
      refresh().finally(schedule)
    },
    stop() {
      stopped = true
      if (timer) clearTimer(timer)
      timer = null
    },
    fileSwitch,
  }
}

/** Surfaces this build serves (for summaries): the catalogue rows in this build. */
export const SURFACES_IN_BUILD = Object.freeze(SURFACES.filter((s) => s.inBuild).map((s) => s.id))
