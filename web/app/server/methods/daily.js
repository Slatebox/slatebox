import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { check, Match } from 'meteor/check'
import CONSTANTS from '../../imports/api/common/constants'
import { HuddleCalls } from '../../imports/api/common/models'
import { huddleGrant } from './huddle-provider.mjs'
import { CALL_COPY, CALL_LIMITS, admit, callRoomName, endCharge, roomRequest, startCall, tokenRequest, transcriptionAllowed } from '../metering/calls.mjs'
import { callClient, credentialsFor, meterOn, recordCallMinutes, refusalError, routeFor, usageFor, meterSettings, settingsForUser, userFields } from '../metering/meteor'
import { videoRefusal } from '../metering/refusal-pay.mjs'
import { canReadSlate, findSlate } from '../common/slate-access'
import { aiSettings } from './ai/ai-settings'

// One Daily room per call. The person who starts a call pays for it from their included calls (Pro credits),
// their own Daily key or their balance; people who join pay nothing. Rooms expire unless the
// meter's tick extends them (server/metering/calls.mjs).

async function authorize(shareId) {
  if (typeof shareId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(shareId)) {
    throw new Meteor.Error('huddle-forbidden', 'This slate is unavailable.')
  }
  const record = await Meteor.callAsync(CONSTANTS.methods.slates.get, { shareId, forHuddle: true })
  const user = await Meteor.userAsync()
  const grant = huddleGrant(record, user, Boolean(Meteor.settings.deepgram?.secret) || await aiSettings.hasAuxKey('deepgram').catch(() => false))
  if (!grant) throw new Meteor.Error('huddle-forbidden', 'You cannot join a call on this slate.')
  if (!Meteor.settings.daily?.apiKey) {
    const reason = Meteor.settings.public.env === 'selfhost'
      ? 'Calls are unavailable. Ask your administrator to configure the Daily provider for this instance.'
      : 'Calls are unavailable on this instance.'
    throw new Meteor.Error('huddle-unconfigured', reason)
  }
  return { grant, user }
}

const displayName = user => [user?.profile?.firstName, user?.profile?.lastName].filter(Boolean).join(' ').trim() || 'The person who started this call'
const hours = minutes => Math.max(0, Math.floor(minutes / 4 / 60 * 2) / 2)

// Unmetered rooms (own key, self-hosted operator) carry no Slatebox limits; a 12-hour
// expiry only keeps abandoned rooms from piling up on the key.
function unmeteredRoom(name, now) {
  const request = roomRequest({ name, now })
  return { ...request, properties: { ...request.properties, exp: Math.floor(now / 1000) + 12 * 3600, eject_at_room_exp: false, max_participants: undefined } }
}

async function openCall({ grant, user, mode, now }) {
  if (!grant.canStart) {
    throw new Meteor.Error('huddle-start', user && !user.isAnonymous
      ? 'A call starts when someone who can edit or comment on this slate opens it.'
      : 'Sign in to start a call. Anyone can join a call that is already running.')
  }
  const kind = (mode || grant.defaultMode) === 'video' ? 'video' : 'voice'
  let decision = { ok: true, route: 'operator', kind, payer: { type: 'user', id: user._id } }
  if (meterOn()) {
    ;({ decision } = await routeFor({ user, kind, feature: 'call', minutes: CALL_LIMITS.windowMinutes, now }))
    // the refusal carries the pay sheet's action (Get Pro, top up) for the person starting the call
    if (!decision.ok) throw await refusalError(user, decision.code, decision.message)
  }
  const callId = Random.id(16)
  const call = { ...startCall({ callId, shareId: grant.shareId, starterId: user._id, decision, now }), starterName: displayName(user), notice: decision.notice ?? null }
  const ownKey = decision.route === 'byok' ? (await credentialsFor(decision.keyOwner, 'daily')).apiKey : null
  try {
    await HuddleCalls.rawCollection().insertOne(call)
  } catch (error) {
    if (error?.code === 11000) throw new Meteor.Error('huddle-busy', 'You already have a call open. End it before you start another.')
    throw error
  }
  try {
    const metered = call.provider === 'slatebox'
    call.roomUrl = await (await callClient(call, ownKey)).createRoom(metered ? roomRequest({ name: call.roomName, now }) : unmeteredRoom(call.roomName, now))
    await HuddleCalls.updateAsync({ _id: callId }, { $set: { roomUrl: call.roomUrl } })
  } catch {
    await HuddleCalls.updateAsync({ _id: callId }, { $set: { state: 'ended', endedReason: 'provider', endedAt: Date.now() } })
    throw new Meteor.Error('huddle-unavailable', 'The call could not be opened. Please try again.')
  }
  return call
}

