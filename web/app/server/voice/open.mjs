// voice.open: what a browser asks before it opens the voice socket. Everything is checked here,
// while the person's login is the one DDP already checked, and again (the route, the off switch)
// when the socket says hello, since a ticket lives 60 seconds:
//   1. a voice part (voice.chat needs the slate or board it is about; voice.interview none);
//   2. a signed-in person with an account (guests have no voice), with fewer voice sessions open
//      than one person may have (another tab or window: perPerson, checked again at hello);
//   3. the slate, when one is given: they may read it (what they may change is the surface's own
//      submit's to check, as when they type);
//   4. the person's own settings for the part (the interview: personalization and its source on);
//   5. an administrator's off switch for the part (or for all AI) wins over anyone's choice;
//   6. a model to talk with: the person's or team's own voice connection, else the server's binding;
//   7. on Slatebox Cloud, unless their own key serves it, the meter: voice needs Pro credits or a
//      balance (policy.mjs), never a free amount;
// then a single-use ticket bound to the person, the part and the slate (tickets.mjs).
//
// Pure apart from the injected lookups.
import { VOICE_SURFACES, surface as surfaceById } from '../ai-control/catalogue.mjs'
import { VOICE_PATH, VOICE_PROTOCOL_VERSION } from '../../imports/api/common/voice-protocol.mjs'

export class VoiceError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'VoiceError'
    this.code = code
    this.details = details
  }
}

export const VOICE_COPY = Object.freeze({
  part: 'Choose where to talk: a slate or board (voice.chat) or the interview (voice.interview).',
  slate: 'Open the slate or board to talk about it.',
  noSlate: 'The interview is not about a slate.',
  guest: 'Create an account to talk with the agent.',
  another: 'Voice is already on in another tab or window. Turn it off there to talk here.',
  signIn: 'Sign in to talk with the agent.',
  denied: 'You do not have access to this slate.',
  off: 'Voice is turned off by your administrator.',
  noModel: 'Voice is not set up on this server yet. An administrator chooses a voice model in Admin → AI control, or you can connect your own in your AI settings.',
})

/** The request feature and meter feature of a voice part (catalogue). */
export const featuresOf = (surface) => {
  const at = surfaceById(surface)
  return { request: at.requestFeatures[0], meter: at.meterFeatures[0] }
}

