// The first admin. Nobody can sign up on a new self-hosted Slatebox until its one-time setup link
// is used: the person who opens it creates the first account, the server administrator and the
// owner of the first team. The image makes the link (`slatebox setup-link` in the container: single
// use, 24 hours, only its hash kept, a new one replaces the old).
//
// The link is as good as an admin password, so the installer prints it only to a terminal, on
// stderr, never into --json or a pipe (`slatebox setup-link --force-stdout` is the one way to pipe
// it), and its token is added to the redactor the moment it is known.
import { browserFor, elsewhereSentence, isLoopback, plainQr, tunnelHint } from './browser.mjs'

const lastJson = text => {
  try { return JSON.parse(String(text || '').trim().split('\n').pop()) } catch { return null }
}

/** Whether this run may print a setup link: a person at a terminal, not --json. */
export const showsSetupLink = ctx => Boolean(ctx.tty) && !ctx.json

/**
 * The image's setup state through exec(args) (docker exec or kubectl exec of the in-image
 * `slatebox`): { setUp, linkExpiresAt }, or null when the image has no setup links (before 0.2.0).
 * options go to the runner (a { timeout } for the first-admin wait's checks).
 */
export async function setupState(exec, options) {
  const result = await exec(['setup-link', '--check'], options)
  if (result.code !== 0) return null
  const state = lastJson(result.stdout)
  return state && typeof state.setUp === 'boolean' ? state : null
}

/** A fresh link ({ url, expiresAt }), { setUp: true } when there is nothing to set up, or { error }. */
export async function makeSetupLink(ctx, exec) {
  const result = await exec(['setup-link', '--json'])
  if (result.code === 3) return { setUp: true }
  const link = result.code === 0 ? lastJson(result.stdout) : null
  if (!link?.url) return { error: String(result.stderr || '').trim().split('\n').pop() || `exit ${result.code}` }
  const token = link.url.split('/setup/')[1]
  ctx.redactor.add(token)
  return link
}

/**
 * After an install or change is healthy: when the server still waits for its first admin, make a
 * link if this run may print it (ctx.setupLink = { url, expiresAt }), else note that one is
 * needed (ctx.setupLink = { pending: true }). Images without setup links are left alone.
 */
export async function firstAdmin(ctx, exec) {
  // Kept for the installer's first-admin step (admin-setup.mjs): it asks the image whether the
  // admin exists yet while the person uses the link.
  ctx.setupExec = exec
  const state = await setupState(exec)
  if (!state) return false
  if (state.setUp) return true
  if (!showsSetupLink(ctx)) {
    ctx.setupLink = { pending: true }
    return true
  }
  const link = await makeSetupLink(ctx, exec)
  // Plain output with --qr and no browser here: the closing lines carry a QR code for the link
  // (made now, since the closing lines are written synchronously). Never for a localhost link.
  if (link.url && !ctx.rich && ctx.flags?.qr && !browserFor(ctx).ok && !isLoopback(link.url)) link.qr = await plainQr(ctx, link.url)
  if (link.url) ctx.setupLink = link
  else if (!link.setUp) {
    ctx.out.step('setup', 'warn', `The one-time setup link could not be made (${link.error}). Run slatebox setup-link to try again.`)
    ctx.setupLink = { pending: true }
  }
  return true
}

/**
 * A run that changed nothing (a re-run, an upgrade with no newer image) on a server still waiting
 * for its first admin: say how to get a link, but make none, since a new link would silently end
 * the one the person may already hold (the same rule as `slatebox status`).
 */
export async function stillWaiting(ctx, exec) {
  const state = await setupState(exec)
  if (state && !state.setUp) ctx.setupLink = { pending: true }
}

const command = name => `slatebox setup-link${name === 'slatebox' ? '' : ` --name ${name}`}`

/**
 * The closing lines about the first admin. A line { terminal: text } carries the link itself and is
 * written straight to the terminal (stderr), past the redactor that would hide it.
 */
export function setupLines(ctx, name) {
  const link = ctx.setupLink
  if (!link) return []
  if (link.pending) {
    return ['', 'Nobody can sign up until the first admin exists. Get the one-time setup link at a terminal:',
      `  ${command(name)}`, 'Open it to create the first account: the server administrator and the owner of the first team.']
  }
  // Plain output with no browser here says so before the link, as the wizard does: a link to
  // open on any device (with --qr, a QR code), or, for a localhost link, the SSH tunnel to use.
  const here = ctx.rich ? { ok: true } : browserFor(ctx)
  const elsewhere = here.ok ? [] : [{ terminal: elsewhereSentence({ why: here.why, url: link.url }) }]
  const after = here.ok ? [] : isLoopback(link.url) ? [`  ${tunnelHint(link.url, ctx.env)}`] : (link.qr || []).map(row => ({ terminal: `    ${row}` }))
  return ['', 'Create the first account (the server administrator) with this one-time setup link.',
    'It works once and expires in 24 hours; nobody can sign up before it is used:',
    ...elsewhere,
    { terminal: `  ${link.url}   (printed to this terminal only)` },
    ...after,
    `Lost it? ${command(name)} prints a new one and ends this one.`]
}
