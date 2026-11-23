import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../../../../api/common/constants'

// Where the sheet takes payments, and the server calls that make a payment session. The server
// computes public.stripe.inApp at startup (pay-settings.mjs): false is today's redirect (the kill
// switch, self-host, the dev mock), and a missing publishable key means the same.
export function payUi() {
  const stripe = Meteor.settings.public.stripe || {}
  const publishableKey = /^pk_/.test(stripe.publishableKey || '') ? stripe.publishableKey : null
  return { inApp: stripe.inApp === true && Boolean(publishableKey), publishableKey }
}

// A payment attempt (design §7.3): a UUID v4, new when the sheet opens and after a change of amount
// or interval or an expired session. Session creation is idempotent per attempt on the server.
export const newAttempt = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : null)

/** → { ui:'elements', clientSecret, sessionId } | { ui:'hosted', url, sessionId } (the server decides). */
export function makeSession({ action, wallet, choice, attemptId, ui }) {
  if (action === 'pro') return Meteor.callAsync(CONSTANTS.methods.pro.checkout, { interval: choice?.interval === 'year' ? 'year' : 'month', ui, ...(attemptId && { attemptId }) })
  if (action === 'topup') return Meteor.callAsync(CONSTANTS.methods.wallet.createTopUp, { amountCents: choice?.amountCents, wallet: wallet === 'team' ? 'team' : 'me', ui, ...(attemptId && { attemptId }) })
  if (action === 'card') return Meteor.callAsync(CONSTANTS.methods.pro.cardSession, { ...(attemptId && { attemptId }) })
  return Promise.reject(Object.assign(new Error('nothing to pay'), { error: 'invalid', reason: 'There is nothing to pay for here.' }))
}
