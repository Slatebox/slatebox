// Presentation styles: a deck is composed from the slate and an art direction (the AI's, or the
// local one) into real stage notes, skins and Prezi camera steps. These tests hold the design's
// rules: honest numbers, short captions that never repeat a note, varied layouts with a surprise,
// a homecoming finale, pictures with a reason (else the style's own art), stage notes that never
// sit on the slate's notes, and portrait geometry for phones.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifySlate, cleanCaption, composeDeck, deckFor, frameBox, LAYOUTS, localDirection, normalizeDirection,
  numberOnSlate, pickStyle, quoteOnSlate, remixDirection, repeatsNote, safeImageUrl, showsOn, slateGraph, SURPRISES,
} from '../web/app/imports/ui/components/presentations/presentationCompose.mjs'
import { chevron, slant, textInsetFor } from '../web/app/imports/ui/components/presentations/presentationPaths.mjs'
import { STYLE_IDS, STYLES, cleanStyleRef, resolveStyle } from '../web/app/imports/ui/components/presentations/presentationStyles.mjs'
import { isArt } from '../web/app/imports/ui/components/presentations/presentationArt.mjs'
import { needsPlan, PLAN_VERSION } from '../web/app/imports/ui/components/presentations/presentationPlan.mjs'

import { whatIsSlatebox } from './presentation-fixtures.mjs'

const NAME = 'What is Slatebox'

// A process: a chain of steps left to right.
const flow = () => {
  const steps = ['Request comes in', 'Triage the ticket', 'Assign an owner', 'Fix and test', 'Ship the fix', 'Tell the customer']
  let node = null
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    node = { nodeId: `s${i}`, description: steps[i], metrics: { rotation: 0, bbox: { x: i * 260, y: 0, width: 200, height: 60 } }, childrenNodes: node ? [node] : [] }
  }
  return { nodes: [node] }
}
// A brainstorm: loose notes, no connections.
const cluster = () => ({
  nodes: ['Coffee corner', 'Quiet room', 'Plants', 'Better chairs', 'Standing desks', 'Music', 'Game night', 'Snacks'].map((text, i) => ({
    nodeId: `c${i}`, description: text, metrics: { rotation: 0, bbox: { x: (i % 4) * 220, y: Math.floor(i / 4) * 160, width: 180, height: 80 } }, childrenNodes: [],
  })),
})

const boxOf = (note, portrait = false) => {
  const g = portrait ? note.p : note
  return { x: g.x, y: g.y, width: g.w, height: g.h }
}
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const inside = (a, b, slack = 1) => a.x >= b.x - slack && a.y >= b.y - slack && a.x + a.width <= b.x + b.width + slack && a.y + a.height <= b.y + b.height + slack

test('the local plan is deterministic and picks the style from the slate', () => {
  const a = deckFor(whatIsSlatebox(), { name: NAME })
  const b = deckFor(whatIsSlatebox(), { name: NAME })
  assert.deepEqual(a, b)
  assert.equal(a.direction.style.id, 'voyage')
  assert.equal(pickStyle(whatIsSlatebox(), NAME), 'voyage')
  assert.ok(['blueprint', 'journey'].includes(pickStyle(flow())))
  assert.equal(pickStyle(cluster()), 'sketch')
  assert.equal(classifySlate(whatIsSlatebox(), NAME), 'tree')
})

test('the local plan for this slate flies like the design: title, overview, dive and deep zoom, finale', () => {
  const { deck } = deckFor(whatIsSlatebox(), { name: NAME })
  const layouts = deck.steps.map((step) => step.layout)
  assert.equal(layouts[0], 'title')
  assert.equal(layouts[1], 'overview')
  assert.equal(layouts.at(-1), 'finale')
  assert.ok(deck.steps.some((step) => step.deep), 'a deep zoom into a nested detail')
  assert.ok(layouts.some((layout) => SURPRISES.has(layout)))
  assert.ok(deck.steps.length >= 7 && deck.steps.length <= 14, String(deck.steps.length))
  assert.ok(layouts.every((layout) => LAYOUTS.includes(layout)))
  // Every step uses a custom SVG path shape somewhere (the skin's silhouettes are always on screen).
  const pathNotes = deck.stageNotes.filter((note) => note.vectorPath)
  assert.ok(pathNotes.length >= 6)
  assert.ok(Object.values(deck.skin).every((look) => look.vectorPath || look.shape))
  // And pictures: masked images as stage notes, and the root's planet.
  assert.ok(deck.stageNotes.filter((note) => note.image).length >= 3)
  assert.ok(deck.skin.n0.image)
})

