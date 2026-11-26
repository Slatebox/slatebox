// The host updater (slatebox-updater) against the Docker stand-in: it applies only what the signed
// feed names, by digest, through the installer's own upgrade path, and reports every phase.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { prunePreUpgrade, runUpdater } from '../src/updater/run.mjs'
import { parse } from '../src/yaml.mjs'
import { cli, FakeDocker, ID, sandbox } from './fakes.mjs'
import { FakeGitHub, REPO, testKey } from './updater-kit.mjs'

const IMAGE = 'slatebox-test:1'
const BASE = ['--image', IMAGE, '--ai', 'none', '--port', '17431', '--backups', 'default']
const key = testKey()
const okFetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })

async function installed({ broken = [], commands = [] } = {}) {
  const docker = new FakeDocker({ broken, commands })
  docker.addImage(IMAGE)
  const home = sandbox()
  const result = await cli(['install', ...BASE, '--yes', '--no-auto-updates'], { run: docker.run, home })
  assert.equal(result.code, 0, result.stderr)
  // As `slatebox updates enable` leaves it.
  const recordPath = join(home, 'installs', 'slatebox', 'install.yaml')
  const { recordText } = await import('../src/record.mjs')
  writeFileSync(recordPath, recordText({ ...parse(readFileSync(recordPath, 'utf8')), updates: { enabled: true, scheduler: 'cron' } }))
  const gh = new FakeGitHub(key)
  const reports = []
  const records = { exported: 0, imported: [] }
  // The container's `slatebox updates report`: recorded here; `failReports` makes Slatebox unreachable.
  const run = async (cmd, args, options) => {
    if (cmd === 'docker' && args[0] === 'exec' && args.includes('updates') && args.includes('report')) {
      if (run.failReports) return { code: 1, stdout: '', stderr: 'Error: No such container' }
      const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
      reports.push({ phase: flag('--phase'), attempt: flag('--attempt'), version: flag('--version'), detail: flag('--detail'), kind: flag('--kind'), from: flag('--from') })
      return { code: 0, stdout: '{"ok":true}\n', stderr: '' }
    }
    if (cmd === 'docker' && args[0] === 'exec' && args.includes('updates') && args.includes('record')) {
      if (args.includes('export')) { records.exported++; return { code: 0, stdout: '{"_id":"selfHostUpdates","approvals":["3.0.0"]}\n', stderr: '' } }
      records.imported.push(options?.input)
      return { code: 0, stdout: '{"ok":true}\n', stderr: '' }
    }
    return docker.run(cmd, args, options)
  }
  return { docker, home, gh, reports, records, run, dir: join(home, 'installs', 'slatebox') }
}

const decision = (extra = {}) => ({ action: 'apply', attemptId: 'att-1', target: { version: '2.1.0' }, channel: 'stable', approved: false, ...extra })
// The updater image's own identity.json: the version that runs now (never the app's word for it).
const identityOf = version => {
  const file = join(sandbox(), 'identity.json')
  writeFileSync(file, JSON.stringify({ version }))
  return file
}
const go = (world, extra = {}) => runUpdater({ name: 'slatebox', dir: world.dir, decision: decision(extra.decision), identity: identityOf(extra.current || '2.0.0'), run: world.run, get: world.gh.get, keys: key.keys, fetch: okFetch, healthTimeout: 2, healthPoll: 1, log: () => {}, ...extra.options })

test('nothing to do: no docker call at all', async () => {
  const world = await installed()
  const before = world.docker.calls.length
  const result = await runUpdater({ name: 'slatebox', dir: world.dir, decision: { action: 'none' }, run: world.run, get: world.gh.get, keys: key.keys, log: () => {} })
  assert.equal(result.outcome, 'none')
  assert.equal(world.docker.calls.length, before)
})

