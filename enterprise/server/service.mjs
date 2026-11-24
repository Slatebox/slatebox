// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Outside agents on a slate (Slatebox as an MCP client), without Meteor: the stores, the network,
// the models, the registry and presence are passed in (meteor.js wires the real ones; the tests
// pass fakes).
//
//   discover   reach the address (mcpFetch), list its tools, say in plain words what it can do
//   connect    invite it onto one slate: the name it wears, the tools it may use (consent is to
//              each tool's hash), what it may see. Only open servers in S2a.
//   call       the inviter asks it something. Slatebox's model plans the lookups, the calls run,
//              the results are quarantined, a quarantined model lays them out, and each group
//              appears on the slate as a live ghost (broadcast to everyone on the slate) while
//              the agent's named cursor moves to it.
//   keep       anyone who can edit the slate keeps a ghost (or all): it is saved as the agent
//              ("<name> · added by <inviter>"), one save per ghost, so each is one undo step.
//   discard    anyone who can edit the slate discards a ghost (or all).
//   disconnect the inviter removes the agent; its waiting ghosts go with it.
//
// Rules every entry point enforces (owner decisions 2026-11-23): Cloud only and the invite switch
// on (the loader registers nothing otherwise); the inviter needs Slatebox Pro (checked on every
// discover, connect and call, not only in the browser); only the inviter can call the agent;
// everyone who can read the slate sees its cursor and ghosts; the person who keeps must be able
// to edit the slate, and so must the inviter.
import { randomBytes } from 'node:crypto'
import { canonicalAddress, cardFor, DEAD_HOSTS, lookalikeHost } from '../common/gallery.mjs'
import { checkMcpUrl, McpFetchRefused } from './mcp-fetch.mjs'
import { capabilitySummary, defaultPolicy, normalizeTools, plainText, POLICIES, reconcile } from './tools.mjs'
import { quarantine } from './results.mjs'
import { CONTEXT_LEVELS, packContext } from './context.mjs'
import {
  checkLayout, checkPlan, excalidrawElements, excalidrawGroup, itemsFromLayout, LAYOUT_TOOL, linksIn, PLAN_LIMITS, PLAN_TOOL, planPrompt, translatePrompt,
} from './translate.mjs'

export const AGENT_LIMITS = Object.freeze({ perSlate: 8, perOwnerPerSlate: 3, ghostHours: 24, beatMs: 450, requestChars: 1000, nameChars: 32 })

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

