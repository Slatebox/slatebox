// The browser's side of a voice session, as pure rules (web/app/imports/api/common/voice-client.mjs
// and voice-answers.mjs): the session's state machine from the mic button to closing (and the
// reconnect a moving server hands over), captions of both sides, which agent audio still plays after
// an interrupt, the played messages (once a turn), what a tool call answers, and the page's words
// about voice.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ACTIVITY_WORDS, CLOSING_WORDS, MIC_NOTE, NOTICE_WORDS, START_WORDS, VOICE_WORDS, WORKLET_URL, applyTranscript, clampMs, createPlayedLedger, createTurnGate,
  initialVoiceState, micError, needsLoopback, noteSeen, peekCarry, reasonOfCode, rememberNote, samplesToMs, saveCarry, saveMode, savedMode, sendsMic,
  socketUrl, startMode, statusLine, takeCarry, toolResult, toolSummary, voiceReducer,
} from '../web/app/imports/api/common/voice-client.mjs'
import { ANSWER, ANSWER_WORDS, interviewAnswer, keptFactsAnswer, previewAnswer, replyAnswer } from '../web/app/imports/api/common/voice-answers.mjs'
import { ANSWER_CODES, CLOSE_CODES, CLOSING_REASONS, LIMITS, parseServerMessage, serverMessage } from '../web/app/imports/api/common/voice-protocol.mjs'

const run = (events, from = initialVoiceState) => events.reduce((state, event, i) => voiceReducer(state, event, i), from)
const server = (type, fields) => ({ type: 'server', msg: parseServerMessage(serverMessage(type, fields)) })
const READY = { sessionId: 's1', v: 1, inRate: 16000, outRate: 24000, mode: 'open', resumed: false, limits: { maxMinutes: 30, idleSeconds: 300 } }
const live = (mode = 'open') => run([{ type: 'start' }, { type: 'connecting' }, server('ready', { ...READY, mode })])

test('the mic button to live: starting, connecting, then ready gives the rates and the mode, listening', () => {
  let s = run([{ type: 'start' }])
  assert.equal(s.phase, 'starting')
  assert.equal(statusLine(s), VOICE_WORDS.starting)
  assert.equal(voiceReducer(s, { type: 'start' }), s, 'pressed twice: one session')
  s = voiceReducer(s, { type: 'connecting' })
  assert.equal(s.phase, 'connecting')
  s = voiceReducer(s, server('ready', READY), 5)
  assert.equal(s.phase, 'live')
  assert.equal(s.inRate, 16000)
  assert.equal(s.outRate, 24000)
  assert.equal(s.activity, 'listening')
  assert.equal(statusLine(s), ACTIVITY_WORDS.listening)
  assert.match(s.announce.words, /Voice is on/)
  assert.ok(sendsMic(s), 'open mic sends while live')
})

test('activity: speaking, then listening again; a tool keeps its row (with what it is doing) until its answer goes back', () => {
  let s = live()
  s = voiceReducer(s, server('activity', { kind: 'speaking', state: 'started', turn: 1 }))
  assert.equal(statusLine(s), ACTIVITY_WORDS.speaking)
  // made, not yet heard: the agent is still speaking until its turn has played out
  s = voiceReducer(s, server('activity', { kind: 'speaking', state: 'done', turn: 1 }))
  assert.equal(s.activity, 'speaking')
  assert.equal(statusLine(s), ACTIVITY_WORDS.speaking)
  assert.equal(voiceReducer(s, { type: 'heard', turn: 0 }), s, 'an older turn heard changes nothing')
  s = voiceReducer(s, { type: 'heard', turn: 1 })
  assert.equal(s.activity, 'listening')
  // cut off: listening at once
  const cut = voiceReducer(voiceReducer(voiceReducer(live(), server('activity', { kind: 'speaking', state: 'started', turn: 2 })), server('activity', { kind: 'speaking', state: 'done', turn: 2 })), server('interrupt', { turn: 2 }))
  assert.equal(cut.activity, 'listening')
  s = voiceReducer(s, server('transcript', { turn: 1, role: 'user', text: 'Add three notes', final: true }))
  assert.equal(s.activity, 'thinking', 'what the person said is final: the agent thinks')
  s = voiceReducer(s, server('activity', { kind: 'tool', state: 'started', name: 'send_to_slatebox' }))
  s = voiceReducer(s, { type: 'tool-start', id: 't1', args: { text: 'Add three notes about the launch' } })
  assert.equal(statusLine(s), 'Working on it: Add three notes about the launch')
  assert.equal(voiceReducer(s, server('activity', { kind: 'listening', state: 'started' })).activity, 'tool', 'listening does not hide a running tool')
  s = voiceReducer(s, { type: 'tool-done', id: 'other' })
  assert.equal(s.tool.id, 't1')
  s = voiceReducer(s, { type: 'tool-done', id: 't1' })
  assert.equal(s.tool, null)
  assert.equal(s.activity, 'thinking')
  const canceled = voiceReducer(voiceReducer(live(), { type: 'tool-start', id: 't2', args: { text: 'x' } }), server('tool_cancel', { id: 't2' }))
  assert.equal(canceled.tool, null)
  assert.equal(canceled.activity, 'listening')
})

