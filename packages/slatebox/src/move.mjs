// Moving a team between your own Slatebox and Slatebox Cloud, in either direction:
//
//   slatebox migrate --to cloud           your own server's team → Slatebox Cloud
//   slatebox import --from cloud          your Slatebox Cloud team → your own server
//   slatebox export [--out <file>]        a team export to a file (from either)
//   slatebox import <file> [--to cloud]   a team export file into a server
//
// Each move is: "Export everything" on the source (team.export, a team admin), the archive
// downloaded encrypted with a passphrase made here, then a move on the target (teamMove.start,
// the owner of their team there or someone in no team yet), the report shown, and the move
// confirmed (teamMove.confirm). Nothing is visible on the target until it is confirmed, and the
// other people are emailed only when the person says so.
//
// Credentials, never written anywhere and never printed:
//   - Slatebox Cloud: SLATEBOX_CLOUD_TOKEN (a personal access token with "Move a team here" and
//     "Export everything my team owns"), or else the browser sign-in with a code (device flow).
//   - Your own server: SLATEBOX_API_TOKEN (the same token `slatebox exec` uses), or asked for
//     with hidden input at a terminal. Its address: --from/--to, SLATEBOX_BASE_URL, or the install
//     this computer made (--name).
// The archive is kept in ~/.slatebox/moves/ (0600 in a 0700 folder), its passphrase beside it in
// a .key file (0600). Once the move is live the person is asked whether to delete it (default no,
// and the command that deletes it is printed); --delete-archive deletes it without asking.
//
// The other people: once the move is live the person is asked once, "Send invitations to the N
// other members now?" (yes by default at a terminal); --invite / --no-invite answer it ahead, and
// a script (no terminal, or --yes) invites nobody unless --invite. Later: slatebox migrate invite
// <move id> --to cloud|<url>. Nobody gets an account without that email, and someone who already
// has an account on the target accepts an invitation to join there.
import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { CloudError, cloudBase, cloudClient, signIn } from './cloud.mjs'
import { EXIT, InstallError } from './errors.mjs'
import { readRecord } from './record.mjs'
import { resolveRef } from './secrets.mjs'

export const MOVE_SCOPE = 'team:export team:move'
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

// ------------------------------------------------------------------ servers

/** An origin to send a token to: https, or plain http on this computer only. */
export function serverOrigin(raw, what = 'The server address') {
  let url
  try { url = new URL(raw) } catch { throw new InstallError(EXIT.USAGE, `${what} is not a URL: ${raw}`) }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname)))
    throw new InstallError(EXIT.USAGE, `${what} must be https:// (plain http:// only for localhost): ${url.origin}`)
  if (url.username || url.password) throw new InstallError(EXIT.USAGE, `${what} must not carry a user name or password.`)
  return url.origin
}

/**
 * Where "cloud" or your own server is. spec: 'cloud', a URL, or undefined (your own server:
 * SLATEBOX_BASE_URL, else the install this computer made).
 */
export function resolveServer(ctx, spec) {
  if (spec === 'cloud') return { kind: 'cloud', base: cloudBase(ctx), label: 'Slatebox Cloud' }
  if (spec) return { kind: 'own', base: serverOrigin(spec), label: new URL(spec).host }
  if (ctx.env.SLATEBOX_BASE_URL) return { kind: 'own', base: serverOrigin(ctx.env.SLATEBOX_BASE_URL, 'SLATEBOX_BASE_URL'), label: new URL(ctx.env.SLATEBOX_BASE_URL).host }
  const name = ctx.flags.name || 'slatebox'
  const record = readRecord(ctx.home, name)
  const url = record?.address?.url
  if (!url) throw new InstallError(EXIT.USAGE, `Which server? Give its address (--from https://boards.example.com, or --to), set SLATEBOX_BASE_URL, or install one here first (no install named "${name}" on this computer).`)
  return { kind: 'own', base: serverOrigin(url), label: new URL(url).host, install: name }
}

