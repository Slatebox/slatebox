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
  AI_FEATURES, ConnectionError, USE_KEYS, capabilityGap, checkUse, connectionLabel, connectionType,
  featureTitle, keyFromEnv, normalizeConnection, operatorConfig, parseRef, publicConnection, resolveAIChoice, surfaceFor,
} from './connections.mjs'
import { USE_SURFACES } from '../../ai-control/catalogue.mjs'
import { AUX_PROVIDER_IDS, BUILTIN_PROVIDERS } from '../../ai-control/providers.mjs'
import { envKeyRefusal } from '../../ai-control/key-policy.mjs'
import { redactText } from '../../exec/redact.mjs'

const RULE_LEVEL = { me: 'person', team: 'team', server: 'server' }
// the services beside the models (picture search, icons, transcription, Stability): server only
const isAux = (provider) => AUX_PROVIDER_IDS.includes(provider)
const AUX_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/
const SERVER = { type: 'server', id: 'server' }
const invalid = (message) => problem(400, 'invalid_request', message)

/**
 * deps: {
 *   store: { listConnections(owner), saveConnection(owner, doc), removeConnection(owner, name),
 *            getUse(owner) → { use, ownProviders? }, setUse(owner, value) },
 *   master (vault master key or null), settings (Meteor.settings), hosted (boolean),
 *   loadUser(id), isAdmin(userId), isTeamAdmin(user),
 *   check(connection, rules) → Test connection result (connection-check.mjs through a guarded fetch),
 *   listModels?(connection, rules) → { ok, models, message } (connection-check.mjs listModels),
 *   checkAux?(connection, rules) → Test connection result for a service beside the models
 *     (ai-control/aux-check.mjs: picture search, icons, transcription, Stability),
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
  listModels = null, checkAux = null,
  env = globalThis.process?.env || {}, checkLimit = { count: 20, windowMs: 10 * 60 * 1000 }, audit = null,
}) {
  const file = () => operatorConfig(settings)
  // AI control's resolver for one surface (ai-control/index.mjs sets it): a published binding's
  // on/off, model chain, parameters and tools apply to the request path through resolveFor.
  let bindingSource = null
  // ai.update at the server level also writes the server's bindings (ai-control bindings.mjs
  // syncServerUse), so a choice and a published binding never disagree. Set by ai-control/index.mjs.
  let useSync = null
  // the server's choices that changed: { [key]: ref | null }
  const useChanges = (before = {}, after = {}) => Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => (before[key] ?? null) !== (after[key] ?? null)).map((key) => [key, after[key] ?? null]))
  const syncServerUse = async (changes, actor, reason = null) => {
    if (useSync && Object.keys(changes).length) await useSync({ changes, actor, reason })
  }
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
  // A key lives sealed in the document (keyRef sealed, the default), in an environment variable the
  // key policy allows (keyRef env, read for each request), or nowhere. During a rotation's grace the
  // previous sealed key is opened too, for one retry after a refusal (spec 6.3).
  function fromDoc(doc, owner, withKey) {
    const legacy = doc.name || doc.lastError ? null : doc.provider === 'deepinfra' ? 'all' : doc.provider === 'openai-compatible' ? 'chat' : null
    const envName = doc.keyRef?.kind === 'env' ? doc.keyRef.name : null
    const envRefused = envName ? envKeyRefusal(envName, settings) : null
    const envValue = envName && !envRefused && typeof env[envName] === 'string' ? env[envName].trim() : ''
    const connection = {
      name: doc.name || (doc.provider === 'openai-compatible' ? 'own-model' : doc.provider),
      type: doc.provider,
      baseUrl: doc.baseUrl || connectionType(doc.provider)?.baseUrl || BUILTIN_PROVIDERS[doc.provider]?.baseUrl,
      ...(doc.model && { model: doc.model }),
      capabilities: doc.capabilities || {},
      ...(doc.maxTokens && { maxTokens: doc.maxTokens }),
      ...(doc.toolChoice && { toolChoice: doc.toolChoice }),
      hasKey: envName ? Boolean(envValue) : Boolean(doc.cipher && doc.last4),
      ...(legacy && { legacy }),
      lastError: doc.lastError ?? null,
      source: 'app',
      ...(doc.status === 'disabled' && { disabled: true }),
    }
    if (envName) {
      connection.keyEnv = envName
      if (envRefused) connection.keyError = `its key cannot be read: ${envRefused}`
      else if (!envValue) connection.keyError = `its key is not set: the environment variable ${envName} is empty or missing on this server`
      else if (withKey) connection.apiKey = envValue
      return connection
    }
    if (withKey && connection.hasKey) {
      const ownerKey = { ownerType: owner.type, ownerId: owner.id, provider: doc.provider }
      try {
        connection.apiKey = openKey({ master, owner: ownerKey, cipher: doc.cipher }) || undefined
      } catch {
        connection.unreadable = true
      }
      const grace = doc.previousCipher
      if (grace?.cipher && grace.until && new Date(grace.until).getTime() > now()) {
        try {
          connection.previousApiKey = openKey({ master, owner: ownerKey, cipher: grace.cipher }) || undefined
        } catch {}
      }
    }
    return connection
  }

  // What an administrator reads about the server's own connections: where each key lives and which
  // key it is (its fingerprint), its last test and whether it is turned off. Never the key.
  const adminExtras = (doc) => ({
    keyRef: doc.keyRef?.kind === 'env' ? { kind: 'env', name: doc.keyRef.name } : { kind: doc.cipher && doc.last4 ? 'sealed' : 'none' },
    keyFingerprint: doc.keyRef?.kind === 'env' ? null : doc.keyFingerprint ?? (doc.cipher && doc.last4 ? `…${doc.last4}` : null),
    keyRotatedAt: doc.keyRotatedAt ?? null,
    previousKeyUntil: doc.previousCipher?.until && new Date(doc.previousCipher.until).getTime() > now() ? doc.previousCipher.until : null,
    status: doc.status === 'disabled' ? 'disabled' : 'active',
    lastCheck: doc.lastCheck ?? null,
  })

  async function connectionsOf(owner, withKeys = false) {
    if (!owner) return []
    const docs = await store.listConnections(owner)
    return docs.filter((doc) => doc.provider !== 'daily' && connectionType(doc.provider)).map((doc) => fromDoc(doc, owner, withKeys))
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
  async function prepareConnections(owner, level, inputs, removing = [], { extended = false } = {}) {
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
      const previousEnv = previous?.keyRef?.kind === 'env' ? previous.keyRef : null
      const keyRef = extended ? input?.keyRef : undefined
      // a key that stays: none was sent and none was named; the saved one (sealed, or its environment variable) is kept
      const keepKey = input?.apiKey === undefined && keyRef === undefined && Boolean((previous?.cipher && previous?.last4) || previousEnv)
      const envRef = keyRef?.kind === 'env' ? keyRef : null
      if (envRef) {
        const refused = envKeyRefusal(envRef.name, settings)
        if (refused) throw invalid(refused)
        if (typeof input.apiKey === 'string') throw invalid('Send a key or name its environment variable, not both.')
      }
      if (keyRef?.kind === 'none' && typeof input.apiKey === 'string' && input.apiKey) throw invalid('keyRef none saves the connection without a key: leave the key out.')
      if (extended && input?.rotate && !(typeof input.apiKey === 'string' && input.apiKey)) throw invalid('A rotation goes with the new key: send apiKey.')
      const aux = isAux(input?.type)
      if (aux && level !== 'server') throw invalid(`${input.type} is a service of the server: only an administrator connects it.`)
      let connection
      try {
        connection = aux
          ? normalizeAuxConnection({ ...input, keepKey: keepKey || Boolean(envRef) })
          : normalizeConnection({ ...input, ...(keyRef?.kind === 'none' && { apiKey: undefined }), keepKey: keepKey || Boolean(envRef) }, contextFor(RULE_LEVEL[level]))
        const type = connectionType(connection.type)
        // an address the provider does not fix is checked against every address its name resolves to
        if (!aux && !(type?.baseUrl && type.baseUrlLocked && sameAddress(type.baseUrl, connection.baseUrl))) await assertHost(connection.baseUrl, rules)
        // a key named by environment variable goes only to an address a person fixed: the provider's
        // locked address, or one sent in this same change
        if (envRef && !aux && !(type?.baseUrlLocked) && input.baseUrl === undefined) throw new ConnectionError('A key from an environment variable needs the address in the same change.')
      } catch (error) {
        if (error instanceof ConnectionError || error instanceof EndpointRefused) throw invalid(error.message)
        throw error
      }
      let cipher = null, keyTail = ''
      const keyFields = {}
      if (keepKey && previous.provider !== connection.type) {
        throw invalid('Send the key again: the connection changed type.')
      } else if (keepKey && !sameAddress(previous.baseUrl || connectionType(previous.provider)?.baseUrl || BUILTIN_PROVIDERS[previous.provider]?.baseUrl, connection.baseUrl)) {
        throw invalid('Send the key again: the connection has a new address. Send an empty key to save it without one.')
      } else if (keepKey && previousEnv) {
        keyFields.keyRef = previousEnv
      } else if (keepKey) {
        ;({ cipher } = previous)
        keyTail = previous.last4
      } else if (envRef) {
        keyFields.keyRef = { kind: 'env', name: envRef.name }
        keyFields.keyFingerprint = null
        keyFields.previousCipher = null
      } else if (connection.apiKey) {
        if (!master) throw problem(503, 'unavailable', `${NOT_AVAILABLE} A connection without a key can still be saved.`)
        cipher = seal({ master, owner: { ownerType: owner.type, ownerId: owner.id, provider: connection.type }, plaintext: connection.apiKey })
        keyTail = last4(connection.apiKey)
        Object.assign(keyFields, { keyRef: { kind: 'sealed' }, keyFingerprint: keyFingerprint(connection.apiKey), keyRotatedAt: new Date(now()), previousCipher: null })
        // a rotation keeps the key it replaces working for the grace period (spec 6.3)
        const graceHours = extended ? input.rotate?.graceHours : undefined
        if (graceHours) {
          if (!previous?.cipher || previous.provider !== connection.type) throw invalid('There is no saved key to rotate from.')
          keyFields.previousCipher = { cipher: previous.cipher, keyId: previous.cipher.keyId ?? null, until: new Date(now() + graceHours * 3600 * 1000) }
        }
      } else {
        Object.assign(keyFields, { keyRef: { kind: 'none' }, keyFingerprint: null, previousCipher: null })
      }
      if (extended && input.status !== undefined) keyFields.status = input.status
      const { apiKey: _key, ...stored } = connection
      prepared.push({
        replacesLegacy: Boolean(previous && !previous.name),
        doc: {
          provider: stored.type, name: stored.name, baseUrl: stored.baseUrl, ...(stored.model && { model: stored.model }),
          capabilities: stored.capabilities, ...(stored.maxTokens && { maxTokens: stored.maxTokens }), ...(stored.toolChoice && { toolChoice: stored.toolChoice }),
          cipher, last4: keyTail, created: previous?.created ?? now(), updated: now(), lastError: null, ...keyFields,
        },
        fresh: typeof input?.apiKey === 'string' && input.apiKey ? keyFingerprint(input.apiKey) : null,
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
    if (doc.keyRef?.kind === 'env') return `env:${doc.keyRef.name}`
    if (!doc.cipher || !doc.last4) return null
    return fresh[legacyName(doc)] || doc.keyFingerprint || `…${doc.last4}`
  }
  const auditView = (docs, stored, fresh = {}) => ({
    connections: docs.filter((doc) => doc.provider !== 'daily').map((doc) => ({
      name: legacyName(doc), provider: doc.provider, baseUrl: doc.baseUrl ?? null, model: doc.model ?? null, keyFingerprint: keyMark(doc, fresh),
      ...(doc.status === 'disabled' && { status: 'disabled' }),
      ...(doc.previousCipher?.until && { previousKeyUntil: doc.previousCipher.until }),
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
    await syncServerUse(useChanges(stored.use, use), actorFor(userId, actor), reason)
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
    if (level === 'server') await syncServerUse(useChanges(stored.use, use), actorFor(userId, actor))
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

  // ---------- the server's connections, as AI control manages them (spec 1.2, 3.2) ----------
  async function requireAdmin(userId, doing) {
    const user = await signedIn(userId)
    if (!(await isAdmin(user._id))) throw problem(403, 'forbidden', `Only an administrator can ${doing}.`)
    return user
  }

  /**
   * The server's connections for the Providers and keys page: the settings file's (read-only) and
   * the app's, including the services beside the models, each with where its key lives, which key
   * it is (fingerprint), its last test and whether it is turned off. Never a key.
   */
  async function serverConnections(userId) {
    await requireAdmin(userId, 'read the server\'s connections')
    const config = file()
    const docs = (await store.listConnections(SERVER)).filter((doc) => doc.name && doc.provider !== 'daily')
    const fromFile = config.connections.map((c) => ({
      ...publicConnection(keyFromEnv(c, env)), provider: c.type,
      keyRef: c.apiKeyEnv ? { kind: 'env', name: c.apiKeyEnv } : { kind: c.apiKey ? 'file' : 'none' },
      keyFingerprint: null, status: 'active', lastCheck: null, editable: false,
    }))
    const fromApp = docs.filter((doc) => !config.connections.some((c) => c.name === doc.name)).map((doc) => {
      const connection = fromDoc(doc, SERVER, false)
      return { ...publicConnection(connection), provider: doc.provider, ...adminExtras(doc), editable: true, aux: isAux(doc.provider), known: Boolean(connectionType(doc.provider) || isAux(doc.provider)) }
    })
    return { connections: [...fromFile, ...fromApp], keysAvailable: Boolean(master), hosted: Boolean(hosted) }
  }

  /**
   * Adds or changes server connections (ai.connections.save): what ai.update does at level server,
   * plus where a key comes from (keyRef: sealed by sending apiKey, env with an allowed name, or
   * none), a rotation that keeps the old key working for graceHours, and on/off (status). Every
   * connection is checked before anything is written. → { connections: [names], fingerprints }
   */
  async function saveServerConnections(userId, inputs, { actor = null, reason = null } = {}) {
    await requireAdmin(userId, 'change the server\'s AI')
    if (!Array.isArray(inputs) || !inputs.length) throw invalid('Send at least one connection.')
    const before = await store.listConnections(SERVER)
    const prepared = await prepareConnections(SERVER, 'server', inputs, [], { extended: true })
    const stored = (await store.getUse(SERVER)) || { use: {} }
    await writeConnections(SERVER, prepared)
    const fresh = Object.fromEntries(prepared.filter((p) => p.fresh).map((p) => [p.doc.name, p.fresh]))
    await recordChange({
      action: 'ai.connections.save', actor: actorFor(userId, actor), target: { kind: 'connection', id: prepared.map((p) => p.doc.name).join(',') }, reason,
      before: auditView(before, stored), after: auditView(await store.listConnections(SERVER), stored, fresh),
    })
    return { connections: prepared.map((p) => p.doc.name), fingerprints: Object.fromEntries(prepared.map((p) => [p.doc.name, p.doc.keyRef?.kind === 'env' ? null : (fresh[p.doc.name] || (p.doc.last4 ? `…${p.doc.last4}` : null))])) }
  }

  /**
   * Removes server connections (ai.connections.remove). A choice that names one is cleared, as
   * ai.update does. inUse(names) → [binding ids] that still use them; those refuse the removal
   * unless force lists every one of them.
   */
  async function removeServerConnections(userId, { names, force = [], reason, actor = null, inUse = async () => [] }) {
    await requireAdmin(userId, 'change the server\'s AI')
    const docs = await store.listConnections(SERVER)
    const fileNames = file().connections.map((c) => c.name)
    for (const name of names) {
      if (fileNames.includes(name)) throw invalid(`${name} is set in the server's settings file. Remove it there.`)
      if (!docs.some((doc) => legacyName(doc) === name && doc.provider !== 'daily')) throw problem(404, 'not_found', `There is no connection ${name} here.`)
    }
    const using = await inUse(names)
    const unforced = using.filter((id) => !force.includes(id))
    if (unforced.length) throw problem(409, 'conflict', `Published bindings still use ${names.join(', ')}: ${unforced.join(', ')}. Change them first, or send force with those bindings to let them fall back.`, { details: { bindings: unforced } })
    const stored = (await store.getUse(SERVER)) || { use: {} }
    const use = { ...(stored.use || {}) }
    for (const name of names) for (const [key, ref] of Object.entries(use)) if (ref === `server:${name}`) delete use[key]
    for (const name of names) await store.removeConnection(SERVER, name)
    await syncServerUse(useChanges(stored.use, use), actorFor(userId, actor), reason)
    const next = { ...stored, use }
    await store.setUse(SERVER, next)
    await recordChange({
      action: 'ai.connections.remove', actor: actorFor(userId, actor), target: { kind: 'connection', id: names.join(',') }, reason,
      before: auditView(docs, stored), after: auditView(await store.listConnections(SERVER), next),
    })
    return { removed: names, clearedChoices: Object.keys(stored.use || {}).filter((key) => !(key in use)) }
  }

  /** Changes a provider's address: every server connection of that provider loses its sealed key. → [names] */
  async function dropProviderKeys(provider) {
    const docs = (await store.listConnections(SERVER)).filter((doc) => doc.provider === provider && doc.name && doc.cipher)
    for (const doc of docs) {
      await store.saveConnection(SERVER, { ...doc, cipher: null, last4: '', keyRef: { kind: 'none' }, keyFingerprint: null, previousCipher: null, updated: now() })
    }
    return docs.map((doc) => doc.name)
  }

  /** Server connections of a provider (for ai.providers.archive and an address change). */
  async function connectionsOfProvider(provider) {
    return (await store.listConnections(SERVER)).filter((doc) => doc.provider === provider && doc.name)
      .map((doc) => ({ name: doc.name, hasKey: Boolean(doc.cipher && doc.last4) || doc.keyRef?.kind === 'env' }))
  }

  /**
   * The models a server connection lists (ai.models.discover), through the guarded fetch. Writes
   * nothing; counts as a connection test for the rate limit.
   */
  async function discoverModels(userId, { name }) {
    const user = await requireAdmin(userId, 'list a connection\'s models')
    if (!listModels) throw problem(503, 'unavailable', 'Listing models is not available on this server.')
    takeCheck(user._id)
    const saved = [...file().connections.map((c) => keyFromEnv(c, env)), ...(await connectionsOf(SERVER, true))]
    const connection = saved.find((c) => c.name === name)
    if (!connection) throw problem(404, 'not_found', `There is no connection ${name} here.`)
    if (connection.unreadable) throw invalid('The key of this connection could not be read. Add it again.')
    if (connection.keyError) throw invalid(`${connection.name}: ${connection.keyError}.`)
    const rules = rulesFor(connection.source === 'file' ? 'file' : 'server')
    try {
      checkEndpointUrl(connection.baseUrl, rules)
    } catch (error) {
      throw invalid(error.message)
    }
    const out = await listModels(connection, rules)
    return { connection: `server:${name}`, ...out, message: redactText(out.message, { keys: [connection.apiKey] }) }
  }

  /**
   * The key of a service beside the models (picture search, icons, transcription, Stability) for
   * one request: the server's active connection of that provider, its sealed key opened now, so a
   * key rotated in the app is used without a restart. → { name, apiKey, model, baseUrl,
   * previousApiKey? } or null (then the settings file applies).
   */
  async function auxCredential(provider) {
    if (!isAux(provider)) return null
    const docs = (await store.listConnections(SERVER))
      .filter((doc) => doc.provider === provider && doc.name && doc.status !== 'disabled')
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const doc of docs) {
      const connection = fromDoc(doc, SERVER, true)
      if (connection.apiKey) {
        return { name: connection.name, apiKey: connection.apiKey, model: connection.model ?? null, baseUrl: connection.baseUrl, ...(connection.previousApiKey && { previousApiKey: connection.previousApiKey }) }
      }
    }
    return null
  }

  /** Whether the server has a usable key for a service beside the models, in the app (not the settings file). */
  async function hasAuxKey(provider) {
    const docs = (await store.listConnections(SERVER)).filter((doc) => doc.provider === provider && doc.name && doc.status !== 'disabled')
    return docs.some((doc) => fromDoc(doc, SERVER, false).hasKey)
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
    // a service beside the models (picture search, icons, transcription, Stability): its own probe
    if (level === 'server' && input.name && !saved.some((c) => c.name === input.name)) {
      const doc = (await store.listConnections(SERVER)).find((d) => d.name === input.name && isAux(d.provider))
      if (doc) {
        if (!checkAux) throw problem(503, 'unavailable', 'Testing this kind of key is not available on this server.')
        const aux = fromDoc(doc, SERVER, true)
        if (aux.unreadable) throw invalid('The key of this connection could not be read. Add it again.')
        if (aux.keyError) throw invalid(`${aux.name}: ${aux.keyError}.`)
        return timedCheck(aux, () => checkAux(aux, rulesFor('server')))
      }
    }
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
    // a saved server connection keeps its last test (lastCheck), for the Providers and keys page
    if (level === 'server' && input.name && connection.source === 'app') return timedCheck(connection, () => check(connection, rules))
    return check(connection, rules)
  }

  // Runs a test of a saved server connection and keeps the outcome on it: when, whether it worked,
  // how long it took, and the message with anything key-like taken out (spec 6.2).
  async function timedCheck(connection, run) {
    const started = now()
    const result = await run()
    const lastCheck = { at: new Date(now()), ok: Boolean(result?.ok), latencyMs: Math.max(0, now() - started), error: result?.ok ? null : redactText(result?.message, { keys: [connection.apiKey, connection.previousApiKey] }) }
    try {
      await store.setLastCheck?.(SERVER, connection.name, lastCheck)
    } catch (error) {
      console.warn(`ai-settings: could not keep the last test of ${connection.name}: ${error.message}`)
    }
    return { ...result, ...(typeof result?.message === 'string' && { message: redactText(result.message, { keys: [connection.apiKey, connection.previousApiKey] }) }), latencyMs: lastCheck.latencyMs }
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
    // AI control (ai-control/resolve.mjs): a published binding's on/off, model chain and parameters
    const binding = await controlBinding({ surface, user, person, team, server })
    if (binding?.enabled === false) {
      return { ref: 'disabled', scope: 'disabled', connection: null, own: false, feature: surface, rules: null, disabled: true, message: binding.disabledMessage, control: controlOf(binding) }
    }
    const control = binding && touchesRequest(binding) ? controlOf(binding) : null
    if (binding?.chainFromBinding && !binding.tripped) {
      // the surface whose binding applied names it in messages (a part that follows names its parent)
      const named = binding.followed || surface
      const chain = []
      for (const entry of binding.chain) chain.push(await routeForEntry(entry, { user, feature: named, request }))
      // always with the surface and version: each attempt's audit row and this pod's breaker need them
      return { ...chain[0], chain, control: controlOf(binding) }
    }
    // a surface whose binding kept failing on this pod (ai-control/breaker.mjs): the settings file
    // and the built-in AI only, until the breaker closes
    const choice = binding?.tripped
      ? resolveAIChoice({ feature: surface, server: { connections: file().connections, use: file().use }, ownProviders: false })
      : resolveAIChoice({ feature: surface, person, team, server, ownProviders: server.ownProviders })
    if (!choice.connection) return { ...choice, rules: null, ...(control && { control }) }
    const owner = choice.scope === 'me' ? meOwner : choice.scope === 'team' ? teamOwner : SERVER
    const chosen = await loadChosen({ connection: choice.connection, owner, scope: choice.scope, user, feature: choice.feature, request })
    return { ...choice, ...chosen, ...(control && { control }) }
  }

  // The connection a choice or a chain entry names, with its key, the endpoint rules of its level,
  // the label a person may read, and why it cannot be used (turned off, key unreadable, address
  // refused, a capability the request needs).
  async function loadChosen({ connection: named, owner, scope, user, feature, request }) {
    let connection = named
    if (connection.source !== 'file') {
      const docs = await connectionsOf(owner, true)
      connection = docs.find((c) => c.name === connection.name) || connection
    } else {
      connection = keyFromEnv(connection, env)
    }
    const rules = rulesFor(connection.source === 'file' ? 'file' : RULE_LEVEL[scope])
    // a person reads about the operator's connection by its model, not by where it lives
    const withHost = scope !== 'server' || Boolean(user && await isAdmin(user._id))
    const label = connectionLabel(connection, { withHost })
    let error = null
    if (connection.disabled) error = `${label} is turned off by your administrator. Choose another model in your AI settings.`
    else if (connection.unreadable) error = `The key for ${label} could not be read. Add it again in your AI settings.`
    else if (connection.keyError) error = `${label} is not configured: ${connection.keyError}.`
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

  // One entry of a published binding's model chain as the request path walks it.
  async function routeForEntry(entry, { user, feature, request }) {
    const on = entry.on?.length ? [...entry.on] : ['any']
    if (entry.connection === 'builtin') {
      // the surface's own built-in model (the call site's), or a built-in model the registry names
      const builtin = entry.builtinDefault || !entry.model ? null : { provider: entry.provider, engine: entry.model }
      return { ref: 'builtin', scope: 'builtin', connection: null, own: false, feature, rules: null, on, ...(builtin && { builtin }) }
    }
    const name = String(entry.connection).replace(/^server:/, '')
    const server = await serverState()
    const listed = server.connections.find((c) => c.name === name)
    if (!listed) return { ref: entry.connection, scope: 'server', connection: null, own: false, feature, rules: null, on, error: `The connection ${name} is no longer on this server.` }
    // a model registry row names the model and adds what it knows the model can do
    const named = entry.modelId ? { ...listed, model: entry.model, capabilities: { ...(listed.capabilities || {}), ...(entry.capabilities || {}) } } : listed
    const chosen = await loadChosen({ connection: named, owner: SERVER, scope: 'server', user, feature, request })
    if (entry.modelId && chosen.connection) chosen.connection = { ...chosen.connection, model: entry.model, capabilities: named.capabilities }
    return { ref: entry.connection, scope: 'server', own: false, feature, on, ...chosen }
  }

  // The resolved AI control binding for a surface, or null without the control plane (tests, or
  // before ai-control/index.mjs set its source). Never throws: a broken binding is skipped.
  async function controlBinding({ surface, user, person, team, server }) {
    if (!bindingSource) return null
    try {
      return await bindingSource({
        surface, userId: user?._id ?? null, orgId: user?.orgId ?? null,
        holders: { person, team, server: { connections: server.connections, use: server.use }, ownProviders: server.ownProviders, serverUseSource: server.useSource },
      })
    } catch (error) {
      console.warn(`ai-settings: the AI control binding for ${surface} could not be read; the AI settings apply: ${error.message}`)
      return null
    }
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

  return {
    view, update, resetServerUse, check: checkOne, resolveFor, serverState, choiceHolders,
    setBindingSource: (source) => { bindingSource = typeof source === 'function' ? source : null },
    setServerUseSync: (sync) => { useSync = typeof sync === 'function' ? sync : null },
    serverConnections, saveServerConnections, removeServerConnections, dropProviderKeys, connectionsOfProvider, discoverModels,
    auxCredential, hasAuxKey,
  }
}

export { parseRef }

// Whether a resolved binding changes anything in a request beyond its model chain: parameters,
// tools or limits a published binding set (provenance db:...).
function touchesRequest(binding) {
  return Object.entries(binding.provenance || {}).some(([field, layer]) => /^(params|tools)\./.test(field) && String(layer).startsWith('db:'))
}

/** What req.js reads of a resolved binding: the surface, its version, parameters and tools a binding set. */
export function controlOf(binding) {
  const fromBinding = (field) => String(binding.provenance?.[field] || '').startsWith('db:')
  const params = {}
  for (const [key, value] of Object.entries(binding.params || {})) if (fromBinding(`params.${key}`) && value !== null && value !== undefined) params[key] = value
  return {
    surface: binding.surface,
    bindingVersion: binding.bindingVersion ?? null,
    params,
    tools: { mode: fromBinding('tools.mode') ? binding.tools?.mode ?? null : null, allow: fromBinding('tools.allow') ? binding.tools?.allow ?? null : null },
  }
}


/**
 * A service beside the models as an administrator connects it: a built-in provider (Stability,
 * Google picture search, Noun Project, Deepgram) at its own address, with a key and, for picture
 * search, the search engine ID (model). Throws ConnectionError.
 */
export function normalizeAuxConnection(input) {
  const provider = BUILTIN_PROVIDERS[input?.type]
  if (!provider?.aux) throw new ConnectionError(`Choose a service: ${AUX_PROVIDER_IDS.join(', ')}.`)
  if (typeof input.name !== 'string' || !AUX_NAME.test(input.name)) throw new ConnectionError('Name the connection with lowercase letters, digits and dashes, for example picture-search.')
  if (input.baseUrl !== undefined && input.baseUrl !== null && String(input.baseUrl).replace(/\/+$/, '') !== provider.baseUrl) {
    throw new ConnectionError(`${provider.label} has its own address.`)
  }
  const model = typeof input.model === 'string' ? input.model.trim() : null
  if (model && (model.length > 200 || /[\r\n]/.test(model))) throw new ConnectionError(`${provider.modelLabel || 'The model'} is one line of at most 200 characters.`)
  if (!model && !provider.modelOptional) throw new ConnectionError(`Enter the ${(provider.modelLabel || 'model').toLowerCase()}.`)
  const apiKey = input.apiKey
  if (apiKey !== undefined && apiKey !== null && (typeof apiKey !== 'string' || /[\r\n]/.test(apiKey) || apiKey.length > 400)) throw new ConnectionError('Paste the key on one line.')
  if (apiKey && provider.keyParts && apiKey.split(':').length !== provider.keyParts.length) throw new ConnectionError(`${provider.label} takes ${provider.keyParts.join(' and ')}: paste them as ${provider.keyParts.join(':')}.`)
  if (!apiKey && !input.keepKey) throw new ConnectionError(`${provider.label} needs a key.`)
  return { name: input.name, type: input.type, baseUrl: provider.baseUrl, ...(model && { model }), capabilities: {}, ...(apiKey && { apiKey }) }
}

/** Which key this is, without the key (spec 1.2): sha256: + the first 8 hex of its sha256 + …last 4. */
export function keyFingerprint(key) {
  if (typeof key !== 'string' || !key) return null
  return `sha256:${createHash('sha256').update(key).digest('hex').slice(0, 8)}…${key.slice(-4)}`
}
