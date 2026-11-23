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
