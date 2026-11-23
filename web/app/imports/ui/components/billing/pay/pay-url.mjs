// The pay sheet's links (design §2): ?pay=pro|topup|card|manage (exec/MCP links, the profile) opens a
// pane; ?pro= / ?topup= / ?card= with a Checkout session id is the return from a payment that left
// the page (the hosted fallback, or a redirecting method) and opens the Welcome in finalizing. Pure.

export const PAY_PARAMS = Object.freeze(['pay', 'wallet', 'pro', 'topup', 'card'])
const OPENABLE = new Set(['pro', 'topup', 'card', 'manage'])
const SESSION_ID = /^cs_[A-Za-z0-9_]+$/

/** → { open: { action, wallet, from } } | { back: { kind, sessionId } } | null */
export function payRequestFromQuery(params) {
  const kind = ['pro', 'topup', 'card'].find(k => SESSION_ID.test(params.get(k) || ''))
  if (kind) return { back: { kind, sessionId: params.get(kind) } }
  const action = params.get('pay')
  if (!OPENABLE.has(action)) return null
  let wallet = null
  if (action === 'topup') wallet = params.get('wallet') === 'team' ? 'team' : 'me'
  return { open: { action, wallet, from: 'profile' } }
}

/** Where the login page sends a person who arrived with ?pay=: the pane on Credits, or null. */
export function loginReturn(params) {
  const action = params.get('pay')
  return OPENABLE.has(action) ? `/profile?tab=credits&pay=${action}` : null
}
