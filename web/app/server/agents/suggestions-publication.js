// agentSuggestions.forSlate(shareId): what agents suggested on a slate and each agent's recent
// activity, for anyone who may read it (the check creativeSlates.state makes), as publicAction
// gives it (no account, token or run ids), and the slate's agent controls (paused, who edits
// directly). Every screen draws the waiting ones as ghosts; Keep and Discard are shown only to
// people who may edit, and the server checks that again (suggestions.decide).
import { Meteor } from 'meteor/meteor'
import { AgentSuggestions } from '../../imports/api/common/models'
import { editDirectlyEnabled } from '../../imports/api/common/agent-settings.mjs'
import { resolvePresentationSlate } from '../methods/creative-slates'
import { AgentSlateControls, suggestions } from './suggestions-meteor'
import { publicAction } from './suggestions.mjs'

const COLLECTION = 'agentSuggestions'
export const CONTROLS_ID = 'controls'

async function read(shareId, userId) {
  const slate = (await resolvePresentationSlate(shareId, userId))?.slateBase
  if (!slate?._id) return null
  const [actions, controls] = await Promise.all([suggestions.list(slate._id), suggestions.controlsOf(slate._id)])
  const editDirectly = editDirectlyEnabled(Meteor.settings)
  return {
    slateId: slate._id,
    rows: [
      { _id: CONTROLS_ID, paused: controls.paused, pausedBy: controls.pausedBy, modes: editDirectly ? controls.modes : {}, editDirectly },
      ...actions.map((doc) => ({ _id: doc._id, ...publicAction(doc) })),
    ],
  }
}

Meteor.publish('agentSuggestions.forSlate', async function (shareId) {
  if (typeof shareId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(shareId)) return this.ready()
  const userId = this.userId
  const first = await read(shareId, userId)
  if (!first) return this.ready()
  const shown = new Map()
  let stopped = false, running = false, again = false
  const handles = []
  this.onStop(() => { stopped = true; handles.forEach((handle) => handle.stop()) })
  const send = (rows) => {
    const next = new Map(rows.map(({ _id, ...fields }) => [_id, fields]))
    for (const id of shown.keys()) if (!next.has(id)) { this.removed(COLLECTION, id); shown.delete(id) }
    for (const [id, fields] of next) {
      const json = JSON.stringify(fields)
      if (!shown.has(id)) this.added(COLLECTION, id, fields)
      else if (shown.get(id) !== json) this.changed(COLLECTION, id, fields)
      shown.set(id, json)
    }
  }
  const refresh = async () => {
    if (stopped) return
    if (running) { again = true; return }
    running = true
    try {
      do {
        again = false
        const result = await read(shareId, userId)
        if (stopped) return
        // Access gone (unshared, made private): nothing more, and no ghost left on screen.
        send(result ? result.rows : [])
      } while (again && !stopped)
    } catch (error) {
      console.error('[suggestions] publication', error?.message)
    } finally { running = false }
  }
  send(first.rows)
  const cursors = [
    AgentSuggestions.find({ slateId: first.slateId }, { fields: { _id: 1, updatedAt: 1 } }),
    AgentSlateControls.find({ _id: first.slateId }),
  ]
  for (const cursor of cursors) {
    const handle = await cursor.observeChangesAsync({ added: refresh, changed: refresh, removed: refresh })
    if (stopped) { handle.stop(); return undefined }
    handles.push(handle)
  }
  this.ready()
  return undefined
})
