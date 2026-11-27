// Phones view slates (pan, zoom, live updates) and make or change none; a banner says the app is
// where Slatebox works best (web/app/imports/ui/common/phoneView.mjs). Narrow desktop windows and
// tablets still edit.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import {
  PHONE_BANNER_KEY, PHONE_GATE_COPY, PHONE_CANVAS_WELCOME, dismissPhoneBanner, isPhoneView, phoneBanner, readPhoneView, subscribePhoneView,
} from '../web/app/imports/ui/common/phoneView.mjs'
import { emptySlatesCopy } from '../web/app/imports/ui/common/emptySlates.mjs'
import { brandUses } from '../web/app/imports/ui/components/brand/brandKit.mjs'

const app = (path) => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const ui = (path) => app('imports/ui/' + path)
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) } }
const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }

test('who gets the phone view: a touch screen whose shorter side is under 600px', () => {
  const cases = [
    ['iPhone 15 portrait', 393, 852, true, true],
    ['iPhone 15 landscape', 852, 393, true, true],
    ['iPad mini', 744, 1133, true, false],
    ['Android tablet', 600, 960, true, false],
    ['narrow desktop window', 390, 844, false, false],
    ['short desktop window', 1400, 500, false, false],
  ]
  for (const [name, width, height, coarse, expected] of cases) {
    assert.equal(isPhoneView({ width, height, coarse }), expected, name)
  }
})

function fakeWindow({ width, height, coarse }) {
  const listeners = new Map()
  const queryListeners = new Set()
  const query = {
    get matches() { return win.coarse },
    addEventListener: (type, cb) => { if (type === 'change') queryListeners.add(cb) },
    removeEventListener: (type, cb) => { if (type === 'change') queryListeners.delete(cb) },
  }
  const win = {
    innerWidth: width, innerHeight: height, coarse,
    matchMedia: (q) => { assert.equal(q, '(pointer: coarse)'); return query },
    addEventListener: (type, cb) => { listeners.set(type, (listeners.get(type) ?? new Set()).add(cb)) },
    removeEventListener: (type, cb) => { listeners.get(type)?.delete(cb) },
    fire: (type) => { for (const cb of listeners.get(type) ?? []) cb() },
    fireQuery: () => { for (const cb of queryListeners) cb() },
    count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0) + queryListeners.size,
  }
  return win
}

test('readPhoneView reads the window, and is false with none (server render)', () => {
  assert.equal(readPhoneView(fakeWindow({ width: 393, height: 852, coarse: true })), true)
  assert.equal(readPhoneView(fakeWindow({ width: 390, height: 844, coarse: false })), false)
  assert.equal(readPhoneView(undefined), false)
  assert.equal(readPhoneView({ innerWidth: 390, innerHeight: 844 }), false, 'no matchMedia: not a phone')
})

test('subscribePhoneView hears a resize, a turn of the phone and a change of pointer, and unsubscribes cleanly', () => {
  const win = fakeWindow({ width: 1024, height: 768, coarse: false })
  let calls = 0
  const stop = subscribePhoneView(win, () => { calls += 1 })
  win.fire('resize')
  win.fire('orientationchange')
  win.fireQuery()
  assert.equal(calls, 3)
  win.innerWidth = 393; win.innerHeight = 852; win.coarse = true
  assert.equal(readPhoneView(win), true, 'the answer follows the window')
  stop()
  assert.equal(win.count(), 0, 'every listener removed')
  win.fire('resize'); win.fireQuery()
  assert.equal(calls, 3)
  assert.doesNotThrow(() => subscribePhoneView(null, () => {})())
})

test('banner: no store pages set says the app is coming soon, with no button', () => {
  for (const settings of [undefined, {}, { public: {} }, { public: { mobile: { appStoreUrl: '', playStoreUrl: '' } } }]) {
    const banner = phoneBanner({ settings, storage: memory() })
    assert.equal(banner.soon, true)
    assert.deepEqual(banner.stores, [])
    assert.equal(banner.soonLine, 'The iPhone and Android app is coming soon.')
    assert.equal(banner.text, 'Slatebox works best in the app. Viewing only on phones.')
    assert.equal(banner.editLine, 'Open on a computer to edit.')
  }
})

test('banner: each store page set is one button; http and junk are ignored', () => {
  const one = phoneBanner({ settings: { public: { mobile: { appStoreUrl: 'https://apps.example.com/slatebox' } } }, storage: memory() })
  assert.equal(one.soon, false)
  assert.equal(one.soonLine, null)
  assert.deepEqual(one.stores, [{ label: 'Download on the App Store', href: 'https://apps.example.com/slatebox' }])
  const both = phoneBanner({ settings: { public: { mobile: { appStoreUrl: 'https://a.example.com/x', playStoreUrl: 'https://p.example.com/y' } } }, storage: memory() })
  assert.deepEqual(both.stores.map((s) => s.label), ['Download on the App Store', 'Get it on Google Play'])
  for (const bad of ['http://apps.example.com/x', 'javascript:alert(1)', 'not a url', 42, null, '  ']) {
    const banner = phoneBanner({ settings: { public: { mobile: { appStoreUrl: bad, playStoreUrl: bad } } }, storage: memory() })
    assert.deepEqual(banner.stores, [], String(bad))
    assert.equal(banner.soon, true)
  }
})