test('the normalizer keeps style, layouts, camera, lit and portrait geometry, and drops unknown layouts and ids', () => {
  const direction = normalizeDirection({
    style: { id: 'neon', overrides: { palette: ['#111111', '#222222', '#333333'], bg: 'red; x', fonts: { display: 'Bangers' } } },
    title: 'Six ways in.',
    steps: [
      { layout: 'overview', nodeIds: ['n0', 'b1', 'ghost'], caption: 'The map' },
      { layout: 'warp-speed', nodeIds: ['b2', 'l3', 'l4'], caption: 'Boards that act on what you drop' },
      { layout: 'dive', nodeIds: ['nope'], caption: 'gone' },
      { layout: 'hero', nodeIds: ['b3', 'l5'], caption: 'Composed from the slate itself', roll: 40 },
    ],
  }, whatIsSlatebox(), { name: NAME })
  assert.equal(direction.style.id, 'neon')
  assert.deepEqual(direction.style.overrides, { palette: ['#111111', '#222222', '#333333'], fonts: { display: 'Bangers' } })
  // An unknown layout is a plain group; with no surprising beat, the last step traces home.
  assert.deepEqual(direction.steps.map((step) => step.layout), ['overview', 'group', 'trace'])
  assert.deepEqual(direction.steps[2].nodeIds, ['b3', 'l5'])
  assert.deepEqual(direction.steps[0].nodeIds, ['n0', 'b1'])
  const deck = composeDeck(whatIsSlatebox(), direction)
  for (const step of deck.steps) {
    assert.ok(Array.isArray(step.camera.frame) && step.camera.frame.length, step.layout)
    assert.ok(step.lit === 'all' || Array.isArray(step.lit))
    assert.ok(Math.abs(step.camera.roll) <= STYLES.neon.motion.rollMax, `roll ${step.camera.roll}`)
  }
  for (const note of deck.stageNotes) assert.ok(note.p && Number.isFinite(note.p.w) && Number.isFinite(note.p.h), note.id)
  assert.equal(resolveStyle(direction.style).fonts.display, 'Bangers')
  assert.deepEqual(cleanStyleRef({ id: 'nope' }), { id: 'voyage' })
})

test('variety: an overview first, never one layout three times in a row, at least one surprise', () => {
  const direction = normalizeDirection({
    style: 'stage',
    steps: ['b1', 'b2', 'b3', 'b4'].map((id) => ({ layout: 'group', nodeIds: [id], caption: 'A step' })),
  }, whatIsSlatebox(), { name: NAME })
  const layouts = direction.steps.map((step) => step.layout)
  assert.equal(layouts[0], 'overview')
  for (let i = 2; i < layouts.length; i += 1) assert.ok(!(layouts[i] === layouts[i - 1] && layouts[i] === layouts[i - 2]), layouts.join())
  assert.ok(direction.steps.some((step) => SURPRISES.has(step.layout) || step.detail), layouts.join())
  const deck = composeDeck(whatIsSlatebox(), direction)
  assert.ok(['title', 'cover'].includes(deck.steps[0].layout))
  assert.equal(deck.steps.at(-1).layout, 'finale')
})