const SLATE_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * deps: {
 *   loadUser(userId) → { _id, isAnonymous } | null
 *   findSlate({ slateId } | { shareId }) → slate | null, canReadSlate(userId, slate) → boolean
 *   personRefusal(user, surface) → null | { code, message } (the person's own switches for the part)
 *   surfaceOff({ feature, userId }) → null | { message }
 *   resolve({ userId, feature }) → ai-settings-core resolveFor (no key is opened)
 *   meterRefusal({ user, feature }) → null | { code, message, pay? } (Cloud only; never for an own key)
 *   openSessions?(userId) → how many voice sessions they have open now; perPerson?() the most they may
 *   tickets (tickets.mjs createTickets)
 * }
 */
export function createVoiceOpen(deps) {
  // 4 to 7: the person's own switches, the off switch, a model, the meter. → the resolved choice, or throws VoiceError
  async function checkRoute(user, surface) {
    const own = await deps.personRefusal(user, surface)
    if (own) throw new VoiceError(own.code, own.message)
    const { request, meter } = featuresOf(surface)
    const off = await deps.surfaceOff({ feature: request, userId: user._id })
    if (off) throw new VoiceError('turned-off', off.message || VOICE_COPY.off)
    const choice = await deps.resolve({ userId: user._id, feature: request })
    if (!choice || choice.disabled) throw new VoiceError('turned-off', choice?.message || VOICE_COPY.off)
    if (choice.error || choice.gap || !choice.connection) {
      const said = choice.gap?.message || (choice.own ? choice.error : null)
      throw new VoiceError('unavailable', said || VOICE_COPY.noModel)
    }
    if (!choice.own) {
      const refusal = await deps.meterRefusal({ user, feature: meter })
      if (refusal) throw new VoiceError(refusal.code, refusal.message, refusal.pay ? { pay: refusal.pay } : undefined)
    }
    return choice
  }

  async function account(userId) {
    const user = userId ? await deps.loadUser(userId) : null
    if (!user) throw new VoiceError('sign-in', VOICE_COPY.signIn)
    if (user.isAnonymous) throw new VoiceError('sign-up', VOICE_COPY.guest)
    return user
  }

  /**
   * input: { surface, slateId? | shareId? } (voice.chat names the slate or board by either id; the
   * ticket keeps the slate's own id). → { ticket, expiresAt, path, v, surface } or throws VoiceError
   */
  async function open(userId, input = {}) {
    const surface = input?.surface
    if (!VOICE_SURFACES.includes(surface)) throw new VoiceError('invalid', VOICE_COPY.part)
    const slateId = input.slateId ?? null
    const shareId = input.shareId ?? null
    const named = slateId !== null || shareId !== null
    if (surface === 'voice.chat') {
      const ok = (id) => typeof id === 'string' && SLATE_ID.test(id)
      if (slateId !== null && shareId !== null) throw new VoiceError('invalid', VOICE_COPY.slate)
      if (!(slateId !== null ? ok(slateId) : ok(shareId))) throw new VoiceError('invalid', VOICE_COPY.slate)
    }
    if (surface !== 'voice.chat' && named) throw new VoiceError('invalid', VOICE_COPY.noSlate)
    const user = await account(userId)
    let slate = null
    if (surface === 'voice.chat') {
      slate = await deps.findSlate(slateId !== null ? { slateId } : { shareId })
      if (!slate || !(await deps.canReadSlate(userId, slate))) throw new VoiceError('slate-denied', VOICE_COPY.denied)
    }
    await checkRoute(user, surface)
    if (deps.openSessions && (await deps.openSessions(user._id)) >= (deps.perPerson?.() ?? 2)) throw new VoiceError('voice-busy', VOICE_COPY.another)
    const { ticket, expiresAt } = await deps.tickets.mint({ userId: user._id, surface, slateId: slate ? (slate._id ?? slateId) : null })
    return { ticket, expiresAt, path: VOICE_PATH, v: VOICE_PROTOCOL_VERSION, surface }
  }

  /**
   * Whether a page should offer voice on a part, with no ticket and no slate: the same checks as
   * open (an account, the person's switches, the off switch, a model, the meter). A refusal the
   * pay sheet answers still offers voice (pressing it says why, with the way on); no account, off,
   * or no model to talk with does not.
   * → { available, code?, message?, pay? }
   */
  async function status(userId, input = {}) {
    const surface = input?.surface
    if (!VOICE_SURFACES.includes(surface)) throw new VoiceError('invalid', VOICE_COPY.part)
    try {
      await checkRoute(await account(userId), surface)
      return { available: true }
    } catch (error) {
      if (!(error instanceof VoiceError)) throw error
      const hidden = ['sign-in', 'sign-up', 'turned-off', 'unavailable', 'personalization-off', 'interview-off'].includes(error.code)
      return { available: !hidden, code: error.code, message: error.message, ...(error.details?.pay && { pay: error.details.pay }) }
    }
  }

  /**
   * What the relay needs at hello, for a taken ticket: the route again, with its key opened now.
   * → { protocol, connection, own, model, price } | { error, message }
   */
  async function prepare(binding, { protocolOf, priceOf }) {
    const user = await deps.loadUser(binding.userId)
    if (!user || user.isAnonymous) return { error: 'denied', message: VOICE_COPY.signIn }
    const { request } = featuresOf(binding.surface)
    const off = await deps.surfaceOff({ feature: request, userId: binding.userId })
    if (off) return { error: 'turned-off', message: off.message || VOICE_COPY.off }
    const choice = await deps.resolve({ userId: binding.userId, feature: request, forRequest: true })
    if (!choice || choice.disabled) return { error: 'turned-off', message: choice?.message || VOICE_COPY.off }
    if (choice.error || choice.gap || !choice.connection?.apiKey) return { error: 'unavailable', message: choice?.gap?.message || VOICE_COPY.noModel }
    const connection = choice.connection
    return {
      protocol: protocolOf(connection),
      connection: {
        baseUrl: connection.baseUrl, apiKey: connection.apiKey, model: connection.model,
        voice: connection.voice ?? null, transcriptionModel: connection.transcriptionModel ?? null,
      },
      rules: choice.rules ?? null,
      own: Boolean(choice.own),
      model: connection.model,
      price: priceOf(connection),
    }
  }

  return { open, status, prepare }
}
