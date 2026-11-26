// One copy of the update logic: the app's server/updates/{verify,policy,feed,store}.mjs are
// byte-identical to the installer's (which the image carries for the host updater and for
// `slatebox updates` in the container), so the app, the container and the host updater read one
// record, one decision and one signature check.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = path => readFileSync(`${root}${path}`, 'utf8')

for (const file of ['verify.mjs', 'policy.mjs', 'feed.mjs', 'store.mjs']) {
  test(`server/updates/${file} is the installer's src/updater/${file}, byte for byte`, () => {
    assert.equal(read(`web/app/server/updates/${file}`), read(`packages/slatebox/src/updater/${file}`))
  })
}

test('the container\'s slatebox updates loads the installer\'s copy from the image (/opt/slatebox/installer)', () => {
  const lib = read('self-host/rootfs/opt/slatebox/lib/updates.mjs')
  assert.match(lib, /join\(HOME, 'installer'\)/)
  assert.match(lib, /load\('store\.mjs'\)/)
  assert.match(lib, /load\('policy\.mjs'\)/)
  assert.match(lib, /load\('feed\.mjs'\)/)
  const dockerfile = read('self-host/Dockerfile')
  assert.match(dockerfile, /COPY installer\/ \/opt\/slatebox\/installer\//, 'the image carries the installer')
})

test('the release keys are public halves only, and the production list is the same in every copy', () => {
  const text = read('packages/slatebox/src/updater/verify.mjs')
  assert.doesNotMatch(text, /PRIVATE KEY/)
  assert.match(text, /export const RELEASE_KEYS = Object\.freeze\(/)
})
