// A self-hosted Slatebox starts with nobody able to sign up. The installer (or `slatebox
// setup-link` in the container) makes a one-time setup link, /setup/<token>; the person who opens
// it creates the first account, which becomes the server administrator (the uberMensch claim) and
// the owner of the first team. Until then every page shows "This Slatebox isn't set up yet" and no
// account of any kind (sign-up, guest, invitation, single sign-on) can be made. Slatebox Cloud is
// never gated.
//
// The link: 32 random bytes (base64url), kept only as its SHA-256 in systemSettings
// {_id: 'selfHostSetup'}, good for 24 hours and for one use, replaced when a new one is made. It is
// never logged. No Meteor import here: unit-tested with node (scripts/self-host-setup.test.mjs).
// The container's own copy of the link maker is self-host/rootfs/opt/slatebox/lib/setup-link.mjs;
// the unit test holds the two to one hash and one record shape.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const SETUP_ID = 'selfHostSetup'
export const SETUP_TTL_MS = 24 * 60 * 60 * 1000
export const SETUP_PATH = '/setup/'
// Carries the setup link across a single sign-on round trip (the person chose "Continue with
// single sign-on" on the setup page). HttpOnly, this site only, gone after 15 minutes.
export const SETUP_COOKIE = 'slatebox_setup'
export const SETUP_COOKIE_SECONDS = 15 * 60
export const NOT_SET_UP_MESSAGE = 'This Slatebox isn\'t set up yet. Use the setup link from your install.'

const TOKEN = /^[A-Za-z0-9_-]{43}$/

/** Only a self-hosted Slatebox has a setup step; Slatebox Cloud never does. */
export function setupApplies(settings) {
  return settings?.public?.env === 'selfhost' && settings?.public?.edition !== 'cloud'
}

export const newSetupToken = () => randomBytes(32).toString('base64url')
export const hashSetupToken = (token) => createHash('sha256').update(String(token)).digest('hex')
export const tokenShape = (token) => typeof token === 'string' && TOKEN.test(token)

/** The record a new link writes (and the one it replaces): only the hash is kept. */
export function newLinkRecord(token, now = Date.now()) {
  return { tokenHash: hashSetupToken(token), createdAt: new Date(now), expiresAt: new Date(now + SETUP_TTL_MS) }
}

/** Set up: the first admin was made through a link, or the install had accounts before setup links existed. */
export const isSetUp = (doc, { registeredAccount = false } = {}) => Boolean(doc?.completedAt) || registeredAccount

/**
 * What a token opens: 'ok', 'set-up' (already done), 'expired', or 'invalid' (wrong, replaced,
 * already used, or never made). Compared by hash, in constant time.
 */
export function linkState(doc, token, now = Date.now()) {
  if (doc?.completedAt) return 'set-up'
  if (!tokenShape(token) || typeof doc?.tokenHash !== 'string' || doc.tokenHash.length !== 64) return 'invalid'
  const given = Buffer.from(hashSetupToken(token), 'hex')
  const kept = Buffer.from(doc.tokenHash, 'hex')
  if (kept.length !== given.length || !timingSafeEqual(kept, given)) return 'invalid'
  if (!(doc.expiresAt instanceof Date) || doc.expiresAt.getTime() <= now) return 'expired'
  if (doc.claimedAt) return 'invalid'
  return 'ok'
}

/** The Mongo filter that claims a link exactly once (a second, concurrent use matches nothing). */
export function claimFilter(token, now = Date.now()) {
  return {
    _id: SETUP_ID, tokenHash: hashSetupToken(token), expiresAt: { $gt: new Date(now) },
    completedAt: { $exists: false }, claimedAt: { $exists: false },
  }
}

/**
 * The update that marks setup done: the hash goes, so the link can never be used again. teamId is
 * the first team, the one single sign-on accounts join by default.
 */
export function completedModifier(userId, { via, teamId, now = Date.now() }) {
  return {
    $set: { completedAt: new Date(now), adminUserId: userId, via, ...(teamId ? { teamId } : {}) },
    $unset: { tokenHash: '', expiresAt: '', claimedAt: '', teamName: '' },
  }
}

/**
 * The team single sign-on accounts join by default, from the finished setup record: the team it
 * recorded, else (a server set up before teams were recorded) the first admin's team, read with
 * teamOf(userId). Null before setup, and on a server set up from accounts older than setup links.
 */
