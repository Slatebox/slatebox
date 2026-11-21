// The start-up step on its own: this checkout's configure.mjs, run inside the
// image under test with nothing else started, so a setting can be checked in
// seconds. The data and run folders are fresh for every case and vanish with it.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { IMAGE, ok } from './lib.mjs'

const LIB = fileURLToPath(new URL('../rootfs/opt/slatebox/lib', import.meta.url))
const SEP = '\u001e'

/**
 * Run configure.mjs with these settings. Returns its exit code, everything it
 * printed (the container log), the app's environment as the app reads it (from
 * app.env alone, nothing inherited), and the files it left in /data/secrets.
 */
async function configure(env) {
  const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`])
  const script = [
    'node /opt/slatebox/lib/configure.mjs > /run/slatebox-test.log 2>&1; code=$?',
    `printf '%s${SEP}' "$code"`,
    `cat /run/slatebox-test.log; printf '${SEP}'`,
    // What the app process gets from app.env, with the container's own environment left out.
    `[ -f /run/slatebox/app.env ] && env -i sh -c 'set -a; . /run/slatebox/app.env; set +a; node -e "process.stdout.write(JSON.stringify({ key: process.env.SLATEBOX_KEY_ENCRYPTION_KEY ?? null, settings: process.env.METEOR_SETTINGS }))"'; printf '${SEP}'`,
    'ls -A /data/secrets 2>/dev/null | wc -l',
  ].join('; ')
  const out = await ok(['run', '--rm', '--network', 'none',
    '--tmpfs', '/data:mode=1777', '--tmpfs', '/run:mode=1777',
    '-v', `${LIB}:/opt/slatebox/lib:ro`, ...envArgs, '--entrypoint', 'sh', IMAGE, '-c', script])
  const [code, log, app, secretFiles] = out.split(SEP)
  return { code: Number(code), log, app: app ? JSON.parse(app) : null, secretFiles: Number(secretFiles.trim()) }
}

test('SLATEBOX_KEY_ENCRYPTION_KEY reaches the app through app.env and is never printed', async () => {
  const key = randomBytes(32).toString('base64') // what `openssl rand -base64 32` prints
  const run = await configure({ SLATEBOX_KEY_ENCRYPTION_KEY: key })
  assert.equal(run.code, 0, run.log)
  assert.equal(run.app.key, key)
  assert.equal(Buffer.from(run.app.key, 'base64').length, 32)
  assert.match(run.log, /Own keys: +on/)
  assert.ok(!run.log.includes(key), 'the key is not in the log')
  assert.ok(!run.app.settings.includes(key), 'the key is not in the app settings')
})

test('SLATEBOX_KEY_ENCRYPTION_KEY may be given in URL-safe base64 without padding', async () => {
  const key = randomBytes(32).toString('base64url')
  const run = await configure({ SLATEBOX_KEY_ENCRYPTION_KEY: key })
  assert.equal(run.code, 0, run.log)
  assert.equal(Buffer.from(run.app.key, 'base64').toString('hex'), Buffer.from(key, 'base64url').toString('hex'))
})

test('without SLATEBOX_KEY_ENCRYPTION_KEY the log says how to turn own keys on', async () => {
  const run = await configure({})
  assert.equal(run.code, 0, run.log)
  assert.equal(run.app.key, null)
  assert.match(run.log, /Own keys: +off \(set SLATEBOX_KEY_ENCRYPTION_KEY/)
})

test('a SLATEBOX_KEY_ENCRYPTION_KEY that is not 32 bytes of base64 stops the start without printing it', async () => {
  const cases = [
    randomBytes(16).toString('base64'), // too short
    randomBytes(32).toString('hex'), // openssl rand -hex 32: valid base64 characters, but 48 bytes
    `${randomBytes(32).toString('base64').slice(0, 40)}!@#$`, // not base64 at all
  ]
  for (const value of cases) {
    const run = await configure({ SLATEBOX_KEY_ENCRYPTION_KEY: value })
    assert.equal(run.code, 1, `${value} is refused`)
    assert.match(run.log, /SLATEBOX_KEY_ENCRYPTION_KEY must be 32 random bytes in base64, for example the output of openssl rand -base64 32/)
    assert.ok(!run.log.includes(value), 'the refused value is not printed')
    assert.doesNotMatch(run.log, /\n\s+at .*:\d+:\d+\)?/, 'no stack trace for an operator mistake')
    assert.equal(run.app, null, 'no app.env was written')
    assert.equal(run.secretFiles, 0, 'nothing was created before the mistake was reported')
  }
})
