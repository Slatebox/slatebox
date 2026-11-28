// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The sample Linear workspace the Linear recipes are tested against (scripts/fakes/linear-api.mjs
// answers Linear's GraphQL from it). Kept as a module so every file under enterprise/ carries its
// license line and the app never builds it.
//   2 initiatives (Checkout 2027, Growth), 9 projects over 3 teams (ENG, PAY, WEB)
//   4 cross-project blocking relations (6 blocking issues: PAY-11, PAY-12 and PAY-13 from Ledger v3 block Checkout v2),
//     plus one inside a project and one whose blocked issue is done (neither is a project edge)
//   ENG's active cycle 48: 30 issues, 4 blocked (2 by another team's issues), 3 added after it started
export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const ORG = uuid(1)
export const NOW = Date.UTC(2026, 10, 27, 12) // Nov 27, 2026: Q4 2026
export const TEAMS = Object.freeze({ ENG: { id: uuid(11), key: 'ENG', name: 'Engineering' }, PAY: { id: uuid(12), key: 'PAY', name: 'Payments' }, WEB: { id: uuid(13), key: 'WEB', name: 'Web' } })
export const INITIATIVES = Object.freeze({ checkout: { id: uuid(21), name: 'Checkout 2027' }, growth: { id: uuid(22), name: 'Growth' } })

const project = (n, name, { team, teams = [team], initiative, start, target, health = 'onTrack', status = 'started', lead = 'Ana', progress = 0.4, update = null, milestones = 2 }) => ({
  id: uuid(100 + n), name, url: `https://linear.app/acme/project/p${n}`, state: status, startDate: start, targetDate: target, health, progress, updatedAt: '2026-11-20T10:00:00.000Z',
  status: { type: status, name: status }, lead: { name: lead },
  teams: { nodes: teams.map((k) => TEAMS[k]) },
  initiatives: { nodes: initiative ? [INITIATIVES[initiative]] : [] },
  projectMilestones: { nodes: Array.from({ length: milestones }, (_, m) => ({ id: uuid(1000 + n * 20 + m), name: `M${m + 1}`, targetDate: target })) },
  projectUpdates: { nodes: update === null ? [] : [{ health, body: update.body, createdAt: update.at, url: `https://linear.app/acme/project/p${n}/updates/u${n}` }] },
})

export const PROJECTS = Object.freeze([
  project(1, 'Checkout v2', { team: 'WEB', initiative: 'checkout', start: '2026-10-01', target: '2026-12-19', health: 'atRisk', update: { body: 'Payment sheet slipped a week; waiting on ledger.', at: '2026-11-24T09:00:00.000Z' } }),
  project(2, 'Ledger v3', { team: 'PAY', initiative: 'checkout', start: '2026-09-15', target: '2026-12-05', health: 'offTrack', update: { body: 'Reconciliation bugs.', at: '2026-11-02T09:00:00.000Z' }, milestones: 14 }),
  project(3, 'Tax engine', { team: 'PAY', initiative: 'checkout', start: '2026-11-01', target: '2027-02-15', update: { body: 'On track.', at: '2026-11-25T09:00:00.000Z' } }),
  project(4, 'Saved cards', { team: 'WEB', teams: ['WEB', 'PAY'], initiative: 'checkout', start: '2026-12-01', target: '2027-03-30', status: 'planned' }),
  project(5, 'Fraud rules', { team: 'ENG', initiative: 'checkout', start: '2026-08-01', target: '2026-11-15', health: 'atRisk', update: { body: 'Rules shipped behind a flag.', at: '2026-11-20T09:00:00.000Z' } }),
  project(6, 'Referral program', { team: 'WEB', initiative: 'growth', start: '2026-10-15', target: '2026-12-12', update: { body: 'Design done.', at: '2026-11-26T09:00:00.000Z' } }),
  project(7, 'Onboarding emails', { team: 'ENG', initiative: 'growth', start: '2026-11-10', target: '2027-01-20', update: { body: 'Copy in review.', at: '2026-11-21T09:00:00.000Z' } }),
  project(8, 'Pricing page', { team: 'WEB', initiative: 'growth', start: null, target: null, status: 'backlog', health: null }),
  project(9, 'Usage analytics', { team: 'ENG', initiative: 'growth', start: '2027-01-05', target: '2027-06-30', status: 'planned', update: { body: 'Scoped.', at: '2026-10-01T09:00:00.000Z' } }),
])
export const P = Object.fromEntries(PROJECTS.map((p, n) => [`p${n + 1}`, p.id]))

