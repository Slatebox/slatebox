// The in-place button a refusal offers (design §4.1): which pane of the pay sheet, and its label.
// Pure, so the rules are tested (scripts/refusal-pay.test.mjs). The server's answer (the error's
// details.pay, refusal-pay.mjs) comes first; a refusal without one (an older server, a chat row) is
// worked out here from its code and the person's own meter.summary.

import { PAY_ACTIONS, payRoute } from '../../../../api/billing/pay-route.mjs'

export const PAY_LABELS = Object.freeze({
  pro: 'Get Pro',
  topup: 'Top up',
  card: 'Update your card',
  manage: 'Your Pro',
  verify: 'Confirm your email',
  'own-key': 'Use your own key',
  help: 'Get help',
  'sign-in': 'Sign in',
})

const labelOf = ({ action, wallet }) => (action === 'topup' && wallet === 'team' ? 'Top up the team balance' : PAY_LABELS[action])

// Only the actions pay-route knows, with a wallet only for a top-up: nothing from the wire is used as is.
function known(pay) {
  if (!pay || !PAY_ACTIONS.includes(pay.action)) return null
  if (pay.action !== 'topup') return { action: pay.action, wallet: null }
  return { action: 'topup', wallet: pay.wallet === 'team' ? 'team' : 'me' }
}

/**
 * refusal: a Meteor error ({ error, reason, details: { pay } }), or { code, pay?, details? }.
 * summary: the person's meter.summary (the allowance atom), or null. metered: this server has a meter.
 * ownKeys: this server allows own keys (self-hosted only, own-keys.mjs); on Slatebox Cloud an
 *   'own-key' answer (an older server's) is worked out again without own keys.
 * → { action, wallet, label } | { action: 'again', label } (Pro switched on since) | null (not about money)
 */
export function refusalAction(refusal, { summary = null, metered = true, ownKeys = false } = {}) {
  const code = refusal?.code ?? refusal?.error
  if (typeof code !== 'string') return null
  let pay = known(refusal.pay ?? refusal.details?.pay)
  if (!pay) {
    if (!metered) return null
    pay = payRoute({ code, details: refusal.details || {}, summary })
  }
  if (pay.action === 'own-key' && !ownKeys) {
    pay = payRoute({ code, details: refusal.details || {}, summary: { ...(summary || {}), ownKeysAvailable: false } })
  }
  if (pay.action === 'none') return null
  // Pro came on since this was refused (the sheet, another tab): the surface just tries again
  if (pay.action === 'pro' && summary?.proState?.active) return { action: 'again', wallet: null, label: 'Pro is on. Try again' }
  return { ...pay, label: labelOf(pay) }
}

/** A slate chat row's refusal, for the person it refused only (others on the slate read the text). */
export function refusalForViewer(row, userId) {
  if (!userId || !row?.refusal || row.refusal.userId !== userId || typeof row.refusal.code !== 'string') return null
  return { code: row.refusal.code, reason: row.text || '' }
}

// In a chat message itself (owner, 2026-11-24: the offer belongs right in the chat, with the same pay sheet, so it can be
// done right then, really easily): both ways on as buttons in the refusing message, each opening the same pay sheet on
// its pane, and the request runs again once paid.
export const INLINE_LABELS = Object.freeze({ pro: 'Get Slatebox Pro — $5/month', topup: 'Add a balance', again: 'Run it now' })

/**
 * The buttons a refusal carries inside a chat message: [{ action, wallet, choice, label }], Pro first. A refusal Pro or a
 * balance answers offers both where this server sells them and Pro is not on yet; Pro switched on since is "Run it now";
 * anything else (confirm the email, sign in, the card, a team admin) is its one button, as refusalAction says. [] when it
 * is not about money.
 */
export function inlinePayActions(refusal, options = {}) {
  const one = refusalAction(refusal, options)
  if (!one) return []
  if (one.action === 'again') return [{ action: 'again', wallet: null, choice: null, label: INLINE_LABELS.again }]
  if ((one.action !== 'pro' && one.action !== 'topup') || one.wallet === 'team') return [{ ...one, choice: null }]
  const { summary = null } = options
  const actions = []
  if (summary?.proAvailable !== false && !summary?.proState?.active) actions.push({ action: 'pro', wallet: null, choice: { interval: 'month' }, label: INLINE_LABELS.pro })
  if (summary?.topUpsAvailable !== false) actions.push({ action: 'topup', wallet: 'me', choice: null, label: INLINE_LABELS.topup })
  return actions.length ? actions : [{ ...one, choice: null }]
}

/** What the refusing message says when it carries both buttons: short, the buttons say the rest. */
export function inlineRefusalText(refusal, actions) {
  const both = actions.some(item => item.action === 'pro') && actions.some(item => item.action === 'topup')
  if (both) return 'This needs Slatebox Pro or a balance. Choose one here and it runs as soon as it’s paid.'
  return refusal?.reason ?? ''
}
