// The agents on a slate's roster, from what the page receives: the live pointers
// (agentPresence.forSlate) and what agents suggested (agentSuggestions.forSlate). An agent is on
// the roster while it works here, while it has suggestions waiting, and for an hour after its last
// action (so its Undo stays at hand). Each agent's activity reads in plain words.

export const ROSTER_RECENT_MS = 60 * 60 * 1000

export const pendingCount = (action) => (action?.items || []).filter((item) => item.state === 'pending').length

/**
 * The presence records as the pointers draw them: each says whether what its agent suggested still waits on the slate for
 * Keep or Discard (waiting), so its tag says "Waiting for you" then, and never "Done" while its group is there.
 */
export function withWaiting(records = [], actions = []) {
  const waiting = new Set(actions.filter((action) => pendingCount(action) > 0).map((action) => action.agentId).filter(Boolean))
  return records.map((record) => ({ ...record, waiting: Boolean(record.agentId && waiting.has(record.agentId)) }))
}

const time = (value) => {
  const t = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(t) ? t : 0
}

/**
 * One entry per agent: its name and colour, its live record (if any), its actions and how many wait.
 * extras: agents that stay on the roster while they are on the slate, working or not (Slatebox
 * Cloud's invited agents: { agentId, label, colorIndex, invitedBy, state }), so each has one chip.
 */
export function agentsOnRoster(records = [], actions = [], now = Date.now(), extras = []) {
  const agents = new Map()
  const entry = (key, from) => {
    if (!agents.has(key))
      agents.set(key, {
        key, agentId: from.agentId ?? null, label: from.label, initial: from.initial, colorIndex: Number(from.colorIndex) || 0,
        origin: from.origin ?? null, via: from.via ?? null, invitedBy: from.invitedBy ?? null, iconUrl: from.iconUrl ?? null,
        record: null, actions: [], waiting: 0, live: false,
      })
    return agents.get(key)
  }
  for (const extra of extras || []) {
    if (!extra?.agentId) continue
    const agent = entry(extra.agentId, { origin: 'invited', ...extra })
    agent.state = extra.state ?? null
    agent.invited = true
  }
  for (const record of records) {
    const agent = entry(record.agentId || record.agentKey, record)
    if (!agent.record) agent.record = record
    agent.live = true
  }
  for (const action of actions) {
    if (!action?.agentId) continue
    const waiting = pendingCount(action)
    const known = agents.has(action.agentId)
    if (!known && !waiting && now - time(action.createdAt) > ROSTER_RECENT_MS) continue
    const agent = entry(action.agentId, action)
    agent.actions.push(action)
    agent.waiting += waiting
  }
  return [...agents.values()].sort((a, b) => Number(b.live) - Number(a.live))
}

const count = (items, state) => items.filter((item) => item.state === state).length
const deciders = (items, state) => [...new Set(items.filter((item) => item.state === state && item.decidedBy).map((item) => item.decidedBy))]

/** "2 new notes and 1 line · kept by Ada", "1 change · 1 waiting", "3 new notes, saved directly · undone". */
export function activityLine(action) {
  const items = action?.items || []
  const what = action?.summary || 'a change'
  if (action?.mode === 'direct') return `${what}, saved directly${action.undone ? ' · undone' : ''}`
  const parts = []
  const waiting = count(items, 'pending')
  if (waiting) parts.push(`${waiting} waiting`)
  const kept = count(items, 'kept')
  if (kept) parts.push(kept === items.length ? `kept${deciders(items, 'kept').length ? ' by ' + deciders(items, 'kept').join(', ') : ''}` : `${kept} kept`)
  const discarded = count(items, 'discarded')
  if (discarded) parts.push(discarded === items.length ? `discarded${deciders(items, 'discarded').length ? ' by ' + deciders(items, 'discarded').join(', ') : ''}` : `${discarded} discarded`)
  const undone = count(items, 'undone')
  if (undone) parts.push(undone === items.length ? 'undone' : `${undone} undone`)
  const refused = count(items, 'refused')
  if (refused) parts.push(`${refused} could not be kept`)
  return parts.length ? `${what} · ${parts.join(', ')}` : what
}
