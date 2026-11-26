// Voice tickets and voice.open (web/app/server/voice/tickets.mjs, open.mjs): a single-use ticket,
// stored only as its hash, alive 60 seconds, bound to the person, the voice part and the slate;
// minted only after every check (an account, slate access, the person's own switches, the
// administrator's off switch, a model to talk with, and on Cloud the meter), and the route checked
// again, with its key opened, when the socket says hello.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTickets, hashTicket, memoryTicketStore, TICKET_TTL_MS } from '../web/app/server/voice/tickets.mjs'
import { VOICE_COPY, VoiceError, createVoiceOpen } from '../web/app/server/voice/open.mjs'

function clock(start = 1_000_000) {
  let at = start
  return { now: () => at, advance: (ms) => { at += ms } }
}

test('a ticket: 32 random bytes, kept only as its SHA-256, good once, for 60 seconds, for what it was minted for', async () => {
  const store = memoryTicketStore()
  const time = clock()
  const tickets = createTickets({ store, now: time.now })
  const { ticket, expiresAt } = await tickets.mint({ userId: 'ana', surface: 'voice.chat', slateId: 'slate1' })
  assert.match(ticket, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(expiresAt.getTime(), time.now() + TICKET_TTL_MS)
  const [stored] = [...store.docs.values()]
  assert.equal(stored._id, hashTicket(ticket))
  assert.ok(!JSON.stringify(stored).includes(ticket), 'the ticket itself is never stored')
  assert.deepEqual(await tickets.redeem(ticket), { userId: 'ana', surface: 'voice.chat', slateId: 'slate1', resume: null })
  assert.equal(await tickets.redeem(ticket), null, 'good once')
  const late = await tickets.mint({ userId: 'ana', surface: 'voice.interview' })
  time.advance(TICKET_TTL_MS)
  assert.equal(await tickets.redeem(late.ticket), null, 'gone after 60 seconds')
  assert.equal(await tickets.redeem('x'.repeat(43)), null)
  assert.equal(await tickets.redeem('not a ticket'), null)
  assert.equal(await tickets.redeem(undefined), null)
})

test('a ticket is minted only for a person and a voice part; a reconnect ticket carries what the session needs to carry on', async () => {
  const tickets = createTickets({ store: memoryTicketStore() })
  await assert.rejects(tickets.mint({ userId: '', surface: 'voice.chat' }), /signed-in person/)
  await assert.rejects(tickets.mint({ userId: 'ana', surface: 'chat' }), /not a voice part/)
  await assert.rejects(tickets.mint({ userId: 'ana', surface: 'voice.chat', slateId: '../x' }), /slateId/)
  const { ticket } = await tickets.mint({ userId: 'ana', surface: 'voice.chat', slateId: 's1', resume: { handle: 'h1', earlier: 'x'.repeat(9000), sessionId: 'sess1', mode: 'ptt', elapsedMs: 120000, other: 'dropped' } })
  const taken = await tickets.redeem(ticket)
  assert.deepEqual(Object.keys(taken.resume).sort(), ['earlier', 'elapsedMs', 'handle', 'mode', 'sessionId'])
  assert.equal(taken.resume.elapsedMs, 120000, 'how long it ran: the time limit counts on from there')
  const odd = await tickets.redeem((await tickets.mint({ userId: 'ana', surface: 'voice.chat', resume: { mode: 'open', elapsedMs: -5 } })).ticket)
  assert.equal(odd.resume.elapsedMs, undefined)
  assert.equal(taken.resume.earlier.length, 8000, 'what was said is bounded (the latest words kept)')
})

// ---------- voice.open ----------
const USERS = { ana: { _id: 'ana' }, guest: { _id: 'guest', isAnonymous: true }, bo: { _id: 'bo' } }
const SLATES = { s1: { _id: 's1', shareId: 'share-1', userId: 'ana' } }
const VOICE = { ref: 'server:gemini-live', scope: 'server', own: false, connection: { model: 'gemini-3', baseUrl: 'wss://live.example', apiKey: 'AIza-k', voice: 'Kore', protocol: 'gemini-live', prices: null }, rules: null }

function opener(overrides = {}) {
  const calls = { meter: [], resolve: [] }
  const store = memoryTicketStore()
  const deps = {
    loadUser: async (id) => USERS[id] || null,
    findSlate: async ({ slateId, shareId }) => (slateId ? SLATES[slateId] : Object.values(SLATES).find((slate) => slate.shareId === shareId)) || null,
    canReadSlate: async (userId, slate) => slate.userId === userId,
    personRefusal: async (user, surface) => (surface === 'voice.interview' && user._id === 'bo' ? { code: 'personalization-off', message: 'Personalization is off.' } : null),
    surfaceOff: async () => null,
    resolve: async (opts) => { calls.resolve.push(opts); return VOICE },
    meterRefusal: async (opts) => { calls.meter.push(opts); return null },
    tickets: createTickets({ store }),
    ...overrides,
  }
  return { voice: createVoiceOpen(deps), calls, store, deps }
}

const code = async (promise) => {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof VoiceError, error.message)
    return error.code
  }
  return 'no error'
}

