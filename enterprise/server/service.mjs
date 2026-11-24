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
//   call       the inviter asks it something. Slatebox's model plans the lookups, the calls run,
//              the results are quarantined, a quarantined model lays them out, and each group is
//              saved as the agent through slates.applyOperations, where an agent's canvas edit
//              becomes a live suggestion (server/agents/suggestions.mjs): ghosts everyone on the
//              slate sees as they appear, the agent's named cursor moving to each.
//              Keeping, discarding and undoing are the app's own suggestions.decide (Keep and
//              Discard on each ghost, Keep all / Discard all on the agent's chip, Undo per action),
//              by anyone who can edit the slate; an agent a person lets edit directly saves at once.
//   disconnect the inviter removes the agent; its waiting suggestions are discarded, and when no
//              other slate of theirs uses that server, its sign-in is revoked and forgotten.
//
// Rules every entry point enforces (owner decisions 2026-11-23/24): enterprise code unlocked
// (Slatebox Cloud, or a licensed self-hosted install) and the kill switch off (the loader registers
// nothing otherwise); on Cloud the inviter needs Slatebox Pro (checked on every discover, connect
// and call, not only in the browser; a licensed install has no Pro, so `pro` answers true there); only the inviter can call the agent;
// everyone who can read the slate sees its cursor and ghosts; the person who keeps must be able
// to edit the slate.
import { randomBytes } from 'node:crypto'
import { sameAgentName } from '/imports/api/common/agent-mention.mjs'
import { canonicalAddress, cardFor, DEAD_HOSTS, lookalikeHost } from '../common/gallery.mjs'
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
  checkLayout, checkPlan, excalidrawElements, excalidrawGroup, itemsFromLayout, layoutTool, linksIn, PLAN_LIMITS, planPrompt, planTool, translatePrompt,
} from './translate.mjs'

export const AGENT_LIMITS = Object.freeze({ perSlate: 8, perOwnerPerSlate: 3, beatMs: 450, requestChars: 1000, nameChars: 32, proEndedDays: 30, orphanHours: 24, concurrentPerUser: 3, helloMs: 8000 })

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

