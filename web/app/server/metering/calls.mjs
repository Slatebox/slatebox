// The life of a call: one Daily room per call, short room expiry extended by a 60-second
// tick only while the starter has minutes left, at most 20 people and 3 hours, an end after
// 10 minutes alone, and a move from video to voice when video runs out. Pure.
import { CALL_PRICES } from './prices.mjs'
import { videoAllowance } from './policy.mjs'

const MIN = 60_000
export const CALL_LIMITS = Object.freeze({
  maxParticipants: 20, windowMinutes: 10, maxHours: 3, aloneMinutes: 10, warnMinutes: 2, joinWindowSeconds: 600,
})
// The most a call can run past its meter: one room window, full, on video.
export const OVERRUN_BOUND_MICROS = CALL_LIMITS.maxParticipants * CALL_LIMITS.windowMinutes * CALL_PRICES.videoMicros

export const CALL_COPY = Object.freeze({
  full: 'This call is full (20 people).',
  movedToVoice: 'Video for this month is used up, so the call carries on as voice.',
  endingAllowance: (starter, pro = false) => `This call ends in 2 minutes. ${starter}'s ${pro ? 'Pro credits for calls' : 'free calls'} for this month are used up.`,
  endingAlone: 'This call ends in 2 minutes because nobody else is here.',
  starterNotice: (hours, pro = false) => `This call uses your ${pro ? 'Pro credits' : 'free calls'}: about ${hours} hours of four-person voice left this month.`,
})

// Transcription runs on Slatebox's Deepgram key and is not priced in the meter, so it is only
// offered on unmetered calls the operator runs on their own keys (self-host, dev). A call on a
// customer's own Daily key never carries Slatebox's Deepgram secret, and a metered call never
// spends Deepgram minutes nobody counts.
export const transcriptionAllowed = call => call?.provider === 'operator'

export const callRoomName = (shareId, callId, suffix = '') => `${shareId}-${callId.slice(0, 8)}${suffix}`
const seconds = ms => Math.floor(ms / 1000)

export function roomRequest({ name, now, transcriptionKey }) {
  const properties = {
    exp: seconds(now + CALL_LIMITS.windowMinutes * MIN),
    eject_at_room_exp: true,
    max_participants: CALL_LIMITS.maxParticipants,
    enable_knocking: false,
    start_video_off: true,
    start_audio_off: true,
    enable_screenshare: false,
  }
  if (transcriptionKey) properties.enable_transcription = 'deepgram:' + transcriptionKey
  return { name, privacy: 'private', properties }
}

// A token for one joiner: scoped to the room, a 10-minute window to join, and ejected
// when the call reaches three hours. A voice call never sends camera tracks.
export function tokenRequest({ call, grant, now }) {
  const elapsed = seconds(now - call.startedAt)
  const media = call.mode === 'video' ? grant.media : grant.media.filter(m => m !== 'video')
  return { properties: {
    room_name: call.roomName,
    exp: seconds(now) + CALL_LIMITS.joinWindowSeconds,
    eject_after_elapsed: Math.max(60, CALL_LIMITS.maxHours * 3600 - elapsed),
    is_owner: false,
    user_name: grant.displayName,
    start_video_off: true,
    start_audio_off: grant.audioMuted || !media.includes('audio'),
    enable_screenshare: false,
    permissions: {
      canSend: media.length ? media : false,
      canAdmin: grant.canTranscribe ? ['transcription'] : false,
    },
  } }
}

// At most 20 distinct people per call; someone rejoining is not counted twice.
export function admit(call, key) {
  const participants = call.participants || []
  if (participants.includes(key)) return { ok: true, rejoin: true, participants }
  if (participants.length >= CALL_LIMITS.maxParticipants) return { ok: false, code: 'full', message: CALL_COPY.full }
  return { ok: true, rejoin: false, participants: [...participants, key] }
}

const PROVIDER_BY_ROUTE = { byok: 'own-key', operator: 'operator', free: 'slatebox', balance: 'slatebox' }

// decision: the policy route for the starter, or { ok: true, route: 'operator' } on an unmetered server.
export function startCall({ callId, shareId, starterId, decision, now }) {
  if (!decision?.ok) throw Object.assign(new Error(decision?.message || 'This call cannot start.'), { error: decision?.code || 'refused' })
  const mode = decision.kind === 'video' ? 'video' : 'voice'
  return {
    _id: callId, shareId, starterId,
    payer: decision.payer || { type: 'user', id: starterId },
    route: decision.route, mode, provider: PROVIDER_BY_ROUTE[decision.route] || 'slatebox',
    // one open metered call per starter (a unique partial index in migrations.mjs)
    ...((decision.route === 'free' || decision.route === 'balance') && { metered: true }),
    // started on Pro credits: the shared budget's stages never pause it (meteor.js tickCall)
    ...(decision.route === 'free' && decision.pro === true && { pro: true }),
    // started on a Business team's pool: its minutes count on the team's month (pool.mjs)
    ...(decision.route === 'free' && decision.pool && { pool: decision.pool }),
    ...(decision.keyOwner && { keyOwner: decision.keyOwner }),
    roomName: callRoomName(shareId, callId), state: 'open',
    startedAt: now, roomExpAt: now + CALL_LIMITS.windowMinutes * MIN, lastTickAt: now, tickIndex: 0,
    lastCount: 0, aloneSince: null, participants: [], videoFallbackAt: null, endedReason: null, warning: null,
  }
}

