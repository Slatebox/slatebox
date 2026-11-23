import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CALL_LIMITS, OVERRUN_BOUND_MICROS, callRoomName, roomRequest, tokenRequest, admit, startCall, tick, minutesLeftFor,
} from '../web/app/server/metering/calls.mjs'
import { route, DEFAULT_METERING } from '../web/app/server/metering/policy.mjs'
import { dailyClient } from '../web/app/server/methods/huddle-provider.mjs'

const T0 = Date.UTC(2026, 10, 19, 15, 0, 0)
const MIN = 60_000
const person = { id: 'starter', anonymous: false, emailVerified: true }
const usage = { aiActionsToday: 0, aiMicrosMonth: 0, freeMicrosToday: 0, voiceMinutesMonth: 0, videoMinutesMonth: 0 }
const decide = (over = {}) => route({ kind: 'voice', person, teamId: null, keys: {}, usage, wallets: {}, global: { monthFreeMicros: 0, todayFreeMicros: 0 }, minutes: 10, settings: DEFAULT_METERING, now: T0, ...over })
const open = (over = {}) => startCall({ callId: 'abcdefgh12345678', shareId: 'share1', starterId: 'starter', decision: decide(), now: T0, ...over })
const plenty = { voice: 2400, video: 500 }

test('a room per call is private, expires in 10 minutes, ejects at expiry, holds 20 people and never knocks', () => {
  const call = open()
  assert.equal(call.roomName, 'share1-abcdefgh')
  assert.equal(callRoomName('share1', 'abcdefgh12345678'), 'share1-abcdefgh')
  const r = roomRequest({ name: call.roomName, now: T0, transcriptionKey: null })
  assert.equal(r.privacy, 'private')
  assert.deepEqual(r.properties, {
    exp: T0 / 1000 + 600, eject_at_room_exp: true, max_participants: 20, enable_knocking: false,
    start_video_off: true, start_audio_off: true, enable_screenshare: false,
  })
  assert.equal(roomRequest({ name: 'x', now: T0, transcriptionKey: 'dg' }).properties.enable_transcription, 'deepgram:dg')
  assert.equal(call.roomExpAt, T0 + 10 * MIN)
  assert.equal(call.state, 'open')
  assert.deepEqual(call.payer, { type: 'user', id: 'starter' })
})

test('tokens are scoped to the room, expire in 600 seconds, and eject when three hours are up', () => {
  const call = open()
  const grant = { displayName: 'Alex', audioMuted: true, media: ['audio'], canTranscribe: false }
  const t = tokenRequest({ call, grant, now: T0 + 30 * MIN }).properties
  assert.equal(t.room_name, call.roomName)
  assert.equal(t.exp, (T0 + 30 * MIN) / 1000 + 600)
  assert.equal(t.eject_after_elapsed, 3 * 3600 - 30 * 60)
  assert.equal(t.is_owner, false)
  assert.deepEqual(t.permissions.canSend, ['audio'])
  const listener = tokenRequest({ call, grant: { ...grant, media: [] }, now: T0 }).properties
  assert.equal(listener.permissions.canSend, false)
  const video = tokenRequest({ call: { ...call, mode: 'video' }, grant: { ...grant, media: ['audio', 'video'] }, now: T0 }).properties
  assert.deepEqual(video.permissions.canSend, ['audio', 'video'])
  const voiceOnly = tokenRequest({ call, grant: { ...grant, media: ['audio', 'video'] }, now: T0 }).properties
  assert.deepEqual(voiceOnly.permissions.canSend, ['audio'], 'a voice call never sends camera tracks')
})

test('the 21st person is refused and a rejoin does not count again', () => {
  let call = open()
  for (let i = 0; i < 20; i++) {
    const r = admit(call, 'k' + i)
    assert.equal(r.ok, true)
    call = { ...call, participants: r.participants }
  }
  const full = admit(call, 'k20')
  assert.deepEqual([full.ok, full.message], [false, 'This call is full (20 people).'])
  const again = admit(call, 'k3')
  assert.deepEqual([again.ok, again.rejoin], [true, true])
})

test('guests join but cannot start', () => {
  const guest = decide({ person: { id: 'g', anonymous: true } })
  assert.equal(guest.ok, false)
  assert.throws(() => startCall({ callId: 'x'.repeat(16), shareId: 's', starterId: 'g', decision: guest, now: T0 }), /Sign in to start a call/)
  const call = open()
  assert.equal(admit(call, 'guest-connection-1').ok, true)
})

