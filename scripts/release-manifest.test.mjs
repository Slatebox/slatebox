// scripts/release-manifest.mjs: a manifest the updater accepts, signed and verified with a test key;
// the feed's sequence only goes up, its expiry moves, withdrawals stay; keys are generated once.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { buildFeed, buildManifest, main, sha256 } from './release-manifest.mjs'
import { canonicalJson, verifyDocument } from '../packages/slatebox/src/updater/verify.mjs'
import { readFeed } from '../packages/slatebox/src/updater/feed.mjs'
import { testKey } from '../packages/slatebox/test/updater-kit.mjs'

const d = tag => `sha256:${tag.repeat(64).slice(0, 64)}`
const platforms = { 'linux/arm64': d('b'), 'linux/amd64': d('a') }
const run = async (args, env = {}) => {
  const out = new PassThrough()
  let text = ''
  out.on('data', c => { text += c })
  const code = await main(args, { env, out })
  return { code, text }
}

test('a manifest: both platforms, the tag, sources, notes trimmed to 8 KB, major from the previous stable', () => {
  const m = buildManifest({ version: '3.0.0', index: d('c'), platforms, commit: 'f'.repeat(40), sources: { engine: 'e'.repeat(40), relay: 'r'.repeat(40) }, notes: 'x'.repeat(20_000), previousStable: '2.4.1', releasedAt: '2026-11-25T00:00:00.000Z' })
  assert.equal(m.tag, 'v3.0.0')
  assert.equal(m.channel, 'stable')
  assert.equal(m.major, true)
  assert.deepEqual(Object.keys(m.image.platforms), ['linux/amd64', 'linux/arm64'])
  assert.ok(Buffer.byteLength(m.notes) <= 8 * 1024)
  assert.equal(buildManifest({ version: '2.5.0-rc.1', index: d('c'), platforms, previousStable: '2.4.1' }).channel, 'preview')
  assert.throws(() => buildManifest({ version: '2.5.0', index: d('c'), platforms: { 'linux/amd64': d('a') } }), /both needed/)
  assert.throws(() => buildManifest({ version: 'two', index: d('c'), platforms }), /not X\.Y\.Z/)
})

