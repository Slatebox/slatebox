// The slate IS the presentation (owner, 2026-11-25). A slate wears a style (options.style, one slate property that
// replaced themes): its background, its notes' outlines, fills, fonts and colors, its lines, and the style's art
// (title cards, kickers, numbers, quotes, captions, bolts, bursts, ribbons, stars, grids) as real notes on the canvas.
// Present only frames, flies, dims and reveals those notes (deck version 5) and draws nothing of its own.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { DEFAULT_FONTS, validatePlan } from 'slateboxjs/operations'
import {
  BAKED_DECK_VERSION, DECOR_ROLES, STYLE_ROLES, cameraDeck, isStyleArt, playableDeck, styleRecord, takeOffStyle, wearStyle, wordsOf, wornStyle,
} from '../web/app/imports/ui/components/presentations/presentationBake.mjs'
import { STYLES, STYLE_IDS } from '../web/app/imports/ui/components/presentations/presentationStyles.mjs'
import { emphasis, presentedSlate } from '../web/app/imports/ui/components/presentations/livePresenter.mjs'
import { playerSlateCopy, sanitizeBakedDeck } from '../web/app/server/methods/presentationDeck.mjs'
import { storedSlateLayout } from '../web/app/server/methods/presentationLayout.mjs'
import { showcasePresentations } from '../web/app/server/library/showcase/presentations.mjs'
import { slateOfLayout, whatIsSlatebox } from './presentation-fixtures.mjs'

const app = fileURLToPath(new URL('../web/app/', import.meta.url))
const read = (path) => readFileSync(join(app, path), 'utf8')
const boxOf = (node) => ({ x: node.options.xPos, y: node.options.yPos, width: node.options.width, height: node.options.height })
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
// Layering a style means on purpose (a backdrop behind a title, the route behind the map, stars behind everything).
const BEHIND = new Set(['decor', 'backdrop', 'route', 'ribbon'])
const wearSix = () => showcasePresentations.map((entry) => ({ entry, ...wearStyle(entry.slate, { id: entry.look.style }, { direction: entry.look.direction, name: entry.title }) }))

test('the six decks wear their styles with nothing on top of anything: zero overlapping notes across all steps', () => {
  for (const { entry, slate } of wearSix()) {
    const solid = slate.nodes.filter((node) => !BEHIND.has(node.options.styleRole))
    const hits = []
    for (let i = 0; i < solid.length; i += 1) for (let j = i + 1; j < solid.length; j += 1) if (overlaps(boxOf(solid[i]), boxOf(solid[j]))) hits.push(`${solid[i].options.id} × ${solid[j].options.id}`)
    assert.deepEqual(hits, [], entry.slug)
    assert.ok(slate.nodes.length < 5000, entry.slug)
  }
})

test('each step frames what it lights and reveals; a worn deck has one geometry and fonts the instance offers', () => {
  for (const { entry, slate, deck } of wearSix()) {
    assert.equal(deck.version, BAKED_DECK_VERSION)
    const byId = new Map(slate.nodes.map((node) => [node.options.id, node]))
    deck.steps.forEach((step, index) => {
      const pad = Math.max(step.box.width, step.box.height) * 0.02
      for (const id of step.own) {
        const b = boxOf(byId.get(id))
        assert.ok(b.x >= step.box.x - pad && b.y >= step.box.y - pad && b.x + b.width <= step.box.x + step.box.width + pad && b.y + b.height <= step.box.y + step.box.height + pad, `${entry.slug} step ${index}: ${id} in frame`)
      }
      for (const id of [...step.own, ...step.hide, ...(step.lit === 'all' ? [] : step.lit)]) assert.ok(byId.has(id), `${entry.slug} step ${index}: ${id} is a note of the slate`)
    })
    for (const node of slate.nodes) {
      assert.equal(node.options.p, undefined, `${entry.slug}: no phone geometry`)
      if (node.options.fontFamily && node.options.text) assert.ok(DEFAULT_FONTS.includes(node.options.fontFamily) || /arial/i.test(node.options.fontFamily), `${entry.slug}: ${node.options.fontFamily}`)
      if (node.options.styleRole) assert.ok(STYLE_ROLES.includes(node.options.styleRole), node.options.styleRole)
      if (node.options.shape === 'custom') assert.ok(node.options.vectorPath && node.options.shapeRef, `${entry.slug}: ${node.options.id} is a checked custom shape`)
    }
    // Captions and kickers are real notes, revealed with their step.
    assert.ok(slate.nodes.some((node) => node.options.styleRole === 'caption'), entry.slug + ': captions are notes')
    // Decoration is locked (unlock to edit); words are ordinary notes.
    for (const node of slate.nodes.filter(isStyleArt)) assert.equal(Boolean(node.options.isLocked), DECOR_ROLES.includes(node.options.styleRole), node.options.id)
  }
})

