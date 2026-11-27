// The "Made with Slatebox" mark on what people share (owner, 2026-11-27), without Meteor:
// - the words and the link (slatebox.com, ref=made-with, from=<surface>, a new tab, rel noopener);
// - who sees it: an embed always; a share link, a published presentation, a live follow and a library
//   item for anyone outside the slate's team; never the owner or their team on their own canvas;
// - Cloud always shows it; a self-hosted server's administrator may hide it, nobody else may, and
//   the admin copy says nothing about prices, plans or payments;
// - every shared surface draws it.
// Run: node --test scripts/made-with.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import * as made from '../web/app/imports/api/common/made-with.mjs'
import { createMadeWith, MadeWithError } from '../web/app/server/made-with/core.mjs'

const read = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), 'utf8')
const NO_MONEY = /trial|unlock|upgrade|\bPro\b|Business|\$\s?\d|price|pay(ment)?s?\b|stripe|plan\b|plans\b|subscri/i

test('the words and the link', () => {
  assert.equal(made.MADE_WITH_TEXT, 'Made with Slatebox · free and open source')
  for (const surface of made.MADE_WITH_SURFACES) {
    const url = new URL(made.madeWithHref(surface))
    assert.equal(url.origin, 'https://slatebox.com')
    assert.equal(url.pathname, '/')
    assert.equal(url.searchParams.get('ref'), 'made-with')
    assert.equal(url.searchParams.get('from'), surface)
  }
  assert.equal(made.madeWithHref('share'), 'https://slatebox.com/?ref=made-with&from=share')
  assert.equal(new URL(made.madeWithHref('anything else')).searchParams.get('from'), 'share', 'an unknown surface never reaches the link')
  assert.deepEqual([...made.MADE_WITH_SURFACES], ['share', 'embed', 'present', 'follow', 'library'])
})

test('who sees it: outsiders and embeds; never the owner or their team on their own canvas', () => {
  const show = made.showMadeWith
  assert.equal(show({ surface: 'share' }), true, 'a guest on a share link')
  assert.equal(show({ surface: 'share', isOwner: true }), false, 'the owner editing their slate')
  assert.equal(show({ surface: 'share', sameTeam: true }), false, 'a teammate on the team\'s slate')
  assert.equal(show({ surface: 'embed', isOwner: true, sameTeam: true }), true, 'an embed shows it whoever looks')
  assert.equal(show({ surface: 'share', embedded: true, isOwner: true }), true)
  assert.equal(show({ surface: 'present' }), true)
  assert.equal(show({ surface: 'follow', sameTeam: true }), false, 'following a teammate')
  assert.equal(show({ surface: 'follow' }), true, 'following someone from another team')
  assert.equal(show({ surface: 'library' }), true)
  assert.equal(show({ surface: 'share', enabled: false }), false, 'hidden by a self-hosted admin')
  assert.equal(show({ surface: 'embed', enabled: false }), false)
  assert.equal(show({ surface: 'editor' }), false, 'no surface outside the list')
  assert.equal(show({ surface: 'share', editing: true }), false, 'someone from another team editing through an edit link')
  assert.equal(show({ surface: 'follow', loading: true }), false, 'the viewer\'s account not loaded yet: could be a teammate')
  assert.equal(show({ surface: 'share', loading: true }), false)
  assert.equal(made.canvasSurface({ embedded: true }), 'embed')
  assert.equal(made.canvasSurface({}), 'share')
})

test('Cloud always shows it; a self-hosted server shows it until its administrator hides it', () => {
  assert.deepEqual(made.madeWithPolicy({ cloud: true, hidden: true }), { enabled: true, canHide: false })
  assert.deepEqual(made.madeWithPolicy({ cloud: false }), { enabled: true, canHide: true })
  assert.deepEqual(made.madeWithPolicy({ cloud: false, hidden: true }), { enabled: false, canHide: true })
})

function memoryRows(start = null) {
  let row = start
  let reads = 0
  return {
    rows: { read: async () => { reads += 1; return row }, write: async (fields) => { row = { ...(row || {}), ...fields } } },
    get row() { return row },
    get reads() { return reads },
  }
}
const admins = (ids) => async (userId) => ids.includes(userId)

test('the server: Cloud refuses to hide it, whoever asks', async () => {
  const store = memoryRows({ hidden: true })
  const service = createMadeWith({ cloud: true, rows: store.rows, isServerAdmin: admins(['root']) })
  assert.deepEqual(await service.status('root'), { enabled: true }, 'a stored row means nothing on Cloud')
  await assert.rejects(service.setHidden('root', true), (error) => error instanceof MadeWithError && error.code === 'cloud')
  assert.equal(store.row.hidden, true, 'nothing written')
})

