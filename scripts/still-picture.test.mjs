// A slate's thumbnail (My slates, Community, Team slates) is a still picture of the live canvas, drawn by the
// same renderer, so it carries every control the canvas has: a link's "Remove the link: …" button, a plan bar's
// "Left and Right move it a day…". None of them work there, so none are said: the card is one image, named
// after the slate, and its parts have no words, roles or focus, even as a board draws into it later.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { quietParts, stillPicture } from '../web/app/imports/ui/components/stillPicture.mjs'

// jsdom is the web app's dependency: read it from there, wherever the root's packages are.
const { JSDOM } = createRequire(new URL('../web/app/package.json', import.meta.url))('jsdom')
const ui = path => readFileSync(new URL('../web/app/imports/ui/components/' + path, import.meta.url), 'utf8')
const live = `<div id="card"><svg role="application" aria-label="Canvas" tabindex="0">
  <g data-node-id="n1" role="button" tabindex="0" aria-label="Design, in Product. Left and Right move it a day, Shift changes its length, L chooses what it waits on." aria-describedby="d1"><rect /><text>Design</text></g>
  <path data-board-link="a>b" role="button" tabindex="0" aria-label="Remove the link: Build waits on Design" />
  <g><title>Remove the link</title><desc>A link</desc><circle data-keep="yes" /></g>
</svg></div>`

const said = root => [root, ...root.querySelectorAll('*')].flatMap(el => el.getAttributeNames().filter(name => /^(aria-|role$|tabindex$|title$)/.test(name)).map(name => `${el.localName}[${name}=${el.getAttribute(name)}]`))

test('a thumbnail is one image named after the slate: none of the canvas\'s controls are said or focusable', async () => {
  const { document } = new JSDOM(live).window
  const card = document.getElementById('card')
  const stop = stillPicture(card, 'Launch plan')
  assert.deepEqual(said(card), ['div[role=img]', 'div[aria-label=Launch plan]'])
  assert.doesNotMatch(card.innerHTML, /Remove the link|move it a day|<title>|<desc>/)
  // What draws the picture stays: shapes, words on the board, data attributes.
  assert.match(card.innerHTML, /<text>Design<\/text>/)
  assert.ok(card.querySelector('[data-board-link="a>b"]') && card.querySelector('[data-keep="yes"]'))
  stop()
})

test('a board drawn into the picture later is quiet too, and an unnamed picture is quiet itself', async () => {
  const { document } = new JSDOM('<div id="card"></div>').window
  const card = document.getElementById('card')
  card.setAttribute('aria-label', 'Canvas')
  const stop = stillPicture(card)
  assert.deepEqual(said(card), [])
  card.insertAdjacentHTML('beforeend', '<svg><g role="button" tabindex="0" aria-label="Remove the link: Build waits on Design"><title>x</title></g></svg>')
  card.querySelector('g').setAttribute('aria-label', 'Left and Right move it a day')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(said(card), [])
  assert.equal(card.querySelector('title'), null)
  stop()
  quietParts(card)
})

test('My slates names each card\'s picture after its slate, and the picture takes no focus or clicks', () => {
  const list = ui('DisplaySlates.jsx')
  assert.match(list, /<Box role="img" aria-label=\{name\}[^>]*>\s*<Box inert=""[^>]*>\s*<SnapSlate slate=\{slate\}/)
  assert.doesNotMatch(list, /aria-hidden="true" inert=""[^>]*>\s*<SnapSlate/)
  // The card's picture quiets its parts (the panning preview, a canvas you can move, keeps them).
  assert.match(ui('SnapSlate.jsx'), /allowDrag \? undefined : stillPicture\(box\.current\)/)
})
