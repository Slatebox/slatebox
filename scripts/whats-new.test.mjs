// What's new in Help and support (web/app/imports/ui/common/whatsNew.mjs, components/HelpMenu.jsx): a link to
// slatebox.com/changelog at the app's release line, with an unread dot until the person opens it on that line.
// Run: node --test scripts/whats-new.test.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { CHANGELOG_URL, SEEN_KEY, isUnread, markSeen, readSeen, releaseLine, whatsNewUrl } from '../web/app/imports/ui/common/whatsNew.mjs'

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8')
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m } }

test('the release line is major.minor; patches share it', () => {
  assert.equal(releaseLine('2.1.4'), '2.1')
  assert.equal(releaseLine('3.0.0-rc.1'), '3.0')
  assert.equal(releaseLine('unknown'), '')
  assert.equal(releaseLine(undefined), '')
})

test('What\'s new opens the public changelog at the release line', () => {
  assert.equal(CHANGELOG_URL, 'https://slatebox.com/changelog/')
  assert.equal(whatsNewUrl('2.1.4'), 'https://slatebox.com/changelog/#v2-1')
  assert.equal(whatsNewUrl(''), 'https://slatebox.com/changelog/')
})

test('the dot shows until What\'s new is opened on this line, and comes back on the next minor', () => {
  const storage = memory()
  assert.equal(isUnread(readSeen(storage), '2.1.4'), true)
  markSeen(storage, '2.1.4')
  assert.equal(storage.m.get(SEEN_KEY), '2.1')
  assert.equal(isUnread(readSeen(storage), '2.1.9'), false)
  assert.equal(isUnread(readSeen(storage), '2.2.0'), true)
  assert.equal(isUnread('', 'not-a-version'), false)
})

test('blocked storage never throws; the dot just stays', () => {
  const blocked = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(readSeen(blocked), '')
  assert.doesNotThrow(() => markSeen(blocked, '2.1.4'))
  assert.equal(readSeen(undefined), '')
})

test('the app knows its own version, the same one package.json carries', async () => {
  const pkg = JSON.parse(await read('package.json'))
  const release = JSON.parse(await read('web/app/imports/ui/common/release.json'))
  assert.equal(release.version, pkg.version)
})

test('Help and support offers What\'s new with an unread dot, opening in a new tab', async () => {
  const menu = await read('web/app/imports/ui/components/HelpMenu.jsx')
  assert.match(menu, /from '\.\.\/common\/whatsNew\.mjs'/)
  assert.match(menu, /from '\.\.\/common\/release\.json'/)
  assert.match(menu, /primary="What's new"/)
  assert.match(menu, /data-help="whats-new"/)
  assert.match(menu, /data-unread=/)
  assert.match(menu, /target="_blank" rel="noopener noreferrer"/)
})

test('the Help and support row\'s dot sits on the icon at every sidebar width, never beside the label', async () => {
  const menu = await read('web/app/imports/ui/components/HelpMenu.jsx')
  const row = menu.slice(menu.indexOf('<ListItemButton id="help-menu-button"'), menu.indexOf('</ListItemButton>'))
  const icon = row.slice(row.indexOf('<ListItemIcon'), row.indexOf('</ListItemIcon>'))
  assert.match(icon, /\{unread && <UnreadDot sx=\{\{ position: 'absolute', top: 0, left: 18 \}\} \/>\}/, 'on the icon, collapsed or not')
  assert.equal((row.match(/<UnreadDot/g) || []).length, 1, 'one dot on the row')
  assert.doesNotMatch(row.slice(row.indexOf('</ListItemIcon>')), /UnreadDot/, 'nothing after the icon, so nothing near the label')
})
