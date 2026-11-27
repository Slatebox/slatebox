// The canvas's bottom-left corner, beside Undo and Redo: one presence pill with the people on the slate
// (round avatars) and the agents on it (hexagons), the agents' menu (each agent's details, Agent tasks,
// + Invite agent, Pause all agents) and a badge when tasks wait. This turns what the page knows into
// what the pill shows, so every state (nobody else, many people, many agents, tasks, paused, a phone
// viewing only) is decided in one place and tested without a browser.

export const MAX_PEOPLE = 4
export const MAX_AGENTS = 3

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** "You, Ana Ruiz, Ben Ott and 3 more": the names a screen reader hears, never a list of 40. */
export function namesText(names, max = 5) {
  if (names.length <= max) return names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names.join('')
  return names.slice(0, max).join(', ') + ` and ${names.length - max} more`
}

/** What an agent's row says about it now: its own state (needs sign-in), paused, working. */
export function agentStatus(agent, paused) {
  if (agent.state) return agent.state
  if (paused) return 'paused'
  return agent.live ? 'working' : ''
}

/**
 * people: everyone here, this person first ({ key, name, color, you, speaking }).
 * agents: the agents on the roster ({ key, agentId, name, byline, state, live, waiting, colorIndex }).
 * tasks: { open, needYou } (zero for anyone who may not see tasks).
 * paused: the slate's agents are paused.
 * canEdit: this person may edit (Pause, Keep, Discard). canTasks: may see and ask agent tasks (signed in,
 * may edit). canInvite: the build has enterprise code and this person may invite (AgentsOnSlate says so).
 * presenceOnly: a phone viewing the slate, or an embed: who's here only, no controls.
 */
export function cornerModel({
  people = [], agents = [], tasks = { open: 0, needYou: 0 }, paused = false,
  canEdit = false, canTasks = false, canInvite = false, presenceOnly = false,
} = {}) {
  const open = Math.max(0, Number(tasks?.open) || 0)
  const needYou = Math.max(0, Number(tasks?.needYou) || 0)
  const menu = {
    tasks: !presenceOnly && canEdit && canTasks,
    invite: !presenceOnly && canEdit && canInvite,
    // Pause stops agents that are here; with none here and none paused it would do nothing.
    pause: !presenceOnly && canEdit && (agents.length > 0 || paused),
  }
  menu.pauseLabel = paused ? 'Resume agents' : 'Pause all agents'
  menu.tasksSummary = !open ? 'None open' : needYou ? `${open} open · ${needYou} need${needYou === 1 ? 's' : ''} you` : `${open} open`
  const anyItem = menu.tasks || menu.invite || menu.pause
  const rows = agents.map((agent) => {
    const status = agentStatus(agent, paused)
    const waiting = agent.waiting > 0 ? `${agent.waiting} waiting` : ''
    return {
      key: agent.key,
      agentId: agent.agentId || '',
      name: agent.name,
      byline: agent.byline || '',
      status,
      waiting,
      label: [agent.name, agent.byline, status, waiting].filter(Boolean).join(', '),
    }
  })
  // A phone, an embed, or someone who may not edit, alone with no agents: the pill would say only "You".
  const alone = people.length <= 1 && agents.length === 0
  const hidden = presenceOnly ? alone : false
  const badge = !menu.tasks ? null : needYou > 0 ? { kind: 'count', count: needYou } : open > 0 ? { kind: 'dot' } : null
  const agentLabel = ['Agents']
  agentLabel.push(agents.length ? `${agents.length} on this slate` : 'none on this slate yet')
  if (menu.tasks && needYou) agentLabel.push(`${plural(needYou, 'task needs', 'tasks need')} you`)
  else if (menu.tasks && open) agentLabel.push(`${plural(open, 'task', 'tasks')} open`)
  if (paused) agentLabel.push('paused')
  return {
    hidden,
    presenceOnly,
    people: {
      shown: people.slice(0, MAX_PEOPLE),
      more: Math.max(0, people.length - MAX_PEOPLE),
      count: people.length,
      label: `${plural(people.length, 'person', 'people')} here: ${namesText(people.map((p) => p.name))}`,
    },
    agents: {
      // Who may not edit sees agents only when there are some; who may edit always has the way in.
      show: agents.length > 0 || (!presenceOnly && anyItem),
      empty: agents.length === 0,
      shown: agents.slice(0, MAX_AGENTS),
      more: Math.max(0, agents.length - MAX_AGENTS),
      count: agents.length,
      paused: Boolean(paused) && agents.length > 0,
      // presenceOnly: the agents are part of who's here (one list); otherwise they open the agents' menu.
      menu: !presenceOnly,
      label: presenceOnly ? `${plural(agents.length, 'agent', 'agents')} here` : agentLabel.join(', '),
      badge,
    },
    rows,
    menu,
    // A phone viewing only: one button opens the read-only list of everyone here.
    list: presenceOnly ? `${people.length ? plural(people.length, 'person', 'people') : ''}${agents.length ? (people.length ? ' and ' : '') + plural(agents.length, 'agent', 'agents') : ''} here` : '',
  }
}

/** "Google Drive joined" / "Google Drive left", for the polite announcement as agents come and go. */
export function agentChanges(before, after) {
  const was = new Map(before.map((a) => [a.key, a.name]))
  const now = new Map(after.map((a) => [a.key, a.name]))
  const said = []
  for (const [key, name] of now) if (!was.has(key)) said.push(`${name} joined`)
  for (const [key, name] of was) if (!now.has(key)) said.push(`${name} left`)
  return said.join('. ')
}

/** Two letters for a person's avatar ("Y" for you). */
export function initialsOf(name, you = false) {
  if (you) return 'Y'
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase()
}
