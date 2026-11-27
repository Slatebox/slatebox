// The canvas's bottom-left presence pill (CornerPresence): what it shows in every state, decided by
// cornerModel. One calm pill beside Undo and Redo replaces the full-width strip, the floating
// "+ Invite agent", the dashed agent chips with their loose Pause button, and the separate Agent tasks pill.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { agentChanges, cornerModel, initialsOf, namesText } from '../web/app/imports/api/common/corner-model.mjs'

const you = { key: 'you', name: 'You', you: true }
const PEOPLE = [you, ...['Ana Ruiz', 'Ben Ott', 'Chen Li', 'Dee Park', 'Eli Moss'].map((name) => ({ key: name, name }))]
const AGENTS = [
  { key: 'g', agentId: 'g', name: 'Google Drive', byline: 'added by you', live: true, waiting: 0 },
  { key: 's', agentId: 's', name: 'Slatebox agent', byline: '', live: false, waiting: 2 },
  { key: 'h', agentId: 'h', name: 'GitHub', byline: 'added by Ana Ruiz', state: 'needs sign-in', waiting: 0 },
  { key: 'u', agentId: 'u', name: 'HubSpot', byline: 'added by Ben Ott', live: true, waiting: 0 },
  { key: 'a', agentId: 'a', name: 'Asana', byline: 'added by you', live: true, waiting: 0 },
]
const editor = { canEdit: true, canTasks: true, canInvite: true }
const src = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('empty: just you and no agents; an editor gets "+ Agents" with its menu, a non-editor no agent group', () => {
  const m = cornerModel({ people: [you], ...editor })
  assert.equal(m.hidden, false)
  assert.deepEqual(m.people.shown.map((p) => p.name), ['You'])
  assert.equal(m.people.more, 0)
  assert.equal(m.people.label, '1 person here: You')
  assert.equal(m.agents.show, true)
  assert.equal(m.agents.empty, true)
  assert.equal(m.agents.label, 'Agents, none on this slate yet')
  // Pause would do nothing with no agents: never an item that does nothing.
  assert.deepEqual([m.menu.tasks, m.menu.invite, m.menu.pause], [true, true, false])
  const viewer = cornerModel({ people: [you] })
  assert.equal(viewer.agents.show, false)
  assert.deepEqual([viewer.menu.tasks, viewer.menu.invite, viewer.menu.pause], [false, false, false])
  // A build without enterprise code has no Invite; a guest who may edit has no tasks.
  const guest = cornerModel({ people: [you], canEdit: true, canTasks: false, canInvite: false })
  assert.equal(guest.agents.show, false, 'nothing in the menu and no agents: no agent group')
})

test('one agent: its hexagon and the caret; its row says who added it and what it is doing', () => {
  const m = cornerModel({ people: [you], agents: AGENTS.slice(0, 1), ...editor })
  assert.equal(m.agents.shown.length, 1)
  assert.equal(m.agents.more, 0)
  assert.equal(m.agents.empty, false)
  assert.equal(m.agents.label, 'Agents, 1 on this slate')
  assert.deepEqual(m.rows[0], { key: 'g', agentId: 'g', name: 'Google Drive', byline: 'added by you', status: 'working', waiting: '', label: 'Google Drive, added by you, working' })
  assert.equal(m.menu.pause, true)
  assert.equal(m.menu.pauseLabel, 'Pause all agents')
})

test('6 people and 5 agents: 4 avatars + 2, 3 hexagons + 2, all within the one pill', () => {
  const m = cornerModel({ people: PEOPLE, agents: AGENTS, ...editor })
  assert.deepEqual(m.people.shown.map((p) => p.name), ['You', 'Ana Ruiz', 'Ben Ott', 'Chen Li'])
  assert.equal(m.people.more, 2)
  assert.equal(m.people.label, '6 people here: You, Ana Ruiz, Ben Ott, Chen Li, Dee Park and 1 more')
  assert.equal(m.agents.shown.length, 3)
  assert.equal(m.agents.more, 2)
  assert.equal(m.rows.length, 5, 'every agent has its row in the menu')
  assert.equal(m.rows[1].waiting, '2 waiting')
  assert.equal(m.rows[2].status, 'needs sign-in')
})

test('tasks: a count badge when tasks need you, a neutral dot when some are open, never a separate pill', () => {
  const need = cornerModel({ people: [you], agents: AGENTS.slice(0, 2), tasks: { open: 3, needYou: 2 }, ...editor })
  assert.deepEqual(need.agents.badge, { kind: 'count', count: 2 })
  assert.equal(need.agents.label, 'Agents, 2 on this slate, 2 tasks need you')
  assert.equal(need.menu.tasksSummary, '3 open · 2 need you')
  const open = cornerModel({ people: [you], agents: AGENTS.slice(0, 2), tasks: { open: 1, needYou: 0 }, ...editor })
  assert.deepEqual(open.agents.badge, { kind: 'dot' })
  assert.equal(open.menu.tasksSummary, '1 open')
  assert.equal(open.agents.label, 'Agents, 2 on this slate, 1 task open')
  assert.equal(cornerModel({ people: [you], ...editor }).agents.badge, null)
  assert.equal(cornerModel({ people: [you], ...editor }).menu.tasksSummary, 'None open')
  // Who may not see tasks never sees their badge.
  assert.equal(cornerModel({ people: [you], agents: AGENTS, tasks: { open: 3, needYou: 2 }, canEdit: true }).agents.badge, null)
})

