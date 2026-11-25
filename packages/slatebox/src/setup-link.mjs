// The first admin. Nobody can sign up on a new self-hosted Slatebox until its one-time setup link
// is used: the person who opens it creates the first account, the server administrator and the
// owner of the first team. The image makes the link (`slatebox setup-link` in the container: single
// use, 24 hours, only its hash kept, a new one replaces the old).
//
// The link is as good as an admin password, so the installer prints it only to a terminal, on
// stderr, never into --json or a pipe (`slatebox setup-link --force-stdout` is the one way to pipe
// it), and its token is added to the redactor the moment it is known.

const lastJson = text => {
  try { return JSON.parse(String(text || '').trim().split('\n').pop()) } catch { return null }
}

/** Whether this run may print a setup link: a person at a terminal, not --json. */
export const showsSetupLink = ctx => Boolean(ctx.tty) && !ctx.json

/**
 * The image's setup state through exec(args) (docker exec or kubectl exec of the in-image
 * `slatebox`): { setUp, linkExpiresAt }, or null when the image has no setup links (before 0.2.0).
 */
export async function setupState(exec) {
  const result = await exec(['setup-link', '--check'])
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
  const state = await setupState(exec)
  if (!state) return false
  if (state.setUp) return true
  if (!showsSetupLink(ctx)) {
    ctx.setupLink = { pending: true }
    return true
  }
  const link = await makeSetupLink(ctx, exec)
  if (link.url) ctx.setupLink = link
  else if (!link.setUp) {
    ctx.out.step('setup', 'warn', `The one-time setup link could not be made (${link.error}). Run slatebox setup-link to try again.`)
    ctx.setupLink = { pending: true }
  }
  return true
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
  return ['', 'Create the first account (the server administrator) with this one-time setup link.',
    'It works once and expires in 24 hours; nobody can sign up before it is used:',
    { terminal: `  ${link.url}   (printed to this terminal only)` },
    `Lost it? ${command(name)} prints a new one and ends this one.`]
}