test('banner: dismissed stays dismissed; blocked storage still shows it and dismissing does not throw', () => {
  const storage = memory()
  assert.ok(phoneBanner({ storage }))
  dismissPhoneBanner(storage)
  assert.equal(storage.getItem(PHONE_BANNER_KEY), 'dismissed')
  assert.equal(phoneBanner({ storage }), null)
  assert.ok(phoneBanner({ storage: blocked }), 'blocked storage: the banner shows')
  assert.doesNotThrow(() => dismissPhoneBanner(blocked))
  assert.doesNotThrow(() => dismissPhoneBanner(undefined))
  assert.ok(phoneBanner({ storage: undefined }))
})

test('the phone copy says agent, never AI, and uses US spelling', () => {
  const banner = phoneBanner({ storage: memory() })
  const words = [banner.text, banner.editLine, banner.soonLine, ...banner.stores.map((s) => s.label),
    PHONE_GATE_COPY.line, PHONE_GATE_COPY.signedIn.label, PHONE_GATE_COPY.signedOut.label, PHONE_CANVAS_WELCOME,
    emptySlatesCopy({ type: 'mine', signedIn: true, phone: true }).body,
    ui('components/PhoneAppBanner.jsx'), ui('components/PhoneViewGate.jsx'),
  ].join('\n')
  assert.doesNotMatch(words, /\bAI\b/)
  assert.doesNotMatch(words, /\b(colour|centre|favourite|organis|licence|behaviour|analys(e|ing)\b)/i)
})

test('empty slate lists on a phone offer no start', () => {
  for (const type of ['mine', 'team']) {
    const copy = emptySlatesCopy({ type, signedIn: true, phone: true })
    assert.equal(copy.action, undefined, type)
    assert.ok(copy.body)
  }
  assert.equal(emptySlatesCopy({ type: 'mine', signedIn: true, phone: true }).body, 'Slates you make on a computer or tablet show up here.')
  assert.ok(emptySlatesCopy({ type: 'mine', signedIn: true }).action, 'elsewhere the start stays')
})

test('the brand page drops its two new-slate links on a phone', () => {
  const links = (opts) => brandUses({}, opts).map((u) => u.link?.to ?? null)
  assert.ok(links().includes('/new'))
  assert.ok(!links({ phone: true }).includes('/new'))
  assert.ok(links({ phone: true }).includes('/team/settings'), 'other links stay')
  assert.match(ui('pages/BrandingSettings.jsx'), /u\.link && /)
})

