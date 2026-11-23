import { createHash, randomBytes } from 'node:crypto'
import { sharedSaveConditions } from './native-slate-save.mjs'

// Presenting to everyone on a slate. One session per slate, kept on the slate as
// `livePresentation`: { sessionId, step, revision, expiresAt, deck }. The deck is the sequence the
// presenter plays (the presentation's viewpoints); `step` is the viewpoint everyone is on, and -1
// is the whole slate. Followers play the same deck over their own drawing of the slate.

const leaseMs = 120_000
const path = 'livePresentation'
const digest = (principal, key) => createHash('sha256').update(JSON.stringify([principal, key])).digest('hex')
// A deck is kept on the slate for the session and sent once to each follower: it stays small.
// A presentation that frames each note of a large slate fits; a deck of arbitrary size does not.
const maxViewpoints = 200
const maxNotes = 100
const maxDeckNotes = 2000
const maxId = 128
const maxNarrative = 300
const validStep = (step, deck) => Number.isSafeInteger(step) && step >= -1 && step < deck.viewpoints.length

/**
 * The deck a presenter sends, reduced to what a follower plays; null when it is not one. A
 * narrative is a caption: a longer one is shortened, not refused.
 */
export function readDeck(input) {
  if (!input || typeof input !== 'object' || typeof (input.name ?? '') !== 'string' || !Array.isArray(input.viewpoints) ||
    input.viewpoints.length < 1 || input.viewpoints.length > maxViewpoints) return null
  const viewpoints = []
  let notes = 0
  for (const point of input.viewpoints) {
    if (!point || !Array.isArray(point.nodeIds) || point.nodeIds.length < 1 || point.nodeIds.length > maxNotes ||
      !point.nodeIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= maxId) ||
      typeof (point.narrative ?? '') !== 'string') return null
    notes += point.nodeIds.length
    if (notes > maxDeckNotes) return null
    const duration = Number(point.duration)
    viewpoints.push({ nodeIds: [...point.nodeIds], narrative: (point.narrative ?? '').slice(0, maxNarrative),
      duration: Number.isFinite(duration) && duration > 0 && duration <= 600_000 ? duration : 2200 })
  }
  return { name: (input.name ?? '').slice(0, 200), viewpoints }
}

// The public session ID proves possession only when paired with the unshared key
// and the same authenticated principal. The slate never stores the control key.
export function visibleLiveSession(board, now = Date.now()) {
  const live = board?.[path]
  if (!live || !(live.expiresAt > now) || !live.deck || !validStep(live.step, live.deck)) return null
  const { sessionId, step, revision, expiresAt, deck } = live
  return { sessionId, step, revision, expiresAt, deck }
}

export async function commandLiveSession({ boards, resolve, fail, now = Date.now }, userId, shareId, command, args) {
  if (!userId || typeof shareId !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(shareId)) throw fail('unavailable', 'This slate is unavailable.')
  const access = await resolve(shareId, userId)
  const board = access?.slateBase
  // A board drawn by its own renderer (not on the canvas) has no presentation to lead.
  const drawn = board && (board.creative ? board.creative.model?.kind === 'workshop' : Array.isArray(board.nodes))
  if (!access?.canEdit || !drawn) throw fail('unavailable', 'Only an editor can lead this presentation.')
  const time = now()
  const live = visibleLiveSession(board, time)
  const previous = board[path]
  const selector = { _id: board._id, userId: board.userId, orgId: board.orgId ?? null, ...sharedSaveConditions(board, userId) }
  const stale = () => fail('stale', 'The live presentation changed. Reopen it to see where it is now.')
  let next, controlKey, update
  if (command === 'start') {
    if (live) throw fail('presenting', 'Someone is already presenting this slate.')
    const deck = readDeck(args.deck)
    if (!deck) throw fail('invalid-presentation', args.deck?.viewpoints?.length > 0
      ? 'This presentation is too long to present live. Shorten it, then present again.'
      : 'Add a note to present this slate.')
    controlKey = randomBytes(32).toString('hex')
    next = { sessionId: digest(userId, controlKey), revision: 0, step: -1, expiresAt: time + leaseMs, deck }
    // A late attempt to replace a lease cannot replace a concurrent renewal.
    selector[path] = previous ?? null
    update = { $set: { [path]: next } }
  } else {
    if (!live || typeof args.controlKey !== 'string' || !/^[a-f0-9]{64}$/.test(args.controlKey) ||
        args.sessionId !== live.sessionId || digest(userId, args.controlKey) !== live.sessionId ||
        args.revision !== live.revision) throw stale()
    selector[path + '.sessionId'] = args.sessionId
    selector[path + '.revision'] = args.revision
    // Evaluate expiry at Mongo's write time, even if the request queued.
    selector.$expr = { $gt: ['$' + path + '.expiresAt', { $toLong: '$$NOW' }] }
    if (command === 'end') update = { $unset: { [path]: '' } }
    else {
      if (!validStep(args.step, live.deck)) throw fail('invalid-step', 'Choose a step of this presentation.')
      // A renewal (the same step) leaves revision unchanged so it can overlap one real movement.
      update = {
        $set: { [path + '.step']: args.step, [path + '.revision']: live.revision + Number(live.step !== args.step) },
        $max: { [path + '.expiresAt']: time + leaseMs },
      }
    }
  }
  const updated = await boards.findOneAndUpdate(selector, update, {
    returnDocument: 'after', includeResultMetadata: false, projection: { [path]: 1 },
  })
  if (!updated) throw stale()
  if (command === 'end') return true
  const { sessionId, step, revision, expiresAt } = updated[path]
  return controlKey ? { sessionId, step, revision, expiresAt, controlKey } : { sessionId, step, revision, expiresAt }
}
