// The pay sheet's states (design §6). Pure: the sheet dispatches what the person did and what the
// payment SDK and the server answered; this decides what is shown next. Nothing here grants anything:
// Pro and balances change only on the server (pro.confirm, wallet.confirmTopUp, the webhook).
//
// closed ─open→ preparing ─session→ ready ─pay→ confirming ─success→ finalizing ─summary→ welcome ─close→ closed (+retry)
//   preparing ─refused→ blocked · confirming ─decline/tax/thrown→ ready + error (the form keeps its input)
//   expired → preparing once, silently · finalizing ─timeout→ welcome(pending), no retry
//   success but unpaid (an async method) → welcome(processing): the webhook decides
// Manage (lane D): ready ─manage-run→ confirming ─notice/error→ ready · ─bank→ confirming (the bank's
//   window) · ─done→ welcome (switch or card, check only, already confirmed)
//   card setup: finalizing ─needs-action→ Manage with the bank step waiting · ─card-declined→ card pane again

export const STAGES = Object.freeze(['closed', 'preparing', 'blocked', 'ready', 'confirming', 'finalizing', 'welcome'])

// Actions that pay through a Checkout session; 'manage' needs none, the rest are not payments.
export const SESSION_ACTIONS = Object.freeze(['pro', 'topup', 'card', 'business'])
const BLOCKED_ACTIONS = new Set(['verify', 'help', 'own-key', 'sign-in', 'none'])

// After a successful confirm the server is asked 1 s apart, then 2 s apart, for 15 s in all.
export const POLL_DELAYS_MS = Object.freeze([1000, 1000, 1000, 1000, 1000, 2000, 2000, 2000, 2000, 2000])

export const COPY = Object.freeze({
  declined: 'Your card was declined.',
  declinedTail: 'Nothing was charged. Try another card.',
  // only when the wallet buttons were shown above the card field (StripeCheckout found one)
  declinedTailWallet: 'Nothing was charged. Try another card, or pay with a wallet above.',
  generic: 'Something went wrong. Nothing was charged.',
  tax: "We couldn't work out tax for that address. Check the country and ZIP, then try again.",
  expired: 'This payment timed out. Nothing was charged. Close this and try again.',
  cardSaved: 'The card is saved, but the payment did not go through. Try another card.',
  refunded: cents => `This top-up of $${(cents / 100).toFixed(2)} would have gone past the balance limits, so the whole payment was refunded to your card.`,
})

export const initialSheet = Object.freeze({
  stage: 'closed',
  request: null, // { action, wallet, from, reason }
  choice: null, // { interval } | { amountCents }
  attemptId: null,
  hosted: false, // in-app payments off: Pay leaves for the hosted page
  session: null, // { ui, clientSecret, sessionId }
  error: null, // { kind: 'declined'|'tax'|'generic'|'expired'|'invalid', message }
  blocked: null, // { kind, code?, reason? }
  renewed: false, // the one silent new session after an expiry was used
  paid: null, // { kind, sessionId }
  confirmed: false, // the server has the payment and meter.summary shows it
  variant: null, // welcome: 'done' | 'pending' | 'processing'
  noRetry: false,
  retry: null, // after close: 'now' | 'when-confirmed' | null
  late: false, // confirmed after the sheet was closed (a quiet note says so)
  detail: null, // what the server confirmed: { amountCents } | { pastDueCleared } | { interval, nextDate }
  job: null, // Manage: the action running ('to-year' | 'to-month' | 'keep-year' | 'stop' | 'keep' | 'bank')
  notice: null, // Manage: what the last action did, in words
  bank: null, // Manage: a payment waiting for the bank's confirmation ('card'), run when the pane opens
})

/** Whether close, Esc, the backdrop and a swipe may close the sheet. */
export const canClose = state => state.stage !== 'confirming'

const sentence = text => {
  const t = String(text || '').trim()
  return t && !/[.!?]$/.test(t) ? `${t}.` : t
}

/**
 * What a confirm() result means for the sheet. seen.wallets: the wallet buttons were shown (the
 * decline then offers them; never when none was found).
 */