async function tokenFor(ctx, server, purpose) {
  if (server.token) return server.token
  if (server.kind === 'cloud') {
    const given = ctx.env.SLATEBOX_CLOUD_TOKEN
    if (given) server.token = given
    else {
      try {
        server.token = await signIn(ctx, cloudClient(ctx, server.base), { purpose, scope: MOVE_SCOPE })
      } catch (error) {
        if (error instanceof InstallError && /invalid_scope|unauthorized_client|not found|http_404/i.test(error.message))
          throw new InstallError(EXIT.PRECONDITION, `${server.label} can't sign this computer in for a move yet. On ${server.base}, open Profile → Developer, make an access token with "Move a team here" and "Export everything my team owns", and run this again with SLATEBOX_CLOUD_TOKEN set to it (it is never written anywhere).`)
        throw error
      }
    }
  } else {
    const given = ctx.env.SLATEBOX_API_TOKEN
    if (given) server.token = given
    else if (ctx.interactive) {
      ctx.out.say(`\nAn access token for ${server.base} is needed: in Slatebox there, open Profile → Developer and make one with "Export everything my team owns" and "Move a team here". It is used for this command only and never written anywhere.`)
      server.token = await ctx.prompt.secret(`Access token for ${server.label}`)
    }
    if (!server.token)
      throw new InstallError(EXIT.NEEDS_INPUT, `An access token for ${server.base} is needed. Make one in Profile → Developer there ("Export everything my team owns", "Move a team here") and set SLATEBOX_API_TOKEN.`, { missing: [{ field: 'SLATEBOX_API_TOKEN', question: `An access token for ${server.base}` }] })
  }
  ctx.redactor.add(server.token)
  return server.token
}

// ------------------------------------------------------------------ the API

/** The /api/v1 actions a move uses, on one server. */
export function moveApi(ctx, server) {
  const fetchImpl = ctx.fetch || globalThis.fetch
  const headers = (extra = {}) => ({ accept: 'application/json', 'user-agent': `slatebox-cli/${ctx.version || '0'}`, authorization: `Bearer ${server.token}`, ...extra })
  const failed = (error) => {
    const why = error?.cause?.code || error?.code || error?.name || error?.message || 'no answer'
    return new InstallError(EXIT.PRECONDITION, `${server.label} (${server.base}) can't be reached: ${why}. Nothing was changed there.`)
  }
  async function readJson(response) {
    const text = await response.text().catch(() => '')
    try { return text ? JSON.parse(text) : {} } catch { return {} }
  }
  function refusal(response, data) {
    const error = data?.error && typeof data.error === 'object' ? data.error : {}
    const code = error.code || `http_${response.status}`
    const hint = {
      insufficient_scope: ' The access token needs the "Move a team here" and "Export everything my team owns" permissions.',
      unauthorized: ' The access token is not valid there.',
      team_owner_required: ' Only the owner of your team there can move a team into it. Sign in as the owner, or as someone in no team yet.',
      team_admin_required: ' Only a team admin can export the team.',
      move_pending: ' Run again with --replace-waiting to discard that move and start over.',
      move_limit: ' Moves into a server are limited per person per day.',
      // An older server than the archive: it says so in its own words, or (servers before this
      // message) only that it does not know a section or version.
      section_unknown: ` ${server.label} runs an older Slatebox than the archive needs: update that server to the latest Slatebox, then run this again.`,
      version_unknown: ` ${server.label} runs an older Slatebox than the archive needs: update that server to the latest Slatebox, then run this again.`,
    }[code] || ''
    return new InstallError(EXIT.PRECONDITION, `${server.label} refused: ${error.message || `HTTP ${response.status}`} (${code}).${hint}`, { code, status: response.status })
  }
  async function call(method, path, body) {
    const key = method === 'GET' ? null : randomUUID()
    let confirm
    for (let attempt = 0; attempt < 2; attempt++) {
      let response
      try {
        response = await fetchImpl(`${server.base}/api/v1${path}`, {
          method,
          headers: headers({ ...(body !== undefined && { 'content-type': 'application/json' }), ...(key && { 'idempotency-key': key }), ...(confirm && { 'slatebox-confirm': confirm }) }),
          ...(body !== undefined && { body: JSON.stringify(body) }),
          redirect: 'error',
          signal: AbortSignal.timeout(120_000),
        })
      } catch (error) {
        throw failed(error)
      }
      const data = await readJson(response)
      if (response.ok) return data
      // A call held for the person's yes (an agent's token): ask, then send it again once.
      if (response.status === 409 && data?.error?.code === 'confirmation_required' && !confirm) {
        const reasons = (data.error.details?.reasons || []).map((reason) => reason.rule || reason).join(', ')
        if (!ctx.yes && !(ctx.interactive && (await ctx.prompt.confirm(`${server.label} asks you to agree first${reasons ? ` (${reasons})` : ''}. Agree?`, { default: false }))))
          throw new InstallError(ctx.interactive ? EXIT.CANCELLED : EXIT.NEEDS_INPUT, `${server.label} needs you to agree to this step; nothing more was changed.`)
        confirm = data.error.details?.confirmationId
        continue
      }
      throw refusal(response, data)
    }
    throw new InstallError(EXIT.PRECONDITION, `${server.label} did not take the confirmation.`)
  }
  // A one-time address the server handed out, always on the server's own origin: the path is
  // what counts (the server may know itself by another address than this computer does).
  const here = (address) => new URL(new URL(address).pathname, server.base).href

  return {
    exportTeam: () => call('POST', '/team/export', {}),
    startMove: () => call('POST', '/team/moves', {}),
    getMove: (id) => call('GET', `/team/moves/${encodeURIComponent(id)}`),
    listMoves: () => call('GET', '/team/moves'),
    discardMove: (id) => call('POST', `/team/moves/${encodeURIComponent(id)}/discard`, {}),
    confirmMove: (id, invite) => call('POST', `/team/moves/${encodeURIComponent(id)}/confirm`, { invite }),
    inviteMoved: (id, email) => call('POST', `/team/moves/${encodeURIComponent(id)}/invite`, email ? { email } : {}),
    async download(address, passphrase, path) {
      let response
      try {
        response = await fetchImpl(here(address), { method: 'POST', headers: { 'user-agent': `slatebox-cli/${ctx.version || '0'}`, ...(passphrase && { 'slatebox-export-passphrase': passphrase }) }, redirect: 'error' })
      } catch (error) {
        throw failed(error)
      }
      if (!response.ok) throw refusal(response, await readJson(response))
      await pipeline(Readable.fromWeb(response.body), createWriteStream(path, { mode: 0o600 }))
      return statSync(path).size
    },
    async upload(address, path, passphrase) {
      let response
      try {
        response = await fetchImpl(here(address), {
          method: 'POST',
          headers: { 'user-agent': `slatebox-cli/${ctx.version || '0'}`, 'content-type': 'application/octet-stream', 'content-length': String(statSync(path).size), ...(passphrase && { 'slatebox-export-passphrase-base64': Buffer.from(passphrase, 'utf8').toString('base64url') }) },
          body: Readable.toWeb(createReadStream(path)),
          duplex: 'half',
          redirect: 'error',
        })
      } catch (error) {
        throw failed(error)
      }
      const data = await readJson(response)
      if (!response.ok) throw refusal(response, data)
      return data
    },
  }
}

