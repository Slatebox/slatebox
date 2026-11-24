// The brand kit (/team/branding): its preview sizes notes the way real slates do, so the engine never
// cuts a word or lets text spill (owner, 2026-11-24: "the text should autofit like they do on real
// slates"); its colors, roles and AA checks; and the page saves only through the calls that exist.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fitNote, fitSize, wrapLines, WRAP_MARGIN, FIT_MARGIN_X, FIT_MARGIN_Y, LINE_HEIGHT } from '../web/app/imports/ui/components/brand/fitNote.mjs'
import {
  BRAND_FONTS, SAMPLE_HEADINGS, SAMPLE_NOTES, SLATEBOX_DEFAULTS, MAX_FONT_SIZE, MIN_FONT_SIZE,
  backgroundValue, brandUses, cleanPreset, colorName, colorsFromLogo, contrastCheck, contrastWarnings,
  effectiveStyle, fontInfo, logoFileProblem, normalHex, presetFamily, presetFromColors, presetIsEmpty, sampleSlate,
} from '../web/app/imports/ui/components/brand/brandKit.mjs'
import { presetNoteStyle } from '../web/app/imports/ui/common/noteStyle.mjs'

const app = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), 'utf8')

// A stand-in for canvas measureText: every character `factor` of the size wide (wide display fonts
// run near 0.9, narrow ones near 0.45), capitals a little wider.
const measureFor = (size, factor) => (s) => [...String(s)].reduce((w, ch) => w + size * factor * (/[A-Z]/.test(ch) ? 1.25 : ch === ' ' ? 0.5 : 1), 0)

const words = (text) => String(text).split(/\s+/).filter(Boolean)
const wholeWords = (lines, text) => {
  const all = new Set(words(text))
  return lines.every((line) => words(line).every((w) => all.has(w)))
}

test('the engine wrap copied here cuts a word only when it is wider than the line (the old preview\'s "Categor / y 1")', () => {
  const m = measureFor(44, 0.8)
  const lines = wrapLines('Category 1', 150 - WRAP_MARGIN, m)
  assert.ok(lines.length > 2 && !wholeWords(lines, 'Category 1'), 'a fixed 150px note at 44px cuts the word, as the owner saw')
})

test('a note sized by fitNote holds every word whole and inside it, at every allowed size and a wide or narrow font', () => {
  const texts = [...SAMPLE_HEADINGS, ...SAMPLE_NOTES.flat(), 'Category 1', 'Supercalifragilisticexpialidocious', 'A', 'Right-to-left layouts and more words that must wrap onto lines']
  for (const factor of [0.45, 0.6, 0.75, 0.9]) {
    for (let size = MIN_FONT_SIZE; size <= MAX_FONT_SIZE; size += 4) {
      const measure = measureFor(size, factor)
      for (const text of texts) {
        const box = fitNote({ text, fontSize: size, measure, minWidth: 130, maxWidth: 300 })
        const lines = wrapLines(text, box.width - WRAP_MARGIN, measure)
        assert.ok(wholeWords(lines, text), `${text} at ${size}px x${factor}: ${JSON.stringify(lines)}`)
        assert.deepEqual(lines, box.lines)
        // fitTextToNode would shrink text wider than width - 12 or taller than height - 10: it never has to.
        assert.ok(Math.max(...lines.map(measure)) <= box.width - FIT_MARGIN_X, `${text} at ${size}px is too wide`)
        assert.ok(lines.length * size * LINE_HEIGHT <= box.height - FIT_MARGIN_Y, `${text} at ${size}px is too tall`)
      }
    }
  }
})

test('a short note keeps the minimum size; a long one wraps within the maximum width', () => {
  const m = measureFor(14, 0.55)
  assert.deepEqual([fitNote({ text: 'A', fontSize: 14, measure: m, minWidth: 130, minHeight: 52 }).width, fitNote({ text: 'A', fontSize: 14, measure: m, minWidth: 130, minHeight: 52 }).height], [130, 52])
  const long = fitNote({ text: SAMPLE_NOTES[0][0] + ' and the pricing page copy', fontSize: 14, measure: m, maxWidth: 220 })
  assert.equal(long.width, 220)
  assert.ok(long.lines.length > 1)
})

