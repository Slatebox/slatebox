// The pay sheet's attempt: a UUID v4 the sheet makes when it opens (and again after a success or a
// change of amount or interval). Session creation is idempotent per attempt, so a double click makes
// one session and a deliberate second payment makes another (design §7.3). Pure.

export const PAY_UIS = Object.freeze(['elements', 'hosted'])
// Checkout's integration_identifier for sessions the sheet makes (separates their conversion stats;
// the runtime gate greps the shipped bundle for it).
export const SHEET_INTEGRATION = 'slatebox_pay_sheet'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const isAttemptId = value => typeof value === 'string' && UUID_V4.test(value)

export const payError = (error, reason) => Object.assign(new Error(reason), { error, reason })

/**
 * Stripe's answer to a known idempotency key sent with other parameters (or while the first call
 * still runs), as a refusal the sheet shows, never a server error. Anything else → null.
 */
export function idempotencyRefusal(error) {
  const type = error?.type || error?.rawType || error?.raw?.type
  if (type !== 'StripeIdempotencyError' && type !== 'idempotency_error') return null
  return payError('attempt', 'This payment was already started with other details. Close this and try again. Nothing was charged.')
}

export const checkoutMinute = now => Math.floor(now / 60_000)

export function checkUi(ui) {
  if (!PAY_UIS.includes(ui)) throw payError('ui', 'This payment cannot be started.')
  return ui
}

/**
 * The attempt part of an idempotency key. Without an attempt (a caller from before the sheet) it is
 * the minute, as before; a malformed attempt is refused.
 */
export function attemptPart(attemptId, now) {
  if (attemptId === undefined || attemptId === null) return `m${checkoutMinute(now)}`
  if (!isAttemptId(attemptId)) throw payError('attempt', 'This payment cannot be started. Close it and try again.')
  return attemptId
}

/** The mode a session is made in: the sheet's only where in-app payments are on (public.stripe.inApp). */
export const sessionUi = (ui, inApp) => (checkUi(ui) === 'elements' && inApp ? 'elements' : 'hosted')

/** What a session-making method returns: the client secret for the sheet, the URL for the redirect. */
export const sessionAnswer = (ui, session) => (ui === 'elements'
  ? { ui, clientSecret: session.client_secret, sessionId: session.id }
  : { ui, url: session.url, sessionId: session.id })