test('what a tool call is doing, in a few words: keep, discard, the request, or getting started', () => {
  assert.equal(toolSummary({ text: 'yes', confirm: 'keep' }), 'Keeping the change')
  assert.equal(toolSummary({ text: 'no', confirm: 'discard' }), 'Discarding the preview')
  assert.equal(toolSummary({ text: '' }), 'Getting started')
  assert.equal(toolSummary({ text: 'a'.repeat(200) }).length, 80)
  assert.equal(toolSummary('{"text":"Add  a   note"}'), 'Add a note')
  assert.equal(toolSummary({ confirm: 'maybe' }), '')
})

test('captions: one row per role and turn, a partial row grows until final, a final row never goes back, the newest six', () => {
  let c = applyTranscript([], { role: 'user', turn: 1, text: 'Add', final: false })
  c = applyTranscript(c, { role: 'user', turn: 1, text: 'Add a note', final: false })
  c = applyTranscript(c, { role: 'agent', turn: 1, text: 'Sure', final: false })
  c = applyTranscript(c, { role: 'user', turn: 1, text: 'Add a note please', final: true })
  assert.deepEqual(c.map((r) => [r.key, r.text, r.final]), [['user:1', 'Add a note please', true], ['agent:1', 'Sure', false]])
  assert.equal(applyTranscript(c, { role: 'user', turn: 1, text: 'Add', final: false }), c, 'a late partial does not undo a final row')
  assert.equal(applyTranscript(c, { role: 'user', turn: 2, text: '  ', final: false }), c, 'nothing said, no row')
  for (let t = 2; t < 10; t += 1) c = applyTranscript(c, { role: 'agent', turn: t, text: `turn ${t}`, final: true })
  assert.equal(c.length, 6)
  assert.equal(c.at(-1).key, 'agent:9')
  // a screen reader hears the person's own final words, not every partial, and not the agent's
  // (already heard through the speakers: announcing them talks over the agent)
  const s = voiceReducer(live(), server('transcript', { turn: 1, role: 'user', text: 'Hello there', final: true }), 9)
  assert.deepEqual(s.announce, { words: 'You: Hello there', at: 9 })
  const partial = voiceReducer(s, server('transcript', { turn: 2, role: 'user', text: 'Hm', final: false }), 10)
  assert.equal(partial.announce, s.announce)
  const agent = voiceReducer(s, server('transcript', { turn: 1, role: 'agent', text: 'Sure.', final: true }), 11)
  assert.equal(agent.announce, s.announce)
  assert.equal(agent.captions.at(-1).text, 'Sure.', 'the agent\'s words are still in the captions')
})

test('push to talk: the mic sends only while held; switching mode lets go; a new ready keeps the session live', () => {
  let s = live('ptt')
  assert.equal(statusLine(s), VOICE_WORDS.hold)
  assert.equal(sendsMic(s), false)
  s = voiceReducer(s, { type: 'press' })
  assert.equal(sendsMic(s), true)
  assert.equal(statusLine(s), VOICE_WORDS.holding)
  s = voiceReducer(s, { type: 'release' })
  assert.equal(sendsMic(s), false)
  assert.equal(voiceReducer(live('open'), { type: 'press' }).pressed, false, 'nothing to hold in open mic')
  s = voiceReducer(voiceReducer(s, { type: 'press' }), { type: 'mode', mode: 'open' })
  assert.equal(s.pressed, false)
  s = voiceReducer(s, server('ready', { ...READY, mode: 'open', resumed: true }))
  assert.equal(s.phase, 'live')
  assert.equal(s.mode, 'open')
  assert.equal(voiceReducer(s, { type: 'mode', mode: 'loud' }), s)
})

