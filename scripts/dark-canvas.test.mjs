// Polish slice 2, "Dark mode all the way" (work-polish/audit.md #1): in dark mode the canvas is
// dark too. A slate whose background nobody chose (white, the default every slate was made with)
// follows the theme; a slate with its own colour, gradient or picture keeps it. Ink that would
// vanish on the dark canvas (black text on a clear note, a dark line) is shown lifted, never
// saved; the board's own ink, the minimap and the zoom controls take dark tokens; the presenter,
// the share page and My slates' pictures follow the same rule; and note text meets AA in both modes.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  CANVAS, DEFAULT_NOTE, LEGACY_DEFAULT_NOTE, BOARD_INK, BOARD_CARD, parseColor, contrast, followsTheme, canvasMode, liftInk, mix, toHex, resolveMode,
  inkCanvas, withNativeInk,
} from '../web/app/imports/ui/common/canvasTheme.mjs'
import { JSDOM } from 'jsdom'

const app = (path) => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const ui = (path) => app('imports/ui/' + path)

test('colours parse from the forms the engine writes', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 })
  assert.deepEqual(parseColor('#14201B'), { r: 20, g: 32, b: 27, a: 1 })
  assert.deepEqual(parseColor('#00000080'), { r: 0, g: 0, b: 0, a: 128 / 255 })
  assert.deepEqual(parseColor('rgba(255, 255, 255, 0.87)'), { r: 255, g: 255, b: 255, a: 0.87 })
  assert.deepEqual(parseColor('rgb(29 43 42)'), { r: 29, g: 43, b: 42, a: 1 })
  assert.deepEqual(parseColor('white'), { r: 255, g: 255, b: 255, a: 1 })
  assert.deepEqual(parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 })
  assert.equal(parseColor('none'), null)
  assert.equal(parseColor('url(#grad)'), null)
  assert.equal(parseColor(undefined), null)
})

test('a background nobody chose follows the theme; a chosen one is kept', () => {
  // Every slate so far was made with #ffffff and an inactive shades gradient: that is the default.
  const made = { backgroundColor: '#ffffff', backgroundImage: null, backgroundColorAsGradient: false,
    backgroundGradientColors: ['#ffffff', '#f0f0f0', '#e1e1e1', '#d2d2d2', '#c3c3c3'] }
  assert.equal(followsTheme(made), true)
  assert.equal(followsTheme(undefined), true)
  assert.equal(followsTheme({}), true)
  assert.equal(followsTheme({ backgroundColor: '' }), true)
  assert.equal(followsTheme({ backgroundColor: '#FFF' }), true)
  assert.equal(followsTheme({ backgroundColor: 'white' }), true)
  assert.equal(followsTheme({ backgroundColor: 'rgb(255, 255, 255)' }), true)
  assert.equal(followsTheme('#ffffff'), true, 'the presenter passes the colour alone')
  // Chosen: any other colour, an active gradient, a picture.
  assert.equal(followsTheme({ backgroundColor: '#f0f0f0' }), false)
  assert.equal(followsTheme({ backgroundColor: '#1a1a2e' }), false)
  assert.equal(followsTheme('#fdf3e1'), false)
  assert.equal(followsTheme({ ...made, backgroundColorAsGradient: true }), false)
  assert.equal(followsTheme({ ...made, backgroundImage: '/images/paper.jpg' }), false)
  // A gradient flag with fewer than two colours draws no gradient (Slate.applyContainerStyle).
  assert.equal(followsTheme({ backgroundColor: '#ffffff', backgroundColorAsGradient: true, backgroundGradientColors: ['#ffffff'] }), true)
})