// Ends an open call once and charges the minutes since its last tick. The update only
// matches while no tick has run since the call was read, so those minutes are charged once.
async function endOpenCall(call, { reason, presenceCount = null, now }) {
  const ended = await HuddleCalls.updateAsync(
    { _id: call._id, state: 'open', lastTickAt: call.lastTickAt },
    { $set: { state: 'ended', endedReason: reason, endedAt: now } },
  )
  if (!ended) return false
  const charge = endCharge({ call, presenceCount, now })
  if (charge) await recordCallMinutes(call, charge, now).catch(error => console.error('call end charge failed', call._id, error.message))
  return true
}

async function join({ shareId, mode } = {}) {
  check(mode, Match.Maybe(Match.OneOf('voice', 'video')))
  const { grant, user } = await authorize(shareId)
  const now = Date.now()
  let call = await HuddleCalls.findOneAsync({ shareId: grant.shareId, state: 'open' })
  if (call && call.provider === 'slatebox' && call.roomExpAt <= now) {
    // its room has expired; the tick has not closed it yet
    await endOpenCall(call, { reason: 'expired', now })
    call = null
  }
  let started = false
  if (!call) {
    try {
      call = await openCall({ grant, user, mode, now })
      started = true
    } catch (error) {
      // another person may have started the call at the same moment
      call = await HuddleCalls.findOneAsync({ shareId: grant.shareId, state: 'open' })
      if (!call) throw error
    }
  }
  const key = this.userId || 'connection:' + this.connection?.id
  const admitted = admit(call, key)
  if (!admitted.ok) throw new Meteor.Error('huddle-full', admitted.message)
  if (!admitted.rejoin) {
    // the 20-person cap holds across replicas: only add while slot 20 is free
    const added = await HuddleCalls.updateAsync({ _id: call._id, state: 'open', $or: [{ participants: key }, { 'participants.19': { $exists: false } }] }, { $addToSet: { participants: key } })
    if (!added) throw new Meteor.Error('huddle-full', CALL_COPY.full)
  }
  let ownKey = null
  if (call.provider === 'own-key') ownKey = (await credentialsFor(call.keyOwner, 'daily')).apiKey
  // transcription only where the room carries the operator's Deepgram key (calls.mjs)
  const canTranscribe = grant.canTranscribe && transcriptionAllowed(call)
  let token
  try {
    token = await (await callClient(call, ownKey)).token(tokenRequest({ call, grant: { ...grant, canTranscribe }, now }))
  } catch {
    throw new Meteor.Error('huddle-unavailable', 'The call could not be opened. Please try again.')
  }
  const starter = call.starterId === this.userId
  let starterNotice = null
  if (starter && started && call.notice) {
    // video fell back to voice (the included video used up, or a balance that covers voice only):
    // said on any route, and the client offers a top-up (voiceFallback)
    starterNotice = call.notice
  } else if (starter && started && call.route === 'free') {
    const usage = await usageFor(user._id, now)
    const settings = settingsForUser(user, await meterSettings(), now)
    starterNotice = CALL_COPY.starterNotice(hours(settings.free.voiceMinutesPerMonth - usage.voiceMinutesMonth), call.pro === true)
  }
  return { url: call.roomUrl, token, callId: call._id, mode: call.mode, starter, starterNotice, voiceFallback: Boolean(starter && started && call.notice), canTranscribe }
}