test('a big number must be on the slate: "free" is 0, counts of the slate are allowed, invented numbers are not', () => {
  const layout = whatIsSlatebox()
  assert.ok(numberOnSlate('$0', layout))
  assert.ok(numberOnSlate('19', layout))
  assert.ok(numberOnSlate('6', layout))
  assert.ok(!numberOnSlate('10x', layout))
  const direction = normalizeDirection({
    steps: [
      { layout: 'bigNumber', nodeIds: ['b1', 'l1', 'l2'], number: '$0', numberLabel: 'dollars, forever', caption: 'What it costs' },
      { layout: 'bigNumber', nodeIds: ['b5', 'l9', 'l10'], number: '73%', numberLabel: 'faster', caption: 'Made up' },
    ],
  }, layout, { name: NAME })
  const big = direction.steps.filter((step) => step.layout === 'bigNumber')
  assert.equal(big.length, 1)
  assert.equal(big[0].number, '$0')
})

test('captions: twelve words at most, no all-caps placeholders, never a note repeated', () => {
  const texts = slateGraph(whatIsSlatebox()).list.map((note) => note.text)
  assert.equal(cleanCaption('Replace YOUR TOPIC HERE with the plan'), 'Replace with the plan')
  assert.ok(cleanCaption('one two three four five six seven eight nine ten eleven twelve thirteen').split(' ').length <= 12)
  assert.ok(repeatsNote('Here: AI builds the story from your slate', texts))
  assert.ok(!repeatsNote('Agents edit the same board', texts))
  const { deck } = deckFor(whatIsSlatebox(), {
    name: NAME,
    direction: { steps: [{ layout: 'hero', nodeIds: ['b3', 'l5'], caption: 'AI builds the story from your slate' }, { layout: 'trace', nodeIds: ['b6', 'l11'], caption: 'BRING YOUR DIAGRAM HERE now' }] },
  })
  for (const step of deck.steps) {
    assert.ok(step.narrative.split(/\s+/).filter(Boolean).length <= 12, step.narrative)
    assert.ok(!repeatsNote(step.narrative, texts), step.narrative)
    assert.ok(!/\b[A-Z]{2,}\s+[A-Z]{2,}\b/.test(step.narrative), step.narrative)
  }
})

test('pictures need a reason: without one the image is the style\'s own art, and every image step has a picture', () => {
  const direction = normalizeDirection({
    steps: [
      { layout: 'dive', nodeIds: ['b5', 'l9', 'l10'], caption: 'Agents at work', image: { query: 'jellyfish', url: 'https://example.com/jelly.jpg' } },
      { layout: 'split', nodeIds: ['b6', 'l11', 'l12'], caption: 'Mermaid in and out', image: { query: 'bridge', why: 'a bridge: MCP connects tools', url: 'https://example.com/bridge.jpg' } },
      { layout: 'trace', nodeIds: ['b4', 'l7'], caption: 'Back home' },
    ],
  }, whatIsSlatebox(), { name: NAME })
  assert.equal(direction.steps[1].image.art, true)
  assert.equal(direction.steps[1].image.url, undefined)
  assert.equal(direction.steps[2].image.url, 'https://example.com/bridge.jpg')
  const deck = composeDeck(whatIsSlatebox(), direction)
  const images = deck.stageNotes.filter((note) => note.kind === 'image')
  assert.ok(images.some((note) => note.image === 'https://example.com/bridge.jpg' && note.why.includes('MCP')))
  assert.ok(!images.some((note) => note.image === 'https://example.com/jelly.jpg'))
  for (const step of deck.steps.filter((s) => ['dive', 'split', 'sweep'].includes(s.layout) && !s.deep)) {
    const shown = deck.stageNotes.filter((note) => note.kind === 'image' && showsOn(note, deck.steps.indexOf(step)))
    assert.ok(shown.length >= 1 && shown.every((note) => note.image), step.layout)
    for (const note of shown) assert.ok(note.why || isArt(note.image))
  }
})

test('stage notes never sit on the slate\'s notes, and every one has a portrait geometry', () => {
  for (const style of STYLE_IDS) {
    const { deck } = deckFor(whatIsSlatebox(), { name: NAME, style })
    const slateBoxes = Object.values(deck.skin).map((s) => ({ x: s.x, y: s.y, width: s.width, height: s.height }))
    for (const note of deck.stageNotes) {
      assert.ok(note.p, `${style} ${note.id}`)
      if (note.deco || note.kind === 'ribbon') continue
      for (const box of slateBoxes) assert.ok(!overlaps(boxOf(note), box), `${style}: ${note.id} sits on a note`)
    }
  }
})