test('the canvas is dark only in dark mode, and only for a slate that follows the theme', () => {
  assert.equal(canvasMode('dark', { backgroundColor: '#ffffff' }), 'dark')
  assert.equal(canvasMode('light', { backgroundColor: '#ffffff' }), 'light')
  assert.equal(canvasMode('dark', { backgroundColor: '#fdf3e1' }), null, 'an author\'s colour is left alone')
  assert.equal(canvasMode('light', { backgroundColor: '#fdf3e1' }), null)
  assert.equal(resolveMode('system', 'dark'), 'dark')
  assert.equal(resolveMode('system', undefined), 'light')
  assert.equal(resolveMode(undefined, undefined), 'light')
  assert.equal(resolveMode('dark', 'light'), 'dark')
})

test('the dark canvas sits a step below the dark chrome and every ink on it reads', () => {
  assert.equal(CANVAS.light.background, '#ffffff')
  assert.equal(CANVAS.dark.background, '#14201b')
  const bg = CANVAS.dark.background
  assert.ok(contrast(CANVAS.dark.ink, bg) >= 7, 'text ink is AAA on the dark canvas')
  assert.ok(contrast(CANVAS.dark.line, bg) >= 3, 'a default line reads as a graphic')
  // The board's own ink (axis labels, grid, bars) as CSS custom properties the engine reads.
  for (const [name, color] of Object.entries(BOARD_INK.dark)) {
    assert.match(name, /^--slatebox-board-/)
    if (name === '--slatebox-board-track') continue
    const min = /grid|week/.test(name) ? 1.4 : name === '--slatebox-board-ink' ? 7 : 3
    assert.ok(contrast(color, bg) >= min, `${name} ${color} on the dark canvas: ${contrast(color, bg).toFixed(2)}`)
  }
  // The track (a plan's weekends, at 70%, over its lanes) sits below the canvas, as weekends are the muted columns
  // in light mode, and the band still reads against every lane it crosses (each lane its pastel at 18%).
  const track = BOARD_INK.dark['--slatebox-board-track']
  const darkness = (c) => contrast(c, '#000000')
  assert.ok(darkness(track) < darkness(bg), `${track} is darker than the canvas`)
  for (const pastel of ['#d5e9e3', '#fbdfac', '#dedef4', '#dcebf3', '#efd7dc']) {
    const lane = mix(pastel, bg, 0.18)
    const band = mix(track, lane, 0.7)
    assert.ok(darkness(band) < darkness(lane) && contrast(band, lane) >= 1.4, `weekend on ${pastel}: ${contrast(band, lane).toFixed(2)}`)
  }
  assert.deepEqual(Object.keys(BOARD_INK.dark).sort(), ['--slatebox-board-accept', '--slatebox-board-bar', '--slatebox-board-grid',
    '--slatebox-board-ink', '--slatebox-board-launch', '--slatebox-board-refuse', '--slatebox-board-track', '--slatebox-board-week'])
})

test('ink that would vanish on the dark canvas is lifted; ink that reads is left as it is', () => {
  const bg = CANVAS.dark.background
  // Black text on a clear note becomes the canvas's own light ink.
  assert.equal(liftInk('#000000', bg, 4.5), CANVAS.dark.ink)
  assert.equal(liftInk('#333', bg, 4.5), CANVAS.dark.ink)
  // A dark line becomes the canvas's line ink: quieter than text, still a clear 3:1 and more.
  assert.equal(liftInk('#333', bg, 3, CANVAS.dark.line), CANVAS.dark.line)
  // A coloured ink keeps its hue, made light enough to read.
  const blue = liftInk('#2f5fd0', bg, 3)
  assert.ok(blue && contrast(blue, bg) >= 3, `lifted blue reads: ${blue}`)
  const { r, b } = parseColor(blue)
  assert.ok(b > r, 'still blue')
  const red = liftInk('#8b1a1a', bg, 4.5)
  assert.ok(contrast(red, bg) >= 4.5 && parseColor(red).r > parseColor(red).b, `lifted red reads and stays red: ${red}`)
  // Already readable, or invisible on purpose: untouched.
  assert.equal(liftInk('#ffffff', bg, 4.5), null)
  assert.equal(liftInk('#f2ce8b', bg, 4.5), null)
  assert.equal(liftInk('transparent', bg, 4.5), null)
  assert.equal(liftInk('url(#g)', bg, 4.5), null)
  // On the light canvas the same inks already read.
  assert.equal(liftInk('#000000', CANVAS.light.background, 4.5), null)
  assert.equal(toHex(mix('#000000', '#ffffff', 0.5)), '#808080')
})