export async function defaultTeamFrom(doc, teamOf) {
  if (!doc?.completedAt) return null
  if (typeof doc.teamId === 'string' && doc.teamId) return doc.teamId
  if (typeof doc.adminUserId === 'string' && doc.adminUserId) return (await teamOf(doc.adminUserId)) || null
  return null
}

// Paths that are never a page: health, the setup itself, live data, the API, sign-in round trips,
// and Meteor's own. A path whose last part has a dot is a file (scripts, styles, fonts, icons).
const OPEN_PREFIXES = ['/setup/', '/readyz', '/sockjs', '/websocket', '/api/', '/sso/', '/oauth/', '/.well-known/', '/__', '/live', '/fonts/', '/packages/']

/** Whether a request, before setup, gets the "isn't set up yet" page instead of the app. */
export function gatedRequest(method, url) {
  if (method !== 'GET' && method !== 'HEAD') return false
  const path = String(url || '/').split('?')[0].split('#')[0] || '/'
  if (path === '/setup') return false
  if (OPEN_PREFIXES.some((prefix) => path === prefix.replace(/\/$/, '') || path.startsWith(prefix))) return false
  const last = path.split('/').pop()
  return !last.includes('.')
}

/** /setup/<token>[/sso] → { token, sso } or null. */
export function parseSetupPath(url) {
  const path = String(url || '').split('?')[0]
  const match = /^\/setup\/([^/]+)(\/sso)?\/?$/.exec(path)
  if (!match) return null
  return { token: match[1], sso: Boolean(match[2]) }
}

export function parseForm(body) {
  const params = new URLSearchParams(String(body || ''))
  const text = (name, max) => (params.get(name) || '').trim().slice(0, max)
  return {
    firstName: text('firstName', 100),
    lastName: text('lastName', 100),
    email: text('email', 254).toLowerCase(),
    password: (params.get('password') || '').slice(0, 300),
    team: text('team', 120),
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The form's mistakes, by field, in plain words; empty when it can be used. */
export function formErrors(values, { passwords = true } = {}) {
  const errors = {}
  if (!values.team) errors.team = 'Give your team a name.'
  if (!passwords) return errors
  if (!values.firstName) errors.firstName = 'Enter your first name.'
  if (!EMAIL.test(values.email)) errors.email = 'Enter your email address.'
  if (values.password.length < 8) errors.password = 'Choose a password of at least 8 characters.'
  else if (values.password.length > 256) errors.password = 'Choose a password of at most 256 characters.'
  return errors
}

/** A team name to start from: the team address's name (acme.slatebox.team → Acme), else empty. */
export function suggestedTeam(rootUrl) {
  try {
    const host = new URL(rootUrl).hostname
    if (!host.endsWith('.slatebox.team')) return ''
    const label = host.slice(0, -'.slatebox.team'.length)
    return label.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
  } catch {
    return ''
  }
}

export function setupCookie(token, { secure, clear = false }) {
  return `${SETUP_COOKIE}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SETUP_COOKIE_SECONDS}${secure ? '; Secure' : ''}`
}

export function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return undefined
}

// ------------------------------------------------------------------ pages

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** Headers for every setup page: never cached, never framed, no referrer (the path holds the link). */
export function pageHeaders(nonce) {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; ${nonce ? `script-src 'nonce-${nonce}'; ` : ''}form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  }
}

