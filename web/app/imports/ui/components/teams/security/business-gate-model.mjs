// What single sign-on, SCIM and the activity log say when the server turns them off for a team
// (imports/api/common/team-security.mjs), as plain data. Pure, so SignInSecurity.jsx, ScimCard.jsx,
// ActivityLog.jsx and the tests run the same code.
//
// On Slatebox Cloud the three come with Slatebox Business: the notice says so plainly and offers one
// action that works here. A team owner or admin goes to Team settings › Plan & billing, where
// BusinessPanel sells it (or, on a Cloud server that takes no payments, to "Talk to us about
// Business"); anyone else is told to ask a team admin. A team whose Business has ended keeps what
// the server keeps (sign-in through its single sign-on, the log recording) and is told that
// changing the setup and reading the log come back with Business.
//
// A self-hosted server has them for every team, free: there the notice never names a plan or a
// payment (it is only shown if the server says the feature is off at all).
import { BUSINESS } from '../../../../api/business/catalog.mjs'

// Team settings › Plan & billing (team-settings-model.mjs SECTIONS 'billing', opened by ?section=).
export const BUSINESS_SECTION = 'billing'
export const BUSINESS_SECTION_PATH = `/team/settings?section=${BUSINESS_SECTION}`

export const GATED_FEATURES = Object.freeze(['sso', 'scim', 'log'])

const cloudText = {
  sso: ({ lapsed, kept, noun }) => {
    if (lapsed) return `Slatebox Business has ended for this ${noun}. People keep signing in with single sign-on as it is set up. Changing the setup comes back with Business.`
    if (kept) return 'Single sign-on comes with Slatebox Business. People keep signing in with what is already set up, and changing it needs Business.'
    return 'Single sign-on comes with Slatebox Business.'
  },
  scim: ({ lapsed, kept, noun }) => {
    if (lapsed) return `Slatebox Business has ended for this ${noun}. People SCIM added keep signing in${kept ? ', and you can still revoke a token below' : ''}. Your identity provider's changes, new tokens and group roles come back with Business.`
    if (kept) return 'SCIM provisioning comes with Slatebox Business. You can still revoke a token below.'
    return 'SCIM provisioning comes with Slatebox Business.'
  },
  log: ({ lapsed, noun }) => {
    if (lapsed) return `Slatebox Business has ended for this ${noun}. The log keeps recording, and reading and exporting it come back with Business.`
    return `The activity log comes with Slatebox Business. Entries are kept in the meantime, so the whole history is there once the ${noun} has it.`
  },
}

// Self-host: the words these surfaces always used, with no plan in them.
const selfHostText = {
  sso: ({ noun }) => `Single sign-on settings are not available for this ${noun}. People keep signing in with what is already set up.`,
  scim: ({ noun }) => `SCIM is not available for this ${noun}. You can still revoke a token below.`,
  log: () => 'The activity log could not be read.',
}

/**
 * The notice for a feature the server has turned off, or null when it is on.
 *   feature      'sso' | 'scim' | 'log'
 *   available    what the server answered (teamSso.get / teamScim.get available; audit.list not refused)
 *   cloud        isCloudEdition(settings)
 *   lapsed       the team had Slatebox Business and it has ended (organizations.business, not active)
 *   kept         something is already set up (a connection, a token) that keeps working
 *   manager      the person may buy Business for the team (the owner or an admin: mayManageBusiness)
 *   billingHere  Team settings shows Plan & billing with Business for sale (paymentsHere())
 *   → { feature, text, action: { kind: 'link', to, label } | { kind: 'href', href, label } | { kind: 'ask', label } | null }
 */
export function businessGate({ feature, available, cloud, lapsed = false, kept = false, manager = false, billingHere = false, noun = 'team' }) {
  if (!GATED_FEATURES.includes(feature)) throw new Error(`unknown feature: ${feature}`)
  if (available) return null
  if (!cloud) return { feature, text: selfHostText[feature]({ noun }), action: null }
  let action
  if (manager && billingHere) action = { kind: 'link', to: BUSINESS_SECTION_PATH, label: 'Get Slatebox Business' }
  else if (manager) action = { kind: 'href', href: BUSINESS.contactUrl, label: BUSINESS.contactLabel }
  else action = { kind: 'ask', label: `Ask a ${noun} admin to get Slatebox Business for the ${noun}.` }
  return { feature, text: cloudText[feature]({ lapsed: Boolean(lapsed), kept: Boolean(kept), noun }), action }
}