// A voice call becomes video when someone turns on a camera after the warning. The starter's
// video allowance (or own key or balance) pays; everyone's client follows to the video room.
async function useVideo({ callId } = {}) {
  check(callId, String)
  const call = await HuddleCalls.findOneAsync({ _id: callId, state: 'open' })
  if (!call) throw new Meteor.Error('huddle-ended', 'This call has ended.')
  const { grant } = await authorize(call.shareId)
  if (!grant.media.includes('video')) throw new Meteor.Error('huddle-forbidden', 'You can listen in this call.')
  if (call.mode === 'video') return { mode: 'video' }
  const now = Date.now()
  if (call.provider === 'slatebox') {
    // the same fields as every other route decision, freeStopped included
    const payer = await Meteor.users.findOneAsync(call.payer.id, userFields)
    const { decision } = await routeFor({ user: payer, kind: 'video', feature: 'call', minutes: CALL_LIMITS.windowMinutes * Math.max(2, call.participants.length), running: true, now })
    const noVideo = 'Video is not available for this call. It carries on as voice.'
    // Someone who did not start the call is never offered to pay for its starter; a payer that
    // changed mid-call (the included amount to the balance) is not something a payment here fixes.
    // The starter gets the meter's own code (no Pro, video or calls used up, a low balance) with the
    // pay action (refusal-pay.mjs videoRefusal).
    const refused = videoRefusal({ decision, call, userId: this.userId, noVideo })
    if (refused) throw refused.pay ? await refusalError(payer, refused.code, refused.message) : new Meteor.Error(refused.code, refused.message)
  }
  const index = (call.videoSwitches || 0) + 1
  const roomName = callRoomName(call.shareId, call._id, '-video' + index)
  const ownKey = call.provider === 'own-key' ? (await credentialsFor(call.keyOwner, 'daily')).apiKey : null
  const client = await callClient(call, ownKey)
  const roomUrl = await client.createRoom(call.provider === 'slatebox' ? roomRequest({ name: roomName, now }) : unmeteredRoom(roomName, now))
  await HuddleCalls.updateAsync({ _id: call._id, state: 'open' }, { $set: { mode: 'video', roomName, roomUrl, roomExpAt: now + CALL_LIMITS.windowMinutes * 60_000, videoSwitches: index, previousRoomName: call.roomName } })
  client.deleteRoom(call.roomName).catch(() => {})
  return { mode: 'video' }
}

// When the last person leaves, the call ends at once instead of waiting out its room.
async function leave({ callId } = {}) {
  check(callId, String)
  const call = await HuddleCalls.findOneAsync({ _id: callId, state: 'open' })
  if (!call) return true
  const ownKey = call.provider === 'own-key' ? (await credentialsFor(call.keyOwner, 'daily').catch(() => null))?.apiKey : null
  const client = await callClient(call, ownKey)
  const present = await client.presence(call.roomName)
  if (present !== null && present <= 1) {
    if (await endOpenCall(call, { reason: 'left', presenceCount: present, now: Date.now() })) await client.deleteRoom(call.roomName).catch(() => {})
  }
  return true
}

Meteor.methods({
  [CONSTANTS.methods.daily.join]: join,
  [CONSTANTS.methods.daily.leave]: leave,
  [CONSTANTS.methods.daily.useVideo]: useVideo,
})

// The open call on a slate: what every client needs to follow it (mode, room changes and
// notices), never who pays or how.
Meteor.publish('meter.calls', async function (shareId) {
  check(shareId, String)
  if (!await canReadSlate(this.userId, await findSlate({ shareId }))) return this.ready()
  return HuddleCalls.find({ shareId, state: 'open' }, { fields: {
    shareId: 1, mode: 1, state: 1, roomName: 1, starterName: 1, starterId: 1, roomExpAt: 1, warning: 1, videoFallbackAt: 1, videoSwitches: 1,
  } })
})
