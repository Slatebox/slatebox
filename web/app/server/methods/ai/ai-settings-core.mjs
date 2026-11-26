// The one question every AI path asks: which model answers this feature for this person, with
// which key? The server's answer comes from AI control (ai-control/resolve.mjs: one choice per part
// of Slatebox, with the provider's active key from the backend, keys.mjs). A person or their team
// may choose their own connections first (own AI, own-keys.mjs), on Slatebox Cloud and on a
// self-hosted server alike; this module keeps those. The order is the same everywhere: an
// administrator's off switch (a part, or all AI), then the person's choice, then their team's, then
// the server's. Pure apart from the injected store and sources, so the same code runs under Meteor
// (ai-settings.js) and in tests.
//
// On Slatebox Cloud (hosted) an own connection must be a public https address, checked when it is
// saved and again by the lookup of every request (endpoint-policy.mjs), and a connection of one of
// the server's own keyless providers is never a person's: it would be served by Slatebox while
// counted as theirs. Keys are sealed in the vault, never returned and never written to the audit
// trail (only a fingerprint).
import { problem } from '../../actions/errors.mjs'
import { NOT_AVAILABLE, last4, open as openKey, seal } from '../../metering/vault.mjs'
import { EndpointRefused, checkEndpointUrl, endpointRules } from './endpoint-policy.mjs'
import {
  AI_FEATURES, ConnectionError, USE_KEYS, capabilityGap, checkUse, connectionLabel, connectionType,
  featureTitle, normalizeConnection, operatorConfig, parseRef, publicConnection, resolveAIChoice, surfaceFor,
} from './connections.mjs'
import { USE_SURFACES } from '../../ai-control/catalogue.mjs'
import { BUILTIN_PROVIDERS } from '../../ai-control/providers.mjs'
import { keyFingerprint } from '../../ai-control/keys.mjs'
import { PROVIDER_PRESETS } from '../../ai-control/provider-presets.mjs'

export { keyFingerprint }

const RULE_LEVEL = { me: 'person', team: 'team', server: 'server' }
const SERVER = { type: 'server', id: 'server' }
const invalid = (message) => problem(400, 'invalid_request', message)
const ADMIN_PAGE = 'The server\'s providers, keys and models are set in Admin → AI control.'
// A provider an administrator added that takes no key is the server's own model: a person's or
// team's connection to it would be served by this server while counted as theirs (no charge).
const serverKeyless = (type) => {
  const found = connectionType(type)
  return Boolean(found && !found.builtin && found.auth?.style === 'none')
}
const SERVER_KEYLESS = (label) => `${label} is one of this server's own models, so it cannot be your own connection. Leave the feature on this server's model instead.`
const FIX_SERVER = 'An administrator chooses another model for it in Admin → AI control.'
const NO_SERVER_MODEL = 'No model is set for this part of Slatebox. An administrator chooses one in Admin → AI control.'

/**
 * deps: {
 *   store: { listConnections(owner), saveConnection(owner, doc), removeConnection(owner, name),
 *            getUse(owner) → { use, ownProviders? }, setUse(owner, value) },
 *   master (vault master key or null), settings (Meteor.settings), hosted (boolean),
 *   loadUser(id), isAdmin(userId), isTeamAdmin(user),
 *   check(connection, rules) → Test connection result (connection-check.mjs through a guarded fetch),
 *   assertHost?(baseUrl, rules) → resolves when every address of the name is allowed,
 *   checkLimit?: { count, windowMs } Test connection calls per person,
 *   saveLimit?: { count, windowMs } changes that save connections (and keys), per person,
 *   audit?(entry) records a change in the AI control audit trail (never with a key in it),
 *   now?()
 * }
 * Set later by ai-control/index.mjs: setRouteSource(({ surface, useDefault }) → resolveModel result)
 * and setKeySource({ keyFor(provider), hasKey(provider) }) (keys.mjs).
 */
