// Voice audio, inside the browser's audio thread (AudioWorklet). Served as it is from public/ (Meteor
// serves public/voice/voice-worklet.js at /voice/voice-worklet.js); plain browser JavaScript, no
// imports, nothing built. Two processors:
//
//   sb-voice-capture   the microphone, at the audio context's rate (often 48 kHz), resampled to the
//                      rate the relay's ready gave (16 kHz for Gemini Live, 24 kHz for OpenAI
//                      Realtime) and posted as PCM16 little-endian mono frames of frameMs (20 ms by
//                      default): { type: 'frame', pcm: ArrayBuffer }. Message { type: 'rate', rate }
//                      changes the rate (a new ready); { type: 'flush' } sends the part-filled frame
//                      now (push to talk released: the end of what was said is not cut off).
//   sb-voice-playback  the agent's PCM16 24 kHz audio from a queue, resampled to the context's rate.
//                      Messages: { type: 'push', turn, pcm: ArrayBuffer }, { type: 'flush', turn }
//                      (the person spoke over the agent: drop what is queued), { type: 'end', turn }
//                      (the agent finished the turn). Posts { type: 'played', turn, ms } once a turn:
//                      on flush, or when an ended turn's last sample has played. ms is what was
//                      actually played of that turn (OpenAI trims the rest from what the agent said).
//                      { type: 'reset', epoch } drops everything with no report (a new connection
//                      numbers its turns afresh); each played message carries the epoch it belongs to.
//
// The pure parts (Resampler, Framer, PlaybackQueue, the sample conversions) are the same code the
// unit tests run (scripts/voice-worklet.test.mjs loads this file with stubs).

