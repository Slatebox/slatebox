// The pay sheet's links (design §2): ?pay=pro|topup|card|manage|business (exec/MCP links, the profile,
// the team page) opens a pane; ?pro= / ?topup= / ?card= / ?business= with a Checkout session id is the return from a payment that left
// the page (the hosted fallback, or a redirecting method) and opens the Welcome in finalizing. Pure.

export const PAY_PARAMS = Object.freeze(['pay', 'wallet', 'plan', 'pro', 'topup', 'card', 'business'])
const OPENABLE = new Set(['pro', 'topup', 'card', 'manage', 'business'])
const SESSION_ID = /^cs_[A-Za-z0-9_]+$/

/** A plan named in a link (?plan=monthly|yearly, also month|year) → 'month' | 'year' | null. */
export function planInterval(value) {
  const plan = String(value || '').toLowerCase()
  if (plan === 'monthly' || plan === 'month') return 'month'
  if (plan === 'yearly' || plan === 'year' || plan === 'annual') return 'year'
  return null
}

/** → { open: { action, wallet, from, choice? } } | { back: { kind, sessionId } } | null */
export function payRequestFromQuery(params) {
  const kind = ['pro', 'topup', 'card', 'business'].find(k => SESSION_ID.test(params.get(k) || ''))
  if (kind) return { back: { kind, sessionId: params.get(kind) } }
  const action = params.get('pay')
  if (!OPENABLE.has(action)) return null
  let wallet = null
  if (action === 'topup') wallet = params.get('wallet') === 'team' ? 'team' : 'me'
  const interval = ['pro', 'business'].includes(action) ? planInterval(params.get('plan')) : null
  return { open: { action, wallet, from: interval ? 'site' : 'profile', ...(interval && { choice: { interval } }) } }
}

/**
 * The site's "Get Slatebox Pro" (/pro?plan=monthly|yearly): where the app opens the sheet, preselected.
 * The sheet opens over My Slates; anyone may pay, a guest included (PaySheetHost.jsx).
 */
export const proSheetPath = params => `/?pay=pro&plan=${planInterval(params.get('plan')) === 'year' ? 'yearly' : 'monthly'}`

/**
 * The site's "Get Slatebox Business" (/business?plan=monthly|yearly): the team page with the sheet
 * preselected. Only a team's owner or admin pays; the team page says what anyone else can do.
 */
export const businessSheetPath = params => `/team?pay=business&plan=${planInterval(params.get('plan')) === 'year' ? 'yearly' : 'monthly'}`

/**
 * The old site link (/profile?tab=credits, and ?buy=pro-monthly|pro-yearly): → the /pro route for a
 * visitor who is not a member yet (a guest, or nobody signed in) or who named a plan; null otherwise
 * (a member's own Credits tab stays as it is).
 */
export function oldProLink(params, account) {
  if (!['credits', 'free'].includes(params.get('tab'))) return null
  const buy = /^pro-(monthly|yearly)$/.exec(params.get('buy') || '')
  if (buy) return `/pro?plan=${buy[1]}`
  if (account === 'member') return null
  return '/pro'
}

/** Where the login page sends a person who arrived with ?pay=: the pane on Credits, or null. */
export function loginReturn(params) {
  const action = params.get('pay')
  if (action === 'business') return '/team?pay=business'
  return OPENABLE.has(action) ? `/profile?tab=credits&pay=${action}` : null
}
