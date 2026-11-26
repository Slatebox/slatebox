// The pay sheet's action for a meter refusal (design §3.4): worked out on the server from the person
// who was refused (pay-route.mjs), and sent with the refusal as Meteor.Error(code, reason, { pay }),
// or as { refusal } on a chat row, an abort answer or a plan. Pure; meteor.js supplies the flags.

import { payRoute } from '../../imports/api/billing/pay-route.mjs'

/**
 * The part of meter.summary pay-route reads, for one person. flags: { proState, proAvailable,
 * topUpsAvailable, ownKeysAvailable (own keys on here), teamAdmin? } (meteor.js refusalFlags). A guest has none: pay-route asks them to sign in.
 */
export function refusalSummary(user, flags = {}) {
  if (!user || user.isAnonymous) return null
  return {
    emailVerified: Boolean(user.emails?.[0]?.verified),
    proState: flags.proState ?? null,
    proAvailable: flags.proAvailable,
    topUpsAvailable: flags.topUpsAvailable,
    ownKeysAvailable: flags.ownKeysAvailable === true,
    ...(flags.teamAdmin !== undefined && { teamAdmin: flags.teamAdmin }),
  }
}

/** → { action, wallet } (pay-route.mjs) */
export const refusalPay = ({ code, details = {}, user = null, flags = {} } = {}) =>
  payRoute({ code, details, summary: refusalSummary(user, flags) })

/**
 * The second way on a chat may offer beside the answer (pay.also, pay-notice.mjs inlinePayActions): a balance beside Pro
 * where top-ups are sold, Pro beside a balance for someone without Pro where it is on sale. null when there is none.
 */
export function payAlso(pay, flags = {}) {
  if (pay?.action === 'pro' && flags.topUpsAvailable === true) return 'topup'
  if (pay?.action === 'topup' && pay.wallet === 'me' && flags.proAvailable === true && !flags.proState?.active && !flags.proState?.pastDue) return 'pro'
  return null
}

/** A meter refusal carried on an error (its details.pay) → { code, pay }, or null for any other error. */
export function refusalOf(error) {
  const pay = error?.details?.pay
  if (!pay || typeof pay.action !== 'string' || typeof error.error !== 'string') return null
  return { code: error.error, pay }
}

/**
 * A refusal object ({ error, reason, pay? }, e.g. the canvas conversation's drafting refusal) as the
 * arguments of the Meteor.Error a method throws: details { pay } only when there is a pay action.
 */
export const refusalErrorArgs = ({ error, reason, pay } = {}) => [error, reason, pay ? { pay } : undefined]

/**
 * An AI method's refusal (openai.js metered): the chat row's extra field, offered only to the person
 * refused (userId), and the answer the client gets. Any other error: no refusal on either.
 */
export function refusalAnswer(error, userId) {
  const refusal = refusalOf(error)
  return {
    row: refusal ? { refusal: { code: refusal.code, userId } } : {},
    answer: { abort: true, abortMessage: error?.reason, ...(refusal && { refusal }) },
  }
}

/**
 * Turning video on in a running call (daily.js useVideo). decision: the meter's route decision for the
 * call's payer; userId: who asked. → null (go ahead) | { code, message, pay } where pay is true only
 * for the person who started the call: no one is offered to pay for the starter, and a payer that
 * changed mid-call is not something a payment here fixes.
 */
export function videoRefusal({ decision, call, userId, noVideo }) {
  if (decision.ok && decision.kind === 'video') return decision.route === call.route ? null : { code: 'huddle-video', message: noVideo, pay: false }
  if (call.payer.id !== userId) return { code: 'huddle-video', message: noVideo, pay: false }
  return decision.ok
    ? { code: 'video-stage', message: decision.notice || noVideo, pay: true }
    : { code: decision.code, message: `${decision.message} The call carries on as voice.`, pay: true }
}