test('each tick charges the starter count x minutes, and joiners are never charged', () => {
  const call = { ...open(), participants: ['a', 'b', 'c', 'd'] }
  const out = tick({ call, presence: { count: 4 }, now: T0 + MIN, minutesLeft: plenty, level: 0 })
  assert.deepEqual(out.charge, { payer: { type: 'user', id: 'starter' }, kind: 'voice', participantMinutes: 4, ref: call._id + ':1' })
  assert.equal(out.decision, 'extend')
  assert.equal(out.set.roomExpAt, T0 + MIN + 10 * MIN)
  assert.equal(out.set.lastTickAt, T0 + MIN)
})

test('when presence cannot be read, the larger of the last count and the participant list is charged', () => {
  const call = { ...open(), participants: ['a', 'b', 'c'], lastCount: 5 }
  assert.equal(tick({ call, presence: null, now: T0 + 2 * MIN, minutesLeft: plenty, level: 0 }).charge.participantMinutes, 10)
  const call2 = { ...open(), participants: ['a', 'b', 'c'], lastCount: 1 }
  assert.equal(tick({ call: call2, presence: null, now: T0 + MIN, minutesLeft: plenty, level: 0 }).charge.participantMinutes, 3)
})

test('the room is not extended when minutes are short, with a 2-minute warning, then it ends', () => {
  const call = { ...open(), participants: ['a', 'b', 'c', 'd'] }
  const short = tick({ call, presence: { count: 4 }, now: T0 + MIN, minutesLeft: { voice: 39, video: 0 }, level: 0 })
  assert.equal(short.decision, 'let-expire')
  assert.equal(short.set.roomExpAt, undefined)
  const warn = tick({ call: { ...call, ...short.set }, presence: { count: 4 }, now: T0 + 8 * MIN, minutesLeft: { voice: 0, video: 0 }, level: 0 })
  assert.equal(warn.warning, 'allowance')
  const end = tick({ call: { ...call, ...warn.set }, presence: { count: 4 }, now: T0 + 10 * MIN, minutesLeft: { voice: 0, video: 0 }, level: 0 })
  assert.deepEqual([end.decision, end.set.state, end.set.endedReason], ['end', 'ended', 'allowance'])
})

test('a video call whose video runs out moves to voice', () => {
  const call = { ...open({ decision: decide({ kind: 'video' }) }), participants: ['a', 'b'] }
  assert.equal(call.mode, 'video')
  const out = tick({ call, presence: { count: 2 }, now: T0 + MIN, minutesLeft: { voice: 1000, video: 5 }, level: 0 })
  assert.equal(out.charge.kind, 'video')
  assert.equal(out.decision, 'move-to-voice')
  assert.equal(out.set.mode, 'voice')
  assert.equal(out.set.videoFallbackAt, T0 + MIN)
  assert.notEqual(out.set.roomName, call.roomName)
})

test('one person alone for 10 minutes ends the call, with a warning at 8', () => {
  let call = { ...open(), participants: ['a', 'b'] }
  let out = tick({ call, presence: { count: 1 }, now: T0 + MIN, minutesLeft: plenty, level: 0 })
  assert.equal(out.set.aloneSince, T0 + MIN)
  call = { ...call, ...out.set }
  out = tick({ call, presence: { count: 1 }, now: T0 + 9 * MIN, minutesLeft: plenty, level: 0 })
  assert.equal(out.warning, 'alone')
  call = { ...call, ...out.set }
  out = tick({ call, presence: { count: 1 }, now: T0 + 11 * MIN, minutesLeft: plenty, level: 0 })
  assert.deepEqual([out.decision, out.set.endedReason], ['end', 'alone'])
  // somebody comes back: the clock resets
  const back = tick({ call: { ...call, aloneSince: T0 }, presence: { count: 2 }, now: T0 + 5 * MIN, minutesLeft: plenty, level: 0 })
  assert.equal(back.set.aloneSince, null)
})

test('a call ends at three hours', () => {
  const call = { ...open(), participants: ['a', 'b'], lastTickAt: T0 + 179 * MIN, roomExpAt: T0 + 185 * MIN }
  const out = tick({ call, presence: { count: 2 }, now: T0 + 180 * MIN, minutesLeft: plenty, level: 0 })
  assert.deepEqual([out.decision, out.set.endedReason], ['end', 'time'])
})

