// Release signatures and the signed feed: canonical JSON, good / tampered / unknown-key signatures,
// keys added (never swapped), replayed and expired feeds, withdrawn versions, digests, chains.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { canonicalJson, RELEASE_KEYS, signDocument, trustedKeys, verifyDocument } from '../src/updater/verify.mjs'
import { checkManifest, imageRefFor, manifestUrl, readFeed, resolveTarget, upgradeChain } from '../src/updater/feed.mjs'
import { FakeGitHub, FEED_URL, manifest, testKey } from './updater-kit.mjs'

const key = testKey('test-key-1')
const sign = doc => signDocument(doc, { keyId: key.id, privateKeyPem: key.privateKeyPem })

test('canonical JSON: sorted keys at every level, no spaces; undefined left out; NaN refused', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' }, u: undefined }), '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}')
  assert.throws(() => canonicalJson({ a: Number.NaN }), /NaN/)
})

test('a good signature verifies; a changed byte, another key or a non-canonical spelling does not', () => {
  const doc = manifest('2.1.0')
  const text = canonicalJson(doc)
  const sig = sign(doc)
  assert.match(sig, /^sbrel1\.test-key-1\.[A-Za-z0-9_-]{86}$/)
  assert.deepEqual(verifyDocument(text, sig, { keys: key.keys }).document, doc)
  assert.throws(() => verifyDocument(text.replace('2.1.0', '2.1.9'), sig, { keys: key.keys }), err => err.code === 'bad-signature')
  assert.throws(() => verifyDocument(text, sig, { keys: testKey('test-key-1').keys }), err => err.code === 'bad-signature', 'same id, another key')
  assert.throws(() => verifyDocument(text, sig, { keys: testKey('other-key').keys }), err => err.code === 'unknown-key')
  assert.throws(() => verifyDocument(JSON.stringify(doc, null, 2), sig, { keys: key.keys }), err => err.code === 'not-canonical')
  assert.throws(() => verifyDocument(text, 'sbrel1.x.y', { keys: key.keys }), err => err.code === 'malformed')
  assert.throws(() => verifyDocument(text, sig, { keys: {} }), err => err.code === 'no-keys')
})

test('keys are added, never swapped: a document signed with the old key still verifies beside a new one', () => {
  const next = testKey('test-key-2')
  const doc = manifest('2.1.0')
  const both = { ...key.keys, ...next.keys }
  assert.ok(verifyDocument(canonicalJson(doc), sign(doc), { keys: both }))
  assert.ok(verifyDocument(canonicalJson(doc), signDocument(doc, { keyId: next.id, privateKeyPem: next.privateKeyPem }), { keys: both }))
})

test('the production key list is public halves only, and test keys come only from a test build\'s folder', () => {
  for (const spki of Object.values(RELEASE_KEYS)) assert.match(spki, /^[A-Za-z0-9+/=]+$/)
  const dir = mkdtempSync(join(tmpdir(), 'sbx-keys-'))
  assert.deepEqual(trustedKeys({ keys: {}, dir: join(dir, 'missing') }), {})
  mkdirSync(join(dir, 'd'))
  writeFileSync(join(dir, 'd', 'test.json'), JSON.stringify(key.keys))
  writeFileSync(join(dir, 'd', 'broken.json'), '{')
  assert.deepEqual(trustedKeys({ keys: { prod: 'AAAA' }, dir: join(dir, 'd') }), { prod: 'AAAA', ...key.keys })
  // A test file cannot replace a production key under the same id.
  writeFileSync(join(dir, 'd', 'z.json'), JSON.stringify({ prod: 'BBBB' }))
  assert.equal(trustedKeys({ keys: { prod: 'AAAA' }, dir: join(dir, 'd') }).prod, 'AAAA')
})

test('the feed: verified, its manifests verified and matched by sha256; a replayed (older) feed is refused', async () => {
  const gh = new FakeGitHub(key)
  gh.release('2.1.0')
  gh.release('2.2.0-rc.1')
  gh.publishFeed({ stable: '2.1.0', preview: '2.2.0-rc.1', sequence: 7 })
  const result = await readFeed({ get: gh.get, keys: key.keys, now: Date.parse('2026-11-25T00:00:00Z') })
  assert.equal(result.sequence, 7)
  assert.equal(result.expired, false)
  assert.deepEqual(Object.keys(result.manifests).sort(), ['2.1.0', '2.2.0-rc.1'])
  await assert.rejects(readFeed({ get: gh.get, keys: key.keys, lastSequence: 8 }), err => err.code === 'replay')
  // A manifest swapped after the feed was signed: its hash no longer matches.
  gh.release('2.1.0', { notes: 'changed' })
  await assert.rejects(readFeed({ get: gh.get, keys: key.keys }), err => err.code === 'manifest-hash')
})