let issueNo = 0
const blocker = (identifier, fromProject, toProject, blocked, { blockedDone = false, due = null } = {}) => ({
  id: uuid(5000 + ++issueNo), identifier, project: { id: fromProject }, dueDate: due,
  relations: { nodes: [{ type: 'blocks', relatedIssue: { id: uuid(6000 + issueNo), identifier: blocked, project: { id: toProject }, state: { type: blockedDone ? 'completed' : 'started' } } }] },
})
// Ledger v3 (p2) blocks Checkout v2 (p1) with 3 issues; Tax engine (p3) blocks Saved cards (p4);
// Fraud rules (p5) blocks Checkout v2 (p1); Referral program (p6) blocks Onboarding emails (p7).
export const BLOCKING_ISSUES = Object.freeze([
  blocker('PAY-11', P.p2, P.p1, 'WEB-31', { due: '2026-12-10' }),
  blocker('PAY-12', P.p2, P.p1, 'WEB-32'),
  blocker('PAY-13', P.p2, P.p1, 'WEB-33'),
  blocker('PAY-21', P.p3, P.p4, 'WEB-41'),
  blocker('ENG-51', P.p5, P.p1, 'WEB-34'),
  blocker('WEB-61', P.p6, P.p7, 'ENG-71'),
  blocker('PAY-14', P.p2, P.p2, 'PAY-15'), // inside one project: no edge
  blocker('WEB-62', P.p6, P.p8, 'WEB-81', { blockedDone: true }), // the blocked issue is done: no edge
])

// ENG cycle 48 (Nov 24 – Dec 7): 30 issues across 6 people (5 each), so 2 boards of at most 24.
export const STATES = Object.freeze([
  { id: uuid(31), name: 'Backlog', type: 'backlog', position: 0 }, { id: uuid(32), name: 'Todo', type: 'unstarted', position: 1 },
  { id: uuid(33), name: 'In Progress', type: 'started', position: 2 }, { id: uuid(34), name: 'In Review', type: 'started', position: 3 },
  { id: uuid(35), name: 'Done', type: 'completed', position: 4 }, { id: uuid(36), name: 'Canceled', type: 'canceled', position: 5 },
])
export const CYCLE = Object.freeze({ id: uuid(40), number: 48, name: null, startsAt: '2026-11-24T00:00:00.000Z', endsAt: '2026-12-07T23:59:59.000Z' })
const PEOPLE = ['Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay']
const stateAt = (n) => STATES[[1, 2, 3, 4, 1, 2][n % 6]]
export const CYCLE_ISSUES = Object.freeze(Array.from({ length: 30 }, (_, n) => ({
  id: uuid(7000 + n), identifier: `ENG-${200 + n}`, title: `Cycle task ${n + 1}`, url: `https://linear.app/acme/issue/ENG-${200 + n}`, priority: (n % 4) + 1, estimate: (n % 3) + 1,
  addedToCycleAt: n >= 27 ? '2026-11-26T10:00:00.000Z' : '2026-11-23T10:00:00.000Z',
  state: { id: stateAt(n).id, type: stateAt(n).type, name: stateAt(n).name }, assignee: { name: PEOPLE[n % 6] }, team: { id: TEAMS.ENG.id, key: 'ENG' }, parent: null,
  relations: { nodes: [] },
  // ENG-200 and ENG-201 wait on PAY issues (another team); ENG-202 waits on ENG-203; ENG-204 waits on a done ENG issue.
  inverseRelations: { nodes: n === 0 ? [{ type: 'blocks', issue: { id: uuid(8000), identifier: 'PAY-90', title: 'Ledger API', url: 'https://linear.app/acme/issue/PAY-90', team: { id: TEAMS.PAY.id, key: 'PAY' }, state: { type: 'started' } } }]
    : n === 1 ? [{ type: 'blocks', issue: { id: uuid(8001), identifier: 'PAY-91', title: 'Refund hook', url: 'https://linear.app/acme/issue/PAY-91', team: { id: TEAMS.PAY.id, key: 'PAY' }, state: { type: 'unstarted' } } }]
      : n === 2 ? [{ type: 'blocks', issue: { id: uuid(7003), identifier: 'ENG-203', title: 'Cycle task 4', url: 'https://linear.app/acme/issue/ENG-203', team: { id: TEAMS.ENG.id, key: 'ENG' }, state: { type: 'started' } } }]
        : n === 4 ? [{ type: 'blocks', issue: { id: uuid(8002), identifier: 'ENG-150', title: 'Old schema', url: 'https://linear.app/acme/issue/ENG-150', team: { id: TEAMS.ENG.id, key: 'ENG' }, state: { type: 'completed' } } }] : [] },
  attachments: { nodes: n === 5 ? [{ url: 'https://github.com/acme/platform/pull/42' }] : [] },
})))

// Issues a release names (by identifier in commit messages), for the release map.
export const RELEASE_ISSUES = Object.freeze({
  'ENG-201': { done: true, project: 'p5' }, 'ENG-202': { done: false, project: 'p5' }, 'WEB-31': { done: true, project: 'p1' }, 'PAY-11': { done: true, project: 'p2' }, 'WEB-77': { done: false, project: null },
})

export const STATE_IDS = Object.freeze(Object.fromEntries(STATES.map((s) => [s.name, s.id])))
