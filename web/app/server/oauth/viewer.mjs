// The Slatebox viewer app (iOS and Android): a first-party public OAuth client that reads slates and
// adds photos (slates.addPhoto), and makes no other write. It signs in through the system browser with the authorization code grant and PKCE
// S256 (core.mjs), back to the app's own scheme, with no client registration (no DCR).
//
//   client    one pre-registered public client, id settings.mobile.clientId ('slatebox-viewer' by
//             default), sending the person back to settings.mobile.redirects. It is off until the
//             operator sets at least one usable redirect: a server never offers a sign-in that returns
//             to an app scheme no released app claims yet.
//   scopes    slates:read, and slates:add-photo when the app asks for it and the person allows it (a
//             sign-in that names no scope gets slates:read only). account.get needs no scope.
//   token     an ordinary connection (slateApiTokens, kind 'oauth'): a 1-hour access token and a
//             30-day refresh token, both rotated on refresh, listed and disconnected under Profile ›
//             Developer › Connected apps. It is bound to VIEWER_RESOURCE_PATH, which /api/v1 takes for
//             VIEWER_ACTIONS only (server/actions/mount.js): reads, and adds photos; no other write,
//             never /mcp. Its photos are the person's own edit (firstParty 'viewer'), never an agent's
//             suggestion.
//
// MIT, runs without Meteor (scripts/mobile-viewer.test.mjs). settings.mobile.enabled === false, or no
// usable redirect, turns the client off.
import { allowedRedirect } from './core.mjs'
import { MOVE_ACTIONS, MOVE_RESOURCE_PATH } from './device.mjs'

export const VIEWER_CLIENT_ID = 'slatebox-viewer'
export const VIEWER_NAME = 'Slatebox viewer'
// What the consent page calls the app. It is Slatebox's own, so the page says so (verified) instead
// of warning about an app Slatebox has not checked. A server that gives its viewer a name of its own
// (settings.mobile.name other than VIEWER_NAME, which settings.example.json spells out) shows that name instead.
export const VIEWER_CONSENT_NAME = 'Slatebox for iPhone and Android'
// The redirect settings.example.json suggests. It is not a default: the client stays off until redirects are set.
export const VIEWER_REDIRECTS = Object.freeze(['com.slatebox.viewer://oauth'])
export const VIEWER_SCOPES = Object.freeze(['slates:read', 'slates:add-photo'])
// What a sign-in that names no scope gets: reading only. The app asks for photos by name.
export const VIEWER_DEFAULT_SCOPES = Object.freeze(['slates:read'])
export const VIEWER_RESOURCE_PATH = '/api/v1/viewer'
// What a viewer token may read on /api/v1, and its one write, and nothing else.
export const VIEWER_READ_ACTIONS = Object.freeze(['account.get', 'slates.list', 'slates.get', 'presentations.get', 'comments.list', 'slates.live'])
export const VIEWER_ACTIONS = Object.freeze([...VIEWER_READ_ACTIONS, 'slates.addPhoto'])
export const VIEWER_REFUSAL = 'This sign-in is for the Slatebox mobile app, which reads slates and adds photos. Use an access token from Profile › Developer for anything else.'

const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/
// A bare app scheme in reverse-DNS form (com.acme.boards): at least one dot, so a mistyped "https" or
// "ftp" is never read as https://oauth.
const APP_SCHEME = /^[a-z][a-z0-9+-]*(\.[a-z0-9+-]+)+$/

// One redirect: a full address (an app scheme or https, never http), or a bare reverse-DNS app
// scheme, which means <scheme>://oauth.
function redirectFrom(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const uri = APP_SCHEME.test(text) ? `${text}://oauth` : text
  if (!allowedRedirect(uri) || uri.startsWith('http:')) return null
  return uri
}

/**
 * The viewer client from the settings, or null when it is off (enabled: false, or no usable redirect):
 * { clientId, name, consentName, redirects, scopes, defaultScopes, resourcePath, actions, ignored }. Redirects that are not an app
 * scheme or https are left out and named in `ignored`.
 */
export function viewerClient(settings = {}) {
  const conf = settings?.mobile && typeof settings.mobile === 'object' ? settings.mobile : {}
  if (conf.enabled === false) return null
  const clientId = typeof conf.clientId === 'string' && CLIENT_ID.test(conf.clientId.trim()) ? conf.clientId.trim() : VIEWER_CLIENT_ID
  const asked = Array.isArray(conf.redirects) ? conf.redirects : [conf.redirects].filter((value) => typeof value === 'string')
  const ignored = asked.filter((value) => !redirectFrom(value)).map(String)
  const redirects = [...new Set(asked.map(redirectFrom).filter(Boolean))]
  if (!redirects.length) return null
  const named = typeof conf.name === 'string' && conf.name.trim() ? conf.name.trim().slice(0, 80) : ''
  const name = named || VIEWER_NAME
  return {
    clientId,
    name,
    consentName: named && named !== VIEWER_NAME ? named : VIEWER_CONSENT_NAME,
    redirects: redirects.slice(0, 10),
    scopes: [...VIEWER_SCOPES],
    defaultScopes: [...VIEWER_DEFAULT_SCOPES],
    resourcePath: VIEWER_RESOURCE_PATH,
    actions: [...VIEWER_ACTIONS],
    ignored,
  }
}

/**
 * What /api/v1 takes a connected app's token for (server/actions/mount.js): its resource → the
 * actions it may call. A move's device sign-in (device.mjs), and the viewer app when it is on.
 * Pass the keys as authenticateApiRequest's audience and the whole as principalFromToken's audiences.
 */
export function apiAudiences({ origin, viewer }) {
  const at = new URL(origin).origin
  const audiences = { [at + MOVE_RESOURCE_PATH]: MOVE_ACTIONS }
  if (viewer) audiences[at + viewer.resourcePath] = { actions: viewer.actions, refusal: VIEWER_REFUSAL, firstParty: 'viewer' }
  return audiences
}
