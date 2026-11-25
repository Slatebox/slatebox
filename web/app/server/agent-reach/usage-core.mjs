// Agent clients: which agents reach Slatebox and what they call. Counts only, never what was
// asked or returned: per day, surface (mcp: the hosted /mcp; api: /api/v1, which the local
// slatebox-mcp package, the CLI and scripts use) and client, the connections (an MCP initialize)
// and tool calls, and the calls per tool. A client is named by what it says about itself: MCP
// initialize's clientInfo.name/version on /mcp, the User-Agent's first product on /api/v1.
// Beside that, each account's first recorded action (through the app, or which agent) once, so
// the overview can count the new accounts that came by an agent.
//
// Pure: the Meteor glue (usage-meteor.js) hands in the collections; the tests hand in fakes.

export const DAY_MS = 86_400_000
export const SURFACES = Object.freeze(['mcp', 'api'])
export const UNKNOWN_CLIENT = 'unknown'
const TOOL = /^[a-z][a-z0-9_]{0,63}$/

/** A client's name as stored: printable, at most 60 characters, never an address or key-shaped. */
export function cleanClient(name, version = null) {
  if (typeof name !== 'string') return UNKNOWN_CLIENT
  let text = name.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim()
  // nothing that looks like contact details or a secret
  if (!text || /@|https?:|\b(?:sk|rk|pk)[-_][A-Za-z0-9]{6,}/i.test(text)) return UNKNOWN_CLIENT
  text = text.replace(/[^\p{L}\p{N} ._+\-()/]/gu, '').trim()
  if (!text) return UNKNOWN_CLIENT
  const v = typeof version === 'string' ? version.trim().replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 20) : ''
  return (v ? `${text.slice(0, 38)} ${v}` : text).slice(0, 60)
}

/**
 * The client a User-Agent names: its first product token ("slatebox-mcp/0.3.5 node/22" ->
 * "slatebox-mcp 0.3.5"). Browsers are "browser"; nothing is "unknown".
 */