/* eslint-disable no-restricted-globals */
;(function voiceWorklet(scope) {
  const toInt16 = (value) => {
    const s = value > 1 ? 1 : value < -1 ? -1 : value || 0
    return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  const toFloat = (value) => (value < 0 ? value / 0x8000 : value / 0x7fff)

  /** Little-endian PCM16 bytes → Float32Array. */
  function pcmToFloat(buffer) {
    const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset || 0, buffer.byteLength)
    const out = new Float32Array(view.byteLength >> 1)
    for (let i = 0; i < out.length; i += 1) out[i] = toFloat(view.getInt16(i * 2, true))
    return out
  }

  // A low-pass FIR (windowed sinc, Blackman) for going down in rate: what is above the new rate's
  // half would fold back into speech as noise.
  function lowpass(taps, cutoff) {
    const h = new Float32Array(taps)
    const mid = (taps - 1) / 2
    let sum = 0
    for (let i = 0; i < taps; i += 1) {
      const x = i - mid
      const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1))
      h[i] = sinc * w
      sum += h[i]
    }
    for (let i = 0; i < taps; i += 1) h[i] /= sum
    return h
  }

  /**
   * A streaming resampler from one rate to another: low-pass first when going down (63 taps: flat
   * to about 7 kHz and well down past the new half rate from 48 kHz to 16 kHz), then linear
   * interpolation. Blocks of any length go in; the output stays continuous across them. Its
   * working buffers are kept and grown, never made per block (the audio thread must not wait on
   * the garbage collector); process(input, { reuse: true }) answers a view of a kept buffer too,
   * for a caller that is done with it before the next block.
   */
  class Resampler {
    constructor(fromRate, toRate, { taps = 63 } = {}) {
      if (!(fromRate > 0) || !(toRate > 0)) throw new Error('Resampler rates are positive.')
      this.from = fromRate
      this.to = toRate
      this.step = fromRate / toRate
      this.fir = fromRate > toRate ? lowpass(taps, (0.5 * toRate / fromRate) * 0.92) : null
      this.hist = this.fir ? new Float32Array(this.fir.length - 1) : null
      this.joined = new Float32Array(0)
      this.filtered = new Float32Array(0)
      this.output = new Float32Array(0)
      this.reset()
    }

    reset() {
      this.t = 0
      this.last = 0
      if (this.hist) this.hist.fill(0)
    }

    filter(input) {
      if (!this.fir) return input
      const h = this.fir
      const n = h.length - 1
      if (this.joined.length < n + input.length) this.joined = new Float32Array(n + input.length)
      if (this.filtered.length < input.length) this.filtered = new Float32Array(input.length)
      const joined = this.joined.subarray(0, n + input.length)
      joined.set(this.hist, 0)
      joined.set(input, n)
      const out = this.filtered.subarray(0, input.length)
      for (let i = 0; i < input.length; i += 1) {
        let acc = 0
        for (let k = 0; k <= n; k += 1) acc += h[k] * joined[i + n - k]
        out[i] = acc
      }
      this.hist.set(joined.subarray(joined.length - n))
      return out
    }

    /** Float32Array at fromRate → Float32Array at toRate (reuse: a view of a kept buffer). */
    process(input, { reuse = false } = {}) {
      if (this.from === this.to) return reuse ? input : input.slice()
      const x = this.filter(input)
      const n = x.length
      if (!n) return new Float32Array(0)
      // the sequence is [last, x0, x1, ...]: index 0 is the previous block's final sample
      const size = Math.ceil((n - this.t) / this.step) + 1
      if (reuse && this.output.length < size) this.output = new Float32Array(size)
      const out = reuse ? this.output : new Float32Array(size)
      let count = 0
      while (this.t < n) {
        const i = Math.floor(this.t)
        const frac = this.t - i
        const a = i === 0 ? this.last : x[i - 1]
        const b = x[i]
        out[count] = a + (b - a) * frac
        count += 1
        this.t += this.step
      }
      this.t -= n
      this.last = x[n - 1]
      return out.subarray(0, count)
    }
  }

  /** Samples in, PCM16 frames of a fixed length out. */
  class Framer {
    constructor(rate, frameMs = 20) {
      this.size = Math.max(1, Math.round((rate * frameMs) / 1000))
      this.frame = new Int16Array(this.size)
      this.fill = 0
    }

    /** Float32Array → [ArrayBuffer of PCM16 LE, ...] (each exactly one frame). */
    push(samples) {
      const out = []
      for (let i = 0; i < samples.length; i += 1) {
        this.frame[this.fill] = toInt16(samples[i])
        this.fill += 1
        if (this.fill === this.size) {
          out.push(littleEndian(this.frame))
          this.fill = 0
        }
      }
      return out
    }

    /** What is part-filled, as one shorter frame (or null): push to talk released. */
    drain() {
      if (!this.fill) return null
      const out = littleEndian(this.frame.subarray(0, this.fill))
      this.fill = 0
      return out
    }
  }

  // Int16Array → ArrayBuffer of little-endian bytes (whatever the platform's own order).
  function littleEndian(samples) {
    const buffer = new ArrayBuffer(samples.length * 2)
    const view = new DataView(buffer)
    for (let i = 0; i < samples.length; i += 1) view.setInt16(i * 2, samples[i], true)
    return buffer
  }

  /** How many whole milliseconds a number of samples at a rate lasts. */
  const samplesMs = (samples, rate) => Math.floor((samples * 1000) / rate)

  /**
   * The agent's audio, queued at the output rate, by turn. pull(out) fills an output block (silence
   * when nothing is queued) and returns what happened: [{ type: 'played', turn, ms }].
   */
  class PlaybackQueue {
    constructor(rate) {
      this.rate = rate
      this.chunks = []
      this.offset = 0
      this.played = new Map()
      this.ended = new Set()
      this.reported = new Set()
    }

    queued(turn) {
      return this.chunks.some((chunk) => chunk.turn === turn)
    }

    push(turn, samples) {
      if (this.reported.has(turn) || !samples.length) return []
      if (!this.played.has(turn)) this.played.set(turn, 0)
      this.chunks.push({ turn, samples })
      return []
    }

    report(turn) {
      if (this.reported.has(turn)) return []
      this.reported.add(turn)
      // keep the memory small: only the latest turns are remembered
      if (this.reported.size > 64) this.reported.delete(this.reported.values().next().value)
      const ms = samplesMs(this.played.get(turn) || 0, this.rate)
      this.played.delete(turn)
      this.ended.delete(turn)
      return [{ type: 'played', turn, ms }]
    }

    /** The agent finished the turn: once its last queued sample is played, it is reported. */
    end(turn) {
      if (this.reported.has(turn)) return []
      this.ended.add(turn)
      return this.queued(turn) ? [] : this.report(turn)
    }

    /** The person spoke over the agent: everything queued goes; the turn is reported as played so far. */
    flush(turn) {
      const turns = new Set(this.chunks.map((chunk) => chunk.turn))
      if (Number.isInteger(turn)) turns.add(turn)
      this.chunks = []
      this.offset = 0
      const events = []
      for (const t of turns) events.push(...this.report(t))
      return events
    }

    pull(out) {
      let at = 0
      const events = []
      while (at < out.length && this.chunks.length) {
        const chunk = this.chunks[0]
        const take = Math.min(out.length - at, chunk.samples.length - this.offset)
        out.set(chunk.samples.subarray(this.offset, this.offset + take), at)
        at += take
        this.offset += take
        this.played.set(chunk.turn, (this.played.get(chunk.turn) || 0) + take)
        if (this.offset >= chunk.samples.length) {
          this.chunks.shift()
          this.offset = 0
          if (this.ended.has(chunk.turn) && !this.queued(chunk.turn)) events.push(...this.report(chunk.turn))
        }
      }
      if (at < out.length) out.fill(0, at)
      return events
    }
  }

  const api = { Resampler, Framer, PlaybackQueue, pcmToFloat, toInt16, toFloat, samplesMs, littleEndian }

  if (typeof scope.registerProcessor !== 'function' || typeof scope.AudioWorkletProcessor !== 'function') {
    scope.SlateboxVoiceAudio = api
    return
  }

  class CaptureProcessor extends scope.AudioWorkletProcessor {
    constructor(options) {
      super()
      const { rate = 16000, frameMs = 20 } = options?.processorOptions || {}
      this.frameMs = frameMs
      this.setRate(rate)
      this.mono = new Float32Array(128)
      this.port.onmessage = (event) => {
        if (event.data?.type === 'rate' && event.data.rate > 0) this.setRate(event.data.rate)
        if (event.data?.type === 'flush') {
          const pcm = this.framer.drain()
          if (pcm) this.port.postMessage({ type: 'frame', pcm }, [pcm])
        }
      }
    }

    setRate(rate) {
      this.resampler = new Resampler(scope.sampleRate, rate)
      this.framer = new Framer(rate, this.frameMs)
    }

    process(inputs) {
      const input = inputs[0]
      if (!input || !input.length || !input[0]) return true
      let mono = input[0]
      if (input.length > 1) {
        if (this.mono.length < input[0].length) this.mono = new Float32Array(input[0].length)
        mono = this.mono.subarray(0, input[0].length)
        mono.fill(0)
        for (const channel of input) for (let i = 0; i < mono.length; i += 1) mono[i] += channel[i] / input.length
      }
      for (const pcm of this.framer.push(this.resampler.process(mono, { reuse: true }))) this.port.postMessage({ type: 'frame', pcm }, [pcm])
      return true
    }
  }

  class PlaybackProcessor extends scope.AudioWorkletProcessor {
    constructor(options) {
      super()
      const { rate = 24000 } = options?.processorOptions || {}
      this.resampler = new Resampler(rate, scope.sampleRate)
      this.queue = new PlaybackQueue(scope.sampleRate)
      this.epoch = 0
      this.port.onmessage = (event) => {
        const msg = event.data || {}
        let events = []
        if (msg.type === 'push') events = this.queue.push(msg.turn, this.resampler.process(pcmToFloat(msg.pcm)))
        else if (msg.type === 'end') events = this.queue.end(msg.turn)
        else if (msg.type === 'flush') {
          events = this.queue.flush(msg.turn)
          this.resampler.reset()
        } else if (msg.type === 'reset') {
          this.queue = new PlaybackQueue(scope.sampleRate)
          this.resampler.reset()
          this.epoch = msg.epoch | 0
        }
        this.post(events)
      }
    }

    post(events) {
      for (const e of events) this.port.postMessage({ ...e, epoch: this.epoch })
    }

    process(_inputs, outputs) {
      const output = outputs[0]
      if (!output || !output[0]) return true
      this.post(this.queue.pull(output[0]))
      for (let c = 1; c < output.length; c += 1) output[c].set(output[0])
      return true
    }
  }

  scope.registerProcessor('sb-voice-capture', CaptureProcessor)
  scope.registerProcessor('sb-voice-playback', PlaybackProcessor)
})(typeof globalThis !== 'undefined' ? globalThis : this)