/** What anyone who can read the slate sees of an agent; the inviter also sees its tools. */
export function publicConnection(doc, viewerId) {
  const mine = doc.ownerId === viewerId
  return {
    connectionId: doc._id,
    // The agent's id on this slate: its suggestions and activity are filed under it (suggestions.list).
    agentId: doc.agentId || null,
    name: doc.name,
    colorIndex: doc.colorIndex ?? 1,
    invitedBy: doc.inviterName || '',
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
  async function requirePro(userId) {
    if (!(await pro(userId))) refuse(402, 'pro_required', PRO_REQUIRED)
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

  async function discoverNow(principal, { shareId, address: raw }) {
    await requireEditor(principal, shareId)
    await requirePro(principal.userId)
    const { address, host } = checkAddress(raw)
    const card = cardFor(address)
    const head = { address, host, lookalike: lookalikeHost(address), card: card ? { id: card.id, name: card.name } : null }
    const reached = await discoverAs(principal.userId, address)
    if (reached.needsSignIn) {
      const plan = await signInPlan(address)
      audit({ kind: 'discover', userId: principal.userId, host, signIn: plan.method })
      return { ...head, suggestedName: slateName(card?.name || host.split('.').slice(-2, -1)[0] || 'Agent', sanitizeName) || 'Agent', signIn: { ...plan, again: reached.again }, tools: [], summary: null }
    }
    const { found } = reached
    const tools = normalizeTools(found.tools)
    if (!tools.length) refuse(422, 'no_tools', `${host} answered, but offers no tools Slatebox can use.`)
    const signedIn = reached.token ? await vault.describe(principal.userId, address) : null
    // Signed in again: this person's agents on this server that were waiting for it can be asked.
    if (reached.token) for (const doc of await connections.find({ ownerId: principal.userId, address, status: 'needs_sign_in' })) await setStatus(doc, 'active')
    audit({ kind: 'discover', userId: principal.userId, host, tools: tools.length })
    return {
      ...head,
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

  async function connectNow(principal, { shareId, address: raw, name: rawName, tools: chosen = [], contextLevel = 'request', view = null }) {
    const slate = await requireEditor(principal, shareId)
    await requirePro(principal.userId)
    const { address, host } = checkAddress(raw)
    if (!CONTEXT_LEVELS.includes(contextLevel)) refuse(400, 'invalid_request', 'Choose what the agent may see.')
    const name = slateName(rawName, sanitizeName)
    if (!name) refuse(400, 'bad_name', 'Choose another name. Names can\'t say Slatebox, admin, support or a person\'s name.')
    const live = await connections.find({ slateId: slate._id, status: { $ne: 'removed' } })
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
    const tools = normalizeTools(found.tools)
    const seen = new Map((Array.isArray(chosen) ? chosen : []).map((entry) => [entry?.name, entry]))
    const stored = tools.map((tool) => {
      const choice = seen.get(tool.name)
      if (choice && choice.hash !== tool.hash) refuse(409, 'tools_changed', `${name}'s tools changed while you were choosing. Look at them again.`)
      const policy = choice && POLICIES.includes(choice.policy) && tool.group === 'lookup' ? choice.policy : choice ? 'off' : defaultPolicy(tool)
      return { name: tool.name, title: tool.title, description: tool.description, group: tool.group, hash: tool.hash, policy }
    })
    if (!stored.some((tool) => tool.policy === 'allow')) refuse(400, 'no_tools', 'Allow at least one thing it may look up.')
    const doc = {
      _id: newId('c'),
      ownerId: principal.userId,
      inviterName: await firstName(principal.userId),
      slateId: slate._id,
      shareId: slate.shareId,
      name,
      address,
      host,
      serverName: plainText(found.serverInfo?.name || '', 60),
      tools: stored,
      contextLevel,
      mode: 'suggest',
      // The inviter's own sign-in to this server (the vault holds it; the connection never does).
      auth: auth ? { kind: auth.kind, issuer: auth.issuer } : null,
      // One agent colour on its cursor, chip and ghosts (0 is the Slatebox agent's).
      colorIndex: 1 + (randomBytes(1)[0] % 5),
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
    return { connections: docs.map((doc) => publicConnection(doc, principal.userId)), pro: isPro }
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
    await connections.update(doc._id, { status: 'removed', updatedAt: new Date(now()) })
    // Its suggestions still waiting go with it (discarded by the inviter; kept work stays, undoable).
    const found = await access.forUser(doc.shareId, principal.userId).catch(() => null)
    if (found?.slate) {
      const agentId = doc.agentId || (await suggestions.agentIdOf(connectorPrincipal(doc, 'remove:' + doc._id), found.slate))
      await suggestions.withdraw(principal, found.slate, agentId).catch(() => {})
    }
    await presence.end('hello:' + doc._id, 'done').catch(() => {})
    // Its sign-in goes too (revoked at the server when it offers that), unless another of this
    // person's slates still has an agent on the same server.
    let signedOut = false
    if (vault) {
      const others = await connections.find({ ownerId: doc.ownerId, address: doc.address, status: { $ne: 'removed' } })
      if (!others.some((other) => other._id !== doc._id)) signedOut = (await vault.remove(doc.ownerId, doc.address).catch(() => ({ removed: false }))).removed
    }
    audit({ kind: 'disconnect', userId: principal.userId, host: doc.host, connectionId: doc._id, signedOut, ...(doc.ownerId !== principal.userId && { byOwner: true }) })
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

  async function callNow(principal, { connectionId, request, selection = [], view = null }) {
    const doc = await ownConnection(principal, connectionId)
    const slate = await requireEditor(principal, doc.shareId)
    if (!(await pro(principal.userId))) {
      await setStatus(doc, 'pro_ended')
      refuse(402, 'pro_required', PRO_REQUIRED)
    }
    // Paused: refused before anything reaches the outside server or the model. The asker can edit
    // the slate, so they may resume agents themselves.
    if (await suggestions.paused?.(slate)) refuse(423, 'agents_paused', `Agents are paused on this slate. Resume agents to ask ${doc.name}.`)
    if (doc.status === 'paused') refuse(409, 'tools_changed', `${doc.name}'s tools changed since you invited it. Look at the changes before asking again.`, { changed: (doc.changed || []).map((c) => c.name) })
    const text = plainText(request, AGENT_LIMITS.requestChars)
    if (!text) refuse(400, 'invalid_request', `Ask ${doc.name} something.`)
    const ids = Array.isArray(selection) ? selection.filter((id) => typeof id === 'string').slice(0, 60) : []
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
            const error = new ConnectorRefused(409, 'tools_changed', `${doc.name}'s tools changed since you invited it. Look at the changes before asking again.`, { changed: changed.map((c) => c.name) })
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
            await connections.update(doc._id, { status: 'paused', changed: error.changes, updatedAt: new Date(now()) })
            throw error
          }
          throw fromSignIn(error)
        }
        if (doc.status !== 'active') await setStatus(doc, 'active')
        const { allowed } = reconcile(doc.tools, listedTools)
        if (!allowed.length) refuse(409, 'no_tools', `${doc.name} has nothing it may look up. Invite it again to choose.`)
        const toolOf = new Map(allowed.map((tool) => [tool.name, tool]))
        const entries = []
        let say = ''
        for (let round = 0; round < PLAN_LIMITS.rounds; round++) {
          const { system, user } = planPrompt({ serverName: doc.name, tools: allowed, packed, previous: entries, text: promptOf })
          const planned = checkPlan(await model({ feature: 'connectors', tool: planTool(promptOf), system, user, userId: principal.userId, shareId: slate.shareId }), allowed)
          say = say || planned.say
          if (!planned.calls.length) break
          for (const { tool, args } of planned.calls) {
            let raw
            try {
              raw = await session.callTool(doc.address, fetch, { name: tool, args, check }, { token })
            } catch (error) {
              if (error?.code === 'tools_changed') {
                await connections.update(doc._id, { status: 'paused', changed: error.changes, updatedAt: new Date(now()) })
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
            entries.push({ tool, args, result: clean })
          }
          if (planned.done) break
        }
        if (!entries.length) return { groups: [], say: say || `${doc.name} had nothing to look up for that.`, entries }
        await presence.step(agent, slate, 1, 'doing').catch(() => {})
        // Diagrams by the fixed recipe; everything else through the quarantined translator.
        const groups = []
        const rest = []
        for (const entry of entries) {
          const elements = excalidrawElements(entry)
          const group = elements && excalidrawGroup(elements, 'Diagram')
          if (group) groups.push(group)
          else if (!entry.result.isError) rest.push(entry)
        }
        if (rest.length && (rest.some((e) => e.result.text) || rest.some((e) => e.result.links.length))) {
          const { system, user } = translatePrompt({ serverName: doc.name, packed, entries: rest, text: promptOf })
          let layout = { groups: [], say: '' }
          try {
            layout = checkLayout(await model({ feature: 'connectors', tool: layoutTool(promptOf), system, user, userId: principal.userId, shareId: slate.shareId }), { aliases: packed.aliases, allowedLinks: linksIn(rest) })
          } catch (error) {
            if (error instanceof ConnectorRefused) throw error
          }
          groups.push(...(layout.groups.length ? layout.groups : plainLayout(rest)))
          say = layout.say || say
        }
        const errors = entries.filter((entry) => entry.result.isError)
        if (!groups.length && errors.length) say = `${doc.name} couldn't find results for that.`
        return { groups, say, entries }
      }, { userId: principal.userId, shareId: slate.shareId })
      const left = [...new Set(result.entries.flatMap((entry) => entry.result.left))]
      await presence.step(agent, slate, 2, 'doing').catch(() => {})
      // Each group is saved as the agent as soon as it is ready: the app files it as a live
      // suggestion (ghosts on every screen, the cursor moving to them), or saves it at once when a
      // person lets this agent edit directly. One action per group, so each is one Undo.
      const items = itemsFromLayout({ groups: result.groups, slate, aliases: packed.aliases, selection: ids, serverName: doc.name, view: viewOf(view) })
      const actions = []
      let saved = 0
      let dropped = 0
      // One save of a group; a person editing meanwhile moves the revision, so a refused save is
      // tried once more against the fresh slate before it is counted as not placed.
      const place = async (item) => {
        const current = await access.reload(slate.shareId)
        return applyOperations(agent, { shareId: slate.shareId, plan: item.plan, expectedRevision: current?.revision ?? slate.revision ?? 0 }, 'save')
      }
      for (const item of items) {
        let answer = null
        for (let attempt = 0; attempt < 2 && !answer; attempt++) {
          try {
            answer = await place(item)
          } catch (error) {
            // People on the slate paused its agents: stop, and say so in their words.
            if (error?.code === 'agents_paused') refuse(423, 'agents_paused', `Agents are paused on this slate. Resume agents to ask ${doc.name}.`)
            answer = null
          }
        }
        if (answer?.body?.suggestion?.actionId) actions.push(answer.body.suggestion.actionId)
        else if (answer?.body?.outcome === 'saved') saved++
        else {
          dropped++
          continue
        }
        await sleep(AGENT_LIMITS.beatMs)
      }
      if (dropped) left.push(`${dropped} ${dropped === 1 ? 'group' : 'groups'} could not be placed. Ask again to try ${dropped === 1 ? 'it' : 'them'}.`)
      outcome = 'done'
      return { items: actions.length + saved, actions, saved, say: plainText(result.say, 240), left }
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
    await requireEditor(principal, shareId)
    await requirePro(principal.userId)
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
    await requireEditor(principal, shareId)
    await requirePro(principal.userId)
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
   * Housekeeping (hourly): sign-ins nobody uses are forgotten (and revoked): those with no agent on
   * any slate after a day, and those of agents whose inviter's Pro ended 30 days ago.
   * credentialRows() -> [{ ownerId, address, createdAt }]
   */
  async function sweep(credentialRows) {
    let removed = 0
    for (const row of await credentialRows()) {
      const live = await connections.find({ ownerId: row.ownerId, address: row.address, status: { $ne: 'removed' } })
      const orphan = !live.length && now() - new Date(row.createdAt).getTime() > AGENT_LIMITS.orphanHours * 3600000
      const lapsed = live.length > 0 && live.every((doc) => doc.status === 'pro_ended' && now() - new Date(doc.updatedAt).getTime() > AGENT_LIMITS.proEndedDays * 86400000)
      if (orphan || lapsed) {
        await vault.remove(row.ownerId, row.address).catch(() => {})
        removed++
      }
    }
    return { removed }
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
  }
}