// ------------------------------------------------------------------ the archive on disk

export const movesDir = (home) => join(home, 'moves')

function archivePath(ctx, teamName, encrypted) {
  const dir = movesDir(ctx.home)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const slug = String(teamName || 'team').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'team'
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
  return join(dir, `${stamp}-${slug}.${encrypted ? 'sbxteam' : 'sbxteam.gz'}`)
}

const keyFile = (path) => `${path}.key`
function keepPassphrase(path, passphrase) {
  writeFileSync(keyFile(path), `${passphrase}\n`, { mode: 0o600 })
  chmodSync(keyFile(path), 0o600)
}
function forget(path) {
  rmSync(path, { force: true })
  rmSync(keyFile(path), { force: true })
}

/** A passphrase for an archive file: --passphrase env:NAME | file:/path | prompt, or <file>.key beside it. */
async function passphraseFor(ctx, file) {
  const ref = ctx.flags.passphrase
  if (ref) {
    const value = await resolveRef(ref, { env: ctx.env, ask: ctx.interactive ? () => ctx.prompt.secret('Passphrase of the archive') : undefined })
    if (!value) throw new InstallError(EXIT.NEEDS_INPUT, `The passphrase (${ref}) could not be read.`)
    ctx.redactor.add(value)
    return value
  }
  if (file && existsSync(keyFile(file))) {
    const value = readFileSync(keyFile(file), 'utf8').trim()
    ctx.redactor.add(value)
    return value
  }
  return null
}

