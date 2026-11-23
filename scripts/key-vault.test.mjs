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
