// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// "<recipe> status": a real slate in the project, kept by the runtime, that says what the recipe
// is doing in Slatebox's own words: who it runs for, whether it is on, its last run, its next run,
// the slates it keeps (link notes), changes outside Slatebox waiting for approval, and the last
// problem. Built as a DesiredSet entry, so it is reconciled like any recipe slate (a person may
// add notes to it; the runtime only ever touches its own).
import { PAUSE_REASON_WORDS, RUN_STATE_WORDS, SKIP_WORDS, STATE_WORDS, WRITE_WORDS, runsFor } from '../../common/recipes/words.mjs'
import { targetLine } from './permissions.mjs'

export const STATUS_ROLE = 'status'
const when = (at, tz = 'UTC') => (at ? new Date(at).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) : null)

/**
 * The status slate's DesiredSet entry.
 *   slates   [{ name, shareId }] the recipe keeps
 *   cards    waiting approvals [{ kind, target }]
 *   origin   the app's address, for links
 */
export function statusDesired({ instance, manifest, ownerFirstName = null, lastRun = null, slates = [], cards = [], origin = '', tz = 'UTC' }) {
  const nodes = []
  const edges = []
  const state = STATE_WORDS[instance.state] || instance.state
  nodes.push({ key: 'who', text: `${runsFor(manifest.agentName, ownerFirstName)}\n${manifest.label}: ${state}`, shape: 'roundedrectangle', colors: { backgroundColor: '#1f2a44', foregroundColor: '#ffffff' } })
  const paused = instance.state === 'paused' && instance.pausedReason ? PAUSE_REASON_WORDS[instance.pausedReason] || null : null
  if (paused) nodes.push({ key: 'paused', text: paused, colors: { backgroundColor: '#fde2e1', foregroundColor: '#5c1a16' } })
  if (lastRun) {
    const outcome = RUN_STATE_WORDS[lastRun.state] || lastRun.state
    const changed = (lastRun.stats?.added || 0) + (lastRun.stats?.updated || 0) + (lastRun.stats?.removed || 0)
    const skip = lastRun.skippedReason ? ` (${SKIP_WORDS[lastRun.skippedReason] || lastRun.skippedReason})` : ''
    nodes.push({ key: 'last', text: `Last run ${when(lastRun.finishedAt || lastRun.created, tz)}: ${outcome}${skip}\n${changed} note${changed === 1 ? '' : 's'} changed`, colors: { backgroundColor: '#e7f4ea', foregroundColor: '#123d1d' } })
    if (lastRun.error) nodes.push({ key: 'problem', text: `Last problem: ${lastRun.error.code}`, colors: { backgroundColor: '#fde2e1', foregroundColor: '#5c1a16' } })
  } else nodes.push({ key: 'last', text: 'Not run yet' })
  if (instance.nextDueAt && instance.state === 'active') nodes.push({ key: 'next', text: `Next run ${when(instance.nextDueAt, tz)}` })
  edges.push(...nodes.slice(1).map((n) => ({ from: 'who', to: n.key })))
  for (const slate of slates.slice(0, 40)) {
    const key = `slate:${slate.shareId}`
    nodes.push({ key, text: `Keeps ${slate.name}`, link: origin ? `${origin}/canvas/${slate.shareId}` : undefined, shape: 'rectangle' })
    edges.push({ from: 'who', to: key, label: 'keeps' })
  }
  for (const card of cards.slice(0, 20)) {
    const key = `card:${card._id}`
    nodes.push({ key, text: `Waiting for your approval: ${WRITE_WORDS[card.kind] || card.kind}, ${targetLine(card.target)}. Approve or decline it in the project's Recipes tab.`, colors: { backgroundColor: '#fff4ce', foregroundColor: '#3d3418' } })
    edges.push({ from: 'who', to: key, label: 'asks' })
  }
  return {
    role: STATUS_ROLE,
    key: '',
    name: `${instance.name} status`.slice(0, 120),
    graph: { nodes: nodes.map((n) => (n.link ? n : { ...n, link: undefined })).map(({ link, ...n }) => (link ? { ...n, link } : n)), edges, layout: 'tree' },
  }
}