export function clientFromUserAgent(ua) {
  if (typeof ua !== 'string' || !ua.trim()) return UNKNOWN_CLIENT
  const text = ua.trim()
  if (/^Mozilla\//.test(text) && /(Chrome|Safari|Firefox|Edg)\//.test(text)) return 'browser'
  const match = /^([A-Za-z0-9][A-Za-z0-9._+-]{0,40})(?:\/([0-9A-Za-z.+-]{1,20}))?/.exec(text)
  return match ? cleanClient(match[1], match[2] ?? null) : UNKNOWN_CLIENT
}

export const dayOf = (at) => new Date(at).toISOString().slice(0, 10)
export const toolKey = (tool) => (typeof tool === 'string' && TOOL.test(tool) ? tool : null)

/**
 * The recorder. days: the per-day collection (raw Mongo), firsts: one row per account. now() in ms.
 * remembered: how many accounts this process keeps as already having a first action (so a busy
 * agent costs no extra write per call).
 */
export function createAgentUsage({ days, firsts, now = () => Date.now(), remembered = 5000, log = console }) {
  const known = new Set()

  async function bump({ surface, client, connection = false, tool = null }) {
    if (!SURFACES.includes(surface)) return
    const name = cleanClient(client)
    const at = now()
    const day = dayOf(at)
    const inc = connection ? { connections: 1 } : { calls: 1 }
    const key = toolKey(tool)
    if (!connection && key) inc[`tools.${key}`] = 1
    await days.updateOne(
      { _id: `${day}|${surface}|${name}` },
      { $inc: inc, $setOnInsert: { day, surface, client: name, at: new Date(Date.parse(`${day}T00:00:00Z`)) } },
      { upsert: true },
    )
  }

  async function noteFirst({ userId, via, client = null }) {
    if (typeof userId !== 'string' || !userId || known.has(userId)) return
    const agent = via !== 'app'
    try {
      await firsts.updateOne(
        { _id: userId },
        { $setOnInsert: { via: agent ? 'agent' : 'app', surface: agent ? via : null, client: agent ? cleanClient(client) : null, at: new Date(now()) } },
        { upsert: true },
      )
    } catch (error) {
      // a duplicate key from a race is the row already there
      if (error?.code !== 11000) throw error
    }
    known.add(userId)
    if (known.size > remembered) known.delete(known.values().next().value)
  }

  // Recording never fails the request it counts.
  const safely = (fn) => async (event) => {
    try {
      await fn(event)
    } catch (error) {
      log.warn?.(`agent-usage: not recorded (${error?.message})`)
    }
  }

  return {
    /** An MCP initialize: one connection for this client. */
    connection: safely(({ surface = 'mcp', client }) => bump({ surface, client, connection: true })),
    /** One tool call (a typed tool, exec or describe on /mcp; an action on /api/v1). */
    call: safely(({ surface, client, tool }) => bump({ surface, client, tool })),
    /** The first recorded action of an account: via 'app', 'mcp' or 'api'. */
    first: safely(noteFirst),
  }
}

/**
 * The overview card: the last 7 days against the 7 before, from the day rows, and the new
 * accounts whose first recorded action was an agent's.
 * io: { days(sinceDate) -> rows, newAccounts(sinceDate) -> [{_id, createdAt}], firsts(ids) -> rows }
 */
export async function agentSummary({ io, now = Date.now(), topTools = 8, topClients = 10 }) {
  const today = Date.parse(`${dayOf(now)}T00:00:00Z`)
  const weekStart = today - 6 * DAY_MS
  const prevStart = weekStart - 7 * DAY_MS
  const rows = await io.days(new Date(prevStart))
  const clients = new Map()
  const tools = new Map()
  const totals = { connections: 0, calls: 0, prevConnections: 0, prevCalls: 0 }
  for (const row of rows) {
    const at = Date.parse(`${row.day}T00:00:00Z`)
    const current = at >= weekStart
    const c = clients.get(row.client) || { client: row.client, surfaces: new Set(), connections: 0, calls: 0, prevCalls: 0 }
    if (current) {
      c.connections += row.connections || 0
      c.calls += row.calls || 0
      c.surfaces.add(row.surface)
      totals.connections += row.connections || 0
      totals.calls += row.calls || 0
      for (const [name, n] of Object.entries(row.tools || {})) tools.set(name, (tools.get(name) || 0) + n)
    } else {
      c.prevCalls += row.calls || 0
      totals.prevConnections += row.connections || 0
      totals.prevCalls += row.calls || 0
    }
    clients.set(row.client, c)
  }
  const accounts = await io.newAccounts(new Date(weekStart))
  const firsts = accounts.length ? await io.firsts(accounts.map((a) => a._id)) : []
  const viaAgent = firsts.filter((f) => f.via === 'agent')
  const byClient = new Map()
  for (const f of viaAgent) byClient.set(f.client || UNKNOWN_CLIENT, (byClient.get(f.client || UNKNOWN_CLIENT) || 0) + 1)
  return {
    since: new Date(weekStart).toISOString().slice(0, 10),
    totals,
    clients: [...clients.values()]
      .filter((c) => c.connections || c.calls)
      .sort((a, b) => b.calls - a.calls || b.connections - a.connections || a.client.localeCompare(b.client))
      .slice(0, topClients)
      .map((c) => ({ client: c.client, surfaces: [...c.surfaces].sort(), connections: c.connections, calls: c.calls, prevCalls: c.prevCalls })),
    tools: [...tools.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, topTools).map(([tool, calls]) => ({ tool, calls })),
    newAccounts: {
      total: accounts.length,
      viaAgent: viaAgent.length,
      byClient: [...byClient.entries()].sort((a, b) => b[1] - a[1]).map(([client, accounts]) => ({ client, accounts })),
    },
  }
}

export async function ensureAgentUsageIndexes({ days, firsts }) {
  // a year of day rows is plenty for weekly trends
  await days.createIndex({ at: 1 }, { expireAfterSeconds: 400 * 86400 })
  await firsts.createIndex({ at: 1 })
}