test('the finale is a homecoming: no wider than twice the opening, the call to action in frame, a caption that never repeats it', () => {
  for (const style of STYLE_IDS) {
    const { deck, direction } = deckFor(whatIsSlatebox(), { name: NAME, style })
    const opening = frameBox(deck, deck.steps[0])
    const finale = deck.steps.at(-1)
    const box = frameBox(deck, finale)
    assert.ok(box.width * box.height <= opening.width * opening.height * 4.01, `${style}: finale ${box.width}x${box.height} vs ${opening.width}x${opening.height}`)
    assert.ok(box.width <= opening.width * 2.01, style)
    const cta = deck.stageNotes.find((note) => note.kind === 'cta')
    assert.ok(inside(boxOf(cta), box) || finale.camera.cover, `${style}: CTA out of frame`)
    assert.ok(!finale.narrative.toLowerCase().includes(direction.cta.toLowerCase()), style)
  }
})

test('a stage note shows only where its step frames it (decoration and nested details aside)', () => {
  for (const style of STYLE_IDS) {
    const { deck } = deckFor(whatIsSlatebox(), { name: NAME, style })
    deck.steps.forEach((step, index) => {
      if (step.camera.cover) return
      const frame = frameBox(deck, step)
      for (const note of deck.stageNotes) {
        if (note.deco || note.detail || !showsOn(note, index)) continue
        assert.ok(inside(boxOf(note), frame, 2), `${style} step ${index} (${step.layout}): ${note.id} is cut by the frame`)
      }
    })
  }
})

test('every style composes the same steps for the same direction (a one-click switch keeps the steps)', () => {
  const { direction } = deckFor(whatIsSlatebox(), { name: NAME })
  const base = composeDeck(whatIsSlatebox(), direction, { style: 'voyage' })
  for (const style of STYLE_IDS) {
    const deck = composeDeck(whatIsSlatebox(), direction, { style })
    assert.equal(deck.steps.length, base.steps.length, style)
    assert.deepEqual(deck.steps.map((s) => s.nodeIds), base.steps.map((s) => s.nodeIds), style)
    assert.equal(deck.style.id, style)
  }
})

test('old decks plan again after the plan version moved to styled decks', () => {
  assert.equal(PLAN_VERSION, 4)
  assert.equal(needsPlan({ viewpoints: [{ nodeIds: ['a'] }], planVersion: 3 }), true)
  assert.equal(needsPlan({ viewpoints: [{ nodeIds: ['a'] }], planVersion: 4 }), false)
})

test('flow and cluster slates compose too', () => {
  for (const layout of [flow(), cluster()]) {
    const { deck } = deckFor(layout, {})
    assert.ok(deck.steps.length >= 4)
    assert.equal(deck.steps.at(-1).layout, 'finale')
    assert.ok(localDirection(layout).steps.length >= 2)
  }
})

// ─── review: templated captions, honest quotes, frames on every screen, safe directions ─────────

const captionsOf = (deck) => deck.steps.map((step) => step.narrative).filter(Boolean)

test('two styles on the same slate share at most half their captions, and every local caption names the slate', () => {
  const slateWords = new Set(slateGraph(whatIsSlatebox()).list.flatMap((note) => note.text.toLowerCase().match(/[a-z0-9$]+/g) || []))
  const decks = Object.fromEntries(STYLE_IDS.map((style) => [style, deckFor(whatIsSlatebox(), { name: NAME, style }).deck]))
  for (const a of STYLE_IDS) {
    for (const b of STYLE_IDS) {
      if (a >= b) continue
      const ca = new Set(captionsOf(decks[a]))
      const cb = new Set(captionsOf(decks[b]))
      const shared = [...ca].filter((c) => cb.has(c))
      assert.ok(shared.length <= Math.min(ca.size, cb.size) / 2, `${a} and ${b} share ${shared.join(' | ')}`)
    }
    // Middle captions are written from the slate's words (its root, its notes), never a fixed line.
    for (const step of decks[a].steps) {
      if (!step.narrative || ['title', 'cover', 'finale'].includes(step.layout)) continue
      const said = step.narrative.toLowerCase().match(/[a-z0-9$]+/g) || []
      assert.ok(said.some((word) => word.length > 2 && slateWords.has(word)) || /\d/.test(step.narrative), `${a}: "${step.narrative}" says nothing about the slate`)
    }
  }
})

