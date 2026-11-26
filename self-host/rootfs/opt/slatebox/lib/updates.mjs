// `slatebox updates`: the container's side of self-hosted updates, run with the app's own database
// connection (like setup-link.mjs). The host updater (updater.sh, written by the installer) asks it
// what to do every five minutes, with `docker exec`: no network port, no token, only whoever
// already controls Docker can ask. Admin › Updates in the app writes the same record.
//
//   slatebox updates policy --json        what to do now: {"action":"none"|"apply"|"rollback", ...}
//   slatebox updates report --attempt ID --phase PHASE [--detail TEXT] [--version X.Y.Z] [--downgrade-safe] [--pre-upgrade-backup yes|no]
//   slatebox updates report --pending     the same, as JSON on standard input (a report kept while the app was down)
//   slatebox updates heartbeat --updater N --scheduler KIND
//   slatebox updates check [--json]       read the signed feed now
//   slatebox updates status [--json]      the version, what is available, the policy, the updater
//   slatebox updates request apply|retry|rollback [--version X.Y.Z]
//   slatebox updates auto on|off
//
// The decision and the record are the installer's own modules (one copy, in the image at
// /opt/slatebox/installer/src/updater), byte-identical to the app's.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { HOME, Plain, fail, mongodb } from './common.mjs'
import { setupState } from './setup-link.mjs'

const INSTALLER = process.env.SLATEBOX_INSTALLER_DIR || join(HOME, 'installer')
const load = file => import(pathToFileURL(join(INSTALLER, 'src', 'updater', file)).href)

export const STALE_CHECK_MS = 7 * 60 * 60 * 1000
export const RETRY_CHECK_MS = 15 * 60 * 1000

/** Whether the policy should read the feed itself: no good check for 7 hours, or a failed one 15 minutes ago. */
export function checkDue(feed, now) {
  const at = value => (value ? new Date(value).getTime() : 0)
  if (feed?.ok && !feed.lastError) return now - at(feed.checkedAt) > STALE_CHECK_MS
  return now - at(feed?.lastError?.at || feed?.checkedAt) > RETRY_CHECK_MS
}

export function currentVersion(home = HOME) {
  try { return JSON.parse(readFileSync(join(home, 'identity.json'), 'utf8')).version || null } catch { return null }
}

/** SLATEBOX_UPDATES (auto, notify or off) and SLATEBOX_UPDATE_FEED, from the settings the container started with. */
export function updateSettings(env = process.env) {
  const mode = ['auto', 'notify', 'off'].includes(env.SLATEBOX_UPDATES) ? env.SLATEBOX_UPDATES : 'auto'
  return { mode, feedUrl: env.SLATEBOX_UPDATE_FEED || null }
}

