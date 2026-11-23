// Restated 2026-11-21 from test-live-workshop.mjs. That file pinned the step model of the players
// Present replaced (a note id on an ordinary slate, a lane id on a workshop slate, stored in two
// places). A live presentation now plays the presenter's deck on every slate, and its step is an
// index into that deck. The editor-only, single-controller, revision, expiry, renewal and
// revocation checks are kept as they were.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { commandLiveSession, readDeck, visibleLiveSession } from '../server/methods/live-presentation.mjs'

const deck = { name: 'Walk', viewpoints: [
  { nodeIds: ['lane-first', 'card-a'], narrative: 'First', duration: 3000 },
  { nodeIds: ['lane-last'], narrative: 'Last', duration: 3000 },
  { nodeIds: ['one'], narrative: 'One', duration: 2200 },
] }

function room(native = false) {
  const key = 'Invited8', board = { _id:'board', userId:'owner', orgId:'team', sharingRevision:3, options:{isPrivate:true},
    nodes: [{ options: { id: 'one' } }],
    creative:{revision:4, model:{kind:'workshop', workshop:{lanes:[{id:'first'},{id:'last'}]}}} }
  if (native) delete board.creative
  const path = 'livePresentation'
  const grants = new Set(['owner','editor','other'])
  let time = 100, beforeWrite
  const call = (user, action, args = {}, link = key) => commandLiveSession({
    now: () => time, fail: (code,message) => Object.assign(new Error(message),{code}),
    resolve: async (id, userId) => id === key && {slateBase:structuredClone(board), canEdit:grants.has(userId)},
    boards: {async findOneAndUpdate(query,update) {
      beforeWrite?.()
      const current = path => path.split('.').reduce((value, field) => value?.[field], board)
      if (!Object.entries(query).every(([k,v])=>k === '$expr'
        ? current(path + '.expiresAt') > time
        : isDeepStrictEqual(current(k) ?? null,v))) return null
      if(update.$max) {
        const lease=board[path]
        lease.step=update.$set[path + '.step']
        lease.revision=update.$set[path + '.revision']
        lease.expiresAt=Math.max(lease.expiresAt,update.$max[path + '.expiresAt'])
      } else if(update.$set) board[path]=structuredClone(update.$set[path])
      else delete board[path]
      return structuredClone(board)
    }},
  },user,link,action,args)
  return {board, call, grants, tick: amount => {time+=amount}, race: f=>{beforeWrite=f}}
}

test('only one authenticated editor gets a private controller; steps and revisions direct the current session',async()=>{
  const r=room()
  for(const principal of [null,'viewer']) await assert.rejects(r.call(principal,'start',{deck}),{code:'unavailable'})
  await assert.rejects(r.call('owner','start',{deck:{name:'Empty',viewpoints:[]}}),{code:'invalid-presentation'})
  const attempts=await Promise.allSettled(['editor','other'].map(user=>r.call(user,'start',{deck})))
  assert.deepEqual(attempts.map(a=>a.status),['fulfilled','rejected'])
  const leader=attempts[0].value
  // A session opens on the whole slate; everyone in it plays the presenter's deck.
  assert.equal(leader.step,-1)
  assert.deepEqual(visibleLiveSession(r.board,100).deck,deck)
  assert.equal(visibleLiveSession(r.board,100).controlKey,undefined)
  assert.equal(r.board.livePresentation.controlKey,undefined)
  // One session per slate, whatever is drawn on it.
  assert.equal(r.board.creative.livePresentation,undefined)
  await assert.rejects(r.call('owner','start',{deck}),{code:'presenting'})
  await assert.rejects(r.call('other','move',{...leader,step:1}),{code:'stale'})
  await assert.rejects(r.call('editor','move',{...leader,controlKey:'a'.repeat(64),step:1}),{code:'stale'})
  for (const step of [3, -2, 1.5, '1']) await assert.rejects(r.call('editor','move',{...leader,step}),{code:'invalid-step'})
  const moved=await r.call('editor','move',{...leader,step:1})
  assert.deepEqual([moved.step,moved.revision],[1,1])
  await assert.rejects(r.call('editor','end',leader),{code:'stale'})
  r.tick(25000)
  const key={...moved,controlKey:leader.controlKey}
  const heartbeat=await r.call('editor','move',key)
  assert.equal(heartbeat.revision,moved.revision)
  assert.equal(heartbeat.expiresAt-moved.expiresAt,25000)
  assert.equal(await r.call('editor','end',key),true)
  assert.equal(visibleLiveSession(r.board,100),null)
  const replacement=await r.call('owner','start',{deck})
  assert.notEqual(leader.sessionId,replacement.sessionId)
  await assert.rejects(r.call('editor','end',key),{code:'stale'})
  assert.equal(r.board.creative.revision,4)
})

