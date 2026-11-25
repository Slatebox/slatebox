import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loadMasterKey, seal, open, last4, keyDocument, describeKey } from '../web/app/server/metering/vault.mjs'

const env = { SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') }
const master = loadMasterKey(env)
const owner = { ownerType: 'user', ownerId: 'p1', provider: 'deepinfra' }
const secret = 'di-0123456789abcdef4f2a'

test('round trip', () => {
  const cipher = seal({ master, owner, plaintext: secret })
  assert.equal(cipher.v, 1)
  assert.equal(cipher.keyId, master.keyId)
  assert.equal(Buffer.from(cipher.iv, 'base64').length, 12)
  assert.equal(open({ master, owner, cipher }), secret)
})

test('a tampered cipher fails', () => {
  const cipher = seal({ master, owner, plaintext: secret })
  const data = Buffer.from(cipher.data, 'base64'); data[0] ^= 1
  assert.throws(() => open({ master, owner, cipher: { ...cipher, data: data.toString('base64') } }))
  const tag = Buffer.from(cipher.tag, 'base64'); tag[0] ^= 1
  assert.throws(() => open({ master, owner, cipher: { ...cipher, tag: tag.toString('base64') } }))
})

test('a key copied to another owner or provider fails to decrypt', () => {
  const cipher = seal({ master, owner, plaintext: secret })
  assert.throws(() => open({ master, owner: { ...owner, ownerId: 'p2' }, cipher }))
  assert.throws(() => open({ master, owner: { ...owner, ownerType: 'org' }, cipher }))
  assert.throws(() => open({ master, owner: { ...owner, provider: 'daily' }, cipher }))
})

test('a different master key fails', () => {
  const other = loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
  assert.throws(() => open({ master: other, owner, cipher: seal({ master, owner, plaintext: secret }) }), /rotated|key/i)
})

test('the stored document has no plaintext and only the last four characters', () => {
  const doc = keyDocument({ master, owner, plaintext: secret, now: 5 })
  assert.equal(doc.last4, '4f2a')
  assert.equal(last4('ab'), 'ab')
  assert.doesNotMatch(JSON.stringify(doc), new RegExp(secret))
  assert.doesNotMatch(JSON.stringify(doc), /0123456789abcdef/)
  assert.deepEqual(describeKey(doc), { provider: 'deepinfra', label: 'DeepInfra key ending 4f2a', lastError: null })
  assert.equal('cipher' in describeKey(doc), false)
  const compat = keyDocument({ master, owner: { ...owner, provider: 'openai-compatible' }, plaintext: '', baseUrl: 'https://llm.example.test/v1', model: 'm', now: 5 })
  assert.equal(describeKey(compat).label, 'Your model at llm.example.test')
})

test('without a master key the section is hidden and saving is refused', () => {
  assert.equal(loadMasterKey({}), null)
  assert.equal(loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }), null, 'a short key is not a key')
  assert.throws(() => seal({ master: null, owner, plaintext: secret }), { message: 'Own keys are not available on this server.' })
})

test('no method or publication returns the cipher', () => {
  const glue = readFileSync(new URL('../web/app/server/metering/meteor.js', import.meta.url), 'utf8')
  // ProviderKeys is never published, and every read projects the cipher away
  assert.doesNotMatch(glue, /Meteor\.publish\([^)]*ProviderKeys/)
  for (const match of glue.matchAll(/ProviderKeys\.(find|findOneAsync)\(([^)]*)\)/g)) {
    if (!/vault-read/.test(match[2])) assert.match(match[2], /cipher: 0/, match[0])
  }
  const publications = readFileSync(new URL('../web/app/server/publications.js', import.meta.url), 'utf8')
  assert.doesNotMatch(publications, /ProviderKeys/)
})

// ---------- the server's provider keys: rotated with no grace, never returned ----------
test('a rotated server key: the new one is sealed, the old one is revoked at once (no grace), and no view returns either', async () => {
  const { aiControlWorld, fakeMaster } = await import('./ai-control-kit.mjs')
  const w = await aiControlWorld()
  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'openai' }, models: ['gpt-4o-mini'] })
  const oldKey = 'sk-old-0000000000000000aaaa'
  const newKey = 'sk-new-1111111111111111bbbb'
  const first = await w.keyStore.add({ actor: w.actor, provider: 'openai', apiKey: oldKey })
  const out = await w.keyStore.rotate({ actor: w.actor, provider: 'openai', apiKey: newKey })
  const doc = w.keys.rows.find((d) => d._id === out.key.id)
  // the cipher opens with the AAD of this owner and provider; it is not the plaintext
  assert.equal(open({ master: fakeMaster(), owner: { ownerType: 'server', ownerId: 'server', provider: 'openai' }, cipher: doc.cipher }), newKey)
  assert.equal(w.keys.rows.find((d) => d._id === first.id).cipher, undefined, 'the old key is wiped at once')
  assert.ok(!JSON.stringify(w.keys.rows).includes(oldKey) && !JSON.stringify(w.keys.rows).includes(newKey))
  const chosen = await w.aiSettings.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.equal(chosen.connection, null, 'the default model is Meta\'s: OpenAI\'s key does not answer it')
  for (const view of [await w.keyStore.list(), w.control.get(), await w.aiSettings.view('admin1')]) {
    const text = JSON.stringify(view)
    assert.ok(!text.includes(oldKey) && !text.includes(newKey) && !text.includes(doc.cipher.data))
  }
})

test('the AI control snapshot reads which provider has a key without any cipher', () => {
  const keys = readFileSync(new URL('../web/app/server/ai-control/keys.mjs', import.meta.url), 'utf8')
  assert.match(keys, /async function activeSummary\(\) \{\n\s+const docs = await keys\.find\(\{ \.\.\.KEY_FILTER, status: 'active' \}, \{ projection: \{ cipher: 0 \} \}\)/)
  assert.match(keys, /async function list\(\{ provider = null \} = \{\}\) \{\n\s+const docs = await keys\.find\(\{ \.\.\.KEY_FILTER, \.\.\.\(provider && \{ provider \}\) \}, \{ projection: \{ cipher: 0 \} \}\)/)
})