test('every style wears onto a slate: background, record, skin on the notes, idempotent, A then B keeps every word of A', () => {
  const plain = slateOfLayout(whatIsSlatebox(), 'What is Slatebox')
  const words = (doc) => doc.nodes.map((node) => wordsOf(node.options.text)).filter(Boolean)
  for (const id of STYLE_IDS) {
    const { slate } = wearStyle(plain, { id })
    assert.equal(slate.options.containerStyle.backgroundColor, STYLES[id].bg, id)
    assert.deepEqual(slate.options.style, { id, v: 4 }, id)
    assert.deepEqual(wornStyle(slate), { id, v: 4 })
    for (const source of plain.nodes) {
      const mine = slate.nodes.find((node) => node.options.id === source.options.id)
      assert.equal(mine.options.text, source.options.text, `${id}: words kept`)
      assert.ok(mine.options.fontFamily && mine.options.fontFamily !== source.options.fontFamily || mine.options.backgroundColor !== source.options.backgroundColor, `${id}: ${source.options.id} wears the style`)
    }
    // Wearing it again changes nothing; wearing another style over it replaces only A's wordless decoration.
    assert.deepEqual(wearStyle(slate, { id }).slate, slate, `${id}: idempotent`)
    const other = STYLE_IDS[(STYLE_IDS.indexOf(id) + 1) % STYLE_IDS.length]
    const over = wearStyle(slate, { id: other }).slate
    const decorOfA = slate.nodes.filter((node) => isStyleArt(node) && !wordsOf(node.options.text)).map((node) => node.options.id)
    const fresh = new Set(wearStyle(plain, { id: other }).slate.nodes.map((node) => node.options.id))
    assert.deepEqual(over.nodes.filter((node) => decorOfA.includes(node.options.id) && !fresh.has(node.options.id)).map((node) => node.options.id), [], `${id} → ${other}: none of ${id}'s decoration left`)
    const after = words(over)
    for (const said of words(slate)) assert.ok(after.includes(said), `${id} → ${other}: "${said}" kept`)
    // Removing it takes off the decoration and the record; every note with words stays, as a plain note.
    const off = takeOffStyle(slate)
    assert.equal(off.nodes.filter(isStyleArt).length, 0)
    assert.equal(off.options.style, undefined)
    assert.deepEqual(words(off).sort(), words(slate).sort())
    for (const source of plain.nodes) assert.ok(off.nodes.some((node) => node.options.id === source.options.id))
  }
})

test('worn from the slate settings (no presentation), a style brings its look and its decoration, no invented words', () => {
  const plain = slateOfLayout(whatIsSlatebox(), 'What is Slatebox')
  const { slate, deck } = wearStyle(plain, { id: 'voyage' }, { ambient: true })
  assert.equal(deck, null)
  const art = slate.nodes.filter(isStyleArt)
  assert.ok(art.length > 0, 'the star field and orbits come')
  assert.ok(art.every((node) => node.options.styleRole === 'decor' && !node.options.text))
})

test('the style record is what the engine contract accepts (update_slate style)', () => {
  for (const id of STYLE_IDS) {
    const plan = { message: 'wear', operations: [{ kind: 'update_slate', changes: { style: styleRecord({ id }) } }] }
    assert.deepEqual(validatePlan(plan).errors, [], id)
  }
})

test('the layout Present plans from never counts a worn style\'s art as the slate\'s notes', () => {
  const entry = showcasePresentations[0]
  const { slate } = wearStyle(entry.slate, { id: entry.look.style }, { direction: entry.look.direction })
  const ids = []
  const walk = (list) => (list || []).forEach((node) => { ids.push(node.nodeId); walk(node.childrenNodes) })
  walk(storedSlateLayout(slate).nodes)
  assert.deepEqual(ids.sort(), entry.slate.nodes.map((node) => node.options.id).sort())
})

