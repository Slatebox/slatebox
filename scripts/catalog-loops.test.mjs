// The loops are generated from the rules (library final.md §2.7): a snapshot test (the files are what
// the generator writes from the engine as it is), a caption test (each caption is the rule's own
// sentence, and the catalogue says the same), and the size budget (≤ 2 KB gz each, ≤ 26 KB in all).
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { catalog } from 'slateboxjs/catalog'
import { loopCaption, loopSvg, stillSvg } from './catalog-loops.mjs'

const file = id => readFileSync(new URL('../web/app/public/library/' + id + '.svg', import.meta.url), 'utf8')

test('every loop file is what the generator draws from the engine now (snapshot)', () => {
  for (const entry of catalog) {
    assert.equal(file(entry.id), loopSvg(entry), entry.id + '.svg is out of date: node scripts/catalog-loops.mjs')
    assert.equal(file(entry.id + '-still'), stillSvg(entry), entry.id + '-still.svg is out of date: node scripts/catalog-loops.mjs')
  }
})

test('each loop is captioned with the rule’s own sentence, and the catalogue says the same', () => {
  for (const entry of catalog) {
    const caption = loopCaption(entry)
    assert.equal(entry.loop.caption, caption, entry.id)
    assert.ok(file(entry.id).includes('>' + caption.replace(/&/g, '&amp;').replace(/'/g, "'") + '</text>'), entry.id + ' shows its caption')
  }
  // The Team board's caption is a rule the preset has (review finding 17: "Review holds 2" was not one).
  assert.equal(loopCaption(catalog.find(entry => entry.id === 'team-board')), 'Doing holds 3.')
})

test('the loops stay small: no script, ≤ 2 KB gzip each and ≤ 26 KB in all', () => {
  let total = 0
  for (const entry of catalog) {
    const text = file(entry.id)
    assert.doesNotMatch(text, /<script|on[a-z]+=|href=/i, entry.id)
    const size = gzipSync(text, { level: 9 }).length
    assert.ok(size <= 2048, entry.id + ' is ' + size + ' bytes gzip')
    total += size
  }
  assert.ok(total <= 26 * 1024, 'all loops: ' + total)
})
