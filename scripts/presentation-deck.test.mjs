// A deck on the server: its pictures are searched for, else generated, else drawn from the style
// (no credits, no key, no network all still end in a finished deck); a one-click style switch
// composes the same direction again with no AI; the share card is the deck's title in its style;
// a live session carries the look to followers.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DECK_TIME_LIMIT_MS, deckRecord, liveDeckLook, ogCardSvg, pictureTime, resolveDirectionImages, styleChange, withLanes } from '../web/app/server/methods/presentationDeck.mjs'
import { normalizeDirection, composeDeck, showsOn } from '../web/app/imports/ui/components/presentations/presentationCompose.mjs'
import { STYLES } from '../web/app/imports/ui/components/presentations/presentationStyles.mjs'
import { isArt } from '../web/app/imports/ui/components/presentations/presentationArt.mjs'
import { readDeck } from '../web/app/server/methods/live-presentation.mjs'
import { whatIsSlatebox } from './presentation-fixtures.mjs'

const NAME = 'What is Slatebox'
const aiDirection = () => normalizeDirection({
  style: 'neon', title: 'Six ways in.', kicker: 'What is Slatebox?', cta: 'Open the slate',
  cover: { query: 'neon city night', why: 'the energy of a launch' },
  steps: [
    { layout: 'overview', nodeIds: ['n0'], caption: 'The whole map.' },
    { layout: 'dive', nodeIds: ['b5', 'l9', 'l10'], caption: 'Your agents edit the board too.', image: { query: 'bridge at night', prompt: 'a glowing bridge', why: 'MCP is a bridge between tools', mask: 'hexagon' }, detail: { label: 'MCP', fine: 'Claude · ChatGPT · your scripts' } },
    { layout: 'sweep', nodeIds: ['b1', 'l1', 'l2', 'b2', 'l3', 'l4'], caption: 'Free to run, smart by default.', images: [{ query: 'open door', why: 'open source: the door is open' }, { query: 'lego bricks', why: 'components snap together' }] },
    { layout: 'trace', nodeIds: ['b6', 'l11', 'l12'], caption: 'Bring a diagram, leave with a slate.' },
  ],
}, whatIsSlatebox(), { name: NAME })

test('pictures: search first, then generation, then the style\'s own art; nothing throws', async () => {
  const calls = []
  const searched = await resolveDirectionImages(aiDirection(), {
    search: async (query) => { calls.push(['search', query]); return query.includes('bridge') ? { items: [{ link: 'http://insecure.example/x.jpg' }, { link: 'https://images.example/bridge.jpg' }] } : { items: [] } },
    generate: async (prompt) => { calls.push(['generate', prompt]); return prompt.includes('door') ? ['https://cdn.example/door.png'] : [{ error: true, message: 'no credits' }] },
  })
  assert.equal(searched.steps[1].image.url, 'https://images.example/bridge.jpg')
  assert.equal(searched.steps[1].image.source, 'search')
  assert.equal(searched.steps[2].images[0].url, 'https://cdn.example/door.png')
  assert.equal(searched.steps[2].images[0].source, 'generated')
  assert.equal(searched.steps[2].images[1].url, undefined)
  assert.ok(calls.some(([kind]) => kind === 'generate'))
})

test('every image provider failing still gives a finished deck: art wherever a picture was asked for', async () => {
  const failing = await resolveDirectionImages(aiDirection(), {
    search: async () => { throw new Error('Picture search is not set up on this server.') },
    generate: async () => { throw new Error('Register to generate pictures.') },
  })
  const slow = await resolveDirectionImages(aiDirection(), { search: () => new Promise(() => {}), generate: () => new Promise(() => {}), timeLimitMs: 50 })
  for (const direction of [failing, slow]) {
    const deck = composeDeck(whatIsSlatebox(), direction)
    deck.steps.forEach((step, index) => {
      if (!['dive', 'split', 'sweep'].includes(step.layout) || step.deep) return
      const pictures = deck.stageNotes.filter((note) => note.kind === 'image' && showsOn(note, index))
      assert.ok(pictures.length >= 1, step.layout)
      assert.ok(pictures.every((note) => isArt(note.image)), step.layout)
    })
  }
})