test('Present draws nothing of its own: the player loads the slate unchanged, and only dims, hides and reveals its notes', () => {
  const { slate, deck } = wearSix()[0]
  const presented = presentedSlate(slate)
  // Every field that draws anything is the slate's own (only interaction flags are added).
  const LOOK = ['xPos', 'yPos', 'width', 'height', 'backgroundColor', 'fontFamily', 'fontSize', 'fontColor', 'foregroundColor', 'vectorPath', 'shape', 'image', 'text', 'opacity', 'rotate', 'styleRole']
  presented.nodes.forEach((node, index) => LOOK.forEach((key) => assert.deepEqual(node.options[key], slate.nodes[index].options[key], `${node.options.id}.${key}`)))
  assert.deepEqual(presented.options.containerStyle, slate.options.containerStyle)
  assert.equal(presented.nodes.length, slate.nodes.length, 'no note added by the player')
  const ids = slate.nodes.map((node) => node.options.id)
  deck.steps.forEach((step, index) => {
    const levels = emphasis(deck, index, ids)
    assert.deepEqual([...levels.keys()], ids)
    for (const value of levels.values()) assert.ok(value >= 0 && value <= 1)
    for (const id of step.own) assert.equal(levels.get(id), 1, `step ${index}: its own notes are lit`)
  })
  // The player's code has none of the old drawing: no skin, stage notes, painted background, caption overlay, step
  // dots, phone geometry or web-font link.
  for (const file of ['imports/ui/components/presentations/livePresenter.mjs', 'imports/ui/components/presentations/LiveStage.jsx', 'imports/ui/components/presentations/BasePresent.jsx', 'imports/ui/components/PresentPublishedSlate.jsx', 'imports/ui/components/presentations/FollowPresentation.jsx']) {
    const source = read(file)
    assert.doesNotMatch(source, /stageNotes|deck\.skin|sbp-cap|sbp-route|fonts\.googleapis|style\.bg\b|composeDeck|resolveStyle\(/, file)
  }
})

test('an older deck plays the slate as drawn: one camera step per saved step, nothing added', () => {
  const plain = slateOfLayout(whatIsSlatebox(), 'What is Slatebox')
  const ids = plain.nodes.map((node) => node.options.id)
  const deck = playableDeck({ deck: { version: 4, steps: [] }, viewpoints: [{ nodeIds: [ids[0]] }, { nodeIds: ['gone'] }, { nodeIds: ids.slice(1, 3) }], slateJSON: plain })
  assert.equal(deck.version, 5)
  assert.equal(deck.steps.length, 3, 'the presenter counts the saved steps')
  assert.deepEqual(deck.steps[0].lit, [ids[0]])
  assert.equal(deck.steps[1].lit, 'all', 'a step whose notes are gone frames the whole slate')
  assert.ok(deck.steps.every((step) => step.own.length === 0 && step.hide.length === 0))
  assert.equal(cameraDeck(plain, []).steps.length, 1, 'no steps: the whole slate')
  assert.equal(playableDeck({}), null)
})

test('a worn deck sent by a browser is kept only as camera steps, made safe', () => {
  const { deck } = wearSix()[1]
  const clean = sanitizeBakedDeck(JSON.parse(JSON.stringify(deck)))
  assert.equal(clean.version, 5)
  assert.equal(clean.steps.length, deck.steps.length)
  assert.deepEqual(clean.steps.map((step) => step.box), deck.steps.map((step) => step.box))
  assert.equal(sanitizeBakedDeck({ version: 4, steps: [] }), null)
  const hostile = sanitizeBakedDeck({ version: 5, style: { id: 'nope', evil: 1 }, steps: [{ box: { x: 'a', y: 1, width: -5, height: 2 }, lit: [{ $gt: '' }, 'a'], camera: { roll: 900, fill: 9 }, reveal: 'explode', narrative: 'x'.repeat(999), extra: 1 }] })
  assert.deepEqual(hostile.steps[0].box, { x: 0, y: 1, width: 1, height: 2 })
  assert.deepEqual(hostile.steps[0].lit, ['a'])
  assert.equal(hostile.steps[0].camera.roll, 30)
  assert.equal(hostile.steps[0].reveal, 'fade')
  assert.equal(hostile.steps[0].narrative.length, 200)
  assert.equal(hostile.steps[0].extra, undefined)
  assert.equal(hostile.style.id, 'voyage')
})

test('a published worn slate carries its art, its background and its record; a person\'s own pictures stay unpublished', () => {
  const { slate } = wearSix()[2]
  slate.nodes.push({ options: { id: 'mine', text: 'Mine', xPos: 0, yPos: 0, width: 50, height: 50, image: 'https://private.example/me.png' }, relationships: { associations: [] } })
  const copy = JSON.parse(playerSlateCopy(slate))
  assert.equal(copy.options.containerStyle.backgroundColor, STYLES.editorial.bg)
  assert.deepEqual(copy.options.style, { id: 'editorial', v: 4 })
  assert.equal(copy.nodes.length, slate.nodes.length)
  const art = copy.nodes.filter((node) => node.options.styleRole)
  assert.equal(art.length, slate.nodes.filter(isStyleArt).length)
  assert.ok(art.some((node) => node.options.image?.startsWith('data:image/svg+xml')), 'the style\'s drawn pictures')
  assert.ok(art.some((node) => node.options.shape === 'custom' && node.options.textBox && node.options.shapeRef), 'custom outlines with their text boxes')
  assert.equal(copy.nodes.find((node) => node.options.id === 'mine').options.image, undefined)
})

test('dark mode never repaints a worn style: every style\'s background is a background somebody chose', async () => {
  const { followsTheme, canvasMode } = await import('../web/app/imports/ui/common/canvasTheme.mjs')
  for (const id of STYLE_IDS) {
    const { slate } = wearStyle(slateOfLayout(whatIsSlatebox()), { id })
    assert.equal(followsTheme(slate.options.containerStyle), false, id)
    assert.equal(canvasMode('dark', slate.options.containerStyle), canvasMode('light', slate.options.containerStyle), id)
  }
})

test('every face a style draws in is served by the app itself (no font host), under its licence', () => {
  const css = read('public/fonts/fonts.css')
  const faces = new Set(Object.values(STYLES).flatMap((style) => [style.fonts.display, style.fonts.body, style.chrome.captionFont, style.chrome.kickerFont]))
  for (const face of faces) assert.match(css, new RegExp(`font-family: '${face}'`), face)
  for (const dir of ['anton', 'space-grotesk', 'fraunces', 'inter', 'ibm-plex-mono', 'abril-fatface', 'pt-sans']) assert.match(read(`public/fonts/${dir}/OFL.txt`), /SIL Open Font License|OFL/, dir)
  assert.doesNotMatch(css, /googleapis|gstatic/)
})

test('the owner of a copy plays the worn deck: the kept deck Present loads carries its version 5 steps', () => {
  // Found in the browser (Make it yours, then Present): without the deck, PresentSlate's styledDeck composed the
  // direction again over the styled slate, art and all, and framed the whole slate on every step.
  const source = read('server/methods/presentations.js')
  const load = source.slice(source.indexOf('async function loadPresentation'), source.indexOf('method[CONSTANTS.methods.presentations.load]'))
  assert.match(load, /deck: existingPresentation\.deck \?\? null/)
  assert.match(read('imports/ui/components/PresentSlate.jsx'), /if \(isBakedDeck\(saved\?\.deck\)\) return \{ viewpoints: saved\.deck\.steps/)
})

test('the Slate style panel wears the style on the live engine, not on the JSON copy the currentSlate atom keeps', () => {
  // Found in the browser: the atom holds exportJSON's plain object, so every chip failed with
  // "slate.exportJSON is not a function" and nothing was worn.
  const panel = read('imports/ui/components/slate/SlateStyle.jsx')
  assert.doesNotMatch(panel, /currentSlate/)
  assert.match(panel, /export default function SlateStyle\(\{ slate = null/)
  assert.match(read('imports/ui/components/SlateDrawer.jsx'), /<SlateStyle slate=\{slate\} \/>/)
})
