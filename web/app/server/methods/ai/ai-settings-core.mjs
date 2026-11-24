// The AI settings of a person, their team and the server, and the one question every AI path
// asks: which connection serves this feature for this person? Pure apart from the injected store,
// so the same code runs under Meteor (ai-settings.js) and in tests.
//
// Levels: 'me' (a person's own connections and choices), 'team' (a team admin's, used by the
// team's people), 'server' (the operator: the settings file, plus what an administrator saves in
// the app). The person's choice wins, then the team's, then the server's, then the built-in AI;
// the operator's one switch (ownProviders off) leaves only the server's.
//
// Own AI (a person's or a team's connections) is a self-hosted feature (own-keys.mjs). On Slatebox
// Cloud (hosted) own providers are always off and locked: AI comes with Slatebox Pro credits and
// top-ups, nothing of a person's or team's is saved, tested or used, and a connection saved before
// stays stored, unused, until its owner removes it.
import { createHash } from 'node:crypto'
import { problem } from '../../actions/errors.mjs'
import { OWN_KEYS_CLOUD } from '../../../imports/api/common/own-keys.mjs'
import { NOT_AVAILABLE, last4, open as openKey, seal } from '../../metering/vault.mjs'
import { EndpointRefused, checkEndpointUrl, endpointRules } from './endpoint-policy.mjs'
import {
  AI_FEATURES, CONNECTION_TYPES, ConnectionError, USE_KEYS, capabilityGap, checkUse, connectionLabel,
  featureTitle, keyFromEnv, normalizeConnection, operatorConfig, parseRef, publicConnection, resolveAIChoice, surfaceFor,
} from './connections.mjs'
import { USE_SURFACES } from '../../ai-control/catalogue.mjs'

const RULE_LEVEL = { me: 'person', team: 'team', server: 'server' }
const SERVER = { type: 'server', id: 'server' }
const invalid = (message) => problem(400, 'invalid_request', message)

/**
 * deps: {
 *   store: { listConnections(owner), saveConnection(owner, doc), removeConnection(owner, name),
 *            getUse(owner) → { use, ownProviders? }, setUse(owner, value) },
 *   master (vault master key or null), settings (Meteor.settings), hosted (boolean),
 *   loadUser(id), isAdmin(userId), isTeamAdmin(user),
 *   check(connection, rules) → Test connection result (connection-check.mjs through a guarded fetch),
 *   assertHost?(baseUrl, rules) → resolves when every address of the name is allowed,
 *   checkLimit?: { count, windowMs } Test connection calls per person (it reaches outside
 *     addresses on the server's behalf, unmetered),
 *   env? (process.env: where a settings-file connection's apiKeyEnv is read, per request),
 *   audit?(entry) records a change in the AI control audit trail (ai-control store.record); entry
 *     { action, actor, target, before, after, reason? }, never with a key in it,
 *   now?()
 * }
 */
