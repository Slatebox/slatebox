// The header button on a self-hosted install (owner, 2026-11-25): what it shows, to whom,
// and the words of the two choices it opens. MIT, read the same way by the browser and the server,
// and tested without Meteor (scripts/selfhost-options.test.mjs).
//
// The two choices, each one click:
//   - Unlock enterprise and stay on your own servers: a free trial key from Slatebox Cloud (device
//     sign-in), applied at once and checked offline after that; or a license key pasted in.
//   - Move your team to Slatebox Cloud: the team's export goes from this server to Cloud, server to
//     server, after a device sign-in; this install is left as it was.
//
// Who sees what:
//   - Slatebox Cloud: nothing, ever (it is already Cloud, with enterprise code on).
//   - A guest, or nobody signed in: nothing.
//   - This server's administrator (the uberMensch claim): the button, both choices actionable.
//   - Anyone else signed in: a quiet "Enterprise" link (not the gold Upgrade: they cannot act), with
//     the same reasons and Ask your admin in place of the buttons.
//   - A kept key that has ended (or will not unlock here): the admin's button reads Renew, and the
//     panel says when it ended and leads with Get a license and the pasted key.
//   - Once enterprise code is unlocked here: a small "Enterprise" status chip ("Renew" in a license's
//     grace days) in place of the button; the move to Cloud stays one click away in its menu.
// No price is ever shown in the app: "Compare" and "Get a license" go to slatebox.com.
import { editionOf, enterpriseState } from './edition.mjs'

export const PLANS_URL = 'https://slatebox.com/plans/'
export const LICENSE_URL = 'https://slatebox.com/contact/?topic=on-prem&source=app-header'
export const CLOUD_ORIGIN = 'https://app.slatebox.com'
const DAY = 86_400_000
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10)

/** The trial button's words: the length only when Slatebox Cloud said it (Cloud decides, without a release). */
export const trialLabel = (days) => (Number.isInteger(days) && days > 0 ? `Start ${days}-day free trial` : 'Start free trial')

// A kept key that will not unlock here, in the panel's words (status.license from selfhost.status).
const ENDED = new Set(['expired', 'wrong_host', 'not_yet'])

/**
 * What the header shows.
 * @param {{ settings: object, signedIn: boolean, serverAdmin: boolean|null, license?: { reason?: string }|null }} who
 *   serverAdmin null while the server has not answered yet (show nothing until it has).
 * @returns {{ show: 'none'|'offer'|'chip', role?: 'admin'|'member', chip?: 'enterprise'|'renew', ended?: true }}
 */
export function upgradeOffer({ settings, signedIn, serverAdmin, license = null }) {
  if (editionOf(settings) === 'cloud') return { show: 'none' }
  if (!signedIn || serverAdmin === null || serverAdmin === undefined) return { show: 'none' }
  const role = serverAdmin ? 'admin' : 'member'
  if (enterpriseState(settings).unlocked) {
    const renew = license?.reason === 'grace'
    return { show: 'chip', role, chip: renew ? 'renew' : 'enterprise' }
  }
  if (role === 'admin' && ENDED.has(license?.reason) && license?.license) return { show: 'offer', role, ended: true }
  return { show: 'offer', role }
}

/**
 * What the panel says up front about a kept key that has ended, is ending, or will not unlock here.
 * @param {{ reason?: string, license?: { trial?: boolean, expiresAt?: string, issuedAt?: string, hosts?: string[] }|null, endsAt?: number|null }|null} status
 * @returns {null | { kind: 'grace'|'expired'|'wrong_host'|'not_yet', trial: boolean, title: string, text: string }}
 */