test('budget stages: 70 percent starts video as voice, 100 percent stops free extensions', () => {
  const at70 = decide({ kind: 'video', global: { monthFreeMicros: 700_000_000, todayFreeMicros: 0 } })
  assert.equal(startCall({ callId: 'abcdefgh12345678', shareId: 's', starterId: 'starter', decision: at70, now: T0 }).mode, 'voice')
  const call = { ...open(), participants: ['a', 'b'] }
  const out = tick({ call, presence: { count: 2 }, now: T0 + MIN, minutesLeft: plenty, level: 100 })
  assert.equal(out.decision, 'let-expire')
  // a running free video call at 70 percent carries on as voice at the next window
  const video = { ...open({ decision: decide({ kind: 'video' }) }), participants: ['a', 'b'] }
  assert.equal(tick({ call: video, presence: { count: 2 }, now: T0 + MIN, minutesLeft: plenty, level: 70 }).decision, 'extend')
})

test('own-key and operator calls have no meter', () => {
  for (const provider of ['own-key', 'operator']) {
    const call = { ...open(), provider, route: provider === 'own-key' ? 'byok' : 'operator', participants: ['a', 'b'] }
    const out = tick({ call, presence: { count: 2 }, now: T0 + MIN, minutesLeft: { voice: 0, video: 0 }, level: 110 })
    assert.equal(out.charge, null)
    assert.notEqual(out.decision, 'end')
  }
})

test('balance minutes are what the balance buys at the provider price plus 5 percent', () => {
  assert.equal(minutesLeftFor({ route: 'balance', spendableMicros: 1_039_500, settings: DEFAULT_METERING }).voice, 1000)
  assert.equal(minutesLeftFor({ route: 'balance', spendableMicros: 4200, settings: DEFAULT_METERING }).video, 1)
  const free = minutesLeftFor({ route: 'free', usage: { voiceMinutesMonth: 400, videoMinutesMonth: 100 }, person, settings: DEFAULT_METERING, now: T0 })
  // Pro credits (the included amount): 1,380 voice and 330 video participant-minutes a month
  assert.deepEqual(free, { voice: 980, video: 230 })
})

test('the most a call can run past its meter is $0.80', () => {
  assert.equal(OVERRUN_BOUND_MICROS, CALL_LIMITS.maxParticipants * CALL_LIMITS.windowMinutes * 4000)
  assert.equal(OVERRUN_BOUND_MICROS, 800_000)
})

test('the Daily client sends rooms, extensions, presence and tokens to an injectable base URL', async () => {
  const calls = []
  const replies = {
    'POST /rooms': { name: 'share1-abcdefgh', url: 'https://example.daily.co/share1-abcdefgh', privacy: 'private' },
    'POST /rooms/share1-abcdefgh': { name: 'share1-abcdefgh' },
    'GET /rooms/share1-abcdefgh/presence': { total_count: 3, data: [] },
    'POST /meeting-tokens': { token: 'tok' },
    'DELETE /rooms/share1-abcdefgh': { deleted: true },
  }
  const client = dailyClient(async (url, options) => {
    const path = url.replace('http://127.0.0.1:3474/v1', '')
    calls.push({ method: options.method, path, body: options.body && JSON.parse(options.body) })
    const data = replies[options.method + ' ' + path]
    return { status: data ? 200 : 404, ok: Boolean(data), json: async () => data }
  }, 'fixture-key', null, 'http://127.0.0.1:3474/v1')
  const url = await client.createRoom(roomRequest({ name: 'share1-abcdefgh', now: T0 }))
  assert.equal(url, 'https://example.daily.co/share1-abcdefgh')
  await client.extendRoom('share1-abcdefgh', T0 + 20 * MIN)
  assert.equal(await client.presence('share1-abcdefgh'), 3)
  assert.equal(await client.token({ properties: { room_name: 'share1-abcdefgh' } }), 'tok')
  await client.deleteRoom('share1-abcdefgh')
  assert.deepEqual(calls.map(c => c.method + ' ' + c.path), Object.keys(replies))
  assert.deepEqual(calls[1].body, { properties: { exp: (T0 + 20 * MIN) / 1000 } })
  const failing = dailyClient(async () => ({ status: 500, ok: false, json: async () => ({}) }), 'k', null, 'http://127.0.0.1:3474/v1')
  assert.equal(await failing.presence('x'), null, 'presence failure is reported as unknown, not zero')
})