test('voice.open: a ticket for a signed-in person on a slate they may read, after the meter', async () => {
  const { voice, calls, store } = opener()
  const out = await voice.open('ana', { surface: 'voice.chat', slateId: 's1' })
  assert.deepEqual(Object.keys(out).sort(), ['expiresAt', 'path', 'surface', 'ticket', 'v'])
  assert.equal(out.path, '/voice/ws')
  assert.equal(store.docs.size, 1)
  assert.deepEqual(calls.resolve, [{ userId: 'ana', feature: 'voice-chat' }], 'no key is opened for a ticket')
  assert.deepEqual(calls.meter.map((m) => m.feature), ['voice-chat'])
  assert.ok(!JSON.stringify(out).includes('AIza-k'), 'no key in the answer')
  assert.equal((await voice.open('ana', { surface: 'voice.interview' })).surface, 'voice.interview')
})

test('voice.open refuses, in this order, before any ticket: the part, the account, the slate, the person\'s switches, the off switch, a model, the meter', async () => {
  const { voice, store } = opener()
  assert.equal(await code(voice.open('ana', { surface: 'chat' })), 'invalid')
  assert.equal(await code(voice.open('ana', { surface: 'voice.chat' })), 'invalid', 'a slate is needed to talk about it')
  assert.equal(await code(voice.open('ana', { surface: 'voice.interview', slateId: 's1' })), 'invalid')
  assert.equal(await code(voice.open(null, { surface: 'voice.interview' })), 'sign-in')
  assert.equal(await code(voice.open('guest', { surface: 'voice.interview' })), 'sign-up', 'guests have no voice')
  assert.equal(await code(voice.open('bo', { surface: 'voice.chat', slateId: 's1' })), 'slate-denied')
  assert.equal(await code(voice.open('ana', { surface: 'voice.chat', slateId: 'nope' })), 'slate-denied')
  assert.equal(await code(voice.open('bo', { surface: 'voice.interview' })), 'personalization-off')
  assert.equal(store.docs.size, 0)
  const off = opener({ surfaceOff: async () => ({ message: 'Voice is turned off by your administrator.' }) })
  assert.equal(await code(off.voice.open('ana', { surface: 'voice.interview' })), 'turned-off')
  const disabled = opener({ resolve: async () => ({ disabled: true, message: 'Off.' }) })
  assert.equal(await code(disabled.voice.open('ana', { surface: 'voice.interview' })), 'turned-off')
  const none = opener({ resolve: async () => ({ ref: 'builtin', connection: null, own: false, error: 'No model is set for this part of Slatebox.' }) })
  await assert.rejects(none.voice.open('ana', { surface: 'voice.interview' }), (error) => error.code === 'unavailable' && error.message === VOICE_COPY.noModel)
  const gap = opener({ resolve: async () => ({ ...VOICE, gap: { need: 'voice', message: 'my-text cannot talk.' } }) })
  await assert.rejects(gap.voice.open('ana', { surface: 'voice.interview' }), /cannot talk/)
  const broke = opener({ meterRefusal: async () => ({ code: 'pro-voice', message: 'Talking with the agent comes with Slatebox Pro.', pay: { action: 'pro', wallet: null } }) })
  await assert.rejects(broke.voice.open('ana', { surface: 'voice.interview' }), (error) => error.code === 'pro-voice' && error.details.pay.action === 'pro')
  assert.equal(broke.store.docs.size, 0)
})

test('voice.open by the share id a page has: the ticket keeps the slate\'s own id; both ids at once is refused', async () => {
  const { voice, store } = opener()
  const out = await voice.open('ana', { surface: 'voice.chat', shareId: 'share-1' })
  assert.equal(store.docs.size, 1)
  const tickets = createTickets({ store })
  assert.equal((await tickets.redeem(out.ticket)).slateId, 's1')
  assert.equal(await code(voice.open('ana', { surface: 'voice.chat', shareId: 'share-1', slateId: 's1' })), 'invalid')
  assert.equal(await code(voice.open('ana', { surface: 'voice.chat', shareId: '../x' })), 'invalid')
  assert.equal(await code(voice.open('ana', { surface: 'voice.chat', shareId: 'nope' })), 'slate-denied')
  assert.equal(await code(voice.open('ana', { surface: 'voice.interview', shareId: 'share-1' })), 'invalid')
})