export function licenseNotice(status) {
  const license = status?.license
  if (!license) return null
  const trial = license.trial === true
  const what = trial ? 'free trial' : 'license'
  if (status.reason === 'grace') {
    const until = typeof status.endsAt === 'number' ? ymd(status.endsAt - DAY) : null
    return {
      kind: 'grace',
      trial,
      title: `Your ${what} ended on ${license.expiresAt}.`,
      text: `Enterprise features stay on${until ? ` until ${until}` : ' for a few more days'}, then turn off. Get a license to keep them on.`,
    }
  }
  if (status.reason === 'expired')
    return {
      kind: 'expired',
      trial,
      title: `Your ${what} ended on ${license.expiresAt}.`,
      text: `Enterprise features are off on this server. ${trial ? 'The free trial is used, so ' : ''}Get a license to turn them back on, or paste a license key. Your slates, people and settings are all still here.`,
    }
  if (status.reason === 'wrong_host')
    return {
      kind: 'wrong_host',
      trial,
      title: `The ${what} kept here is for ${(license.hosts || []).join(', ') || 'another server'}.`,
      text: "It does not match this server's address, so enterprise features are off. Paste a license key for this address, or get one.",
    }
  if (status.reason === 'not_yet')
    return { kind: 'not_yet', trial, title: `The ${what} kept here starts on ${license.issuedAt}.`, text: 'Enterprise features turn on that day.' }
  return null
}

// What enterprise code does, in the order the panel lists it. Only what enterprise/ really holds
// (enterprise/server/index.js registers it; scripts/selfhost-options.test.mjs checks each
// against the code under the enterprise test resolver).
export const ENTERPRISE_VALUE = Object.freeze([
  {
    id: 'agents',
    title: 'Invite outside agents onto a slate',
    text: 'GitHub, Linear, Notion, Jira, Slack, Sentry and more join a slate by name, bring their work in as notes, and propose changes a person approves.',
  },
  {
    id: 'integrations',
    title: 'Integrations, connected once',
    text: 'Each person connects an outside agent once, then invites it onto any slate. Standing rules keep the same agents on new slates.',
  },
  {
    id: 'catalog',
    title: 'The integration catalog',
    text: 'A curated gallery of first-party agent servers, each with what it adds to a slate, plus any MCP server address your team adds.',
  },
  {
    id: 'google',
    title: 'Google Drive, Docs and Slides',
    text: 'Save slates to Drive, export to Docs and Slides, and bring Drive files onto a slate.',
  },
  {
    id: 'gallery-admin',
    title: 'Your own gallery',
    text: 'Administrators choose which agents your people see, in which order, and what each one does.',
  },
])

// The catalog's names for the preview (the cards themselves are enterprise code, enterprise/common/gallery.mjs).
export const PREVIEW_AGENTS = Object.freeze(['GitHub', 'Linear', 'Notion', 'Jira and Confluence', 'Slack', 'Sentry', 'Hugging Face', 'Google Drive'])

// What stays free everywhere, whichever choice is made (said once in the panel).
export const FREE_EVERYWHERE = 'Single sign-on with Keycloak, the MCP server, the CLI, the API and every canvas feature stay free on every install.'

export const MOVE_WHAT_MOVES = Object.freeze([
  'Slates and boards, versions, comments and presentations',
  'People (each invited to sign in on Cloud when you say so)',
  'Team settings and brand kit',
  'Files and pictures, and library items (to Cloud\'s review queue)',
])

export const MOVE_WHAT_CHANGES = Object.freeze([
  'Your team\'s address becomes app.slatebox.com.',
  'People sign in on Slatebox Cloud with the same email.',
  'Agent keys, access tokens and integrations are set up again on Cloud.',
  'This server keeps its copy, untouched, until you remove it.',
])

// The moves's and the trial's steps as the panel names them (server/selfhost-options/service.mjs states).
export const FLOW_WORDS = Object.freeze({
  signing_in: 'Waiting for you to approve on Slatebox Cloud',
  issuing: 'Getting your trial key',
  applying: 'Turning enterprise features on',
  unlocked: 'Enterprise features are on',
  exporting: 'Packing up your team',
  uploading: 'Sending it to Slatebox Cloud',
  review: 'Ready to go live on Slatebox Cloud',
  confirming: 'Making it live on Slatebox Cloud',
  moved: 'Your team is on Slatebox Cloud',
  failed: 'Stopped',
  cancelled: 'Cancelled',
})
