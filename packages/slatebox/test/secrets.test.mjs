import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { envFileText, generateKek, parseEnvFile, Redactor, resolveRef } from '../src/secrets.mjs'

test('the key encryption key is 32 random bytes in standard base64', () => {
  const a = generateKek(), b = generateKek()
  assert.notEqual(a, b)
  assert.equal(Buffer.from(a, 'base64').length, 32)
  assert.match(a, /^[A-Za-z0-9+/]{43}=$/)
})

test('references resolve from the environment, a file or a prompt, never from a literal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sbx-ref-'))
  writeFileSync(join(dir, 'key'), 'from-file\n')
  assert.equal(await resolveRef('env:K', { env: { K: 'from-env' } }), 'from-env')
  assert.equal(await resolveRef(`file:${join(dir, 'key')}`, { env: {} }), 'from-file')
  assert.equal(await resolveRef('prompt', { env: {}, ask: async () => 'typed' }), 'typed')
  assert.equal(await resolveRef('none', { env: {} }), undefined)
  assert.equal(await resolveRef('env:MISSING', { env: {} }), undefined)
  assert.equal(await resolveRef('prompt', { env: {} }), undefined, 'no prompt without a person')
  await assert.rejects(resolveRef('sk-literal', { env: {} }), /reference/)
})

test('env files round-trip values compose reads literally, and refuse what compose would change', () => {
  const values = { A: 'plain', B: 'has space', C: '{"json":["x"]}', D: 'smtp://u:p%40ss@mail:587', E: 'dollar$sign', F: 'abc+/==' }
  const text = envFileText(values)
  assert.deepEqual(parseEnvFile(text), values)
  assert.match(text, /^E='dollar\$sign'$/m, 'single quotes: compose does not interpolate')
  assert.throws(() => envFileText({ G: "it's" }), /G/)
  assert.throws(() => envFileText({ H: 'two\nlines' }), /H/)
})

test('the redactor removes every secret from any text, fuzzed with random values', () => {
  for (let round = 0; round < 300; round++) {
    const redactor = new Redactor()
    const secrets = Array.from({ length: 1 + (round % 4) }, (_, i) =>
      i % 2 ? randomBytes(8 + (round % 40)).toString('base64') : randomBytes(6 + (round % 30)).toString('base64url'))
    for (const value of secrets) redactor.add(value)
    const text = `start ${secrets.join(' mid ')} ${JSON.stringify({ secrets })} ${secrets.map(value => encodeURIComponent(value)).join(',')} end`
    const clean = redactor.redact(text)
    for (const value of secrets) {
      assert.ok(!clean.includes(value), `round ${round}: a secret survived`)
      assert.ok(!clean.includes(encodeURIComponent(value)), `round ${round}: a URL-encoded secret survived`)
    }
    assert.match(clean, /^start /)
  }
})

test('short or empty values are never registered as secrets (they would blank ordinary text)', () => {
  const redactor = new Redactor()
  redactor.add('')
  redactor.add('abc')
  assert.equal(redactor.redact('abc def'), 'abc def')
})
