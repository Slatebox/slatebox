// The public README points at the one-container image (round-2 review findings 3 and 9):
// - it says the image is being published while it is not (the installer's PINNED_DIGEST is not a
//   digest yet, or the installer is absent), and stops saying so once the release pins it;
// - it carries the one payments sentence a self-hoster needs ("Slatebox Pro exists only on Slatebox
//   Cloud."), which scripts/selfhost-no-payments-docs.test.mjs asserts too.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const root = new URL('../../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const readme = read('self-host/README.md')
const BEING_PUBLISHED = /The image is being published at `ghcr\.io\/slatebox\/slatebox`\. Until it is/

function imagePinned() {
  const path = 'packages/slatebox/src/image.mjs'
  if (!existsSync(new URL(path, root))) return false
  return /export const PINNED_DIGEST = 'sha256:[0-9a-f]{64}'/.test(read(path))
}

test('the README says the image is being published exactly while it is not pinned', () => {
  if (imagePinned()) assert.doesNotMatch(readme, BEING_PUBLISHED, 'the image is published: drop the "being published" paragraph')
  else assert.match(readme, BEING_PUBLISHED)
  assert.doesNotMatch(readme, /coming soon/i)
})

// Restated (round-2 review finding 9): the self-host README never mentions balances, not even in its one sentence.
test('the README carries the one payments sentence and nothing else about payments', () => {
  assert.match(readme, /Slatebox Pro exists only on Slatebox Cloud\./)
  assert.doesNotMatch(readme, /stripe|\bmeter(ing|ed)?\b|top[- ]?ups?|\bbalances?\b|webhook/i)
})