test('revocation, stale leases and a racing grant change cannot advance an old session',async()=>{
  const r=room(), live=await r.call('editor','start',{deck})
  await assert.rejects(r.call('editor','move',{...live,step:1},'Other123'),{code:'unavailable'})
  r.grants.delete('editor')
  await assert.rejects(r.call('editor','move',{...live,step:1}),{code:'unavailable'})
  r.tick(120000)
  assert.equal(visibleLiveSession(r.board,live.expiresAt),null)
  r.grants.add('editor')
  await assert.rejects(r.call('editor','move',live),{code:'stale'})
  const second=await r.call('editor','start',{deck})
  r.race(()=>r.board.sharingRevision++)
  await assert.rejects(r.call('editor','move',{...second,step:0}),{code:'stale'})
  r.race(null)
  const recovered=await r.call('editor','move',{...second,step:0})
  assert.equal(recovered.step,0)
})

test('a same-step renewal does not block a simultaneous move or end, but an expired write cannot revive a lease',async()=>{
  const r=room(), lead=await r.call('owner','start',{deck})
  r.tick(10000)
  const [renewed,moved]=await Promise.all([r.call('owner','move',lead), r.call('owner','move',{...lead,step:2})])
  assert.equal(moved.revision,renewed.revision+1)
  const credentials={...moved,controlKey:lead.controlKey}
  r.tick(20000)
  const [,ended]=await Promise.all([r.call('owner','move',credentials),r.call('owner','end',credentials)])
  assert.equal(ended,true)
  const second=await r.call('owner','start',{deck})
  r.race(()=>r.tick(120001))
  await assert.rejects(r.call('owner','move',second),{code:'stale'})
  assert.equal(r.board.livePresentation.expiresAt,second.expiresAt)
})

test('an ordinary slate leads the same way; a board drawn by its own renderer has no presentation to lead', async () => {
  const r = room(true)
  await assert.rejects(r.call('viewer','start',{deck}),{code:'unavailable'})
  const leader = await r.call('editor','start',{deck})
  assert.equal(visibleLiveSession(r.board,100).step, -1)
  assert.equal(r.board.creative, undefined)
  await assert.rejects(r.call('editor','move',leader,'NewInvite'),{code:'unavailable'})
  r.grants.delete('editor')
  await assert.rejects(r.call('editor','move',leader),{code:'unavailable'})
  const overlay = room()
  overlay.board.creative.model.kind = 'listening'
  await assert.rejects(overlay.call('owner','start',{deck}),{code:'unavailable'})
})

test('a deck is what a follower plays and nothing more; anything else is refused', () => {
  assert.deepEqual(readDeck({ ...deck, extra: true, viewpoints: deck.viewpoints.map(point => ({ ...point, x: 1, svg: '<svg/>' })) }), deck)
  assert.equal(readDeck({ name: 'n', viewpoints: [{ nodeIds: [], narrative: '' }] }), null)
  assert.equal(readDeck({ name: 'n', viewpoints: [{ nodeIds: ['x'.repeat(129)] }] }), null)
  assert.equal(readDeck({ name: 'n', viewpoints: Array.from({ length: 201 }, () => ({ nodeIds: ['a'] })) }), null)
  // Restated 2026-11-21: a long narrative is a caption, shortened rather than refused (it was
  // refused over 2,000 characters). The deck is sent once to every follower: it stays small.
  assert.equal(readDeck({ name: 'n', viewpoints: [{ nodeIds: ['a'], narrative: 'x'.repeat(2001) }] }).viewpoints[0].narrative, 'x'.repeat(300))
  assert.equal(readDeck({ name: 'n', viewpoints: Array.from({ length: 21 }, () => ({ nodeIds: Array(100).fill('a') })) }), null)
  const largest = readDeck({ name: 'n'.repeat(500), viewpoints: Array.from({ length: 20 }, () => ({ nodeIds: Array(100).fill('x'.repeat(128)), narrative: 'z'.repeat(5000) })) })
  assert.ok(JSON.stringify(largest).length < 300_000)
  assert.deepEqual(readDeck({ viewpoints: [{ nodeIds: ['a'], duration: -4 }] }), { name: '', viewpoints: [{ nodeIds: ['a'], narrative: '', duration: 2200 }] })
  assert.equal(readDeck(null), null)
})