test('apply: verified, pulled by the signed digest, backed up first, healthy, record updated, phases reported', async () => {
  const world = await installed()
  const release = world.gh.release('2.1.0')
  world.gh.publishFeed({ stable: '2.1.0' })
  const ref = `${REPO}@${release.doc.image.index}`
  world.docker.registry.set(ref, 'next:2.1.0')
  const result = await go(world)
  assert.equal(result.outcome, 'healthy', result.detail)
  assert.ok(world.docker.calls.some(call => call.args[0] === 'pull' && call.args[1] === ref), 'pulled by digest')
  assert.equal(world.docker.containers.get('slatebox').image, ID('next:2.1.0'))
  assert.deepEqual(world.reports.map(r => r.phase), ['verifying', 'pulling', 'backing-up', 'starting', 'healthy'])
  assert.ok(world.reports.every(r => r.attempt === 'att-1'))
  assert.equal(world.reports.at(-1).phase, 'healthy')
  assert.equal(world.reports.at(-1).version, '2.1.0')
  const record = parse(readFileSync(join(world.dir, 'install.yaml'), 'utf8'))
  assert.equal(record.updatedBy, 'auto-updater')
  assert.deepEqual(record.updates, { enabled: true, scheduler: 'cron' }, 'the host updater setting survives the update')
  assert.equal(record.imageDigest, ref)
  assert.equal(record.previousImageDigest, ID(IMAGE))
  assert.ok(readdirSync(join(world.dir, 'backups')).some(file => file.startsWith('pre-upgrade-')), 'a backup before the upgrade')
  // backup.sh and its schedule are as the installer wrote them.
  assert.ok(existsSync(join(world.dir, 'backup.sh')))
})

test('a feed that fails verification: nothing is pulled, verification-failed is reported', async () => {
  const world = await installed()
  world.gh.release('2.1.0')
  world.gh.publishFeed({ stable: '2.1.0' })
  world.gh.put('https://github.com/Slatebox/slatebox/releases/download/update-feed/channels.json.sig', `sbrel1.${key.id}.${'A'.repeat(86)}`)
  const result = await go(world)
  assert.equal(result.outcome, 'verification-failed')
  assert.ok(!world.docker.calls.some(call => call.args[0] === 'pull'))
  assert.equal(world.reports.at(-1).phase, 'verification-failed')
})

test('a target the app named that the signed feed does not: refused, nothing pulled', async () => {
  const world = await installed()
  world.gh.release('2.1.0')
  world.gh.publishFeed({ stable: '2.1.0' })
  const result = await go(world, { decision: { target: { version: '9.9.9' } } })
  assert.equal(result.outcome, 'verification-failed')
  assert.match(result.detail, /not a release the signed feed offers/)
  assert.ok(!world.docker.calls.some(call => call.args[0] === 'pull'))
})

test('the host trusts its own feed address, version and newest-seen sequence, not the app\'s', async () => {
  const world = await installed()
  const release = world.gh.release('2.1.0')
  world.gh.publishFeed({ stable: '2.1.0' })
  world.docker.registry.set(`${REPO}@${release.doc.image.index}`, 'next:2.1.0')
  // A decision naming another feed and a running version: both ignored (GitHub's feed, identity.json).
  const asked = []
  const get = async url => { asked.push(url); return world.gh.get(url) }
  const result = await go(world, { decision: { feedUrl: 'http://evil.example/update-feed/channels.json', current: '0.0.1' }, options: { get } })
  assert.equal(result.outcome, 'healthy', result.detail)
  assert.ok(asked.every(url => url.startsWith('https://github.com/')), asked.join(', '))
  assert.equal(JSON.parse(readFileSync(join(world.dir, 'updates', 'feed-state.json'), 'utf8')).sequence, 1)
  // A --feed-url that is not https is refused.
  const plain = await go(await installed(), { options: { feedUrl: 'http://mirror.example/update-feed/channels.json' } })
  assert.equal(plain.outcome, 'verification-failed')
  assert.match(plain.detail, /https/)
})

test('an older signed feed replayed, or an expired one, applies nothing (even for Update now)', async () => {
  const world = await installed()
  world.gh.release('2.1.0')
  world.gh.publishFeed({ stable: '2.1.0', sequence: 5 })
  mkdirSync(join(world.dir, 'updates'), { recursive: true })
  writeFileSync(join(world.dir, 'updates', 'feed-state.json'), JSON.stringify({ sequence: 9 }))
  const replayed = await go(world)
  assert.equal(replayed.outcome, 'verification-failed')
  assert.match(replayed.detail, /older than one already seen/)
  world.gh.publishFeed({ stable: '2.1.0', sequence: 10, expiresAt: '2020-01-01T00:00:00.000Z' })
  const expired = await go(world, { decision: { reason: 'requested' } })
  assert.equal(expired.outcome, 'verification-failed')
  assert.match(expired.detail, /expired/)
  assert.ok(!world.docker.calls.some(call => call.args[0] === 'pull'))
})

