// The first admin, right after the install, without leaving the terminal. A new self-hosted
// Slatebox lets nobody sign up until its one-time setup link is used (setup-link.mjs); here the
// person can use that same link from the installer: name, email, team and password are asked in
// the terminal and sent to the setup form's own endpoint (POST /setup/<token>, the one the link
// opens in a browser: web/app/server/self-host-setup/meteor.js). Nothing new on the server: the
// token is single use, checked and claimed by the server exactly as when the form is sent from a
// browser, and gone once the admin exists (so the printed link stops working).
//
// It goes to this computer's own port when Slatebox runs here (http://localhost:<port>), else to
// the link's own address (the team address or the domain). The browser sign-in the setup page
// answers with is dropped: the person signs in themselves.
//
// Or the person keeps the link: it is shown with a QR code (and opened in a browser when one can
// open here), and the installer waits up to 10 minutes for the admin to be created, polling the
// server's setup state, until Enter ends the wait.
import { browserFor, offerToOpen } from './browser.mjs'
import { EXIT, InstallError } from './errors.mjs'
import { setupState } from './setup-link.mjs'

export const WAIT_MS = 10 * 60_000
export const POLL_MS = 3000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// The commonest passwords that pass a length check; refused with the rest of the strength check.
const COMMON = new Set(['password', 'password1', 'password12', 'password123', '12345678', '123456789', '1234567890', '87654321',
  'qwertyui', 'qwerty123', 'qwertyuiop', '11111111', '00000000', 'iloveyou', 'abc12345', 'abcd1234', 'letmein1', 'welcome1',
  'admin123', 'administrator', 'changeme', 'slatebox', 'slatebox1', 'slatebox123', 'passw0rd', 'sunshine', 'football', 'baseball'])

/** What is wrong with a password, in plain words, or null when it is good enough. */
export function passwordProblem(password, { email = '', name = '' } = {}) {
  const pw = String(password ?? '')
  if (pw.length < 8) return 'Use at least 8 characters.'
  if (pw.length > 256) return 'Use at most 256 characters.'
  const lower = pw.toLowerCase()
  if (COMMON.has(lower)) return 'That password is too common. Choose another.'
  if (/^(.)\1+$/.test(pw)) return 'That is one character repeated. Choose another.'
  const local = String(email).toLowerCase().split('@')[0]
  if ((local.length >= 4 && lower.includes(local)) || (name && lower === String(name).toLowerCase().replace(/\s+/g, ''))) return 'Don\'t use your name or email in the password.'
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(kind => kind.test(pw)).length
  if (pw.length < 12 && kinds < 2) return 'Mix in a number, a capital or a symbol, or use 12 or more characters.'
  return null
}

export const emailProblem = email => (EMAIL.test(String(email)) && String(email).length <= 254 ? null : 'Enter an email address, like you@example.com.')

/** "Ada Lovelace" → { firstName: 'Ada', lastName: 'Lovelace' }. */
export function splitName(name) {
  const [firstName = '', ...rest] = String(name).trim().split(/\s+/)
  return { firstName, lastName: rest.join(' ') }
}

/** A team name to start from: the team address's name (acme-labs → Acme Labs), else "Our team". */
export function suggestedTeam(done) {
  try {
    const host = new URL(done.teamAddress || done.address).hostname
    if (host.endsWith('.slatebox.team')) return host.slice(0, -'.slatebox.team'.length).split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
  } catch { /* no address */ }
  return 'Our team'
}

/** Where the setup form is sent: this computer's own port when Slatebox runs here, then the link's address. */
export function setupOrigins(ctx, done, link) {
  const list = []
  const add = url => {
    try { const origin = new URL(url).origin; if (!list.includes(origin)) list.push(origin) } catch { /* not a URL */ }
  }
  if (done.target === 'local') {
    if (done.localAddress) add(done.localAddress)
    const port = ctx.answers?.address?.port
    if (port) add(`http://localhost:${port}`)
    if (/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(done.address || '')) add(done.address)
  }
  add(link.url)
  return list
}