// ------------------------------------------------------------------ steps

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function reportLines(report = {}, into) {
  const sections = report.sections || {}
  const created = (name) => sections[name]?.created || 0
  const lines = [
    `  Team:          ${report.team?.name ?? '?'}${into === 'your_team' ? ' (joins the team you own)' : ' (becomes your team)'}`,
    `  Slates:        ${created('slates')}   presentations: ${created('presentations')}   comments: ${created('comments')}   files: ${report.files?.created ?? 0}`,
    `  People:        ${plural((report.people || []).length, 'person', 'people')} (invited only if you say so)`,
  ]
  if ((report.library || []).length) lines.push(`  Library:       ${plural(report.library.length, 'item')} (sent to the review queue there; published once that server approves)`)
  const needKeys = (report.ai?.imported || []).filter((item) => item.needsKey).map((item) => item.name)
  if (needKeys.length) lines.push(`  Agent keys:    add the keys again for ${needKeys.join(', ')} (keys never move)`)
  if ((report.tokens || []).length) lines.push(`  Access tokens: make ${plural(report.tokens.length, 'token')} again (tokens never move)`)
  if (report.rulesSwitchedOff) lines.push(`  Board rules:   ${report.rulesSwitchedOff} switched off until a team admin reviews them`)
  const skipped = (report.skipped || []).length
  if (skipped) lines.push(`  Left out:      ${skipped} (see --json for each and why)`)
  return lines
}

async function agree(ctx, question, { fallback = true, flag } = {}) {
  if (ctx.yes) return true
  if (ctx.interactive) return ctx.prompt.confirm(question, { default: fallback })
  throw new InstallError(EXIT.NEEDS_INPUT, `${question} Show this to the person; once they agree, run the same command with --yes${flag ? ` (${flag})` : ''}.`, { needsConfirmation: true })
}

// A move address on the target. A move already waiting there (one at a time) is discarded
// first only with --replace-waiting, or when the person agrees at a terminal.
async function startMove(ctx, target) {
  const api = moveApi(ctx, target)
  try {
    return await api.startMove()
  } catch (error) {
    if (error.details?.code !== 'move_pending') throw error
    const waiting = ((await api.listMoves()).moves || []).find((move) => ['pending', 'running'].includes(move.state))
    if (!waiting) throw error
    const replace = ctx.flags['replace-waiting'] || (ctx.interactive && !ctx.yes && (await ctx.prompt.confirm(`A move of ${waiting.teamName ?? 'a team'} is already waiting on ${target.label}. Discard it and start again?`, { default: false })))
    if (!replace) throw error
    await api.discardMove(waiting.importId)
    ctx.out.step('discard', 'ok', `Discarded the move that was waiting on ${target.label}`)
    return api.startMove()
  }
}

// Upload an archive file to a server as a move, show the report, confirm it.
async function moveFileTo(ctx, target, path, passphrase, { started = null } = {}) {
  const api = moveApi(ctx, target)
  const ticket = started || (await startMove(ctx, target))
  const size = statSync(path).size
  ctx.out.step('upload', 'start', `Sending the archive to ${target.label} (${(size / 1024 / 1024).toFixed(1)} MB)`)
  const result = await api.upload(ticket.uploadUrl, path, passphrase)
  ctx.out.step('upload', 'ok', result.duplicate ? `${target.label} already has this archive: continuing that move` : `${target.label} has it, waiting for your confirmation (nobody else sees it)`)
  const record = result.report ? result : await api.getMove(result.importId)
  ctx.out.event({ event: 'move', status: record.state, importId: result.importId, into: ticket.into, report: record.report })
  if (!ctx.json) for (const line of reportLines(record.report, ticket.into)) ctx.out.say(line)
  if (record.state === 'confirmed') return { importId: result.importId, state: 'confirmed', duplicate: true }

  if (!(await agree(ctx, `Make it live on ${target.label} now?`))) {
    ctx.out.say(`Not confirmed. It waits on ${target.label} for 14 days (move ${result.importId}); run this command again to finish, or it is discarded then.`)
    return { importId: result.importId, state: 'pending' }
  }
  const invite = await askInvite(ctx, record.report)
  const done = await api.confirmMove(result.importId, invite)
  ctx.out.step('confirm', 'ok', `The team is live on ${target.label}${done.merged ? ', in the team you own' : ', and you are its owner'}`)
  if (!ctx.json) invitedLines(ctx, target, result.importId, invite, done.invited, otherMembers(record.report))
  return { importId: result.importId, ...done }
}

// The people besides the mover (who takes one seat) that an invitation could reach.
export const otherMembers = (report) => Math.max(0, (report?.people || []).filter((person) => person.email).length - 1)

/** Asked once: --invite / --no-invite answer ahead; a terminal asks (yes by default); a script invites nobody. */
export async function askInvite(ctx, report) {
  if (ctx.flags.invite === true) return true
  if (ctx.flags.invite === false) return false
  const others = otherMembers(report)
  if (!others || !ctx.interactive || ctx.yes) return false
  return ctx.prompt.confirm(`Send invitations to the ${plural(others, 'other member')} now?`, { default: true })
}

