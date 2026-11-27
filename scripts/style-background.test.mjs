// The slate's background as part of its style: a color, a gradient (two or three stops, linear at an angle or
// radial) or a picture (filled, fitted or tiled, dimmed with a color so notes stay readable). Owner, 2026-11-27:
// "yeah let's add gradient and picture options back please" (they went with the old Custom block on 2026-11-25;
// now they are part of the style's Background control, so a style worn again keeps them and Revert to original
// restores the background from before).
//
// Proved over the pure code every surface shares: the data shape (presentationBackground.mjs) and the engine's
// own reading of it (slateboxjs/operations backgroundOf, checkStyle), setSlateBackground / wearStyle / takeOffStyle /
// revertToOriginal, copies and the published player's copy, and the agent path's checks.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRequire } from 'node:module'
import {
  DIM_DEFAULT, GRADIENT_PRESETS, blend, cleanBackgroundOverride, gradientCss, isPictureUrl, readBackground, shownBackground, withBackground,
} from '../web/app/imports/ui/components/presentations/presentationBackground.mjs'
import { revertToOriginal, setSlateBackground, takeOffStyle, wearStyle, wornStyle } from '../web/app/imports/ui/components/presentations/presentationBake.mjs'
import { STYLES, cleanStyleRef, resolveStyle, textOn } from '../web/app/imports/ui/components/presentations/presentationStyles.mjs'
import { playerSlateCopy } from '../web/app/server/methods/presentationDeck.mjs'
import { copyDocument } from '../web/app/server/actions/slate-copy.mjs'
import { backgroundPicturesIn } from '../web/app/server/actions/slate-operations.mjs'
import { followsTheme } from '../web/app/imports/ui/common/canvasTheme.mjs'
import { slateOfLayout, whatIsSlatebox } from './presentation-fixtures.mjs'

const appRequire = createRequire(new URL('../web/app/package.json', import.meta.url))
const { applyPlanToJSON, backgroundOf, validatePlan } = appRequire('slateboxjs/operations')

const same = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)))
const read = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), 'utf8')

function ownSlate() {
  const slate = slateOfLayout(whatIsSlatebox(), 'What is Slatebox')
  // Words drawn straight on the canvas (a note with no fill): their ink follows the background.
  slate.nodes.push({ options: { id: 'caption', text: 'Read me', xPos: -600, yPos: -400, width: 200, height: 90, backgroundColor: 'transparent', foregroundColor: '#111111' }, relationships: { associations: [] } })
  slate.options.containerStyle = { backgroundColor: '#fafafa' }
  return slate
}
const SUNSET = { type: 'linear', colors: ['#ff7e5f', '#feb47b', '#ffd86f'], angle: 135 }
const PICTURE = { url: '/files/u_aaaaaaaaaaaaaaaaa_abc.jpg', fit: 'contain', dim: 0.4 }

