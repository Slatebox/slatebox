// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One cycle run, per team: its current cycle with every issue, their blockers and the team's
// statuses (1 Linear call per 100 issues), then that cycle's slate. A new cycle is a new slate; the
// last one is left as it was (history). 0 tokens.
//
// Between runs the cursor keeps, per cycle, each issue's status (so an issue Linear moved is
// reclaimed: a card a person moved follows Linear again), the issues seen (removed since), the
// boards drawn and which issues are on each (an issue stays on its board), and, per issue a person
// moved, the lane they moved it to with Linear's status type then (held). A card a person moved to
// another lane, on an issue Linear has not moved since that move, is proposed as one status change
// in Linear (linear.update_item: the first status of that lane). The runtime makes it only under the
// person's permission, else it waits on an approval card. Linear wins: once Linear moves the issue,
// the move is never proposed again (even on a card that stays the person's because they also renamed
// it) until the person moves the card again, and its waiting approval cards are retired.
// Only the card on the board the issue is drawn on counts (a copy left on another board does not).
import { plain } from '../_shared/text.mjs'
import { CYCLE_LANES, firstStateOf, cycleLaneOf, keyOf } from '../_linear/workgraph.mjs'
import { cycleKey, cycleSlate } from './render.mjs'

const MAX_WRITES = 20

export default async function run(ctx) {
  const config = { subIssues: false, ...ctx.instance.config }
  const linear = ctx.vendor.linear
  const now = ctx.now()
  const cursor = ctx.instance.cursor || {}
  const cycles = { ...(cursor.cycles || {}) }
  let org = cursor.org || null
  const slates = []
  const writes = []
  const retire = []
  const done = []

  for (const teamId of config.teams) {
    const got = await linear.activeCycle(teamId)
    if (!got.cycle) {
      ctx.log('info', 'no_cycle', `${got.team?.key || 'A team'} has no cycle running now.`)
      continue
    }
    if (!got.complete) ctx.log('warn', 'big_cycle', `${got.team.key}'s cycle has more than 600 issues: the first 600 are drawn.`)
    const { team, cycle } = got
    const key = cycleKey(team, cycle)
    org = org || /^https:\/\/linear\.app\/([a-z0-9-]+)\//i.exec(cycle.issues.find((i) => i.url)?.url || '')?.[1] || 'ws'
    const before = cycles[key] || null
    // by identifier (ENG-212: short, so a big cycle's memory stays small)
    const states = Object.fromEntries(cycle.issues.map((i) => [i.identifier, i.state.type]))
    const reclaim = new Set(before ? cycle.issues.filter((i) => before.states?.[i.identifier] && before.states[i.identifier] !== i.state.type).map((i) => i.id) : [])
    const removed = before ? Object.keys(before.states || {}).filter((id) => !(id in states)) : []
    // removed since the cycle started: taken out at some point and not back in it now
    const removedSince = [...new Set([...(before?.removed || []), ...removed])].filter((id) => !(id in states))
    const drawn = cycleSlate({ org, team, cycle, now, reclaim, removed: removedSince, subIssues: config.subIssues, placed: before?.placed || null })
    const boardKeys = drawn.slate.boards.map((b) => b.key)
    for (const gone of before?.boards || []) if (!boardKeys.includes(gone)) drawn.slate.boards.push({ key: gone, component: 'team-board', title: 'Moved to another board', lanes: drawn.slate.boards[0]?.lanes || [], cards: [] })
    slates.push(drawn.slate)

    // A person moved a card, and Linear has not moved that issue since: propose the status change.
    // held[identifier] = [lane the person moved it to, Linear's status type then] ('!' once Linear moved it).
    const held = Object.fromEntries(Object.entries(before?.held || {}).filter(([id]) => id in states))
    const keysOf = (issue, except = null) => CYCLE_LANES.map((l) => l.key).filter((k) => k !== except).map((k) => `state:${issue.id}:${k}`)
    if (before && typeof ctx.slates.boardState === 'function') {
      const board = await ctx.slates.boardState('cycle', key)
      const byKey = new Map(cycle.issues.map((i) => [keyOf(org, 'issue', i.id), i]))
      const drawnOn = new Map(Object.entries(drawn.placement).flatMap(([k, ids]) => ids.map((id) => [id, k])))
      for (const b of board || []) for (const card of b.cards || []) {
        const issue = byKey.get(card.key)
        if (!issue || drawnOn.get(issue.identifier) !== b.key) continue
        const was = held[issue.identifier]
        if (card.owner !== 'person' || !card.lane || card.lane === cycleLaneOf(issue.state.type)) {
          // the card is with Linear again: nothing of that move is still waiting
          if (was) {
            retire.push(...keysOf(issue))
            delete held[issue.identifier]
          }
          continue
        }
        if (reclaim.has(issue.id)) {
          // Linear moved the issue since: Linear wins, until the person moves the card again
          held[issue.identifier] = [card.lane, '!']
          retire.push(...keysOf(issue))
          continue
        }
        if (was && was[0] === card.lane && was[1] !== issue.state.type) continue
        const state = firstStateOf(team.states, card.lane)
        if (!state || writes.length >= MAX_WRITES) continue
        if (was && was[0] !== card.lane) retire.push(...keysOf(issue, card.lane))
        held[issue.identifier] = [card.lane, issue.state.type]
        writes.push({ kind: 'linear.update_item', target: { issueId: issue.id, teamId: team.id, identifier: issue.identifier }, body: { stateId: state.id }, key: `state:${issue.id}:${card.lane}`, summary: plain(`Move ${issue.identifier} to ${state.name} in Linear`, 120) })
      }
    }

    // Events: newly blocked issues, scope that moved since the last run.
    const wasBlocked = new Set(before?.blocked || [])
    for (const b of drawn.blocked.filter((x) => !wasBlocked.has(x.issue)).slice(0, 20)) ctx.emit('cycle.blocked', { issue: b.issue, blockedBy: b.blockedBy.slice(0, 10) })
    const newlyAdded = drawn.added.filter((id) => !(before?.added || []).includes(id))
    if (before && (newlyAdded.length || removed.length)) ctx.emit('cycle.scope_changed', { cycle: key, added: newlyAdded.length, removed: removed.length })
    const moved = before ? cycle.issues.filter((i) => before.states?.[i.identifier] !== i.state.type).length : cycle.issues.length
    if (moved || removed.length) ctx.emit('cycle.updated', { cycle: key, issues: cycle.issues.length, changed: moved, removed: removed.length })

    cycles[key] = { states, removed: removedSince.slice(-200), boards: boardKeys, placed: drawn.placement, held, blocked: drawn.blocked.map((b) => b.issue), added: drawn.added, at: now }
    done.push(`${key}: ${drawn.issues.length} issues, ${drawn.blocked.length} blocked`)
  }

  // Keep the memory of the cycles running now and of the one before each (a closed cycle's slate is never redrawn).
  // A cycle not drawn this run keeps no placement or held moves (its slate is not drawn again).
  const keep = Object.entries(cycles).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, Math.max(2, config.teams.length * 2))
    .map(([k, c]) => [k, c.at === now ? c : { ...c, placed: undefined, held: undefined }])
  ctx.setCursor({ org: org || 'ws', cycles: Object.fromEntries(keep) })
  return { desired: { slates }, writes, retire: [...new Set(retire)].slice(0, 200), summary: done.length ? done.join('; ') : 'No cycle running now.', source: 'Linear' }
}
