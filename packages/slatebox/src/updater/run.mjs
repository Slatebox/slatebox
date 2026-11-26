// The host updater: `slatebox-updater`, run by updater.sh inside a short-lived container made from
// the image that is running now, as root, with the Docker socket and the install's folder mounted
// at the same path. It trusts nothing the app says about what to install:
//
//   1. the app's decision names a version (or "roll back"), never an image, a feed or the running
//      version: the feed address comes only from updater.sh (written by the installer, https only),
//      the running version from this image's own identity.json;
//   2. this reads the signed feed and manifests itself, with the keys built into this image, and
//      refuses an expired feed, one older than the newest it has seen (updates/feed-state.json, so
//      an old signed feed replayed cannot hide later withdrawals), a version they do not name, an
//      older one, a withdrawn one (or one reached through a withdrawn one), or a major release
//      without approval; a rollback goes only to the image the install record names as previous;
//   3. it pulls by the manifest's digest and runs the installer's own upgrade path (pre-upgrade
//      backup, set the old container aside, start, health check, roll back with the backup);
//   4. it reports each phase with `docker exec <name> slatebox updates report`; an outcome that
//      cannot be delivered (Slatebox is down) waits in updates/pending-report.json.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { execFileSync } from 'node:child_process'
import { collect, resolveAnswers } from '../answers.mjs'
import { EXIT, InstallError } from '../errors.mjs'
import { makeRunner } from '../runner.mjs'
import { Redactor } from '../secrets.mjs'
import { localHost } from '../targets/hosts.mjs'
import { applyOnHost, backupsDir } from '../targets/docker.mjs'
import { parse as parseYaml } from '../yaml.mjs'
import { DEFAULT_FEED_URL, FeedError, checkManifest, fetchSigned, imageRefFor, manifestUrl, readCapped, readFeed, resolveTarget } from './feed.mjs'
import { compareVersions } from './policy.mjs'
import { HOST_SCRIPT_OPTIONS, IN_FLIGHT, PENDING_REPORT, SLATEBOX_BIN, STARTED, UPDATER_SCRIPT, updaterScript } from './host-script.mjs'

export const PRE_UPGRADE_KEEP = 3
export const FEED_STATE = 'updates/feed-state.json'
export const IMAGE_IDENTITY = '/opt/slatebox/identity.json'
const PKG = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

