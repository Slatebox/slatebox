// A deck on the server: its pictures are searched for, else generated, else drawn from the style
// (no credits, no key, no network all still end in a finished deck); a one-click style switch
// composes the same direction again with no AI; the share card is the deck's title in its style;
// a live session carries the look to followers.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DECK_TIME_LIMIT_MS, MAX_DECK_GENERATIONS, deckRecord, imageEstimateMicros, liveDeckLook, ogCardSvg, pictureTime, playerSlateCopy,
  resolveDirectionImages, sanitizeDirectionShape, styleChange, withLanes,
} from '../web/app/server/methods/presentationDeck.mjs'
import { carryImages, deckFor, normalizeDirection, composeDeck, pendingImages, showsOn } from '../web/app/imports/ui/components/presentations/presentationCompose.mjs'
import { STYLES } from '../web/app/imports/ui/components/presentations/presentationStyles.mjs'
import { isArt } from '../web/app/imports/ui/components/presentations/presentationArt.mjs'
import { readDeck } from '../web/app/server/methods/live-presentation.mjs'
import { slateOfLayout, whatIsSlatebox } from './presentation-fixtures.mjs'

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
  const { direction: searched } = await resolveDirectionImages(aiDirection(), {
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
  const { direction: failing } = await resolveDirectionImages(aiDirection(), {
    search: async () => { throw new Error('Picture search is not set up on this server.') },
    generate: async () => { throw new Error('Register to generate pictures.') },
  })
  const { direction: slow } = await resolveDirectionImages(aiDirection(), { search: () => new Promise(() => {}), generate: () => new Promise(() => {}), timeLimitMs: 50 })
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

test('a style switch remixes the same steps: no AI, the steps (and the deep zoom) and their words kept', () => {
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
  // The same steps (notes, order, the deep zoom); the layouts are the new style's own beats.
  assert.equal(styled.steps.length, read.steps.length)
  assert.deepEqual(styled.steps.map((step) => step.caption), read.steps.map((step) => step.caption))
  assert.equal(saved[0][0], 'p1')
  assert.deepEqual(saved[0][1].style, { id: 'sketch', overrides: { palette: ['#ff0000', '#00ff00', '#0000ff'] } })
  await assert.rejects(presentationsGet.handler(principal, { shareId: 'none' }, { deps }), /no presentation yet/)
})

// ─── review: spend, licensing, reuse, the publish trust boundary ────────────────────────────────

test('generation is never started without the time it usually takes, and at most two per deck', async () => {
  let generated = 0
  const generate = async () => { generated += 1; return ['https://cdn.example/g.png'] }
  const none = { items: [] }
  // 50 ms left: a generation would be paid for and then abandoned, so none is asked for.
  await resolveDirectionImages(aiDirection(), { search: async () => none, generate, timeLimitMs: 50 })
  assert.equal(generated, 0)
  const { direction, found } = await resolveDirectionImages(aiDirection(), { search: async () => none, generate, timeLimitMs: 7000, generateTypicalMs: 10 })
  assert.equal(generated, MAX_DECK_GENERATIONS)
  assert.equal(found, MAX_DECK_GENERATIONS)
  assert.ok(pendingImages(direction) >= 1)
})

test('a found picture is copied into Slatebox storage (licensed search), never hotlinked; a late one is kept', async () => {
  const copied = []
  const late = []
  const { direction } = await resolveDirectionImages(aiDirection(), {
    search: async (query) => ({ items: [{ link: `https://stranger.example/${encodeURIComponent(query)}.jpg`, displayLink: 'stranger.example', image: { contextLink: 'https://stranger.example/page' } }] }),
    copy: async (link) => { copied.push(link); return link.includes('lego') ? null : `https://store.slatebox.example/${copied.length}.jpg` },
    generate: null,
  })
  const urls = [direction.cover, ...direction.steps.flatMap((step) => [step.image, ...(step.images || [])])].filter((image) => image?.url).map((image) => image.url)
  assert.ok(urls.length >= 3)
  assert.ok(urls.every((url) => url.startsWith('https://store.slatebox.example/')), urls.join())
  assert.ok(direction.steps[1].image.credit.includes('stranger.example'))
  // A copy that fails (lego) is no picture: never the stranger's link.
  assert.equal(direction.steps[2].images[1].url, undefined)
  // A search that answers after the deadline: its picture goes to onLate, to be saved with the deck.
  let release
  const gate = new Promise((resolve) => { release = resolve })
  await resolveDirectionImages(aiDirection(), {
    search: async () => { await gate; return { items: [{ link: 'https://x.example/a.jpg' }] } },
    copy: async () => 'https://store.slatebox.example/late.jpg',
    timeLimitMs: 30,
    onLate: (hit) => late.push(hit),
  })
  release()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.ok(late.length >= 1 && late[0].url === 'https://store.slatebox.example/late.jpg' && late[0].query)
})

test('pictures are reused across refines and restyles, matched by query, and the spend is estimated up front', async () => {
  const first = { ...aiDirection() }
  const { direction: withPictures } = await resolveDirectionImages(first, { search: async (query) => ({ items: [{ link: `https://x.example/${query.length}.jpg` }] }), copy: async (link) => link })
  // The next plan asks for the same pictures (and one new one): only the new one is searched.
  const next = normalizeDirection({ ...aiDirection(), steps: [...aiDirection().steps, { layout: 'split', nodeIds: ['b4', 'l7'], caption: 'Calls on the slate', image: { query: 'video call', why: 'calls on the slate' } }] }, whatIsSlatebox(), { name: NAME })
  const carried = carryImages(next, [withPictures])
  let searched = 0
  await resolveDirectionImages(carried, { search: async () => { searched += 1; return { items: [] } } })
  assert.equal(searched, pendingImages(carried))
  assert.equal(pendingImages(carried), 1)
  assert.equal(imageEstimateMicros(6), 6 * 5000 + MAX_DECK_GENERATIONS * 30000)
  assert.equal(imageEstimateMicros(0), 0)
  // The local direction (no AI) asks for pictures too, from its notes' words, not the slate's name.
  const { direction: local } = deckFor(whatIsSlatebox(), { name: NAME })
  assert.ok(pendingImages(local) >= 2)
  for (const step of local.steps) for (const image of [step.image, ...(step.images || [])].filter(Boolean)) assert.ok(!/slatebox/i.test(image.query), image.query)
})

test('publishing keeps only what the player needs: the slate copy is built on the server, directions are cleaned', () => {
  const slateDoc = {
    options: { name: 'What is Slatebox', secretSetting: 'x', viewPort: { width: 10000, height: 10000, zoom: 1 } },
    nodes: [
      { options: { id: 'n0', text: 'Slatebox', xPos: 1, yPos: 2, width: 100, height: 50, image: 'https://private.example/p.png', comments: ['c'], ai: { prompt: 'p' } }, relationships: { associations: [{ parentId: 'n0', childId: 'b1', lineColor: '#000', secret: 1 }] } },
      { options: { id: 'b1', text: 'Free', xPos: 200, yPos: 2, width: 100, height: 50 } },
    ],
  }
  const copy = JSON.parse(playerSlateCopy(slateDoc))
  assert.deepEqual(Object.keys(copy.options).sort(), ['name', 'viewPort'])
  assert.equal(copy.options.viewPort.zoom, undefined)
  assert.equal(copy.nodes[0].options.image, undefined)
  assert.equal(copy.nodes[0].options.comments, undefined)
  assert.equal(copy.nodes[0].relationships.associations[0].secret, undefined)
  assert.equal(copy.nodes[1].relationships.associations.length, 0)
  assert.equal(playerSlateCopy({}), null)
  const cleaned = sanitizeDirectionShape({ style: 'nope', steps: [{ layout: 'dive', nodeIds: ['a', { $gt: '' }, 'x'.repeat(200)], image: { query: 'q', why: 'w', url: 'javascript:alert(1)' }, roll: 400 }], extra: 'dropped' })
  assert.equal(cleaned.style.id, 'voyage')
  assert.deepEqual(cleaned.steps[0].nodeIds, ['a'])
  assert.equal(cleaned.steps[0].image.url, undefined)
  assert.equal(cleaned.steps[0].roll, 15)
  assert.equal(cleaned.extra, undefined)
  assert.equal(sanitizeDirectionShape({ steps: null }), null)
})

test('a person swaps a picture before publishing: drawn art for good, or another picture (never the same one)', async () => {
  const { pictureChange } = await import('../web/app/server/methods/presentationDeck.mjs')
  const { pictureSlots } = await import('../web/app/imports/ui/components/presentations/presentationCompose.mjs')
  const { direction } = await resolveDirectionImages(aiDirection(), { search: async (query) => ({ items: [{ link: `https://x.example/${query.length}.jpg` }] }), copy: async (link) => link })
  const row = { presentationData: JSON.stringify(whatIsSlatebox()), direction, style: direction.style }
  const slot = pictureSlots(JSON.parse(JSON.stringify(direction))).findIndex(({ image }) => image.url)
  const art = await pictureChange(row, { slot, action: 'art' })
  const artImage = pictureSlots(art.direction)[slot].image
  assert.equal(artImage.url, undefined)
  assert.equal(pendingImages(art.direction), pendingImages(direction))
  const shown = pictureSlots(JSON.parse(JSON.stringify(direction)))[slot].image.url
  const next = await pictureChange(row, { slot, action: 'next' }, { search: async () => ({ items: [{ link: shown }, { link: 'https://y.example/other.jpg', displayLink: 'y.example' }] }), copy: async (link) => link })
  assert.equal(pictureSlots(next.direction)[slot].image.url, 'https://y.example/other.jpg')
  assert.equal(await pictureChange(row, { slot: 99, action: 'art' }), null)
  assert.equal(await pictureChange(row, { slot, action: 'next' }, { search: async () => ({ items: [{ link: shown }] }) }), null)
})

test('a searched picture names its source where it shows (its licence asks for attribution); a generated one needs none', async () => {
  const { direction } = await resolveDirectionImages(aiDirection(), {
    search: async (query) => (query.includes('bridge') ? { items: [{ link: 'https://stranger.example/bridge.jpg', displayLink: 'stranger.example', image: { contextLink: 'https://stranger.example/page' } }] } : { items: [] }),
    copy: async () => 'https://store.slatebox.example/bridge.jpg',
    generate: async () => ['https://store.slatebox.example/made.png'],
  })
  const deck = composeDeck(whatIsSlatebox(), direction)
  const shown = deck.stageNotes.filter((note) => note.image === 'https://store.slatebox.example/bridge.jpg')
  assert.ok(shown.length >= 1)
  assert.ok(shown.every((note) => note.credit === 'stranger.example'))
  assert.ok(deck.stageNotes.filter((note) => note.image === 'https://store.slatebox.example/made.png').every((note) => !note.credit))
  // The credit is the player's to show (the deck names it on the steps where the picture shows), never an option
  // on the note the slate wears.
  const { wearStyle } = await import('../web/app/imports/ui/components/presentations/presentationBake.mjs')
  const worn = wearStyle(slateOfLayout(whatIsSlatebox(), NAME), direction.style, { direction, name: NAME })
  assert.ok(worn.slate.nodes.every((node) => node.options.credit === undefined))
})

test('a restyle (or another picture) of a published version gives it a new share card; an unpublished one keeps none', async () => {
  const { shareCardChange } = await import('../web/app/server/methods/presentationDeck.mjs')
  const row = { ...deckRecord({ layout: whatIsSlatebox(), direction: aiDirection(), style: 'neon', name: NAME }), isPublished: true, imageUrl: 'https://store.example/present_P_g1.png', snapshotGeneration: 'g1' }
  const change = styleChange(row, { id: 'sketch' })
  const card = shareCardChange(row, change, 'g2')
  assert.equal(card.generation, 'g2')
  assert.equal(card.look.style.id ?? card.look.style, 'sketch')
  assert.deepEqual(card.look.direction, change.direction)
  assert.deepEqual(card.replaces, { url: 'https://store.example/present_P_g1.png', generation: 'g1' })
  // Not published: nothing to render. A change that leaves the look alone (no new direction): none.
  assert.equal(shareCardChange({ ...row, isPublished: false }, change, 'g2'), null)
  assert.equal(shareCardChange(row, { isPublic: true }, 'g2'), null)
  // Published with no card yet: a card, replacing nothing.
  assert.equal(shareCardChange({ ...row, imageUrl: undefined }, change, 'g2').replaces, null)
})