test('the data shape: a color, a gradient or a picture, written in the fields the engine paints and read back the same', () => {
  same(readBackground('#ABCDEF'), { color: '#abcdef', background: null })
  same(readBackground({ gradient: SUNSET }), { color: blend(SUNSET.colors), background: { gradient: SUNSET } })
  same(readBackground({ picture: PICTURE }, { color: '#0b0016' }), { color: '#0b0016', background: { picture: PICTURE } })

  const gradient = withBackground({ backgroundColor: '#ffffff', backgroundImage: '/old.png', backgroundSize: 'repeat', backgroundEffect: 'x' }, '#feb47b', { gradient: SUNSET })
  assert.equal(gradient.backgroundColorAsGradient, true)
  assert.deepEqual(gradient.backgroundGradientColors, SUNSET.colors)
  assert.equal(gradient.backgroundGradientAngle, 135)
  for (const gone of ['backgroundImage', 'backgroundSize', 'backgroundEffect']) assert.equal(gone in gradient, false, gone)
  same(backgroundOf(gradient), { color: '#feb47b', gradient: { type: 'linear', colors: SUNSET.colors, direction: 'diagonal', angle: 135 } })
  same(shownBackground(gradient), { mode: 'gradient', color: '#feb47b', gradient: SUNSET })

  const picture = withBackground(gradient, '#0b0016', { picture: PICTURE })
  assert.equal(picture.backgroundColorAsGradient, false)
  assert.equal('backgroundGradientAngle' in picture, false)
  same(backgroundOf(picture), { color: '#0b0016', picture: PICTURE })
  same(shownBackground(picture), { mode: 'picture', color: '#0b0016', picture: PICTURE })

  const color = withBackground(picture, '#123456', null)
  for (const gone of ['backgroundImage', 'backgroundSize', 'backgroundDim']) assert.equal(gone in color, false, gone)
  same(shownBackground(color), { mode: 'color', color: '#123456' })
  // A saved slate is JSON: no field is left undefined.
  for (const cs of [gradient, picture, color]) assert.equal(Object.values(cs).includes(undefined), false)

  // Radial has no angle; the CSS a swatch shows is the canvas's own.
  same(readBackground({ gradient: { type: 'radial', colors: ['#000000', '#ffffff'], angle: 90 } }).background, { gradient: { type: 'radial', colors: ['#000000', '#ffffff'] } })
  assert.equal(gradientCss(SUNSET), 'linear-gradient(135deg, #ff7e5f, #feb47b, #ffd86f)')
  assert.equal(gradientCss({ type: 'radial', colors: ['#000000', '#ffffff'] }), 'radial-gradient(circle, #000000, #ffffff)')
  // The presets are the styles' own, each with the color its words read on.
  assert.equal(GRADIENT_PRESETS.length, Object.keys(STYLES).length)
  for (const preset of GRADIENT_PRESETS) {
    assert.ok(STYLES[preset.id], preset.id)
    same(readBackground({ gradient: preset.gradient }).background, { gradient: preset.gradient })
  }
  // A gradient or a picture keeps itself in dark mode (only white follows the theme).
  assert.equal(followsTheme(gradient), false)
  assert.equal(followsTheme(picture), false)
})