test('a title in a fixed frame shrinks until every word is whole and the lines fit', () => {
  const measureAt = (s, size) => measureFor(size, 0.8)(s)
  const fit = fitSize({ text: 'Internationalization roadmap', width: 230, height: 70, maxSize: 40, measureAt })
  assert.ok(fit.size < 40)
  assert.ok(wholeWords(fit.lines, 'Internationalization roadmap'))
  assert.ok(fit.lines.every((line) => measureAt(line, fit.size) <= 230))
})

test('the sample slate sizes every note with fit and links each heading to its notes', () => {
  const style = effectiveStyle({ categoryStyles: [{ backgroundColor: '#123456' }], categoryFont: 'Lora', categoryFontSize: 120, noteFont: 'Caveat', noteFontSize: 44 })
  const seen = []
  const fit = ({ text, fontSize, fontFamily, ...limits }) => {
    seen.push({ text, fontSize, fontFamily })
    return fitNote({ text, fontSize, measure: measureFor(fontSize, 0.9), ...limits })
  }
  const json = sampleSlate(style, fit)
  const notes = json.nodes.map((n) => n.options)
  assert.equal(notes.length, SAMPLE_HEADINGS.length + SAMPLE_NOTES.flat().length)
  for (const n of notes) {
    const measure = measureFor(n.fontSize, 0.9)
    assert.ok(wholeWords(wrapLines(n.text, n.width - WRAP_MARGIN, measure), n.text), n.text)
  }
  const heading = notes.find((n) => n.id === 'brand-heading-0')
  assert.deepEqual([heading.backgroundColor, heading.foregroundColor, heading.fontFamily, heading.fontSize], ['#123456', '#ffffff', 'Lora', 120])
  assert.equal(json.nodes.find((n) => n.options.id === 'brand-heading-1').relationships.associations.length, SAMPLE_NOTES[1].length)
  // Columns never overlap however wide the words make them.
  const heads = notes.filter((n) => n.id.startsWith('brand-heading-')).sort((a, b) => a.xPos - b.xPos)
  heads.slice(1).forEach((h, i) => assert.ok(h.xPos >= heads[i].xPos + heads[i].width))
  assert.ok(seen.some((s) => s.fontFamily === 'Caveat' && s.fontSize === 44))
})

test('the preview draws with the engine (a read-only slate, loadJSON), not hand-made boxes, and never fetches a font', () => {
  const slate = app('imports/ui/components/BrandPreviewSlate.jsx')
  assert.match(slate, /new Slatebox\.slate\(/)
  assert.match(slate, /loadJSON\(JSON\.stringify\(json\)\)/)
  assert.match(slate, /sampleSlate\(style, fitInPage\)/)
  assert.match(slate, /fontsReady\(/)
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

test('contrast: AA warnings name the pairs that are hard to read, and automatic text always passes', () => {
  assert.equal(contrastCheck('#ffffff', '#40709a').level, 'AA')
  assert.equal(contrastCheck('#ffff00', '#ffffff').level, 'fail')
  const style = effectiveStyle({ categoryStyles: [{ backgroundColor: '#ffeb3b', foregroundColor: '#ffffff' }], presentationMenuBgColorKey: '#222222', presentationControlsColorKey: '#333333' })
  assert.deepEqual(contrastWarnings(style).map((w) => w.key), ['heading-0', 'bar'])
  for (const fill of ['#ffeb3b', '#40709a', '#000000', '#ffffff', '#e07a2f', '#2f8f6b', '#808080']) {
    const p = cleanPreset({ categoryStyles: [{ backgroundColor: fill }] }).categoryStyles[0]
    assert.ok(contrastCheck(p.foregroundColor, p.backgroundColor).ratio >= 4.5, fill)
  }
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
