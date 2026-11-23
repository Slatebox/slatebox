// agentPresence.forSlate(shareId): the agents saving to a slate, for anyone who may read it
// (the check creativeSlates.state makes), with public fields only and targets on that slate.
import { Meteor } from 'meteor/meteor'
import { AgentPresence, AgentSuggestions, Slates } from '../../imports/api/common/models'
import { resolvePresentationSlate } from '../methods/creative-slates'
import { createPresenceReader } from './agentPresence.mjs'
import { suggestions } from '../agents/suggestions-meteor'

const read = createPresenceReader({
  resolve: async (shareId, userId) => (await resolvePresentationSlate(shareId, userId))?.slateBase ?? null,
  list: (slateId) => AgentPresence.rawCollection().find({ slateId }).toArray(),
  // A pointer may point at its agent's waiting ghost notes.
  ghosts: (slateId) => suggestions.ghostIds(slateId),
})

const COLLECTION = 'agentPresence'
// The server's clock, sent beside the records: a screen whose clock is ahead or behind reads
// expiresAt and endedAt on the server's time (AgentPresenceListener), not its own.
export const CLOCK_ID = 'clock'

Meteor.publish('agentPresence.forSlate', async function (shareId) {
  if (typeof shareId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(shareId)) return this.ready()
  const userId = this.userId
  const first = await read(shareId, userId)
  if (!first) return this.ready()
  const shown = new Map() // record id -> what was sent, as JSON
  let stopped = false, running = false, again = false, timer = null
  const handles = []
  this.onStop(() => { stopped = true; clearTimeout(timer); handles.forEach((handle) => handle.stop()) })
  let clockSent = false
  const send = (records) => {
    // The server's time with every send, so a screen can tell how far its own clock is off.
    if (!clockSent) this.added(COLLECTION, CLOCK_ID, { serverNow: Date.now() })
    else this.changed(COLLECTION, CLOCK_ID, { serverNow: Date.now() })
    clockSent = true
    const next = new Map(records.map(({ _id, ...fields }) => [_id, fields]))
    for (const id of shown.keys()) if (!next.has(id)) { this.removed(COLLECTION, id); shown.delete(id) }
    for (const [id, fields] of next) {
      const json = JSON.stringify(fields)
      if (!shown.has(id)) this.added(COLLECTION, id, fields)
      else if (shown.get(id) !== json) this.changed(COLLECTION, id, fields)
      shown.set(id, json)
    }
    // A record leaves at its expiresAt by the server's clock even when nothing in the database
    // changes then (the TTL index deletes it a minute or two later): refresh when the next one
    // is due.
    clearTimeout(timer)
    const due = records.map((record) => new Date(record.expiresAt).getTime()).filter(Number.isFinite)
    if (due.length && !stopped) timer = setTimeout(() => refresh(), Math.max(50, Math.min(...due) - Date.now() + 50))
  }
  // One refresh at a time; a change during one runs another after it.
  const refresh = async () => {
    if (stopped) return
    if (running) { again = true; return }
    running = true
    try {
      do {
        again = false
        const result = await read(shareId, userId)
        if (stopped) return
        // Access gone (unshared, made private): nothing more, and nothing left on screen.
        send(result ? result.records : [])
      } while (again && !stopped)
    } catch (error) {
      console.error('[presence] publication', error?.message)
    } finally { running = false }
  }
  send(first.records)
  const cursors = [
    AgentPresence.find({ slateId: first.slateId }, { fields: { _id: 1, updatedAt: 1, status: 1 } }),
    Slates.find(first.slateId, { fields: { userId: 1, orgId: 1, 'options.isPrivate': 1, 'options.isUnlisted': 1, 'options.isPublic': 1 } }),
    AgentSuggestions.find({ slateId: first.slateId }, { fields: { _id: 1, updatedAt: 1 } }),
  ]
  for (const cursor of cursors) {
    const handle = await cursor.observeChangesAsync({ added: refresh, changed: refresh, removed: refresh })
    if (stopped) { handle.stop(); return undefined }
    handles.push(handle)
  }
  this.ready()
  return undefined
})