test('paused: the tag, Resume agents in the menu, every row says paused; who may not edit sees the tag only', () => {
  const m = cornerModel({ people: [you], agents: AGENTS.slice(0, 3), paused: true, ...editor })
  assert.equal(m.agents.paused, true)
  assert.equal(m.menu.pauseLabel, 'Resume agents')
  assert.equal(m.agents.label, 'Agents, 3 on this slate, paused')
  assert.deepEqual(m.rows.map((r) => r.status), ['paused', 'paused', 'needs sign-in'])
  const viewer = cornerModel({ people: [you], agents: AGENTS.slice(0, 3), paused: true })
  assert.equal(viewer.agents.paused, true)
  assert.deepEqual([viewer.menu.tasks, viewer.menu.invite, viewer.menu.pause], [false, false, false])
  // Paused with every agent gone: Resume stays reachable for an editor.
  assert.equal(cornerModel({ people: [you], paused: true, canEdit: true }).menu.pause, true)
})

test('a phone viewing only: people and agents in one read-only list, no invite, pause or tasks; hidden when alone', () => {
  const m = cornerModel({ people: PEOPLE.slice(0, 3), agents: AGENTS.slice(0, 2), tasks: { open: 2, needYou: 2 }, presenceOnly: true, ...editor })
  assert.equal(m.hidden, false)
  assert.equal(m.agents.menu, false)
  assert.equal(m.agents.badge, null)
  assert.deepEqual([m.menu.tasks, m.menu.invite, m.menu.pause], [false, false, false])
  assert.equal(m.list, '3 people and 2 agents here')
  assert.equal(m.agents.label, '2 agents here')
  assert.equal(m.rows[0].byline, 'added by you', 'each agent and who added it')
  assert.equal(cornerModel({ people: [you], presenceOnly: true }).hidden, true)
  assert.equal(cornerModel({ people: [you], agents: AGENTS.slice(0, 1), presenceOnly: true }).list, '1 person and 1 agent here')
})

test('words: names for a screen reader, joins and leaves announced, initials', () => {
  assert.equal(namesText(['You']), 'You')
  assert.equal(namesText(['You', 'Ana Ruiz']), 'You and Ana Ruiz')
  assert.equal(agentChanges([], [{ key: 'g', name: 'Google Drive' }]), 'Google Drive joined')
  assert.equal(agentChanges([{ key: 'g', name: 'Google Drive' }], []), 'Google Drive left')
  assert.equal(agentChanges([{ key: 'g', name: 'Google Drive' }], [{ key: 'g', name: 'Google Drive' }]), '')
  assert.equal(initialsOf('You', true), 'Y')
  assert.equal(initialsOf('Ana Ruiz'), 'AR')
  assert.equal(initialsOf('ben'), 'BE')
})

test('the corner is one pill: no full-width strip, no hard border, no floating Invite or Agent tasks pill', () => {
  const corner = src('web/app/imports/ui/components/presence/CornerPresence.jsx')
  assert.match(corner, /role="group"/)
  assert.match(corner, /aria-label="On this slate"/)
  assert.match(corner, /var\(--sb-undo-redo-end/)
  assert.match(corner, /var\(--sb-canvas-bottom/)
  const menu = src('web/app/imports/ui/components/presence/AgentsMenu.jsx')
  // A real menu (MUI Menu: arrow keys, Escape, focus back to the trigger) holding every agent control.
  assert.match(menu, /<Menu id=\{id\}/)
  for (const marker of ['data-agents-pause=""', 'data-agent-tasks-open=""', 'data-invite-agent-open=""', 'data-agent-chip=""', 'data-agent-id={row.agentId}']) assert.ok(menu.includes(marker), marker)
  assert.match(src('web/app/imports/ui/components/presence/AgentStack.jsx'), /data-agents-menu-open=""/)
  const listener = src('web/app/imports/ui/components/AgentPresenceListener.jsx')
  assert.doesNotMatch(listener, /export function AgentChips/)
  assert.doesNotMatch(listener, /borderStyle: 'dashed'/)
  assert.match(listener, /export function AgentDetails/)
  const users = src('web/app/imports/ui/components/CollaborationUsers.jsx')
  const huddle = src('web/app/imports/ui/components/huddle/CollaborationHuddle.jsx')
  for (const file of [users, huddle]) {
    assert.doesNotMatch(file, /borderTop: '1px solid black'/)
    assert.doesNotMatch(file, /AgentChips/)
  }
  const tasks = src('web/app/imports/ui/components/AgentTasksPanel.jsx')
  assert.doesNotMatch(tasks, /position: 'fixed'/)
  assert.match(tasks, /export function useAgentTasks/)
  const invite = src('enterprise/client/AgentsOnSlate.jsx')
  assert.doesNotMatch(invite, /position: 'fixed'/)
  assert.match(invite, /inviteRequestAtom/)
  const canvas = src('web/app/imports/ui/pages/Canvas.jsx')
  assert.match(canvas, /<CornerPresence/)
  assert.doesNotMatch(canvas, /<AgentTasksPanel/)
})
