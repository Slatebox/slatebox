// The key-encryption key on a self-hosted Slatebox (lib/common.mjs ensureKeyEncryptionKey): every
// AI key an administrator saves in Admin → AI control is sealed with it, so a server must never
// start without one. SLATEBOX_KEY_ENCRYPTION_KEY wins; without it the image makes one on first
// boot, keeps it in /data/secrets and reads it back on every later start, never replacing it.
// Runs on the host against a temporary folder: no image needed, and no key is ever printed.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { KEY_ENCRYPTION_KEY_FILE, Plain, ensureKeyEncryptionKey, isKeyEncryptionKey } from '../rootfs/opt/slatebox/lib/common.mjs'

const folder = () => mkdtempSync(join(tmpdir(), 'slatebox-kek-'))

test('the key lives in the data volume\'s secrets folder', () => {
  assert.equal(KEY_ENCRYPTION_KEY_FILE, '/data/secrets/key-encryption.key')
})

test('first boot without SLATEBOX_KEY_ENCRYPTION_KEY makes a 32-byte key, readable only by Slatebox; later boots keep it', () => {
  const dir = folder()
  try {
    const file = join(dir, 'secrets', 'key-encryption.key')
    const first = ensureKeyEncryptionKey({ file })
    assert.equal(first.source, 'generated')
    assert.ok(isKeyEncryptionKey(first.value))
    assert.equal(Buffer.from(first.value, 'base64').length, 32)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.equal(readFileSync(file, 'utf8').trim(), first.value)
    for (let boot = 0; boot < 3; boot += 1) {
      const again = ensureKeyEncryptionKey({ file })
      assert.deepEqual(again, { value: first.value, source: 'kept' }, 'never regenerated')
    }
    // two installations never share a key
    const other = ensureKeyEncryptionKey({ file: join(dir, 'other', 'key-encryption.key') })
    assert.notEqual(other.value, first.value)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SLATEBOX_KEY_ENCRYPTION_KEY wins and nothing is written; a kept key is left as it is', () => {
  const dir = folder()
  try {
    const file = join(dir, 'secrets', 'key-encryption.key')
    const given = randomBytes(32).toString('base64')
    assert.deepEqual(ensureKeyEncryptionKey({ given, file }), { value: given, source: 'setting' })
    assert.equal(existsSync(file), false)
    const kept = ensureKeyEncryptionKey({ file }).value
    assert.equal(ensureKeyEncryptionKey({ given, file }).value, given)
    assert.equal(readFileSync(file, 'utf8').trim(), kept, 'the setting does not overwrite the kept key')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a kept key that cannot be read stops the start, is not replaced and is not printed', () => {
  const dir = folder()
  try {
    const file = join(dir, 'key-encryption.key')
    for (const broken of ['', 'not a key', randomBytes(16).toString('base64'), randomBytes(32).toString('hex')]) {
      writeFileSync(file, broken)
      assert.throws(() => ensureKeyEncryptionKey({ file }), (error) => {
        assert.ok(error instanceof Plain, 'an operator message, no stack trace')
        assert.match(error.message, /does not hold a key-encryption key/)
        if (broken.length > 4) assert.ok(!error.message.includes(broken), 'the file\'s contents are not printed')
        return true
      })
      assert.equal(readFileSync(file, 'utf8'), broken, 'the file is left for the operator')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('configure hands the key to the app through app.env alone and never logs it', () => {
  const source = readFileSync(new URL('../rootfs/opt/slatebox/lib/configure.mjs', import.meta.url), 'utf8')
  // after every setting is checked (nothing is written for a refused start), before app.env
  const checked = source.indexOf('const ownKeysKey = keyEncryptionKey()')
  const made = source.indexOf('const kek = ensureKeyEncryptionKey({ given: ownKeysKey })')
  const written = source.indexOf("writePrivate(join(RUN, 'app.env')")
  assert.ok(checked > 0 && made > checked && written > made)
  assert.match(source, /SLATEBOX_KEY_ENCRYPTION_KEY: kek\.value,/)
  assert.doesNotMatch(source, /say\([^\n]*kek\.value/)
  assert.doesNotMatch(source, /METEOR_SETTINGS[^\n]*kek/)
})
