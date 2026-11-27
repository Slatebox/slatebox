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
//              When the person's own words ask for a change elsewhere ("file the retry bug"), the
//              change planner proposes it with the agent's allowed change tools; nothing is changed
//              during the ask: each change lands in the same answer as an action card (outside.mjs)
//              that its inviter approves by keeping it (or declines by discarding it), unless they
//              let the agent act without asking (never for a destructive change).
//   approve    an action card's change is made, as its inviter, after its tool is checked again
//              against the consented hash; the card then says it was done, with its link.
//   disconnect the inviter (or the slate's owner) removes the agent from one slate; its waiting
//              suggestions are discarded, its waiting cards declined. The integration and its
//              sign-in stay (connect once).
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
// Rules every entry point enforces (owner decisions 2026-11-23/24/26): enterprise code loaded
// (Slatebox Cloud, or any self-hosted install whose build carries it) and the kill switch off (the
// loader registers nothing otherwise). Integrations are free everywhere (owner, 2026-11-26): no plan
// is checked; the agent work they run is metered like any other (runAIAction); only the inviter can call the agent;
// everyone who can read the slate sees its cursor and ghosts; the person who keeps must be able
// to edit the slate.
import { createHash, randomBytes } from 'node:crypto'
import { sameAgentName } from '/imports/api/common/agent-mention.mjs'
import { secretInPath, secretInPathSentence } from '/imports/api/common/library-model.mjs'
import { canonicalAddress, cardFor, DEAD_HOSTS, GALLERY, lookalikeHost, retiredFor, writesAddress } from '../common/gallery.mjs'
import { checkMcpUrl, McpFetchRefused } from './mcp-fetch.mjs'
import { SignInNeeded } from './credentials.mjs'
import { SignInProblem } from './oauth.mjs'
import { KEY_PATTERN } from './signin.mjs'
import { asksForChange, capabilitySummary, defaultPolicy, destructiveArgs, normalizeTools, plainText, POLICIES, reconcile } from './tools.mjs'
import { quarantine } from './results.mjs'
import { actsWithoutAsking, APPROVERS, CARD_LIMITS, cardLabel, cardText, failureOf, fitsOnCard, isApiToken, linkOf, previewOf, publicCard } from './outside.mjs'
import { CONTEXT_LEVELS, packContext } from './context.mjs'
// The plan and layout words: the registry's (a version an administrator published, else the code's).
import { promptText } from '/server/ai-control/prompts/index.mjs'
import {
  checkArguments, checkLayout, checkPlan, checkWrites, excalidrawElements, fitArgs, itemsFromLayout, layoutTool, linksIn, PLAN_LIMITS, planPrompt, planTool, recipeHint, translatePrompt,
  writePlanPrompt,
} from './translate.mjs'
import { excalidrawGroup } from './excalidraw.mjs'
import {
  checkRecipe, cutWords, dedupeGroups, extract, interleave, isReferenceTool, LOOK_LIMITS, matchIntent, matchWrite, outputNotes, planLimits, rawData, rawText, RECIPE_LIMITS, requestBudget, requestValues,
  stepCalls, stepTool, trimToBudget,
} from './recipes.mjs'

export const AGENT_LIMITS = Object.freeze({ perSlate: 8, perOwnerPerSlate: 3, beatMs: 450, requestChars: 1000, nameChars: 32, orphanHours: 24, concurrentPerUser: 3, helloMs: 8000, integrationsPerOwner: 40 })

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
    // Moves a row out of one of these states at once (no await between the look and the change).
    claim: async (id, from, set) => {
      const row = rows.find((r) => r._id === id)
      if (!row || !from.includes(row.state)) return false
      Object.assign(row, set)
      return true
    },
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
// The meter's refusal (a Meteor.Error with its code and { pay }) as a refusal the registry passes on
// with its code, words and pay action (status 402), so Ask Slatebox can offer the pay sheet.
// Anything else is thrown as it is.
export function meterRefusal(error) {
  if (typeof error?.error === 'string' && error?.details?.pay) throw new ConnectorRefused(402, error.error, error.reason || error.message, { pay: error.details.pay })
  throw error
}

const refuse = (status, code, message, details) => {
  throw new ConnectorRefused(status, code, message, details)
}

/** What its owner sees of an integration on the Integrations page: never a token. */
export function publicIntegration(doc, { slates = [], cards = GALLERY } = {}) {
  return {
    integrationId: doc._id,
    kind: doc.kind || 'mcp',
    name: doc.name,
    host: doc.host,
    address: doc.address,
    galleryId: doc.galleryId || cardFor(doc.address, cards)?.id || null,
    owner: 'personal',
    status: doc.status,
    rule: RULES.includes(doc.rule) ? doc.rule : 'ask',
    defaultContextLevel: doc.defaultContextLevel || 'request',
    signedIn: Boolean(doc.auth),
    ...(doc.auth && { auth: { kind: doc.auth.kind } }),
    scopes: Array.isArray(doc.scopes) ? doc.scopes.slice(0, 24) : [],
    tools: (doc.tools || []).map(({ name, title, group, policy, destructive }) => ({ name, title, group, policy, ...(destructive && { destructive: true }) })),
    // Connected at a card's read-only address (Linear's, before agents read and write): the card's
    // own address, where it can make changes (one more sign-in there: integrations.connect replaces).
    writesAt: (doc.kind || 'mcp') === 'mcp' ? writesAddress(doc.address, cards) : null,
    actWithoutAsking: doc.actWithoutAsking === true,
    ...(doc.changed?.length && { changed: doc.changed.map((c) => c.name) }),
    colorIndex: doc.colorIndex ?? 1,
    lastUsedAt: doc.lastUsedAt || null,
    createdAt: doc.createdAt || null,
    slateCount: slates.length,
    slates: slates.slice(0, 20),
  }
}

/**
 * What personalization may know of an integration (the interview plans its questions from it,
 * web/app/server/profile/integration-hooks.mjs): its name, the gallery card it came from and its kind.
 * Never its address, a token, its tools or anything it holds.
 */
export function profileIntegration(doc, cards = GALLERY) {
  return {
    name: String(doc?.name || ''),
    cardId: doc?.galleryId || cardFor(doc?.address, cards)?.id || null,
    kind: doc?.kind || 'mcp',
  }
}

/**
 * An integration About you can use to personalize (S3, 2026-11-26): one of the person's own MCP
 * integrations whose gallery card has a look-around (recipes.mjs checkLookAround), working now. Its
 * ref is its card's id (one per person: the switch personalSettings.sources['integration:<ref>']).
 * Names only, like profileIntegration: never an address, a token or a tool. → { ref, name, kind } | null
 */