test('note text meets AA in both modes: the default note, and the old default shown as the new one', () => {
  assert.ok(contrast(DEFAULT_NOTE.foregroundColor, DEFAULT_NOTE.backgroundColor) >= 4.5,
    `default note text: ${contrast(DEFAULT_NOTE.foregroundColor, DEFAULT_NOTE.backgroundColor).toFixed(2)}`)
  // The note stands off both canvases (a non-text contrast of 3:1).
  assert.ok(contrast(DEFAULT_NOTE.backgroundColor, CANVAS.light.background) >= 3)
  assert.ok(contrast(DEFAULT_NOTE.backgroundColor, CANVAS.dark.background) >= 3)
  // The old default failed AA (about 2.9:1); slates that still carry it are drawn with the new one.
  assert.ok(contrast('#ffffff', LEGACY_DEFAULT_NOTE.backgroundColor) < 4.5)
  assert.equal(LEGACY_DEFAULT_NOTE.backgroundColor, '#699bc3')
  // New slates make their first note from the shared default.
  const create = app('imports/api/client/createSlate.js')
  assert.match(create, /import \{ DEFAULT_NOTE \} from '\.\.\/\.\.\/ui\/common\/canvasTheme\.mjs'/)
  assert.match(create, /backgroundColor: DEFAULT_NOTE\.backgroundColor/)
  assert.match(create, /foregroundColor: DEFAULT_NOTE\.foregroundColor/)
  assert.doesNotMatch(create, /#699bc3|rgba\(255, 255, 255, 0\.87\)/)
  // The stored background stays white: it is what "follows the theme" means, and exports stay as they were.
  assert.match(create, /let bgColors = \['#ffffff'/)
})

test('every surface that draws a slate follows the same rule', () => {
  const hook = ui('common/useCanvasTheme.js')
  assert.match(hook, /useColorScheme/)
  assert.match(hook, /themeCanvas\(/)
  // The canvas page (the share page is the same page for a reader), My slates' pictures, the presenter and a published presentation.
  assert.match(ui('pages/Canvas.jsx'), /useCanvasTheme\(canvasRef, \(\) => \(slate\.current\?\.v2 \?\? slate\.current\)\?\.options\?\.containerStyle\)/)
  assert.match(ui('components/SnapSlate.jsx'), /useCanvasTheme\(/)
  assert.match(ui('components/presentations/PresenterFrame.jsx'), /useCanvasTheme\(/)
  assert.match(ui('components/PresentPublishedSlate.jsx'), /useCanvasTheme\(/)
})

test('the dark canvas tokens reach the minimap, the zoom controls, the board and the lanes', () => {
  const css = ui('common/main.css')
  assert.match(css, /\[data-sb-canvas=dark\]\{[^}]*background-color:var\(--sb-canvas-bg\)!important/)
  // The board's dark ink is set on the canvas from BOARD_INK, one list for the code and the page.
  assert.match(ui('common/canvasTheme.mjs'), /\{ '--sb-canvas-bg': CANVAS\.dark\.background, \.\.\.BOARD_INK\.dark \}/)
  assert.doesNotMatch(css, /--slatebox-board-ink:/)
  // The dark minimap rules carry the canvas's id: the #slateCanvas base rules would outrank them otherwise.
  assert.match(css, /#slateCanvas\[data-sb-canvas=dark\] \.slateboxjs-birdseye\{/)
  assert.match(css, /#slateCanvas\[data-sb-canvas=dark\] \.slateboxjs-birdseye > svg > rect:first-child\{fill:var\(--sb-canvas-bg\)\}/)
  assert.match(css, /#slateCanvas\[data-sb-mode=dark\] \.slateboxjs-birdseye-viewport\{[^}]*stroke:#f2ce8b/)
  assert.match(css, /#slateCanvas\[data-sb-canvas=dark\] \.slateboxjs-birdseye-zoom-controls/)
  assert.match(css, /#slateCanvas\[data-sb-canvas=dark\] \.slatebox-zoom-slider\{/)
  assert.doesNotMatch(css, /^\[data-sb-(canvas|mode)=dark\] \.slate(boxjs-birdseye|box-zoom)/m)
  // Lane columns: their own pastel at about 18%, so a board reads as lanes on the dark canvas, not white slabs.
  assert.match(css, /\[data-sb-canvas=dark\] g\[data-node-id\^="column-"\] \[data-node-background-path\]\{fill-opacity:\.18/)
})

const dom = (body) => new JSDOM(`<!doctype html><body><div id="slateCanvas">${body}</div></body>`).window.document

test('a copy of the drawing holds the slate\'s own colours, never the ink lifted for the dark canvas', () => {
  const doc = dom(`<svg><g data-node-id="t"><path data-node-background-path fill="#ffffff" opacity="0"></path>
    <text fill="#000000">A text note</text></g><path data-connection-id="l" stroke="#333333"></path></svg>`)
  const canvas = doc.getElementById('slateCanvas')
  inkCanvas(canvas, 'dark')
  const text = canvas.querySelector('text'); const line = canvas.querySelector('[data-connection-id]')
  assert.equal(text.style.getPropertyValue('fill'), CANVAS.dark.ink)
  assert.equal(line.style.getPropertyValue('stroke'), CANVAS.dark.line)
  const before = canvas.innerHTML
  // The engine clones the live canvas synchronously when an export starts.
  const copy = withNativeInk(() => canvas.querySelector('svg').cloneNode(true).outerHTML, doc)
  assert.doesNotMatch(copy, /eef1e8|a9bcab|data-sb-ink/i)
  assert.match(copy, /fill="#000000"/)
  // And the canvas is shown as it was, at once.
  assert.equal(canvas.innerHTML, before)
  // A promise comes back as it is (the clone is already made).
  const p = Promise.resolve(1)
  assert.equal(withNativeInk(() => p, doc), p)
  // Nothing painted: the call simply runs.
  assert.equal(withNativeInk(() => 'ok', dom('')), 'ok')
})

test('every copy of the live drawing is made inside withNativeInk', () => {
  const canvas = ui('pages/Canvas.jsx')
  assert.match(canvas, /withNativeInk\(\(\) => \(s\.v2 \?\? s\)\.svg\(opts, /)
  assert.match(canvas, /withNativeInk\(\(\) => s\[type\]\(opts, cb\)\)/)
  // Download PNG saves the picture (it used to ask for one and drop it).
  assert.match(ui('components/slate/SlateExport.jsx'), /onExport\('png', \{\}, \(dataUrl\) => \{/)
  assert.match(canvas, /withNativeInk\(\(\) => slate\.current\.png\(\{ base64: true \}/)
  assert.match(canvas, /withNativeInk\(\(\) => window\.slate\.pngSync\(/)
  const bar = ui('components/stylebar/NoteBar.jsx')
  assert.match(bar, /withNativeInk\(\(\) => v2\.png\(/)
  assert.match(bar, /withNativeInk\(\(\) => v2\.svg\(/)
  assert.match(ui('components/presentations/prepareSlateSurface.js'), /await withNativeInk\(\(\) => exportPresentationSvg\(/)
})

test('a plan\'s white task bars take the dark card surface; its weekends stay the muted columns', () => {
  const doc = dom(`<svg><g data-node-id="card-design"><path data-node-background-path fill="#fffdf6" stroke="#667872"></path>
    <text fill="#1d2b2a">Design · 4d</text></g>
    <g data-node-id="card-late"><path data-node-background-path fill="#fde3d7" stroke="#c2410c"></path><text fill="#1d2b2a">Late</text></g>
    <g data-node-id="lane-product"><path data-node-background-path fill="#ffffff"></path><text fill="#1d2b2a">Product</text></g></svg>`)
  const canvas = doc.getElementById('slateCanvas')
  inkCanvas(canvas, 'dark')
  const bar = canvas.querySelector('[data-node-id="card-design"] path')
  assert.equal(bar.style.getPropertyValue('fill'), BOARD_CARD.dark.fill)
  assert.ok(contrast(bar.style.getPropertyValue('stroke'), BOARD_CARD.dark.fill) >= 3)
  const words = canvas.querySelector('[data-node-id="card-design"] text').style.getPropertyValue('fill')
  assert.ok(contrast(words, BOARD_CARD.dark.fill) >= 4.5, words)
  // Painted the same on the next pass (judged on the colour the engine drew), and gone in light mode.
  inkCanvas(canvas, 'dark')
  assert.equal(bar.style.getPropertyValue('fill'), BOARD_CARD.dark.fill)
  // A late bar keeps its warning colour; a note that is not a card keeps its own white.
  assert.equal(canvas.querySelector('[data-node-id="card-late"] path').style.getPropertyValue('fill'), '')
  assert.equal(canvas.querySelector('[data-node-id="lane-product"] path').style.getPropertyValue('fill'), '')
  inkCanvas(canvas, 'light')
  assert.equal(bar.style.getPropertyValue('fill'), '')
  assert.equal(canvas.querySelectorAll('[data-sb-ink]').length, 0)
  // The bar stands off the canvas, and the weekend band (the track at 70%) is darker than the canvas.
  assert.ok(contrast(BOARD_CARD.dark.fill, CANVAS.dark.background) > 1.5)
  for (const pastel of ['#d5e9e3', '#fbdfac', '#dedef4']) {
    const lane = mix(pastel, CANVAS.dark.background, 0.18)
    assert.ok(contrast(BOARD_CARD.dark.fill, '#000000') > contrast(lane, '#000000'), `a bar is raised above the ${pastel} lane`)
  }
  const weekend = mix(BOARD_INK.dark['--slatebox-board-track'], CANVAS.dark.background, 0.7)
  assert.ok(contrast(weekend, '#000000') < contrast(CANVAS.dark.background, '#000000'), toHex(weekend))
})

// Presentation styles: a styled deck keeps its own style's backdrop and ink in both modes, in the
// presenter and on the share page. A style's backdrop is never the default white, and a styled
// deck is never themed at all (a custom style may set its own white).
test('a styled deck keeps its style\'s backdrop in both modes, in the presenter and on the share page', async () => {
  const { STYLES, resolveStyle } = await import('../web/app/imports/ui/components/presentations/presentationStyles.mjs')
  for (const [id, style] of Object.entries(STYLES)) {
    assert.equal(followsTheme(style.bg), false, `${id}'s backdrop is its own`)
    assert.equal(canvasMode('dark', resolveStyle(id).bg), null, `${id} is not darkened`)
  }
  const frame = ui('components/presentations/PresenterFrame.jsx')
  assert.match(frame, /useCanvasTheme\(\(\) => \(immersive \? null : stage\)/, 'the presenter does not theme an immersive (styled) deck')
  assert.match(frame, /const surface = !immersive && canvasMode\(/, 'nor swap its backdrop for the dark canvas')
  const share = ui('components/PresentPublishedSlate.jsx')
  assert.match(share, /published && !published\.styled \? document\.getElementById\(surfaceId\) : null/, 'the share page does not theme a styled deck')
  assert.match(share, /styled \? resolveStyle\(styled\.deck\.style\)\.bg : bg/, 'the share page paints a styled deck in its style\'s colour')
})