// The charge for the end of a call that ends between ticks (the last person leaves, or a
// join finds the room expired): every minute since the last tick, for the most people the
// call has known (presence can read 1 after everyone has already gone), at least one.
// A room past its expiry has ejected everyone, so the time after it is not charged.
export function endCharge({ call, presenceCount, now }) {
  if (call.provider !== 'slatebox') return null
  const until = Math.min(now, call.roomExpAt ?? now)
  const minutes = (until - call.lastTickAt) / MIN
  if (!(minutes > 0)) return null
  const count = Math.max(call.lastCount || 0, (call.participants || []).length, presenceCount || 0, 1)
  return { payer: call.payer, kind: call.mode, participantMinutes: Math.ceil(count * minutes - 1e-9), ref: `${call._id}:end` }
}

// Minutes the payer can still buy for each kind.
export function minutesLeftFor({ route, usage = {}, spendableMicros = 0, spendableVideoMicros, settings }) {
  if (route === 'balance') {
    const per = kind => Math.ceil(CALL_PRICES[kind === 'video' ? 'videoMicros' : 'voiceMicros'] * (100 + settings.marginPercent) / 100 * 1000) / 1000
    return {
      voice: Math.floor(spendableMicros / per('voice') + 1e-9),
      video: Math.floor((spendableVideoMicros ?? spendableMicros) / per('video') + 1e-9),
    }
  }
  return {
    voice: Math.max(0, settings.free.voiceMinutesPerMonth - (usage.voiceMinutesMonth || 0)),
    video: Math.max(0, videoAllowance(settings) - (usage.videoMinutesMonth || 0)),
  }
}

/**
 * One tick for one open call.
 * → { charge: { payer, kind, participantMinutes, ref } | null,
 *     decision: 'extend' | 'move-to-voice' | 'let-expire' | 'end' | 'none',
 *     warning: null | 'alone' | 'allowance', set: fields to write on the call }
 */
export function tick({ call, presence, now, minutesLeft, level }) {
  const count = presence && Number.isFinite(presence.count)
    ? presence.count
    : Math.max(call.lastCount || 0, (call.participants || []).length)
  const metered = call.provider === 'slatebox'
  const minutes = Math.max(0, (now - call.lastTickAt) / MIN)
  const tickIndex = (call.tickIndex || 0) + 1
  const charge = metered && count > 0 && minutes > 0
    ? { payer: call.payer, kind: call.mode, participantMinutes: Math.ceil(count * minutes - 1e-9), ref: `${call._id}:${tickIndex}` }
    : null
  const set = { lastTickAt: now, lastCount: count, tickIndex, warning: null }
  const end = endedReason => ({ charge, decision: 'end', warning: null, set: { ...set, state: 'ended', endedReason, endedAt: now } })

  // A call on an own Daily key or a self-hosted operator key has no Slatebox meter or limits.
  // It is only marked ended once nobody has been in it for ten minutes.
  if (!metered) {
    const emptySince = count === 0 ? call.aloneSince ?? now : null
    if (emptySince !== null && now - emptySince >= CALL_LIMITS.aloneMinutes * MIN) return end('empty')
    return { charge: null, decision: 'none', warning: null, set: { ...set, aloneSince: emptySince } }
  }
  if (now >= call.startedAt + CALL_LIMITS.maxHours * 60 * MIN) return end('time')
  set.aloneSince = count <= 1 ? call.aloneSince ?? now : null
  if (set.aloneSince !== null) {
    const alone = now - set.aloneSince
    if (alone >= CALL_LIMITS.aloneMinutes * MIN) return end('alone')
  }
  if (now >= call.roomExpAt) return end(call.warning === 'alone' ? 'alone' : 'allowance')

  const aloneWarning = set.aloneSince !== null && now - set.aloneSince >= (CALL_LIMITS.aloneMinutes - CALL_LIMITS.warnMinutes) * MIN

  const needed = Math.max(1, count) * CALL_LIMITS.windowMinutes
  const freeRoute = call.route === 'free'
  const paused = freeRoute && level >= 100
  const extendTo = now + CALL_LIMITS.windowMinutes * MIN
  const capAt = call.startedAt + CALL_LIMITS.maxHours * 60 * MIN
  // A call started on a Slatebox Business team's pool is never cut off because the pool ran out
  // (terms Schedule A3): it runs on to its usual limits (alone, 3 hours), and its minutes still count
  // on the team's month. The pool decides only whether a call may start (pool.mjs).
  const poolCall = Boolean(call.pool)
  if (!paused && (poolCall || minutesLeft[call.mode] >= needed)) {
    const warning = aloneWarning ? 'alone' : null
    return { charge, decision: 'extend', warning, set: { ...set, roomExpAt: Math.min(extendTo, capAt), warning } }
  }
  if (!paused && call.mode === 'video' && minutesLeft.voice >= needed) {
    return { charge, decision: 'move-to-voice', warning: null, set: {
      ...set, mode: 'voice', roomName: callRoomName(call.shareId, call._id, '-v'), videoFallbackAt: now,
      roomExpAt: Math.min(extendTo, capAt), previousRoomName: call.roomName,
    } }
  }
  const warning = call.roomExpAt - now <= CALL_LIMITS.warnMinutes * MIN ? (aloneWarning ? 'alone' : 'allowance') : null
  return { charge, decision: 'let-expire', warning, set: { ...set, warning } }
}