export function profileSource(doc, cards = GALLERY) {
  if (!doc || (doc.kind || 'mcp') !== 'mcp' || doc.status !== 'active') return null
  const card = (doc.galleryId && cards.find((c) => c.id === doc.galleryId)) || cardFor(doc.address, cards)
  if (!card || !checkRecipe(card.recipe)?.lookAround) return null
  return { ref: card.id, name: String(doc.name || card.name || ''), kind: 'mcp' }
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
    status: doc.status,
    signedIn: Boolean(doc.auth),
    mine,
    // The server's host is its inviter's business (an internal address says a lot): theirs alone.
    ...(mine && {
      host: doc.host,
      address: doc.address,
      contextLevel: doc.contextLevel,
      tools: (doc.tools || []).map(({ name, title, group, policy, destructive }) => ({ name, title, group, policy, ...(destructive && { destructive: true }) })),
      ...(doc.changed?.length && { changed: doc.changed }),
    }),
    // Who approves its action cards, and whether it acts without asking here (on, off, or its integration's choice).
    approvers: APPROVERS.includes(doc.approvers) ? doc.approvers : 'inviter',
    acting: doc.acting === 'on' || doc.acting === 'off' ? doc.acting : 'inherit',
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
  oauthApps = {}, // the pre-registered apps, or an async getter of them (integration-apps.mjs): a card with needsApp shows only once its vendor app is set up
  gallery = async () => GALLERY, // the live gallery (aiAgents, edited in /admin/ai), else the built-in cards
  integrations = memoryStore(), // { insert, findOne, find, update, remove }: each person's connected agent servers, apart from any slate
  slateSettings = memoryStore(), // { findOne({ _id: slateId }), insert, update }: a slate owner's outsideAgents choice
  slateList = async () => [], // async (slateIds, viewerId) -> [{ slateId, shareId, name }]: those slates the viewer can still open
  nativeOn = async () => true, // async (address) -> whether a native integration (Google) works on this server now
  forget = async () => {}, // async (integration): what a native integration kept per slate, forgotten when it is disconnected
  outside = memoryStore(), // { insert, findOne, find, update, claim?(id, fromStates, set) -> bool }: action cards (kind 'card') and act-without-asking changes (kind 'setting')
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
  // Anyone signed in may connect and invite integrations: never a guest or a visitor.
  const signedInPerson = (principal) => Boolean(principal?.userId) && principal.kind !== 'guest' && principal.kind !== 'visitor'
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

  // A server's tools as Slatebox treats them, with the gallery recipe's word for what each does (recipe.tools).
  async function toolsFrom(address, raw) {
    const recipe = checkRecipe(cardFor(address, await gallery())?.recipe)
    return normalizeTools(raw, recipe?.tools || null)
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
    if (error?.code && typeof error.message === 'string' && error.name === 'McpProblem') {
      const refusal = new ConnectorRefused(422, error.code, error.message, error.details)
      // The server's own HTTP status, for the audit line (never sent to the page).
      if (Number.isInteger(error.status)) Object.defineProperty(refusal, 'upstreamStatus', { value: error.status })
      return refusal
    }
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
    // A card whose server answers initialize openly and asks for a sign-in only on a tool call
    // (Google's): signed in first, so its tools are not consented to and then refused.
    if (!token && cardFor(address, await gallery())?.signInFirst) return { needsSignIn: true, again: false }
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
    const { address, host } = checkAddress(raw)
    try {
      return await discoverAt(principal, slate, address, host)
    } catch (error) {
      // Why a discovery failed, for whoever reads the logs: the code and the server's status, never its words.
      audit({ kind: 'discover_failed', userId: principal.userId, host, code: typeof error?.code === 'string' ? error.code : 'unknown', status: error?.upstreamStatus ?? (Number.isInteger(error?.status) ? error.status : null) })
      throw error
    }
  }

  async function discoverAt(principal, slate, address, host) {
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
    const tools = await toolsFrom(address, found.tools)
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
    // A Community card lists the tools its reviewer checked: anything added or changed since is said
    // before the person chooses (they still consent to each tool themselves).
    // Behind a sign-in the reviewer's anonymous check lists no tools (reviewedTools is empty): nothing was
    // reviewed to compare with, so no warning (one that always fired would teach people to ignore it).
    const reviewed = Array.isArray(card?.reviewedTools) && card.reviewedTools.length ? new Map(card.reviewedTools.map((tool) => [tool.name, tool.hash])) : null
    const reviewDrift = reviewed ? tools.some((tool) => reviewed.get(tool.name) !== tool.hash) : false
    // Already one of this person's integrations: the page offers to invite it instead of connecting again.
    const integration = await integrations.findOne({ ownerId: principal.userId, address })
    return {
      ...head,
      ...(integration && { integration: { integrationId: integration._id, name: integration.name, status: integration.status } }),
      ...(signedIn && { signedIn: { kind: signedIn.kind } }),
      ...(reviewDrift && { reviewDrift: true }),
      // Self-reported: shown as the server's claim, never used as the name on the slate.
      serverName: plainText(found.serverInfo?.title || found.serverInfo?.name || '', 60),
      suggestedName: slateName(card?.name || found.serverInfo?.title || found.serverInfo?.name || host.split('.').slice(-2, -1)[0] || 'Agent', sanitizeName) || 'Agent',
      tools: tools.map(({ name, title, description, group, hash, annotations, destructive }) => ({ name, title, description, group, hash, annotations, ...(destructive && { destructive: true }), policy: defaultPolicy({ group, destructive }) })),
      summary: capabilitySummary(tools),
    }
  }

  async function connect(principal, input) {
    return oneAtATime(principal, () => connectNow(principal, input))
  }

  // What the person consented to: each tool the server lists now, with the hash they saw, allowed
  // or off as they chose (a tool they did not send: lookups and changes allowed, destructive ones
  // off). An allowed change is only ever proposed, as an action card. At least one tool is allowed.
  function consented(name, tools, chosen) {
    const seen = new Map((Array.isArray(chosen) ? chosen : []).map((entry) => [entry?.name, entry]))
    const stored = tools.map((tool) => {
      const choice = seen.get(tool.name)
      if (choice && choice.hash !== tool.hash) refuse(409, 'tools_changed', `${name}'s tools changed while you were choosing. Look at them again.`)
      const policy = choice ? (POLICIES.includes(choice.policy) ? choice.policy : 'off') : defaultPolicy(tool)
      return { name: tool.name, title: tool.title, description: tool.description, group: tool.group, ...(tool.destructive && { destructive: true }), hash: tool.hash, policy }
    })
    if (!stored.some((tool) => tool.policy === 'allow')) refuse(400, 'no_tools', 'Allow at least one thing it may look up or do.')
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
    const stored = consented(name, await toolsFrom(address, found.tools), chosen)
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
      const now = reconcile(doc.tools, await toolsFrom(doc.address, reached.found.tools))
      return !now.allowed.length && !now.writable.length
    } catch {
      return false
    }
  }

  // Inviting a paused agent again: the person consents to what the server says now (hashes they saw).
  async function consentAgain(principal, doc, { address, chosen, contextLevel }) {
    const reached = await discoverAs(principal.userId, address)
    if (reached.needsSignIn) refuse(401, 'needs_sign_in', `Sign in to ${doc.host} first.`)
    const stored = consented(doc.name, await toolsFrom(address, reached.found.tools), chosen)
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

  // One consent again resumes every slate the integration is on, with the tools just consented to. A
  // tool someone turned off on one slate stays off there: a new consent never switches it back on.
  // turnOn: tools the person just turned on for the integration itself ("let it make changes too"),
  // on every slate it is on, so a copy that was off only because the integration was follows them.
  // move: { address, host, auth } when the integration moved to its card's own address.
  async function resumeEverywhere(integration, tools, { turnOn = new Set(), agents = null, move = null } = {}) {
    const at = new Date(now())
    for (const other of agents || (await agentsOf(integration))) {
      const offHere = new Set((other.tools || []).filter((tool) => tool.policy === 'off' && !turnOn.has(tool.name)).map((tool) => tool.name))
      const kept = tools.map((tool) => (offHere.has(tool.name) && tool.policy === 'allow' ? { ...tool, policy: 'off' } : tool))
      const set = { tools: kept, changed: null, integrationId: integration._id, updatedAt: at, ...move, ...((other.status === 'paused' || other.status === 'needs_sign_in') && { status: 'active' }) }
      await connections.update(other._id, set)
    }
  }

  async function list(principal, { shareId }) {
    const { slate } = await requireReader(principal, shareId)
    const docs = await connections.find({ slateId: slate._id, status: { $ne: 'removed' } })
    const cards = await gallery()
    // canInvite: this person may invite agents here: anyone signed in (never a guest or a visitor).
    return { connections: docs.map((doc) => publicConnection(doc, principal.userId, cards)), canInvite: signedInPerson(principal) }
  }

  /**
   * A connection its owner suggests for the library (library.submit kind integration): theirs, an MCP
   * server that works now, at an address the endpoint policy allows and the gallery does not list.
   * → what the library keeps of it: the address, its host and the tools they connected (names, groups
   * and hashes; never descriptions or a token).
   */
  async function submissionOf(principal, { integrationId } = {}) {
    if (!principal?.userId || principal.kind === 'guest' || principal.kind === 'visitor') refuse(403, 'sign_in_to_publish', 'Sign up to suggest an integration.')
    const doc = typeof integrationId === 'string' ? await integrations.findOne({ _id: integrationId }) : null
    if (!doc || doc.ownerId !== principal.userId) refuse(404, 'not_found', 'That integration is not one of yours.')
    if ((doc.kind || 'mcp') !== 'mcp') refuse(400, 'invalid_request', 'Only an agent connected by its MCP address can be suggested.')
    if (doc.status !== 'active') refuse(409, 'not_working', `${doc.name} is not working right now (${doc.status.replace(/_/g, ' ')}). Fix it on the Integrations page first.`)
    const { address, host } = checkAddress(doc.address)
    if (cardFor(address, await gallery())) refuse(409, 'already_listed', 'Connect an integration already lists this address, so there is nothing to suggest.')
    if (retiredFor(address)) refuse(409, 'already_listed', 'Slatebox took this one out of the gallery on purpose.')
    // A per-account secret in the path (Zapier's /s/<secret>/, a UUID, /sse/<token>) works signed out:
    // published, everyone who connected it would act as this person. Never suggested.
    const secret = secretInPath(address)
    if (secret) refuse(400, 'secret_in_path', secretInPathSentence(secret))
    // Never how its author signs in (theirs alone, and what the library keeps may become public).
    return {
      address, host,
      tools: (doc.tools || []).map(({ name, group, destructive, hash }) => ({ name, group, ...(destructive && { destructive: true }), hash })),
    }
  }

  /**
   * A reviewer's check of a suggested address: an anonymous discovery through the guarded fetch (no
   * one's token), and when it is behind a sign-in, whom that sign-in goes to. Never throws for the
   * server's own failures: they come back as { reachable: false, problem } for the reviewer to read.
   * The endpoint policy (https, public addresses only) refuses as it does for anyone.
   */
  async function reviewProbe(raw) {
    const { address, host } = checkAddress(raw)
    // Said to the reviewer whatever the server answers: reachable signed out is exactly how a path secret looks.
    const secret = secretInPath(address)
    const out = { address, host, lookalike: lookalikeHost(address), reachable: false, signIn: null, tools: [], ...(secret && { secretInPath: secret }) }
    try {
      const found = await session.discover(address, fetch, { token: null })
      const tools = await toolsFrom(address, found.tools)
      return { ...out, reachable: true, tools: tools.map(({ name, group, destructive, hash }) => ({ name, group, ...(destructive && { destructive: true }), hash })) }
    } catch (error) {
      const problem = fromProblem(error)
      if (problem?.code !== 'needs_sign_in') return { ...out, problem: String(problem?.message || 'Slatebox could not reach it.').slice(0, 300) }
    }
    try {
      const plan = await signInPlan(address)
      return { ...out, reachable: true, signIn: { method: plan.method || 'oauth', authHost: plan.authHost || null, issuer: plan.issuer || plan.provider || null } }
    } catch (error) {
      return { ...out, reachable: true, signIn: { method: 'unknown', authHost: null, issuer: null }, problem: String(error?.message || 'Its sign-in could not be read.').slice(0, 300) }
    }
  }

  /** The gallery the invite dialog shows: the enabled cards in order, and whether this person may invite. */
  async function galleryList(principal) {
    // A vendor that needs an app registered ahead of time (no automatic registration) is not offered
    // until it is; the dialog still names it (notSetUp: no address, nothing to invite), so a search
    // for it says it is not set up on this server instead of finding nothing.
    const all = await gallery()
    const apps = typeof oauthApps === 'function' ? await oauthApps() : oauthApps
    const ready = (card) => !card.needsApp || Boolean(apps?.[card.needsApp]?.clientId)
    const canInvite = signedInPerson(principal)
    return {
      cards: all.filter(ready).map(({ id, name, url, job, lands, try: tryThis, featured, signIn, keyHint, cost, group, origin, homepage, sharedBy, keywords }) => ({
        id, name, url, job, lands, try: tryThis, featured: Boolean(featured), signIn: signIn || null, keyHint: keyHint || null, cost: cost || '', group: group || null,
        ...(Array.isArray(keywords) && keywords.length && { keywords: keywords.slice(0, 12) }),
        // A card someone suggested and an administrator approved (the library's review queue): the dialog marks it Community.
        ...(origin === 'community' && { origin, ...(homepage && { homepage }), ...(sharedBy && { sharedBy }) }),
      })),
      notSetUp: all.filter((card) => !ready(card)).map(({ id, name, job, lands, group, keywords }) => ({
        id, name, job, lands, group: group || null, ...(Array.isArray(keywords) && keywords.length && { keywords: keywords.slice(0, 12) }),
      })),
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
    const running = await declineWaiting(doc, principal)
    await presence.end('hello:' + doc._id, 'done').catch(() => {})
    // Its integration and sign-in stay: the person connected it once and may invite it anywhere.
    // Disconnecting the integration (Integrations page) is what revokes the sign-in.
    audit({ kind: 'disconnect', userId: principal.userId, host: doc.host, connectionId: doc._id, ...(doc.ownerId !== principal.userId && { byOwner: true }), ...(running && { running }) })
    return { ok: true, connectionId: doc._id, ...(running && { running, say: `${running === 1 ? 'One change was' : `${running} changes were`} already being made in ${doc.name} and could not be stopped: ${running === 1 ? 'its card says' : 'their cards say'} how it went.` }) }
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
    // A native integration an administrator turned off (Google's card in /admin/ai): its stored sign-in is not used.
    if (!(await nativeOn(doc.address))) refuse(403, 'disabled', `${doc.name} is turned off on this server.`)
    // The slate owner's choice holds for agents already here too, not only for new invitations.
    const setting = await outsideAgentsOf(slate)
    if (setting === 'off') refuse(403, 'agents_off', 'This slate\'s owner turned off outside agents here.')
    if (setting === 'owner' && doc.ownerId !== slate.userId) refuse(403, 'owner_only', 'This slate\'s owner now lets only their own outside agents work here.')
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
    if (same) {
      // Its action cards are approved or declined on their own (Keep all never approves one).
      const open = (await outside.find({ slateId: slate._id, actionId: same.actionId })).filter((c) => c.kind === 'card' && ['waiting', 'failed', 'unclear'].includes(c.state))
      const others = (same.boxes || []).length - open.length
      const what = open.length ? `approve or decline its ${open.length === 1 ? 'card' : 'cards'}${others > 0 ? ' and keep or discard its other notes' : ''}` : 'Keep all or Discard all on its frame'
      return { items: 0, actions: [same.actionId], saved: 0, repeated: true, say: `That answer is still on the slate, waiting: ${what}, then ask again for a new one.`, left: [], added: { notes: 0, lines: 0 } }
    }
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
          listedTools = normalizeTools(listed, recipe?.tools || null)
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
        const { allowed, writable } = reconcile(doc.tools, listedTools)
        const nothing = `${doc.name} has nothing it may look up or do now. Invite it again from + Invite agent to choose what it may use.`
        if (!allowed.length && !writable.length) refuse(409, 'no_tools', nothing)
        const toolOf = new Map([...allowed, ...writable].map((tool) => [tool.name, tool]))
        // Read-me tools only explain the others: never offered, never laid out.
        const offered = allowed.filter((tool) => !isReferenceTool(tool, recipe))
        // A change elsewhere is planned only when the person's own words ask for one these tools make.
        const wantsChange = writable.length > 0 && asksForChange(text, writable)
        if (!offered.length && !wantsChange) refuse(409, 'no_tools', writable.length ? `${doc.name} only makes changes. Ask it for one, such as "file an issue for this".` : nothing)
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
        const intent = recipe && offered.length ? matchIntent(recipe, text, requestValues(text)) : null
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
        } else if (!wantsChange && offered.length) {
          // Anything else: the planner, within the limits (one round of two calls unless its recipe says more).
          // An ask for a change goes to the change planner alone (it never reads a server's answers anyway).
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
        // The changes asked for: proposed, never made here (each lands as an action card).
        const proposals = []
        if (wantsChange) {
          const names = new Set(writable.map((tool) => tool.name))
          // A recipe's known change, by the clauses that ask for one (never by a read question's words).
          const known = recipe ? matchWrite(recipe, text, names) : null
          const tools = known ? [toolOf.get(known.tool)] : writable
          const limit = Math.min(limits.calls, PLAN_LIMITS.writes, CARD_LIMITS.perAsk)
          const { system, user } = writePlanPrompt({ serverName: doc.name, tools, packed, text: promptOf, calls: limit, history: said, hint })
          const planned = checkWrites(await model({ feature: 'connectors', tool: planTool(promptOf), system, user, userId: principal.userId, shareId: slate.shareId }), tools, { limit, fixed: known?.write.args || null })
          for (const call of planned.calls) {
            const tool = toolOf.get(call.tool)
            const write = known?.write || (recipe?.writes || []).find((w) => [].concat(w.tool).includes(call.tool)) || null
            // Shown in full or not proposed: a card never sends what it does not show.
            if (!fitsOnCard(call.args, write?.fields || {})) {
              say = say || `${doc.name}'s change was too long to show on a card in full, so it was not proposed. Ask for a shorter one.`
              continue
            }
            // Destructive by its tool, or by its own arguments (an update that closes or cancels).
            proposals.push({ tool: call.tool, args: call.args, hash: tool.hash, title: tool.title, destructive: Boolean(tool.destructive) || destructiveArgs(call.args), write })
          }
          if (!proposals.length) say = say || planned.say || `${doc.name} needs more to make that change. Say what it should be called and where it goes.`
        }
        if (!entries.length) return { groups: [], say: say || (proposals.length ? '' : `${doc.name} had nothing to look up for that.`), entries, proposals }
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
        return { groups: trimmed.groups, say, entries, left, proposals }
      }, { userId: principal.userId, shareId: slate.shareId })
      const left = [...new Set([...result.entries.flatMap((entry) => entry.result.left), ...(result.left || [])])]
      // Each proposed change: an action card, in the same answer (its own group of notes). One its
      // inviter lets act without asking (never a destructive one) is made now, and its card says so.
      const cards = await cardsFor(doc, slate, result.proposals || [], principal)
      const groups = cards.length ? [...result.groups, { label: cards.some((c) => c.state !== 'done') ? 'For approval' : `Done in ${plainText(doc.name, 32)}`, layout: 'column', notes: await cardNotes(doc, cards), lines: [] }] : result.groups
      await presence.step(agent, slate, 2, 'doing').catch(() => {})
      // The whole answer is saved ONCE as the agent: the app files it as one live suggestion (one
      // frame of ghosts on every screen, the cursor moving to them, Keep all / Discard all, one
      // Undo), or saves it at once when a person lets this agent edit directly.
      // Earlier answers still waiting take their space too, so this one never lands on their ghosts.
      const busy = ((await suggestions.waiting?.(slate).catch(() => [])) || []).flatMap((action) => action.boxes || [])
      const items = itemsFromLayout({ groups, slate, aliases: packed.aliases, selection: ids, serverName: doc.name, view: viewOf(view), message, busy })
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
        const actionId = answer?.body?.suggestion?.actionId || null
        if (actionId) actions.push(actionId)
        else if (answer?.body?.outcome === 'saved') saved++
        else dropped++
        // Each card knows its note (the last group's notes, in order) and the answer it waits in.
        const cardGroup = cards.length ? item.groups.at(-1) : null
        for (const [index, card] of cards.entries()) {
          const nodeId = cardGroup?.created?.[index] || null
          const placed = Boolean(actionId || answer?.body?.outcome === 'saved')
          const set = placed ? { nodeId, actionId, updatedAt: new Date(now()) } : { state: card.state === 'waiting' ? 'declined' : card.state, error: card.state === 'waiting' ? 'It could not be placed on the slate.' : card.error || null, updatedAt: new Date(now()) }
          await outside.update(card._id, set)
          Object.assign(card, set)
          // Its ghost is marked as this card: every screen draws Approve and Decline on it, never Keep.
          if (actionId) await retextCard(card, doc, slate)
        }
      }
      if (dropped) left.push('The suggestion could not be placed: the slate changed while it was being made. Ask again to try it.')
      const notes = groups.reduce((sum, group) => sum + group.notes.length, 0)
      const lines = groups.reduce((sum, group) => sum + (group.lines || []).length, 0)
      outcome = 'done'
      if (doc.integrationId) await integrations.update(doc.integrationId, { lastUsedAt: new Date(now()) })
      const waiting = cards.filter((card) => card.state === 'waiting').length
      // What to press is said by the chat (agentChatReply: "Approve or decline the Linear issue card on the slate").
      const sayWords = plainText(result.say, 240) || (waiting ? `${waiting === 1 ? 'One change waits' : `${waiting} changes wait`} for your approval.` : '')
      return { items: actions.length + saved, actions, saved, say: sayWords, left, added: dropped ? { notes: 0, lines: 0 } : { notes, lines }, ...(cards.length && { cards: cards.map((card) => publicCard(card, principal.userId)) }) }
    } catch (error) {
      throw fromProblem(error)
    } finally {
      await presence.end(runId, outcome).catch(() => {})
    }
  }

  // ---------- action cards: changes outside Slatebox ----------

  const cardRow = (id) => (typeof id === 'string' && /^o[A-Za-z0-9_-]{6,40}$/.test(id) ? outside.findOne({ _id: id }) : null)
  const integrationOf = (doc) => (doc.integrationId ? integrations.findOne({ _id: doc.integrationId }) : null)

  // The cards for one answer's proposed changes: kept (waiting), or made at once when the agent
  // acts without asking here (never a destructive change).
  async function cardsFor(doc, slate, proposals, principal) {
    if (!proposals.length) return []
    const acting = actsWithoutAsking(doc, await integrationOf(doc), slate)
    const at = new Date(now())
    const cards = []
    for (const proposal of proposals.slice(0, CARD_LIMITS.perAsk)) {
      const card = {
        _id: newId('o'),
        kind: 'card',
        slateId: slate._id,
        shareId: slate.shareId,
        connectionId: doc._id,
        agentId: doc.agentId || null,
        ownerId: doc.ownerId,
        integrationId: doc.integrationId || null,
        system: doc.name,
        host: doc.host,
        tool: proposal.tool,
        hash: proposal.hash,
        args: proposal.args,
        label: cardLabel({ tool: proposal.tool, title: proposal.title, system: doc.name, label: proposal.write?.label || null }),
        preview: previewOf(proposal.args, proposal.write?.fields || {}),
        destructive: proposal.destructive,
        state: 'waiting',
        nodeId: null,
        actionId: null,
        requestedById: principal.userId,
        createdAt: at,
        updatedAt: at,
        expiresAt: new Date(at.getTime() + CARD_LIMITS.keepDays * 86400000),
      }
      await outside.insert(card)
      audit({ kind: 'outside_proposed', userId: principal.userId, host: doc.host, connectionId: doc._id, cardId: card._id, tool: card.tool, destructive: card.destructive })
      if (acting && !card.destructive) await performNow(card, doc, { acted: true, by: null, approver: principal, slate })
      cards.push(card)
    }
    return cards
  }

  async function cardNotes(doc, cards) {
    const inviter = doc.inviterName || 'its inviter'
    return cards.map((card, index) => ({ key: 'card' + index, wide: true, text: cardText(card, { inviter, approvers: doc.approvers }), ...(card.result?.link && { link: card.result.link }) }))
  }

  // The card's note says what became of it (only while its note still waits as a ghost).
  async function retextCard(card, doc, slate) {
    if (!card.actionId || !card.nodeId || !suggestions.retext) return
    await suggestions.retext(slate, { actionId: card.actionId, nodeId: card.nodeId, text: cardText(card, { inviter: doc.inviterName, approvers: doc.approvers }), link: card.result?.link || null, card: { id: card._id, state: card.state } }).catch(() => {})
  }

  // Moves a card from one of these states to another, once (two approvals make a change once).
  async function moveCard(card, from, set) {
    if (outside.claim) {
      if (!(await outside.claim(card._id, from, set))) return false
    } else {
      const fresh = await outside.findOne({ _id: card._id })
      if (!fresh || !from.includes(fresh.state)) return false
      await outside.update(card._id, set)
    }
    Object.assign(card, set)
    return true
  }

  // Taken once: a card is made by one approval at a time (two people pressing Keep make it once).
  // again: the person looked and asks to try a change whose outcome was unclear once more.
  const claimCard = (card, { again = false } = {}) =>
    moveCard(card, again ? ['waiting', 'failed', 'unclear'] : ['waiting', 'failed'], { state: 'running', runningSince: new Date(now()), updatedAt: new Date(now()) })

  // A card left running past its lease (the process stopped, or saving its outcome failed) may have
  // been made: it becomes unclear, never waiting again, so a plain Keep cannot make it twice.
  async function settleStale(card) {
    if (card?.state !== 'running') return card
    const since = new Date(card.runningSince || card.updatedAt || 0).getTime()
    if (now() - since < CARD_LIMITS.runningMs) return card
    await moveCard(card, ['running'], { state: 'unclear', error: `Slatebox lost track of it while it ran.`, updatedAt: new Date(now()) })
    audit({ kind: 'outside_unclear', userId: card.ownerId, cardId: card._id, connectionId: card.connectionId, tool: card.tool })
    return card
  }

  /**
   * Make one card's change, as its inviter: the tool is checked again against the hash they
   * consented to (a moved definition pauses the agent everywhere, as an ask does), then called once.
   * The card ends done (with the server's link) or failed (with plain words); it never retries itself.
   */
  async function performNow(card, doc, { acted = false, by = null, approver = null, slate = null, again = false }) {
    if (!(await claimCard(card, { again }))) refuse(409, 'card_busy', 'That change is already being made, or was decided.')
    let raw = null
    let problem = null
    // Whether the call itself went out: an error before it is a plain failure (try again); an error
    // after it (a timeout, a dropped connection) leaves the outcome unclear.
    let sent = false
    try {
      const reached = await discoverAs(doc.ownerId, doc.address)
      if (reached.needsSignIn) {
        await setStatus(doc, 'needs_sign_in')
        throw new ConnectorRefused(401, 'needs_sign_in', `${doc.name} needs ${doc.inviterName || 'its inviter'} to sign in to ${doc.host} again.`)
      }
      const recipe = checkRecipe(cardFor(doc.address, await gallery())?.recipe)
      const listed = normalizeTools(reached.found.tools, recipe?.tools || null)
      const { writable, changed } = reconcile(doc.tools, listed)
      if (changed.length) {
        await pauseEverywhere(doc, changed)
        throw new ConnectorRefused(409, 'tools_changed', `${doc.name}'s tools changed since they were allowed. Look at them again before approving.`)
      }
      const tool = writable.find((t) => t.name === card.tool)
      if (!tool || tool.hash !== card.hash) throw new ConnectorRefused(403, 'not_allowed', `${doc.name} may no longer make that change.`)
      const check = (now) => {
        if (reconcile(doc.tools, normalizeTools(now, recipe?.tools || null)).changed.length)
          throw new ConnectorRefused(409, 'tools_changed', `${doc.name}'s tools changed since they were allowed. Look at them again before approving.`)
        sent = true
      }
      raw = await session.callTool(doc.address, fetch, { name: card.tool, args: card.args, check }, { token: reached.token, ownerId: doc.ownerId, slateId: doc.slateId })
    } catch (error) {
      const known = fromSignIn(error)
      problem = known instanceof ConnectorRefused || known?.name === 'McpProblem' ? known.message : 'The server could not be reached.'
      // The server refused before doing anything (signed out, blocked, no access): a plain failure.
      if (error instanceof ConnectorRefused || ['needs_sign_in', 'needs_more_access', 'blocked', 'not_mcp', 'app_refused'].includes(error?.code)) sent = false
    }
    const at = new Date(now())
    const failed = problem || raw?.isError === true
    const unclear = Boolean(problem) && sent
    const record = new Date(at.getTime() + CARD_LIMITS.recordDays * 86400000)
    const set = unclear
      ? { state: 'unclear', error: plainText(`${problem} It may have been made anyway.`, CARD_LIMITS.reason), updatedAt: at }
      : failed
        ? { state: 'failed', error: plainText(problem ? `${problem} Try again.` : failureOf(raw), CARD_LIMITS.reason), updatedAt: at }
        : { state: 'done', error: null, result: { link: linkOf(raw, card.args) }, actedWithoutAsking: acted, decidedBy: by, decidedById: approver?.userId || null, decidedAt: at, updatedAt: at, expiresAt: record }
    try {
      await outside.update(card._id, set)
    } catch {
      // Its outcome could not be saved: the lease turns it unclear later, never waiting again.
    }
    Object.assign(card, set)
    audit({
      kind: 'outside_write', userId: doc.ownerId, host: doc.host, connectionId: doc._id, cardId: card._id, tool: card.tool, ok: !failed, unclear, acted,
      ...(by && { by }),
      // Which account approved it (or, acting without asking, whose ask made it), and which token.
      ...(approver?.userId && { approverId: approver.userId, approverKind: approver.kind }),
      ...(approver?.tokenId && { tokenId: approver.tokenId }),
      ...(card.requestedById && { requestedById: card.requestedById }),
    })
    if (slate) await retextCard(card, doc, slate)
    return card
  }

  // Who may approve a card: its inviter (the same rule as asking), or anyone who may edit the slate
  // when the inviter lets them. A token only for an agent its inviter lets act without asking.
  function mayApprove(principal, card, doc, canEdit, acting) {
    if (!principal?.userId) return false
    if (principal.kind === 'person') return principal.userId === doc.ownerId || (doc.approvers === 'editors' && canEdit)
    // Only a real API token: never a conversation, a teammate or an invited agent (all model-driven).
    if (isApiToken(principal)) return principal.userId === doc.ownerId && acting && !card.destructive
    return false
  }

  // Everything an approval needs, refused in plain words: the agent still here and allowed to work.
  async function approvable(principal, card) {
    const doc = await connections.findOne({ _id: card.connectionId })
    if (!doc || doc.status === 'removed') refuse(404, 'not_found', 'That agent is not on this slate any more.')
    const found = principal?.userId ? await accessOf(principal, doc.shareId) : null
    if (!found?.slate || !found.canRead) refuse(404, 'not_found', 'Slate not found or unavailable.')
    if (!found.canEdit) refuse(403, 'forbidden', 'Only people who can edit this slate approve its agents\' changes.')
    const slate = found.slate
    const acting = actsWithoutAsking(doc, await integrationOf(doc), slate)
    if (!mayApprove(principal, card, doc, found.canEdit, acting))
      refuse(403, 'approver_only', principal.kind === 'person' ? `Only ${doc.inviterName || 'the person who invited it'} can approve ${doc.name}'s changes.` : 'Only a person approves an agent\'s changes on the slate, unless its inviter lets it act without asking.')
    if (!(await nativeOn(doc.address))) refuse(403, 'disabled', `${doc.name} is turned off on this server.`)
    const setting = await outsideAgentsOf(slate)
    if (setting === 'off') refuse(403, 'agents_off', 'This slate\'s owner turned off outside agents here.')
    if (setting === 'owner' && doc.ownerId !== slate.userId) refuse(403, 'owner_only', 'This slate\'s owner now lets only their own outside agents work here.')
    if (await suggestions.paused?.(slate)) refuse(423, 'agents_paused', `Agents are paused on this slate. Resume agents to approve ${doc.name}'s changes.`)
    if (doc.status === 'paused') refuse(409, 'tools_changed', `${doc.name}'s tools changed since you invited it. Invite it again from + Invite agent to look at them.`)
    return { doc, slate, found }
  }

  /** Approve one card from the slate (Keep on its note) or any surface: its change is made now. */
  async function approveCard(principal, card, { fromSlate = false, again = false } = {}) {
    await settleStale(card)
    const { doc, slate } = await approvable(principal, card)
    if (card.state === 'done') return { card, doc, slate }
    if (card.state === 'declined') refuse(409, 'declined', 'That change was declined. Ask the agent again for a new one.')
    if (card.state === 'running') refuse(409, 'card_busy', 'That change is already being made.')
    // It may already have been made: only a person who looked, asking for it once more on purpose.
    if (card.state === 'unclear' && !(again && principal.kind === 'person'))
      refuse(409, 'unclear', `${doc.name} may already have made that change. Look in ${doc.name} first; if it is not there, try it again from the agent's changes ("Try again anyway").`)
    // Its note was discarded (or expired) meanwhile: the change is not made.
    if (!fromSlate && card.actionId && suggestions.actionOf) {
      const action = await suggestions.actionOf(slate, card.actionId).catch(() => null)
      const item = action?.items?.find((i) => i.kind === 'add' && i.nodeId === card.nodeId)
      if (!item || item.state !== 'pending') {
        await outside.update(card._id, { state: 'declined', error: 'Its card left the slate.', updatedAt: new Date(now()) })
        refuse(409, 'declined', 'That change\'s card is no longer on the slate. Ask the agent again for a new one.')
      }
    }
    const by = principal.kind === 'person' ? await firstName(principal.userId).catch(() => 'Someone') : `${doc.inviterName || 'Its inviter'}'s token ${plainText(principal.tokenName || '', 40)}`.trim()
    await oneAtATime({ userId: doc.ownerId }, () => performNow(card, doc, { acted: false, by, approver: principal, slate, again }))
    return { card, doc, slate }
  }

  /** connectors.approve: make a card's change; a person's approval also keeps its note (its record). */
  async function approve(principal, { cardId, again = false }) {
    const card = await cardRow(cardId)
    if (!card || card.kind !== 'card') refuse(404, 'not_found', 'There is no such change waiting.')
    const { doc, slate } = await approveCard(principal, card, { again: again === true })
    let kept = false
    if (card.state === 'done' && principal.kind === 'person' && card.actionId && suggestions.keep && suggestions.actionOf) {
      const action = await suggestions.actionOf(slate, card.actionId).catch(() => null)
      const item = action?.items?.find((i) => i.kind === 'add' && i.nodeId === card.nodeId && i.state === 'pending')
      if (item) kept = Boolean(await suggestions.keep(principal, slate, card.actionId, [item.id]).catch(() => null))
    }
    return { card: publicCard(card, principal.userId), kept, ...(card.state === 'failed' && { say: `${doc.name} couldn't do it: ${card.error}` }), ...(card.state === 'unclear' && { say: `${doc.name} may or may not have done it: ${card.error} Look in ${doc.name} before trying again.` }) }
  }

  // A card declined: nothing is changed outside; who declined is remembered.
  // An unclear card is dropped the same way (whatever happened outside stays as it is).
  async function declineRow(card, principal) {
    await settleStale(card)
    const set = { state: 'declined', decidedBy: principal?.userId ? await firstName(principal.userId).catch(() => 'Someone') : null, decidedById: principal?.userId || null, decidedAt: new Date(now()), updatedAt: new Date(now()), expiresAt: new Date(now() + CARD_LIMITS.recordDays * 86400000) }
    if (!(await moveCard(card, ['waiting', 'failed', 'unclear'], set))) return false
    audit({ kind: 'outside_declined', userId: principal?.userId || null, cardId: card._id, connectionId: card.connectionId, tool: card.tool, ...(principal?.tokenId && { tokenId: principal.tokenId }) })
    return true
  }

  /** connectors.decline: anyone who may edit the slate declines a waiting change (its note goes too). */
  async function decline(principal, { cardId }) {
    const card = await cardRow(cardId)
    if (!card || card.kind !== 'card') refuse(404, 'not_found', 'There is no such change waiting.')
    const found = principal?.userId ? await accessOf(principal, card.shareId) : null
    if (!found?.slate || !found.canRead) refuse(404, 'not_found', 'Slate not found or unavailable.')
    if (!found.canEdit) refuse(403, 'forbidden', 'Only people who can edit this slate decline its agents\' changes.')
    await settleStale(card)
    if (card.state === 'done') refuse(409, 'already_done', 'That change was already made. Change it where it was made.')
    // Being made right now: it cannot be stopped, so it is not declined (and its card stays).
    if (card.state === 'running') refuse(409, 'card_busy', `That change is being made in ${card.system} right now and cannot be stopped. Its card will say how it went.`)
    if (!(await declineRow(card, principal)) && card.state !== 'declined') refuse(409, 'card_busy', 'That change was decided meanwhile.')
    if (card.actionId && suggestions.actionOf && suggestions.discardItems) {
      const action = await suggestions.actionOf(found.slate, card.actionId).catch(() => null)
      const item = action?.items?.find((i) => i.kind === 'add' && i.nodeId === card.nodeId && i.state === 'pending')
      if (item) await suggestions.discardItems(principal, found.slate, card.actionId, [item.id]).catch(() => {})
    }
    return { card: publicCard(card, principal.userId) }
  }

  /**
   * The app's suggestions.decide asks this first (deps.suggestionGate). Keep: a card note kept on its
   * own approves its change (made now, by whoever may approve); Keep all holds cards back; a card
   * whose change failed or was refused stays waiting with its reason. Discard declines cards. Undo
   * leaves done cards (nothing outside can be undone) and says so. → null when no card is involved.
   */
  async function gate(principal, slate, { decision, actionId, itemIds }) {
    const cards = (await outside.find({ slateId: slate._id, actionId })).filter((card) => card.kind === 'card')
    if (!cards.length || !suggestions.actionOf) return null
    const action = await suggestions.actionOf(slate, actionId).catch(() => null)
    if (!action) return null
    const byNode = new Map(cards.filter((c) => c.nodeId).map((c) => [c.nodeId, c]))
    const cardOf = new Map(action.items.filter((i) => i.kind === 'add' && byNode.has(i.nodeId)).map((i) => [i.id, byNode.get(i.nodeId)]))
    if (!cardOf.size) return null
    const pending = action.items.filter((i) => i.state === 'pending').map((i) => i.id)
    const named = Array.isArray(itemIds) && itemIds.length ? itemIds : null
    if (decision === 'discard') {
      // A card whose change is being made right now stays (it cannot be stopped); every other card is declined.
      const out = []
      const held = []
      for (const id of named || pending) {
        const card = cardOf.get(id)
        if (card) await settleStale(card)
        if (card?.state === 'running') {
          held.push({ itemId: id, cardId: card._id, reason: `${card.label} is being made in ${card.system} right now and cannot be stopped. Its card will say how it went.` })
          continue
        }
        if (card?.state === 'done') {
          held.push({ itemId: id, cardId: card._id, reason: `${card.label} was already made in ${card.system}; its card stays as the record.` })
          continue
        }
        if (card) await declineRow(card, principal)
        out.push(id)
      }
      return held.length ? { itemIds: out, held } : null
    }
    if (decision === 'undo') {
      const left = []
      for (const [itemId, card] of cardOf) {
        const item = action.items.find((i) => i.id === itemId)
        if (card.state === 'done' && (item?.state === 'kept' || item?.state === 'applied'))
          left.push({ itemId, reason: `${card.label} stays done in ${card.system}: Slatebox can't undo a change made outside it.${card.result?.link ? ' Open it there to change it.' : ''}` })
      }
      return { skip: [...cardOf.keys()], left }
    }
    const out = []
    const held = []
    for (const id of named || pending) {
      const card = cardOf.get(id)
      if (card) await settleStale(card)
      if (!card || card.state === 'done') {
        out.push(id)
        continue
      }
      if (card.state === 'unclear') {
        held.push({ itemId: id, cardId: card._id, reason: card.error ? `${card.error} Look in ${card.system} before trying again.` : `It may already be in ${card.system}.` })
        continue
      }
      if (!named) {
        held.push({ itemId: id, cardId: card._id, reason: 'Approve each change outside Slatebox on its own card.' })
        continue
      }
      if (principal.kind !== 'person') {
        held.push({ itemId: id, cardId: card._id, reason: 'Only a person approves a change outside Slatebox on the slate (connectors.approve for an agent that acts without asking).' })
        continue
      }
      try {
        await approveCard(principal, card, { fromSlate: true })
        if (card.state === 'done') out.push(id)
        else held.push({ itemId: id, cardId: card._id, reason: card.error || 'It could not be done.' })
      } catch (error) {
        if (!(error instanceof ConnectorRefused)) throw error
        held.push({ itemId: id, cardId: card._id, reason: error.message })
      }
    }
    return { itemIds: out, held }
  }

  // An act-without-asking choice, kept in the agent's activity for everyone on the slate.
  async function recordSetting(principal, doc, text) {
    await outside.insert({ _id: newId('o'), kind: 'setting', slateId: doc.slateId, shareId: doc.shareId, connectionId: doc._id, agentId: doc.agentId || null, ownerId: doc.ownerId, text: plainText(text, 200), by: await firstName(principal.userId).catch(() => 'Someone'), createdAt: new Date(now()), expiresAt: new Date(now() + 90 * 86400000) })
  }

  /**
   * On one slate: whether this agent acts without asking (on, off, or its integration's choice) and
   * who approves its cards.
   *   - Acting without asking runs changes as its inviter's account, so only its inviter turns it on.
   *     The slate's owner may turn it off, and that holds: its inviter cannot turn it back on here
   *     until the owner sets it back to the integration's choice (on a slate its inviter does not
   *     own, the integration's choice is off: actsWithoutAsking).
   *   - Its inviter or the slate's owner may let the slate's editors approve its cards, or narrow
   *     that back to its inviter.
   * Audited, and shown in its activity.
   */
  async function setActing(principal, { connectionId, actWithoutAsking, approvers }) {
    if (!principal?.userId || principal.kind !== 'person') refuse(403, 'person_required', 'Only a signed-in person changes how an agent acts.')
    const doc = typeof connectionId === 'string' ? await connections.findOne({ _id: connectionId }) : null
    if (!doc || doc.status === 'removed') refuse(404, 'not_found', 'That agent is not on this slate any more.')
    const found = await accessOf(principal, doc.shareId)
    if (!found?.slate || !found.canRead) refuse(404, 'not_found', 'Slate not found or unavailable.')
    const inviter = doc.ownerId === principal.userId
    const owner = found.slate.userId === principal.userId
    if (!inviter && !owner) refuse(403, 'inviter_only', `Only ${doc.inviterName || 'the person who invited it'} or this slate's owner can change how ${doc.name} acts.`)
    const integration = await integrationOf(doc)
    const set = {}
    if (actWithoutAsking !== undefined) {
      if (!['on', 'off', 'inherit'].includes(actWithoutAsking)) refuse(400, 'invalid_request', 'Choose on, off or inherit.')
      const ownersSlate = found.slate.userId === doc.ownerId
      const wider = actWithoutAsking === 'on' || (actWithoutAsking === 'inherit' && ownersSlate && integration?.actWithoutAsking === true)
      if (actWithoutAsking === 'on' && !inviter) refuse(403, 'inviter_only', `Only ${doc.inviterName || 'the person who invited it'} can let ${doc.name} act without asking.`)
      if (wider && !inviter && !owner) refuse(403, 'inviter_only', `Only ${doc.inviterName || 'the person who invited it'} can let ${doc.name} act without asking.`)
      // The slate owner's "off" holds against its inviter until the owner lifts it.
      if (wider && doc.actingLockedBy && !owner) refuse(403, 'owner_locked', `This slate's owner turned off acting without asking for ${doc.name} here. Only they can lift that.`)
      set.acting = actWithoutAsking === 'inherit' ? null : actWithoutAsking
      if (owner && !inviter) set.actingLockedBy = actWithoutAsking === 'off' ? principal.userId : null
      else if (owner) set.actingLockedBy = null
    }
    if (approvers !== undefined) {
      if (!APPROVERS.includes(approvers)) refuse(400, 'invalid_request', 'Choose inviter or editors.')
      set.approvers = approvers
    }
    if (!Object.keys(set).length) refuse(400, 'invalid_request', 'Send actWithoutAsking or approvers.')
    await connections.update(doc._id, { ...set, updatedAt: new Date(now()) })
    Object.assign(doc, set)
    const acting = actsWithoutAsking(doc, integration, found.slate)
    audit({ kind: 'act_without_asking', userId: principal.userId, connectionId: doc._id, acting: doc.acting ?? 'inherit', approvers: doc.approvers || 'inviter', byOwner: !inviter, ...(doc.actingLockedBy && { lockedByOwner: true }) })
    if (set.acting !== undefined) await recordSetting(principal, doc, acting ? `${doc.name} acts without asking here: its changes are made at once (destructive ones still wait).` : `${doc.name} asks first here: each change waits on a card.${set.actingLockedBy ? ' Set by this slate\'s owner.' : ''}`)
    if (set.approvers !== undefined) await recordSetting(principal, doc, set.approvers === 'editors' ? `Anyone who can edit may approve ${doc.name}'s changes here.` : `Only ${doc.inviterName || 'its inviter'} approves ${doc.name}'s changes here.`)
    return { connectionId: doc._id, actWithoutAsking: acting, acting: doc.acting === 'on' || doc.acting === 'off' ? doc.acting : 'inherit', approvers: APPROVERS.includes(doc.approvers) ? doc.approvers : 'inviter', lockedByOwner: Boolean(doc.actingLockedBy) }
  }

  /** On the Integrations page: whether this integration acts without asking on every slate (unless a slate says otherwise). */
  async function integrationSetActing(principal, { integrationId, actWithoutAsking }) {
    if (!principal?.userId || principal.kind !== 'person') refuse(403, 'person_required', 'Only a signed-in person changes how an agent acts.')
    const doc = await ownIntegration(principal, integrationId)
    if (typeof actWithoutAsking !== 'boolean') refuse(400, 'invalid_request', 'Send actWithoutAsking true or false.')
    await integrations.update(doc._id, { actWithoutAsking, updatedAt: new Date(now()) })
    doc.actWithoutAsking = actWithoutAsking
    audit({ kind: 'integration_act_without_asking', userId: principal.userId, integrationId: doc._id, actWithoutAsking })
    // It reaches only the slates its inviter owns (on anyone else's, acting without asking is set there, by name).
    for (const agent of await agentsOf(doc)) {
      if (agent.acting === 'on' || agent.acting === 'off') continue
      const found = await access.forUser(agent.shareId, principal.userId).catch(() => null)
      if (!found?.slate || found.slate.userId !== doc.ownerId) continue
      await recordSetting(principal, agent, actWithoutAsking ? `${agent.name} acts without asking (set for the integration): its changes are made at once (destructive ones still wait).` : `${agent.name} asks first (set for the integration): each change waits on a card.`)
    }
    return publicIntegration(doc, { cards: await gallery() })
  }

  /** connectors.outsideActions: a slate's action cards (newest first) and the act-without-asking changes, for anyone who can read it. */
  async function outsideList(principal, { shareId, connectionId }) {
    const { slate } = await requireReader(principal, shareId)
    const rows = (await outside.find({ slateId: slate._id })).filter((row) => !connectionId || row.connectionId === connectionId)
    for (const row of rows) if (row.kind === 'card') await settleStale(row)
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    const docs = await connections.find({ slateId: slate._id, status: { $ne: 'removed' } })
    const agents = []
    for (const doc of docs) agents.push({ connectionId: doc._id, agentId: doc.agentId || null, name: doc.name, actWithoutAsking: actsWithoutAsking(doc, await integrationOf(doc), slate), approvers: APPROVERS.includes(doc.approvers) ? doc.approvers : 'inviter', lockedByOwner: Boolean(doc.actingLockedBy), mine: doc.ownerId === principal.userId })
    return {
      cards: rows.filter((row) => row.kind === 'card').slice(0, 50).map((row) => publicCard(row, principal.userId)),
      activity: rows.filter((row) => row.kind === 'setting').slice(0, 50).map((row) => ({ connectionId: row.connectionId, agentId: row.agentId, text: row.text, by: row.by, at: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt })),
      agents,
    }
  }

  // Its waiting cards go with an agent that leaves a slate. → how many were being made right then
  // (those cannot be stopped: they finish, and their cards say how it went).
  async function declineWaiting(doc, principal) {
    let running = 0
    for (const card of await outside.find({ connectionId: doc._id })) {
      if (card.kind !== 'card') continue
      await declineRow(card, principal)
      if (card.state === 'running') running++
    }
    return running
  }

  // ---------- signing in ----------

  /** A popup sign-in for this person and server. → { flowId, authHost } (the signed-in page claims it at the start route) */
  async function startSignIn(principal, input) {
    return oneAtATime(principal, () => startSignInNow(principal, input))
  }

  async function startSignInNow(principal, { shareId, address: raw, clientId = null }) {
    await requirePerson(principal, shareId)
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
    await requirePerson(principal, shareId)
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
   * sign-in with no integration after a day (someone signed in and never connected).
   * credentialRows() -> [{ ownerId, address, createdAt }]
   */
  async function sweep(credentialRows) {
    let removed = 0
    for (const row of await credentialRows()) {
      const integration = await integrations.findOne({ ownerId: row.ownerId, address: row.address })
      const orphan = !integration && now() - new Date(row.createdAt).getTime() > AGENT_LIMITS.orphanHours * 3600000
      if (!orphan) continue
      await vault.remove(row.ownerId, row.address).catch(() => {})
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

  /** The Integrations page: each of this person's integrations, the slates it is on, and whether they may connect. */
  async function integrationsList(principal) {
    await requirePerson(principal)
    const cards = await gallery()
    const rows = await integrations.find({ ownerId: principal.userId })
    const out = []
    for (const doc of rows) {
      const agents = await agentsOf(doc)
      const slates = await slateList([...new Set(agents.map((a) => a.slateId))], principal.userId).catch(() => [])
      out.push(publicIntegration(doc, { slates, cards }))
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name)))
    return { integrations: out, rules: [...RULES] }
  }

  /**
   * Connect an MCP server once, from the Integrations page (no slate): after discovery (and its
   * sign-in), the person consents to its tools by their hashes. Connecting one already connected is
   * consenting again: every slate it is on resumes with that consent.
   */
  async function integrationConnect(principal, input) {
    return oneAtATime(principal, () => integrationConnectNow(principal, input))
  }

  async function integrationConnectNow(principal, { address: raw, name: rawName, tools: chosen = [], rule = null, replaces = null }) {
    await requirePerson(principal)
    const { address, host } = checkAddress(raw)
    const name = slateName(rawName, sanitizeName)
    if (!name) refuse(400, 'bad_name', 'Choose another name. Names can\'t say Slatebox, admin, support or a person\'s name.')
    if (rule !== null && !RULES.includes(rule)) refuse(400, 'invalid_request', 'Choose when it joins: when you invite it, or on every slate you own.')
    if (replaces) return replaceAddress(principal, { replaces, address, host, name, chosen, rule })
    const reached = await discoverAs(principal.userId, address)
    if (reached.needsSignIn) refuse(401, 'needs_sign_in', `Sign in to ${host} first.`)
    const stored = consented(name, await toolsFrom(address, reached.found.tools), chosen)
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

  /**
   * "Let it make changes too" for an agent connected at its card's read-only address: the person
   * signed in at the card's own address and consented to its tools there (hashes they saw), and the
   * integration moves to it in place. Its name, colour, rule and slates stay; each slate's copy moves
   * with it (a tool turned off on one slate stays off there); the read-only sign-in is removed.
   */
  async function replaceAddress(principal, { replaces, address, host, name, chosen, rule }) {
    const old = await ownIntegration(principal, replaces)
    const cards = await gallery()
    if ((old.kind || 'mcp') !== 'mcp' || canonicalAddress(writesAddress(old.address, cards)) !== address)
      refuse(400, 'invalid_request', `That is not where ${old.name} makes changes.`)
    if (await integrations.findOne({ ownerId: principal.userId, address }))
      refuse(409, 'already_connected', `You already connected ${host} as another integration. Disconnect one of them first.`)
    const reached = await discoverAs(principal.userId, address)
    if (reached.needsSignIn) refuse(401, 'needs_sign_in', `Sign in to ${host} first.`)
    const stored = consented(name, await toolsFrom(address, reached.found.tools), chosen)
    const described = reached.token ? await vault.describe(principal.userId, address) : null
    const auth = described ? { kind: described.kind, issuer: described.issuer } : null
    // The slates it is on, found by its old address before it moves.
    const agents = await agentsOf(old)
    const allowedBefore = new Set((old.tools || []).filter((tool) => tool.policy === 'allow').map((tool) => tool.name))
    const set = {
      address, host, name, tools: stored, auth, scopes: described?.scopes || [], status: 'active', changed: null,
      galleryId: cardFor(address, cards)?.id || old.galleryId || null, serverName: plainText(reached.found.serverInfo?.name || '', 60),
      ...(rule && { rule }), movedFrom: old.address, updatedAt: new Date(now()),
    }
    await integrations.update(old._id, set)
    const doc = Object.assign(old, set)
    // On each slate: a tool the person turned off there (while the integration allowed it) stays off.
    const turnOn = new Set(stored.filter((tool) => !allowedBefore.has(tool.name)).map((tool) => tool.name))
    await resumeEverywhere(doc, stored, { turnOn, agents, move: { address, host, auth } })
    const signedOut = vault ? (await vault.remove(principal.userId, set.movedFrom).catch(() => ({ removed: false }))).removed : false
    audit({ kind: 'integration_moved', userId: principal.userId, host, integrationId: doc._id, from: set.movedFrom, slates: agents.length, signedOut })
    return publicIntegration(doc, { cards })
  }

  /**
   * "Let it make changes too": turns on the changes its server offers that the person's consent has
   * off (an integration connected before agents read and write kept them off). Destructive ones stay
   * off. Only what the person consented to before, at the same hashes: a tool that changed since asks
   * for Review tools first. Every slate it is on follows.
   */
  async function integrationAllowChanges(principal, { integrationId }) {
    return oneAtATime(principal, async () => {
      const doc = await ownIntegration(principal, integrationId)
      if ((doc.kind || 'mcp') !== 'mcp') refuse(400, 'invalid_request', `${doc.name} has fixed tools.`)
      const cards = await gallery()
      if (writesAddress(doc.address, cards)) refuse(409, 'sign_in_at_full_address', `${doc.name} makes changes at its full address. Sign in there once more to let it.`, { address: writesAddress(doc.address, cards) })
      const reached = await discoverAs(principal.userId, doc.address)
      if (reached.needsSignIn) refuse(401, 'needs_sign_in', `${doc.name} needs you to sign in again first.`)
      const listed = new Map((await toolsFrom(doc.address, reached.found.tools)).map((tool) => [tool.name, tool]))
      if ((doc.tools || []).some((tool) => listed.has(tool.name) && listed.get(tool.name).hash !== tool.hash))
        refuse(409, 'tools_changed', `${doc.name}'s tools changed since you allowed them. Review its tools first.`)
      const turnOn = new Set((doc.tools || []).filter((tool) => tool.policy === 'off' && listed.get(tool.name)?.group === 'change' && !listed.get(tool.name)?.destructive).map((tool) => tool.name))
      if (!turnOn.size) refuse(400, 'nothing_to_turn_on', `${doc.name} has no changes to turn on. Its server may offer only lookups.`)
      const tools = doc.tools.map((tool) => (turnOn.has(tool.name) ? { ...tool, policy: 'allow' } : tool))
      await integrations.update(doc._id, { tools, updatedAt: new Date(now()) })
      doc.tools = tools
      await resumeEverywhere(doc, tools, { turnOn })
      audit({ kind: 'integration_allow_changes', userId: principal.userId, host: doc.host, integrationId: doc._id, turnedOn: [...turnOn] })
      return { ...publicIntegration(doc, { cards }), turnedOn: [...turnOn] }
    })
  }

  /** Review an integration's tools as its server lists them now: what changed since consent. */
  async function integrationReview(principal, { integrationId }) {
    return oneAtATime(principal, async () => {
      const doc = await ownIntegration(principal, integrationId)
      if (doc.kind !== 'mcp') refuse(400, 'invalid_request', `${doc.name} has fixed tools: there is nothing to review.`)
      const reached = await discoverAs(principal.userId, doc.address)
      if (reached.needsSignIn) {
        if (doc.status !== 'needs_sign_in') await integrations.update(doc._id, { status: 'needs_sign_in', updatedAt: new Date(now()) })
        return { integrationId: doc._id, address: doc.address, host: doc.host, needsSignIn: true, tools: [], changed: [] }
      }
      const listed = await toolsFrom(doc.address, reached.found.tools)
      const { changed } = reconcile(doc.tools, listed)
      const policyOf = new Map((doc.tools || []).map((tool) => [tool.name, tool]))
      return {
        integrationId: doc._id,
        address: doc.address,
        host: doc.host,
        name: doc.name,
        tools: listed.map(({ name, title, description, group, hash, annotations, destructive }) => {
          const before = policyOf.get(name)
          return { name, title, description, group, hash, annotations, ...(destructive && { destructive: true }), policy: before && before.hash === hash ? before.policy : defaultPolicy({ group, destructive }), ...(!before && { added: true }), ...(before && before.hash !== hash && { changed: true }) }
        }),
        changed: changed.map((c) => c.name),
        summary: capabilitySummary(listed),
      }
    })
  }

  /** Its standing rule: 'ask' (you invite it) or 'my_slates' (it joins every slate you own). */
  async function integrationSetRule(principal, { integrationId, rule }) {
    const doc = await ownIntegration(principal, integrationId)
    if (!RULES.includes(rule)) refuse(400, 'invalid_request', 'Choose when it joins: when you invite it, or on every slate you own.')
    await integrations.update(doc._id, { rule, updatedAt: new Date(now()) })
    doc.rule = rule
    audit({ kind: 'integration_rule', userId: principal.userId, integrationId: doc._id, rule })
    return publicIntegration(doc, { cards: await gallery() })
  }

  /**
   * Disconnect: removed from every slate (waiting suggestions discarded; kept work stays), the
   * sign-in revoked and forgotten. It always succeeds for the owner once the integration is theirs:
   * a step that only tidies up (the agent's ghosts, its presence, telling its server to end the
   * sign-in, what a native integration kept) is recorded when it fails and never keeps the
   * integration connected here. An integration no longer in the gallery disconnects the same way.
   */
  async function integrationDisconnect(principal, { integrationId }) {
    const doc = await ownIntegration(principal, integrationId)
    const failed = []
    // A tidy-up step: a throw (sync or async) or a missing promise is recorded, never raised.
    const tidy = async (step, fn) => {
      try {
        return await fn()
      } catch (error) {
        failed.push(step)
        audit({ kind: 'integration_disconnect_step_failed', userId: principal.userId, integrationId: doc._id, step, error: String(error?.message || error).slice(0, 200) })
        return undefined
      }
    }
    let removedFrom = 0
    let running = 0
    for (const agent of await agentsOf(doc)) {
      await connections.update(agent._id, { status: 'removed', removedBy: 'disconnect', updatedAt: new Date(now()) })
      removedFrom++
      const found = await tidy('slate', () => access.forUser(agent.shareId, principal.userId))
      if (found?.slate) {
        const agentId = agent.agentId || (await tidy('agent', () => suggestions.agentIdOf(connectorPrincipal(agent, 'remove:' + agent._id), found.slate)))
        if (agentId) await tidy('suggestions', () => suggestions.withdraw(principal, found.slate, agentId))
      }
      running += (await tidy('cards', () => declineWaiting(agent, principal))) || 0
      await tidy('presence', () => presence.end('hello:' + agent._id, 'done'))
    }
    let signedOut = false
    let note = null
    if (vault) {
      const out = await tidy('sign_in', () => vault.remove(doc.ownerId, doc.address))
      signedOut = Boolean(out?.removed)
      // Forgotten here either way; its server may still list Slatebox as allowed until revoked there.
      if (doc.auth && (!out || out.revokeFailed))
        note = `${doc.host} did not confirm that Slatebox's access ended. Slatebox forgot ${doc.name} here; you can also remove Slatebox's access in your ${doc.host} account settings.`
    }
    await tidy('forget', () => forget(doc))
    await integrations.remove(doc._id)
    audit({ kind: 'integration_disconnect', userId: principal.userId, host: doc.host, integrationId: doc._id, removedFrom, signedOut, ...(running && { running }), ...(failed.length && { failed }) })
    const say = running
      ? `${running === 1 ? 'One change was' : `${running} changes were`} already being made in ${doc.name} and could not be stopped: ${running === 1 ? 'its card says' : 'their cards say'} how it went.`
      : null
    return { ok: true, integrationId: doc._id, name: doc.name, removedFrom, signedOut, ...(running && { running, say }), ...(note && { note }) }
  }

  /**
   * The person's account is being removed (users.delete, a team owner deleting the team, an admin
   * removing a member): every integration they connected is disconnected as Disconnect does (off
   * every slate, waiting suggestions withdrawn, waiting cards declined, the sign-in revoked at its
   * server and forgotten), then every other sign-in they still hold (one they never connected) is
   * revoked and forgotten, and their agents' rows and action cards on any slate are removed.
   * Only their own: a teammate's integration, sign-in or agent on the same slates stays, and so does
   * a card a teammate's agent made at this person's request (it is the teammate's).
   * Best effort per step: nothing here throws, and a step that fails is recorded (never a token);
   * the caller removes the rows that are left whatever happened (server/integrations).
   * credentialRows(userId) -> [{ ownerId, address }]
   */
  async function forgetPerson(userId, { credentialRows = async () => [] } = {}) {
    const out = { disconnected: 0, signIns: 0, agents: 0, cards: 0, failed: [] }
    if (typeof userId !== 'string' || !userId) return out
    const principal = { kind: 'person', userId }
    const step = async (name, fn) => {
      try {
        return await fn()
      } catch (error) {
        out.failed.push(name)
        audit({ kind: 'account_integrations_step_failed', userId, step: name, error: String(error?.message || error).slice(0, 200) })
        return undefined
      }
    }
    for (const doc of (await step('list', () => integrations.find({ ownerId: userId }))) || []) {
      if (doc.ownerId !== userId) continue
      const gone = await step('disconnect', () => integrationDisconnect(principal, { integrationId: doc._id }))
      if (gone?.ok) out.disconnected++
      else await step('integration', () => integrations.remove(doc._id))
    }
    if (vault) {
      for (const row of (await step('sign_ins', () => credentialRows(userId))) || []) {
        if (row?.ownerId !== userId || typeof row.address !== 'string') continue
        if ((await step('sign_in', () => vault.remove(userId, row.address)))?.removed) out.signIns++
      }
    }
    if (connections.remove) {
      for (const doc of (await step('agents', () => connections.find({ ownerId: userId }))) || []) {
        if (doc.ownerId !== userId) continue
        // An agent still on a slate with no integration (from before integrations): taken off as
        // Remove does, its waiting suggestions withdrawn.
        if (doc.status !== 'removed') await step('agent_off', () => disconnect(principal, { connectionId: doc._id }))
        await step('agent', () => connections.remove(doc._id))
        out.agents++
      }
    }
    if (outside.remove) {
      for (const card of (await step('cards', () => outside.find({ ownerId: userId }))) || []) {
        if (card.ownerId !== userId) continue
        await step('card', () => outside.remove(card._id))
        out.cards++
      }
    }
    audit({ kind: 'account_integrations_removed', userId, disconnected: out.disconnected, signIns: out.signIns, agents: out.agents, cards: out.cards, ...(out.failed.length && { failed: out.failed }) })
    return out
  }

  // Puts an integration on a slate as a named agent: no sign-in and no consent again (the
  // integration's carry over). The slate's limits and its owner's choice still apply.
  async function placeOnSlate(principal, slate, integration, { by, contextLevel = null, name: rawName = null, view = null }) {
    if (!(await nativeOn(integration.address))) refuse(403, 'disabled', `${integration.name} is turned off on this server.`)
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
    await checkOutsideAgents(principal, slate)
    const integration = await ownIntegration(principal, integrationId)
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
    const rules = ruled.filter((row) => row.status === 'active')
    if ((await outsideAgentsOf(slate)) === 'off') return { joined: [], skipped: rules.map((row) => ({ integrationId: row._id, name: row.name, code: 'agents_off', why: 'Outside agents are turned off on this slate.' })) }
    // A slate anyone with its link may view: the agent's chip would show there to everyone, so a rule
    // never brings it; its owner invites it there themselves.
    if (slate.options?.isPublic || slate.options?.isUnlisted) return { joined: [], skipped: rules.map((row) => ({ integrationId: row._id, name: row.name, code: 'public_slate', why: 'Anyone with the link can view this slate, so it joins only when you invite it.' })) }
    const here = await connections.find({ slateId: slate._id })
    const joined = []
    const skipped = []
    for (const integration of rules) {
      // On this slate already, or removed from it before (remembered): nothing to do. A removal is
      // remembered by its server too, so one from before integrations existed, or from before a
      // reconnect, still holds (a whole-integration Disconnect is not a removal from this slate).
      if (here.some((doc) => doc.integrationId === integration._id)) continue
      if (here.some((doc) => doc.ownerId === principal.userId && canonicalAddress(doc.address) === integration.address && (doc.status !== 'removed' || doc.removedBy !== 'disconnect'))) continue
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

  /** A native integration connected again (Google): its agents resume on every slate with its tools. */
  /**
   * About you › "Use <tool> to personalize" (S3, 2026-11-26): a bounded, read-only look around one of
   * the person's own integrations, started by them. Its gallery card's lookAround steps run as fixed
   * calls (no planner), at most LOOK_LIMITS.calls, each with a tool they allowed that only looks
   * things up (a tool that changes anything is never called here, whatever they allowed), each answer
   * quarantined and capped. Nothing is saved and no model reads it here: the sample is outside data
   * for the profile.sources surface, which wraps it as data. → { ref, name, sample: [{ tool, text }] }
   */
  async function lookAround(principal, { ref } = {}) {
    await requirePerson(principal)
    return oneAtATime(principal, async () => {
      const cards = await gallery()
      const rows = await integrations.find({ ownerId: principal.userId })
      const doc = rows.find((row) => profileSource(row, cards)?.ref === ref) || null
      const anyStatus = doc || rows.find((row) => (row.galleryId || cardFor(row.address, cards)?.id) === ref) || null
      if (!doc && anyStatus?.status === 'needs_sign_in') refuse(401, 'needs_sign_in', `${anyStatus.name} needs you to sign in again on the Integrations page first.`)
      if (!doc) refuse(404, 'not_found', 'That tool is not connected, or Slatebox has nothing to read from it.')
      const recipe = checkRecipe(cardFor(doc.address, cards)?.recipe)
      const reached = await discoverAs(principal.userId, doc.address)
      if (reached.needsSignIn) {
        await integrations.update(doc._id, { status: 'needs_sign_in', updatedAt: new Date(now()) })
        refuse(401, 'needs_sign_in', `${doc.name} needs you to sign in again on the Integrations page first.`)
      }
      const toolsChanged = () => refuse(409, 'tools_changed', `${doc.name}'s tools changed since you connected it. Look at them on the Integrations page first.`)
      const listed = normalizeTools(reached.found.tools, recipe.tools || null)
      const { allowed, changed } = reconcile(doc.tools, listed)
      if (changed.length) toolsChanged()
      const lookups = allowed.filter((tool) => tool.group === 'lookup' && !tool.destructive && !isReferenceTool(tool, recipe))
      const names = new Set(lookups.map((tool) => tool.name))
      const toolOf = new Map(lookups.map((tool) => [tool.name, tool]))
      const check = (fresh) => {
        if (reconcile(doc.tools, normalizeTools(fresh, recipe.tools || null)).changed.length) toolsChanged()
      }
      const values = {}
      const sample = []
      let calls = 0
      let chars = 0
      for (const step of recipe.lookAround.steps) {
        if (calls >= LOOK_LIMITS.calls || chars >= LOOK_LIMITS.chars) break
        const tool = stepTool(step, names)
        if (!tool) continue
        const schema = toolOf.get(tool)?.inputSchema
        const [planned] = stepCalls({ ...step, tool }, values)
        if (!planned) continue
        const args = fitArgs(schema, planned.args)
        if (checkArguments(schema, args) || destructiveArgs(args)) continue
        calls++
        let raw
        try {
          raw = await session.callTool(doc.address, fetch, { name: tool, args, check }, { token: reached.token, ownerId: doc.ownerId })
        } catch (error) {
          if (error instanceof ConnectorRefused) throw error
          if (fromProblem(error)?.code === 'needs_sign_in') refuse(401, 'needs_sign_in', `${doc.name} needs you to sign in again on the Integrations page first.`)
          continue // one call that fails leaves the others' sample
        }
        const clean = quarantine(raw, { outputSchema: toolOf.get(tool)?.outputSchema })
        if (clean.isError) continue
        if (step.extract) for (const [name, list] of Object.entries(extract(rawData(raw), step.extract, rawText(raw)))) if (list.length && values[name] === undefined) values[name] = list
        const text = clean.text.slice(0, Math.min(LOOK_LIMITS.charsPerCall, LOOK_LIMITS.chars - chars)).trim()
        if (!text) continue
        sample.push({ tool, text })
        chars += text.length
      }
      audit({ kind: 'look_around', userId: principal.userId, host: doc.host, calls, chars })
      return { ref, name: doc.name, sample }
    })
  }

  async function resumeIntegration(integration) {
    if (!integration?._id) return
    await resumeEverywhere(integration, integration.tools || [])
  }

  return {
    lookAround,
    resumeIntegration,
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
    submissionOf,
    reviewProbe,
    integrationsList,
    integrationConnect,
    integrationReview,
    integrationAllowChanges,
    integrationSetRule,
    integrationDisconnect,
    forgetPerson,
    integrationInvite,
    applyRules,
    slateSetting,
    approve,
    decline,
    gate,
    setActing,
    integrationSetActing,
    outsideList,
  }
}