/** Node's fetch as the feed's transport (redirects to GitHub's asset hosts followed). */
export const nodeGet = async url => {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'Slatebox self-host updater' } })
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`)
  return { bytes: await readCapped(response) }
}

/** The feed address the host updater reads: its own --feed-url (https), else GitHub's. Never the app's. */
export function hostFeedUrl(feedUrl) {
  if (!feedUrl) return DEFAULT_FEED_URL
  let url
  try { url = new URL(feedUrl) } catch { throw new FeedError('feed-url', 'The feed address is not a URL.') }
  if (url.protocol !== 'https:') throw new FeedError('feed-url', 'The feed address must be https.')
  manifestUrl(feedUrl, '0.0.0')
  return feedUrl
}

/** The newest feed sequence this host has accepted (0 when none). */
export function seenSequence(dir) {
  try { return Number(JSON.parse(readFileSync(join(dir, FEED_STATE), 'utf8')).sequence) || 0 } catch { return 0 }
}

function rememberSequence(dir, sequence) {
  if (!(sequence > seenSequence(dir))) return
  mkdirSync(join(dir, 'updates'), { recursive: true, mode: 0o700 })
  writeFileSync(join(dir, FEED_STATE), JSON.stringify({ sequence, at: new Date().toISOString() }), { mode: 0o600 })
}

/** The version of the image this updater runs from (the image Slatebox runs now). */
export function imageVersion(file = IMAGE_IDENTITY) {
  try { return JSON.parse(readFileSync(file, 'utf8')).version || null } catch { return null }
}

/** Keep the newest few pre-upgrade backups; the rest go. */
export function prunePreUpgrade(dir, keep = PRE_UPGRADE_KEEP) {
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter(file => /^pre-upgrade-.*\.gz$/.test(file))
    .map(file => ({ file, at: statSync(join(dir, file)).mtimeMs })).sort((a, b) => b.at - a.at || (a.file < b.file ? 1 : -1))
  const old = files.slice(keep).map(item => item.file)
  for (const file of old) rmSync(join(dir, file), { force: true })
  return old
}

/**
 * The outside health check from inside the updater container, the way a browser asks: to the
 * published port through the host (outsideUrl, such as http://host.docker.internal:7070 on a Mac),
 * with the Host header of the install's own address, because Slatebox's front proxy answers only
 * for the address it serves (any other name gets 421).
 */
export function throughHost(fetchImpl, outsideUrl, addressUrl) {
  if (!outsideUrl || !addressUrl) return fetchImpl
  const host = new URL(addressUrl).host
  return async (url, options = {}) => {
    if (!String(url).startsWith(outsideUrl)) return fetchImpl(url, options)
    const { request } = await import(String(url).startsWith('https:') ? 'node:https' : 'node:http')
    return new Promise((resolve, reject) => {
      const req = request(url, { headers: { host }, signal: options.signal }, res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(text), text: async () => text })
        })
      })
      req.on('error', reject)
      req.end()
    })
  }
}

/** The phase names the app shows, from the installer's own steps. */
function phaseOf(id, status) {
  if (status !== 'start') return null
  return { backup: 'backing-up', image: 'pulling', start: 'starting' }[id] || null
}

/**
 * One updater run.
 * @param {object} options { name, dir, backups, outsideUrl, feedUrl, decision, env, run, get, log, now, platform }
 * @returns {Promise<{ outcome: string, exitCode: number, detail: string }>}
 */
export async function runUpdater({ name, dir, backups = null, outsideUrl = null, feedUrl = null, decision, identity = IMAGE_IDENTITY, env = process.env, run, get = nodeGet, keys, fetch = globalThis.fetch, log = line => process.stdout.write(`${line}\n`), healthTimeout = 600, healthPoll, platform = 'linux' }) {
  const redactor = new Redactor()
  const out = {
    step(id, status, detail = '') {
      log(`${status === 'fail' ? '✗' : status === 'ok' ? '✓' : status === 'warn' ? '!' : '…'} ${redactor.redact(detail || id)}`)
      const phase = phaseOf(id, status)
      // Reported as it happens (in order), so Admin › Updates shows the phases live.
      if (phase && phase !== lastPhase) { lastPhase = phase; reported = reported.then(() => report(phase)) }
    },
    say: text => log(redactor.redact(text)), warn: text => log(`! ${redactor.redact(text)}`), event() {}, debug() {},
  }
  let lastPhase = null
  let reported = Promise.resolve()
  const ctx = {
    env, flags: {}, home: dirname(dirname(dir)), redactor, out, run: run || makeRunner(out), fetch,
    interactive: false, tty: false, json: false, yes: true, healthTimeout, healthPoll, platform, version: PKG.version,
    unattended: true, outsideUrl, confirm: async () => {}, emitPlan: plan => log(`plan: ${plan.action} ${plan.image?.pinned || ''} (${(plan.changes || []).join('; ') || 'no other changes'})`),
  }
  const host = localHost(ctx, { dir, name })
  const attemptId = decision?.attemptId
  const kind = decision?.action === 'rollback' ? 'rollback' : 'apply'
  let current = null
  const report = async (phase, { detail = '', version = null, downgradeSafe = false, preUpgradeBackup = null } = {}) => {
    const args = ['exec', name, SLATEBOX_BIN, 'updates', 'report', '--attempt', attemptId, '--phase', phase, '--kind', kind,
      ...(current ? ['--from', current] : []),
      ...(detail ? ['--detail', String(detail).slice(0, 1500)] : []), ...(version ? ['--version', version] : []),
      ...(downgradeSafe ? ['--downgrade-safe'] : []), ...(preUpgradeBackup === null ? [] : ['--pre-upgrade-backup', preUpgradeBackup ? 'yes' : 'no'])]
    const result = await host.docker(args, { timeout: 120_000 })
    if (result.code !== 0 && ['healthy', 'rolled-back', 'failed', 'verification-failed'].includes(phase)) {
      // Slatebox cannot take the report now: keep it for the next run that reaches it.
      mkdirSync(join(dir, 'updates'), { recursive: true, mode: 0o700 })
      writeFileSync(join(dir, PENDING_REPORT), JSON.stringify({ attemptId, phase, detail, version, downgradeSafe, kind, from: current }), { mode: 0o600 })
    }
    return result.code === 0
  }
  const flush = () => reported
  const finish = async (outcome, exitCode, detail, extra = {}) => {
    await flush()
    rmSync(join(dir, IN_FLIGHT), { force: true })
    await report(outcome, { detail, ...extra })
    log(`${outcome}: ${detail}`)
    return { outcome, exitCode, detail }
  }

  if (!attemptId || !['apply', 'rollback'].includes(decision?.action)) return { outcome: 'none', exitCode: 0, detail: 'nothing to do' }
  if (!/^[A-Za-z0-9-]{1,64}$/.test(String(attemptId))) return { outcome: 'none', exitCode: 2, detail: 'the attempt id is not one Slatebox makes' }
  // First: this attempt's updater has run (updater.sh tells it from Docker failing to start one).
  mkdirSync(join(dir, 'updates'), { recursive: true, mode: 0o700 })
  writeFileSync(join(dir, STARTED), `${attemptId}\n`, { mode: 0o600 })
  const recordText = existsSync(join(dir, 'install.yaml')) ? readFileSync(join(dir, 'install.yaml'), 'utf8') : null
  if (!recordText) return finish('failed', EXIT.PRECONDITION, `There is no install record in ${dir}.`)
  const record = parseYaml(recordText)
  const { answers, errors } = resolveAnswers(collect({ record }), {})
  if (errors.length) return finish('failed', EXIT.USAGE, `The install record is not valid (${errors.map(error => error.field).join(', ')}).`)
  const keepDir = backups || backupsDir(host, answers)
  ctx.fetch = throughHost(fetch, outsideUrl, answers.address?.url)

  await report('verifying')
  let imageRef
  let manifest = null
  // What runs now, from this image itself (updater.sh starts this container from the running image).
  current = imageVersion(identity)
  if (decision.action === 'apply') {
    try {
      const url = hostFeedUrl(feedUrl)
      const feedResult = await readFeed({ get, url, keys, lastSequence: seenSequence(dir) })
      if (feedResult.expired) throw new FeedError('feed-expired', 'The update feed has expired (Slatebox re-signs it every day): it may be an old one replayed, so nothing is applied until a current one can be read.')
      rememberSequence(dir, feedResult.sequence)
      const getManifest = async version => checkManifest((await fetchSigned(get, manifestUrl(url, version), { keys })).document, { version })
      if (!current) throw new FeedError('unknown-version', 'The running image does not say which version it is.')
      ;({ manifest } = await resolveTarget({ current, requested: decision.target?.version, channel: decision.channel || 'stable', feedResult, getManifest, approved: decision.approved === true }))
    } catch (error) {
      if (error instanceof FeedError) return finish('verification-failed', 3, error.message)
      return finish('failed', 1, error.message)
    }
    imageRef = imageRefFor(manifest)
    log(`verified ${manifest.version}: ${imageRef}`)
  } else {
    // A rollback goes to the image this install ran before its last upgrade, and nowhere else.
    imageRef = record.previousImageDigest
    if (!imageRef || !/^sha256:[a-f0-9]{64}$|@sha256:[a-f0-9]{64}$/.test(imageRef)) return finish('failed', EXIT.PRECONDITION, 'The install record names no previous image to roll back to.')
    const there = await host.docker(['image', 'inspect', '--format', '{{.Id}}', imageRef])
    if (there.code !== 0) return finish('failed', EXIT.PRECONDITION, `The previous image (${imageRef.slice(0, 19)}) is no longer on this host.`)
  }

  const before = existsSync(keepDir) ? new Set(readdirSync(keepDir)) : new Set()
  const restoring = decision.action === 'rollback' && !decision.keepData
  const previousBackup = restoring ? newestPreUpgrade(keepDir, record) : null
  // The restore brings back the database from before the upgrade, and with it an older copy of
  // this record: keep the one there is now (approvals, notices, this attempt) to put back after.
  let saved = null
  if (restoring && previousBackup) {
    const exported = await host.docker(['exec', name, SLATEBOX_BIN, 'updates', 'record', 'export'], { timeout: 120_000 })
    saved = exported.code === 0 ? String(exported.stdout).trim().split('\n').pop() : null
  }
  // A run cut off from here on (a reboot, Docker restarted) is finished by updater.sh's next run.
  ctx.beforeSwap = ({ preUpgrade, previousImage, previousRestores, aside }) => {
    if (!aside) return
    mkdirSync(join(dir, 'updates'), { recursive: true, mode: 0o700 })
    const lines = [`attempt=${attemptId}`, `kind=${kind}`, `from=${current || ''}`, `previous_image=${previousImage || ''}`,
      `backup=${preUpgrade && previousRestores ? preUpgrade : ''}`, `at=${new Date().toISOString()}`]
    writeFileSync(join(dir, IN_FLIGHT), `${lines.join('\n')}\n`, { mode: 0o600 })
  }
  let applied
  try {
    applied = await applyOnHost(ctx, host, answers, { record, imageRef, refresh: false, unattended: true, restoreBackup: previousBackup })
  } catch (error) {
    if (error instanceof InstallError && error.exitCode === EXIT.ROLLED_BACK) {
      // A rollback that did not come up leaves the version it started from running: not "rolled back".
      if (decision.action === 'rollback') return finish('failed', EXIT.ROLLED_BACK, `The previous version did not start, so ${current || 'the version from before'} was put back and runs as it did. ${error.message}`)
      return finish('rolled-back', EXIT.ROLLED_BACK, error.message)
    }
    if (error instanceof InstallError && error.exitCode === EXIT.ROLLBACK_FAILED) return finish('failed', EXIT.ROLLBACK_FAILED, error.message)
    return finish('failed', error.exitCode || 1, error.message)
  }
  const made = existsSync(keepDir) ? readdirSync(keepDir).filter(file => !before.has(file) && file.startsWith('pre-upgrade-')) : []

  if (restoring) {
    // The newer version may have changed the data in ways the older one cannot read: the copy taken
    // just before the upgrade comes back (Admin › Updates said so before the admin confirmed). An
    // image that loads it as it starts already has; an older one restores it now.
    if (!previousBackup) return finish('failed', EXIT.PRECONDITION, 'The previous version is running again, but the backup from before the upgrade is gone, so its data was kept as it is.')
    if (!applied?.restoredOnStart) {
      out.step('restore', 'start', `Restoring the backup from before the upgrade (${previousBackup})`)
      const restored = await host.restoreFromFile(name, previousBackup)
      if (restored.code !== 0) return finish('failed', EXIT.PRECONDITION, `The previous version is running again, but restoring ${previousBackup} failed: ${String(restored.stderr).trim().split('\n').pop()}`)
    }
    if (saved) {
      const put = await host.docker(['exec', '-i', name, SLATEBOX_BIN, 'updates', 'record', 'import'], { input: saved, timeout: 120_000 })
      if (put.code !== 0) log(`! The updates record could not be put back after the restore: ${String(put.stderr).trim().split('\n').pop()}`)
    }
  }
  prunePreUpgrade(keepDir)
  const version = manifest?.version || decision.target?.version || null
  const downgradeSafe = Boolean(manifest && current && (manifest.downgradeSafeTo || []).some(item => compareVersions(item, current) === 0))
  return finish('healthy', 0, decision.action === 'rollback' ? 'rolled back to the previous version' : `updated to ${version}`, {
    version: decision.action === 'rollback' ? null : version, downgradeSafe, preUpgradeBackup: decision.action === 'apply' && made.length > 0,
  })
}

/** The pre-upgrade backup the last upgrade made (pre-upgrade-<previous>-<current>.gz), newest first. */
function newestPreUpgrade(dir, record) {
  if (!existsSync(dir)) return null
  const prev = String(record.previousImageDigest || '').replace(/^.*@/, '').slice(7, 19)
  const files = readdirSync(dir).filter(file => file.startsWith(`pre-upgrade-${prev}-`) && file.endsWith('.gz')).sort()
  return files.length ? join(dir, files.at(-1)) : null
}

/**
 * updater.sh written again by this version, from the options the installer kept beside it
 * (updates/host-script.json): updater.sh runs this from the image an update just started, so a
 * fix to the host side arrives like the rest of Slatebox. Renamed into place: the run that called
 * this keeps reading the copy it opened. → the path written
 */
export function writeHostScript(dir) {
  const options = JSON.parse(readFileSync(join(dir, HOST_SCRIPT_OPTIONS), 'utf8'))
  if (options.dir !== dir) throw new Error(`${HOST_SCRIPT_OPTIONS} is for ${options.dir}, not ${dir}`)
  // Every choice that differs between a Mac and Linux is named: a missing one is refused, never
  // filled with the Linux default.
  const strings = ['name', 'docker', 'scheduler', 'socket']
  const flags = ['hostNetwork', 'asOwner']
  const missing = [...strings.filter(key => typeof options[key] !== 'string' || !options[key]), ...flags.filter(key => typeof options[key] !== 'boolean')]
  if (missing.length) throw new Error(`${HOST_SCRIPT_OPTIONS} does not say ${missing.join(', ')}`)
  const path = join(dir, UPDATER_SCRIPT)
  const next = `${path}.tmp`
  rmSync(next, { force: true })
  writeFileSync(next, updaterScript(options), { mode: 0o700 })
  chmodSync(next, 0o700)
  // A script sh cannot read would stop updates for good: refused here, and the one there is stays.
  try { execFileSync('sh', ['-n', next], { stdio: 'pipe' }) } catch (error) {
    rmSync(next, { force: true })
    throw new Error(`the new updater.sh is not valid sh: ${String(error.stderr || error.message).trim()}`)
  }
  if (existsSync(path)) copyFileSync(path, `${path}.prev`)
  renameSync(next, path)
  return path
}

async function main(argv) {
  const { values } = parseArgs({ args: argv, strict: true, options: { name: { type: 'string' }, dir: { type: 'string' }, backups: { type: 'string' }, 'outside-url': { type: 'string' }, 'feed-url': { type: 'string' }, 'write-host-script': { type: 'boolean' } } })
  if (values['write-host-script'] && values.dir) {
    process.stdout.write(`${new Date().toISOString()} wrote ${writeHostScript(values.dir)} (Slatebox ${imageVersion() || PKG.version})\n`)
    return 0
  }
  if (!values.name || !values.dir) {
    process.stderr.write('Usage: slatebox-updater --name <install> --dir <its folder> [--backups <dir>] [--outside-url <url>] [--feed-url <url>]\n(run by updater.sh, with SLATEBOX_UPDATE_DECISION set)\n')
    return 2
  }
  let decision
  try { decision = JSON.parse(process.env.SLATEBOX_UPDATE_DECISION || '{}') } catch { decision = {} }
  const result = await runUpdater({ name: values.name, dir: values.dir, backups: values.backups || null, outsideUrl: values['outside-url'] || null, feedUrl: values['feed-url'] || null, decision })
  return result.exitCode
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => { process.stderr.write(`${error?.stack || error}\n`); process.exit(1) })
}
