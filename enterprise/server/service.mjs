// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Outside agents on a slate (Slatebox as an MCP client), without Meteor: the stores, the network,
// the models, the registry and presence are passed in (meteor.js wires the real ones; the tests
// pass fakes).
//
//   discover   reach the address (mcpFetch), list its tools, say in plain words what it can do
//   signIn     a server that needs sign-in: a popup sign-in flow (signin.mjs), or a pasted key or
//              token (useKey). What it issues goes into the person's vault (credentials.mjs).
//   connect    invite it onto one slate: the name it wears, the tools it may use (consent is to
//              each tool's hash), what it may see.
//   call       the inviter asks it something (in Ask Slatebox, "@name"). A gallery agent's known ask
//              runs its recipe (fixed steps, no planner); anything else is planned by Slatebox's
//              model (one round of two calls unless its recipe says more; read-me tools never
//              offered), the results are quarantined, a quarantined model lays them out (or a
//              recipe's output rule, or the Excalidraw recipe: only one of those per ask), trimmed
//              to what the request asked for ("a 3 node diagram" is 3 notes), and the whole answer
//              is saved ONCE as the agent through slates.applyOperations, where an agent's canvas edit
//              becomes a live suggestion (server/agents/suggestions.mjs): ghosts everyone on the
//              slate sees as they appear, the agent's named cursor moving to each.
//              Keeping, discarding and undoing are the app's own suggestions.decide (Keep all /
//              Discard all on the answer's frame and the agent's chip, Keep and Discard on a ghost
//              under the pointer, Undo per action),
//              by anyone who can edit the slate; an agent a person lets edit directly saves at once.
//   disconnect the inviter (or the slate's owner) removes the agent from one slate; its waiting
//              suggestions are discarded. The integration and its sign-in stay (connect once).
//
// Integrations (owner, 2026-11-24: "connect once, invite anywhere"): a person's connected agent
// servers are kept once (the `integrations` store: one row per person and address, with the tools
// they consented to), apart from any slate. Connecting from a slate makes the integration too.
// From the Integrations page a person connects, reviews, disconnects (revoked and removed from every
// slate) and sets a standing rule: 'ask' (invite it yourself) or 'my_slates' (it joins every slate
// they own). Inviting an integration onto a slate needs no new sign-in and no new consent. A removal
// from a slate is remembered: a rule never brings it back there. A slate's owner may limit who
// brings outside agents onto it (outsideAgents: editors, owner, off). The sign-in lives as long as
// its integration, not its slates.
//
// Rules every entry point enforces (owner decisions 2026-11-23/24): enterprise code unlocked
// (Slatebox Cloud, or a licensed self-hosted install) and the kill switch off (the loader registers
// nothing otherwise); on Cloud the inviter needs Slatebox Pro (checked on every discover, connect
// and call, not only in the browser; a licensed install has no Pro, so `pro` answers true there); only the inviter can call the agent;
// everyone who can read the slate sees its cursor and ghosts; the person who keeps must be able
// to edit the slate.
import { createHash, randomBytes } from 'node:crypto'
import { sameAgentName } from '/imports/api/common/agent-mention.mjs'
import { canonicalAddress, cardFor, DEAD_HOSTS, GALLERY, lookalikeHost } from '../common/gallery.mjs'
import { checkMcpUrl, McpFetchRefused } from './mcp-fetch.mjs'
import { SignInNeeded } from './credentials.mjs'
import { SignInProblem } from './oauth.mjs'
import { KEY_PATTERN } from './signin.mjs'
import { capabilitySummary, defaultPolicy, normalizeTools, plainText, POLICIES, reconcile } from './tools.mjs'
import { quarantine } from './results.mjs'
import { CONTEXT_LEVELS, packContext } from './context.mjs'
// The plan and layout words: the registry's (a version an administrator published, else the code's).
import { promptText } from '/server/ai-control/prompts/index.mjs'
import {
  checkArguments, checkLayout, checkPlan, excalidrawElements, fitArgs, itemsFromLayout, layoutTool, linksIn, PLAN_LIMITS, planPrompt, planTool, recipeHint, translatePrompt,
} from './translate.mjs'
import { excalidrawGroup } from './excalidraw.mjs'
import {
  checkRecipe, cutWords, dedupeGroups, extract, interleave, isReferenceTool, matchIntent, outputNotes, planLimits, rawData, rawText, RECIPE_LIMITS, requestBudget, requestValues,
  stepCalls, stepTool, trimToBudget,
} from './recipes.mjs'

export const AGENT_LIMITS = Object.freeze({ perSlate: 8, perOwnerPerSlate: 3, beatMs: 450, requestChars: 1000, nameChars: 32, proEndedDays: 30, orphanHours: 24, concurrentPerUser: 3, helloMs: 8000, integrationsPerOwner: 40 })

/** The standing rules an integration may have: invite it yourself, or it joins every slate you own. */
export const RULES = Object.freeze(['ask', 'my_slates'])
/** Who may bring outside agents onto a slate (its owner's choice). */
export const OUTSIDE_AGENTS = Object.freeze(['editors', 'owner', 'off'])

// A small in-memory store with the same shape as the Meteor ones (tests, and a service built without one).
export function memoryStore() {
  const rows = []
  const matches = (row, query) => Object.entries(query).every(([k, v]) => {
    if (v && typeof v === 'object' && '$ne' in v) return row[k] !== v.$ne
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(row[k])
    return row[k] === v
  })
  return {
    rows,
    insert: async (doc) => {
      if (rows.some((row) => row._id === doc._id)) throw Object.assign(new Error('duplicate key'), { code: 11000 })
      rows.push(structuredClone(doc))
    },
    findOne: async (query) => rows.find((row) => matches(row, query)) || null,
    find: async (query) => rows.filter((row) => matches(row, query)),
    update: async (id, set) => Object.assign(rows.find((row) => row._id === id) || {}, set),
    remove: async (id) => {
      const at = rows.findIndex((row) => row._id === id)
      if (at >= 0) rows.splice(at, 1)
    },
  }
}

export class ConnectorRefused extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    if (details !== undefined) this.details = details
  }
}
const refuse = (status, code, message, details) => {
  throw new ConnectorRefused(status, code, message, details)
}

export const PRO_REQUIRED = 'Inviting agents onto your slates is part of Slatebox Pro and Slatebox Business.'
export const INTEGRATIONS_PRO = 'Integrations are part of Slatebox Pro and Slatebox Business.'

/** What its owner sees of an integration on the Integrations page: never a token. */
export function publicIntegration(doc, { slates = [], cards = GALLERY, pro = true } = {}) {
  return {
    integrationId: doc._id,
    kind: doc.kind || 'mcp',
    name: doc.name,
    host: doc.host,
    address: doc.address,
    galleryId: doc.galleryId || cardFor(doc.address, cards)?.id || null,
    owner: 'personal',
    status: !pro && doc.status === 'active' ? 'pro_ended' : doc.status,
    rule: RULES.includes(doc.rule) ? doc.rule : 'ask',
    defaultContextLevel: doc.defaultContextLevel || 'request',
    signedIn: Boolean(doc.auth),
    ...(doc.auth && { auth: { kind: doc.auth.kind } }),
    scopes: Array.isArray(doc.scopes) ? doc.scopes.slice(0, 24) : [],
    tools: (doc.tools || []).map(({ name, title, group, policy }) => ({ name, title, group, policy })),
    ...(doc.changed?.length && { changed: doc.changed.map((c) => c.name) }),
    colorIndex: doc.colorIndex ?? 1,
    lastUsedAt: doc.lastUsedAt || null,
    createdAt: doc.createdAt || null,
    slateCount: slates.length,
    slates: slates.slice(0, 20),
  }
}

/** The principal an invited agent's work runs as: the inviter's account, named after the agent. */
export const connectorPrincipal = (connection, runId) => ({
  kind: 'agent',
  userId: connection.ownerId,
  tokenId: 'connector:' + connection._id,
  tokenName: connection.name,
  scopes: ['slates:read', 'slates:write'],
  runId,
  connector: { id: connection._id, name: connection.name, ...(Number.isInteger(connection.colorIndex) && { colorIndex: connection.colorIndex }) },
})

const newId = (prefix = '') => prefix + randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x')

// The name on the slate: the inviter's words, cleaned by the same rule as every agent name
// (no "Slatebox", "admin", "official" ...). Never the server's own name unchecked.
export function slateName(raw, sanitize) {
  const name = sanitize(plainText(raw, AGENT_LIMITS.nameChars))
  return name || null
}

/**
 * What anyone who can read the slate sees of an agent; the inviter also sees its tools. galleryId:
 * the gallery card it was invited from (so the gallery can say "On this slate" without the address).
 */