test('the beat structure differs by style, and a switch remixes the layouts but keeps the steps', () => {
  const structures = new Set(STYLE_IDS.map((style) => deckFor(whatIsSlatebox(), { name: NAME, style }).deck.steps.map((step) => step.layout).join(',')))
  assert.ok(structures.size >= 6, `only ${structures.size} structures across ${STYLE_IDS.length} styles`)
  const { direction } = deckFor(whatIsSlatebox(), { name: NAME, style: 'voyage' })
  const remixed = remixDirection(direction, whatIsSlatebox(), 'editorial', { name: NAME })
  assert.equal(remixed.style.id, 'editorial')
  assert.deepEqual(remixed.steps.map((step) => step.nodeIds), direction.steps.map((step) => step.nodeIds))
  assert.notDeepEqual(remixed.steps.map((step) => step.layout), direction.steps.map((step) => step.layout))
  // Slatebox's own captions are said again in the new voice; the AI's words stay.
  assert.notDeepEqual(remixed.steps.map((step) => step.caption), direction.steps.map((step) => step.caption))
  const ai = normalizeDirection({ style: 'voyage', steps: [{ layout: 'dive', nodeIds: ['b1', 'l1', 'l2'], caption: 'Open by default, yours to run' }] }, whatIsSlatebox(), { name: NAME })
  const aiRemixed = remixDirection(ai, whatIsSlatebox(), 'stage', { name: NAME })
  assert.equal(aiRemixed.steps.find((step) => step.layout !== 'overview' && step.nodeIds.includes('b1')).caption, 'Open by default, yours to run')
})

test('a quote must be the slate\'s own words: an invented testimonial becomes a note\'s words or a hero', () => {
  const texts = slateGraph(whatIsSlatebox()).list.map((note) => note.text)
  assert.ok(quoteOnSlate('“AI builds the story from your slate.”', texts))
  assert.ok(!quoteOnSlate('We invented this testimonial entirely', texts))
  const direction = normalizeDirection({
    steps: [
      { layout: 'quote', nodeIds: ['b3', 'l5', 'l6'], quote: 'We invented this testimonial entirely', caption: 'Hear it' },
      { layout: 'quote', nodeIds: ['b4'], quote: 'Everyone loves it', caption: 'Hear it again' },
    ],
  }, whatIsSlatebox(), { name: NAME })
  const [first, second] = direction.steps.slice(1)
  assert.equal(first.layout, 'quote')
  assert.equal(first.quote, 'AI builds the story from your slate')
  assert.equal(second.layout, 'hero')
  assert.equal(second.quote, undefined)
  const deck = composeDeck(whatIsSlatebox(), direction)
  for (const note of deck.stageNotes.filter((n) => n.kind === 'quote')) assert.ok(quoteOnSlate(note.text, texts), note.text)
})

const boxOfId = (deck, id, portrait) => {
  const skin = deck.skin[id]
  if (skin) return { x: skin.x, y: skin.y, width: skin.width, height: skin.height }
  const note = deck.stageNotes.find((n) => n.id === id)
  return note ? boxOf(note, portrait) : null
}

test('every lit note sits inside its step\'s landed frame, on a wide screen and on a phone, in every style', () => {
  for (const layout of [whatIsSlatebox(), flow(), cluster()]) {
    for (const style of STYLE_IDS) {
      const { deck } = deckFor(layout, { name: NAME, style })
      deck.steps.forEach((step, index) => {
        if (step.lit === 'all' || step.camera.cover) return
        for (const portrait of [false, true]) {
          const frame = frameBox(deck, step, { portrait })
          for (const id of step.lit) {
            const box = boxOfId(deck, id, portrait)
            if (!box) continue
            assert.ok(inside(box, frame, 2), `${style} step ${index} (${step.layout}) ${portrait ? 'portrait' : 'landscape'}: ${id} is outside the frame`)
          }
        }
      })
    }
  }
})

