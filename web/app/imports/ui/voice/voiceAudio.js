// The voice session's audio in the page: the microphone in, the agent out, through the worklet in
// public/voice/voice-worklet.js (served at WORKLET_URL). One AudioContext for both.
//
//   mic: getUserMedia with echo cancellation, noise suppression and auto gain → the capture
//        processor → PCM16 frames at the relay's rate (onFrame).
//   agent: PCM16 24 kHz → the playback processor's queue → the speakers. In Chromium the queue's
//        output goes through a loopback RTCPeerConnection to an <audio> element, because Chromium's
//        echo cancellation only takes WebRTC audio as what the speakers play (bug 687574); played
//        through Web Audio alone, the agent hears itself and interrupts itself. Elsewhere (Firefox,
//        Safari cancel Web Audio already), or if the loopback can't connect, the queue plays
//        straight to the speakers, and `echoRisk` says push to talk or headphones are the way out.
//
// Created inside the click that turns voice on (createVoiceAudio is synchronous up to its first
// await), so Safari and iOS let the context start and play. Firefox cannot take a microphone at
// another rate than its context's, so there the context is made again at the mic's rate once the
// mic is on (the click's activation still holds).
//
// How much of a turn was heard (onPlayed) is what the worklet played, less what still sits between
// it and the speakers: the context's output latency and, through the loopback, WebRTC's jitter
// buffer (measured every couple of seconds), so OpenAI trims only what was not heard.
import { FRAME_MS, WORKLET_URL, needsLoopback } from '../../api/common/voice-client.mjs'

const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
const LOOPBACK_MS = 3000

const isFirefox = () => /Firefox\//.test(globalThis.navigator?.userAgent || '')

async function loopback(ctx, node) {
  const dest = ctx.createMediaStreamDestination()
  node.connect(dest)
  const sender = new RTCPeerConnection()
  const receiver = new RTCPeerConnection()
  const audio = new Audio()
  audio.autoplay = true
  const peers = [sender, receiver]
  // the jitter buffer's delay, in ms (WebRTC stats: jitterBufferDelay / jitterBufferEmittedCount)
  const out = { jitterMs: 0, close: null }
  let statsTimer = null
  const close = () => {
    clearInterval(statsTimer)
    try { audio.pause(); audio.srcObject = null } catch { /* gone */ }
    for (const pc of peers) try { pc.close() } catch { /* closed */ }
    try { node.disconnect(dest) } catch { /* disconnected */ }
  }
  try {
    sender.onicecandidate = (e) => { if (e.candidate) receiver.addIceCandidate(e.candidate).catch(() => {}) }
    receiver.onicecandidate = (e) => { if (e.candidate) sender.addIceCandidate(e.candidate).catch(() => {}) }
    const track = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The loopback did not connect.')), LOOPBACK_MS)
      receiver.ontrack = (e) => {
        clearTimeout(timer)
        resolve(e.streams?.[0] ?? new MediaStream([e.track]))
      }
    })
    for (const t of dest.stream.getAudioTracks()) sender.addTrack(t, dest.stream)
    const offer = await sender.createOffer()
    await sender.setLocalDescription(offer)
    await receiver.setRemoteDescription(offer)
    const answer = await receiver.createAnswer()
    await receiver.setLocalDescription(answer)
    await sender.setRemoteDescription(answer)
    audio.srcObject = await track
    await audio.play()
    statsTimer = setInterval(() => {
      receiver.getStats().then((stats) => {
        stats.forEach((r) => {
          if (r.type === 'inbound-rtp' && r.kind === 'audio' && r.jitterBufferEmittedCount > 0) out.jitterMs = (r.jitterBufferDelay / r.jitterBufferEmittedCount) * 1000
        })
      }).catch(() => {})
    }, 2000)
    out.close = close
    return out
  } catch (error) {
    close()
    throw error
  }
}

/**
 * → { ready: Promise (the mic is on and the worklet loaded), start(rate), setRate(rate), push(turn, pcm),
 *     flush(turn), flushMic(), end(turn), reset(), echoRisk, close() }
 * onFrame(ArrayBuffer of PCM16 LE): a mic frame. onPlayed({ turn, ms }): how much of a turn was heard.
 */
