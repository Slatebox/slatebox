// A slate's card on My slates is drawn on the background its canvas opens on (2026-11-25: a first-run
// "Pipeline" board, stored without a background, showed its notes on white while its canvas wore the
// team's gold radial gradient; empty "Untitled slate" cards, which store that gradient, were gold).
//
// The canvas starts on the team's style (the brand kit's default preset) and a slate's own containerStyle
// replaces it when the slate is loaded (the engine's deserialize; slateboxjs tests/unit/slate-background).
// The card asks the same question of the same function (slateBackground.mjs).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  backgroundColors, defaultContainerStyle, presetContainerStyle, shownContainerStyle,
} from '../web/app/imports/api/common/slateBackground.mjs'
import { followsTheme } from '../web/app/imports/ui/common/canvasTheme.mjs'

const read = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), 'utf8')

const GOLD = ['#fbcc87', '#ecc07f', '#ddb477', '#cfa86f', '#c09c67', '#b1905f', '#a28457', '#94784f']
// The team style as the brand kit stores it (a radial gradient of eight shades).
const goldPreset = {
  background: {
    activeType: 'gradient',
    colorKey: null,
    colorValue: null,
    gradientConfig: { gradientColorCount: 8, gradientType: 'radial', gradientStrategy: 'shades', gradientColors: GOLD, baseColorValue: '#FBCC87' },
  },
}
const neon = { backgroundColor: '#0b0016', backgroundColorAsGradient: false }

test('a slate stored without a background is drawn on the team\'s style, as its canvas is: gold, radial, every shade', () => {
  const cs = shownContainerStyle(undefined, goldPreset)
  assert.equal(cs.backgroundColor, '#FBCC87')
  assert.equal(cs.backgroundColorAsGradient, true)
  assert.equal(cs.backgroundGradientType, 'radial')
  assert.deepEqual(cs.backgroundGradientColors, GOLD)
  assert.equal(followsTheme(cs), false, 'the gold keeps itself in dark mode too')
  assert.deepEqual(shownContainerStyle(null, goldPreset), cs)
})

test('a slate that keeps its own background is drawn on it, whatever the team\'s style', () => {
  assert.deepEqual(shownContainerStyle(neon, goldPreset), neon)
  const storedGold = { ...presetContainerStyle(goldPreset) }
  assert.deepEqual(shownContainerStyle(storedGold, null), storedGold)
  const solid = { backgroundColor: '#f3f1e4' }
  assert.deepEqual(shownContainerStyle(solid, goldPreset), solid)
  const picture = { backgroundColor: '#ffffff', backgroundImage: '/images/bg/voyage.jpg', backgroundSize: 'cover' }
  assert.deepEqual(shownContainerStyle(picture, goldPreset), picture)
  // A stored style without a colour is drawn on white beneath its gradient or picture, as cards always were.
  assert.equal(shownContainerStyle({ backgroundColorAsGradient: false }, goldPreset).backgroundColor, '#ffffff')
})

test('with no team style, a slate stored without a background is white, the background nobody chose', () => {
  const cs = shownContainerStyle(undefined, null)
  assert.deepEqual(cs, defaultContainerStyle())
  assert.equal(followsTheme(cs), true, 'white follows the app into dark mode, on the card as on the canvas')
})

test('a team\'s solid colour, a gradient saved without its shades, and a style with no background', () => {
  const solid = presetContainerStyle({ background: { activeType: 'color', colorValue: '#204060' } })
  assert.equal(solid.backgroundColor, '#204060')
  assert.equal(solid.backgroundColorAsGradient, false)
  assert.deepEqual(backgroundColors(solid), ['#204060'])
  const bare = presetContainerStyle({ background: { activeType: 'gradient', gradientConfig: { baseColorValue: '#abcdef', gradientType: 'radial' } } })
  assert.equal(bare.backgroundColor, '#abcdef')
  assert.equal(bare.backgroundColorAsGradient, false)
  assert.deepEqual(backgroundColors(bare), ['#abcdef'])
  assert.deepEqual(presetContainerStyle({ categoryFont: 'Inter' }), defaultContainerStyle())
  assert.deepEqual(backgroundColors(presetContainerStyle(goldPreset)), GOLD)
  assert.deepEqual(backgroundColors(defaultContainerStyle()), ['#ffffff', '#f0f0f0', '#e1e1e1', '#d2d2d2', '#c3c3c3'])
})

test('the canvas and the card take the background from the one function', () => {
  const create = read('imports/api/client/createSlate.js')
  assert.match(create, /presetContainerStyle\(defaultPreset\?\.value\)/)
  assert.doesNotMatch(create, /presetBg\.gradientConfig/, 'the preset is read in slateBackground.mjs only')

  const snap = read('imports/ui/components/SnapSlate.jsx')
  assert.match(snap, /shownContainerStyle\(stored, team\)/)
  assert.match(snap, /teamSlateStyle\(\)/)
  // No white put under a slate that has no background of its own.
  assert.doesNotMatch(snap, /containerStyle: \{ backgroundColor: '#ffffff', \.\.\.copy\.options\?\.containerStyle \}/)
  // Light or dark is judged on the background the card is drawn on.
  assert.match(snap, /useCanvasTheme\(box, \(\) => shown\.current\)/)

  const team = read('imports/api/client/teamSlateStyle.js')
  assert.match(team, /DEFAULT_PRESET_QUERY/)
  assert.match(team, /defaultPreset\(settings\)\?\.value/)
})