export function publicConnection(doc, viewerId, cards = GALLERY) {
  const mine = doc.ownerId === viewerId
  return {
    connectionId: doc._id,
    galleryId: doc.galleryId || cardFor(doc.address, cards)?.id || null,
    // The agent's id on this slate: its suggestions and activity are filed under it (suggestions.list).
    agentId: doc.agentId || null,
    name: doc.name,
    colorIndex: doc.colorIndex ?? 1,
    invitedBy: doc.inviterName || '',
    // How it came here: a person invited it, or its owner's standing rule brought it.
    joinedBy: doc.joinedBy === 'rule' ? 'rule' : 'invite',
    integrationId: doc.integrationId || null,
    host: doc.host,
    status: doc.status,
    signedIn: Boolean(doc.auth),
    mine,
    ...(mine && {
      address: doc.address,
      contextLevel: doc.contextLevel,
      tools: (doc.tools || []).map(({ name, title, group, policy }) => ({ name, title, group, policy })),
      ...(doc.changed?.length && { changed: doc.changed }),
    }),
  }
}

export function createConnectorService({
  connections, // { insert(doc), findOne(query), find(query) -> array, update(id, set), remove(id) }
  suggestions, // { agentIdOf(principal, slate), withdraw(person, slate, agentId), paused(slate) }: the app's suggestion store (server/agents/suggestions.mjs)
  fetch, // mcpFetch
  session, // { discover(address, fetch), callTool(address, fetch, { name, args, check }) }
  model, // async ({ feature, tool, system, user, userId, shareId }) -> the tool call's arguments (object), inside the metered request
  metered = (fn) => fn(), // (fn, { userId, shareId }) runs fn inside one metered AI request (runAIAction)
  applyOperations, // async (principal, { shareId, plan, expectedRevision }, mode) -> { status, body }: an agent's save is a suggestion (202, outcome suggested)
  access, // { forUser(shareId, userId) -> { slate, canRead, canEdit } | null, forToken(principal, shareId) -> same | null, reload(shareId) -> slate }
  pro, // async (userId) -> boolean
  firstName, // async (userId) -> string
  sanitizeName, // agent-label.mjs sanitizeClientName
  presence, // { plan(principal, slate, steps), step(principal, slate, index, status), saved(principal, slate, { targets, message }), end(runId, outcome) }
  vault = null, // credentials.mjs: { available(), save(...), describe(userId, address), tokenFor(userId, address, { force }), remove(userId, address) }
  signIn = null, // signin.mjs: { plan({ address, challenge }), start({ userId, address, challenge, clientId }), status({ userId, flowId }) }
  probe = null, // (address, fetch) -> { open } | { challenge }: the server's sign-in challenge
  devOrigins = [],
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  later = (fn, ms) => setTimeout(fn, ms),
  audit = () => {},
  promptOf = promptText, // (id, values) -> the prompt's text (the registry)
  gallery = async () => GALLERY, // the live gallery (aiAgents, edited in /admin/ai), else the built-in cards
  integrations = memoryStore(), // { insert, findOne, find, update, remove }: each person's connected agent servers, apart from any slate
  slateSettings = memoryStore(), // { findOne({ _id: slateId }), insert, update }: a slate owner's outsideAgents choice
  slateList = async () => [], // async (slateIds, viewerId) -> [{ slateId, shareId, name }]: those slates the viewer can still open
}) {
  // How many outside reaches each person has running now: a few at once, never a flood.
  const running = new Map()
  async function oneAtATime(principal, fn) {
    const key = principal?.userId || ''
    const n = running.get(key) || 0
    if (n >= AGENT_LIMITS.concurrentPerUser) refuse(429, 'busy', 'Slatebox is still reaching outside servers for you. Wait for those to finish, then try again.')
    running.set(key, n + 1)
    try {
      return await fn()
    } finally {
      const left = (running.get(key) || 1) - 1
      if (left > 0) running.set(key, left)
      else running.delete(key)
    }
  }

  // A token (API, exec, MCP) by the token rule: its account's own rights on the slate, never an
  // unlisted link's (a bearer token carries no invitation). A signed-in page by its session's rule.
  const accessOf = (principal, shareId) =>
    (principal.kind === 'agent' && !principal.connector && access.forToken ? access.forToken(principal, shareId) : access.forUser(shareId, principal.userId))

  async function requireEditor(principal, shareId) {
    if (!principal?.userId || principal.kind === 'guest' || principal.kind === 'visitor')
      refuse(401, 'sign_in', 'Save your account to invite agents.')
    const found = await accessOf(principal, shareId)
    if (!found?.slate || !found.canRead) refuse(404, 'not_found', 'Slate not found or unavailable.')
    if (!found.canEdit) refuse(403, 'forbidden', 'Only people who can edit this slate can do that.')
    return found.slate
  }
  async function requirePro(userId, words = PRO_REQUIRED) {
    if (!(await pro(userId))) refuse(402, 'pro_required', words)
  }
  // A signed-in person (never a guest), and, when a slate is named, someone who may edit it.
  async function requirePerson(principal, shareId) {
    if (shareId !== undefined && shareId !== null) return requireEditor(principal, shareId)
    if (!principal?.userId || principal.kind === 'guest' || principal.kind === 'visitor')
      refuse(401, 'sign_in', 'Save your account to connect integrations.')
    return null
  }
  // The slate owner's choice of who may bring outside agents here (editors by default).
  async function outsideAgentsOf(slate) {
    const row = await slateSettings.findOne({ _id: slate._id })
    return OUTSIDE_AGENTS.includes(row?.outsideAgents) ? row.outsideAgents : 'editors'
  }
  async function checkOutsideAgents(principal, slate) {
    const setting = await outsideAgentsOf(slate)
    if (setting === 'off') refuse(403, 'agents_off', 'This slate\'s owner turned off outside agents here.')
    if (setting === 'owner' && slate.userId !== principal.userId) refuse(403, 'owner_only', 'Only this slate\'s owner can bring outside agents here.')
  }
  async function requireReader(principal, shareId) {
    const found = principal?.userId ? await accessOf(principal, shareId) : null
    if (!found?.slate || !found.canRead) refuse(404, 'not_found', 'Slate not found or unavailable.')
    return found
  }

  function checkAddress(raw) {
    const address = canonicalAddress(raw)
    if (!address) refuse(400, 'bad_address', 'That is not a web address.')
    try {
      checkMcpUrl(address, { devOrigins })
    } catch (error) {
      if (error instanceof McpFetchRefused) refuse(400, error.code, error.message)
      throw error
    }
    const host = new URL(address).host
    if (DEAD_HOSTS.some((dead) => host === dead || host.endsWith('.' + dead))) refuse(400, 'dead_listing', 'This listing points to a service that shut down.')
    return { address, host }
  }

  const fromProblem = (error) => {
    if (error instanceof ConnectorRefused) return error
    if (error?.code && typeof error.message === 'string' && error.name === 'McpProblem') return new ConnectorRefused(422, error.code, error.message)
    return error
  }

  const fromSignIn = (error) => {
    if (error instanceof SignInNeeded) return new ConnectorRefused(401, error.code === 'busy' ? 'busy' : 'needs_sign_in', error.message)
    if (error instanceof SignInProblem) return new ConnectorRefused(422, error.code, error.message)
    return fromProblem(error)
  }

  // The person's token for this address: null when they never signed in to it.
  async function tokenOf(userId, address, options) {
    if (!vault) return null
    return vault.tokenFor(userId, address, options)
  }

  // Discovery with the person's own sign-in when they have one. A refused token is renewed once
  // (refresh under the lease); still refused means "sign in again".
  async function discoverAs(userId, address) {
    let token = null
    try {
      token = await tokenOf(userId, address)
    } catch (error) {
      if (error instanceof SignInNeeded && error.code === 'needs_sign_in') return { needsSignIn: true, again: true }
      throw fromSignIn(error)
    }
    try {
      return { found: await session.discover(address, fetch, { token }), token }
    } catch (error) {
      const problem = fromProblem(error)
      if (problem?.code !== 'needs_sign_in') throw problem
      if (!token) return { needsSignIn: true, again: false }
    }
    try {
      token = await tokenOf(userId, address, { force: true })
      return { found: await session.discover(address, fetch, { token }), token }
    } catch (error) {
      const problem = fromSignIn(error)
      if (problem?.code === 'needs_sign_in') return { needsSignIn: true, again: true }
      throw problem
    }
  }

  // What signing in to this server takes, read from its own metadata (every check in oauth.mjs).
  async function signInPlan(address) {
    if (!vault?.available?.() || !signIn || !probe) refuse(422, 'vault_off', 'Agents that need sign-in are not available on this server.')
    let challenge = null
    try {
      const answer = await probe(address, fetch)
      challenge = answer.challenge || null
    } catch (error) {
      throw fromProblem(error)
    }
    try {
      return { ...(await signIn.plan({ address, challenge })), keyAllowed: true }
    } catch (error) {
      // No sign-in details at all: a pasted key or token is the only way in.
      if (error instanceof SignInProblem && error.code === 'no_sign_in_details') return { method: 'key', keyAllowed: true, note: error.message }
      throw fromSignIn(error)
    }
  }

  async function discover(principal, input) {
    return oneAtATime(principal, () => discoverNow(principal, input))
  }

  // shareId: discovering from a slate's walkthrough. Without one: from the Integrations page.
  async function discoverNow(principal, { shareId, address: raw }) {
    const slate = await requirePerson(principal, shareId)
    await requirePro(principal.userId, slate ? PRO_REQUIRED : INTEGRATIONS_PRO)
    const { address, host } = checkAddress(raw)
    const cards = await gallery()
    const card = cardFor(address, cards)
    // Already on this slate as this person's agent: the page says so and offers Manage (connect
    // refuses a second copy). Signing in again for it is still a discovery, so this is not a refusal.
    const here = slate ? (await connections.find({ slateId: slate._id, ownerId: principal.userId, status: { $ne: 'removed' } })).find((doc) => canonicalAddress(doc.address) === address) : null
    // Paused because its tools changed: inviting again is how its inviter looks at them (connect
    // updates that agent), so the walkthrough carries on instead of offering Manage.
    let alreadyHere = here ? { connectionId: here._id, agentId: here.agentId || null, name: here.name, text: `${here.name} is already on this slate.`, ...(here.status === 'paused' && { lookAgain: true, text: `${here.name}'s tools changed. Look at them and invite it again.` }) } : null
    const head = { address, host, lookalike: lookalikeHost(address), card: card ? { id: card.id, name: card.name } : null, ...(alreadyHere && { alreadyHere }) }
    const reached = await discoverAs(principal.userId, address)
    if (reached.needsSignIn) {
      const plan = await signInPlan(address)
      audit({ kind: 'discover', userId: principal.userId, host, signIn: plan.method })
      return { ...head, suggestedName: slateName(card?.name || host.split('.').slice(-2, -1)[0] || 'Agent', sanitizeName) || 'Agent', signIn: { ...plan, again: reached.again }, tools: [], summary: null }
    }
    const { found } = reached
    const tools = normalizeTools(found.tools)
    if (!tools.length) refuse(422, 'no_tools', `${host} answered, but offers no tools Slatebox can use.`)
    // Nothing it was allowed is offered any more: the same, look at its tools again.
    if (alreadyHere && !alreadyHere.lookAgain && !reconcile(here.tools, tools).allowed.length)
      alreadyHere = { ...alreadyHere, lookAgain: true, text: `${here.name} has nothing left it may look up. Choose again and invite it again.` }
    if (alreadyHere) head.alreadyHere = alreadyHere
    const signedIn = reached.token ? await vault.describe(principal.userId, address) : null
    // Signed in again: this person's agents on this server that were waiting for it can be asked.
    if (reached.token) {
      for (const doc of await connections.find({ ownerId: principal.userId, address, status: 'needs_sign_in' })) await setStatus(doc, 'active')
      for (const row of await integrations.find({ ownerId: principal.userId, address, status: 'needs_sign_in' })) await integrations.update(row._id, { status: 'active', auth: { kind: signedIn.kind, issuer: signedIn.issuer }, scopes: signedIn.scopes || [], updatedAt: new Date(now()) })
    }
    audit({ kind: 'discover', userId: principal.userId, host, tools: tools.length })
    // Already one of this person's integrations: the page offers to invite it instead of connecting again.
    const integration = await integrations.findOne({ ownerId: principal.userId, address })
    return {
      ...head,
      ...(integration && { integration: { integrationId: integration._id, name: integration.name, status: integration.status } }),
      ...(signedIn && { signedIn: { kind: signedIn.kind } }),
      // Self-reported: shown as the server's claim, never used as the name on the slate.
      serverName: plainText(found.serverInfo?.title || found.serverInfo?.name || '', 60),
      suggestedName: slateName(card?.name || found.serverInfo?.title || found.serverInfo?.name || host.split('.').slice(-2, -1)[0] || 'Agent', sanitizeName) || 'Agent',
      tools: tools.map(({ name, title, description, group, hash, annotations }) => ({ name, title, description, group, hash, annotations, policy: defaultPolicy({ group }) })),
      summary: capabilitySummary(tools),
    }
  }

  async function connect(principal, input) {
    return oneAtATime(principal, () => connectNow(principal, input))
  }

  // What the person consented to: each tool the server lists now, with the hash they saw. An
  // outside change is never switched on; at least one lookup must be allowed.
  function consented(name, tools, chosen) {
    const seen = new Map((Array.isArray(chosen) ? chosen : []).map((entry) => [entry?.name, entry]))
    const stored = tools.map((tool) => {
      const choice = seen.get(tool.name)
      if (choice && choice.hash !== tool.hash) refuse(409, 'tools_changed', `${name}'s tools changed while you were choosing. Look at them again.`)
      const policy = choice && POLICIES.includes(choice.policy) && tool.group === 'lookup' ? choice.policy : choice ? 'off' : defaultPolicy(tool)
      return { name: tool.name, title: tool.title, description: tool.description, group: tool.group, hash: tool.hash, policy }
    })
    if (!stored.some((tool) => tool.policy === 'allow')) refuse(400, 'no_tools', 'Allow at least one thing it may look up.')
    return stored
  }

  // The person's integration for this address: made (or brought up to date) whenever they consent,
  // from a slate or from the Integrations page. One per person and address.
  async function ensureIntegration(userId, { address, host, name, tools, auth, galleryId, serverName = '' }) {
    const existing = await integrations.findOne({ ownerId: userId, address })
    const at = new Date(now())
    if (existing) {
      const set = { tools, auth, status: 'active', changed: null, updatedAt: at, ...(auth && { scopes: (await vault?.describe?.(userId, address))?.scopes || existing.scopes || [] }) }
      await integrations.update(existing._id, set)
      return Object.assign(existing, set)
    }
    if ((await integrations.find({ ownerId: userId })).length >= AGENT_LIMITS.integrationsPerOwner)
      refuse(429, 'integration_limit', `You can connect ${AGENT_LIMITS.integrationsPerOwner} integrations. Disconnect one first.`)
    const doc = {
      _id: newId('i'),
      ownerType: 'user',
      ownerId: userId,
      kind: 'mcp',
      address,
      host,
      galleryId: galleryId || null,
      name,
      serverName,
      tools,
      auth,
      scopes: auth ? (await vault?.describe?.(userId, address))?.scopes || [] : [],
      defaultContextLevel: 'request',
      rule: 'ask',
      colorIndex: 1 + (randomBytes(1)[0] % 5),
      status: 'active',
      createdAt: at,
      updatedAt: at,
      lastUsedAt: null,
    }
    await integrations.insert(doc)
    audit({ kind: 'integration_connect', userId, host, integrationId: doc._id })
    return doc
  }

  async function connectNow(principal, { shareId, address: raw, name: rawName, tools: chosen = [], contextLevel = 'request', view = null }) {
    const slate = await requireEditor(principal, shareId)
    await requirePro(principal.userId)
    await checkOutsideAgents(principal, slate)
    const { address, host } = checkAddress(raw)
    if (!CONTEXT_LEVELS.includes(contextLevel)) refuse(400, 'invalid_request', 'Choose what the agent may see.')
    const name = slateName(rawName, sanitizeName)
    if (!name) refuse(400, 'bad_name', 'Choose another name. Names can\'t say Slatebox, admin, support or a person\'s name.')
    const live = await connections.find({ slateId: slate._id, status: { $ne: 'removed' } })
    // One copy of a server per person on a slate: theirs is already here (another person may bring their own).
    const already = live.find((doc) => doc.ownerId === principal.userId && canonicalAddress(doc.address) === address)
    // Paused (its tools changed) or with nothing left it may use: inviting again is consenting again,
    // to that same agent (its name, colour, suggestions and activity stay); anything else is refused.
    if (already && already.status !== 'paused' && !(await nothingLeft(principal, already)))
      refuse(409, 'already_here', `${already.name} is already on this slate.`, { connectionId: already._id, agentId: already.agentId || null, name: already.name })
    if (already) return consentAgain(principal, already, { address, chosen, contextLevel })
    if (live.length >= AGENT_LIMITS.perSlate) refuse(429, 'agent_limit', `A slate can have ${AGENT_LIMITS.perSlate} invited agents. Remove one first.`)
    if (live.filter((doc) => doc.ownerId === principal.userId).length >= AGENT_LIMITS.perOwnerPerSlate)
      refuse(429, 'agent_limit', `You can invite ${AGENT_LIMITS.perOwnerPerSlate} agents onto one slate. Remove one first.`)
    // One agent per name on a slate, so "@name" in Ask Slatebox always means one agent.
    if (live.some((doc) => sameAgentName(doc.name, name)))
      refuse(409, 'name_taken', `An agent on this slate is already called ${name}. Choose another name.`)
    // Consent is to what the server says now: the hashes the person saw must still be the server's.
    const reached = await discoverAs(principal.userId, address)
    if (reached.needsSignIn) refuse(401, 'needs_sign_in', `Sign in to ${host} first.`)
    const { found } = reached
    const auth = reached.token ? await vault.describe(principal.userId, address) : null
    const stored = consented(name, normalizeTools(found.tools), chosen)
    const galleryId = cardFor(address, await gallery())?.id || null
    // Connect once: the consent is kept as the person's integration, so any other slate can have it without asking again.
    const integration = await ensureIntegration(principal.userId, { address, host, name, tools: stored, auth: auth ? { kind: auth.kind, issuer: auth.issuer } : null, galleryId, serverName: plainText(found.serverInfo?.name || '', 60) })
    const doc = {
      _id: newId('c'),
      ownerId: principal.userId,
      inviterName: await firstName(principal.userId),
      slateId: slate._id,
      shareId: slate.shareId,
      name,
      address,
      host,
      galleryId,
      serverName: plainText(found.serverInfo?.name || '', 60),
      tools: stored,
      contextLevel,
      mode: 'suggest',
      // The inviter's own sign-in to this server (the vault holds it; the connection never does).
      auth: auth ? { kind: auth.kind, issuer: auth.issuer } : null,
      // One agent colour on its cursor, chip and ghosts (0 is the Slatebox agent's): its integration's, on every slate.
      colorIndex: integration.colorIndex ?? 1 + (randomBytes(1)[0] % 5),
      integrationId: integration._id,
      joinedBy: 'invite',
      agentId: null,
      status: 'active',
      createdAt: new Date(now()),
      updatedAt: new Date(now()),
    }
    // Its id on this slate, the one its suggestions are filed under (the same across its runs).
    const hello = connectorPrincipal(doc, 'hello:' + doc._id)
    doc.agentId = await suggestions.agentIdOf(hello, slate)
    await connections.insert(doc)
    audit({ kind: 'connect', userId: principal.userId, host, connectionId: doc._id })
    // It arrives: its cursor says hello once, to everyone on the slate, where the inviter is looking,
    // then goes after its normal time (and at once when its first run starts: one pointer per agent).
    const looking = viewOf(view)
    const point = looking ? { x: Math.round(looking.x + looking.width / 2), y: Math.round(looking.y + looking.height / 2) } : null
    await presence.saved(hello, slate, { targets: [], message: `Hi, I'm ${name}. Select notes and ask me.`, ...(point && { point }) }).catch(() => {})
    later(() => presence.end(hello.runId, 'done').catch(() => {}), AGENT_LIMITS.helloMs)
    return publicConnection(doc, principal.userId)
  }

  // Whether none of the tools an agent was allowed is offered by its server now.
  async function nothingLeft(principal, doc) {
    try {
      const reached = await discoverAs(principal.userId, doc.address)
      if (reached.needsSignIn) return false
      return !reconcile(doc.tools, normalizeTools(reached.found.tools)).allowed.length
    } catch {
      return false
    }
  }

  // Inviting a paused agent again: the person consents to what the server says now (hashes they saw).
  async function consentAgain(principal, doc, { address, chosen, contextLevel }) {
    const reached = await discoverAs(principal.userId, address)
    if (reached.needsSignIn) refuse(401, 'needs_sign_in', `Sign in to ${doc.host} first.`)
    const stored = consented(doc.name, normalizeTools(reached.found.tools), chosen)
    const auth = reached.token ? await vault.describe(principal.userId, address) : null
    // The consent is the integration's: every slate it is on resumes with it.
    const integration = await ensureIntegration(principal.userId, { address, host: doc.host, name: doc.name, tools: stored, auth: auth ? { kind: auth.kind, issuer: auth.issuer } : null, galleryId: doc.galleryId })
    await resumeEverywhere(integration, stored)
    const set = { tools: stored, contextLevel, status: 'active', changed: null, integrationId: integration._id, updatedAt: new Date(now()) }
    await connections.update(doc._id, set)
    Object.assign(doc, set)
    audit({ kind: 'reconsent', userId: principal.userId, host: doc.host, connectionId: doc._id })
    return publicConnection(doc, principal.userId)
  }

  // An integration's agents on every slate, live (its own, and ones made before integrations existed).
  async function agentsOf(integration) {
    const linked = await connections.find({ integrationId: integration._id, status: { $ne: 'removed' } })
    const loose = (await connections.find({ ownerId: integration.ownerId, status: { $ne: 'removed' } }))
      .filter((doc) => !doc.integrationId && canonicalAddress(doc.address) === integration.address)
    return [...linked, ...loose]
  }

  // A definition that moved since consent pauses the integration and its agents on every slate at once.
  async function pauseEverywhere(doc, changes) {
    const at = new Date(now())
    await connections.update(doc._id, { status: 'paused', changed: changes, updatedAt: at })
    const integration = doc.integrationId ? await integrations.findOne({ _id: doc.integrationId }) : await integrations.findOne({ ownerId: doc.ownerId, address: canonicalAddress(doc.address) })
    if (!integration) return
    await integrations.update(integration._id, { status: 'paused', changed: changes, updatedAt: at })
    for (const other of await agentsOf(integration)) if (other._id !== doc._id && other.status !== 'paused') await connections.update(other._id, { status: 'paused', changed: changes, updatedAt: at })
  }

  // One consent again resumes every slate the integration is on, with the tools just consented to.
  async function resumeEverywhere(integration, tools) {
    const at = new Date(now())
    for (const other of await agentsOf(integration)) {
      const set = { tools, changed: null, integrationId: integration._id, updatedAt: at, ...((other.status === 'paused' || other.status === 'needs_sign_in') && { status: 'active' }) }
      await connections.update(other._id, set)
    }
  }

  async function list(principal, { shareId }) {
    const { slate } = await requireReader(principal, shareId)
    const docs = await connections.find({ slateId: slate._id, status: { $ne: 'removed' } })
    const isPro = principal.userId ? await pro(principal.userId) : false
    // The viewer's own agents follow their Pro: "Pro ended" while it is off, back when it returns.
    for (const doc of docs) {
      if (doc.ownerId !== principal.userId) continue
      if (!isPro && doc.status === 'active') await setStatus(doc, 'pro_ended')
      else if (isPro && doc.status === 'pro_ended') await setStatus(doc, 'active')
    }
    const cards = await gallery()
    // canInvite: this person may invite agents here (Pro, or a Business seat; always on a licensed install).
    return { connections: docs.map((doc) => publicConnection(doc, principal.userId, cards)), pro: isPro, canInvite: isPro }
  }

  /** The gallery the invite dialog shows: the enabled cards in order, and whether this person may invite. */
  async function galleryList(principal) {
    const cards = await gallery()
    const canInvite = principal?.userId && principal.kind !== 'guest' && principal.kind !== 'visitor' ? await pro(principal.userId) : false
    return {
      cards: cards.map(({ id, name, url, job, lands, try: tryThis, featured, signIn, keyHint, cost }) => ({ id, name, url, job, lands, try: tryThis, featured: Boolean(featured), signIn: signIn || null, keyHint: keyHint || null, cost: cost || '' })),
      canInvite,
    }
  }

  async function setStatus(doc, status) {
    if (doc.status === status) return
    doc.status = status
    await connections.update(doc._id, { status, updatedAt: new Date(now()) })
  }

  async function ownConnection(principal, connectionId) {
    const doc = typeof connectionId === 'string' ? await connections.findOne({ _id: connectionId }) : null
    if (!doc || doc.status === 'removed') refuse(404, 'not_found', 'That agent is not on this slate any more.')
    // DECISION 1: only the person who invited an agent can call it, change it or remove it.
    if (doc.ownerId !== principal.userId) refuse(403, 'inviter_only', `Only ${doc.inviterName || 'the person who invited it'} can ask ${doc.name}.`)
    return doc
  }

  // The inviter removes their agent; so may the slate's owner (it is their slate), with its waiting suggestions.
  async function removableConnection(principal, connectionId) {
    const doc = typeof connectionId === 'string' ? await connections.findOne({ _id: connectionId }) : null
    if (!doc || doc.status === 'removed') refuse(404, 'not_found', 'That agent is not on this slate any more.')
    if (doc.ownerId === principal.userId) return doc
    const found = principal?.userId ? await accessOf(principal, doc.shareId).catch(() => null) : null
    if (found?.slate?.userId && found.slate.userId === principal.userId) return doc
    refuse(403, 'inviter_only', `Only ${doc.inviterName || 'the person who invited it'} or the slate's owner can remove ${doc.name}.`)
  }

  async function disconnect(principal, { connectionId }) {
    const doc = await removableConnection(principal, connectionId)
    // Remembered: a standing rule never brings it back onto this slate.
    await connections.update(doc._id, { status: 'removed', removedBy: doc.ownerId === principal.userId ? 'person' : 'slate_owner', updatedAt: new Date(now()) })
    // Its suggestions still waiting go with it (discarded by the inviter; kept work stays, undoable).
    const found = await access.forUser(doc.shareId, principal.userId).catch(() => null)
    if (found?.slate) {
      const agentId = doc.agentId || (await suggestions.agentIdOf(connectorPrincipal(doc, 'remove:' + doc._id), found.slate))
      await suggestions.withdraw(principal, found.slate, agentId).catch(() => {})
    }
    await presence.end('hello:' + doc._id, 'done').catch(() => {})
    // Its integration and sign-in stay: the person connected it once and may invite it anywhere.
    // Disconnecting the integration (Integrations page) is what revokes the sign-in.
    audit({ kind: 'disconnect', userId: principal.userId, host: doc.host, connectionId: doc._id, ...(doc.ownerId !== principal.userId && { byOwner: true }) })
    return { ok: true, connectionId: doc._id }
  }

  // The asker's visible part of the canvas (slate units), when the page sent it: suggestions land there.
  function viewOf(view) {
    if (!view || typeof view !== 'object') return null
    const v = { x: Number(view.x), y: Number(view.y), width: Number(view.width), height: Number(view.height) }
    if (![v.x, v.y, v.width, v.height].every(Number.isFinite) || v.width < 40 || v.height < 40 || v.width > 1e6 || v.height > 1e6 || Math.abs(v.x) > 1e7 || Math.abs(v.y) > 1e7) return null
    return v
  }

  // The deterministic layout when the model gives nothing usable: the text, line by line, and the sources.
  function plainLayout(entries) {
    const lines = []
    for (const entry of entries)
      for (const line of entry.result.text.split(/\n+/)) {
        const text = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()
        if (text) lines.push(text)
      }
    const notes = lines.slice(0, 8).map((text, index) => ({ key: 't' + index, text: plainText(text, PLAN_LIMITS.noteChars) }))
    const links = entries.flatMap((entry) => entry.result.links).slice(0, 4)
    links.forEach((link, index) => notes.push({ key: 'l' + index, text: link.title || link.host, link: link.url }))
    return notes.length ? [{ label: 'What it found', layout: 'grid', notes, lines: [] }] : []
  }

  async function call(principal, input) {
    return oneAtATime(principal, () => callNow(principal, input))
  }

  // One call to the outside server, as the inviter, with the tool's arguments fitted to its schema.
  async function reach(doc, { tool, args, check, token, toolOf, principal, entries, extra = {} }) {
    let raw
    try {
      // ownerId and slateId: a native agent (Google Drive) reads only what its owner picked for this slate.
      raw = await session.callTool(doc.address, fetch, { name: tool, args, check }, { token, ownerId: doc.ownerId, slateId: doc.slateId })
    } catch (error) {
      if (error?.code === 'tools_changed') {
        await pauseEverywhere(doc, error.changes)
        throw error
      }
      const problem = fromProblem(error)
      if (problem?.code === 'needs_sign_in') {
        await setStatus(doc, 'needs_sign_in')
        refuse(401, 'needs_sign_in', `${doc.name} needs you to sign in to ${doc.host} again.`)
      }
      throw problem
    }
    const clean = quarantine(raw, { outputSchema: toolOf.get(tool)?.outputSchema })
    audit({ kind: 'call', userId: principal.userId, host: doc.host, tool, ok: !clean.isError, chars: clean.text.length })
    const entry = { tool, args, result: clean, ...extra }
    entries.push(entry)
    return { raw, entry }
  }

  // The person's last few turns with this agent (inert data in the prompts): their own words, and
  // what landed said by this code from counts ("added 2 notes"). The agent's earlier replies are
  // never sent back: they were written by a model that read an outside server's answers, and the
  // planner must never see what a server said.
  const cleanHistory = (history) => (Array.isArray(history) ? history : []).slice(-3)
    .filter((turn) => turn && typeof turn.message === 'string')
    .map((turn) => ({ message: plainText(turn.message, 300), reply: addedWords(turn.added) }))
  const addedWords = (added) => {
    const notes = Math.max(0, Math.min(99, Number(added?.notes) || 0))
    const lines = Math.max(0, Math.min(99, Number(added?.lines) || 0))
    const what = [notes && `${notes} ${notes === 1 ? 'note' : 'notes'}`, lines && `${lines} ${lines === 1 ? 'line' : 'lines'}`].filter(Boolean).join(' and ')
    return what ? `added ${what}` : ''
  }

  // The same ask while its answer still waits on the slate (two tabs, Send pressed twice, a retry
  // after the answer landed): the answer that waits is the answer, nothing new is made.
  async function waitingAnswer(doc, slate, message) {
    const waiting = (await suggestions.waiting?.(slate).catch(() => [])) || []
    return waiting.find((action) => action.agentId === doc.agentId && action.message === message) || null
  }

  async function callNow(principal, { connectionId, request, selection = [], view = null, history = [] }) {
    const doc = await ownConnection(principal, connectionId)
    const slate = await requireEditor(principal, doc.shareId)
    if (!(await pro(principal.userId))) {
      await setStatus(doc, 'pro_ended')
      refuse(402, 'pro_required', PRO_REQUIRED)
    }
    // Paused: refused before anything reaches the outside server or the model. The asker can edit
    // the slate, so they may resume agents themselves.
    if (await suggestions.paused?.(slate)) refuse(423, 'agents_paused', `Agents are paused on this slate. Resume agents to ask ${doc.name}.`)
    if (doc.status === 'paused') refuse(409, 'tools_changed', `${doc.name}'s tools changed since you invited it. Invite it again from + Invite agent to look at them.`, { changed: (doc.changed || []).map((c) => c.name) })
    const text = plainText(request, AGENT_LIMITS.requestChars)
    if (!text) refuse(400, 'invalid_request', `Ask ${doc.name} something.`)
    const ids = Array.isArray(selection) ? selection.filter((id) => typeof id === 'string').slice(0, 60) : []
    const said = cleanHistory(history)
    const message = `${plainText(doc.name, 40)}: ${plainText(text, 120)}`
    const same = await waitingAnswer(doc, slate, message)
    if (same) return { items: 0, actions: [same.actionId], saved: 0, repeated: true, say: `That answer is still on the slate, waiting: Keep all or Discard all on its frame, then ask again for a new one.`, left: [], added: { notes: 0, lines: 0 } }
    const card = cardFor(doc.address, await gallery())
    const recipe = checkRecipe(card?.recipe)
    const budget = requestBudget(text)
    const runId = newId('r')
    const agent = connectorPrincipal(doc, runId)
    let outcome = 'stopped'
    // Its greeting pointer goes: the run's pointer is the agent's one pointer from here on.
    await presence.end('hello:' + doc._id, 'done').catch(() => {})
    try {
      await presence.plan(agent, slate, [`Ask ${doc.name}`, 'Read what it found', 'Place suggestions']).catch(() => {})
      const packed = packContext({ slate, level: doc.contextLevel, selection: ids, request: text, viewerId: principal.userId })
      const result = await metered(async () => {
        // The tools it may call now; a definition that moved since consent pauses the agent.
        let listedTools = null
        const check = (listed) => {
          listedTools = normalizeTools(listed)
          const { changed } = reconcile(doc.tools, listedTools)
          if (changed.length) {
            // The error names the tools only: their new descriptions are the server's words, kept for the inviter's screen.
            const error = new ConnectorRefused(409, 'tools_changed', `${doc.name}'s tools changed since you invited it. Invite it again from + Invite agent to look at them.`, { changed: changed.map((c) => c.name) })
            error.changes = changed
            throw error
          }
        }
        let found
        let token = null
        try {
          const reached = await discoverAs(principal.userId, doc.address)
          if (reached.needsSignIn) {
            await setStatus(doc, 'needs_sign_in')
            refuse(401, 'needs_sign_in', `${doc.name} needs you to sign in to ${doc.host} again.`)
          }
          ;({ found, token } = reached)
          check(found.tools)
        } catch (error) {
          if (error?.code === 'tools_changed') {
            await pauseEverywhere(doc, error.changes)
            throw error
          }
          throw fromSignIn(error)
        }
        if (doc.status !== 'active') await setStatus(doc, 'active')
        const { allowed } = reconcile(doc.tools, listedTools)
        if (!allowed.length) refuse(409, 'no_tools', `${doc.name} has nothing it may look up now. Invite it again from + Invite agent to choose what it may use.`)
        const toolOf = new Map(allowed.map((tool) => [tool.name, tool]))
        // Read-me tools only explain the others: never offered, never laid out.
        const offered = allowed.filter((tool) => !isReferenceTool(tool, recipe))
        if (!offered.length) refuse(409, 'no_tools', `${doc.name} has nothing it may look up now. Invite it again from + Invite agent to choose what it may use.`)
        const offeredNames = new Set(offered.map((tool) => tool.name))
        const entries = []
        let say = ''
        let recipeGroups = null
        let answered = false // a recipe's output rule already gave the answer (notes, or "nothing found")
        let finalStep = null // the entries of the step whose answer becomes notes
        const limits = planLimits(recipe, PLAN_LIMITS.calls)
        const hint = recipeHint({ galleryId: card?.id, serverName: doc.name, text: promptOf })
        // The planner for one turn: these tools, at most `limit` calls, each tool once per ask.
        const plan = async (tools, limit, used) => {
          const { system, user } = planPrompt({ serverName: doc.name, tools, packed, previous: entries, text: promptOf, calls: limit, history: said, hint })
          return checkPlan(await model({ feature: 'connectors', tool: planTool(promptOf), system, user, userId: principal.userId, shareId: slate.shareId }), tools, { limit, used })
        }
        const intent = recipe && matchIntent(recipe, text, requestValues(text))
        // A merge step (one more source for a list) may be missing or fail without stopping the recipe.
        const runnable = intent && intent.steps.every((step) => step.merge || stepTool(step, offeredNames))
        if (runnable) {
          // A known ask: this code runs the steps; values pass from one step to the next by typed
          // extraction only (logins, owner/repo names), never the server's words.
          const values = { ...requestValues(text), request: text }
          let calls = 0
          let stopped = false
          for (const step of intent.steps) {
            const tool = stepTool(step, offeredNames)
            if (!tool) continue
            const schema = toolOf.get(tool)?.inputSchema
            let planned = []
            if (step.args === 'plan') {
              const picked = await plan([toolOf.get(tool)], 1, new Set())
              say = say || picked.say
              planned = picked.calls.map((call) => ({ tool, args: call.args, run: values }))
            } else planned = stepCalls({ ...step, tool }, values).map((call) => ({ ...call, args: fitArgs(schema, call.args) }))
            planned = planned.filter((call) => !checkArguments(schema, call.args))
            if (!planned.length) {
              if (step.merge) continue
              stopped = true
              break
            }
            const stepEntries = []
            for (const call of planned) {
              if (calls >= RECIPE_LIMITS.runCalls) break
              calls++
              const { raw, entry } = await reach(doc, { tool, args: call.args, check, token, toolOf, principal, entries, extra: { run: call.run } })
              entry.data = rawData(raw)
              stepEntries.push(entry)
              if (step.extract && !entry.result.isError) {
                for (const [name, list] of Object.entries(extract(entry.data, step.extract, rawText(raw)))) {
                  if (!list.length) continue
                  values[name] = step.each ? [...new Set([...(values[name] || []), ...list])] : step.merge ? interleave(values[name], list) : (values[name] === undefined ? list : values[name])
                }
              }
            }
            if (step.merge) continue
            finalStep = stepEntries
            if (stepEntries.every((entry) => entry.result.isError)) {
              stopped = true
              break
            }
          }
          if (!stopped && intent.output && finalStep) {
            answered = true
            const notes = outputNotes(finalStep.filter((entry) => !entry.result.isError), { ...intent.output, maxNotes: Math.min(intent.output.maxNotes || 5, budget.notes || Infinity) })
            if (notes.length) recipeGroups = [{ label: intent.output.label || intent.label || doc.name, layout: 'column', notes, lines: [] }]
            else say = `${doc.name} found nothing for that.`
          }
          if (stopped && !entries.some((entry) => !entry.result.isError)) say = say || `${doc.name} couldn't find what that needs.${intent.missing ? ' ' + intent.missing : ' Try asking in other words.'}`
        } else {
          // Anything else: the planner, within the limits (one round of two calls unless its recipe says more).
          const used = new Set()
          for (let round = 0; round < limits.rounds; round++) {
            const planned = await plan(offered, limits.calls, used)
            say = say || planned.say
            if (!planned.calls.length) break
            const roundEntries = []
            for (const { tool, args } of planned.calls) {
              used.add(tool)
              const { entry } = await reach(doc, { tool, args, check, token, toolOf, principal, entries })
              roundEntries.push(entry)
            }
            finalStep = roundEntries
            if (planned.done) break
          }
        }
        if (!entries.length) return { groups: [], say: say || `${doc.name} had nothing to look up for that.`, entries }
        await presence.step(agent, slate, 1, 'doing').catch(() => {})
        // One output per ask: the recipe's notes, else a drawing by the Excalidraw recipe, else the
        // translator over the last step's answers (never a read-me tool's text).
        let groups = recipeGroups || []
        const left = []
        if (!groups.length && !answered) {
          for (const entry of finalStep || entries) {
            const elements = excalidrawElements(entry)
            const group = elements && excalidrawGroup(elements, 'Diagram')
            if (group) {
              groups = [group]
              if (group.left) left.push(group.left)
              break
            }
          }
        }
        if (!groups.length && !answered) {
          const rest = (finalStep || entries).filter((entry) => !entry.result.isError)
          if (rest.length && (rest.some((e) => e.result.text) || rest.some((e) => e.result.links.length))) {
            const { system, user } = translatePrompt({ serverName: doc.name, packed, entries: rest, text: promptOf, history: said, budget })
            let layout = { groups: [], say: '' }
            try {
              layout = checkLayout(await model({ feature: 'connectors', tool: layoutTool(promptOf), system, user, userId: principal.userId, shareId: slate.shareId }), { aliases: packed.aliases, allowedLinks: linksIn(rest) })
            } catch (error) {
              if (error instanceof ConnectorRefused) throw error
            }
            groups = layout.groups.length ? layout.groups : plainLayout(rest)
            say = layout.say || say
          }
        }
        // Exactly what was asked: the same words once, then no more notes or lines than the request named.
        const trimmed = trimToBudget(dedupeGroups(groups), budget)
        const cut = cutWords(trimmed.cut, budget)
        if (cut) left.push(cut)
        const errors = entries.filter((entry) => entry.result.isError)
        if (!trimmed.groups.length && errors.length) say = say || `${doc.name} couldn't find results for that.`
        return { groups: trimmed.groups, say, entries, left }
      }, { userId: principal.userId, shareId: slate.shareId })
      const left = [...new Set([...result.entries.flatMap((entry) => entry.result.left), ...(result.left || [])])]
      await presence.step(agent, slate, 2, 'doing').catch(() => {})
      // The whole answer is saved ONCE as the agent: the app files it as one live suggestion (one
      // frame of ghosts on every screen, the cursor moving to them, Keep all / Discard all, one
      // Undo), or saves it at once when a person lets this agent edit directly.
      // Earlier answers still waiting take their space too, so this one never lands on their ghosts.
      const busy = ((await suggestions.waiting?.(slate).catch(() => [])) || []).flatMap((action) => action.boxes || [])
      const items = itemsFromLayout({ groups: result.groups, slate, aliases: packed.aliases, selection: ids, serverName: doc.name, view: viewOf(view), message, busy })
      const actions = []
      let saved = 0
      let dropped = 0
      // A person editing meanwhile moves the revision, so a refused save is tried once more against
      // the fresh slate before it is counted as not placed.
      const place = async (item) => {
        const current = await access.reload(slate.shareId)
        return applyOperations(agent, { shareId: slate.shareId, plan: item.plan, expectedRevision: current?.revision ?? slate.revision ?? 0 }, 'save')
      }
      for (const item of items) {
        let answer = null
        // Tried again only when the slate moved on before the save (slate_changed): any other failure
        // may have saved already, and a second try would land the answer twice.
        for (let attempt = 0; attempt < 2 && !answer; attempt++) {
          try {
            answer = await place(item)
          } catch (error) {
            // People on the slate paused its agents: stop, and say so in their words.
            if (error?.code === 'agents_paused') refuse(423, 'agents_paused', `Agents are paused on this slate. Resume agents to ask ${doc.name}.`)
            answer = null
            if (error?.code !== 'slate_changed') break
          }
        }
        if (answer?.body?.suggestion?.actionId) actions.push(answer.body.suggestion.actionId)
        else if (answer?.body?.outcome === 'saved') saved++
        else dropped++
      }
      if (dropped) left.push('The suggestion could not be placed: the slate changed while it was being made. Ask again to try it.')
      const notes = result.groups.reduce((sum, group) => sum + group.notes.length, 0)
      const lines = result.groups.reduce((sum, group) => sum + (group.lines || []).length, 0)
      outcome = 'done'
      if (doc.integrationId) await integrations.update(doc.integrationId, { lastUsedAt: new Date(now()) })
      return { items: actions.length + saved, actions, saved, say: plainText(result.say, 240), left, added: dropped ? { notes: 0, lines: 0 } : { notes, lines } }
    } catch (error) {
      throw fromProblem(error)
    } finally {
      await presence.end(runId, outcome).catch(() => {})
    }
  }

  // ---------- signing in ----------

  /** A popup sign-in for this person and server. → { flowId, authHost } (the signed-in page claims it at the start route) */
  async function startSignIn(principal, input) {
    return oneAtATime(principal, () => startSignInNow(principal, input))
  }

  async function startSignInNow(principal, { shareId, address: raw, clientId = null }) {
    const slate = await requirePerson(principal, shareId)
    await requirePro(principal.userId, slate ? PRO_REQUIRED : INTEGRATIONS_PRO)
    const { address, host } = checkAddress(raw)
    if (!vault?.available?.() || !signIn || !probe) refuse(422, 'vault_off', 'Agents that need sign-in are not available on this server.')
    let challenge = null
    try {
      challenge = (await probe(address, fetch)).challenge || null
    } catch (error) {
      throw fromProblem(error)
    }
    let started
    try {
      started = await signIn.start({ userId: principal.userId, address, challenge, clientId })
    } catch (error) {
      throw fromSignIn(error)
    }
    audit({ kind: 'sign_in_start', userId: principal.userId, host })
    return started
  }

  /** Whether a popup sign-in finished (only the person who started it may ask). */
  async function signInStatus(principal, { flowId }) {
    if (!principal?.userId) refuse(401, 'sign_in', 'Save your account to invite agents.')
    return signIn ? signIn.status({ userId: principal.userId, flowId }) : { status: 'unknown', message: 'Start the sign-in again.' }
  }

  /** A pasted key or token, for servers that take one: checked against the server, then sealed. */
  async function useKey(principal, input) {
    return oneAtATime(principal, () => useKeyNow(principal, input))
  }

  async function useKeyNow(principal, { shareId, address: raw, key }) {
    const slate = await requirePerson(principal, shareId)
    await requirePro(principal.userId, slate ? PRO_REQUIRED : INTEGRATIONS_PRO)
    const { address, host } = checkAddress(raw)
    if (!vault?.available?.()) refuse(422, 'vault_off', 'Agents that need sign-in are not available on this server.')
    const value = typeof key === 'string' ? key.trim().replace(/^Bearer\s+/i, '') : ''
    if (!KEY_PATTERN.test(value)) refuse(400, 'bad_key', 'That doesn\'t look like a key or token. Paste it again.')
    try {
      await session.discover(address, fetch, { token: value })
    } catch (error) {
      const problem = fromProblem(error)
      if (['needs_sign_in', 'needs_more_access'].includes(problem?.code)) refuse(422, 'key_refused', `That key didn't work for ${host}.`)
      throw problem
    }
    await vault.save({ userId: principal.userId, address, resource: address, issuer: 'key', kind: 'key', tokens: { accessToken: value } })
    audit({ kind: 'sign_in_key', userId: principal.userId, host })
    return { ok: true, host }
  }

  /**
   * Housekeeping (hourly): a sign-in lives as long as its integration. Forgotten (and revoked): a
   * sign-in with no integration after a day (someone signed in and never connected), and one whose
   * integration's owner lost Pro 30 days ago (the integration then needs sign-in again).
   * credentialRows() -> [{ ownerId, address, createdAt }]
   */
  async function sweep(credentialRows) {
    let removed = 0
    for (const row of await credentialRows()) {
      const integration = await integrations.findOne({ ownerId: row.ownerId, address: row.address })
      const orphan = !integration && now() - new Date(row.createdAt).getTime() > AGENT_LIMITS.orphanHours * 3600000
      const lapsed = Boolean(integration) && integration.status === 'pro_ended' && now() - new Date(integration.proEndedAt || integration.updatedAt).getTime() > AGENT_LIMITS.proEndedDays * 86400000
      if (!orphan && !lapsed) continue
      await vault.remove(row.ownerId, row.address).catch(() => {})
      if (lapsed) await integrations.update(integration._id, { status: 'needs_sign_in', auth: null, scopes: [], updatedAt: new Date(now()) })
      removed++
    }
    return { removed }
  }

  // ---------- integrations: connect once, invite anywhere ----------

  async function ownIntegration(principal, integrationId) {
    const doc = typeof integrationId === 'string' ? await integrations.findOne({ _id: integrationId }) : null
    // Someone else's integration is "not found": its existence is not theirs to learn.
    if (!doc || doc.ownerId !== principal?.userId) refuse(404, 'not_found', 'That integration is not connected any more.')
    return doc
  }

  // The integration follows its owner's Pro: "Pro ended" while it is off, back when it returns.
  async function followPro(doc, isPro) {
    if (!isPro && doc.status === 'active') {
      const at = new Date(now())
      doc.status = 'pro_ended'
      doc.proEndedAt = at
      await integrations.update(doc._id, { status: 'pro_ended', proEndedAt: at, updatedAt: at })
    } else if (isPro && doc.status === 'pro_ended') {
      doc.status = 'active'
      await integrations.update(doc._id, { status: 'active', proEndedAt: null, updatedAt: new Date(now()) })
    }
  }

  /** The Integrations page: each of this person's integrations, the slates it is on, and whether they may connect. */
  async function integrationsList(principal) {
    await requirePerson(principal)
    const isPro = await pro(principal.userId)
    const cards = await gallery()
    const rows = await integrations.find({ ownerId: principal.userId })
    const out = []
    for (const doc of rows) {
      await followPro(doc, isPro)
      const agents = await agentsOf(doc)
      const slates = await slateList([...new Set(agents.map((a) => a.slateId))], principal.userId).catch(() => [])
      out.push(publicIntegration(doc, { slates, cards, pro: isPro }))
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name)))
    return { integrations: out, pro: isPro, canConnect: isPro, rules: [...RULES] }
  }

  /**
   * Connect an MCP server once, from the Integrations page (no slate): after discovery (and its
   * sign-in), the person consents to its tools by their hashes. Connecting one already connected is
   * consenting again: every slate it is on resumes with that consent.
   */
  async function integrationConnect(principal, input) {
    return oneAtATime(principal, () => integrationConnectNow(principal, input))
  }

  async function integrationConnectNow(principal, { address: raw, name: rawName, tools: chosen = [], rule = null }) {
    await requirePerson(principal)
    await requirePro(principal.userId, INTEGRATIONS_PRO)
    const { address, host } = checkAddress(raw)
    const name = slateName(rawName, sanitizeName)
    if (!name) refuse(400, 'bad_name', 'Choose another name. Names can\'t say Slatebox, admin, support or a person\'s name.')
    if (rule !== null && !RULES.includes(rule)) refuse(400, 'invalid_request', 'Choose when it joins: when you invite it, or on every slate you own.')
    const reached = await discoverAs(principal.userId, address)
    if (reached.needsSignIn) refuse(401, 'needs_sign_in', `Sign in to ${host} first.`)
    const stored = consented(name, normalizeTools(reached.found.tools), chosen)
    const auth = reached.token ? await vault.describe(principal.userId, address) : null
    const existing = await integrations.findOne({ ownerId: principal.userId, address })
    const doc = await ensureIntegration(principal.userId, { address, host, name, tools: stored, auth: auth ? { kind: auth.kind, issuer: auth.issuer } : null, galleryId: cardFor(address, await gallery())?.id || null, serverName: plainText(reached.found.serverInfo?.name || '', 60) })
    const set = { ...(existing && { name }), ...(rule && { rule }) }
    if (Object.keys(set).length) {
      await integrations.update(doc._id, set)
      Object.assign(doc, set)
    }
    if (existing) await resumeEverywhere(doc, stored)
    audit({ kind: existing ? 'integration_reconsent' : 'integration_connected', userId: principal.userId, host, integrationId: doc._id })
    return publicIntegration(doc, { cards: await gallery() })
  }

  /** Review an integration's tools as its server lists them now: what changed since consent. */
  async function integrationReview(principal, { integrationId }) {
    return oneAtATime(principal, async () => {
      const doc = await ownIntegration(principal, integrationId)
      await requirePro(principal.userId, INTEGRATIONS_PRO)
      if (doc.kind !== 'mcp') refuse(400, 'invalid_request', `${doc.name} has fixed tools: there is nothing to review.`)
      const reached = await discoverAs(principal.userId, doc.address)
      if (reached.needsSignIn) {
        if (doc.status !== 'needs_sign_in') await integrations.update(doc._id, { status: 'needs_sign_in', updatedAt: new Date(now()) })
        return { integrationId: doc._id, address: doc.address, host: doc.host, needsSignIn: true, tools: [], changed: [] }
      }
      const listed = normalizeTools(reached.found.tools)
      const { changed } = reconcile(doc.tools, listed)
      const policyOf = new Map((doc.tools || []).map((tool) => [tool.name, tool]))
      return {
        integrationId: doc._id,
        address: doc.address,
        host: doc.host,
        name: doc.name,
        tools: listed.map(({ name, title, description, group, hash, annotations }) => {
          const before = policyOf.get(name)
          return { name, title, description, group, hash, annotations, policy: before && before.hash === hash ? before.policy : defaultPolicy({ group }), ...(!before && { added: true }), ...(before && before.hash !== hash && { changed: true }) }
        }),
        changed: changed.map((c) => c.name),
        summary: capabilitySummary(listed),
      }
    })
  }

  /** Its standing rule: 'ask' (you invite it) or 'my_slates' (it joins every slate you own). */
  async function integrationSetRule(principal, { integrationId, rule }) {
    const doc = await ownIntegration(principal, integrationId)
    await requirePro(principal.userId, INTEGRATIONS_PRO)
    if (!RULES.includes(rule)) refuse(400, 'invalid_request', 'Choose when it joins: when you invite it, or on every slate you own.')
    await integrations.update(doc._id, { rule, updatedAt: new Date(now()) })
    doc.rule = rule
    audit({ kind: 'integration_rule', userId: principal.userId, integrationId: doc._id, rule })
    return publicIntegration(doc, { cards: await gallery() })
  }

  /** Disconnect: removed from every slate (waiting suggestions discarded), the sign-in revoked and forgotten. */
  async function integrationDisconnect(principal, { integrationId }) {
    const doc = await ownIntegration(principal, integrationId)
    let removedFrom = 0
    for (const agent of await agentsOf(doc)) {
      await connections.update(agent._id, { status: 'removed', removedBy: 'disconnect', updatedAt: new Date(now()) })
      removedFrom++
      const found = await access.forUser(agent.shareId, principal.userId).catch(() => null)
      if (found?.slate) {
        const agentId = agent.agentId || (await suggestions.agentIdOf(connectorPrincipal(agent, 'remove:' + agent._id), found.slate))
        await suggestions.withdraw(principal, found.slate, agentId).catch(() => {})
      }
      await presence.end('hello:' + agent._id, 'done').catch(() => {})
    }
    const signedOut = vault ? (await vault.remove(doc.ownerId, doc.address).catch(() => ({ removed: false }))).removed : false
    await integrations.remove(doc._id)
    audit({ kind: 'integration_disconnect', userId: principal.userId, host: doc.host, integrationId: doc._id, removedFrom, signedOut })
    return { ok: true, integrationId: doc._id, removedFrom, signedOut }
  }

  // Puts an integration on a slate as a named agent: no sign-in and no consent again (the
  // integration's carry over). The slate's limits and its owner's choice still apply.
  async function placeOnSlate(principal, slate, integration, { by, contextLevel = null, name: rawName = null, view = null }) {
    if (integration.status === 'paused') refuse(409, 'tools_changed', `${integration.name}'s tools changed. Review them on the Integrations page first.`)
    if (integration.status === 'needs_sign_in') refuse(401, 'needs_sign_in', `${integration.name} needs you to sign in again on the Integrations page.`)
    const level = contextLevel || integration.defaultContextLevel || 'request'
    if (!CONTEXT_LEVELS.includes(level)) refuse(400, 'invalid_request', 'Choose what the agent may see.')
    const name = slateName(rawName || integration.name, sanitizeName)
    if (!name) refuse(400, 'bad_name', 'Choose another name. Names can\'t say Slatebox, admin, support or a person\'s name.')
    const live = await connections.find({ slateId: slate._id, status: { $ne: 'removed' } })
    const already = live.find((doc) => doc.ownerId === principal.userId && (doc.integrationId === integration._id || canonicalAddress(doc.address) === integration.address))
    if (already) refuse(409, 'already_here', `${already.name} is already on this slate.`, { connectionId: already._id, agentId: already.agentId || null, name: already.name })
    if (live.length >= AGENT_LIMITS.perSlate) refuse(429, 'agent_limit', `A slate can have ${AGENT_LIMITS.perSlate} invited agents. Remove one first.`)
    if (live.filter((doc) => doc.ownerId === principal.userId).length >= AGENT_LIMITS.perOwnerPerSlate)
      refuse(429, 'agent_limit', `You can invite ${AGENT_LIMITS.perOwnerPerSlate} agents onto one slate. Remove one first.`)
    if (live.some((doc) => sameAgentName(doc.name, name))) refuse(409, 'name_taken', `An agent on this slate is already called ${name}. Choose another name.`)
    const doc = {
      // A rule's copy has one id per slate and integration, so two pages applying rules at once make one.
      _id: by === 'rule' ? 'c' + createHash('sha256').update(`${slate._id}\n${integration._id}\nrule`).digest('hex').slice(0, 20) : newId('c'),
      ownerId: principal.userId,
      inviterName: await firstName(principal.userId),
      slateId: slate._id,
      shareId: slate.shareId,
      name,
      address: integration.address,
      host: integration.host,
      galleryId: integration.galleryId || null,
      serverName: integration.serverName || '',
      tools: integration.tools,
      contextLevel: level,
      mode: 'suggest',
      auth: integration.auth || null,
      colorIndex: integration.colorIndex ?? 1,
      integrationId: integration._id,
      joinedBy: by,
      agentId: null,
      status: 'active',
      createdAt: new Date(now()),
      updatedAt: new Date(now()),
    }
    const hello = connectorPrincipal(doc, 'hello:' + doc._id)
    doc.agentId = await suggestions.agentIdOf(hello, slate)
    try {
      await connections.insert(doc)
    } catch (error) {
      if (error?.code === 11000) refuse(409, 'already_here', `${name} is already on this slate.`)
      throw error
    }
    audit({ kind: by === 'rule' ? 'integration_rule_join' : 'integration_invite', userId: principal.userId, host: doc.host, connectionId: doc._id, integrationId: integration._id })
    if (by !== 'rule') {
      const looking = viewOf(view)
      const point = looking ? { x: Math.round(looking.x + looking.width / 2), y: Math.round(looking.y + looking.height / 2) } : null
      await presence.saved(hello, slate, { targets: [], message: `Hi, I'm ${name}. Select notes and ask me.`, ...(point && { point }) }).catch(() => {})
      later(() => presence.end(hello.runId, 'done').catch(() => {}), AGENT_LIMITS.helloMs)
    }
    return doc
  }

  /** Invite one of your integrations onto a slate: no sign-in, no consent again. */
  async function integrationInvite(principal, { shareId, integrationId, contextLevel = null, name = null, view = null }) {
    const slate = await requireEditor(principal, shareId)
    await requirePro(principal.userId)
    await checkOutsideAgents(principal, slate)
    const integration = await ownIntegration(principal, integrationId)
    await followPro(integration, true)
    const doc = await placeOnSlate(principal, slate, integration, { by: 'invite', contextLevel, name, view })
    return publicConnection(doc, principal.userId, await gallery())
  }

  /**
   * The standing rules for this slate, applied by its owner's page when it opens (idempotent; a
   * publication never writes). Rules only ever bring your own integrations onto slates you own;
   * an integration removed from this slate before stays away; limits skip with the reason.
   */
  async function applyRules(principal, { shareId }) {
    const none = { joined: [], skipped: [] }
    if (!principal?.userId || principal.kind === 'guest' || principal.kind === 'visitor') return none
    const found = await accessOf(principal, shareId)
    if (!found?.slate || !found.canRead) refuse(404, 'not_found', 'Slate not found or unavailable.')
    const slate = found.slate
    if (!found.canEdit || slate.userId !== principal.userId) return none
    const ruled = await integrations.find({ ownerId: principal.userId, rule: 'my_slates' })
    if (!ruled.length) return none
    const isPro = await pro(principal.userId)
    for (const row of ruled) await followPro(row, isPro)
    if (!isPro) return { ...none, pro: false }
    const rules = ruled.filter((row) => row.status === 'active')
    if ((await outsideAgentsOf(slate)) === 'off') return { joined: [], skipped: rules.map((row) => ({ integrationId: row._id, name: row.name, code: 'agents_off', why: 'Outside agents are turned off on this slate.' })) }
    const here = await connections.find({ slateId: slate._id })
    const joined = []
    const skipped = []
    for (const integration of rules) {
      // On this slate already, or removed from it before (remembered): nothing to do.
      if (here.some((doc) => doc.integrationId === integration._id)) continue
      if (here.some((doc) => doc.ownerId === principal.userId && doc.status !== 'removed' && canonicalAddress(doc.address) === integration.address)) continue
      try {
        const doc = await placeOnSlate(principal, slate, integration, { by: 'rule' })
        here.push(doc)
        joined.push({ integrationId: integration._id, connectionId: doc._id, agentId: doc.agentId, name: doc.name })
      } catch (error) {
        if (!(error instanceof ConnectorRefused)) throw error
        if (error.code === 'already_here') continue
        skipped.push({ integrationId: integration._id, name: integration.name, code: error.code, why: error.message })
      }
    }
    return { joined, skipped }
  }

  /** Who may bring outside agents onto this slate: its owner chooses (editors, only the owner, or no one). */
  async function slateSetting(principal, { shareId, outsideAgents }) {
    const found = await requireReader(principal, shareId)
    const owner = Boolean(principal.userId) && found.slate.userId === principal.userId
    if (outsideAgents !== undefined) {
      if (!owner) refuse(403, 'owner_only', 'Only this slate\'s owner can choose who brings outside agents here.')
      if (!OUTSIDE_AGENTS.includes(outsideAgents)) refuse(400, 'invalid_request', 'Choose editors, only you, or no one.')
      const row = await slateSettings.findOne({ _id: found.slate._id })
      if (row) await slateSettings.update(found.slate._id, { outsideAgents, updatedAt: new Date(now()) })
      else await slateSettings.insert({ _id: found.slate._id, outsideAgents, updatedAt: new Date(now()) })
      audit({ kind: 'slate_outside_agents', userId: principal.userId, slateId: found.slate._id, outsideAgents })
    }
    return { outsideAgents: await outsideAgentsOf(found.slate), canChange: owner }
  }

  return {
    startSignIn,
    signInStatus,
    useKey,
    sweep,
    discover,
    connect,
    list,
    disconnect,
    call,
    gallery: galleryList,
    integrationsList,
    integrationConnect,
    integrationReview,
    integrationSetRule,
    integrationDisconnect,
    integrationInvite,
    applyRules,
    slateSetting,
  }
}
