// A published `slatebox` installs one image, by digest, on every target. While the image is not
// published the pin is the moving tag and these checks only hold the shape; `npm publish` runs
// them with SLATEBOX_PUBLISH=1 (prepublishOnly), or NODE_ENV=production, and then they insist.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_IMAGE, DEFAULT_REPOSITORY, PINNED_DIGEST, PINNED_TAG } from '../src/image.mjs'
import { clusterImage } from '../src/targets/k8s.mjs'
import { readFileSync } from 'node:fs'

const publishing = process.env.SLATEBOX_PUBLISH === '1' || process.env.NODE_ENV === 'production' ||
  process.env.npm_lifecycle_event === 'prepublishOnly' || process.env.npm_lifecycle_event === 'prepack'
const DIGEST = /^sha256:[a-f0-9]{64}$/

test('the pin: a digest with a release tag, or (unpublished only) the moving tag with no digest', () => {
  if (PINNED_DIGEST === null) assert.equal(DEFAULT_IMAGE, `${DEFAULT_REPOSITORY}:${PINNED_TAG}`)
  else {
    assert.match(PINNED_DIGEST, DIGEST)
    assert.equal(DEFAULT_IMAGE, `${DEFAULT_REPOSITORY}@${PINNED_DIGEST}`)
    assert.notEqual(PINNED_TAG, 'latest', 'a pinned release names its version tag')
  }
})

test('publishing: PINNED_DIGEST is sha256:<64 hex> and PINNED_TAG is a version, not latest', { skip: !publishing && 'not publishing (SLATEBOX_PUBLISH=1 runs it)' }, () => {
  assert.match(String(PINNED_DIGEST), DIGEST, 'set PINNED_DIGEST in src/image.mjs to the published index digest')
  assert.match(PINNED_TAG, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'set PINNED_TAG to the image version')
})

test('Kubernetes runs the default image by its digest, without asking this computer', async () => {
  const ctx = { run: async () => { throw new Error('nothing is run for a digest') } }
  const digestRef = `${DEFAULT_REPOSITORY}@sha256:${'a'.repeat(64)}`
  assert.deepEqual(await clusterImage(ctx, digestRef), { ref: digestRef, pinned: digestRef, local: false })
  if (PINNED_DIGEST) assert.equal((await clusterImage(ctx, undefined)).pinned, DEFAULT_IMAGE)
})

// Restated (one command, 0.2.0): slatebox-mcp is a dependency now, run in process, instead of
// an npx fetch at first use. The same claim, in its new place: one exact version, never a range,
// and the version of the slatebox-mcp in this repository.
test('the slate commands come from one exact slatebox-mcp version, never a range fetched unasked', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const mcp = JSON.parse(readFileSync(new URL('../../slatebox-mcp/package.json', import.meta.url), 'utf8'))
  assert.match(manifest.dependencies['slatebox-mcp'], /^\d+\.\d+\.\d+$/)
  assert.equal(manifest.dependencies['slatebox-mcp'], mcp.version)
  // Restated (0.3.0, the wizard in the terminal): one other dependency, @clack/core (key handling
  // only), checked exactly in the next test.
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['@clack/core', 'slatebox-mcp'], 'the installer has no other dependency')
})

// 0.3.0: the wizard's key handling is @clack/core at one exact version, never a range. Its look is
// Slatebox's own, so @clack/prompts (a fixed look) and Ink (a 25 MB tree) are not dependencies.
test('the wizard depends on @clack/core 1.6.0 exactly, and never on @clack/prompts or ink', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const all = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies, ...manifest.devDependencies }
  assert.equal(manifest.dependencies['@clack/core'], '1.6.0')
  assert.equal(all['@clack/prompts'], undefined)
  assert.equal(all.ink, undefined)
  const create = JSON.parse(readFileSync(new URL('../../create-slatebox/package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.version, '0.3.0')
  assert.equal(create.dependencies.slatebox, '0.3.0')
})
