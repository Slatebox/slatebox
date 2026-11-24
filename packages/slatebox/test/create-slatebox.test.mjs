// `npm create slatebox` (packages/create-slatebox) is a thin alias for `npx slatebox install`
// (round-2 review nit 10). It installs exactly the slatebox version released beside it, never a
// range, and its own publish runs slatebox's publish checks, so it cannot go out before the image
// is pinned (publish-pin.test.mjs).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const create = json('../../create-slatebox/package.json')
const slatebox = json('../package.json')

test('create-slatebox depends on the exact slatebox version released beside it', () => {
  assert.equal(create.dependencies.slatebox, slatebox.version)
  assert.match(create.dependencies.slatebox, /^\d+\.\d+\.\d+$/, 'an exact version, never a range')
})

test('publishing create-slatebox runs slatebox\'s publish checks (the image pin)', () => {
  assert.equal(create.scripts?.prepublishOnly, 'SLATEBOX_PUBLISH=1 npm test --prefix ../slatebox')
  assert.equal(slatebox.scripts.prepublishOnly, 'SLATEBOX_PUBLISH=1 npm test')
})

test('it runs slatebox install and nothing else', () => {
  const bin = readFileSync(new URL('../../create-slatebox/bin/create-slatebox.mjs', import.meta.url), 'utf8')
  assert.match(bin, /main\(\['install', \.\.\.process\.argv\.slice\(2\)\]\)/)
})