export function createVoiceAudio({ onFrame, onPlayed }) {
  let ctx = new AudioContext({ latencyHint: 'interactive' })
  // started in the click: a context made outside one starts suspended
  ctx.resume().catch(() => {})
  let stream = null
  let source = null
  let capture = null
  let playback = null
  let sink = null
  let loop = null
  let closed = false
  let epoch = 0
  const out = { echoRisk: false }

  const ready = (async () => {
    stream = await navigator.mediaDevices.getUserMedia({ audio: MIC })
    if (closed) throw Object.assign(new Error('closed'), { name: 'AbortError' })
    const micRate = stream.getAudioTracks()[0]?.getSettings?.().sampleRate
    if (isFirefox() && micRate && micRate !== ctx.sampleRate) {
      ctx.close().catch(() => {})
      ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: micRate })
      await ctx.resume().catch(() => {})
    }
    await ctx.audioWorklet.addModule(WORKLET_URL)
    if (closed) throw Object.assign(new Error('closed'), { name: 'AbortError' })
    playback = new AudioWorkletNode(ctx, 'sb-voice-playback', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { rate: 24000 } })
    // a report from before the last reset belongs to the old connection
    playback.port.onmessage = (event) => {
      if (event.data?.type !== 'played' || event.data.epoch !== epoch) return
      onPlayed({ turn: event.data.turn, ms: Math.max(0, event.data.ms - lagMs()) })
    }
    const brands = globalThis.navigator?.userAgentData?.brands ?? null
    if (needsLoopback({ userAgent: navigator.userAgent, brands, hasPeerConnection: typeof RTCPeerConnection === 'function' })) {
      try {
        loop = await loopback(ctx, playback)
      } catch {
        loop = null
        out.echoRisk = true
      }
    }
    if (!loop) playback.connect(ctx.destination)
  })()

  // what sits between the worklet and the ears, in ms
  const lagMs = () => ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000 + (loop?.jitterMs || 0)

  /** The relay's ready gave the rate: the mic starts sending frames at it. Throws if the browser cannot. */
  function start(rate) {
    if (closed || capture) return setRate(rate)
    source = ctx.createMediaStreamSource(stream)
    capture = new AudioWorkletNode(ctx, 'sb-voice-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { rate, frameMs: FRAME_MS } })
    capture.port.onmessage = (event) => { if (event.data?.type === 'frame') onFrame(event.data.pcm) }
    // a node is pulled only when it leads to the speakers: through a silent gain
    sink = ctx.createGain()
    sink.gain.value = 0
    source.connect(capture)
    capture.connect(sink)
    sink.connect(ctx.destination)
    return undefined
  }
  function setRate(rate) {
    capture?.port.postMessage({ type: 'rate', rate })
  }
  function push(turn, pcm) {
    if (!playback || closed) return
    // a copy of the frame's bytes, moved (not copied again) to the audio thread
    const bytes = pcm.slice().buffer
    playback.port.postMessage({ type: 'push', turn, pcm: bytes }, [bytes])
  }
  const flush = (turn) => playback?.port.postMessage({ type: 'flush', turn })
  /** Push to talk released: the part-filled mic frame goes now. */
  const flushMic = () => capture?.port.postMessage({ type: 'flush' })
  const end = (turn) => playback?.port.postMessage({ type: 'end', turn })
  /** A new connection: what is queued goes, with no report, and its turns are counted afresh. */
  function reset() {
    epoch += 1
    playback?.port.postMessage({ type: 'reset', epoch })
  }

  function close() {
    if (closed) return
    closed = true
    try { stream?.getTracks().forEach((t) => t.stop()) } catch { /* stopped */ }
    for (const node of [source, capture, sink, playback]) try { node?.disconnect() } catch { /* disconnected */ }
    if (capture) capture.port.onmessage = null
    if (playback) playback.port.onmessage = null
    loop?.close()
    ctx.close().catch(() => {})
  }

  return Object.assign(out, { ready, start, setRate, push, flush, flushMic, end, reset, close })
}

/** Whether this browser can do voice at all (an AudioWorklet and a WebSocket). */
export const voiceSupported = () => typeof globalThis.AudioWorkletNode === 'function' && typeof globalThis.WebSocket === 'function'
/** Whether the microphone can be asked for here (https or localhost). */
export const micAllowedHere = () => Boolean(globalThis.isSecureContext && globalThis.navigator?.mediaDevices?.getUserMedia)