export function createAISettings({
  store, master, settings, hosted, loadUser, isAdmin, isTeamAdmin, check, assertHost = async () => {}, now = Date.now,
  env = globalThis.process?.env || {}, checkLimit = { count: 20, windowMs: 10 * 60 * 1000 }, audit = null,
}) {
  const file = () => operatorConfig(settings)
  // the endpoint rules for one level of configuration, with the operator's private-network setting
  const contextFor = (ruleLevel) => ({ hosted, level: ruleLevel, privateEndpoints: file().privateEndpoints })
  const rulesFor = (ruleLevel) => endpointRules(contextFor(ruleLevel))
  const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

  // Test connection calls per person, in memory: enough to set up a few connections, not a scanner.
  const checksBy = new Map()
  function takeCheck(userId) {
    const at = now()
    const recent = (checksBy.get(userId) || []).filter((t) => at - t < checkLimit.windowMs)
    if (recent.length >= checkLimit.count) {
      checksBy.set(userId, recent)
      throw problem(429, 'rate_limited', 'Too many connection tests. Wait a few minutes and try again.', { retryAfter: Math.ceil((checkLimit.windowMs - (at - recent[0])) / 1000) })
    }
    recent.push(at)
    checksBy.set(userId, recent)
  }

  const ownerFor = (level, user) => {
    if (level === 'me') return { type: 'user', id: user._id }
    if (level === 'team') return user.orgId ? { type: 'org', id: user.orgId } : null
    return SERVER
  }

  // One stored document as a connection. Keys saved before choices existed have no name; one that
  // failed its check when saved (lastError) serves nothing, as it did before choices existed.
  function fromDoc(doc, owner, withKey) {
    const legacy = doc.name || doc.lastError ? null : doc.provider === 'deepinfra' ? 'all' : doc.provider === 'openai-compatible' ? 'chat' : null
    const connection = {
      name: doc.name || (doc.provider === 'openai-compatible' ? 'own-model' : doc.provider),
      type: doc.provider,
      baseUrl: doc.baseUrl || CONNECTION_TYPES[doc.provider]?.baseUrl,
      ...(doc.model && { model: doc.model }),
      capabilities: doc.capabilities || {},
      ...(doc.maxTokens && { maxTokens: doc.maxTokens }),
      ...(doc.toolChoice && { toolChoice: doc.toolChoice }),
      hasKey: Boolean(doc.cipher && doc.last4),
      ...(legacy && { legacy }),
      lastError: doc.lastError ?? null,
      source: 'app',
    }
    if (withKey && connection.hasKey) {
      try {
        connection.apiKey = openKey({ master, owner: { ownerType: owner.type, ownerId: owner.id, provider: doc.provider }, cipher: doc.cipher }) || undefined
      } catch {
        connection.unreadable = true
      }
    }
    return connection
  }

  async function connectionsOf(owner, withKeys = false) {
    if (!owner) return []
    const docs = await store.listConnections(owner)
    return docs.filter((doc) => doc.provider !== 'daily' && CONNECTION_TYPES[doc.provider]).map((doc) => fromDoc(doc, owner, withKeys))
  }

  async function useOf(owner) {
    if (!owner) return {}
    return (await store.getUse(owner))?.use || {}
  }

  async function serverState() {
    const config = file()
    const [saved, stored] = await Promise.all([connectionsOf(SERVER), store.getUse(SERVER)])
    const locked = Boolean(hosted) || config.ownProvidersLocked
    const ownProviders = locked ? false : stored?.ownProviders !== false
    return {
      connections: [...config.connections, ...saved.filter((c) => !config.connections.some((f) => f.name === c.name))],
      use: { ...config.use, ...(stored?.use || {}) },
      // where each server choice comes from: the settings file, or what an administrator saved ('app')
      useSource: Object.fromEntries([
        ...Object.keys(config.use).map((key) => [key, 'file']), ...Object.keys(stored?.use || {}).map((key) => [key, 'app']),
      ]),
      ownProviders,
      ownProvidersLocked: locked,
    }
  }

  async function holders(user, server) {
    const allowed = server.ownProviders && user && !user.isAnonymous
    const meOwner = allowed ? ownerFor('me', user) : null
    const teamOwner = allowed ? ownerFor('team', user) : null
    const [meConnections, meUse, teamConnections, teamUse] = await Promise.all([
      connectionsOf(meOwner), useOf(meOwner), connectionsOf(teamOwner), useOf(teamOwner),
    ])
    return {
      person: meOwner ? { connections: meConnections, use: meUse } : null,
      team: teamOwner ? { connections: teamConnections, use: teamUse } : null,
      meOwner, teamOwner,
    }
  }

  async function signedIn(userId) {
    const user = userId ? await loadUser(userId) : null
    if (!user) throw problem(401, 'unauthorized', 'Sign in to change your AI settings.')
    if (user.isAnonymous) throw problem(403, 'registration_required', 'Create an account to choose your own AI.')
    return user
  }

  // ---------- read ----------
  async function view(userId) {
    const user = await signedIn(userId)
    const server = await serverState()
    const { person, team } = await holders(user, server)
    const admin = await isAdmin(user._id)
    const teamAdmin = Boolean(user.orgId) && await isTeamAdmin(user)
    const effective = {}
    // every surface in this build: the first-row features and their parts (workshop, the agent, ...)
    for (const s of USE_SURFACES) {
      if (s.id === 'default' || !s.inBuild) continue
      const choice = resolveAIChoice({ feature: s.id, person, team, server, ownProviders: server.ownProviders })
      const label = connectionLabel(choice.connection, { withHost: admin || choice.scope !== 'server' })
      const gap = capabilityGap({ feature: choice.feature, connection: choice.connection, label })
      effective[s.id] = { ref: choice.ref, scope: choice.scope, own: choice.own, label, ...(gap && { gap: gap.message }) }
    }
    const shown = (list) => list.map((c) => publicConnection(c))
    return {
      features: AI_FEATURES.map(({ id, title, needs }) => ({ id, title, needs: [...needs] })),
      // every surface a choice may name, with what it follows while unset ("Follows Conversation and edits")
      surfaces: USE_SURFACES.filter((s) => s.id !== 'default').map((s) => ({
        id: s.id, title: s.title, needs: [...s.needs], follows: s.follows, followsTitle: s.follows === 'default' ? null : featureTitle(s.follows),
        inBuild: s.inBuild,
      })),
      useKeys: [...USE_KEYS],
      ownProviders: server.ownProviders,
      keysAvailable: Boolean(master),
      hosted: Boolean(hosted),
      mine: person ? { connections: shown(person.connections), use: person.use } : null,
      team: team ? { connections: shown(team.connections), use: team.use, editable: teamAdmin } : null,
      server: {
        // people see what they may choose; administrators also see where each one points
        // hasKey of a settings-file connection says whether its environment variable is set
        connections: server.connections.map((c) => (admin ? publicConnection(keyFromEnv(c, env)) : { name: c.name, type: c.type, model: c.model ?? null, capabilities: c.capabilities || {} })),
        use: server.use,
        editable: admin,
        ownProvidersLocked: server.ownProvidersLocked,
      },
      effective,
    }
  }

  // ---------- write ----------
  // removeOnly: with own providers off, people and team admins may still remove what they saved.
  // On Slatebox Cloud (hosted) every other change of a person's or team's AI is refused.
  const ownOff = () => problem(403, 'forbidden', hosted ? OWN_KEYS_CLOUD : 'This server uses the AI its operator set up. Own AI providers are turned off.')
  async function authorize(user, level, { removeOnly = false } = {}) {
    if (level === 'me') {
      if (!removeOnly && !(await serverState()).ownProviders) throw ownOff()
      return ownerFor('me', user)
    }
    if (level === 'team') {
      if (!user.orgId) throw problem(403, 'forbidden', 'You are not in a team.')
      if (!(await isTeamAdmin(user))) throw problem(403, 'forbidden', 'Only a team admin can change the team\'s AI.')
      if (!removeOnly && !(await serverState()).ownProviders) throw ownOff()
      return ownerFor('team', user)
    }
    if (!(await isAdmin(user._id))) throw problem(403, 'forbidden', 'Only an administrator can change the server\'s AI.')
    return SERVER
  }

  const legacyName = (doc) => doc.name || (doc.provider === 'openai-compatible' ? 'own-model' : doc.provider)

  // Checks and seals every connection of one change before anything is written, so a change that
  // fails leaves the settings as they were. A saved key stays only while the connection keeps its
  // type and address: a key is never carried to a new host without being sent again.
  async function prepareConnections(owner, level, inputs, removing = []) {
    const existing = (await store.listConnections(owner)).filter((doc) => !removing.includes(legacyName(doc)))
    const fileNames = level === 'server' ? file().connections.map((c) => c.name) : []
    const rules = rulesFor(RULE_LEVEL[level])
    const names = new Set()
    const prepared = []
    for (const input of inputs) {
      if (fileNames.includes(input?.name)) throw invalid(`${input.name} is set in the server's settings file. Change it there, or choose another name.`)
      if (names.has(input?.name)) throw invalid(`${input.name} appears twice in this change.`)
      names.add(input?.name)
      const previous = existing.find((doc) => legacyName(doc) === input?.name && doc.provider !== 'daily')
      const keepKey = input?.apiKey === undefined && Boolean(previous?.cipher && previous?.last4)
      let connection
      try {
        connection = normalizeConnection({ ...input, keepKey }, contextFor(RULE_LEVEL[level]))
        if (connection.type === 'openai-compatible') await assertHost(connection.baseUrl, rules)
      } catch (error) {
        if (error instanceof ConnectionError || error instanceof EndpointRefused) throw invalid(error.message)
        throw error
      }
      let cipher = null, keyTail = ''
      if (keepKey && previous.provider !== connection.type) {
        throw invalid('Send the key again: the connection changed type.')
      } else if (keepKey && !sameAddress(previous.baseUrl || CONNECTION_TYPES[previous.provider]?.baseUrl, connection.baseUrl)) {
        throw invalid('Send the key again: the connection has a new address. Send an empty key to save it without one.')
      } else if (keepKey) {
        ;({ cipher } = previous)
        keyTail = previous.last4
      } else if (connection.apiKey) {
        if (!master) throw problem(503, 'unavailable', `${NOT_AVAILABLE} A connection without a key can still be saved.`)
        cipher = seal({ master, owner: { ownerType: owner.type, ownerId: owner.id, provider: connection.type }, plaintext: connection.apiKey })
        keyTail = last4(connection.apiKey)
      }
      const { apiKey: _key, ...stored } = connection
      prepared.push({
        replacesLegacy: Boolean(previous && !previous.name),
        doc: {
          provider: stored.type, name: stored.name, baseUrl: stored.baseUrl, ...(stored.model && { model: stored.model }),
          capabilities: stored.capabilities, ...(stored.maxTokens && { maxTokens: stored.maxTokens }), ...(stored.toolChoice && { toolChoice: stored.toolChoice }),
          cipher, last4: keyTail, created: previous?.created ?? now(), updated: now(), lastError: null,
        },
      })
    }
    return prepared
  }

  async function writeConnections(owner, prepared) {
    for (const { replacesLegacy, doc } of prepared) {
      if (replacesLegacy) await store.removeConnection(owner, doc.name)
      await store.saveConnection(owner, doc)
    }
  }

  // The connections a choice at this level may name, as they will be after this change.
  async function visibleFor(level, user, { removing = [], adding = [] } = {}) {
    const server = await serverState()
    const scope = level === 'me' ? 'me' : level
    const visible = {
      me: level === 'me' ? await connectionsOf(ownerFor('me', user)) : [],
      team: level !== 'server' && user.orgId ? await connectionsOf(ownerFor('team', user)) : [],
      server: server.connections,
    }
    visible[scope] = [...visible[scope].filter((c) => !removing.includes(c.name)), ...adding.map(({ doc }) => ({ name: doc.name }))]
    return visible
  }

  // ---------- the audit trail of changes (spec 1.8) ----------
  // A level's settings as the audit trail keeps them: names, addresses, models and choices, and for
  // each key only which key it is (its fingerprint, or its last four characters), never the key.
  const keyMark = (doc, fresh = {}) => {
    if (!doc.cipher || !doc.last4) return null
    return fresh[legacyName(doc)] || `…${doc.last4}`
  }
  const auditView = (docs, stored, fresh = {}) => ({
    connections: docs.filter((doc) => doc.provider !== 'daily').map((doc) => ({
      name: legacyName(doc), provider: doc.provider, baseUrl: doc.baseUrl ?? null, model: doc.model ?? null, keyFingerprint: keyMark(doc, fresh),
    })).sort((a, b) => a.name.localeCompare(b.name)),
    use: { ...(stored?.use || {}) },
    ...(stored?.ownProviders !== undefined && { ownProviders: stored.ownProviders }),
  })
  async function recordChange(entry) {
    if (!audit) return
    try {
      await audit(entry)
    } catch (error) {
      // the change is saved; a lost audit row is logged, never a reason to fail the person
      console.warn(`ai-settings: could not record ${entry.action} in the audit trail: ${error.message}`)
    }
  }
  const actorFor = (userId, actor) => actor || { userId, principal: 'person', via: 'ddp' }

  /**
   * Clears what an administrator chose in the app for the server's features (some, or all), so the
   * settings file and the built-in AI apply again (ai.control.reset, target use). Connections stay.
   * → { cleared: [keys] }
   */
  async function resetServerUse(userId, { keys = null, reason, actor } = {}) {
    const user = await signedIn(userId)
    if (!(await isAdmin(user._id))) throw problem(403, 'forbidden', 'Only an administrator can change the server\'s AI.')
    const stored = (await store.getUse(SERVER)) || { use: {} }
    const use = { ...(stored.use || {}) }
    const cleared = Object.keys(use).filter((key) => !keys || keys.includes(key))
    if (!cleared.length) return { cleared }
    for (const key of cleared) delete use[key]
    const docs = await store.listConnections(SERVER)
    await store.setUse(SERVER, { ...stored, use })
    await recordChange({
      action: 'ai.control.reset', actor: actorFor(userId, actor), target: { kind: 'aiSettings', id: 'server' }, reason,
      before: auditView(docs, stored), after: auditView(docs, { ...stored, use }),
    })
    return { cleared }
  }

  async function update(userId, input, { actor = null } = {}) {
    const user = await signedIn(userId)
    const level = input.level
    if (!RULE_LEVEL[level]) throw invalid('level is me, team or server.')
    const removeOnly = Boolean(input.remove?.length) && !input.connections?.length && !input.use && input.ownProviders === undefined
    const owner = await authorize(user, level, { removeOnly })
    if (input.ownProviders !== undefined && level !== 'server') throw invalid('ownProviders is a server setting.')
    if (input.ownProviders === 'on' && hosted) throw problem(403, 'forbidden', OWN_KEYS_CLOUD)
    const stored = (await store.getUse(owner)) || { use: {} }
    const use = { ...(stored.use || {}) }
    const scope = level === 'me' ? 'me' : level
    const removing = [...(input.remove || [])]
    // everything is checked first; nothing is written unless the whole change is valid
    const prepared = input.connections?.length ? await prepareConnections(owner, level, input.connections, removing) : []
    for (const name of removing) {
      for (const [key, ref] of Object.entries(use)) if (ref === `${scope}:${name}`) delete use[key]
    }
    if (input.use) {
      let checked
      try {
        checked = checkUse(input.use, level, await visibleFor(level, user, { removing, adding: prepared }))
      } catch (error) {
        if (error instanceof ConnectionError) throw invalid(error.message)
        throw error
      }
      for (const [key, ref] of Object.entries(checked)) {
        if (ref === null) delete use[key]
        else use[key] = ref
      }
    }
    const beforeDocs = await store.listConnections(owner)
    for (const name of removing) await store.removeConnection(owner, name)
    await writeConnections(owner, prepared)
    const next = { ...stored, use }
    if (input.ownProviders !== undefined) next.ownProviders = input.ownProviders === 'on'
    await store.setUse(owner, next)
    // which keys this change sent, by fingerprint (never the key)
    const fresh = Object.fromEntries((input.connections || []).filter((c) => typeof c?.apiKey === 'string' && c.apiKey).map((c) => [c.name, keyFingerprint(c.apiKey)]))
    await recordChange({
      action: 'ai.update', actor: actorFor(userId, actor), target: { kind: 'aiSettings', id: level === 'server' ? 'server' : `${level}:${owner.id}` },
      before: auditView(beforeDocs, stored), after: auditView(await store.listConnections(owner), next, fresh),
    })
    return view(userId)
  }

  // ---------- Test connection ----------
  async function checkOne(userId, input) {
    const user = await signedIn(userId)
    const level = input.level || 'me'
    if (!RULE_LEVEL[level]) throw invalid('level is me, team or server.')
    if (level === 'server' && !(await isAdmin(user._id))) throw problem(403, 'forbidden', 'Only an administrator can test the server\'s connections.')
    if (level === 'team' && !user.orgId) throw problem(403, 'forbidden', 'You are not in a team.')
    // Slatebox Cloud tests no person's or team's connection: they are not used there
    if (level !== 'server' && hosted) throw problem(403, 'forbidden', OWN_KEYS_CLOUD)
    // a connection not yet saved is one being set up: at team level only a team admin sets one up
    if (level === 'team' && !input.name && !(await isTeamAdmin(user))) throw problem(403, 'forbidden', 'Only a team admin can test a new connection for the team.')
    takeCheck(user._id)
    const owner = level === 'server' ? SERVER : ownerFor(level, user)
    const saved = level === 'server'
      ? [...file().connections.map((c) => keyFromEnv(c, env)), ...(await connectionsOf(SERVER, true))]
      : await connectionsOf(owner, true)
    let connection
    if (input.name) {
      connection = saved.find((c) => c.name === input.name)
      if (!connection) throw problem(404, 'not_found', `There is no connection ${input.name} here.`)
      if (connection.unreadable) throw invalid('The key of this connection could not be read. Add it again.')
      if (connection.keyError) throw invalid(`${connection.name}: ${connection.keyError}.`)
    } else if (input.connection) {
      try {
        connection = normalizeConnection({ ...input.connection, keepKey: true }, contextFor(RULE_LEVEL[level]))
      } catch (error) {
        if (error instanceof ConnectionError) throw invalid(error.message)
        throw error
      }
      // A saved key is tested only at its own address: a key never goes to an address its owner
      // did not save it for.
      const same = saved.find((c) => c.name === connection.name && c.type === connection.type && sameAddress(c.baseUrl, connection.baseUrl))
      if (input.connection.apiKey === undefined && same?.apiKey) connection.apiKey = same.apiKey
    } else {
      throw invalid('Name a saved connection, or send one to test.')
    }
    const ruleLevel = connection.source === 'file' ? 'file' : RULE_LEVEL[level]
    const rules = rulesFor(ruleLevel)
    try {
      checkEndpointUrl(connection.baseUrl, rules)
    } catch (error) {
      throw invalid(error.message)
    }
    return check(connection, rules)
  }

  // ---------- the request path ----------
  /**
   * feature: the name an AI path uses (welcome, workshop, generation, vision, image-generation…).
   * request: { images?, tools? } what this request carries. → null for a feature that is not a
   * model choice, else { ref, scope, own, connection (with its key) | null, rules, gap?, error? }.
   */
  async function resolveFor({ userId, feature, request = {} }) {
    // the request feature's surface (lane-chat -> workshop, agent -> agent.slatebox): its own
    // choice when one is set, else what it follows, as far as the default
    const surface = surfaceFor(feature)
    if (!surface) return null
    const user = userId ? await loadUser(userId) : null
    const server = await serverState()
    const { person, team, meOwner, teamOwner } = await holders(user, server)
    const choice = resolveAIChoice({ feature: surface, person, team, server, ownProviders: server.ownProviders })
    if (!choice.connection) return { ...choice, rules: null }
    let connection = choice.connection
    const owner = choice.scope === 'me' ? meOwner : choice.scope === 'team' ? teamOwner : SERVER
    if (connection.source !== 'file') {
      const docs = await connectionsOf(owner, true)
      connection = docs.find((c) => c.name === connection.name) || connection
    } else {
      connection = keyFromEnv(connection, env)
    }
    const rules = rulesFor(connection.source === 'file' ? 'file' : RULE_LEVEL[choice.scope])
    // a person reads about the operator's connection by its model, not by where it lives
    const withHost = choice.scope !== 'server' || Boolean(user && await isAdmin(user._id))
    const label = connectionLabel(connection, { withHost })
    let error = null
    if (connection.unreadable) error = `The key for ${label} could not be read. Add it again in your AI settings.`
    else if (connection.keyError) error = `${label} is not configured: ${connection.keyError}.`
    else {
      try {
        checkEndpointUrl(connection.baseUrl, rules)
      } catch (refused) {
        error = `${label} cannot be used: ${refused.message}`
      }
    }
    const gap = capabilityGap({ feature: choice.feature, connection, request, label })
    return { ...choice, connection, rules, label, ...(gap && { gap }), ...(error && { error }) }
  }

  /**
   * Today's AI settings for one person as the AI control resolver reads them (ai-control/resolve.mjs
   * holders): their connections and choices, their team's and the server's, never a key.
   * → { person, team, server, ownProviders, serverUseSource, admin }
   */
  async function choiceHolders(userId) {
    const user = userId ? await loadUser(userId) : null
    const server = await serverState()
    const { person, team } = await holders(user, server)
    return {
      person, team, server: { connections: server.connections, use: server.use }, ownProviders: server.ownProviders,
      serverUseSource: server.useSource, orgId: user?.orgId ?? null,
    }
  }

  return { view, update, resetServerUse, check: checkOne, resolveFor, serverState, choiceHolders }
}

export { parseRef }

/** Which key this is, without the key (spec 1.2): sha256: + the first 8 hex of its sha256 + …last 4. */
export function keyFingerprint(key) {
  if (typeof key !== 'string' || !key) return null
  return `sha256:${createHash('sha256').update(key).digest('hex').slice(0, 8)}…${key.slice(-4)}`
}