function page(title, body, { script = '', nonce = '' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)}</title>
<style>
  html { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 system-ui, sans-serif; }
  main { width: min(28rem, 100% - 2rem); padding: 2rem 0; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p { margin: 0 0 1rem; opacity: .8; }
  code { font: .9em ui-monospace, monospace; padding: .1em .3em; border-radius: 4px; background: color-mix(in srgb, currentColor 10%, transparent); }
  form { display: grid; gap: .75rem; margin-top: 1.5rem; }
  label { display: grid; gap: .25rem; font-weight: 600; font-size: .9rem; }
  input { font: inherit; padding: .55rem .7rem; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 8px; background: transparent; color: inherit; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
  .error { color: #c62828; font-weight: 400; font-size: .85rem; }
  button, .button { font: inherit; font-weight: 600; padding: .65rem 1rem; border: 0; border-radius: 8px; background: #1f6feb; color: #fff; cursor: pointer; text-align: center; text-decoration: none; }
  .secondary { background: transparent; color: inherit; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); }
  .or { text-align: center; opacity: .6; margin: .5rem 0 0; }
</style>
</head>
<body>
<main>
${body}
</main>${script ? `\n<script nonce="${nonce}">${script}</script>` : ''}
</body>
</html>
`
}

export function notSetUpPage() {
  return page('This Slatebox isn\'t set up yet', `  <h1>This Slatebox isn't set up yet</h1>
  <p>Use the setup link from your install to create the first account. Nobody can sign up before that.</p>
  <p>Lost the link? Whoever installed Slatebox can print a new one on the server: <code>slatebox setup-link</code>
  (or <code>docker exec slatebox slatebox setup-link</code>).</p>`)
}

const field = (name, label, values, errors, { type = 'text', autocomplete = '', required = true } = {}) => `<label>${escape(label)}
      <input name="${name}" type="${type}"${type === 'password' ? '' : ` value="${escape(values[name])}"`}${autocomplete ? ` autocomplete="${autocomplete}"` : ''}${required ? ' required' : ''}${type === 'password' ? ' minlength="8"' : ''}>${errors[name] ? `\n      <span class="error">${escape(errors[name])}</span>` : ''}
    </label>`

/**
 * The setup form. With single sign-on on, it also offers "Continue with single sign-on"; with
 * single sign-on only, that is the only way (no password).
 */
export function setupFormPage({ token, values = {}, errors = {}, sso = null, problem = '' }) {
  const v = { firstName: '', lastName: '', email: '', team: '', ...values }
  const action = `/setup/${encodeURIComponent(token)}`
  const teamField = field('team', 'Team name', v, errors, { autocomplete: 'organization' })
  const passwordForm = sso?.only ? '' : `
  <form method="post" action="${action}">
    <div class="row">
      ${field('firstName', 'First name', v, errors, { autocomplete: 'given-name' })}
      ${field('lastName', 'Last name', v, errors, { autocomplete: 'family-name', required: false })}
    </div>
    ${field('email', 'Email', v, errors, { type: 'email', autocomplete: 'email' })}
    ${field('password', 'Password', v, errors, { type: 'password', autocomplete: 'new-password' })}
    ${teamField}
    <button type="submit">Create the admin account</button>
  </form>`
  const ssoForm = sso ? `${sso.only ? '' : '\n  <p class="or">or</p>'}
  <form method="post" action="${action}/sso">
    ${sso.only ? teamField : `<input type="hidden" name="team" value="${escape(v.team)}">`}
    <button type="submit" class="${sso.only ? '' : 'button secondary'}">Continue with single sign-on</button>
  </form>` : ''
  return page('Set up Slatebox', `  <h1>Set up Slatebox</h1>
  <p>Create the first account. It becomes this server's administrator and the owner of its first team.
  This link works once.</p>${problem ? `\n  <p class="error">${escape(problem)}</p>` : ''}${sso?.only ? '\n  <p>This Slatebox uses single sign-on: the account you sign in with becomes the administrator.</p>' : ''}${passwordForm}${ssoForm}`)
}

const LINK_PROBLEMS = {
  expired: ['This setup link has expired', 'Setup links work for 24 hours.'],
  invalid: ['This setup link doesn\'t work', 'It was already used, a newer link replaced it, or it was copied incompletely.'],
}

export function linkProblemPage(state) {
  if (state === 'set-up') {
    return page('Slatebox is set up', `  <h1>This Slatebox is already set up</h1>
  <p>Its administrator invites people from the Team page.</p>
  <p><a class="button" href="/login">Sign in</a></p>`)
  }
  const [title, why] = LINK_PROBLEMS[state] || LINK_PROBLEMS.invalid
  return page(title, `  <h1>${escape(title)}</h1>
  <p>${escape(why)} Whoever installed Slatebox can print a new one on the server: <code>slatebox setup-link</code>
  (or <code>docker exec slatebox slatebox setup-link</code>).</p>`)
}

/** After the account is made: sign the browser in (Meteor's own saved-session keys) and open Slatebox. */
export function signedInPage({ userId, token, expires, nonce }) {
  const data = JSON.stringify({ userId, token, expires: new Date(expires).toISOString() }).replace(/</g, '\\u003c')
  const script = `(function(){var d=${data};try{localStorage.setItem('Meteor.loginToken',d.token);localStorage.setItem('Meteor.loginTokenExpires',d.expires);localStorage.setItem('Meteor.userId',d.userId);}catch(e){}location.replace('/');})();`
  return page('Slatebox is set up', `  <h1>Slatebox is set up</h1>
  <p>You are this server's administrator. Opening Slatebox…</p>
  <noscript><p><a class="button" href="/login">Sign in</a></p></noscript>`, { script, nonce })
}