export const linkToken = link => String(link.url).split('/setup/')[1]?.split(/[?#]/)[0] || ''

const unescape = text => String(text).replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
/** The setup page's mistakes, by the order shown: field errors and the page's own problem line. */
export const pageProblems = html => [...String(html).matchAll(/<(?:span|p) class="error">([^<]*)<\/(?:span|p)>/g)].map(match => unescape(match[1]).trim()).filter(Boolean)

async function send(ctx, url, init) {
  const response = await (ctx.fetch || globalThis.fetch)(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...init })
  const text = typeof response.text === 'function' ? await response.text().catch(() => '') : ''
  return { status: response.status, text }
}

const reachWhy = error => error?.cause?.code || error?.code || error?.name || error?.message || 'no answer'

/**
 * Send the setup form (the setup link's own endpoint). Returns { ok: true, origin }, or { error }:
 *   'form' (problems: the server's words), 'used' (already used or replaced), 'expired',
 *   'set-up' (an admin exists already), 'sso-only', 'unreachable' (why), 'refused' (status).
 */
export async function createAdmin(ctx, { origins, token, values }) {
  const body = new URLSearchParams({ firstName: values.firstName, lastName: values.lastName || '', email: values.email, password: values.password, team: values.team }).toString()
  const unreachable = []
  for (const origin of origins) {
    let answer
    try {
      answer = await send(ctx, `${origin}/setup/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' }, body })
    } catch (error) {
      unreachable.push(`${origin} (${reachWhy(error)})`)
      continue
    }
    const { status, text } = answer
    if (status === 200 && /<h1>This Slatebox is already set up<\/h1>/.test(text)) return { error: 'set-up', origin }
    if (status === 200 && /<h1>Slatebox is set up<\/h1>/.test(text)) return { ok: true, origin }
    if (status === 410) return { error: /has expired/.test(text) ? 'expired' : 'used', origin }
    if (status === 400 || status === 413) {
      const problems = pageProblems(text)
      if (problems.some(problem => /single sign-on only/.test(problem))) return { error: 'sso-only', origin }
      return { error: 'form', problems: problems.length ? problems : ['The account could not be created. Try again.'], origin }
    }
    return { error: 'refused', status, origin }
  }
  return { error: 'unreachable', why: unreachable.join(', ') || 'no address to send it to' }
}

/**
 * The server's setup state: 'set-up', 'waiting', 'invalid' (the link no longer works and nobody
 * is set up), or null when it cannot be asked. The image's own check when an exec is at hand
 * (docker or kubectl exec), else the setup page, whose answer says the same.
 */
export async function setupStatus(ctx, { origins, token, exec }) {
  if (exec) {
    const state = await setupState(exec).catch(() => null)
    if (state) return state.setUp ? 'set-up' : 'waiting'
  }
  for (const origin of origins) {
    try {
      const { status, text } = await send(ctx, `${origin}/setup/${encodeURIComponent(token)}`, { method: 'GET', headers: { accept: 'text/html' } })
      if (status === 200 && /already set up/.test(text)) return 'set-up'
      if (status === 200) return 'waiting'
      if (status === 410) return 'invalid'
    } catch { /* the next address */ }
  }
  return null
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Wait until the admin exists: 'set-up', 'stopped' (stop() resolved: Enter), 'timeout', or
 * 'invalid' (the link stopped working with nobody set up: replaced by a newer one).
 */
export async function waitForAdmin(ctx, { origins, token, exec, stop, timeout = WAIT_MS, interval = ctx.adminPoll ?? POLL_MS, now = Date.now }) {
  // A real timer between checks, always (not ctx.sleep, which tests make instant): the wait has
  // to give the terminal its turn, or Enter is never read.
  const wait = sleep
  const deadline = now() + timeout
  let stopped = false
  stop?.then(() => { stopped = true })
  const pause = ms => Promise.race([wait(ms), stop || new Promise(() => {})])
  for (;;) {
    if (stopped) return 'stopped'
    const state = await setupStatus(ctx, { origins, token, exec })
    if (state === 'set-up') return 'set-up'
    if (state === 'invalid') return 'invalid'
    if (stopped) return 'stopped'
    if (now() >= deadline) return 'timeout'
    await pause(Math.min(interval, Math.max(0, deadline - now())))
  }
}

/** Whether this run continues with the first admin: a setup link was made for a person here. */
export const offersFirstAdmin = ctx => Boolean(ctx.setupLink?.url) && ctx.interactive && !ctx.yes && !ctx.json

const execFor = (ctx, done) => (done.target === 'ssh' ? null : ctx.setupExec || null)

/**
 * Name, email, team and password, then the setup form. Returns 'created', 'set-up' (someone else
 * made the admin), 'dead' (the link no longer works), or 'unreachable' (use the link instead).
 */
async function createHere(ctx, done, link, { say, warn, ok, during }) {
  const p = ctx.prompt
  const rich = Boolean(ctx.rich)
  const token = linkToken(link)
  const origins = setupOrigins(ctx, done, link)
  const values = { name: '', email: ctx.answers?.adminEmail || '', team: suggestedTeam(done) }
  for (;;) {
    values.name = await p.text('Your name', { default: values.name, label: 'Name', validate: value => (value.length > 100 ? 'Use at most 100 characters.' : null) })
    values.email = (await p.text('Email', { default: values.email, label: 'Email', validate: emailProblem, normalize: value => value.toLowerCase() })).toLowerCase()
    values.team = await p.text('Team name', { default: values.team, label: 'Team', validate: value => (value.length > 120 ? 'Use at most 120 characters.' : null) })
    let password
    for (;;) {
      password = await p.secret(rich ? 'Password' : 'Password (at least 8 characters, typing is hidden)', { label: 'Password' })
      const problem = passwordProblem(password, { email: values.email, name: values.name })
      if (problem) { warn(problem); continue }
      const again = await p.secret('Password again', { label: 'Again' })
      if (again !== password) { warn('The two passwords don\'t match. Type them again.'); continue }
      break
    }
    const { firstName, lastName } = splitName(values.name)
    const result = await during('Creating the admin account', () => createAdmin(ctx, { origins, token, values: { firstName, lastName, email: values.email, password, team: values.team } }))
    password = null
    if (result.ok) {
      ok(`Admin ${values.email} created. Sign in at ${done.address}`)
      say('The one-time setup link no longer works; nobody else can use it.')
      ctx.setupLink = { created: values.email }
      return 'created'
    }
    if (result.error === 'form') { for (const problem of result.problems) warn(problem); continue }
    if (result.error === 'set-up') {
      ok(`This Slatebox already has its admin. Sign in at ${done.address}`)
      ctx.setupLink = { created: true }
      return 'set-up'
    }
    if (result.error === 'used' || result.error === 'expired') {
      warn(result.error === 'expired' ? 'This setup link has expired.' : 'This setup link was already used, or a newer one replaced it.')
      say(`Get a new one with ${done.name === 'slatebox' ? 'slatebox setup-link' : `slatebox setup-link --name ${done.name}`}.`)
      ctx.setupLink = { pending: true }
      return 'dead'
    }
    if (result.error === 'sso-only') { warn('This Slatebox uses single sign-on only: create the admin with the setup link instead.'); return 'unreachable' }
    warn(result.error === 'unreachable' ? `Couldn't reach Slatebox at ${result.why}. Use the setup link instead.` : `Slatebox answered ${result.status}. Use the setup link instead.`)
    return 'unreachable'
  }
}

/**
 * The wizard, after "Slatebox is running": create the admin here (recommended), or keep the link
 * (shown with a QR code) and wait for it to be used. Returns what happened.
 */
export async function richFirstAdmin(ctx, done) {
  const p = ctx.prompt
  const link = ctx.setupLink
  const ssoOnly = Boolean(ctx.answers?.sso?.enabled && ctx.answers?.sso?.only)
  const choice = ssoOnly ? 'link' : await p.choose('The first admin: the server administrator and owner of the first team', [
    { value: 'create', label: 'Create the admin account now', hint: 'here in the terminal', recommended: true },
    { value: 'link', label: 'I\'ll use the setup link', hint: 'in a browser, on this or any device' },
  ], { default: 'create', label: 'First admin' })
  const hooks = {
    say: text => p.note('info', text),
    warn: text => p.note('warn', text),
    ok: text => p.note('ok', text),
    during: (label, fn) => p.during(label, fn),
  }
  if (choice === 'create') {
    const result = await createHere(ctx, done, link, hooks)
    if (result !== 'unreachable') return result
  }
  return useLink(ctx, done, link)
}

/** The setup link: shown (box and QR), offered to a browser here, then waited on. */
async function useLink(ctx, done, link) {
  const p = ctx.prompt
  const here = browserFor(ctx)
  if (!here.ok) p.note('info', `No browser here (${here.why}). Open this on any device:`)
  p.setupLinkBox(link)
  p.qr(link.url, 'Or scan it with a phone')
  if (here.ok) await offerToOpen(ctx, link.url, { secret: true, label: 'Browser' })
  const keys = p.watchKeys()
  const deadline = Date.now() + WAIT_MS
  const t = p.task('Waiting for the admin account to be created', { right: () => `Enter stops waiting ${'·'} ${clock(Math.max(0, deadline - Date.now()))}` })
  let result
  try {
    result = await waitForAdmin(ctx, { origins: setupOrigins(ctx, done, link), token: linkToken(link), exec: execFor(ctx, done), stop: keys.pressed })
  } finally {
    keys.stop()
  }
  if (result === 'set-up') {
    t.ok('Admin created')
    p.note('info', `Sign in at ${done.address}`)
    ctx.setupLink = { created: true }
    return 'created'
  }
  if (result === 'invalid') {
    t.warn('The setup link stopped working (a newer one replaced it)')
    return 'dead'
  }
  t.info(result === 'timeout' ? 'Stopped waiting after 10 minutes. The setup link works for 24 hours.' : 'Stopped waiting. The setup link works for 24 hours.')
  return 'waiting'
}

const clock = ms => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Plain prompts, after the closing lines: one optional question, only for a person at a
 * terminal; Enter creates the admin here. No answer (the input ended) leaves the link as printed.
 */
export async function plainFirstAdmin(ctx, done) {
  if (ctx.answers?.sso?.enabled && ctx.answers?.sso?.only) return 'waiting'
  let yes
  try {
    yes = await ctx.prompt.confirm('Create the admin account here in the terminal now?', { default: true })
  } catch (error) {
    if (error instanceof InstallError && error.exitCode === EXIT.CANCELLED) { ctx.stderr.write('\n'); return 'waiting' }
    throw error
  }
  if (!yes) return 'waiting'
  const result = await createHere(ctx, done, ctx.setupLink, {
    say: text => ctx.out.say(text),
    warn: text => ctx.stderr.write(`  ${text}\n`),
    ok: text => ctx.out.say(`✓ ${text}`),
    during: (label, fn) => { ctx.stderr.write(`… ${label}\n`); return fn() },
  })
  if (result === 'unreachable') ctx.out.say('The setup link printed above still works.')
  return result
}