test('voice.status: offered when a ticket would be minted or the pay sheet answers the refusal; hidden for guests, off, or nothing to talk with; never a ticket', async () => {
  const { voice, store } = opener()
  assert.deepEqual(await voice.status('ana', { surface: 'voice.chat' }), { available: true })
  assert.equal((await voice.status('guest', { surface: 'voice.chat' })).available, false)
  assert.equal((await voice.status(null, { surface: 'voice.chat' })).available, false)
  assert.equal((await voice.status('bo', { surface: 'voice.interview' })).available, false, 'the person\'s own switch for the interview')
  assert.equal(store.docs.size, 0)
  const off = opener({ surfaceOff: async () => ({ message: 'Off.' }) })
  assert.deepEqual(await off.voice.status('ana', { surface: 'voice.chat' }), { available: false, code: 'turned-off', message: 'Off.' })
  const none = opener({ resolve: async () => ({ ref: 'builtin', connection: null, own: false, error: 'No model.' }) })
  assert.equal((await none.voice.status('ana', { surface: 'voice.interview' })).available, false)
  const broke = opener({ meterRefusal: async () => ({ code: 'pro-voice', message: 'Talking with the agent comes with Slatebox Pro.', pay: { action: 'pro', wallet: null } }) })
  assert.deepEqual(await broke.voice.status('ana', { surface: 'voice.interview' }), { available: true, code: 'pro-voice', message: 'Talking with the agent comes with Slatebox Pro.', pay: { action: 'pro', wallet: null } })
  assert.equal(await code(voice.status('ana', { surface: 'chat' })), 'invalid')
})

test('voice.open on the person\'s own key never asks the meter', async () => {
  const { voice, calls } = opener({ resolve: async () => ({ ...VOICE, ref: 'me:my-voice', scope: 'me', own: true }) })
  await voice.open('ana', { surface: 'voice.interview' })
  assert.deepEqual(calls.meter, [])
})

test('at hello the route is read again, with its key opened now; signed out or turned off in between, it is refused', async () => {
  const { voice, calls } = opener()
  const ready = await voice.prepare({ userId: 'ana', surface: 'voice.chat', slateId: 's1' }, { protocolOf: (c) => c.protocol, priceOf: () => ({ model: 'p' }) })
  assert.deepEqual(calls.resolve.at(-1), { userId: 'ana', feature: 'voice-chat', forRequest: true })
  assert.deepEqual(ready, {
    protocol: 'gemini-live', connection: { baseUrl: 'wss://live.example', apiKey: 'AIza-k', model: 'gemini-3', voice: 'Kore', transcriptionModel: null },
    rules: null, own: false, model: 'gemini-3', price: { model: 'p' },
  })
  const gone = await voice.prepare({ userId: 'guest', surface: 'voice.chat' }, { protocolOf: () => null, priceOf: () => null })
  assert.equal(gone.error, 'denied')
  const off = opener({ surfaceOff: async () => ({ message: 'Off now.' }) })
  assert.deepEqual(await off.voice.prepare({ userId: 'ana', surface: 'voice.chat' }, { protocolOf: () => null, priceOf: () => null }), { error: 'turned-off', message: 'Off now.' })
  const keyless = opener({ resolve: async () => ({ ...VOICE, connection: { ...VOICE.connection, apiKey: undefined } }) })
  assert.equal((await keyless.voice.prepare({ userId: 'ana', surface: 'voice.chat' }, { protocolOf: () => null, priceOf: () => null })).error, 'unavailable')
})

test('voice.open refuses a person who already has as many voice sessions open as one may (another tab), before any ticket', async () => {
  const { voice, store } = opener({ openSessions: async (userId) => (userId === 'ana' ? 2 : 0), perPerson: () => 2 })
  assert.equal(await code(voice.open('ana', { surface: 'voice.chat', slateId: 's1' })), 'voice-busy')
  assert.equal(store.docs.size, 0)
  const fewer = opener({ openSessions: async () => 1, perPerson: () => 2 })
  assert.ok((await fewer.voice.open('ana', { surface: 'voice.interview' })).ticket)
})
