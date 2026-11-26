// Opening a link for the person: the device sign-in page and the one-time setup link. When no
// browser can open here (an SSH session, a Linux box with no display, a container, CI, or an
// opener that is missing or fails), nobody is asked "Open it in your browser now?"; the link is
// shown plainly to open on any device, with a QR code in the wizard (and under --plain only with
// --qr).
import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const set = (env, name) => env?.[name] !== undefined && env[name] !== ''

/** Why no browser can open here, in words that finish "No browser here (...)". */
export const NO_BROWSER_WHY = {
  ssh: 'this is an SSH session',
  display: 'there is no display: DISPLAY and WAYLAND_DISPLAY are not set',
  container: 'this looks like a container',
  ci: 'this is a CI run',
}

/** A container: Docker's /.dockerenv, Podman's /run/.containerenv, or the container variable. */
export function inContainer(env = {}, exists = existsSync) {
  if (set(env, 'container')) return true
  try { return exists('/.dockerenv') || exists('/run/.containerenv') } catch { return false }
}

/**
 * Whether a browser can open on this computer: { ok: true } or { ok: false, reason, why }.
 * The first matching row wins: SSH, CI, a Linux (or BSD) desktop session with no display (WSL
 * opens the Windows browser, so it is left to the opener), then a container.
 * @param {object} env
 * @param {string} platform
 * @param {{container?: () => boolean}} [checks]
 */
export function browserHere(env = {}, platform = process.platform, { container = () => inContainer(env) } = {}) {
  const no = reason => ({ ok: false, reason, why: NO_BROWSER_WHY[reason] })
  if (set(env, 'SSH_CONNECTION') || set(env, 'SSH_TTY') || set(env, 'SSH_CLIENT')) return no('ssh')
  if (set(env, 'CI')) return no('ci')
  const desktopless = platform !== 'darwin' && platform !== 'win32'
  if (desktopless && !set(env, 'DISPLAY') && !set(env, 'WAYLAND_DISPLAY') && !set(env, 'WSL_DISTRO_NAME')) return no('display')
  if (desktopless && container()) return no('container')
  return { ok: true }
}

/** The opener for a platform: open (macOS), start (Windows) or xdg-open (everything else). */
export function opener(url, platform = process.platform) {
  if (platform === 'darwin') return ['open', [url]]
  if (platform === 'win32') return ['cmd', ['/c', 'start', '""', url]]
  return ['xdg-open', [url]]
}

/**
 * Open a URL in the person's browser. Resolves { ok: true } once the opener exits 0 (or is still
 * running after `wait` ms, as some openers keep running), else { ok: false, why } when it is
 * missing, exits non-zero, or errors. Never throws.
 */
export function openBrowser(url, platform = process.platform, { spawn = nodeSpawn, wait = 2000 } = {}) {
  const [cmd, args] = opener(url, platform)
  return new Promise(resolve => {
    let settled = false
    const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result) } }
    const timer = setTimeout(() => finish({ ok: true }), wait)
    timer.unref?.()
    let child
    try {
      child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    } catch (error) {
      finish({ ok: false, why: error.code === 'ENOENT' ? `${cmd} is not installed` : `${cmd} failed: ${error.message}` })
      return
    }
    child.on('error', error => finish({ ok: false, why: error.code === 'ENOENT' ? `${cmd} is not installed` : `${cmd} failed: ${error.message}` }))
    child.on('exit', (code, signal) => finish(code === 0 ? { ok: true } : { ok: false, why: signal ? `${cmd} was stopped (${signal})` : `${cmd} exited with ${code}` }))
    child.unref?.()
  })
}

/**
 * Whatever the opener in use (ctx.openBrowser, a test's, or the real one) said, as { ok, why }.
 * A test opener that returns nothing opened the page; one that throws or returns false did not.
 */
async function tryOpen(ctx, url) {
  try {
    const said = await (ctx.openBrowser || openBrowser)(url, ctx.platform)
    if (said === false) return { ok: false, why: 'the browser did not open' }
    if (said && typeof said === 'object' && said.ok === false) return { ok: false, why: said.why || 'the browser did not open' }
    return { ok: true }
  } catch (error) {
    return { ok: false, why: error?.message || 'the browser did not open' }
  }
}

/** ctx's view of browserHere (ctx.inContainer is a test's container check). */
export const browserFor = ctx => browserHere(ctx.env, ctx.platform, ctx.inContainer ? { container: ctx.inContainer } : undefined)

/** The sentence before the link, when it has to be opened elsewhere. */
export function elsewhereSentence({ why, failed }) {
  return failed ? `Couldn't open a browser here (${why}). Open this on any device:` : `No browser here (${why}). Open this on any device:`
}

/**
 * Offer to open url, or show it to open elsewhere. Returns 'opened', 'declined', 'shown' (no
 * browser here) or 'failed' (the opener failed; the link was shown).
 *   secret: the URL is a setup link (written past the redactor, to the terminal only).
 *   ask: false opens without a question (--yes, as Enter at the question would).
 * The fallback has a QR code in the wizard, and in plain output only with --qr.
 */
export async function offerToOpen(ctx, url, { question = 'Open it in your browser now?', label = 'Browser', secret = false, ask = !ctx.yes } = {}) {
  const show = (why, failed) => showElsewhere(ctx, url, { why, failed, secret })
  const here = browserFor(ctx)
  if (!here.ok) { await show(here.why, false); return 'shown' }
  if (ask) {
    const yes = await ctx.prompt.confirm(question, ctx.rich ? { default: true, label } : { default: true })
    if (!yes) return 'declined'
  } else if (!ctx.rich) ctx.stderr.write('  Opening it in your browser.\n')
  const opened = await tryOpen(ctx, url)
  if (opened.ok) return 'opened'
  await show(opened.why, true)
  return 'failed'
}

/** The link to open on any device: the sentence, the link, and (wizard, or --qr) a QR code. */
export async function showElsewhere(ctx, url, { why, failed = false, secret = false }) {
  if (ctx.rich) return ctx.prompt.elsewhere({ sentence: elsewhereSentence({ why, failed }), url, secret })
  const write = text => (secret ? ctx.stderr.write(`${text}\n`) : ctx.stderr.write(`${ctx.redactor.redact(text)}\n`))
  write(`  ${elsewhereSentence({ why, failed })}`)
  write(`    ${url}`)
  if (ctx.flags?.qr) for (const row of await plainQr(ctx, url)) ctx.stderr.write(`    ${row}\n`)
}

/** A QR code for plain output: --qr asked for it; Unicode unless the locale says otherwise. */
export async function plainQr(ctx, url) {
  const locale = ctx.env?.LC_ALL || ctx.env?.LC_CTYPE || ctx.env?.LANG || ''
  const unicode = /UTF-?8/i.test(locale) || ctx.platform === 'darwin' || Boolean(ctx.env?.TERM_PROGRAM || ctx.env?.WT_SESSION)
  const { qrLines } = await import('./ui/qr.mjs')
  return qrLines(url, { unicode, color: false })
}