test('the stage notes of one step never sit on each other, on a wide screen or a phone', () => {
  for (const style of STYLE_IDS) {
    const { deck } = deckFor(whatIsSlatebox(), { name: NAME, style })
    deck.steps.forEach((step, index) => {
      if (index === 0 || step.layout === 'finale') return
      const own = deck.stageNotes.filter((note) => Array.isArray(note.steps) && note.steps.includes(index) && !['tape', 'label', 'polaroid'].includes(note.kind))
      // A polaroid's picture, label and tape are one card: compared as their card.
      for (const portrait of [false, true]) {
        for (let i = 0; i < own.length; i += 1) {
          for (let j = i + 1; j < own.length; j += 1) {
            if (own[i].kind === 'image' && own[j].kind === 'image' && style === 'sketch') continue
            assert.ok(!overlaps(boxOf(own[i], portrait), boxOf(own[j], portrait)), `${style} step ${index} (${step.layout}) ${portrait ? 'portrait' : 'landscape'}: ${own[i].id} on ${own[j].id}`)
          }
        }
      }
    })
  }
})

test('custom silhouettes keep their text inside: each path with a notch or tail carries its text inset', () => {
  assert.deepEqual(textInsetFor(chevron), { left: 0.15, right: 0.17, top: 0.04, bottom: 0.04 })
  assert.ok(textInsetFor(slant).left >= 0.14)
  for (const style of STYLE_IDS) {
    const { deck } = deckFor(whatIsSlatebox(), { name: NAME, style })
    for (const [id, look] of Object.entries(deck.skin)) {
      const inset = textInsetFor(look.vectorPath)
      if (inset) assert.deepEqual(look.textInset, inset, `${style} ${id}`)
    }
    for (const note of deck.stageNotes.filter((n) => n.text && textInsetFor(n.vectorPath))) assert.ok(note.textInset, `${style} ${note.id}`)
  }
})

test('a direction from anywhere composes: missing steps or notes never throw, and only safe picture links pass', () => {
  for (const bad of [{}, { steps: null }, { steps: [{}] }, { steps: [null, 7, { layout: 'nope', nodeIds: 'b1' }] }, null]) {
    const deck = composeDeck(whatIsSlatebox(), bad)
    assert.ok(deck.steps.length >= 2)
    assert.equal(deck.steps.at(-1).layout, 'finale')
  }
  assert.equal(safeImageUrl('javascript:alert(1)'), null)
  assert.equal(safeImageUrl('http://example.com/a.png'), null)
  assert.equal(safeImageUrl('data:image/png;base64,AAAA'), null)
  assert.equal(safeImageUrl('https://example.com/a.png'), 'https://example.com/a.png')
  assert.ok(safeImageUrl('data:image/svg+xml;charset=utf-8,%3Csvg%3E'))
  const direction = normalizeDirection({ steps: [{ layout: 'dive', nodeIds: ['b1', 'l1'], caption: 'x y', image: { query: 'q', why: 'because', url: 'javascript:alert(1)' } }] }, whatIsSlatebox(), { name: NAME })
  assert.equal(direction.steps[1].image.url, undefined)
})

test('decoration stays light: at most 40 notes of it on any style', () => {
  for (const style of STYLE_IDS) {
    const { deck } = deckFor(whatIsSlatebox(), { name: NAME, style })
    assert.ok(deck.stageNotes.filter((note) => note.deco).length <= 41, style)
  }
})

test('a kicker never reads like the step counter ("3 / 8"), in any style', () => {
  for (const style of STYLE_IDS) {
    const { deck } = deckFor(whatIsSlatebox(), { name: NAME, style })
    for (const step of deck.steps) assert.ok(!/^-?\d+ \/ \d+$/.test(step.kicker || ''), `${style}: ${step.kicker}`)
  }
})