test('closing: plain words (the relay\'s own, else the page\'s), and a moving server\'s ticket reconnects instead of ending', () => {
  const capped = voiceReducer(live(), server('closing', { reason: 'cap', message: 'Your credits ran out.' }), 3)
  assert.equal(capped.phase, 'ended')
  assert.deepEqual(capped.closing, { reason: 'cap', message: 'Your credits ran out.' })
  assert.equal(capped.announce.words, 'Your credits ran out.')
  assert.equal(voiceReducer(live(), server('closing', { reason: 'idle', message: '' })).closing.message, CLOSING_WORDS.idle)
  const moving = voiceReducer(live(), server('closing', { reason: 'moving', message: 'Reconnecting voice…', reconnect: { ticket: 'x'.repeat(32) } }))
  assert.equal(moving.phase, 'reconnecting')
  assert.equal(statusLine(moving), VOICE_WORDS.reconnecting)
  // the hook tries the ticket again while it lasts; when it gives up, the session ends as lost
  const gaveUp = voiceReducer(moving, { type: 'socket-closed', code: 1006 })
  assert.deepEqual([gaveUp.phase, gaveUp.closing.reason], ['ended', 'lost'])
  const again = voiceReducer(voiceReducer(moving, { type: 'connecting' }), server('ready', { ...READY, resumed: true }), 7)
  assert.equal(again.phase, 'live')
  assert.equal(again.activity, 'listening')
  assert.equal(again.announce, moving.announce, '"Voice is on" is not said again after a reconnect')
  const lost = voiceReducer(live(), { type: 'socket-closed', code: 1006 })
  assert.equal(lost.closing.reason, 'lost')
  assert.equal(lost.closing.message, CLOSING_WORDS.lost)
  assert.equal(voiceReducer(live(), { type: 'socket-closed', code: 4006 }).closing.reason, 'busy')
  assert.equal(voiceReducer(lost, server('ready', READY)), lost, 'an ended session takes no more messages')
  for (const reason of CLOSING_REASONS) {
    assert.equal(reasonOfCode(CLOSE_CODES[reason]), reason)
    assert.ok(CLOSING_WORDS[reason], reason)
  }
})

test('stop ends the session as the person ended it; a failure says why in plain words, with a pay refusal kept for the pay sheet', () => {
  const stopped = voiceReducer(live(), { type: 'stop' })
  assert.equal(stopped.phase, 'ended')
  assert.equal(stopped.closing.reason, 'ended')
  assert.equal(voiceReducer(initialVoiceState, { type: 'stop' }), initialVoiceState)
  const refused = run([{ type: 'start' }, { type: 'failed', error: { code: 'pro-voice', message: 'Talking with the agent comes with Slatebox Pro.', details: { pay: { action: 'pro' } } } }])
  assert.equal(refused.phase, 'ended')
  assert.deepEqual(refused.error, { code: 'pro-voice', message: 'Talking with the agent comes with Slatebox Pro.', details: { pay: { action: 'pro' } } })
  assert.equal(run([{ type: 'failed', error: {} }]).error.message, START_WORDS.failed)
  const again = voiceReducer(refused, { type: 'start' })
  assert.equal(again.phase, 'starting')
  assert.equal(again.error, null, 'a new start clears the last error')
  assert.equal(voiceReducer(voiceReducer(live('ptt'), { type: 'stop' }), { type: 'start' }).mode, 'ptt', 'the mode is remembered')
})

test('a microphone that cannot be used is said plainly', () => {
  assert.equal(micError({ name: 'NotAllowedError' }), START_WORDS.micBlocked)
  assert.equal(micError({ name: 'NotFoundError' }), START_WORDS.micMissing)
  assert.equal(micError({ name: 'NotReadableError' }), START_WORDS.micBusy)
  assert.equal(micError(new Error('x')), START_WORDS.failed)
})

test('agent audio after an interrupt: that turn\'s frames still in flight, and older turns\', are dropped', () => {
  const gate = createTurnGate()
  assert.ok(gate.plays(1))
  gate.cut(2)
  assert.equal(gate.plays(1), false)
  assert.equal(gate.plays(2), false)
  assert.ok(gate.plays(3))
  gate.cut(1)
  assert.equal(gate.plays(2), false, 'a cut never moves back')
  assert.equal(gate.plays(-1), false)
})

test('played: once a turn, in whole milliseconds within the protocol\'s bounds', () => {
  const ledger = createPlayedLedger()
  assert.deepEqual(ledger.report(1, 1234.9), { type: 'played', turn: 1, ms: 1234 })
  assert.equal(ledger.report(1, 2000), null, 'never twice')
  assert.deepEqual(ledger.report(2, -5), { type: 'played', turn: 2, ms: 0 })
  assert.equal(ledger.report(-1, 5), null)
  assert.equal(clampMs(LIMITS.playedMs * 2), LIMITS.playedMs)
  assert.equal(samplesToMs(24000, 24000), 1000)
  assert.equal(samplesToMs(4800, 48000), 100)
  const small = createPlayedLedger({ keep: 2 })
  small.report(1, 0)
  small.report(2, 0)
  small.report(3, 0)
  assert.ok(small.report(1, 0), 'only the latest turns are remembered')
})

