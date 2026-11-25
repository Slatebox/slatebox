// The three starters a first-run slate's Ask Slatebox opens with (first-slate.mjs plans them; the
// server stores them on options.firstRun). Each is tried against the board as it stands, the same
// gate the board's own starters pass (workshop-starters.mjs): a change to the board must make a
// proposal; a board brief, a library add and typed steps are read by their own readers when sent.
// Starter 2 is the board's best move: the planned one while it still works, else the board's own first.
import { proposeLaneReply } from './lane-conversation.mjs'
import { proposeDirectMapEdit } from './map-direct-edits.mjs'
import { workshopStarters } from './workshop-starters.mjs'
import { BRIEF_OPENER } from './first-slate.mjs'

/** Whether a first-run starter can be sent on this board as it stands. */
export function firstStarterWorks(model, item) {
  const text = typeof item?.text === 'string' ? item.text.trim() : ''
  if (!text) return false
  if (item.kind === 'brief') return BRIEF_OPENER.test(text)
  if (item.kind === 'add') return /^add\s/i.test(text)
  if (item.kind === 'steps') return /→|->/.test(text) || /^add\s.+\s(?:after|before)\s/i.test(text)
  // A move the rules would refuse (offered only as "Move anyway") is not a starter.
  try {
    if (model.lanes[0]?.station) { proposeDirectMapEdit(model, text); return true }
    return !proposeLaneReply(model, text, null).override
  } catch { return false }
}

const plain = item => ({ text: item.text, ...(Array.isArray(item.select) && { select: item.select }) })

/**
 * The starters to offer while the conversation has no turns: the planned ones (starter 2 recomputed
 * from the board when the planned move no longer works), then the board's own, each checked, no two
 * alike, three at most.
 */
export function firstRunStarters(model, seeded) {
  if (!Array.isArray(seeded) || !seeded.length) return workshopStarters(model)
  const own = workshopStarters(model)
  const [one, two, ...rest] = seeded
  const second = two && firstStarterWorks(model, two) ? two : own[0]
  const seen = new Set()
  return [one, second, ...rest, ...own].filter(Boolean)
    .filter(item => (item.kind ? firstStarterWorks(model, item) : true))
    .filter(item => { const key = item.text.trim().toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true })
    .slice(0, 3).map(plain)
}

/** The first line Ask Slatebox says on a first-run slate. */
export const FIRST_RUN_GREETING = 'This board is yours. Try a starter, or just say what to change.'
