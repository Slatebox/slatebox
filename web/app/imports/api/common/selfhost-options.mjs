// The header's Move to Cloud on a self-hosted install (owner, 2026-11-25): who sees it, and the
// words of the panel it opens. MIT, read the same way by the browser and the server, and tested
// without Meteor (scripts/selfhost-options.test.mjs).
//
// Integrations are free on every install (owner, 2026-11-26), so the button has one job: move the
// team to Slatebox Cloud in one click (the team's export goes from this server to Cloud, server to
// server, after a device sign-in; this install is left as it was).
//
// Who sees it:
//   - Slatebox Cloud: nothing, ever.
//   - A guest, or nobody signed in: nothing.
//   - This server's administrator (the uberMensch claim): Move to Cloud.
//   - Anyone else signed in: nothing (only an administrator can move a team).
import { editionOf } from './edition.mjs'

export const CLOUD_ORIGIN = 'https://app.slatebox.com'

/** The header button's name (and its panel's title). */
export const MOVE_LABEL = 'Move to Cloud'
/** Its name once a team has moved from this server: it still opens the panel (the banner switch). */
export const MOVED_LABEL = 'On Slatebox Cloud'

/** The header button's name for this status (selfhost.status): MOVED_LABEL after a finished move. */
export const moveLabel = (status) => (status?.movedSaved || status?.move?.state === 'moved' ? MOVED_LABEL : MOVE_LABEL)

/**
 * Whether the header shows Move to Cloud.
 * @param {{ settings: object, signedIn: boolean, serverAdmin: boolean|null }} who
 *   serverAdmin null while the server has not answered yet (show nothing until it has).
 * @returns {{ show: 'none'|'move' }}
 */
export function cloudMoveOffer({ settings, signedIn, serverAdmin }) {
  if (editionOf(settings) === 'cloud') return { show: 'none' }
  if (!signedIn || serverAdmin !== true) return { show: 'none' }
  return { show: 'move' }
}

// What stays the same whichever way the team goes (said once in the panel).
export const FREE_HERE = 'Staying is fine too: integrations, single sign-on with Keycloak, the MCP server, the CLI, the API and every canvas feature are free on this server.'

// Where the footer's Compare goes: the side-by-side of Slatebox Cloud and self-hosted on
// slatebox.com (the comparison section, id "compare"; owner, 2026-11-26).
export const COMPARE_URL = 'https://slatebox.com/plans/#compare'
export const COMPARE_LABEL = 'Compare on slatebox.com'

// What the team gets by moving (owner, 2026-11-26): only what is true on Cloud for every team.
export const MOVE_WHAT_YOU_GET = Object.freeze([
  'Calls and huddles ready, with no Daily account to set up',
  'The agent ready, with no provider accounts or keys to manage (you can add your own keys there too)',
  'Nothing to run, update or back up',
  'The same slates and the same people',
])

export const MOVE_WHAT_MOVES = Object.freeze([
  'Slates and boards, versions, comments and presentations',
  'People (each invited to sign in on Cloud when you say so)',
  'Team settings and brand kit',
  'Files and pictures, and library items (to Cloud\'s review queue)',
])

export const MOVE_WHAT_CHANGES = Object.freeze([
  'Your team\'s address becomes app.slatebox.com.',
  'People sign in on Slatebox Cloud with the same email.',
  'Access tokens and integrations are set up again on Cloud.',
  'This server keeps its copy, untouched, until you remove it.',
])

// The move's steps as the panel names them (server/selfhost-options/service.mjs states).
export const FLOW_WORDS = Object.freeze({
  signing_in: 'Waiting for you to approve on Slatebox Cloud',
  exporting: 'Packing up your team',
  uploading: 'Sending it to Slatebox Cloud',
  review: 'Ready to go live on Slatebox Cloud',
  confirming: 'Making it live on Slatebox Cloud',
  moved: 'Your team is on Slatebox Cloud',
  failed: 'Stopped',
  cancelled: 'Canceled',
})