export const PRO_REQUIRED = 'Inviting agents onto your slates is part of Slatebox Pro.'

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
    name: doc.name,
    colorIndex: doc.colorIndex ?? 1,
    invitedBy: doc.inviterName || '',
    host: doc.host,
    status: doc.status,
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
  suggestions, // { insert(doc), findOne(query), update(id, set), pushItem(id, item), setItem(id, n, set), removeForConnection(id) }
  fetch, // mcpFetch
  session, // { discover(address, fetch), callTool(address, fetch, { name, args, check }) }
  model, // async ({ feature, tool, system, user, userId, shareId }) -> the tool call's arguments (object), inside the metered request
  metered = (fn) => fn(), // (fn, { userId, shareId }) runs fn inside one metered AI request (runAIAction)
  applyOperations, // async (principal, { shareId, plan, expectedRevision }, mode) -> { body }
  canvasOf, // (slate, writes, shareId) -> preview artwork { nodes, links } | null
  access, // { forUser(shareId, userId) -> { slate, canRead, canEdit } | null, reload(shareId) -> slate }
  pro, // async (userId) -> boolean
  firstName, // async (userId) -> string
  sanitizeName, // agent-label.mjs sanitizeClientName
  presence, // { plan(principal, slate, steps), step(principal, slate, index, status), saved(principal, slate, { targets, message }), end(runId, outcome) }
  devOrigins = [],
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  audit = () => {},
}) {
  async function requireEditor(principal, shareId) {
    if (!principal?.userId || principal.kind === 'guest' || principal.kind === 'visitor')
      refuse(401, 'sign_in', 'Save your account to invite agents.')
    const found = await access.forUser(shareId, principal.userId)
    if (!found?.slate || !found.canRead) refuse(404, 'not_found', 'Slate not found or unavailable.')
    if (!found.canEdit) refuse(403, 'forbidden', 'Only people who can edit this slate can do that.')
    return found.slate
  }
  async function requirePro(userId) {
    if (!(await pro(userId))) refuse(402, 'pro_required', PRO_REQUIRED)
  }
  async function requireReader(principal, shareId) {
    const found = principal?.userId ? await access.forUser(shareId, principal.userId) : null
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

  async function discover(principal, { shareId, address: raw }) {
    await requireEditor(principal, shareId)
    await requirePro(principal.userId)
    const { address, host } = checkAddress(raw)
    let found
    try {
      found = await session.discover(address, fetch)
    } catch (error) {
      throw fromProblem(error)
    }
    const tools = normalizeTools(found.tools)
    if (!tools.length) refuse(422, 'no_tools', `${host} answered, but offers no tools Slatebox can use.`)
    const card = cardFor(address)
    audit({ kind: 'discover', userId: principal.userId, host, tools: tools.length })
    return {
      address,
      host,
      lookalike: lookalikeHost(address),
      card: card ? { id: card.id, name: card.name } : null,
      // Self-reported: shown as the server's claim, never used as the name on the slate.
      serverName: plainText(found.serverInfo?.title || found.serverInfo?.name || '', 60),
      suggestedName: slateName(card?.name || found.serverInfo?.title || found.serverInfo?.name || host.split('.').slice(-2, -1)[0] || 'Agent', sanitizeName) || 'Agent',
      tools: tools.map(({ name, title, description, group, hash, annotations }) => ({ name, title, description, group, hash, annotations, policy: defaultPolicy({ group }) })),
      summary: capabilitySummary(tools),
    }
  }

  async function connect(principal, { shareId, address: raw, name: rawName, tools: chosen = [], contextLevel = 'request' }) {
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
    // Consent is to what the server says now: the hashes the person saw must still be the server's.
    let found
    try {
      found = await session.discover(address, fetch)
    } catch (error) {
      throw fromProblem(error)
    }
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
      // One agent colour on its cursor, chip and ghosts (0 is the Slatebox agent's).
      colorIndex: 1 + (randomBytes(1)[0] % 5),
      status: 'active',
      createdAt: new Date(now()),
      updatedAt: new Date(now()),
    }
    await connections.insert(doc)
    audit({ kind: 'connect', userId: principal.userId, host, connectionId: doc._id })
    // It arrives: its cursor says hello once, to everyone on the slate.
    const hello = connectorPrincipal(doc, 'hello:' + doc._id)
    await presence.saved(hello, slate, { targets: [], message: `Hi, I'm ${name}. Select notes and ask me.` }).catch(() => {})
    return publicConnection(doc, principal.userId)
  }

  async function list(principal, { shareId }) {
    const { slate } = await requireReader(principal, shareId)
    const docs = await connections.find({ slateId: slate._id, status: { $ne: 'removed' } })
    return { connections: docs.map((doc) => publicConnection(doc, principal.userId)), pro: principal.userId ? await pro(principal.userId) : false }
  }

  async function ownConnection(principal, connectionId) {
    const doc = typeof connectionId === 'string' ? await connections.findOne({ _id: connectionId }) : null
    if (!doc || doc.status === 'removed') refuse(404, 'not_found', 'That agent is not on this slate any more.')
    // DECISION 1: only the person who invited an agent can call it, change it or remove it.
    if (doc.ownerId !== principal.userId) refuse(403, 'inviter_only', `Only ${doc.inviterName || 'the person who invited it'} can ask ${doc.name}.`)
    return doc
  }

  async function disconnect(principal, { connectionId }) {
    const doc = await ownConnection(principal, connectionId)
    await connections.update(doc._id, { status: 'removed', updatedAt: new Date(now()) })
    await suggestions.removeForConnection(doc._id)
    audit({ kind: 'disconnect', userId: principal.userId, host: doc.host, connectionId: doc._id })
    return { ok: true, connectionId: doc._id }
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

  async function call(principal, { connectionId, request, selection = [] }) {
    const doc = await ownConnection(principal, connectionId)
    const slate = await requireEditor(principal, doc.shareId)
    await requirePro(principal.userId)
    if (doc.status === 'paused') refuse(409, 'tools_changed', `${doc.name}'s tools changed since you invited it. Look at the changes before asking again.`, { changed: (doc.changed || []).map((c) => c.name) })
    const text = plainText(request, AGENT_LIMITS.requestChars)
    if (!text) refuse(400, 'invalid_request', `Ask ${doc.name} something.`)
    const ids = Array.isArray(selection) ? selection.filter((id) => typeof id === 'string').slice(0, 60) : []
    const runId = newId('r')
    const agent = connectorPrincipal(doc, runId)
    const suggestionId = newId('s')
    const expiresAt = new Date(now() + AGENT_LIMITS.ghostHours * 3600000)
    await suggestions.insert({
      _id: suggestionId, slateId: slate._id, shareId: slate.shareId, connectionId: doc._id, runId, name: doc.name,
      inviterName: doc.inviterName, ownerId: doc.ownerId, request: text, status: 'working', say: '', items: [], left: [],
      createdAt: new Date(now()), expiresAt,
    })
    let outcome = 'stopped'
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
        try {
          found = await session.discover(doc.address, fetch)
          check(found.tools)
        } catch (error) {
          if (error?.code === 'tools_changed') {
            await connections.update(doc._id, { status: 'paused', changed: error.changes, updatedAt: new Date(now()) })
            throw error
          }
          throw fromProblem(error)
        }
        const { allowed } = reconcile(doc.tools, listedTools)
        if (!allowed.length) refuse(409, 'no_tools', `${doc.name} has nothing it may look up. Invite it again to choose.`)
        const toolOf = new Map(allowed.map((tool) => [tool.name, tool]))
        const entries = []
        let say = ''
        for (let round = 0; round < PLAN_LIMITS.rounds; round++) {
          const { system, user } = planPrompt({ serverName: doc.name, tools: allowed, packed, previous: entries })
          const planned = checkPlan(await model({ feature: 'connectors', tool: PLAN_TOOL, system, user, userId: principal.userId, shareId: slate.shareId }), allowed)
          say = say || planned.say
          if (!planned.calls.length) break
          for (const { tool, args } of planned.calls) {
            let raw
            try {
              raw = await session.callTool(doc.address, fetch, { name: tool, args, check })
            } catch (error) {
              if (error?.code === 'tools_changed') {
                await connections.update(doc._id, { status: 'paused', changed: error.changes, updatedAt: new Date(now()) })
                throw error
              }
              throw fromProblem(error)
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
          const { system, user } = translatePrompt({ serverName: doc.name, packed, entries: rest })
          let layout = { groups: [], say: '' }
          try {
            layout = checkLayout(await model({ feature: 'connectors', tool: LAYOUT_TOOL, system, user, userId: principal.userId, shareId: slate.shareId }), { aliases: packed.aliases, allowedLinks: linksIn(rest) })
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
      await suggestions.update(suggestionId, { say: plainText(result.say, 240), left })
      await presence.step(agent, slate, 2, 'doing').catch(() => {})
      // Each group appears on the slate as it is ready, and the cursor goes to it.
      const items = itemsFromLayout({ groups: result.groups, slate, aliases: packed.aliases, selection: ids, serverName: doc.name })
      let n = 0
      for (const item of items) {
        let previewed
        try {
          previewed = await applyOperations(agent, { shareId: slate.shareId, plan: item.plan, expectedRevision: slate.revision ?? 0 }, 'preview')
        } catch {
          continue
        }
        const writes = [{ n: 1, method: 'slates.applyOperations', input: { shareId: slate.shareId, plan: item.plan }, body: previewed.body }]
        const canvas = canvasOf(slate, writes, slate.shareId)
        if (!canvas) continue
        n++
        await suggestions.pushItem(suggestionId, { n, label: item.label, plan: item.plan, created: item.created, frame: item.frame, canvas, status: 'pending' })
        await presence.saved(agent, slate, { targets: item.created.map((id) => 'ghost-' + id), message: `Suggests: ${item.label}` }).catch(() => {})
        await sleep(AGENT_LIMITS.beatMs)
      }
      await suggestions.update(suggestionId, { status: n ? 'ready' : 'empty' })
      outcome = 'done'
      return { suggestionId, items: n, say: plainText(result.say, 240), left }
    } catch (error) {
      await suggestions.update(suggestionId, { status: 'failed', say: plainText(error?.message || 'That did not work.', 240) }).catch(() => {})
      throw fromProblem(error)
    } finally {
      await presence.end(runId, outcome).catch(() => {})
    }
  }

  async function decide(principal, { suggestionId, n = null }, keep) {
    const doc = typeof suggestionId === 'string' ? await suggestions.findOne({ _id: suggestionId }) : null
    if (!doc) refuse(404, 'not_found', 'Those suggestions are gone.')
    const slate = await requireEditor(principal, doc.shareId)
    if (slate._id !== doc.slateId) refuse(404, 'not_found', 'Those suggestions are gone.')
    const chosen = doc.items.filter((item) => item.status === 'pending' && (n === null || item.n === n))
    if (!chosen.length) refuse(409, 'already_decided', n === null ? 'Nothing is waiting here.' : 'Someone already kept or discarded that.')
    if (!keep) {
      for (const item of chosen) await suggestions.setItem(doc._id, item.n, { status: 'discarded', by: principal.userId })
      return { ok: true, kept: 0, discarded: chosen.length }
    }
    const connection = await connections.findOne({ _id: doc.connectionId })
    if (!connection || connection.status === 'removed') refuse(404, 'not_found', 'That agent is not on this slate any more.')
    // The agent writes with its inviter's rights: the inviter must still be able to edit here.
    const inviterAccess = await access.forUser(doc.shareId, connection.ownerId)
    if (!inviterAccess?.canEdit) refuse(403, 'forbidden', `${connection.inviterName || 'The person who invited it'} can no longer edit this slate, so ${connection.name}'s suggestions can't be kept.`)
    const runId = newId('k')
    const agent = connectorPrincipal(connection, runId)
    let kept = 0
    let outcome = 'stopped'
    try {
      for (const item of chosen) {
        // Claim it first, so two people keeping at once save it once.
        const claimed = await suggestions.setItem(doc._id, item.n, { status: 'keeping', by: principal.userId }, 'pending')
        if (!claimed) continue
        const current = await access.reload(doc.shareId)
        try {
          await applyOperations(agent, { shareId: doc.shareId, plan: item.plan, expectedRevision: current?.revision ?? 0 }, 'save')
        } catch (error) {
          await suggestions.setItem(doc._id, item.n, { status: 'pending' }).catch(() => {})
          if (error?.code === 'no_match') refuse(409, 'slate_changed', 'A note this suggestion connects to is gone. Discard it instead.')
          throw error
        }
        await suggestions.setItem(doc._id, item.n, { status: 'kept', by: principal.userId })
        kept++
        if (chosen.length > 1) await sleep(AGENT_LIMITS.beatMs)
      }
      outcome = 'done'
    } finally {
      await presence.end(runId, outcome).catch(() => {})
    }
    return { ok: true, kept, discarded: 0 }
  }

  return {
    discover,
    connect,
    list,
    disconnect,
    call,
    keep: (principal, input) => decide(principal, input, true),
    discard: (principal, input) => decide(principal, input, false),
  }
}