const targetFlag = (target) => (target.kind === 'cloud' ? 'cloud' : target.base)

function invitedLines(ctx, target, importId, asked, invited = {}, others = 0) {
  if (!asked) {
    if (others) ctx.out.say(`Nobody was invited yet. Invite the ${plural(others, 'other member')} later with: slatebox migrate invite ${importId} --to ${targetFlag(target)}`)
    return
  }
  const parts = [`Invitations sent: ${invited.sent ?? 0}`]
  if (invited.asked?.length) parts.push(`asked to join (they already have an account there and accept signed in): ${invited.asked.join(', ')}`)
  if (invited.needsConsent?.length) parts.push(`not invited, they already have an account there: ${invited.needsConsent.join(', ')}`)
  if (invited.unverified?.length) parts.push(`addresses to check first (then: slatebox migrate invite ${importId} --email <address> --to ${targetFlag(target)}): ${invited.unverified.join(', ')}`)
  if (invited.mailDisabled) parts.push(`${invited.mailDisabled} not sent: ${target.label} cannot send email yet`)
  ctx.out.say(`${parts.join('; ')}.`)
}

/** slatebox migrate invite <move id>: invite the moved people later (or one checked address with --email). */
export async function inviteMovedPeople(ctx, { id, to }) {
  if (!id) throw new InstallError(EXIT.USAGE, 'Which move? slatebox migrate invite <move id> --to cloud|<url> (the move id is printed when the move goes live).')
  const target = resolveServer(ctx, to)
  await tokenFor(ctx, target, `invite your team's people on ${target.label}`)
  const email = typeof ctx.flags.email === 'string' && ctx.flags.email ? ctx.flags.email : null
  if (!(await agree(ctx, email ? `Email ${email} an invitation from ${target.label}?` : `Email the moved people nobody invited yet, from ${target.label}?`))) throw new InstallError(EXIT.CANCELLED, 'Cancelled; nobody was emailed.')
  const done = await moveApi(ctx, target).inviteMoved(id, email)
  ctx.out.event({ event: 'done', importId: id, to: target.base, ...done })
  if (!ctx.json) {
    if (email) ctx.out.say(`${email}: ${{ sent: 'invitation sent', asked: 'asked to join (they already have an account there)', needs_consent: 'not invited, they already have an account there', mail_disabled: `not sent, ${target.label} cannot send email yet`, already_invited: 'already invited' }[done.outcome] || done.outcome}.`)
    else invitedLines(ctx, target, id, true, done.now || done.invited)
  }
  return 0
}

// After a move is live: the archive stays unless the person says to delete it (default no).
async function afterLive(ctx, path) {
  const keep = () => ctx.out.say(`The archive is kept at ${path} (encrypted; passphrase in ${keyFile(path)}). To delete it: rm ${path} ${keyFile(path)}`)
  if (ctx.flags['keep-archive']) return keep()
  let remove = Boolean(ctx.flags['delete-archive'])
  if (!remove && ctx.interactive && !ctx.yes) remove = await ctx.prompt.confirm('Delete the archive from this computer now? It is a full copy of the team.', { default: false })
  if (!remove) return keep()
  forget(path)
  ctx.out.step('archive', 'ok', 'Deleted the archive from this computer')
}

/** Export the source's team to an encrypted archive in ~/.slatebox/moves. */
async function exportFrom(ctx, source, { out = null, passphrase = null, keyBeside = true, ticket: given = null } = {}) {
  const api = moveApi(ctx, source)
  const ticket = given || (await api.exportTeam())
  const secret = passphrase === null ? randomBytes(24).toString('base64url') : passphrase
  if (secret) ctx.redactor.add(secret)
  const path = out || archivePath(ctx, ticket.team?.name, Boolean(secret))
  ctx.out.step('export', 'start', `Exporting ${ticket.team?.name ?? 'your team'} from ${source.label} (${plural(ticket.slates ?? 0, 'slate')}, ${plural(ticket.members ?? 0, 'person', 'people')})`)
  if (secret && keyBeside) keepPassphrase(path, secret)
  const bytes = await api.download(ticket.downloadUrl, secret, path)
  ctx.out.step('export', 'ok', `Exported ${(bytes / 1024 / 1024).toFixed(1)} MB${secret ? ', encrypted' : ''}`)
  return { path, passphrase: secret, team: ticket.team, members: ticket.members, slates: ticket.slates }
}