test('the canvas: the engine hears read-only on a phone, per gesture, and the chat and call are off', () => {
  const canvas = ui('pages/Canvas.jsx')
  assert.match(canvas, /isReadOnly: \(\) => Boolean\(accessLevel\.current\.isReadOnly \|\| phoneViewRef\.current\)/)
  assert.match(canvas, /isCommentOnly: \(\) => !phoneViewRef\.current && /)
  assert.match(canvas, /const canShowConversation = boardLoaded && !phoneView && /)
  assert.match(canvas, /const showHuddle = Boolean\(boardLoaded && !phoneView && /)
  assert.match(canvas, /const viewOnly = phoneView \|\| Boolean\(accessLevel\.current\.isReadOnly\)/)
  assert.match(canvas, /setCanManageSlate\(Boolean\(Meteor\.userId\(\) && !viewOnly && /)
  assert.match(canvas, /readOnly=\{Boolean\(asEmbed\) \|\| phoneView\}/)
  assert.match(canvas, /!phoneView && keepOffer\?\.key === id/)
  // Every render-time permission reads the phone-aware value.
  const render = canvas.slice(canvas.indexOf('const viewOnly ='))
  assert.doesNotMatch(render.replace(/setCanManageSlate\([^\n]*\n/, ''), /!accessLevel\.current\.isReadOnly/)
})

test('the slate header on a phone: no Share, Invite people or Make a copy', () => {
  const bar = ui('components/CanvasToolbar.jsx')
  assert.match(bar, /const sharer = owner && !phoneView/)
  assert.match(bar, /\{sharer && <Button className="sb-board-share"/)
  assert.match(bar, /\{sharer && <><Divider[\s\S]{0,300}Invite people/)
  assert.match(bar, /!phoneView && \{ key: 'copy', label: 'Make a copy'/)
  assert.match(bar, /\{ key: 'link', label: 'Copy link'/, 'Copy link stays')
})

test('making a slate: each create route is behind PhoneViewGate, outside GuestStartGate', () => {
  const main = app('client/main.jsx')
  for (const path of ['/start', '/canvas/new', '/new/:creativeKind', '/new']) {
    const route = main.match(new RegExp(`<Route path="${path.replace(/[/:]/g, (c) => '\\' + c)}" element=\\{([^\\n]*)\\} />`))
    assert.ok(route, path)
    assert.match(route[1], /^<PhoneViewGate>/, path)
    assert.doesNotMatch(route[1], /<GuestStartGate>[\s\S]*<PhoneViewGate>/, path + ': the gate is outermost')
  }
  assert.match(main, /<PhoneViewGate><GuestStartGate><NewCreativeSlate \/><\/GuestStartGate><\/PhoneViewGate>/)
  assert.match(main, /<PhoneAppBanner \/>/)
  assert.match(ui('SBRoutes.jsx'), /<Route path="\/ai\/:prompt\?" element=\{<PhoneViewGate><SlateCreateRoute \/><\/PhoneViewGate>\} \/>/)
  const gate = ui('components/PhoneViewGate.jsx')
  assert.match(gate, /if \(!phoneView\) return children/)
  assert.doesNotMatch(gate, /import[^\n]*(GuestStartGate|createSlate|guest)|loginAsGuest|createSlate\(/i)
})

test('entry points to making a slate are gone on a phone', () => {
  assert.match(ui('Main.jsx'), /title: 'Create slate',\s*path: '\/new',\s*icon: <AddIcon \/>,\s*show: !phoneView,/)
  assert.match(ui('components/DisplaySlates.jsx'), /showAdd=\{!phoneView\}/)
  assert.match(ui('components/DisplaySlates.jsx'), /phone: phoneView \}\)/)
  assert.match(ui('pages/Library.jsx'), /actions=\{phoneView \? undefined : <Button[^\n]*Build your own component/)
  const item = ui('pages/LibraryItem.jsx')
  assert.match(item, /if \(!item \|\| !copyAsked\.current \|\| phoneView\) return/)
  assert.match(item, /\{phoneView \? \([\s\S]{0,200}Open this on a computer to use it\.[\s\S]{0,400}data-library-use/)
  assert.match(ui('pages/NotFound.jsx'), /\{!phoneView && <Button component=\{Link\} to="\/new"/)
  assert.match(ui('pages/Login.jsx'), /\{!phoneView && <Button[^\n]*to="\/start"/)
  assert.match(ui('components/personal/ForYou.jsx'), /!stale && canBuild && <Button/)
  // A slate card on a phone: no options (Make a copy, Delete, privacy) and no selection box.
  const list = ui('components/DisplaySlates.jsx')
  assert.match(list, /\{!phoneView && <SlateMenu slate=\{slate\} \/>\}/)
  assert.match(list, /\{type !== 'team' && !phoneView && \(\s*<Checkbox/)
  assert.equal(list.match(/<SlateMenu /g).length, 1)
  // A slate id nobody has made yet: on a phone it goes to /new's note, never saved as a new slate.
  assert.match(ui('pages/Canvas.jsx'), /if \(getSlate\?\.exists === false && phoneViewRef\.current\) \{\s*history\('\/new', \{ replace: true \}\)\s*return\s*\}\s*if \(getSlate\?\.exists === false\) \{\s*isNew = true/)
  // A workshop on a phone offers no Join to edit; it says View only.
  assert.match(ui('components/workshop/WorkshopChrome.jsx'), /const canJoin = mayJoin && !viewing/)
  assert.equal(ui('pages/Canvas.jsx').match(/viewing=\{phoneView\}/g).length, 2)
})

test('the banner: mounted once for every page, hidden on presentations and embeds, its store links from settings only', () => {
  const banner = ui('components/PhoneAppBanner.jsx')
  assert.match(banner, /data-testid="phone-app-banner"/)
  assert.match(banner, /role="region" aria-label="Slatebox app"/)
  assert.match(banner, /closeText="Dismiss"/)
  assert.match(banner, /target="_blank" rel="noopener"/)
  assert.match(banner, /top: 'calc\(64px \+ env\(safe-area-inset-top\)\)'/)
  assert.match(banner, /pathname\.startsWith\('\/present\/'\)/)
  assert.match(banner, /isEmbedded/)
  assert.equal(app('client/main.jsx').match(/<PhoneAppBanner \/>/g).length, 1)
  // While it shows, an app page starts below it (the canvas lies under it and pans clear).
  assert.match(banner, /setProperty\('--sb-phone-banner'/)
  assert.match(banner, /removeProperty\('--sb-phone-banner'\)/)
  assert.match(ui('common/main.css'), /\[data-app-page\]\{margin-top:var\(--sb-phone-banner,0px\)\}/)
  const example = JSON.parse(app('settings.example.json'))
  assert.deepEqual(Object.keys(example.public.mobile).filter((k) => k !== '//'), ['appStoreUrl', 'playStoreUrl'])
  assert.equal(example.public.mobile.appStoreUrl, '')
  assert.equal(example.public.mobile.playStoreUrl, '')
  // No store address is written into the app: it comes from settings.
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const path = dir + '/' + name
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
  const root = new URL('../web/app/imports/ui', import.meta.url).pathname
  for (const file of walk(root).filter((f) => /\.(m?js|jsx)$/.test(f))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /apps\.apple\.com|play\.google\.com/, file)
  }
})
