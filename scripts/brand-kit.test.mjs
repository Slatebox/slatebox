// The brand kit (/team/branding): its preview draws the notes a real slate makes (noteStyle.mjs noteAt)
// with the engine itself, so the engine's autofit (whole words, shrunk to fit: slateboxjs wrapText.ts)
// is what the owner sees (owner, 2026-11-24: "the text should autofit like they do on real slates");
// its colors, roles and size-aware AA checks; and the page saves only through the calls that exist.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fitSize, wrapLines } from '../web/app/imports/ui/components/brand/fitTitle.mjs'
import {
  BRAND_FONTS, SAMPLE_HEADINGS, SAMPLE_NOTES, SLATEBOX_DEFAULTS, MAX_FONT_SIZE,
  backgroundValue, brandUses, cleanPreset, colorName, colorsFromLogo, contrastCheck, contrastWarnings,
  effectiveStyle, fontInfo, logoFileProblem, normalHex, presetFamily, presetFromColors, presetIsEmpty, sampleSlate,
} from '../web/app/imports/ui/components/brand/brandKit.mjs'
import { noteAt, presetNoteStyle } from '../web/app/imports/ui/common/noteStyle.mjs'
import { DEFAULT_PRESET_QUERY, currentLogo, defaultPreset, logoDocs } from '../web/app/imports/api/common/brandSettings.mjs'

const app = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), 'utf8')

// A stand-in for canvas measureText: every character `factor` of the size wide, capitals a little wider.
const measureFor = (size, factor) => (s) => [...String(s)].reduce((w, ch) => w + size * factor * (/[A-Z]/.test(ch) ? 1.25 : ch === ' ' ? 0.5 : 1), 0)
const words = (text) => String(text).split(/\s+/).filter(Boolean)
const wholeWords = (lines, text) => {
  const all = new Set(words(text))
  return lines.every((line) => words(line).every((w) => all.has(w)))
}

test('the preview draws the notes a real slate makes: noteAt sizes, nothing fitted by hand', () => {
  const style = effectiveStyle({ categoryStyles: [{ backgroundColor: '#123456' }], categoryFont: 'Lora', categoryFontSize: 44, noteFont: 'Caveat', noteFontSize: 28 })
  const json = sampleSlate(style)
  const notes = json.nodes.map((n) => n.options)
  assert.equal(notes.length, SAMPLE_HEADINGS.length + SAMPLE_NOTES.flat().length)
  const real = (fontFamily, fontSize) => noteAt({ ...presetNoteStyle(null), fontFamily, fontSize }, { x: 0, y: 0 })
  for (const n of notes) {
    const want = n.id.startsWith('brand-heading-') ? real('Lora', 44) : real('Caveat', 28)
    assert.deepEqual([n.width, n.height, n.fontFamily, n.fontSize], [want.width, want.height, want.fontFamily, want.fontSize], n.id)
  }
  const heading = notes.find((n) => n.id === 'brand-heading-0')
  assert.deepEqual([heading.backgroundColor, heading.foregroundColor], ['#123456', '#ffffff'])
  // The long word is in the sample, so the engine's autofit is what shows.
  assert.ok(notes.some((n) => n.text === 'Internationalization'))
  // Lines run as a chain, heading to first note to the next, so none crosses a note.
  const linksFrom = (id) => json.nodes.find((n) => n.options.id === id).relationships.associations.map((a) => [a.parentId, a.childId])
  assert.deepEqual(linksFrom('brand-heading-1'), [['brand-heading-1', 'brand-note-1-0']])
  assert.deepEqual(linksFrom('brand-note-1-0'), [['brand-note-1-0', 'brand-note-1-1']])
  // Columns never overlap.
  const heads = notes.filter((n) => n.id.startsWith('brand-heading-')).sort((a, b) => a.xPos - b.xPos)
  heads.slice(1).forEach((h, i) => assert.ok(h.xPos >= heads[i].xPos + heads[i].width))
})

test('notes the engine grew taller are stacked with room for them; a phone draws the long-word column', () => {
  const style = effectiveStyle({ categoryFontSize: 44 })
  const first = sampleSlate(style)
  const grownId = 'brand-heading-1'
  const grown = sampleSlate(style, { heights: { [grownId]: 400 } })
  const below = (json) => json.nodes.find((n) => n.options.id === 'brand-note-1-0').options.yPos
  assert.ok(below(grown) >= 400 + below(first) - first.nodes.find((n) => n.options.id === grownId).options.height)
  assert.ok(grown.size.height > first.size.height)
  const phone = sampleSlate(style, { columns: 1 })
  assert.deepEqual(phone.nodes.filter((n) => n.options.id.startsWith('brand-heading-')).map((n) => n.options.text), ['Internationalization'])
  assert.ok(phone.size.width < first.size.width)
})