/** slatebox migrate --to cloud | import --from cloud: the whole move, source to target. */
export async function moveTeam(ctx, { from, to }) {
  const source = resolveServer(ctx, from)
  const target = resolveServer(ctx, to)
  if (source.base === target.base) throw new InstallError(EXIT.USAGE, `The team is already on ${source.base}: give a different --from or --to.`)
  await tokenFor(ctx, source, `move your team from ${source.label}`)
  await tokenFor(ctx, target, `move your team to ${target.label}`)

  // Ask both sides first, so a refusal (not a team admin there, not an owner here, a move
  // already waiting) comes before anything is downloaded.
  const sourceApi = moveApi(ctx, source)
  const preflight = await sourceApi.exportTeam()
  const started = await startMove(ctx, target)
  const plan = {
    action: 'move', from: source.base, to: target.base, team: preflight.team?.name, slates: preflight.slates, people: preflight.members,
    into: started.into, leavesCopy: true,
  }
  ctx.out.event({ event: 'plan', ...plan })
  if (!ctx.json)
    ctx.out.say([
      '', `Move ${preflight.team?.name ?? 'your team'} (${plural(preflight.slates ?? 0, 'slate')}, ${plural(preflight.members ?? 0, 'person', 'people')})`,
      `  from ${source.base}`, `  to   ${target.base}${started.into === 'your_team' ? ' (into the team you own there)' : ' (as a new team you own there)'}`,
      '  What moves: slates and boards, smart components, versions, comments, presentations, files, brand kit, library items (to the review queue there), people (invited only if you say so).',
      '  What stays: passwords, keys, access tokens, connected agents and integrations. The team stays on the source too until you remove it there.', '',
    ].join('\n'))
  if (!(await agree(ctx, 'Start the move?'))) throw new InstallError(EXIT.CANCELLED, 'Cancelled; nothing was changed.')

  const exported = await exportFrom(ctx, source, { ticket: preflight })
  let done
  try {
    done = await moveFileTo(ctx, target, exported.path, exported.passphrase, { started })
  } catch (error) {
    ctx.out.warn(`The archive is kept at ${exported.path} (encrypted; its passphrase is in ${keyFile(exported.path)}). Finish with: slatebox import ${exported.path} --to ${to === 'cloud' ? 'cloud' : target.base}`)
    throw error
  }
  if (done.state === 'confirmed') await afterLive(ctx, exported.path)
  else ctx.out.say(`The archive is kept at ${exported.path} (encrypted; passphrase in ${keyFile(exported.path)}).`)
  ctx.out.event({ event: 'done', moved: done.state === 'confirmed', ...done, archive: existsSync(exported.path) ? exported.path : null, from: source.base, to: target.base })
  if (done.state === 'confirmed' && !ctx.json) {
    ctx.out.say(`\nDone. Open ${target.base} to see the team.`)
    ctx.out.say('Next: add your agent keys again, make new access tokens, and reconnect integrations there. The team is still on the source until you remove it.')
  }
  return 0
}

/** slatebox export: a team export to a file. */
export async function exportTeamFile(ctx, { from, out }) {
  const source = resolveServer(ctx, from)
  await tokenFor(ctx, source, `export your team from ${source.label}`)
  const passphrase = ctx.flags.passphrase ? await passphraseFor(ctx, null) : null
  const exported = await exportFrom(ctx, source, { out: out || null, passphrase: passphrase ?? '', keyBeside: false })
  ctx.out.event({ event: 'done', file: exported.path, encrypted: Boolean(passphrase), team: exported.team })
  ctx.out.say(`Wrote ${exported.path}${passphrase ? ' (encrypted with your passphrase)' : ' (signed, not encrypted: keep it private, it holds every slate)'}.`)
  return 0
}

/** slatebox import <file>: an archive file into a server, as a move. */
export async function importTeamFile(ctx, { file, to }) {
  if (!existsSync(file)) throw new InstallError(EXIT.USAGE, `There is no file ${file}.`)
  const target = resolveServer(ctx, to)
  await tokenFor(ctx, target, `move your team to ${target.label}`)
  const passphrase = await passphraseFor(ctx, file)
  const done = await moveFileTo(ctx, target, file, passphrase)
  ctx.out.event({ event: 'done', moved: done.state === 'confirmed', ...done, to: target.base })
  if (done.state === 'confirmed' && !ctx.json) ctx.out.say(`\nDone. Open ${target.base} to see the team. Keys, access tokens and integrations are added again there.`)
  return 0
}

export { CloudError }
