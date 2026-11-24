// The action registry: the one place an action is declared. From a definition the app mounts
// the Meteor method the UI calls (ddp.mjs) and the /api/v1 route (http.mjs), and generates the
// OpenAPI document (openapi.mjs) and the tool and CLI contract (contract.mjs).
//
// The registry, not the action, owns: who may call (principals and scopes), the rate limit,
// input validation, the write mode, the idempotency record and comparison, and the error shape.
import { createHash } from 'node:crypto'
import { ActionError, problem, toActionError } from './errors.mjs'
import { validate } from './schema.mjs'
import { principalFromVisitor } from './principal.mjs'

export const CONTRACT_VERSION = '1.0'
export const PRINCIPAL_KINDS = ['person', 'guest', 'agent', 'visitor']
export const WRITE_MODES = ['save', 'preview', 'propose']
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const IDEMPOTENCY = ['none', 'optional', 'required']
const KEY_PATTERN = /^[!-~]{1,128}$/

const fail = (id, message) => {
  throw new Error(`Action ${id || '(unnamed)'}: ${message}`)
}

export function pathParams(path) {
  return [...path.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1])
}

// Checks a definition once, at start, so a mistake fails the boot and not a caller.
export function defineAction(definition) {
  const {
    id,
    title,
    description,
    toolset,
    kind,
    scope = null,
    // Scopes the handler may check as well, for some inputs (ai:admin for a team's AI). Declared
    // so the scopes a connection may need are known from the actions alone.
    alsoScopes = [],
    principals = ['person'],
    mounts = { ddp: true },
    input,
    output,
    handler,
  } = definition
  if (typeof id !== 'string' || !/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/.test(id))
    fail(id, 'needs an id of the form area.verb')
  if (typeof title !== 'string' || !title) fail(id, 'needs a title')
  if (typeof description !== 'string' || !description) fail(id, 'needs a description')
  if (typeof toolset !== 'string' || !toolset) fail(id, 'needs a toolset')
  if (!['read', 'write'].includes(kind)) fail(id, 'kind must be read or write')
  if (typeof handler !== 'function') fail(id, 'needs a handler')
  if (!principals.length || principals.some((p) => !PRINCIPAL_KINDS.includes(p)))
    fail(id, 'principals must be person, guest, agent or visitor')
  if (input?.type !== 'object' || typeof input.properties !== 'object')
    fail(id, 'input must be an object schema with properties')
  if (input.additionalProperties !== false)
    fail(id, 'input must refuse fields it does not declare')
  if (!output || typeof output !== 'object') fail(id, 'needs an output schema')
  if (Object.hasOwn(input.properties, 'mode')) fail(id, 'mode belongs to the registry, not to the input')
  if (input.oneOf && (mounts.http ? pathParams(mounts.http.path).length : 0))
    fail(id, 'an input with several forms carries body fields only')

  if (!Array.isArray(alsoScopes) || alsoScopes.some((item) => typeof item !== 'string' || !item))
    fail(id, 'alsoScopes is a list of scope names')

  const destructive = Boolean(definition.destructive)
  const openWorld = Boolean(definition.openWorld)
  // readOnly on a write: it changes nothing (it is a POST only because its input carries a key
  // or it reaches an outside address). It is shown as read-only and is never destructive.
  if (definition.readOnly !== undefined && typeof definition.readOnly !== 'boolean') fail(id, 'readOnly is true or false')
  if (kind === 'write' && definition.readOnly && (definition.destructive || definition.confirm))
    fail(id, 'a write that changes nothing is neither destructive nor confirmed')
  // changesNoSlate on a write: it changes no slate (so the exec gate lets it run in an in-app
  // conversation and does not hold it as widening access) but is not read-only, because it
  // spends or creates something (drawing shapes spends AI and fills the shape library).
  if (definition.changesNoSlate !== undefined && typeof definition.changesNoSlate !== 'boolean')
    fail(id, 'changesNoSlate is true or false')
  if (definition.changesNoSlate && (kind !== 'write' || definition.destructive || definition.confirm))
    fail(id, 'changesNoSlate is for a write that is neither destructive nor confirmed')
  // precheck(principal, input): a refusal the handler would make that depends only on who calls
  // and what they ask (a permission), run before a change is held, so it is refused at once.
  if (definition.precheck != null && typeof definition.precheck !== 'function') fail(id, 'precheck is a function')
  // removes(input): for a destructive action whose calls do not all remove something, which do.
  // The exec gate names "removes" as the reason to hold only for those (destructive stays the hint).
  if (definition.removes != null && (typeof definition.removes !== 'function' || !definition.destructive))
    fail(id, 'removes is a function, on a destructive action')
  const confirm = Boolean(definition.confirm)
  const idempotent = kind === 'read' ? true : Boolean(definition.idempotent)
  const modes = kind === 'read' ? [] : definition.modes || ['save']
  const idempotency = kind === 'read' ? 'none' : definition.idempotency || 'none'
  const replay = idempotency === 'none' ? null : definition.replay || 'stored'
  if (kind === 'read' && (definition.destructive || definition.modes || definition.idempotency))
    fail(id, 'a read takes no write mode, idempotency key or destructive flag')
  if (kind === 'write' && (!modes.includes('save') || modes.some((mode) => !WRITE_MODES.includes(mode))))
    fail(id, 'a write must save and may also preview or propose')
  if (!IDEMPOTENCY.includes(idempotency)) fail(id, 'idempotency must be none, optional or required')
  if (replay && !['stored', 'rerun'].includes(replay)) fail(id, 'replay must be stored or rerun')

  const http = mounts.http || null
  if (http) {
    if (!HTTP_METHODS.includes(http.method)) fail(id, 'http method is not supported')
    if (typeof http.path !== 'string' || !http.path.startsWith('/'))
      fail(id, 'http path must start with /')
    if (!principals.includes('agent')) fail(id, 'an HTTP route is called by a token (agent)')
    for (const param of pathParams(http.path)) {
      if (!Object.hasOwn(input.properties, param) || !(input.required || []).includes(param))
        fail(id, `path parameter ${param} must be a required input`)
    }
    if (kind === 'read' && http.method !== 'GET') fail(id, 'a read is a GET')
    if (kind === 'write' && http.method === 'GET') fail(id, 'a write is never a GET')
  }
  // A visitor has no account and no token: it may only read what a token may also read, and
  // the read has an HTTP route.
  if (principals.includes('visitor') && (kind !== 'read' || !mounts.http || !principals.includes('agent')))
    fail(id, 'a visitor only reads what a token may also read, and the read has an HTTP route')
  if (mounts.ddp && !principals.some((p) => p !== 'agent' && p !== 'visitor'))
    fail(id, 'a Meteor method is called by a signed-in session')
  if (!http && definition.tool)
    fail(id, 'tools and commands call the HTTP route, so the action needs one')
  if (definition.tool) {
    const { name, title: toolTitle, description: toolDescription, ...rest } = definition.tool
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(name))
      fail(id, 'tool.name is snake_case, at most 64 characters')
    if (toolTitle !== undefined && (typeof toolTitle !== 'string' || !toolTitle)) fail(id, 'tool.title is text')
    if (toolDescription !== undefined && (typeof toolDescription !== 'string' || !toolDescription))
      fail(id, 'tool.description is text')
    if (Object.keys(rest).length) fail(id, `tool takes name, title and description, not ${Object.keys(rest).join(', ')}`)
  }

  return Object.freeze({
    id,
    title,
    description,
    toolset,
    kind,
    readOnly: kind === 'read' || Boolean(definition.readOnly),
    changesNoSlate: kind === 'read' || Boolean(definition.readOnly) || Boolean(definition.changesNoSlate),
    destructive,
    idempotent,
    openWorld,
    confirm,
    scope,
    alsoScopes: [...alsoScopes],
    principals: [...principals],
    mounts: { ddp: Boolean(mounts.ddp), http },
    modes,
    idempotency,
    replay,
    input,
    output,
    load: definition.load || null,
    precheck: definition.precheck || null,
    removes: definition.removes || null,
    handler,
    failure: definition.failure || null,
    successStatus: definition.successStatus || (kind === 'write' ? 201 : 200),
    bodyLimit: definition.bodyLimit || '100kb',
    tool: definition.tool || null,
  })
}

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonical(value[key])])
    )
  return value
}

