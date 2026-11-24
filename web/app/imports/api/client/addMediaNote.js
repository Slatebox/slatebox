import executeSlateOperations from './executeSlateOperations'
import { freeSpotNear, noteBoxes } from '../common/free-spot.mjs'

// The note a video address pasted or dropped on the canvas becomes (the engine's
// events.onMediaRequested). The server looks the video up (media.lookup: title, author, and a
// poster stored in the app's image store, so nobody's browser reaches the video host before they
// press play); the note is then added on this canvas through the engine's own applier, so it is
// undone, saved and shown to the room like any other new note. When the lookup fails the note is
// still made, with the play button and the host's name.
//
// request: { url, x, y } (the note's centre, canvas units)
// lookup({ url }) -> { media, found, notice? }   (Meteor.callAsync('media.lookup', ...))
// notify(text): say something to the person (a lookup that found nothing, a refusal)
export const MEDIA_NOTE = Object.freeze({ width: 320, height: 180 })

export default async function addMediaNote({ slate, request, lookup, notify = () => {} }) {
  if (!slate || !request?.url) return null
  let media = { url: request.url }
  try {
    const found = await lookup({ url: request.url })
    if (found?.media) media = found.media
    if (found?.notice) notify(found.notice)
  } catch (error) {
    // A refusal the person should hear (too many lookups); anything else still makes the note.
    if (error?.error === 'rate_limited' || error?.error === 'not_a_video') {
      notify(error.reason || error.message)
      if (error.error === 'not_a_video') return null
    }
  }
  const plan = {
    message: media.title ? `Added "${media.title.slice(0, 80)}".` : 'Added a video.',
    operations: [{
      kind: 'add_nodes',
      count: 1,
      media,
      ...(() => { const spot = freeSpotNear({ x: request.x, y: request.y }, MEDIA_NOTE, noteBoxes(slate)); return { x: spot.x, y: spot.y } })(),
    }],
  }
  const result = await executeSlateOperations({ slate, plan, userMessage: '' })
  const id = result?.report?.created?.[0]
  const engine = slate.v2 ?? slate
  const node = id && engine.nodes?.one?.(id)
  if (node) {
    try { engine.selectNodes?.([node], false) } catch { /* selection is a nicety */ }
  }
  return id ?? null
}
