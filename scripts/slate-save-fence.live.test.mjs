// Live: a save answers only after the people watching the slate have been sent the change.
//
// Meteor holds a method's `updated` message until every write the method made through Meteor's
// collections has reached the publications (the write fence), and the browser runs a method's
// callback only after `updated`. Production's interactive-slate save wrote that way, so Undo and
// the next request were always read against the saved slate. Every save now goes through the
// save core; it must keep that promise, or the page answers with the slate before the save.
//
// Run against a locally started app: SLATEBOX_APP_URL=http://localhost:<port>.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { appUrl, registeredUser, closeAll } from './ddp-client.mjs'

const base = appUrl()
const live = { skip: base ? false : 'set SLATEBOX_APP_URL to a locally started app' }
after(() => closeAll())

const nonce = () => randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').padEnd(17, 'A').slice(0, 17)

// How long after the method's `updated` the watcher holds `revision`. The publication checks
// the reader's access again before it sends a change (a moment, as in production); a save that
// skips the write fence answers a whole change-stream round (about 100 ms) before that.
const MOMENT_MS = 20
function lagAfterUpdated(client, collection, id, revision, call) {
  return new Promise((resolve, reject) => {
    let methodId = null
    let updatedAt = null
    const holds = () => client.docs.get(collection)?.get(id)?.revision === revision
    const onMessage = (event) => {
      const msg = JSON.parse(event.data)
      if (!methodId) return
      if (msg.msg === 'updated' && msg.methods.includes(methodId)) updatedAt = performance.now()
      if (updatedAt !== null && holds()) {
        client.ws.removeEventListener('message', onMessage)
        resolve(performance.now() - updatedAt)
      }
    }
    const send = client.ws.send.bind(client.ws)
    client.ws.send = (data) => {
      const msg = JSON.parse(data)
      if (msg.msg === 'method' && !methodId) methodId = msg.id
      client.ws.send = send
      return send(data)
    }
    client.ws.addEventListener('message', onMessage)
    call().catch(reject)
    setTimeout(() => reject(new Error('the watcher never held revision ' + revision)), 5000).unref()
  })
}

test('an interactive slate save reaches its watchers before the save answers', live, async () => {
  const owner = await registeredUser('fence')
  const shareId = await owner.call('creativeSlates.create', 'listening-room', '?mix=2', nonce())
  assert.equal(await owner.subscribe('creativeSlates.state', shareId), 'ready')
  for (let round = 0; round < 5; round += 1) {
    const state = owner.docs.get('creativeSlateStates')?.get(shareId)
    assert.ok(state?.model, 'the publication delivered the slate')
    const lag = await lagAfterUpdated(owner, 'creativeSlateStates', shareId, state.revision + 1, async () => {
      assert.equal(await owner.call('creativeSlates.save', shareId, state.revision, state.model), state.revision + 1)
    })
    assert.ok(lag <= MOMENT_MS, `round ${round}: the watcher took the save ${Math.round(lag)} ms after it answered`)
  }
})