export function confirmOutcome(result, seen = {}) {
  if (result?.type === 'success') {
    const status = result.session?.status
    if (status?.type === 'complete' && ['paid', 'no_payment_required'].includes(status.paymentStatus)) return { kind: 'paid', sessionId: result.session.id }
    if (status?.type === 'expired') return { kind: 'expired' }
    return { kind: 'processing', sessionId: result.session?.id ?? null }
  }
  const error = result?.error || {}
  const message = String(error.message || '')
  if (/expired/i.test(message)) return { kind: 'expired' }
  if (/tax/i.test(message)) return { kind: 'tax', message: COPY.tax }
  if (error.code === 'paymentFailed') {
    return { kind: 'declined', message: `${sentence(message) || COPY.declined} ${seen.wallets ? COPY.declinedTailWallet : COPY.declinedTail}` }
  }
  // a buyer error with no code (an incomplete field, a card the processor refused before charging)
  return { kind: message ? 'invalid' : 'generic', message: message ? `${sentence(message)} Nothing was charged.` : COPY.generic }
}

const fresh = (state, patch) => ({ ...state, error: null, ...patch })

function open(state, { request, attemptId, choice = null, inApp = true }) {
  const action = request?.action
  const base = { ...initialSheet, request: { wallet: null, from: 'profile', reason: '', ...request }, attemptId, choice }
  if (SESSION_ACTIONS.includes(action)) return inApp ? { ...base, stage: 'preparing' } : { ...base, stage: 'ready', hosted: true }
  if (action === 'manage') return { ...base, stage: 'ready' }
  return { ...base, stage: 'blocked', blocked: { kind: BLOCKED_ACTIONS.has(action) ? action : 'none' } }
}

// Never reuses the expired attempt: without a new one the expiry is shown instead.
function expire(state, attemptId) {
  if (state.renewed || !attemptId || attemptId === state.attemptId) return { ...state, stage: 'ready', error: { kind: 'expired', message: COPY.expired } }
  return { ...state, stage: 'preparing', attemptId, session: null, error: null, renewed: true }
}

// nextAttemptId: a new attempt for the one silent new session after an expiry. The expired
// attempt's idempotency key cannot be reused: the new session's expires_at differs, and Stripe
// refuses a known key with different parameters.
function afterConfirm(state, result, nextAttemptId, wallets = false) {
  const out = confirmOutcome(result, { wallets })
  if (out.kind === 'paid') return fresh(state, { stage: 'finalizing', paid: { kind: state.request.action, sessionId: out.sessionId }, confirmed: false })
  if (out.kind === 'processing') return fresh(state, { stage: 'welcome', variant: 'processing', paid: { kind: state.request.action, sessionId: out.sessionId }, noRetry: true })
  if (out.kind === 'expired') return expire(state, nextAttemptId)
  return { ...state, stage: 'ready', error: { kind: out.kind, message: out.message } }
}

function close(state) {
  if (!canClose(state)) return state
  let retry = null
  if (state.paid && !state.noRetry) retry = state.confirmed ? 'now' : 'when-confirmed'
  // a payment still being confirmed stays known after close, so the background answer can retry
  return { ...initialSheet, request: state.paid ? state.request : null, paid: state.paid, detail: state.detail, confirmed: state.confirmed, noRetry: state.noRetry, retry }
}