test('a new note is 160 wide up to 36px and wider past it, so a long word at a heading size shrinks less', () => {
  const at = (fontSize) => noteAt({ ...presetNoteStyle(null), fontSize }, { x: 0, y: 0 })
  assert.deepEqual([14, 18, 28, 36].map((s) => at(s).width), [160, 160, 160, 160])
  assert.ok(at(44).width > 160)
  // At XL a 20-letter word in a wide display font still fits at the engine's shrink floor (0.3) whole.
  const longWord = measureFor(44, 0.6)('Internationalization')
  assert.ok(longWord <= (at(44).width - 14) / 0.3)
  assert.ok(at(120).width >= 500)
})

test('the presentation card title shrinks until every word is whole and the lines fit', () => {
  const measureAt = (s, size) => measureFor(size, 0.8)(s)
  const fit = fitSize({ text: 'Internationalization roadmap', width: 230, height: 70, maxSize: 40, measureAt })
  assert.ok(fit.size < 40)
  assert.ok(wholeWords(fit.lines, 'Internationalization roadmap'))
  assert.ok(fit.lines.every((line) => measureAt(line, fit.size) <= 230))
  assert.deepEqual(wrapLines('one two three', 70, (s) => s.length * 10), ['one two', 'three'])
})

test('the preview draws with the engine (a read-only slate, loadJSON), not hand-made boxes, and never fetches a font', () => {
  const slate = app('imports/ui/components/BrandPreviewSlate.jsx')
  assert.match(slate, /new Slatebox\.slate\(/)
  assert.match(slate, /loadJSON\(JSON\.stringify\(json\)\)/)
  assert.match(slate, /sampleSlate\(style, \{ heights, columns \}\)/)
  assert.match(slate, /fontsReady\(/)
  assert.doesNotMatch(slate, /fitNote|fitInPage/)
  for (const file of ['imports/ui/pages/BrandingSettings.jsx', 'imports/ui/components/BrandPreviewSlate.jsx', ...['BrandPreview', 'StyleSection', 'ColorsSection', 'LogoField', 'ui', 'measure', 'pullColors'].map((f) => `imports/ui/components/brand/${f}.${f === 'measure' || f === 'pullColors' ? 'js' : 'jsx'}`)]) {
    assert.doesNotMatch(app(file), /fonts\.googleapis|fonts\.gstatic/, file)
  }
})

test('fonts: the kit offers only fonts slates can draw; an older preset font is named as not available', () => {
  assert.deepEqual(BRAND_FONTS.filter((f) => f.source === 'served').map((f) => f.family), ['Manrope', 'Lora', 'Courier Prime', 'Caveat'])
  const css = app('public/fonts/fonts.css')
  for (const f of BRAND_FONTS.filter((x) => x.source === 'served')) assert.match(css, new RegExp(`font-family: '${f.family}'`))
  assert.equal(fontInfo('Bangers').source, 'missing')
  assert.equal(fontInfo('"Lora", serif').family, 'Lora')
  assert.equal(presetFamily('courier-prime'), 'Courier Prime')
  assert.equal(presetFamily('Headings', { Headings: 'lora' }), 'Lora')
  assert.equal(presetFamily(null), null)
})

test('a preset saved from the kit gives new slates the same note the canvas makes from it', () => {
  const preset = cleanPreset({ categoryStyles: [{ backgroundColor: '#ABC', foregroundColor: '' }], categoryFont: 'Lora', categoryFontSize: '28', noteFontSize: 999, presentationMenuBgColorKey: 'nope' })
  assert.deepEqual(preset.categoryStyles, [{ backgroundColor: '#aabbcc', foregroundColor: '#111111' }])
  assert.equal(preset.categoryFontSize, 28)
  assert.equal(preset.noteFontSize, MAX_FONT_SIZE)
  assert.equal(preset.presentationMenuBgColorKey, null)
  const note = presetNoteStyle(preset)
  assert.deepEqual(note, { backgroundColor: '#aabbcc', foregroundColor: '#111111', fontFamily: 'Lora', fontSize: 28 })
})

test('an empty style is Slatebox\'s: the preview shows what slates get with no preset', () => {
  const s = effectiveStyle(null)
  assert.equal(s.background, '#ffffff')
  assert.deepEqual(s.headings, [SLATEBOX_DEFAULTS.heading])
  assert.equal(s.headingFont, presetNoteStyle(null).fontFamily)
  assert.equal(s.headingSize, presetNoteStyle(null).fontSize)
  assert.ok(presetIsEmpty({}))
  assert.ok(presetIsEmpty(cleanPreset({ categoryStyles: [], background: { activeType: 'color', colorValue: null } })))
  assert.ok(!presetIsEmpty({ categoryFont: 'Lora' }))
})

test('backgrounds are written the way createSlate reads them', () => {
  assert.deepEqual(backgroundValue('color', '#EEE'), { activeType: 'color', colorValue: '#eeeeee', gradientConfig: null })
  const g = backgroundValue('gradient', '#336699', ['#336699', '#4477aa', 'not a color', '#5588bb'])
  assert.equal(g.activeType, 'gradient')
  assert.deepEqual(g.gradientConfig.gradientColors, ['#336699', '#4477aa', '#5588bb'])
  assert.equal(effectiveStyle({ background: g }).background, '#336699')
  assert.equal(backgroundValue('none', '#fff'), null)
  const create = app('imports/api/client/createSlate.js')
  assert.match(create, /presetBg\.colorValue/)
  assert.match(create, /presetBg\.gradientConfig\.gradientColors/)
})

test('contrast: AA is judged at the size the text is drawn, and the badge and the warnings agree', () => {
  assert.equal(contrastCheck('#ffffff', '#40709a').level, 'AA')
  assert.equal(contrastCheck('#ffff00', '#ffffff').level, 'fail')
  // Coral and white, about 3.1:1: fine for 44px headings (WCAG large text needs 3:1), not for 18px text.
  const coral = contrastCheck('#ffffff', '#ee6c4d', 44)
  assert.ok(coral.ratio >= 3 && coral.ratio < 4.5)
  assert.equal(coral.passes, true)
  assert.equal(contrastCheck('#ffffff', '#ee6c4d', 18).passes, false)
  assert.equal(contrastCheck('#ffffff', '#ee6c4d', 24).passes, true)
  const pairs = { categoryStyles: [{ backgroundColor: '#ffeb3b', foregroundColor: '#ffffff' }, { backgroundColor: '#ee6c4d', foregroundColor: '#ffffff' }], noteStyles: [{ backgroundColor: '#ee6c4d', foregroundColor: '#ffffff' }], presentationMenuBgColorKey: '#222222', presentationControlsColorKey: '#333333' }
  assert.deepEqual(contrastWarnings(effectiveStyle({ ...pairs, categoryFontSize: 44, noteFontSize: 14 })).map((w) => w.key), ['heading-0', 'note-0', 'bar'])
  assert.deepEqual(contrastWarnings(effectiveStyle({ ...pairs, categoryFontSize: 18, noteFontSize: 28 })).map((w) => w.key), ['heading-0', 'heading-1', 'bar'])
  // The badge reads the same check, at the pair's size.
  const ui = app('imports/ui/components/brand/ui.jsx')
  assert.match(ui, /contrastCheck\(ink, fill, size\)/)
  const styleSection = app('imports/ui/components/brand/StyleSection.jsx')
  assert.match(styleSection, /size=\{style\.headingSize\}/)
  assert.match(styleSection, /size=\{BAR_TEXT_PX\}/)
  for (const fill of ['#ffeb3b', '#40709a', '#000000', '#ffffff', '#e07a2f', '#2f8f6b', '#808080']) {
    const p = cleanPreset({ categoryStyles: [{ backgroundColor: fill }] }).categoryStyles[0]
    assert.ok(contrastCheck(p.foregroundColor, p.backgroundColor).ratio >= 4.5, fill)
  }
})

test('one logo and one preset in use, the same pick on the page and in published presentations', () => {
  const t = (n) => new Date(2026, 0, n)
  const settings = [
    { _id: 'old', type: 'logo', value: { logoType: 'squareLogo', url: '/old.png' }, updatedAt: t(1) },
    { _id: 'new', type: 'logo', value: { logoType: 'squareLogo', url: '/new.png' }, updatedAt: t(3) },
    { _id: 'gone', type: 'logo', value: { logoType: 'squareLogo', url: null }, deleted: true, updatedAt: t(5) },
    { _id: 'wide', type: 'logo', value: { logoType: 'primaryLogo', url: '/wide.png' }, updatedAt: t(2) },
    { _id: 'p-default', type: 'preset', intentionId: 'default', value: { presentationMenuBgColorKey: '#112233' } },
    { _id: 'p-persona', type: 'preset', intentionId: 'persona', value: { categoryFont: 'Lora' } },
  ]
  assert.equal(currentLogo(settings, 'squareLogo')._id, 'new')
  assert.equal(currentLogo(settings.filter((s) => s._id !== 'new' && s._id !== 'old'), 'squareLogo'), null)
  assert.deepEqual(logoDocs(settings, 'squareLogo').map((s) => s._id), ['gone', 'new', 'old'])
  assert.equal(defaultPreset(settings)._id, 'p-default')
  assert.equal(defaultPreset([]), null)
  const server = app('server/methods/presentations.js')
  assert.match(server, /currentLogo\(orgSettings, 'squareLogo'\)/)
  const page = app('imports/ui/pages/BrandingSettings.jsx')
  assert.match(page, /currentLogo\(settings, t\.key\)/)
  assert.match(page, /logoDocs\(settings, key\)\[0\]/)
})

test('one style for every slate: a preset stored for one kind of AI-made slate is never read', () => {
  const t = (n) => new Date(2026, 0, n)
  const settings = [
    { _id: 'p-old', type: 'preset', intentionId: 'default', value: { categoryFont: 'Old' }, updatedAt: t(1) },
    { _id: 'p-default', type: 'preset', intentionId: 'default', value: { categoryFont: 'Inter' }, updatedAt: t(2) },
    { _id: 'p-removed', type: 'preset', intentionId: 'default', value: { categoryFont: 'Gone' }, deleted: true, updatedAt: t(9) },
    { _id: 'p-story', type: 'preset', intentionId: 'storyteller', value: { categoryFont: 'Lora' }, updatedAt: t(8) },
  ]
  assert.equal(defaultPreset(settings)._id, 'p-default')
  assert.equal(defaultPreset(settings.filter((s) => s.intentionId !== 'default')), null, 'no fallback to a kind\'s preset')
  assert.deepEqual({ ...DEFAULT_PRESET_QUERY }, { type: 'preset', intentionId: 'default' })
  // AI-made slates, presentations and new slates ask only for the default preset.
  const ai = app('server/methods/openai.js')
  assert.match(ai, /const orgPreset = defaultPreset\(await OrganizationSettings\.find\(\{\s*orgId: user\.orgId,\s*\.\.\.DEFAULT_PRESET_QUERY,\s*\}\)\.fetchAsync\(\)\)/)
  assert.doesNotMatch(ai, /intentionId: intention\._id/)
  const present = app('server/methods/presentations.js')
  assert.match(present, /defaultPreset\(orgSettings\)/)
  assert.doesNotMatch(present, /presetFor|intentionId: \{ \$in/)
  assert.equal([...present.matchAll(/DEFAULT_PRESET_QUERY/g)].length, 3, 'both presentation reads use the default query')
  assert.match(app('imports/api/client/createSlate.js'), /defaultPreset = teamStyle\(matchingSettings\)/)
  for (const file of ['server/methods/openai.js', 'server/methods/presentations.js', 'imports/api/client/createSlate.js', 'imports/ui/common/noteStyle.mjs']) {
    assert.doesNotMatch(app(file), /presetFor\(/, file)
  }
  assert.doesNotMatch(app('imports/api/common/brandSettings.mjs'), /export function presetFor/)
})

test('the page has no kind selector: one slate style, saved as the default preset', () => {
  const page = app('imports/ui/pages/BrandingSettings.jsx')
  for (const gone of [/data-brand-style-for/, /Style for/, /Every slate \(default\)/, /Made with Ask Slatebox:/, /uses the default/, /ChatIntentions/, /chatIntentions/, /typePresets/, /MenuItem/]) {
    assert.doesNotMatch(page, gone)
  }
  assert.match(page, /Fonts, note colors, background and the presentation bar for every slate\./)
  assert.match(page, /const styleDoc = defaultPreset\(settings\)/)
  assert.match(page, /\.\.\.DEFAULT_PRESET_QUERY, value: clean, orgId/)
  assert.match(page, /deletePreset, \{ intentionId: DEFAULT_PRESET_QUERY\.intentionId \}/)
  const kit = app('imports/ui/components/brand/brandKit.mjs')
  assert.doesNotMatch(kit, /typePresets/)
  assert.equal(brandUses({ typePresets: true }).find((u) => u.key === 'ai-slates').state, 'off', 'only the default style turns AI-made slates on')
})

test('"Use my colors" builds a readable style from the roles, keeping fonts', () => {
  const palette = [
    { _id: 'a', name: 'Navy', value: '#1d3557', role: 'primary' },
    { _id: 'b', name: 'Coral', value: '#e76f51', role: 'accent' },
    { _id: 'c', name: 'Mist', value: '#f1f4f2', role: 'neutral' },
  ]
  const next = presetFromColors(palette, { categoryFont: 'Lora' })
  assert.equal(next.categoryFont, 'Lora')
  assert.equal(next.categoryStyles[0].backgroundColor, '#1d3557')
  assert.equal(next.presentationMenuBgColorKey, '#1d3557')
  assert.equal(next.background.colorValue, '#f1f4f2')
  assert.deepEqual(contrastWarnings(effectiveStyle(next)), [])
  assert.deepEqual(presetFromColors([], { x: 1 }), { x: 1 })
})

test('colors pulled from a logo: new ones only, named, given the roles the kit lacks', () => {
  const found = colorsFromLogo(['#1d3557', '#1e3658', '#e76f51', '#f4f4f4', '#000000'], [{ value: '#e76f50', role: 'accent' }])
  assert.deepEqual(found.map((c) => c.value), ['#1d3557', '#f4f4f4', '#000000'])
  assert.equal(found[0].role, 'primary')
  assert.equal(found.find((c) => c.role === 'accent'), undefined)
  assert.equal(found[1].role, 'neutral')
  assert.equal(colorName('#1d3557'), 'Deep blue')
  assert.equal(colorName('#ffffff'), 'White')
  assert.equal(normalHex('ABC'), '#aabbcc')
  assert.equal(normalHex('#12345'), null)
})

test('logo files: the upload route\'s types and 20 MB limit, said before anything is sent', () => {
  assert.equal(logoFileProblem({ name: 'mark.svg', type: 'image/svg+xml', size: 1000 }), null)
  assert.equal(logoFileProblem({ name: 'mark.png', type: '', size: 1000 }), null)
  assert.match(logoFileProblem({ name: 'deck.pdf', type: 'application/pdf', size: 10 }), /not a PNG/)
  assert.match(logoFileProblem({ name: 'big.png', type: 'image/png', size: 21 * 1024 * 1024 }), /larger than 20 MB/)
  assert.match(app('server/sbImages.js'), /larger than 20 MB/)
})

test('"Where your brand shows up" lists only what reads the kit, and says when defaults are in use', () => {
  const empty = brandUses({})
  assert.deepEqual(empty.map((u) => u.key), ['new-slates', 'ai-slates', 'presentations', 'export'])
  assert.deepEqual(empty.map((u) => u.state), ['off', 'off', 'off', 'on'])
  const full = brandUses({ squareLogo: { url: 'x' }, defaultPreset: { categoryFont: 'Lora' } })
  assert.deepEqual(full.map((u) => u.state), ['on', 'on', 'on', 'on'])
  // Each place named reads the kit in code today.
  assert.match(app('imports/api/client/createSlate.js'), /presetNoteStyle\(defaultPreset\?\.value, fonts\)/)
  assert.match(app('server/methods/openai.js'), /orgPreset\.value\.categoryStyles/)
  assert.match(app('server/methods/presentations.js'), /'value\.logoType': 'squareLogo'/)
  assert.match(app('server/team-export/meteor.js'), /orgSettings: raw\(OrganizationSettings\)/)
})

test('the page saves only through calls that exist, team admins only, with no dead controls', () => {
  const page = app('imports/ui/pages/BrandingSettings.jsx')
  const server = app('server/methods/organizationSettings.js')
  const used = [...page.matchAll(/CONSTANTS\.methods\.organizationSettings\.(\w+)/g)].map((m) => m[1])
  assert.ok(used.length > 0)
  for (const name of new Set(used)) assert.match(server, new RegExp(`CONSTANTS\\.methods\\.organizationSettings\\.${name}\\]`), `${name} has a server method`)
  assert.doesNotMatch(page, /organizationSettings\.remove\b/)
  assert.match(page, /AuthManager\.userHasClaim\(userId, \[CONSTANTS\.claims\.admin\._id\]\)/)
  assert.match(page, /Only team admins can change the brand kit/)
  // A removed square logo leaves no url behind for presentations to show.
  assert.match(page, /value: \{ logoType: type\.key, name: '', url: null \}, deleted: true/)
  // US spelling in what the page says.
  for (const file of ['imports/ui/pages/BrandingSettings.jsx', 'imports/ui/components/brand/StyleSection.jsx', 'imports/ui/components/brand/ColorsSection.jsx', 'imports/ui/components/brand/BrandPreview.jsx', 'imports/ui/components/brand/brandKit.mjs']) {
    assert.doesNotMatch(app(file), /colour/i, file)
  }
})