test('the sanitizer refuses pictures and values that are not safe', () => {
  for (const url of ['http://e.com/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//evil.com/a.jpg', '/files/../secret', 'https://e.com/a.jpg)', 'https://e.com/a"b', "https://e.com/a'b", 'https://e.com/a b', 'files/a.png', '', 'https://e.com/' + 'a'.repeat(2001), null, 7]) {
    assert.equal(isPictureUrl(url), false, String(url))
    assert.throws(() => readBackground({ picture: { url } }), /https address/, String(url))
    assert.equal(cleanBackgroundOverride({ picture: { url } }), null, String(url))
  }
  for (const url of ['https://images.example.com/a.jpg?w=1200&q=80', '/files/u_aaaaaaaaaaaaaaaaa_abc.png', '/sbimages/abc.jpg']) assert.equal(isPictureUrl(url), true, url)
  assert.throws(() => readBackground('red'), /like #/)
  assert.throws(() => readBackground({ color: 'rgb(1,2,3)' }), /like #/)
  for (const gradient of [{ type: 'conic', colors: ['#000000', '#ffffff'] }, { type: 'linear', colors: ['#000000'] }, { type: 'linear', colors: ['#000000', '#111111', '#222222', '#333333'] },
    { type: 'linear', colors: ['#000000', 'red'] }, { type: 'linear', colors: ['#000000', '#ffffff;background:url(x)'] }]) {
    assert.throws(() => readBackground({ gradient }), /two or three colors/, JSON.stringify(gradient))
  }
  // A bad angle is dropped, never drawn.
  same(readBackground({ gradient: { type: 'linear', colors: ['#000000', '#ffffff'], angle: 400 } }).background, { gradient: { type: 'linear', colors: ['#000000', '#ffffff'] } })
  assert.throws(() => readBackground({ gradient: SUNSET, picture: PICTURE }), /not both/)
  // Fit and dim: one of the three fits, dim from 0 to 0.8.
  same(readBackground({ picture: { url: PICTURE.url, fit: 'stretch', dim: 3 } }).background, { picture: { url: PICTURE.url, fit: 'cover', dim: 0.8 } })
  // The style record keeps only a safe background, and only one of the two.
  same(cleanStyleRef({ id: 'neon', overrides: { bg: '#0b0016', background: { picture: { url: 'http://e.com/a.jpg' } } } }), { id: 'neon', overrides: { bg: '#0b0016' } })
  same(cleanStyleRef({ id: 'neon', overrides: { background: { gradient: SUNSET, picture: PICTURE } } }), { id: 'neon' })
  same(cleanStyleRef({ id: 'neon', overrides: { background: { gradient: SUNSET } } }), { id: 'neon', overrides: { background: { gradient: SUNSET } } })
  assert.equal(resolveStyle({ id: 'neon', overrides: { background: { gradient: { type: 'linear', colors: ['javascript:1', '#000000'] } } } }).background, null)
})

test('a gradient set by hand is part of the style: worn again it stays, another style brings its own, Remove keeps it, Revert takes it back', () => {
  const plain = ownSlate()
  const worn = wearStyle(plain, { id: 'neon' }, { ambient: true }).slate
  const painted = setSlateBackground(worn, { gradient: SUNSET })
  const color = blend(SUNSET.colors)
  same(wornStyle(painted), { id: 'neon', overrides: { bg: color, background: { gradient: SUNSET } }, v: 4 })
  same(shownBackground(painted.options.containerStyle), { mode: 'gradient', color, gradient: SUNSET })
  // Words drawn straight on the canvas take the ink that reads on the gradient's color (dark words on a night sky).
  const night = GRADIENT_PRESETS.find((preset) => preset.id === 'voyage')
  const inked = setSlateBackground(plain, { gradient: night.gradient })
  assert.equal(inked.nodes.find((n) => n.options.id === 'caption').options.fontColor, textOn(night.color))
  assert.notEqual(textOn(night.color), '#111111')
  // The same style again keeps the gradient; another style brings its own color, no gradient.
  same(shownBackground(wearStyle(painted, { id: 'neon' }, { ambient: true }).slate.options.containerStyle), { mode: 'gradient', color, gradient: SUNSET })
  same(shownBackground(wearStyle(painted, { id: 'calm' }, { ambient: true }).slate.options.containerStyle), { mode: 'color', color: STYLES.calm.bg })
  // Remove style keeps the background the slate shows, and every note.
  const removed = takeOffStyle(painted)
  same(shownBackground(removed.options.containerStyle), { mode: 'gradient', color, gradient: SUNSET })
  assert.equal(wornStyle(removed), null)
  // Revert to original: the slate exactly as it was, its plain color back.
  same(revertToOriginal(painted).slate, plain)
  same(revertToOriginal(removed).slate, plain)
  // Back to a color: the record drops the gradient.
  same(wornStyle(setSlateBackground(painted, '#123456')), { id: 'neon', overrides: { bg: '#123456' }, v: 4 })
})

test('a picture set by hand: dimmed with a color, fitted, kept by the style, and Revert restores a picture the slate had before', () => {
  const plain = ownSlate()
  const worn = wearStyle(plain, { id: 'blueprint' }, { ambient: true }).slate
  // With no color given, the picture is dimmed with the slate's color now (the style's).
  const pictured = setSlateBackground(worn, { picture: PICTURE })
  same(wornStyle(pictured), { id: 'blueprint', overrides: { bg: STYLES.blueprint.bg.toLowerCase(), background: { picture: PICTURE } }, v: 4 })
  const cs = pictured.options.containerStyle
  assert.deepEqual([cs.backgroundImage, cs.backgroundSize, cs.backgroundDim, cs.backgroundColorAsGradient], [PICTURE.url, 'contain', 0.4, false])
  // Dimmed with white instead.
  const light = setSlateBackground(pictured, { color: '#ffffff', picture: { ...PICTURE, fit: 'repeat', dim: 0.6 } })
  same(shownBackground(light.options.containerStyle), { mode: 'picture', color: '#ffffff', picture: { ...PICTURE, fit: 'repeat', dim: 0.6 } })
  // Words drawn straight on the canvas take the ink that reads on the color laid over the picture.
  const dark = setSlateBackground(plain, { color: '#000000', picture: { ...PICTURE, dim: 0.6 } })
  assert.equal(dark.nodes.find((n) => n.options.id === 'caption').options.fontColor, textOn('#000000'))
  // Worn again: the picture stays. Revert: the plain slate.
  same(shownBackground(wearStyle(light, { id: 'blueprint' }, { ambient: true }).slate.options.containerStyle).picture, { ...PICTURE, fit: 'repeat', dim: 0.6 })
  same(revertToOriginal(light).slate, plain)

  // A slate that had a picture before its first style gets exactly that picture back.
  const old = ownSlate()
  old.options.containerStyle = { backgroundColor: '#ffffff', backgroundImage: '/images/bg/voyage.jpg', backgroundSize: 'cover' }
  const styled = setSlateBackground(wearStyle(old, { id: 'calm' }, { ambient: true }).slate, { gradient: SUNSET })
  assert.equal(styled.options.containerStyle.backgroundImage, undefined)
  same(revertToOriginal(styled).slate, old)
  // On a slate that wears no style, a picture still keeps the original, and no record is invented.
  const unstyled = setSlateBackground(plain, { picture: PICTURE })
  assert.equal(wornStyle(unstyled), null)
  same(revertToOriginal(unstyled).slate, plain)
})

test('it survives a reload and a copy, the engine and an agent read the same record, and the published player shows no picture of a person\'s', () => {
  const painted = setSlateBackground(wearStyle(ownSlate(), { id: 'neon' }, { ambient: true }).slate, { picture: { ...PICTURE, url: 'https://images.example.com/a.jpg' } })
  // A reload is the saved JSON again.
  same(JSON.parse(JSON.stringify(painted)).options.containerStyle, painted.options.containerStyle)
  // A copy holds the same background and record.
  const copy = copyDocument(painted, { id: 'c1', shareId: 'c1share', user: { _id: 'u1', orgId: null }, now: new Date(0), name: 'Copy' })
  same(copy.options.containerStyle, painted.options.containerStyle)
  same(copy.options.style, painted.options.style)
  // The engine's checks accept the record the app writes (an agent can send it back as update_slate style).
  const plan = { message: 'Done.', operations: [{ kind: 'update_slate', changes: { style: painted.options.style } }] }
  assert.deepEqual(validatePlan(plan).errors, [])
  // The published player gets the gradient's angle, never a person's picture (as for a note's own picture).
  const gradient = setSlateBackground(painted, { gradient: SUNSET })
  assert.equal(JSON.parse(playerSlateCopy(gradient)).options.containerStyle.backgroundGradientAngle, 135)
  assert.doesNotMatch(playerSlateCopy(painted), /images\.example\.com|backgroundImage|backgroundDim/)
})

test('an agent sets a gradient or a picture with the same checks, and the style\'s record moves with it', () => {
  const worn = wearStyle(ownSlate(), { id: 'neon' }, { ambient: true }).slate
  const plan = (background) => ({ message: 'Done.', operations: [{ kind: 'update_slate', changes: { background } }] })
  const ask = { userMessage: 'make the background a picture' }
  const out = applyPlanToJSON(worn, plan({ color: '#0b0016', picture: { url: 'https://images.example.com/a.jpg', fit: 'cover', dim: 0.3 } }), ask).slate
  same(shownBackground(out.options.containerStyle), { mode: 'picture', color: '#0b0016', picture: { url: 'https://images.example.com/a.jpg', fit: 'cover', dim: 0.3 } })
  same(wornStyle(out).overrides, { ...(wornStyle(worn).overrides || {}), bg: '#0b0016', background: { picture: { url: 'https://images.example.com/a.jpg', fit: 'cover', dim: 0.3 } } })
  // What the agent set, worn again from Slate settings, stays.
  assert.equal(wearStyle(out, { id: 'neon' }, { ambient: true }).slate.options.containerStyle.backgroundImage, 'https://images.example.com/a.jpg')
  for (const url of ['http://images.example.com/a.jpg', 'javascript:alert(1)', '//evil.com/a.jpg', 'https://e.com/a.jpg)']) {
    assert.equal(validatePlan(plan({ color: '#000000', picture: { url } }), ask).valid, false, url)
  }
  // On this app a local path must be a picture a person uploaded (the route checks it with photoAllowed).
  assert.deepEqual(backgroundPicturesIn(plan({ color: '#000000', picture: { url: '/files/a.png' } })), ['/files/a.png'])
  assert.deepEqual(backgroundPicturesIn(plan({ color: '#000000' })), [])
  const route = read('server/actions/slate-operations.mjs')
  assert.match(route, /backgroundPicturesIn\(plan\)\.some\(\(url\) => typeof url === 'string' && url\.startsWith\('\/'\) && !deps\.photoAllowed\(url\)\)/)
  assert.match(route, /if \(key === 'background' && applied\.slate\.options\?\.style\) set\['options\.style'\] = applied\.slate\.options\.style/)
})

test('the Background control: Color, Gradient and Picture; upload through the one upload route; a search only where this server has one', () => {
  const panel = read('imports/ui/components/slate/SlateStyle.jsx')
  assert.match(panel, /aria-label="Background kind"/)
  for (const mode of ['color', 'gradient', 'picture']) assert.match(panel, new RegExp(`data-slate-background-mode="${mode}"`))
  assert.match(panel, /<GradientPicker current=\{shown\.mode === 'gradient' \? shown\.gradient : null\}/)
  assert.match(panel, /run\(\(json\) => setSlateBackground\(json, value\), 'style-background'\)/)
  const parts = read('imports/ui/components/slate/StyleBackground.jsx')
  assert.match(parts, /import uploadImage from '..\/..\/..\/api\/client\/uploadImage'/)
  assert.match(read('imports/api/client/uploadImage.js'), /xhr\.open\('POST', '\/sbupload\/image'\)/)
  assert.match(read('imports/ui/components/brand/LogoField.jsx'), /uploadImage\(file, setProgress\)/)
  // The search box is shown only when the server says it can search; the server says so without any key.
  assert.match(parts, /Meteor\.callAsync\(CONSTANTS\.methods\.images\.searchReady\)/)
  assert.match(parts, /\{searchReady && \(/)
  const images = read('server/methods/images.js')
  const ready = images.slice(images.indexOf('method[CONSTANTS.methods.images.searchReady]'), images.indexOf('async function searchForNote'))
  assert.match(ready, /if \(!user \|\| user\.isAnonymous\) return false/)
  assert.match(ready, /return Boolean\(keys\?\.apiKey && keys\?\.engineKey\)/)
  // Found pictures are offered only when a background may show them; the dim starts where words read.
  assert.match(parts, /filter\(\(item\) => isPictureUrl\(item\.link\)\)/)
  assert.ok(DIM_DEFAULT > 0 && DIM_DEFAULT <= 0.5)
  // Greenfield: none of the old Custom block comes back as it was.
  for (const source of [panel, parts]) assert.doesNotMatch(source, /As Gradient|Complementary|Shades|>Repeat|>Stretch|pixabay|SlateColors|SlateBackgrounds|cacheImage|searchBackgroundImages/i)
  // Copy: sentence case, US spelling, "agent" not "AI".
  assert.doesNotMatch(parts, /colour|AI use|Use This|Upload A/)
})
