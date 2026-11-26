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

async function installed({ broken = [] } = {}) {
  const docker = new FakeDocker({ broken })
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
  // The container's `slatebox updates report`: recorded here; `failReports` makes Slatebox unreachable.
  const run = async (cmd, args, options) => {
    if (cmd === 'docker' && args[0] === 'exec' && args.includes('updates') && args.includes('report')) {
      if (run.failReports) return { code: 1, stdout: '', stderr: 'Error: No such container' }
      const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
      reports.push({ phase: flag('--phase'), attempt: flag('--attempt'), version: flag('--version'), detail: flag('--detail') })
      return { code: 0, stdout: '{"ok":true}\n', stderr: '' }
    }
    return docker.run(cmd, args, options)
  }
  return { docker, home, gh, reports, run, dir: join(home, 'installs', 'slatebox') }
}

const decision = (extra = {}) => ({ action: 'apply', attemptId: 'att-1', target: { version: '2.1.0' }, current: '2.0.0', channel: 'stable', approved: false, ...extra })
const go = (world, extra = {}) => runUpdater({ name: 'slatebox', dir: world.dir, decision: decision(extra.decision), run: world.run, get: world.gh.get, keys: key.keys, fetch: okFetch, healthTimeout: 2, healthPoll: 1, log: () => {}, ...extra.options })

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
  const back = await go(world, { decision: { action: 'rollback', attemptId: 'att-2', target: null, current: '2.1.0' } })
  assert.equal(back.outcome, 'healthy', back.detail)
  assert.equal(world.docker.containers.get('slatebox').image, ID(IMAGE))
  const restores = world.docker.calls.filter(call => call.args.includes('restore'))
  assert.equal(restores.length, 1, 'the pre-upgrade backup was restored once')
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