test('the feed: sequence + 1 each time, a new expiry, channels kept, withdrawals added once, an old preview dropped', () => {
  const now = Date.parse('2026-11-25T00:00:00Z')
  const base = 'https://github.com/Slatebox/slatebox/releases/download'
  const first = buildFeed({ base, stable: { version: '2.1.0', sha256: '1'.repeat(64) }, preview: { version: '2.2.0-rc.1', sha256: '2'.repeat(64) }, now })
  assert.equal(first.sequence, 1)
  assert.equal(first.stable.manifest, `${base}/v2.1.0/release-manifest.json`)
  assert.equal(first.expiresAt, '2026-12-25T00:00:00.000Z')
  const refreshed = buildFeed({ previous: first, base, now: now + 86_400_000 })
  assert.equal(refreshed.sequence, 2)
  assert.equal(refreshed.stable.version, '2.1.0')
  assert.equal(refreshed.expiresAt, '2026-12-26T00:00:00.000Z')
  const yanked = buildFeed({ previous: refreshed, base, yank: [{ version: '2.1.0', reason: 'broke uploads' }, { version: '2.1.0', reason: 'again' }], now })
  assert.deepEqual(yanked.yanked, [{ version: '2.1.0', reason: 'broke uploads' }])
  const newer = buildFeed({ previous: yanked, base, stable: { version: '2.2.0', sha256: '3'.repeat(64) }, now })
  assert.equal(newer.preview, undefined, 'a preview older than stable offers nothing more')
  // An older tag never replaces a newer stable (a late or re-run release job).
  assert.throws(() => buildFeed({ previous: newer, base, stable: { version: '2.1.5', sha256: '4'.repeat(64) }, now }), /2\.1\.5 is older than the feed's stable 2\.2\.0/)
  assert.equal(buildFeed({ previous: newer, base, stable: { version: '2.2.0', sha256: '3'.repeat(64) }, now }).stable.version, '2.2.0', 'the same one again is fine')
})

test('keygen, build, sign, verify, feed: end to end with a test key; the updater reads what it wrote', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sbx-rel-'))
  const gen = await run(['keygen', '--id', 'test-rel-1', '--out', dir])
  assert.equal(gen.code, 0)
  assert.equal(statSync(join(dir, 'test-rel-1.pem')).mode & 0o777, 0o600)
  const spki = /'test-rel-1': '([^']+)'/.exec(gen.text)[1]
  await assert.rejects(run(['keygen', '--id', 'test-rel-1', '--out', dir]), /never overwritten/)
  const env = { SLATEBOX_RELEASE_KEY: readFileSync(join(dir, 'test-rel-1.pem'), 'utf8'), SLATEBOX_RELEASE_KEY_ID: 'test-rel-1' }
  const manifestFile = join(dir, 'release-manifest.json')
  writeFileSync(join(dir, 'notes.md'), '## 2.1.0\n- better\n')
  assert.equal((await run(['build', '--version', '2.1.0', '--index', d('c'), '--platform', `linux/amd64=${d('a')}`, '--platform', `linux/arm64=${d('b')}`, '--notes-file', join(dir, 'notes.md'), '--out', manifestFile])).code, 0)
  assert.equal((await run(['sign', manifestFile], env)).code, 0)
  const keys = { 'test-rel-1': spki }
  writeFileSync(join(dir, 'keys.json'), JSON.stringify(keys))
  assert.match((await run(['verify', manifestFile, '--keys', join(dir, 'keys.json')])).text, /good signature/)
  const feedFile = join(dir, 'channels.json')
  assert.equal((await run(['feed', '--base', 'https://github.com/Slatebox/slatebox/releases/download', '--stable', '2.1.0', '--stable-manifest', manifestFile, '--out', feedFile])).code, 0)
  assert.equal((await run(['sign', feedFile], env)).code, 0)
  const files = new Map([
    ['https://github.com/Slatebox/slatebox/releases/download/update-feed/channels.json', feedFile],
    ['https://github.com/Slatebox/slatebox/releases/download/v2.1.0/release-manifest.json', manifestFile],
  ])
  const get = async url => ({ bytes: readFileSync(url.endsWith('.sig') ? `${files.get(url.slice(0, -4))}.sig` : files.get(url)) })
  const result = await readFeed({ get, keys })
  assert.equal(result.manifests['2.1.0'].image.index, d('c'))
  assert.equal(JSON.parse(readFileSync(feedFile, 'utf8')).stable.sha256, sha256(readFileSync(manifestFile)))
  // check-keys: a test key is not a production key.
  await assert.rejects(run(['check-keys'], env), /not in RELEASE_KEYS/)
})

test('sign refuses a file that is not canonical JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sbx-rel-'))
  const key = testKey('test-rel-2')
  writeFileSync(join(dir, 'x.json'), JSON.stringify({ b: 1, a: 2 }, null, 2))
  await assert.rejects(run(['sign', join(dir, 'x.json')], { SLATEBOX_RELEASE_KEY: key.privateKeyPem, SLATEBOX_RELEASE_KEY_ID: key.id }), /not canonical/)
  writeFileSync(join(dir, 'y.json'), canonicalJson({ b: 1, a: 2 }))
  await run(['sign', join(dir, 'y.json')], { SLATEBOX_RELEASE_KEY: key.privateKeyPem, SLATEBOX_RELEASE_KEY_ID: key.id })
  assert.ok(verifyDocument(readFileSync(join(dir, 'y.json')), readFileSync(join(dir, 'y.json.sig'), 'utf8'), { keys: key.keys }))
})
