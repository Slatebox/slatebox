// Which pane of the in-app pay sheet a meter refusal opens (design §4). Pure and shared: the server
// puts the answer on a refusal's details (Meteor.Error(code, reason, { pay })), and the client
// uses the same function for a refusal that has none. Nothing here decides money: the sheet's
// server methods check everything again.
//
// payRoute({ code, details, summary }) → { action, wallet }
//   code: the meter's refusal code (server/metering/policy.mjs, holds.mjs)
//   details: the refusal's details; details.wallet 'team' when a team balance was the payer
//   summary: meter.summary (proAvailable, topUpsAvailable, ownKeysAvailable, proState, teamAdmin,
//     emailVerified), or null for a guest. A missing flag counts as available, except
//     ownKeysAvailable: own keys are offered only where the server says so (self-hosted Slatebox,
//     own-keys.mjs), never on Slatebox Cloud. The sheet's methods refuse if not.
//   action: 'pro' (Pro pane) | 'topup' (Top-up pane, with wallet 'me' or 'team') | 'card' (update
//     the card of a Pro whose payment failed) | 'manage' (Pro is already on) | 'verify' (confirm the
//     email first) | 'sign-in' | 'own-key' (no payments on a self-hosted server: its own keys) | 'help' (a
//     team admin or the billing contact form) | 'none' (not about money)

export const PAY_ACTIONS = Object.freeze(['pro', 'topup', 'card', 'manage', 'verify', 'sign-in', 'own-key', 'help', 'none'])

const PRO_CODES = new Set(['pro', 'pro-images', 'pro-calls'])
// the included amount or a balance ran out, or the shared budget paused it: a top-up pays for more
const TOP_UP_CODES = new Set(['ai-today', 'ai-month', 'ai-paused', 'calls-today', 'calls-month', 'calls-paused', 'video-stage', 'balance'])
const HELP_CODES = new Set(['frozen', 'free-stopped'])

/** Every refusal code the meter gives that pay-route answers (scripts/pay-route.test.mjs reads the meter's). */
export const PAY_CODES = Object.freeze([
  ...PRO_CODES, 'pro-past-due', ...TOP_UP_CODES, ...HELP_CODES, 'unverified', 'guest', 'presentations-today',
].sort())

const answer = (action, wallet = null) => Object.freeze({ action, wallet: action === 'topup' ? wallet : null })

function topUp({ details, summary }) {
  // No top-ups here: a self-hosted server offers its own keys; Slatebox Cloud offers Pro when it is
  // on sale and not held yet, else the billing contact form.
  if (summary?.topUpsAvailable === false) {
    if (summary?.ownKeysAvailable === true) return answer('own-key')
    if (summary?.proAvailable !== false && !summary?.proState?.active) return answer('pro')
    return answer('help')
  }
  if (details?.wallet === 'team') return summary?.teamAdmin === true ? answer('topup', 'team') : answer('help')
  return answer('topup', 'me')
}

export function payRoute({ code, details = {}, summary = null } = {}) {
  if (typeof code !== 'string') return answer('none')
  if (code === 'guest') return answer('sign-in')
  if (HELP_CODES.has(code)) return answer('help')
  const paying = PRO_CODES.has(code) || TOP_UP_CODES.has(code) || code === 'pro-past-due' || code === 'presentations-today' || code === 'unverified'
  if (!paying) return answer('none')
  // an unconfirmed email confirms first: no payment is taken before it
  if (code === 'unverified' || summary?.emailVerified === false) return answer('verify')
  if (code === 'presentations-today') return summary ? topUp({ details, summary }) : answer('sign-in')
  const pro = summary?.proState
  const payments = summary?.proAvailable !== false || summary?.topUpsAvailable !== false
  if (code === 'pro-past-due' || (PRO_CODES.has(code) && pro?.pastDue)) return payments ? answer('card') : answer('help')
  if (PRO_CODES.has(code)) {
    // Pro is already on: never a second purchase
    if (pro?.active) return answer('manage')
    if (summary?.proAvailable !== false) return answer('pro')
    return topUp({ details, summary })
  }
  return topUp({ details, summary })
}
