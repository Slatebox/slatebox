import test from 'node:test'
import assert from 'node:assert/strict'
import { dailyClient, huddleGrant } from '../web/app/server/methods/huddle-provider.mjs'
import { roomRequest, tokenRequest, startCall } from '../web/app/server/metering/calls.mjs'

const editor = { _id: 'editor', profile: { firstName: 'Alex', audioMutedOnStart: false } }
const guest = { _id: 'guest', isAnonymous: true }
const record = (accessLevel = 'EDIT', options = {}) => ({
  slateBase: { shareId: 'room-one', options: { huddleType: 'video', ...options } }, accessLevel,
})
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data })
const privateRoom = { name: 'room-one-abcdefgh', privacy: 'private', url: 'https://example.daily.co/room-one-abcdefgh' }

test('requires a readable slate, an enabled huddle and the appropriate identity', () => {
  for (const value of [null, { exists: false }, record('NONE'), record('EDIT', { huddleType: 'disabled' })]) {
    assert.equal(huddleGrant(value, editor), null)
  }
  assert.equal(huddleGrant(record(), null), null)
  const listener = huddleGrant(record('READ', { isPublic: true }), null, true)
  assert.deepEqual(listener.media, [])
  assert.equal(listener.canTranscribe, false)
  assert.equal(listener.canStart, false)
  assert.equal(listener.displayName, 'Guest')
  const commenter = huddleGrant(record('COMMENT', { huddleType: 'audio' }), editor, true)
  assert.deepEqual(commenter.media, ['audio', 'video'])
  assert.equal(commenter.defaultMode, 'voice')
  assert.equal(commenter.canTranscribe, false)
  assert.equal(commenter.canStart, true)
})

test('guests join with their access but never start a call', () => {
  const g = huddleGrant(record('EDIT'), guest)
  assert.equal(g.canStart, false)
  assert.deepEqual(g.media, ['audio', 'video'])
})

test('a call room is private and a room-scoped token carries the mode', async () => {
  const calls = []
  const replies = [response(200, privateRoom), response(200, { token: 'sample' })]
  const provider = dailyClient(async (url, options) => {
    calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) })
    return replies.shift()
  }, 'fixture', 'dg-fixture')
  const now = Date.now()
  const call = startCall({ callId: 'abcdefgh00000000', shareId: 'room-one', starterId: 'editor', decision: { ok: true, route: 'free', kind: 'video', payer: { type: 'user', id: 'editor' } }, now })
  assert.equal(await provider.createRoom(roomRequest({ name: call.roomName, now })), privateRoom.url)
  const grant = huddleGrant(record(), editor, true)
  assert.equal(await provider.token(tokenRequest({ call, grant, now })), 'sample')
  assert.deepEqual(calls.map(c => c.method), ['POST', 'POST'])
  assert.equal(calls[0].url, 'https://api.daily.co/v1/rooms')
  assert.equal(calls[0].body.privacy, 'private')
  assert.equal(calls[0].body.properties.enable_knocking, false)
  assert.equal(calls[0].body.properties.enable_transcription, 'deepgram:dg-fixture')
  const claims = calls[1].body.properties
  assert.equal(claims.room_name, call.roomName)
  assert.equal(claims.is_owner, false)
  assert.equal(claims.user_name, 'Alex')
  assert.equal(claims.start_audio_off, false)
  assert.equal(claims.start_video_off, true)
  assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 601)
  assert.deepEqual(claims.permissions, { canSend: ['audio', 'video'], canAdmin: ['transcription'] })
})

test('provider failure, a public room or another room name stops before any token', async () => {
  for (const reply of [response(503), response(200, { ...privateRoom, privacy: 'public' }), response(200, { ...privateRoom, name: 'different-room' })]) {
    const provider = dailyClient(async () => reply, 'fixture')
    await assert.rejects(provider.createRoom(roomRequest({ name: privateRoom.name, now: Date.now() })))
  }
})