test('before pulling, Docker\'s own storage is checked (not only the install folder): too full, nothing changes', async () => {
  const world = await installed()
  const release = world.gh.release('2.1.0')
  world.gh.publishFeed({ stable: '2.1.0' })
  world.docker.registry.set(`${REPO}@${release.doc.image.index}`, 'next:2.1.0')
  world.docker.dockerFreeKb = 2 * 1024 ** 2
  const result = await go(world)
  assert.equal(result.outcome, 'failed')
  assert.match(result.detail, /Docker's storage .*\/var\/lib\/docker.* 2\.0 GB free/)
  assert.ok(!world.docker.calls.some(call => call.args[0] === 'pull'), 'nothing pulled')
  assert.equal(world.docker.containers.get('slatebox').image, ID(IMAGE))
  world.docker.dockerFreeKb = 50 * 1024 ** 2
  assert.equal((await go(world)).outcome, 'healthy')
})

test('a new image that never gets healthy: the previous one back with its backup restored, rolled-back reported', async () => {
  const world = await installed({ broken: ['next:2.1.0'] })
  const release = world.gh.release('2.1.0')
  world.gh.publishFeed({ stable: '2.1.0' })
  world.docker.registry.set(`${REPO}@${release.doc.image.index}`, 'next:2.1.0')
  const result = await go(world)
  assert.equal(result.outcome, 'rolled-back', result.detail)
  assert.equal(world.docker.containers.get('slatebox').image, ID(IMAGE))
  assert.ok(world.docker.calls.some(call => call.args.includes('restore')), 'the backup from before was restored')
  assert.equal(world.reports.at(-1).phase, 'rolled-back')
})

test('when Slatebox cannot take the final report, it waits in updates/pending-report.json', async () => {
  const world = await installed()
  world.gh.release('2.1.0')
  world.gh.publishFeed({ stable: '2.1.0' })
  world.run.failReports = true
  const result = await go(world, { decision: { target: { version: '7.0.0' } } })
  assert.equal(result.outcome, 'verification-failed')
  const pending = JSON.parse(readFileSync(join(world.dir, 'updates', 'pending-report.json'), 'utf8'))
  assert.equal(pending.attemptId, 'att-1')
  assert.equal(pending.phase, 'verification-failed')
})

test('a major release without approval is refused by the host too, whatever the app says', async () => {
  const world = await installed()
  world.gh.release('3.0.0', { major: true })
  world.gh.publishFeed({ stable: '3.0.0' })
  const result = await go(world, { decision: { target: { version: '3.0.0' }, approved: false } })
  assert.equal(result.outcome, 'verification-failed')
  assert.match(result.detail, /major release/)
})

test('roll back: only to the image the record names as previous; the data from before the upgrade comes back', async () => {
  const world = await installed()
  const release = world.gh.release('2.1.0')
  world.gh.publishFeed({ stable: '2.1.0' })
  world.docker.registry.set(`${REPO}@${release.doc.image.index}`, 'next:2.1.0')
  assert.equal((await go(world)).outcome, 'healthy')
  const back = await go(world, { current: '2.1.0', decision: { action: 'rollback', attemptId: 'att-2', target: null } })
  assert.equal(back.outcome, 'healthy', back.detail)
  assert.equal(world.docker.containers.get('slatebox').image, ID(IMAGE))
  const restores = world.docker.calls.filter(call => call.args.includes('restore'))
  assert.equal(restores.length, 1, 'the pre-upgrade backup was restored once')
})

test('roll back on an image that loads a backup as it starts: the data goes in before the older version opens it; the record is kept', async () => {
  const world = await installed({ commands: ['restore-on-start'] })
  const release = world.gh.release('2.1.0')
  world.gh.publishFeed({ stable: '2.1.0' })
  world.docker.registry.set(`${REPO}@${release.doc.image.index}`, 'next:2.1.0')
  assert.equal((await go(world)).outcome, 'healthy')
  const back = await go(world, { current: '2.1.0', decision: { action: 'rollback', attemptId: 'att-2', target: null } })
  assert.equal(back.outcome, 'healthy', back.detail)
  assert.equal(world.docker.containers.get('slatebox').image, ID(IMAGE))
  // Staged into the volume with the older image, before it started; never restored into a running one.
  assert.equal(world.docker.staged.length, 1)
  assert.equal(world.docker.staged[0].volume, 'slatebox-data')
  assert.equal(world.docker.staged[0].image, ID(IMAGE))
  assert.match(world.docker.staged[0].file, /pre-upgrade-.*\.gz$/)
  const stagedAt = world.docker.calls.findIndex(call => call.args.some(arg => String(arg).includes('restore-on-start')))
  const startedAt = world.docker.calls.findLastIndex(call => call.args[0] === 'run' && call.args.includes('--detach'))
  assert.ok(stagedAt < startedAt, 'the backup is in place before the older version starts')
  assert.ok(!world.docker.calls.some(call => call.args[0] === 'exec' && call.args.includes('restore')))
  // The record from before the restore is put back, and the final report says what the attempt was.
  assert.equal(world.records.exported, 1)
  assert.deepEqual(world.records.imported, ['{"_id":"selfHostUpdates","approvals":["3.0.0"]}'])
  assert.deepEqual({ kind: world.reports.at(-1).kind, from: world.reports.at(-1).from }, { kind: 'rollback', from: '2.1.0' })
  assert.ok(!existsSync(join(world.dir, 'updates', 'in-flight')), 'nothing left for updater.sh to finish')
})

test('an automatic rollback on such an image stages the backup before the previous version starts', async () => {
  const world = await installed({ broken: ['next:2.1.0'], commands: ['restore-on-start'] })
  const release = world.gh.release('2.1.0')
  world.gh.publishFeed({ stable: '2.1.0' })
  world.docker.registry.set(`${REPO}@${release.doc.image.index}`, 'next:2.1.0')
  const result = await go(world)
  assert.equal(result.outcome, 'rolled-back', result.detail)
  assert.equal(world.docker.containers.get('slatebox').image, ID(IMAGE))
  assert.equal(world.docker.staged.length, 1)
  assert.equal(world.docker.staged[0].image, ID(IMAGE))
  assert.ok(!world.docker.calls.some(call => call.args[0] === 'exec' && call.args.includes('restore')))
})

test('a rollback whose older version does not come up is reported as failed, not as rolled back', async () => {
  const world = await installed()
  const release = world.gh.release('2.1.0')
  world.gh.publishFeed({ stable: '2.1.0' })
  world.docker.registry.set(`${REPO}@${release.doc.image.index}`, 'next:2.1.0')
  assert.equal((await go(world)).outcome, 'healthy')
  world.docker.broken.add(ID(IMAGE))
  const back = await go(world, { current: '2.1.0', decision: { action: 'rollback', attemptId: 'att-2', target: null } })
  assert.equal(back.outcome, 'failed')
  assert.match(back.detail, /previous version did not start, so 2\.1\.0 was put back/)
  assert.equal(world.docker.containers.get('slatebox').image, ID('next:2.1.0'))
})

test('roll back with no previous image recorded: refused, nothing changes', async () => {
  const world = await installed()
  const result = await go(world, { decision: { action: 'rollback', attemptId: 'att-3', target: null } })
  assert.equal(result.outcome, 'failed')
  assert.match(result.detail, /no previous image/)
})

test('old pre-upgrade backups are pruned to the newest 3', () => {
  const dir = join(sandbox(), 'b')
  mkdirSync(dir)
  for (let i = 0; i < 5; i++) {
    writeFileSync(join(dir, `pre-upgrade-${i}.gz`), 'x')
    utimesSync(join(dir, `pre-upgrade-${i}.gz`), new Date(1_700_000_000_000 + i * 1000), new Date(1_700_000_000_000 + i * 1000))
  }
  writeFileSync(join(dir, 'slatebox-20261125-030000.gz'), 'daily')
  assert.deepEqual(prunePreUpgrade(dir).sort(), ['pre-upgrade-0.gz', 'pre-upgrade-1.gz'])
  assert.ok(existsSync(join(dir, 'slatebox-20261125-030000.gz')), 'daily backups are not touched')
})

test('the outside check through the host carries the install\'s own Host header (its proxy answers nothing else)', async () => {
  const { createServer } = await import('node:http')
  const { throughHost } = await import('../src/updater/run.mjs')
  const server = createServer((req, res) => {
    if (req.headers.host !== 'localhost:7070') { res.writeHead(421).end(); return }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const outside = `http://127.0.0.1:${server.address().port}`
  try {
    const plain = await fetch(`${outside}/readyz`)
    assert.equal(plain.status, 421, 'without the header the proxy refuses')
    const response = await throughHost(fetch, outside, 'http://localhost:7070')(`${outside}/readyz`, { signal: AbortSignal.timeout(5000) })
    assert.equal(response.ok, true)
    assert.deepEqual(await response.json(), { ok: true })
    let other = null
    await throughHost(async url => { other = url; return { ok: true } }, outside, 'http://localhost:7070')('https://acme.slatebox.team/readyz')
    assert.equal(other, 'https://acme.slatebox.team/readyz', 'any other address goes through the normal fetch')
  } finally {
    server.close()
  }
})