export function sheetReducer(state = initialSheet, event = {}) {
  switch (event.type) {
    case 'open':
      // a payment in flight is never dropped by another open
      if (['confirming', 'finalizing'].includes(state.stage)) return state
      return open(state, event)
    case 'return':
      return { ...initialSheet, stage: 'finalizing', request: { action: event.kind, wallet: null, from: 'profile', reason: '' }, paid: { kind: event.kind, sessionId: event.sessionId } }
    case 'session':
      if (state.stage !== 'preparing' || event.attemptId !== state.attemptId) return state
      // a sticky error (a declined past-due payment) stays above the new card field
      return { ...fresh(state, { stage: 'ready', session: { ui: event.ui, clientSecret: event.clientSecret ?? null, url: event.url ?? null, sessionId: event.sessionId } }), ...(state.error?.sticky && { error: state.error }) }
    case 'refused':
      if (event.attemptId && event.attemptId !== state.attemptId) return state
      if (state.stage === 'preparing') return { ...state, stage: 'blocked', blocked: { kind: 'refused', code: event.code ?? null, reason: event.reason || COPY.generic } }
      if (state.stage === 'confirming') return { ...state, stage: 'ready', error: { kind: 'refused', message: event.reason || COPY.generic } }
      return state
    case 'change':
      if (!['ready', 'preparing', 'blocked'].includes(state.stage) || !state.request) return state
      return fresh(state, { stage: state.hosted ? 'ready' : 'preparing', choice: event.choice, attemptId: event.attemptId, session: state.hosted ? state.session : null, blocked: null, renewed: false })
    case 'pay':
      if (state.stage !== 'ready') return state
      return fresh(state, { stage: 'confirming' })
    case 'confirmed':
      if (state.stage !== 'confirming') return state
      return afterConfirm(state, event.result, event.nextAttemptId, Boolean(event.wallets))
    case 'expired':
      if (!['ready', 'confirming'].includes(state.stage)) return state
      return expire(state, event.attemptId)
    case 'threw':
      if (state.stage !== 'confirming') return state
      return { ...state, stage: 'ready', error: { kind: 'generic', message: COPY.generic } }
    case 'summary': {
      // detail: what the server confirmed (e.g. { amountCents } of a top-up, { pastDueCleared } of a card)
      const detail = event.detail ? { ...state.detail, ...event.detail } : state.detail
      if (state.stage === 'closed') return state.paid ? { ...state, detail, confirmed: true, late: true, retry: state.retry === 'when-confirmed' && !state.noRetry ? 'now' : state.retry } : state
      if (state.stage === 'finalizing') return { ...state, detail, stage: 'welcome', confirmed: true, variant: 'done' }
      if (state.stage === 'welcome') return { ...state, detail, confirmed: true }
      return state
    }
    case 'timeout':
      if (state.stage !== 'finalizing') return state
      return { ...state, stage: 'welcome', variant: 'pending', noRetry: true }
    case 'refunded':
      return { ...state, stage: state.stage === 'closed' ? 'closed' : 'blocked', blocked: { kind: 'refunded', reason: COPY.refunded(event.amountCents || 0) }, noRetry: true, retry: null }
    case 'failed':
      // the server could not confirm the payment (it answers why); nothing is celebrated or retried
      return { ...state, stage: state.stage === 'closed' ? 'closed' : 'blocked', blocked: { kind: 'failed', reason: event.reason || COPY.generic }, noRetry: true, retry: null, paid: null }
    case 'manage-run':
      if (state.stage !== 'ready' || state.request?.action !== 'manage') return state
      return { ...state, stage: 'confirming', job: event.job, error: null, notice: null }
    case 'manage-bank':
      if (state.stage !== 'confirming' || !state.job) return state
      return { ...state, job: 'bank' }
    case 'manage-notice':
      if (state.stage !== 'confirming' || !state.job) return state
      return { ...state, stage: 'ready', job: null, bank: null, notice: event.text || null, error: null }
    case 'manage-error':
      if (state.stage !== 'confirming' || !state.job) return state
      return { ...state, stage: 'ready', job: null, bank: null, notice: null, error: { kind: 'manage', message: event.message || COPY.generic } }
    case 'manage-done':
      if (state.stage !== 'confirming' || !state.job) return state
      return { ...state, stage: 'welcome', variant: 'done', confirmed: true, job: null, bank: null, error: null, paid: { kind: event.kind, sessionId: null }, detail: event.detail || null }
    case 'needs-action':
      // the card is saved, and the past-due payment waits for the bank: Your Pro runs that step
      if (state.stage === 'closed') return { ...state, paid: null, retry: null }
      return { ...initialSheet, stage: 'ready', request: { ...state.request, action: 'manage' }, attemptId: state.attemptId, bank: event.kind || 'card' }
    case 'card-declined': {
      if (state.stage === 'closed') return { ...state, paid: null, retry: null }
      const message = `${sentence(event.message) || COPY.declined} ${COPY.cardSaved}`
      return { ...initialSheet, stage: 'preparing', request: { ...state.request, action: 'card' }, attemptId: event.attemptId, error: { kind: 'declined', message, sticky: true } }
    }
    case 'close':
      return close(state)
    case 'retried':
      return { ...state, retry: null }
    case 'reset':
      return initialSheet
    default:
      return state
  }
}