/** Node's fetch as the feed's transport: bytes for a 200, an error otherwise (redirects followed). */
export const nodeGet = async url => {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Slatebox self-host update check' } })
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`)
  return { bytes: Buffer.from(await response.arrayBuffer()) }
}

export async function run(args, { db, now = Date.now(), env = process.env, out = process.stdout, stdin = process.stdin, get = nodeGet, home = HOME } = {}) {
  const store = await load('store.mjs')
  const policyMod = await load('policy.mjs')
  const cols = { settings: db.collection('systemSettings'), events: db.collection('selfHostUpdateEvents') }
  const { mode, feedUrl } = updateSettings(env)
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, strict: true,
    options: {
      json: { type: 'boolean' }, attempt: { type: 'string' }, phase: { type: 'string' }, detail: { type: 'string' }, version: { type: 'string' },
      'downgrade-safe': { type: 'boolean' }, 'pre-upgrade-backup': { type: 'string' }, pending: { type: 'boolean' },
      updater: { type: 'string' }, scheduler: { type: 'string' }, 'feed-url': { type: 'string' },
    },
  })
  const [command, sub] = positionals
  const write = value => out.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`)
  const setUp = (await setupState(db, now)).setUp
  let doc = await store.ensureDoc(cols, { setUp, now })
  const current = currentVersion(home)
  // The feed: SLATEBOX_UPDATE_FEED, else the one the host updater named, else GitHub's.
  const feedMod = await load('feed.mjs')
  const feedAt = () => feedUrl || doc.updater?.feedUrl || feedMod.DEFAULT_FEED_URL
  const check = async () => {
    try {
      const result = await feedMod.readFeed({ get, url: feedAt(), lastSequence: doc.feed?.sequence || 0, now })
      await store.recordCheck(cols, { result, now })
      return { result }
    } catch (error) {
      await store.recordCheck(cols, { error, now })
      return { error }
    }
  }

  switch (command) {
    case 'policy': {
      // The app checks every 6 hours; if it has not (an older app, or it was down), check now.
      if (mode !== 'off' && checkDue(doc.feed, now)) {
        await check()
        doc = await store.readDoc(cols)
      }
      const decision = store.decideFor(doc, { now, current, mode })
      if (decision.action === 'none') return write({ action: 'none', reason: decision.reason, ...(decision.target ? { target: decision.target } : {}) })
      const attempt = await store.takeLease(cols, { decision, now, current })
      if (!attempt) return write({ action: 'none', reason: 'running' })
      const approved = (doc.approvals || []).some(version => policyMod.compareVersions(version, decision.target?.version || '0.0.0') === 0)
      const keepData = Boolean(doc.attempts?.find(item => item.outcome === 'healthy' && item.kind !== 'rollback')?.downgradeSafe)
      return write({ action: decision.action, attemptId: attempt.id, target: decision.target, current, channel: doc.policy?.channel || 'stable', approved, keepData, feedUrl: feedAt(), reason: decision.reason, lease: { until: new Date(now + policyMod.LEASE_MS).toISOString() } })
    }
    case 'report': {
      let given = values
      if (values.pending) {
        const chunks = []
        for await (const chunk of stdin) chunks.push(chunk)
        const pending = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        given = { attempt: pending.attemptId, phase: pending.phase, detail: pending.detail, version: pending.version, 'downgrade-safe': pending.downgradeSafe }
      }
      if (!given.attempt || !given.phase) throw new Plain('Give --attempt and --phase.')
      const pre = given['pre-upgrade-backup']
      await store.report(cols, { attemptId: given.attempt, phase: given.phase, detail: given.detail, version: given.version, now, downgradeSafe: Boolean(given['downgrade-safe']), preUpgradeBackup: pre === undefined ? null : pre === 'yes' })
      return write({ ok: true })
    }
    case 'heartbeat':
      await store.heartbeat(cols, { protocol: values.updater, scheduler: values.scheduler || 'unknown', now, feedUrl: values['feed-url'] || null })
      return write({ ok: true, mode, current })
    case 'check': {
      if (mode === 'off') throw new Plain('Update checks are off on this server (SLATEBOX_UPDATES=off).')
      const { result, error } = await check()
      if (error) throw new Plain(`The update check failed: ${error.message}`)
      const offered = policyMod.offered(result.feed, doc.policy?.channel)
      return write(values.json ? { ok: true, current, available: offered?.version || null, expired: result.expired } : `Checked: ${offered ? `the newest release is ${offered.version}` : 'no release yet'}${current ? `; this server runs ${current}` : ''}.`)
    }
    case 'status': {
      const decision = store.decideFor(doc, { now, current, mode })
      const status = {
        current, mode, policy: doc.policy, available: doc.feed?.ok ? policyMod.offered(doc.feed, doc.policy?.channel)?.version || null : null,
        checkedAt: doc.feed?.checkedAt || null, decision, words: policyMod.decisionWords(decision, { timeZone: doc.policy?.timeZone }),
        updater: doc.updater || null, attempt: doc.attempt || null, lastAttempt: doc.attempts?.[0] || null,
      }
      if (values.json) return write(status)
      return write([
        `Version:   ${current || 'unknown'}`,
        `Updates:   ${mode === 'off' ? 'off (SLATEBOX_UPDATES=off)' : doc.policy?.auto && mode === 'auto' ? `automatic, ${doc.policy.channel}` : 'notify only'}`,
        `Newest:    ${status.available || 'not checked yet'}`,
        `Now:       ${status.words}`,
        `Updater:   ${doc.updater ? `checked in ${new Date(doc.updater.at).toISOString()}` : 'not set up (npx slatebox updates enable)'}`,
      ].join('\n'))
    }
    case 'request': {
      const value = await store.request(cols, { kind: sub, version: values.version || null, by: 'host', now })
      return write({ ok: true, request: value })
    }
    case 'auto': {
      if (!['on', 'off'].includes(sub)) throw new Plain('Usage: slatebox updates auto on|off')
      await store.setPolicy(cols, { ...doc.policy, auto: sub === 'on' })
      await store.addEvent(cols, { kind: 'admin', detail: `automatic updates ${sub}`, by: 'host' }, { now })
      return write({ ok: true, auto: sub === 'on' })
    }
    default:
      throw new Plain('Usage: slatebox updates policy|report|heartbeat|check|status|request|auto (see the top of lib/updates.mjs)')
  }
}

async function main(args) {
  const { MongoClient } = mongodb()
  const client = new MongoClient(process.env.MONGO_URL)
  try {
    await client.connect()
    await run(args, { db: client.db() })
  } finally {
    await client.close().catch(() => {})
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch(fail)
}
