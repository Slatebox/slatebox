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

// ---------- AI control S3: rotation grace and keys never returned (spec 6.2, 6.3) ----------
test('a rotated key: the new one is sealed, the old one opens only during its grace period, and no view returns either', async () => {
  const { createAISettings } = await import('../web/app/server/methods/ai/ai-settings-core.mjs')
  const docs = []
  const keyStore = {
    listConnections: async (o) => docs.filter((d) => d.ownerType === o.type && d.ownerId === o.id).map((d) => structuredClone(d)),
    saveConnection: async (o, doc) => {
      const i = docs.findIndex((d) => d.ownerType === o.type && d.ownerId === o.id && d.name === doc.name)
      const next = { ...(i >= 0 ? docs[i] : {}), ...structuredClone(doc), ownerType: o.type, ownerId: o.id }
      if (i >= 0) docs[i] = next
      else docs.push(next)
    },
    removeConnection: async () => {},
    getUse: async () => ({ use: { chat: 'server:oa' } }),
    setUse: async () => {},
  }
  let clock = Date.parse('2026-11-24T10:00:00Z')
  const ai = createAISettings({
    store: keyStore, master, settings: { public: { env: 'selfhost' } }, hosted: false, now: () => clock,
    loadUser: async (id) => ({ _id: id }), isAdmin: async (id) => id === 'root', isTeamAdmin: async () => false, check: async () => ({ ok: true }),
  })
  const oldKey = 'sk-old-0000000000000000aaaa'
  const newKey = 'sk-new-1111111111111111bbbb'
  await ai.saveServerConnections('root', [{ name: 'oa', type: 'openai', model: 'gpt-x', apiKey: oldKey }])
  await ai.saveServerConnections('root', [{ name: 'oa', type: 'openai', model: 'gpt-x', apiKey: newKey, rotate: { graceHours: 24 } }])
  const doc = docs.find((d) => d.name === 'oa')
  // both ciphers open with the AAD of this owner and provider; neither is the plaintext
  assert.equal(open({ master, owner: { ownerType: 'server', ownerId: 'server', provider: 'openai' }, cipher: doc.cipher }), newKey)
  assert.equal(open({ master, owner: { ownerType: 'server', ownerId: 'server', provider: 'openai' }, cipher: doc.previousCipher.cipher }), oldKey)
  assert.ok(!JSON.stringify(doc).includes(oldKey) && !JSON.stringify(doc).includes(newKey))
  let chosen = await ai.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.deepEqual([chosen.connection.apiKey, chosen.connection.previousApiKey], [newKey, oldKey])
  clock += 25 * 3600 * 1000
  chosen = await ai.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.equal(chosen.connection.previousApiKey, undefined)
  for (const view of [await ai.serverConnections('root'), await ai.view('root')]) {
    const text = JSON.stringify(view)
    assert.ok(!text.includes(oldKey) && !text.includes(newKey) && !text.includes(doc.cipher.data) && !text.includes(doc.previousCipher.cipher.data))
  }
})

test('the AI control snapshot reads the server\'s connections without their ciphers', () => {
  const glue = readFileSync(new URL('../web/app/server/ai-control/index.mjs', import.meta.url), 'utf8')
  assert.match(glue, /projection: \{ cipher: 0, previousCipher: 0 \}/)
})