test('a tool call\'s answer: the surface\'s reply text, or its refusal as a failed answer, bounded', () => {
  assert.deepEqual(toolResult('t1', 'Added 3 notes.'), { type: 'tool_result', id: 't1', output: 'Added 3 notes.', ok: true })
  assert.deepEqual(toolResult('t1', { text: 'Could not save.', ok: false }), { type: 'tool_result', id: 't1', output: 'Could not save.', ok: false })
  assert.deepEqual(toolResult('t1', Object.assign(new Error('x'), { reason: 'You can only view this slate.' })), { type: 'tool_result', id: 't1', output: 'You can only view this slate.', ok: false })
  assert.equal(toolResult('t1', 'x'.repeat(LIMITS.toolOutput + 50)).output.length, LIMITS.toolOutput)
  // nothing answered is never an empty answer: busy (the relay says it in the registry's words)
  assert.deepEqual(toolResult('t1', undefined), { type: 'tool_result', id: 't1', code: 'busy', ok: true })
  assert.deepEqual(toolResult('t1', ''), { type: 'tool_result', id: 't1', code: 'busy', ok: true })
  for (const code of ANSWER_CODES) assert.deepEqual(toolResult('t1', { code }), { type: 'tool_result', id: 't1', code, ok: true })
  assert.deepEqual(Object.values(ANSWER).map((a) => a.code).filter((c) => !ANSWER_CODES.includes(c)), [])
})

