// The voice audio worklet (web/app/public/voice/voice-worklet.js), run here as the browser's audio
// thread runs it: the resampler (48 kHz mic to the relay's 16 or 24 kHz, the agent's 24 kHz to the
// speakers), the PCM16 framer, and the playback queue that is flushed on an interrupt and reports
// how much of each agent turn was heard. Then the two processors themselves, against a stub
// AudioWorkletGlobalScope.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SOURCE = readFileSync(new URL('../web/app/public/voice/voice-worklet.js', import.meta.url), 'utf8')

function load(extra = {}) {
  const context = vm.createContext({ Math, Float32Array, Int16Array, Uint8Array, ArrayBuffer, DataView, Map, Set, Error, ...extra })
  vm.runInContext(SOURCE, context, { filename: 'voice-worklet.js' })
  return context
}
const { Resampler, Framer, PlaybackQueue, pcmToFloat, toInt16, samplesMs, littleEndian } = load().SlateboxVoiceAudio

const sine = (rate, hz, ms, amp = 0.5) => Float32Array.from({ length: Math.round((rate * ms) / 1000) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate))
// values made in the worklet's own realm, compared as plain data
const plain = (x) => JSON.parse(JSON.stringify(x))
const rms = (x) => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length)

test('the worklet is plain browser JavaScript: no import, no require, nothing to build', () => {
  assert.doesNotMatch(SOURCE, /^\s*import\s|require\(/m)
  assert.match(SOURCE, /registerProcessor\('sb-voice-capture'/)
  assert.match(SOURCE, /registerProcessor\('sb-voice-playback'/)
})

test('resampling 48 kHz to 16 kHz and 24 kHz: a third and a half of the samples, continuous across blocks of any size', () => {
  for (const to of [16000, 24000]) {
    const whole = new Resampler(48000, to).process(sine(48000, 440, 1000))
    const r = new Resampler(48000, to)
    const input = sine(48000, 440, 1000)
    const parts = []
    for (let at = 0; at < input.length; at += 128) parts.push(...r.process(input.subarray(at, at + 128)))
    assert.ok(Math.abs(parts.length - to) <= 2, `${parts.length} samples for one second at ${to}`)
    assert.ok(Math.abs(whole.length - parts.length) <= 1)
    // block by block is the same signal as all at once
    for (let i = 0; i < 2000; i += 97) assert.ok(Math.abs(parts[i] - whole[i]) < 1e-5, `sample ${i}`)
  }
})

test('speech survives resampling; what is above the new rate\'s half is filtered out rather than folded into speech', () => {
  const speech = new Resampler(48000, 16000).process(sine(48000, 440, 500))
  assert.ok(Math.abs(rms(speech.subarray(200)) - 0.5 / Math.SQRT2) < 0.02, 'a 440 Hz tone keeps its level')
  const high = new Resampler(48000, 16000).process(sine(48000, 12000, 500))
  assert.ok(rms(high.subarray(200)) < 0.05, `a 12 kHz tone is filtered (${rms(high.subarray(200)).toFixed(3)})`)
})

test('resampling up (the agent\'s 24 kHz to 48 kHz) doubles the samples and keeps the level; the same rate is a copy', () => {
  const up = new Resampler(24000, 48000).process(sine(24000, 300, 1000))
  assert.ok(Math.abs(up.length - 48000) <= 2)
  assert.ok(Math.abs(rms(up.subarray(100)) - 0.5 / Math.SQRT2) < 0.02)
  const same = new Resampler(24000, 24000)
  const input = sine(24000, 300, 20)
  assert.deepEqual([...same.process(input)], [...input])
  assert.throws(() => new Resampler(0, 16000))
})

test('PCM16 frames: 20 ms each (320 samples at 16 kHz, 480 at 24 kHz), little-endian, clamped', () => {
  assert.equal(new Framer(16000).size, 320)
  assert.equal(new Framer(24000).size, 480)
  assert.equal(new Framer(24000, 40).size, 960)
  const f = new Framer(16000)
  assert.equal(f.push(new Float32Array(319)).length, 0, 'not a frame yet')
  const frames = f.push(Float32Array.from([1, 0.5, -0.25, 2, -2]))
  assert.equal(frames.length, 1)
  assert.equal(frames[0].byteLength, 640)
  const view = new DataView(frames[0])
  assert.equal(view.getInt16(638, true), 32767, 'full scale positive')
  assert.equal(f.fill, 4, 'the rest waits for the next frame')
  assert.equal(toInt16(-1), -32768)
  assert.equal(toInt16(3), 32767)
  assert.equal(toInt16(NaN), 0)
  // the bytes are little-endian whatever the machine
  const bytes = new Uint8Array(littleEndian(Int16Array.from([0x0102])))
  assert.deepEqual([...bytes], [0x02, 0x01])
  assert.ok(Math.abs(pcmToFloat(littleEndian(Int16Array.from([16384, -16384])))[0] - 0.5) < 1e-3)
})

test('played ms: whole milliseconds of what played, at the output rate', () => {
  assert.equal(samplesMs(48000, 48000), 1000)
  assert.equal(samplesMs(479, 48000), 9)
  assert.equal(samplesMs(0, 24000), 0)
})

test('the playback queue plays turns in order and reports a finished turn once, after its last sample', () => {
  const q = new PlaybackQueue(48000)
  q.push(1, new Float32Array(4800).fill(0.1))
  q.push(1, new Float32Array(4800).fill(0.2))
  assert.deepEqual(plain(q.end(1)), [], 'still queued: reported when it has played')
  const out = new Float32Array(128)
  let events = []
  let blocks = 0
  while (!events.length && blocks < 1000) { events = q.pull(out); blocks += 1 }
  assert.deepEqual(plain(events), [{ type: 'played', turn: 1, ms: 200 }])
  assert.deepEqual(plain(q.pull(out)), [])
  assert.ok(out.every((v) => v === 0), 'silence when nothing is queued')
  assert.deepEqual(plain(q.end(1)), [], 'never twice')
  assert.deepEqual(plain(q.push(1, new Float32Array(10))), [])
  assert.equal(q.chunks.length, 0, 'late audio of a reported turn is not played')
})

test('an interrupt flushes everything queued and reports what was heard of the turn so far', () => {
  const q = new PlaybackQueue(48000)
  q.push(3, new Float32Array(48000))
  const out = new Float32Array(4800)
  q.pull(out)
  q.pull(out)
  assert.deepEqual(plain(q.flush(3)), [{ type: 'played', turn: 3, ms: 200 }])
  assert.equal(q.chunks.length, 0)
  assert.deepEqual(plain(q.flush(4)), [{ type: 'played', turn: 4, ms: 0 }], 'a turn that never started playing was heard for 0 ms')
  assert.deepEqual(plain(q.end(5)), [{ type: 'played', turn: 5, ms: 0 }], 'a turn with no audio ends at once')
})

test('the processors: capture posts PCM16 frames at the relay\'s rate; playback plays, flushes and reports with its epoch', () => {
  const registered = {}
  class AudioWorkletProcessor {
    constructor() {
      this.posted = []
      this.port = { postMessage: (msg) => this.posted.push(msg), onmessage: null }
    }
  }
  load({ sampleRate: 48000, AudioWorkletProcessor, registerProcessor: (name, cls) => { registered[name] = cls } })
  assert.deepEqual(Object.keys(registered).sort(), ['sb-voice-capture', 'sb-voice-playback'])

  const capture = new registered['sb-voice-capture']({ processorOptions: { rate: 16000, frameMs: 20 } })
  for (let i = 0; i < 10; i += 1) assert.equal(capture.process([[sine(48000, 300, 128 / 48)]]), true)
  const frames = capture.posted.filter((m) => m.type === 'frame')
  assert.equal(frames.length, 1, '1280 samples at 48 kHz are 26 ms: one 20 ms frame')
  assert.equal(frames[0].pcm.byteLength, 640)
  capture.port.onmessage({ data: { type: 'rate', rate: 24000 } })
  for (let i = 0; i < 10; i += 1) capture.process([[sine(48000, 300, 128 / 48)]])
  assert.equal(capture.posted.at(-1).pcm.byteLength, 960, 'a new ready\'s rate: 480 samples a frame')
  assert.equal(capture.process([[]]), true, 'no input yet is not an error')

  const play = new registered['sb-voice-playback']({ processorOptions: { rate: 24000 } })
  const pcm = littleEndian(Int16Array.from({ length: 2400 }, () => 8000))
  play.port.onmessage({ data: { type: 'push', turn: 1, pcm } })
  const out = [new Float32Array(128), new Float32Array(128)]
  play.process([], [out])
  assert.ok(out[0].some((v) => v > 0.2), 'agent audio plays')
  assert.deepEqual([...out[1]], [...out[0]], 'the same on every channel')
  play.port.onmessage({ data: { type: 'flush', turn: 1 } })
  assert.deepEqual(plain(play.posted.at(-1)), { type: 'played', turn: 1, ms: 2, epoch: 0 })
  play.port.onmessage({ data: { type: 'reset', epoch: 2 } })
  play.port.onmessage({ data: { type: 'push', turn: 1, pcm } })
  play.port.onmessage({ data: { type: 'end', turn: 1 } })
  let posted = play.posted.length
  for (let i = 0; i < 100 && play.posted.length === posted; i += 1) play.process([], [out])
  assert.deepEqual(plain(play.posted.at(-1)), { type: 'played', turn: 1, ms: 100, epoch: 2 }, 'after a reset the turns count afresh, under the new epoch')
  posted = play.posted.length
  play.process([], [out])
  assert.equal(play.posted.length, posted)
})