test('a style switch composes the same steps again: no AI, the steps and their words kept', () => {
  const record = deckRecord({ layout: whatIsSlatebox(), direction: aiDirection(), name: NAME })
  const row = { presentationData: JSON.stringify(whatIsSlatebox()), direction: record.direction, viewpoints: record.viewpoints }
  let asked = 0
  const ai = () => { asked += 1 }
  for (const style of Object.keys(STYLES)) {
    const change = styleChange(row, { id: style })
    assert.equal(change.style.id, style)
    assert.equal(change.viewpoints.length, record.viewpoints.length)
    // The words are kept; only a full-bleed finale drops its caption (its bookend carries the words).
    assert.deepEqual(change.viewpoints.slice(0, -1).map((step) => step.narrative), record.viewpoints.slice(0, -1).map((step) => step.narrative))
    assert.ok(['', record.direction.closing].includes(change.viewpoints.at(-1).narrative), style)
    assert.deepEqual(change.viewpoints.map((step) => step.nodeIds), record.viewpoints.map((step) => step.nodeIds))
  }
  assert.equal(asked, 0, String(ai))
  assert.equal(styleChange({ presentationData: '{}' }, 'voyage'), null)
})

test('a workshop\'s lanes open the deck, in their order, and their notes leave the other steps', () => {
  const scenes = [{ nodeIds: ['b3', 'l5', 'l6'], label: 'Presentations', narrative: 'How a deck is made' }, { nodeIds: ['b1', 'l1', 'l2'], label: 'Free', narrative: 'Why it is free' }]
  const directed = withLanes(aiDirection(), scenes, whatIsSlatebox())
  assert.equal(directed.steps[0].layout, 'overview')
  assert.deepEqual(directed.steps.slice(1, 3).map((step) => step.nodeIds[0]), ['b3', 'b1'])
  assert.ok(directed.steps.slice(3).every((step) => !step.nodeIds.includes('b1') && !step.nodeIds.includes('l1')))
})

test('the share card is the deck\'s title in its style', () => {
  const direction = aiDirection()
  const svg = ogCardSvg({ direction, style: { id: 'neon' } })
  assert.ok(svg.includes(STYLES.neon.bg))
  assert.ok(svg.includes('Six ways in.'))
  assert.ok(svg.startsWith('<svg'))
  const voyage = ogCardSvg({ direction, style: { id: 'voyage' } })
  assert.ok(voyage.includes(STYLES.voyage.bg))
})

test('the style survives the live session: the deck a follower gets carries its look', () => {
  const record = deckRecord({ layout: whatIsSlatebox(), direction: aiDirection(), name: NAME })
  const sent = { name: 'Six ways in.', viewpoints: record.viewpoints.map(({ nodeIds, narrative, duration }) => ({ nodeIds, narrative, duration })), style: record.style, direction: record.direction }
  const kept = readDeck(sent)
  assert.equal(kept.style.id, 'neon')
  assert.equal(kept.direction.title, 'Six ways in.')
  assert.equal(kept.viewpoints.length, record.viewpoints.length)
  assert.deepEqual(liveDeckLook({ style: 'nope' }), {})
  assert.deepEqual(liveDeckLook({ style: { id: 'calm' }, direction: { steps: [], filler: 'x'.repeat(70_000) } }), {})
})

test('pictures fit in what is left of the deck\'s time: the presenter still has its plan within 20 s', () => {
  assert.ok(DECK_TIME_LIMIT_MS < 20_000)
  assert.equal(pictureTime(0), 7000)
  assert.ok(pictureTime(15_000) > 0 && pictureTime(15_000) <= 3700)
  assert.equal(pictureTime(18_500), 0)
})

test('agents read a deck and restyle it in one call: same steps, no AI, saved', async () => {
  const { presentationsGet, presentationsSetStyle } = await import('../web/app/server/actions/presentations.mjs')
  const record = deckRecord({ layout: whatIsSlatebox(), direction: aiDirection(), name: NAME })
  const row = { _id: 'p1', version: 2, name: 'Six ways in.', presentationData: JSON.stringify(whatIsSlatebox()), ...record }
  const saved = []
  const deps = { latestPresentation: async (shareId, userId) => (shareId === 'abc' && userId === 'u1' ? row : null), savePresentation: async (id, set) => { saved.push([id, set]) } }
  const principal = { kind: 'agent', userId: 'u1' }
  const read = await presentationsGet.handler(principal, { shareId: 'abc' }, { deps })
  assert.equal(read.style, 'neon')
  assert.equal(read.steps.length, record.viewpoints.length)
  assert.equal(read.steps[0].layout, 'title')
  const styled = await presentationsSetStyle.handler(principal, { shareId: 'abc', style: 'sketch', palette: ['#ff0000', '#00ff00', '#0000ff'] }, { deps })
  assert.equal(styled.style, 'sketch')
  assert.deepEqual(styled.steps.map((step) => step.layout), read.steps.map((step) => step.layout))
  assert.equal(saved[0][0], 'p1')
  assert.deepEqual(saved[0][1].style, { id: 'sketch', overrides: { palette: ['#ff0000', '#00ff00', '#0000ff'] } })
  await assert.rejects(presentationsGet.handler(principal, { shareId: 'none' }, { deps }), /no presentation yet/)
})
