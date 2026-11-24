// Import from Excalidraw, a share link: the browser asks for the encrypted drawing stored under the
// link's id at excalidraw.com (which does not answer other sites' pages directly), and decrypts it
// itself with the key in the link's fragment, which never leaves the browser
// (imports/api/common/excalidraw-scene.mjs decryptShare). Only that one host, one shape of id, a
// size cap and a timeout; no cookies, no redirects followed.
import { Meteor } from 'meteor/meteor'

const SHARE_ID = /^[A-Za-z0-9_-]{8,64}$/
const MAX_BYTES = 4 * 1024 * 1024
const recent = new Map() // userId -> [timestamps]: 20 an hour

Meteor.methods({
  async 'excalidraw.fetchShare'(id) {
    if (!this.userId) throw new Meteor.Error('sign_in', 'Sign in to import a drawing.')
    if (typeof id !== 'string' || !SHARE_ID.test(id)) throw new Meteor.Error('invalid-turn', 'That is not an excalidraw.com share link.')
    const now = Date.now()
    const mine = (recent.get(this.userId) || []).filter((at) => now - at < 3600000)
    if (mine.length >= 20) throw new Meteor.Error('busy', 'You imported many drawings in the last hour. Try again later.')
    recent.set(this.userId, [...mine, now])
    let response
    try {
      response = await fetch(`https://json.excalidraw.com/api/v2/${id}`, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { accept: 'application/octet-stream' } })
    } catch {
      throw new Meteor.Error('unavailable', 'excalidraw.com did not answer. Try again in a minute.')
    }
    if (response.status === 404) throw new Meteor.Error('not_found', 'That share link has no drawing any more.')
    if (!response.ok) throw new Meteor.Error('unavailable', 'excalidraw.com did not give the drawing. Try again in a minute.')
    const size = Number(response.headers.get('content-length') || 0)
    if (size > MAX_BYTES) throw new Meteor.Error('too_large', 'That drawing is too large to import.')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_BYTES) throw new Meteor.Error('too_large', 'That drawing is too large to import.')
    return bytes
  },
})