test('the server: a self-hosted administrator hides and shows it; members, guests and the signed-out cannot', async () => {
  const store = memoryRows()
  let clock = 1_000
  const service = createMadeWith({ cloud: false, rows: store.rows, isServerAdmin: admins(['root']), now: () => clock })
  assert.deepEqual(await service.status(null), { enabled: true }, 'shown by default')
  assert.deepEqual(await service.status('root'), { enabled: true, canHide: true }, 'the administrator learns it can be hidden')
  assert.deepEqual(await service.status('member'), { enabled: true }, 'a member does not')
  for (const who of [null, 'member', 'guest'])
    await assert.rejects(service.setHidden(who, true), (error) => error.code === 'forbidden', String(who))
  await assert.rejects(service.setHidden('root', 'yes'), (error) => error.code === 'bad_request')
  assert.deepEqual(await service.setHidden('root', true), { enabled: false, canHide: true })
  assert.equal(store.row.hidden, true)
  assert.equal(store.row.by, 'root')
  assert.deepEqual(await service.status(null), { enabled: false }, 'every shared page now leaves it out')
  await service.setHidden('root', false)
  assert.deepEqual(await service.status(null), { enabled: true })
})

test('the server: status reads the row at most once per 30 seconds (every shared page asks)', async () => {
  const store = memoryRows({ hidden: true })
  let clock = 0
  const service = createMadeWith({ cloud: false, rows: store.rows, isServerAdmin: admins([]), now: () => clock })
  for (let i = 0; i < 5; i += 1) await service.status(null)
  assert.equal(store.reads, 1)
  clock += 30_001
  await service.status(null)
  assert.equal(store.reads, 2)
})

test('the server: an unreadable row still shows the mark', async () => {
  const service = createMadeWith({ cloud: false, rows: { read: async () => { throw new Error('down') }, write: async () => {} }, isServerAdmin: admins([]) })
  assert.deepEqual(await service.status(null), { enabled: true })
})

test('the admin copy (self-host only) says nothing about money', () => {
  for (const words of Object.values(made.MADE_WITH_ADMIN)) assert.doesNotMatch(words, NO_MONEY)
  assert.doesNotMatch(read('imports/ui/pages/admin/MadeWithCard.jsx'), NO_MONEY)
})

test('the mark: a link to slatebox.com in a new tab, rel noopener, with the words and an accessible name', () => {
  const src = read('imports/ui/components/MadeWithSlatebox.jsx')
  assert.match(src, /href=\{madeWithHref\(surface\)\}/)
  assert.match(src, /target="_blank"/)
  assert.match(src, /rel="noopener"/)
  assert.match(src, /aria-label=\{MADE_WITH_LABEL\}/)
  assert.match(src, /\{MADE_WITH_TEXT\}/)
  assert.match(src, /enabled !== true\) return null/, 'drawn only once the server says it is on')
  assert.match(src, /dark \?/, 'its own light and dark colors')
})

test('every shared surface draws it', () => {
  const canvas = read('imports/ui/pages/Canvas.jsx')
  assert.match(canvas, /<MadeWithSlatebox surface=\{madeWithSurface\} show=\{madeWithShown\}/)
  assert.match(canvas, /isOwner: Boolean\(viewer\.userId && viewer\.userId === /, 'the canvas knows its owner')
  assert.match(canvas, /sameTeam: Boolean\(viewer\.orgId && viewer\.orgId === slateOrgId\.current\)/, 'and the team')
  assert.match(canvas, /canvasSurface\(\{ embedded: embeddedView \}\)/)
  assert.match(read('imports/ui/components/PresentPublishedSlate.jsx'), /<MadeWithSlatebox surface=\{curPresentation\.isEmbedded \? 'embed' : 'present'\}/)
  assert.doesNotMatch(read('imports/ui/components/PresentPublishedSlate.jsx'), /Built with/, 'one mark, not two')
  assert.match(read('imports/ui/components/presentations/FollowPresentation.jsx'), /<MadeWithSlatebox surface="follow" show=\{madeWith\}/)
  assert.match(read('imports/ui/pages/LibraryItem.jsx'), /<MadeWithSlatebox surface="library"/)
  assert.match(read('imports/ui/pages/AdminTools.jsx'), /<MadeWithCard \/>/)
  assert.match(read('server/main.js'), /import '\.\/made-with\/meteor'/)
  const constants = read('imports/api/common/constants.js')
  assert.match(constants, /madeWith: \{\s+status: 'madeWith\.status',\s+setHidden: 'madeWith\.setHidden',/)
})

test('the presenter\'s own player (PresentSlate) has no mark: it is the owner\'s view', () => {
  assert.doesNotMatch(read('imports/ui/components/PresentSlate.jsx'), /MadeWithSlatebox/)
})

test('a self-hosted server\'s own embed page (/embed/<shareId>) has the mark in a strip under the picture, unless hidden', () => {
  const strip = made.madeWithStripHtml('embed')
  assert.match(strip, /href="https:\/\/slatebox\.com\/\?ref=made-with&amp;from=embed"/)
  assert.match(strip, /target="_blank" rel="noopener"/)
  assert.match(strip, />Made with Slatebox · free and open source<\/a>/)
  assert.match(made.MADE_WITH_STRIP_STYLE, /prefers-color-scheme:dark/, 'readable in light and dark')
  const hooks = read('server/apiHooks.js')
  assert.match(hooks, /const mark = \(await madeWith\.status\(\)/)
  assert.match(hooks, /calc\(100vh - \$\{MADE_WITH_STRIP_PX\}px\)/, 'the picture leaves the strip its room: the mark covers none of it')
  assert.match(hooks, /\$\{mark \? madeWithStripHtml\('embed'\) : ''\}/)
})