test('an expired feed is read but marked expired; a feed signed by an unknown key is refused', async () => {
  const gh = new FakeGitHub(key)
  gh.release('2.1.0')
  gh.publishFeed({ stable: '2.1.0', expiresAt: '2026-01-01T00:00:00.000Z' })
  assert.equal((await readFeed({ get: gh.get, keys: key.keys, now: Date.parse('2026-11-25T00:00:00Z') })).expired, true)
  await assert.rejects(readFeed({ get: gh.get, keys: testKey('stranger').keys }), err => err.code === 'signature-unknown-key')
  gh.offline = true
  await assert.rejects(readFeed({ get: gh.get, keys: key.keys }), err => err.code === 'offline')
})

test('manifests: shape checked; the image is pulled by its index digest', () => {
  const good = manifest('2.1.0')
  assert.equal(checkManifest(good), good)
  assert.equal(imageRefFor(good), `localhost:5055/slatebox@${good.image.index}`)
  assert.throws(() => checkManifest({ ...good, product: 'other' }), /not for a self-hosted/)
  assert.throws(() => checkManifest({ ...good, image: { ...good.image, index: 'latest' } }), /no image digest/)
  assert.throws(() => checkManifest({ ...good, tag: 'v9.9.9' }), /another tag/)
  assert.throws(() => checkManifest(good, { version: '2.1.1' }), /not 2\.1\.1/)
  assert.equal(manifestUrl(FEED_URL, '2.1.0'), 'https://github.com/Slatebox/slatebox/releases/download/v2.1.0/release-manifest.json')
})

test('minUpgradeFrom: an install too old for the newest release goes through the versions in between', async () => {
  const gh = new FakeGitHub(key)
  gh.release('2.1.0', { minUpgradeFrom: '2.0.0' })
  gh.release('3.0.0', { minUpgradeFrom: '2.1.0', major: true })
  gh.publishFeed({ stable: '3.0.0' })
  const feedResult = await readFeed({ get: gh.get, keys: key.keys })
  const getManifest = async version => checkManifest(verifyDocument((await gh.get(manifestUrl(FEED_URL, version))).bytes, (await gh.get(`${manifestUrl(FEED_URL, version)}.sig`)).bytes.toString(), { keys: key.keys }).document)
  const chain = await upgradeChain({ current: '2.0.4', target: '3.0.0', getManifest, manifests: feedResult.manifests })
  assert.deepEqual(chain.map(item => item.version), ['2.1.0', '3.0.0'])
  // The app asked for 3.0.0: the first step (2.1.0) is applied now; a major needs approval.
  await assert.rejects(resolveTarget({ current: '2.0.4', requested: '3.0.0', feedResult, getManifest }), err => err.code === 'needs-approval')
  const step = await resolveTarget({ current: '2.0.4', requested: '2.1.0', feedResult, getManifest })
  assert.equal(step.manifest.version, '2.1.0')
})

test('the host refuses what the signed feed does not name, a downgrade and a withdrawn version', async () => {
  const gh = new FakeGitHub(key)
  gh.release('2.1.0')
  gh.publishFeed({ stable: '2.1.0', yanked: [{ version: '2.1.0', reason: 'broke uploads' }] })
  const feedResult = await readFeed({ get: gh.get, keys: key.keys })
  const getManifest = async () => { throw new Error('not needed') }
  await assert.rejects(resolveTarget({ current: '2.0.0', requested: '2.1.0', feedResult, getManifest }), err => err.code === 'yanked')
  await assert.rejects(resolveTarget({ current: '2.0.0', requested: '6.6.6', feedResult, getManifest }), err => err.code === 'not-signed')
  await assert.rejects(resolveTarget({ current: '2.2.0', requested: '2.1.0', feedResult, getManifest }), err => ['not-signed', 'downgrade'].includes(err.code))
})