// The request a key stands for. A top-level expectedRevision is when the edit may land, not
// the edit: a retry, or a script run again to confirm, reads the slate again and may send a
// later revision for the same edit, which replays it rather than conflicting.
export function requestFingerprint(actionId, input) {
  let request = input
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const { expectedRevision: _when, ...rest } = input
    request = rest
  }
  return createHash('sha256')
    .update(JSON.stringify([actionId, canonical(request)]))
    .digest('hex')
}

// A refused permission, in the words that fit the caller: a connected app (OAuth) signs the
// person in again for it; a personal token cannot gain a scope, so a new one is made.
export const lacksScopeText = (principal, scope, why = '') =>
  principal?.oauth
    ? `This connection lacks the ${scope} permission${why}. Reconnect the app and allow ${scope} when Slatebox asks.`
    : `This token lacks the ${scope} permission${why}. Create a token that has it.`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function createRegistry({
  actions,
  components = {},
  scopes,
  deps = {},
  limiter = null,
  idempotency = null,
  now = Date.now,
  waitForPending = { intervalMs: 50, timeoutMs: 10000 },
}) {
  const byId = new Map()
  const routes = new Set()
  for (const action of actions) {
    if (byId.has(action.id)) throw new Error(`Action ${action.id} is declared twice`)
    const unknown = [action.scope, ...(action.alsoScopes || [])].find((item) => item !== null && !scopes.includes(item))
    if (unknown) throw new Error(`Action ${action.id}: unknown scope ${unknown}`)
    if (action.mounts.http) {
      const route = `${action.mounts.http.method} ${action.mounts.http.path.replace(/\{[^}]+\}/g, '{}')}`
      if (routes.has(route)) throw new Error(`Action ${action.id}: ${route} is mounted twice`)
      routes.add(route)
    }
    byId.set(action.id, action)
  }
  function admit(action, caller) {
    // No session and no token: a read open to visitors runs as one (over HTTP, http.mjs has
    // already made one that carries the address it is counted by).
    const principal = caller || (action.principals.includes('visitor') ? principalFromVisitor(null) : null)
    if (!principal) throw problem(401, 'unauthorized', 'A valid Slatebox API token or sign-in is required.')
    if (!action.principals.includes(principal.kind)) {
      if (principal.kind === 'guest')
        throw problem(403, 'registration_required', 'Create an account to do this.')
      if (principal.kind === 'agent')
        throw problem(403, 'session_required', 'Sign in to Slatebox to do this. A token cannot.')
      throw problem(403, 'forbidden', 'This is not available to your account.')
    }
    // A visitor carries no scopes: what it may read is decided per resource (a public slate).
    if (action.scope && principal.kind !== 'visitor' && !principal.scopes?.includes(action.scope))
      throw problem(
        403,
        'insufficient_scope',
        lacksScopeText(principal, action.scope),
        { details: { requiredScope: action.scope } }
      )
    return principal
  }

  function readMode(action, raw) {
    const given = Object.hasOwn(raw, 'mode') ? raw.mode : undefined
    if (action.kind === 'read') {
      if (given !== undefined) throw problem(400, 'invalid_request', 'A read takes no mode.')
      return null
    }
    const mode = given === undefined ? 'save' : given
    if (!WRITE_MODES.includes(mode))
      throw problem(400, 'invalid_request', 'mode must be one of "save", "preview", "propose".')
    if (!action.modes.includes(mode))
      throw problem(
        400,
        'mode_unavailable',
        `This action cannot ${mode} here. It accepts mode ${action.modes.map((m) => `"${m}"`).join(' or ')}.`,
        { details: { modes: action.modes } }
      )
    return mode
  }

  function readKey(action, mode, key) {
    if (key === undefined || key === null || key === '') {
      if (action.idempotency === 'required' && mode === 'save')
        throw problem(
          400,
          'invalid_request',
          'Supply an Idempotency-Key of 1–128 printable characters without spaces.'
        )
      return null
    }
    if (action.idempotency === 'none')
      throw problem(400, 'invalid_request', 'This request takes no Idempotency-Key.')
    if (typeof key !== 'string' || !KEY_PATTERN.test(key))
      throw problem(
        400,
        'invalid_request',
        'Supply an Idempotency-Key of 1–128 printable characters without spaces.'
      )
    return mode === 'save' ? key : null
  }

  async function settle(record, subject, key) {
    // Wall-clock time: the injected clock stands still in tests and must not stall this wait.
    const deadline = Date.now() + waitForPending.timeoutMs
    let current = record
    while (current?.state === 'pending' && Date.now() < deadline) {
      await sleep(waitForPending.intervalMs)
      current = await idempotency.get(subject, key)
    }
    return current
  }

  async function run(caller, id, rawInput = {}, { idempotencyKey } = {}) {
    const action = byId.get(id)
    if (!action) throw problem(404, 'unknown_action', 'There is no such action.')
    const meta = {}
    try {
      const principal = admit(action, caller)
      // Tokens and visitors are always counted; anything that reaches an outside address
      // (openWorld) is counted per account for every caller, people included.
      if (limiter && (principal.kind === 'agent' || (principal.kind === 'visitor' && principal.address) || (action.openWorld && principal.userId))) {
        meta.rateLimit = await limiter.take(principal, { openWorld: action.openWorld })
        if (!meta.rateLimit.allowed)
          throw problem(429, 'rate_limited', 'Too many requests. Wait and retry.', {
            retryAfter: meta.rateLimit.resetSeconds,
          })
      }
      // A plain object only: a borrowed prototype would let fields arrive without being declared.
      const proto = rawInput && typeof rawInput === 'object' ? Object.getPrototypeOf(rawInput) : undefined
      if (proto !== Object.prototype && proto !== null)
        throw problem(400, 'invalid_request', 'Send the request fields as one JSON object.')
      const mode = readMode(action, rawInput)
      const { mode: _ignored, ...given } = rawInput
      // Declared defaults are filled in first, so a field left out and the same field sent
      // with its default are one request (for the idempotency comparison too).
      const input = { ...given }
      for (const [name, schema] of Object.entries(action.input.properties))
        if (input[name] === undefined && schema.default !== undefined) input[name] = schema.default
      const invalid = validate(action.input, input, components)
      if (invalid)
        throw problem(400, 'invalid_request', invalid.message, { details: { field: invalid.path } })
      const key = readKey(action, mode, idempotencyKey)
      const ctx = { action, deps, mode, now, idempotencyKey: key, resource: null }
      if (action.load) ctx.resource = await action.load(principal, input, ctx)

      const subject = principal.tokenId || principal.userId
      let reserved = false
      if (key) {
        if (!idempotency) throw new Error('This server has no idempotency store')
        const fingerprint = requestFingerprint(action.id, input)
        ctx.fingerprint = fingerprint
        let decided = false
        for (let attempt = 0; attempt < 3 && !decided; attempt += 1) {
          const claim = await idempotency.reserve({ subject, key, action: action.id, fingerprint })
          if (claim.state === 'reserved') {
            reserved = true
            decided = true
            break
          }
          // The first request with this key may still be running: wait for its answer.
          const record = await settle(claim.record, subject, key)
          if (!record) continue // it failed and gave the key back; take it
          if (record.action !== action.id || record.fingerprint !== fingerprint)
            throw problem(409, 'idempotency_conflict', 'That key belongs to a different request. Use a new key.')
          if (record.state === 'pending')
            throw problem(409, 'request_in_progress', 'The first request with this key is still running.', {
              retryAfter: 1,
            })
          if (action.replay === 'stored') {
            meta.replayed = true
            return { status: 200, body: record.response, meta }
          }
          // replay 'rerun': the action's own receipt answers the repeat (see the action).
          decided = true
        }
        if (!decided)
          throw problem(409, 'request_in_progress', 'The first request with this key is still running.', {
            retryAfter: 1,
          })
      }
      let result
      try {
        result = await action.handler(principal, input, ctx)
      } catch (error) {
        if (reserved) await idempotency.release(subject, key)
        throw error
      }
      const shaped =
        result && typeof result === 'object' && 'body' in result && Number.isInteger(result.status)
          ? result
          : { status: action.kind === 'write' && mode !== 'save' ? 200 : action.successStatus, body: result }
      if (action.kind === 'write' && shaped.body && typeof shaped.body === 'object' && !Array.isArray(shaped.body))
        shaped.body = { ...shaped.body, mode }
      if (reserved) await idempotency.complete(subject, key, shaped.body)
      return { ...shaped, meta }
    } catch (error) {
      const actionError = toActionError(error, action.failure)
      actionError.meta = meta
      throw actionError
    }
  }

  // Whether this caller may make this call at all: the principal, the action's permission and
  // its precheck. Throws the refusal run would throw. The exec gate asks before it holds a
  // change for the person's agreement, so a call that would be refused anyway is not held.
  function admits(caller, id, input = {}) {
    const action = byId.get(id)
    if (!action) throw problem(404, 'unknown_action', 'There is no such action.')
    const principal = admit(action, caller)
    if (action.precheck) action.precheck(principal, input && typeof input === 'object' ? input : {})
    return principal
  }

  // Every scope a token may need for the actions an agent can call, in the vocabulary's order:
  // what /mcp's challenge and the OAuth metadata advertise.
  const needed = new Set(
    [...byId.values()].filter((action) => action.principals.includes('agent')).flatMap((action) => [action.scope, ...action.alsoScopes]).filter(Boolean)
  )
  const neededScopes = () => scopes.filter((scope) => needed.has(scope))

  return {
    neededScopes,
    get: (id) => byId.get(id),
    list: () => [...byId.values()],
    admits,
    components,
    scopes,
    run,
  }
}

export { ActionError }