export function createAISettings({
  store, master, settings, hosted, loadUser, isAdmin, isTeamAdmin, check, assertHost = async () => {}, now = Date.now,
  checkLimit = { count: 20, windowMs: 10 * 60 * 1000 }, saveLimit = { count: 20, windowMs: 10 * 60 * 1000 }, audit = null,
}) {
  const file = () => operatorConfig(settings)
  // AI control: which model a part of Slatebox uses, or that it is off (ai-control/resolve.mjs)
  let routeSource = null
  // the backend's keys (ai-control/keys.mjs)
  let keySource = null
  const contextFor = (ruleLevel) => ({ hosted, level: ruleLevel, privateEndpoints: file().privateEndpoints })
  const rulesFor = (ruleLevel) => endpointRules(contextFor(ruleLevel))
  const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

  // Test connection calls and saved connections per person, in memory: enough to set up a few
  // connections, not a scanner or a key-stuffing loop.
  function limiter(limit, message) {
    const by = new Map()
    return (userId) => {
      const at = now()
      const recent = (by.get(userId) || []).filter((t) => at - t < limit.windowMs)
      if (recent.length >= limit.count) {
        by.set(userId, recent)
        throw problem(429, 'rate_limited', message, { retryAfter: Math.ceil((limit.windowMs - (at - recent[0])) / 1000) })
      }
      recent.push(at)
      by.set(userId, recent)
    }
  }
  const takeCheck = limiter(checkLimit, 'Too many connection tests. Wait a few minutes and try again.')
  const takeSave = limiter(saveLimit, 'Too many changes to your connections. Wait a few minutes and try again.')

  const ownerFor = (level, user) => {
    if (level === 'me') return { type: 'user', id: user._id }
    if (level === 'team') return user.orgId ? { type: 'org', id: user.orgId } : null
    return SERVER
  }

  // One stored own connection. Keys saved before choices existed have no name; one that failed its
  // check when saved (lastError) serves nothing, as it did before choices existed.
  function fromDoc(doc, owner, withKey) {
    const legacy = doc.name || doc.lastError ? null : doc.provider === 'deepinfra' ? 'all' : doc.provider === 'openai-compatible' ? 'chat' : null
    const connection = {
      name: doc.name || (doc.provider === 'openai-compatible' ? 'own-model' : doc.provider),
      type: doc.provider,
      baseUrl: doc.baseUrl || connectionType(doc.provider)?.baseUrl,
      ...(doc.model && { model: doc.model }),
      capabilities: doc.capabilities || {},
      ...(doc.maxTokens && { maxTokens: doc.maxTokens }),
      ...(doc.toolChoice && { toolChoice: doc.toolChoice }),
      hasKey: Boolean(doc.cipher && doc.last4),
      ...(legacy && { legacy }),
      lastError: doc.lastError ?? null,
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
    return docs.filter((doc) => doc.provider !== 'daily' && doc.kind !== 'key' && connectionType(doc.provider)).map((doc) => fromDoc(doc, owner, withKeys))
  }

  async function useOf(owner) {
    if (!owner) return {}
    return (await store.getUse(owner))?.use || {}
  }

  async function serverState() {
    const config = file()
    const stored = await store.getUse(SERVER)
    const locked = config.ownProvidersLocked
    return { ownProviders: locked ? false : stored?.ownProviders !== false, ownProvidersLocked: locked }
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

  // AI control's answer for a part: on or off, and the route. Never throws: a broken read is
  // reported as an error of that request.
  async function controlFor(surface, { useDefault = false } = {}) {
    if (!routeSource) return null
    try {
      return await routeSource({ surface, useDefault })
    } catch (error) {
      console.warn(`ai-settings: the AI control route for ${surface} could not be read: ${error.message}`)
      return { enabled: true, route: { error: 'The AI settings could not be read. Try again in a minute.' } }
    }
  }

  // What a person may read about the server's model: its name and provider for an administrator,
  // "this server's model" for everyone else.
  const serverLabel = (route, admin) => (admin ? `${route.label} from ${route.providerLabel}` : `${route.label} (this server's model)`)

  // ---------- read ----------
  async function view(userId) {
    const user = await signedIn(userId)
    const server = await serverState()
    const { person, team } = await holders(user, server)
    const admin = await isAdmin(user._id)
    const teamAdmin = Boolean(user.orgId) && await isTeamAdmin(user)
    const effective = {}
    for (const s of USE_SURFACES) {
      if (s.id === 'default' || !s.inBuild) continue
      // an administrator turning a part off wins over anyone's own choice, as in resolveFor
      const control = await controlFor(s.id)
      const off = Boolean(control && !control.enabled)
      const choice = off ? null : resolveAIChoice({ feature: s.id, person, team, ownProviders: server.ownProviders })
      if (choice?.connection) {
        const label = connectionLabel(choice.connection)
        const gap = capabilityGap({ feature: choice.feature, connection: choice.connection, label })
        effective[s.id] = { ref: choice.ref, scope: choice.scope, own: choice.own, label, ...(gap && { gap: gap.message }) }
        continue
      }
      const route = control?.route
      let label = 'this server\'s model'
      if (off) label = control.disabledMessage || 'Turned off by your administrator'
      else if (route?.aux) label = route.label
      else if (route && !route.error) label = serverLabel(route, admin)
      // a voice part with no voice model bound has no server model (resolve.mjs source unset)
      const unset = !off && control && !route
      effective[s.id] = { ref: 'builtin', scope: 'builtin', own: false, label, ...(route?.error && { gap: route.error }), ...(unset && { gap: NO_SERVER_MODEL }) }
    }
    const shown = (list) => list.map((c) => publicConnection(c))
    return {
      features: AI_FEATURES.map(({ id, title, needs }) => ({ id, title, needs: [...needs] })),
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
      // the server's AI is set in Admin → AI control; here only whether people may bring their own
      server: { editable: admin, ownProvidersLocked: server.ownProvidersLocked, adminPage: admin ? '/admin/ai' : null },
      effective,
    }
  }

  // ---------- write ----------
  const ownOff = () => problem(403, 'forbidden', 'This server uses the AI its administrator set up. Own AI providers are turned off.')
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
    const existing = (await store.listConnections(owner)).filter((doc) => doc.kind !== 'key' && !removing.includes(legacyName(doc)))
    const rules = rulesFor(RULE_LEVEL[level])
    const names = new Set()
    const prepared = []
    for (const input of inputs) {
      if (names.has(input?.name)) throw invalid(`${input.name} appears twice in this change.`)
      names.add(input?.name)
      if (BUILTIN_PROVIDERS[input?.type]) throw invalid(`${input.type} is a service of the server: an administrator adds its key in Admin → AI control.`)
      if (serverKeyless(input?.type)) throw invalid(SERVER_KEYLESS(connectionType(input.type).label))
      const previous = existing.find((doc) => legacyName(doc) === input?.name && doc.provider !== 'daily')
      const keepKey = input?.apiKey === undefined && Boolean(previous?.cipher && previous?.last4)
      let connection
      try {
        connection = normalizeConnection({ ...input, keepKey }, contextFor(RULE_LEVEL[level]))
        const type = connectionType(connection.type)
        if (!(type?.baseUrl && type.baseUrlLocked && sameAddress(type.baseUrl, connection.baseUrl))) await assertHost(connection.baseUrl, rules)
      } catch (error) {
        if (error instanceof ConnectionError || error instanceof EndpointRefused) throw invalid(error.message)
        throw error
      }
      let cipher = null
      let keyTail = ''
      if (keepKey && previous.provider !== connection.type) {
        throw invalid('Send the key again: the connection changed type.')
      } else if (keepKey && !sameAddress(previous.baseUrl || connectionType(previous.provider)?.baseUrl, connection.baseUrl)) {
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
          cipher, last4: keyTail, keyFingerprint: connection.apiKey ? keyFingerprint(connection.apiKey) : previous?.keyFingerprint ?? null,
          created: previous?.created ?? now(), updated: now(), lastError: null,
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
    const visible = {
      me: level === 'me' ? await connectionsOf(ownerFor('me', user)) : [],
      team: user.orgId ? await connectionsOf(ownerFor('team', user)) : [],
    }
    visible[level] = [...visible[level].filter((c) => !removing.includes(c.name)), ...adding.map(({ doc }) => ({ name: doc.name }))]
    return visible
  }

  // A level's settings as the audit trail keeps them: names, addresses, models and choices, and for
  // each key only which key it is (its fingerprint), never the key.
  const auditView = (docs, stored) => ({
    connections: docs.filter((doc) => doc.provider !== 'daily' && doc.kind !== 'key').map((doc) => ({
      name: legacyName(doc), provider: doc.provider, baseUrl: doc.baseUrl ?? null, model: doc.model ?? null,
      keyFingerprint: doc.cipher && doc.last4 ? doc.keyFingerprint || `…${doc.last4}` : null,
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

  async function update(userId, input, { actor = null } = {}) {
    const user = await signedIn(userId)
    const level = input.level
    if (!RULE_LEVEL[level]) throw invalid('level is me, team or server.')
    const removeOnly = Boolean(input.remove?.length) && !input.connections?.length && !input.use && input.ownProviders === undefined
    const owner = await authorize(user, level, { removeOnly })
    if (level === 'server' && (input.connections?.length || input.remove?.length || input.use)) throw invalid(`${ADMIN_PAGE} At the server level, ai.update only turns own AI on or off (ownProviders).`)
    if (input.ownProviders !== undefined && level !== 'server') throw invalid('ownProviders is a server setting.')
    if (input.connections?.length) takeSave(user._id)
    const stored = (await store.getUse(owner)) || { use: {} }
    const use = { ...(stored.use || {}) }
    const removing = [...(input.remove || [])]
    const prepared = input.connections?.length ? await prepareConnections(owner, level, input.connections, removing) : []
    for (const name of removing) {
      for (const [key, ref] of Object.entries(use)) if (ref === `${level}:${name}`) delete use[key]
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
    await recordChange({
      action: 'ai.update', actor: actorFor(userId, actor), target: { kind: 'aiSettings', id: level === 'server' ? 'server' : `${level}:${owner.id}` },
      before: auditView(beforeDocs, stored), after: auditView(await store.listConnections(owner), next),
    })
    return view(userId)
  }

  // ---------- the services beside the models: their keys come from the backend too ----------
  /**
   * The key of a service beside the models (picture search, icons, transcription, Stability) for
   * one request: its active key in the backend, opened now. → { apiKey, model, baseUrl } or null.
   */
  async function auxCredential(provider) {
    if (!BUILTIN_PROVIDERS[provider] || !keySource) return null
    const key = await keySource.keyFor(provider)
    if (key.error || !key.apiKey) return null
    return { name: provider, apiKey: key.apiKey, model: key.model ?? null, baseUrl: BUILTIN_PROVIDERS[provider].baseUrl }
  }

  /** Whether the server has a usable key for a service beside the models. */
  async function hasAuxKey(provider) {
    return Boolean(keySource && BUILTIN_PROVIDERS[provider] && await keySource.hasKey(provider))
  }

  // ---------- Test connection (a person's or team's own) ----------
  async function checkOne(userId, input) {
    const user = await signedIn(userId)
    const level = input.level || 'me'
    if (!RULE_LEVEL[level]) throw invalid('level is me, team or server.')
    if (level === 'server') throw invalid(`${ADMIN_PAGE} Test a key there (ai.keys.test).`)
    if (level === 'team' && !user.orgId) throw problem(403, 'forbidden', 'You are not in a team.')
    if (level === 'team' && !input.name && !(await isTeamAdmin(user))) throw problem(403, 'forbidden', 'Only a team admin can test a new connection for the team.')
    // an administrator turning own AI off also stops testing new endpoints from this server
    if (!(await serverState()).ownProviders) throw ownOff()
    takeCheck(user._id)
    const owner = ownerFor(level, user)
    const saved = await connectionsOf(owner, true)
    let connection
    if (input.name) {
      connection = saved.find((c) => c.name === input.name)
      if (!connection) throw problem(404, 'not_found', `There is no connection ${input.name} here.`)
      if (connection.unreadable) throw invalid('The key of this connection could not be read. Add it again.')
    } else if (input.connection) {
      try {
        connection = normalizeConnection({ ...input.connection, keepKey: true }, contextFor(RULE_LEVEL[level]))
      } catch (error) {
        if (error instanceof ConnectionError) throw invalid(error.message)
        throw error
      }
      // A saved key is tested only at its own address.
      const same = saved.find((c) => c.name === connection.name && c.type === connection.type && sameAddress(c.baseUrl, connection.baseUrl))
      if (input.connection.apiKey === undefined && same?.apiKey) connection.apiKey = same.apiKey
    } else {
      throw invalid('Name a saved connection, or send one to test.')
    }
    const rules = rulesFor(RULE_LEVEL[level])
    try {
      checkEndpointUrl(connection.baseUrl, rules)
    } catch (error) {
      throw invalid(error.message)
    }
    return check(connection, rules)
  }

  // ---------- the request path ----------
  // An own connection a choice names, with its key, the endpoint rules of its level, the label a
  // person may read, and why it cannot be used.
  async function loadOwn({ connection: named, owner, scope, feature, request, control = null }) {
    const docs = await connectionsOf(owner, true)
    let connection = docs.find((c) => c.name === named.name) || named
    // an own DeepInfra key saved with no model (before choices existed, it served every feature):
    // the model the server answers this part with when that is on DeepInfra, else DeepInfra's first
    if (connection.type === 'deepinfra' && !connection.model) {
      const route = control?.route
      const model = route && !route.error && route.preset === 'deepinfra' ? route.model : PROVIDER_PRESETS.deepinfra.models[0].model
      connection = { ...connection, model }
    }
    const rules = rulesFor(RULE_LEVEL[scope])
    const label = connectionLabel(connection)
    let error = null
    if (connection.unreadable) error = `The key for ${label} could not be read. Add it again in your AI settings.`
    else if (serverKeyless(connection.type)) error = `${label} cannot be used: ${SERVER_KEYLESS(connectionType(connection.type).label)}`
    else if (!connection.model) error = `${label} has no model. Choose one in your AI settings.`
    else {
      try {
        checkEndpointUrl(connection.baseUrl, rules)
      } catch (refused) {
        error = `${label} cannot be used: ${refused.message}`
      }
    }
    const gap = capabilityGap({ feature, connection, request, label })
    return { connection, rules, label, ...(gap && { gap }), ...(error && { error }) }
  }

  // The server's route (AI control) as a connection with the provider's active key.
  async function serverRoute({ control, user, feature, request, forRequest = false }) {
    const route = control?.route
    if (!route) return { ref: 'builtin', scope: 'server', connection: null, own: false, feature, rules: null, error: NO_SERVER_MODEL }
    if (route.error) return { ref: 'builtin', scope: 'server', connection: null, own: false, feature, rules: null, error: route.error }
    // generated pictures with nothing set: the built-in image service (stabilityai.js)
    if (route.aux) return { ref: 'builtin', scope: 'builtin', connection: null, own: false, feature, rules: null, source: control.source }
    const admin = Boolean(user && await isAdmin(user._id))
    const label = serverLabel(route, admin)
    const ref = `server:${route.provider}`
    const base = { ref, scope: 'server', own: false, feature, provider: route.provider, modelId: route.modelId, source: control.source, label }
    // a key opened for a request that is sent counts as its last use; an availability check does not
    const key = keySource ? await keySource.keyFor(route.provider, { use: forRequest }) : { error: `${route.providerLabel} has no active key. An administrator adds one in Admin → AI control.` }
    if (key.error) return { ...base, connection: null, rules: null, error: key.error }
    const connection = {
      name: route.provider, type: route.provider, baseUrl: route.baseUrl, model: route.model, apiKey: key.apiKey,
      capabilities: route.capabilities || {}, toolChoice: route.toolChoice, ...(route.maxOutput && { maxTokens: route.maxOutput }),
      // a voice part's route: its protocol, the binding's voice and the model's transcription model (server/voice)
      ...(route.voice !== undefined && { protocol: route.protocol, voice: route.voice, ...(route.transcriptionModel && { transcriptionModel: route.transcriptionModel }), prices: route.prices ?? null }),
    }
    const rules = rulesFor('server')
    let error = null
    try {
      checkEndpointUrl(connection.baseUrl, rules)
    } catch (refused) {
      error = `${label} cannot be used: ${refused.message}`
    }
    const gap = capabilityGap({ feature, connection, request, label, fix: FIX_SERVER })
    return { ...base, connection, rules, ...(gap && { gap }), ...(error && { error }) }
  }

  /**
   * feature: the name an AI path uses (welcome, workshop, generation, vision, image-generation…).
   * request: { images?, tools? } what this request carries. useDefault: the default model instead
   * of the part's (the one retry after a failing service, req.js). forRequest: the route is for a
   * request about to be sent (its key's last use is noted), not an availability check.
   * → null for a feature that is not a model choice, else { ref, scope, own, connection (with its
   *   key) | null, rules, label?, gap?, error?, disabled?, message? }
   */
  async function resolveFor({ userId, feature, request = {}, useDefault = false, forRequest = false }) {
    const surface = surfaceFor(feature)
    if (!surface) return null
    const control = await controlFor(surface, { useDefault })
    // an administrator turned this part (or AI for everyone) off: nothing else is read
    if (control && control.enabled === false) {
      return { ref: 'disabled', scope: 'disabled', connection: null, own: false, feature: surface, rules: null, disabled: true, message: control.disabledMessage, surface }
    }
    const user = userId ? await loadUser(userId) : null
    if (!useDefault) {
      const server = await serverState()
      const { person, team, meOwner, teamOwner } = await holders(user, server)
      const choice = resolveAIChoice({ feature: surface, person, team, ownProviders: server.ownProviders })
      if (choice.connection) {
        const owner = choice.scope === 'me' ? meOwner : teamOwner
        return { ...choice, surface, ...(await loadOwn({ connection: choice.connection, owner, scope: choice.scope, feature: choice.feature, request, control })) }
      }
      return { ...(await serverRoute({ control, user, feature: choice.feature, request, forRequest })), surface }
    }
    return { ...(await serverRoute({ control, user, feature: surface, request, forRequest })), surface }
  }

  /**
   * Whether an administrator turned the part of a request feature off (its own binding, the part it
   * follows, or AI for everyone), read before anything else a request does. No key is opened.
   * → null (on, or not a model choice) or { surface, message }
   */
  async function surfaceOff({ feature }) {
    const surface = surfaceFor(feature)
    if (!surface) return null
    const control = await controlFor(surface)
    return control && control.enabled === false ? { surface, message: control.disabledMessage || 'This feature is turned off by your administrator.' } : null
  }

  /**
   * A person's own AI as the admin pages read it (What a person gets): their connections and
   * choices and their team's, never a key. → { person, team, ownProviders, orgId }
   */
  async function choiceHolders(userId) {
    const user = userId ? await loadUser(userId) : null
    const server = await serverState()
    const { person, team } = await holders(user, server)
    return { person, team, ownProviders: server.ownProviders, orgId: user?.orgId ?? null }
  }

  return {
    view, update, check: checkOne, resolveFor, surfaceOff, serverState, choiceHolders, auxCredential, hasAuxKey,
    setRouteSource: (source) => { routeSource = typeof source === 'function' ? source : null },
    setKeySource: (source) => { keySource = source && typeof source.keyFor === 'function' ? source : null },
  }
}

export { parseRef }