test('the socket is same-origin; the worklet is served from public/; Chromium plays through the loopback, Firefox and Safari do not need it', () => {
  assert.equal(socketUrl({ protocol: 'https:', host: 'app.example.com' }), 'wss://app.example.com/voice/ws')
  assert.equal(socketUrl({ protocol: 'http:', host: 'localhost:3000' }), 'ws://localhost:3000/voice/ws')
  assert.match(WORKLET_URL, /^\/voice\/voice-worklet\.js\?v=\d+$/)
  assert.ok(readFileSync(new URL('../web/app/public/voice/voice-worklet.js', import.meta.url), 'utf8').length > 0)
  const chrome = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
  assert.equal(needsLoopback({ userAgent: chrome, hasPeerConnection: true }), true)
  assert.equal(needsLoopback({ userAgent: chrome, hasPeerConnection: false }), false)
  assert.equal(needsLoopback({ userAgent: 'Mozilla/5.0 (Macintosh; rv:133.0) Gecko/20100101 Firefox/133.0', hasPeerConnection: true }), false)
  assert.equal(needsLoopback({ userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', hasPeerConnection: true }), false)
  assert.equal(needsLoopback({ brands: [{ brand: 'Microsoft Edge' }], hasPeerConnection: true }), true)
})

test('the mic note: shown once on a device; storage that refuses means it shows again', () => {
  const store = new Map()
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  assert.equal(noteSeen(storage), false)
  rememberNote(storage)
  assert.equal(noteSeen(storage), true)
  const refusing = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } }
  assert.equal(noteSeen(refusing), false)
  assert.doesNotThrow(() => rememberNote(refusing))
  // where the voice goes, what is not kept, and what is (only what the agent passes on: captions are never stored)
  assert.equal(MIC_NOTE, 'Your voice goes to the agent\'s voice service while the mic is on. Slatebox keeps no audio. What the agent passes on for you is kept as text in this conversation.')
})

test('the words: "agent", not "AI"; US spelling; nothing about paying', () => {
  const words = JSON.stringify({ ACTIVITY_WORDS, CLOSING_WORDS, START_WORDS, VOICE_WORDS, NOTICE_WORDS, MIC_NOTE, ANSWER_WORDS })
  assert.doesNotMatch(words, /\bAI\b/)
  assert.doesNotMatch(words, /\b(colour|behaviour|organis|recognis|cancell(ed|ing)|centre|licence)/i)
  assert.doesNotMatch(words, /\b(pay|paid|payment|credit|card|balance|top up|Pro\b|price|\$)/i)
})

test('what a tool call answers is the screen\'s own words, flattened to sentences: a preview waiting to keep, a reply, the interview\'s proposals', () => {
  const said = previewAnswer({ heading: 'Agent preview · Drawing · 2 connections', labels: ['Plan', 'Build', 'Ship'], changes: [{ before: 'Old', after: 'New' }],
    removed: [{ text: 'Gone' }], warnings: ['This removes a note or connection.'], extra: [null, 'Keep this to add a retro.'].filter(Boolean) })
  assert.equal(said, 'Agent preview, Drawing, 2 connections. ' + ANSWER_WORDS.shown + ' It adds: Plan; Build; Ship. It rewrites 1 note: Old becomes New. It removes 1 note: Gone. This removes a note or connection. Keep this to add a retro.')
  assert.match(previewAnswer({ labels: Array.from({ length: 12 }, (_, i) => `n${i}`) }), /n7; and 4 more\./)
  assert.equal(replyAnswer('Here you go'), 'Here you go.')
  assert.equal(replyAnswer('Done!'), 'Done!')
  assert.equal(interviewAnswer('What do you do?', []), 'What do you do?')
  assert.equal(interviewAnswer('Nice. What next?', [{ kind: 'role', text: 'Product manager' }], (k) => (k === 'role' ? 'Role' : k)),
    `Nice. What next? Proposed for About you: Role: Product manager. ${ANSWER_WORDS.interviewKeep}`)
  assert.deepEqual(keptFactsAnswer([]), { code: 'none' })
  assert.equal(keptFactsAnswer([{ text: 'PM', state: 'kept' }, { text: 'NYC', state: 'had' }, { text: 'x', error: 'About you is full.' }]), 'Kept: PM. You already had: NYC. x: About you is full.')
  assert.ok(previewAnswer({ labels: ['x'.repeat(LIMITS.toolOutput)] }).length <= LIMITS.toolOutput)
})

test('a minute before voice turns off on its own, the page says so (and the quiet one goes when someone speaks)', () => {
  let s = voiceReducer(live(), server('notice', { reason: 'idle', seconds: 60 }), 4)
  assert.equal(s.notice, NOTICE_WORDS.idle)
  assert.deepEqual(s.announce, { words: NOTICE_WORDS.idle, at: 4 })
  s = voiceReducer(s, server('transcript', { turn: 1, role: 'user', text: 'Still here', final: false }))
  assert.equal(s.notice, null)
  const limit = voiceReducer(live(), server('notice', { reason: 'limit', seconds: 60 }))
  assert.equal(voiceReducer(limit, server('transcript', { turn: 1, role: 'user', text: 'ok', final: true })).notice, NOTICE_WORDS.limit, 'the time limit stays said')
  assert.equal(voiceReducer(limit, { type: 'stop' }).notice, null)
})

test('captions of the person are off on a connection that has none (ready says so)', () => {
  assert.equal(live().userCaptions, true)
  const off = voiceReducer(run([{ type: 'start' }, { type: 'connecting' }]), server('ready', { ...READY, userCaptions: false }))
  assert.equal(off.userCaptions, false)
})

test('open mic or push to talk: the person\'s last choice; where the agent may hear itself, push to talk', () => {
  const store = new Map()
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  assert.equal(savedMode(storage), null)
  assert.equal(startMode({ saved: null, echoRisk: false }), 'open')
  assert.equal(startMode({ saved: null, echoRisk: true }), 'ptt')
  saveMode(storage, 'open')
  assert.equal(startMode({ saved: savedMode(storage), echoRisk: true }), 'open', 'a choice made stays made')
  saveMode(storage, 'loud')
  assert.equal(savedMode(storage), 'open')
})

test('carrying on after a reload: the ticket for this surface and slate only, for about a minute, taken once', () => {
  const store = new Map()
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
  saveCarry(storage, { surface: 'voice.chat', shareId: 's1', ticket: 't'.repeat(43), mode: 'ptt' }, 1000)
  assert.equal(peekCarry(storage, { surface: 'voice.chat', shareId: 's2' }, 2000), null, 'another slate')
  assert.equal(peekCarry(storage, { surface: 'voice.interview' }, 2000), null, 'another part')
  assert.equal(peekCarry(storage, { surface: 'voice.chat', shareId: 's1' }, 1000 + 60_000), null, 'too late')
  assert.deepEqual(peekCarry(storage, { surface: 'voice.chat', shareId: 's1' }, 2000), { ticket: 't'.repeat(43), mode: 'ptt' })
  assert.deepEqual(takeCarry(storage, { surface: 'voice.chat', shareId: 's1' }, 2000), { ticket: 't'.repeat(43), mode: 'ptt' })
  assert.equal(takeCarry(storage, { surface: 'voice.chat', shareId: 's1' }, 2000), null, 'once')
})
