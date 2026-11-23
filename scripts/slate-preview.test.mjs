import assert from 'node:assert/strict'
import test from 'node:test'
import { createBudgetWorkshop, nightTransfer, workshopToSlate } from 'slateboxjs/workshops/model'
import { slatePreview } from '../web/app/imports/api/common/slate-preview.mjs'
import { workshopNoteStyle, workshopStyle } from '../web/app/imports/api/common/workshop-look.mjs'

const stored = () => ({
  shareId: 'abc', options: { name: 'Design partner pilot · $600 launch budget' }, nodes: [],
  creative: { revision: 2, model: { kind: 'workshop', version: 1, workshop: createBudgetWorkshop() } },
})
const ids = preview => preview.nodes.map(n => n.options.id)

test('a workshop slate is previewed as its canvas draws it: the same notes, in the app’s note style, where the canvas puts them', () => {
  const slate = stored(), before = structuredClone(slate)
  const preview = slatePreview(slate)
  // Exactly the artwork attachWorkshop keeps on the live canvas, at the place an empty slate gives it.
  const canvas = workshopToSlate(slate.creative.model.workshop, { native: true, origin: { x: 40, y: 40 }, style: workshopStyle([]) })
  assert.deepEqual(preview.nodes, canvas.nodes)
  assert.deepEqual(ids(preview).filter(id => /^(lane|card)-/.test(id)),
    ['lane-reserve', 'card-fund-1', 'card-fund-2', 'lane-calls', 'card-fund-0', 'lane-newsletter', 'lane-pilot'])
  for (const lane of ['reserve', 'calls', 'newsletter', 'pilot']) {
    assert.ok(ids(preview).includes('column-' + lane), 'the lane column the canvas draws behind ' + lane)
    assert.ok(ids(preview).includes('caption-' + lane), 'the line under ' + lane)
  }
  const caption = preview.nodes.find(n => n.options.id === 'caption-reserve').options
  assert.equal(caption.text, '$400 · unallocated')
  const card = preview.nodes.find(n => n.options.id === 'card-fund-1').options
  // A slate with no notes of its own draws its cards as a plain canvas note, and its lanes in the
  // app's lane style. (Restated 2026-11-19: cards used to take the lane style.)
  assert.equal(card.fontFamily, 'Arial, sans-serif')
  assert.equal(card.backgroundColor, '#f0f0f0')
  assert.equal(preview.nodes.find(n => n.options.id === 'lane-reserve').options.fontFamily, 'Manrope')
  assert.equal(preview.options.containerStyle.backgroundColor, '#ffffff')
  assert.equal(preview.drawnFromModel, true)
  assert.deepEqual(slate, before, 'the stored slate is not changed')
})

test('the preview follows the saved model after a move', () => {
  const slate = stored()
  slate.creative.model.workshop.cards.find(card => card.id === 'fund-1').laneId = 'newsletter'
  const preview = slatePreview(slate)
  const moved = preview.nodes.find(n => n.options.id === 'card-fund-1').options
  const lane = preview.nodes.find(n => n.options.id === 'lane-newsletter').options
  assert.equal(moved.xPos, lane.xPos)
  assert.equal(preview.nodes.find(n => n.options.id === 'caption-newsletter').options.text, '$200 · 1 placement')
})

test('a map is previewed with its stations joined, as on the canvas', () => {
  const preview = slatePreview({ options: {}, nodes: [], creative: { revision: 0, model: { kind: 'workshop', version: 1, workshop: nightTransfer } } })
  const links = preview.nodes.flatMap(n => n.relationships.associations.map(link => link.parentId + '>' + link.childId))
  assert.ok(links.length > 0)
  assert.ok(links.every(link => /^column-.+>column-.+$/.test(link)), 'lines run between station zones')
})

test('a drawing that later gained a workshop shows both: its own notes, and the workshop beside them', () => {
  const note = (id, xPos) => ({ options: { id, text: 'Kept', xPos, yPos: 300, width: 150, height: 80 }, relationships: { associations: [] } })
  const drawing = slatePreview({ options: { containerStyle: { backgroundColor: '#eeeee3' } }, nodes: [note('a', 100)] })
  assert.deepEqual(drawing.nodes, [note('a', 100)])
  assert.equal(drawing.options.containerStyle.backgroundColor, '#eeeee3')
  assert.equal(drawing.drawnFromModel, undefined)

  const both = slatePreview({ ...stored(), nodes: [note('a', 100), note('b', 500)], nativeCanvasDrawing: true })
  assert.deepEqual(both.nodes.slice(0, 2), [note('a', 100), note('b', 500)], 'the drawing keeps its own notes, first and unchanged')
  const workshop = both.nodes.slice(2)
  assert.ok(workshop.length > 0 && workshop.every(n => /^(lane|card|caption|column)-/.test(n.options.id)))
  // To the right of the drawing's rightmost note (500 + 150), level with its top: where the canvas puts it.
  assert.equal(Math.min(...workshop.map(n => n.options.xPos)), 650 + 80 + 2)
  assert.equal(Math.min(...workshop.map(n => n.options.yPos)), 300)

  // A slate that has recorded where its workshop sits is previewed with the workshop there.
  const placed = slatePreview({ ...stored(), options: { workshopOrigin: { x: 1000, y: -200 } }, nodes: [note('a', 100)] })
  assert.equal(Math.min(...placed.nodes.slice(1).map(n => n.options.xPos)), 1002)
  assert.equal(Math.min(...placed.nodes.slice(1).map(n => n.options.yPos)), -200)
})

test('a stored note that carries a workshop note’s name is the slate’s own note: it is drawn, once, and so is the workshop’s', () => {
  const mine = { options: { id: 'card-fund-1', text: 'A note of my own', xPos: 0, yPos: 0, width: 10, height: 10 }, relationships: { associations: [] } }
  const preview = slatePreview({ ...stored(), nodes: [mine] })
  assert.deepEqual(preview.nodes.filter(n => n.options.id === 'card-fund-1'), [mine])
  assert.equal(preview.nodes.filter(n => n.options.text === 'Second $200').length, 1)
})

test('a slate whose model cannot be drawn still previews without throwing', () => {
  for (const creative of [{ model: { kind: 'listening-room', mix: 0.4 } }, { model: { kind: 'workshop', workshop: { lanes: 'nope' } } }, { model: null }, undefined]) {
    const preview = slatePreview({ options: {}, creative })
    assert.deepEqual(preview.nodes, [])
    assert.equal(preview.options.containerStyle.backgroundColor, '#ffffff')
  }
})

test('a slate whose own notes already carry workshop names is previewed with all of them and the whole workshop', () => {
  const note = id => ({ options: { id, text: 'Mine: ' + id, xPos: 0, yPos: 0, width: 150, height: 80 }, relationships: { associations: [] } })
  const preview = slatePreview({ ...stored(), nodes: [note('card-fund-1'), note('lane-reserve'), note('plain')], nativeCanvasDrawing: true })
  // The slate's own three notes, first and unchanged.
  assert.deepEqual(preview.nodes.slice(0, 3), [note('card-fund-1'), note('lane-reserve'), note('plain')])
  const all = ids(preview)
  assert.equal(new Set(all).size, all.length, 'no two notes of the preview share an id')
  // The workshop's own notes of those names are drawn under other ids, with the workshop's text.
  const workshop = preview.nodes.slice(3)
  assert.equal(workshop.find(n => n.options.id === 'card-fund-1--2').options.text, 'Second $200')
  assert.equal(workshop.find(n => n.options.id === 'lane-reserve--2').options.text, createBudgetWorkshop().lanes.find(lane => lane.id === 'reserve').label)
  assert.equal(workshop.length, slatePreview(stored()).nodes.length)
})


test('cards are drawn as the slate’s own notes: the first note with words on it, or a plain canvas note on a slate with none', async () => {
  const { workshopCardLook, workshopStyle } = await import('../web/app/imports/api/common/workshop-look.mjs')
  // The note a new slate starts with (createSlate.js): stored in v1 form.
  const welcome = { options: { id: 'w', text: 'Welcome!', xPos: 0, yPos: 0, width: 140, height: 60, backgroundColor: '#699bc3',
    foregroundColor: 'rgba(255, 255, 255, 0.87)', fontFamily: 'Manrope', fontSize: '14pt', vectorPath: 'roundedrectangle', borderWidth: 0 }, relationships: { associations: [] } }
  assert.deepEqual(workshopCardLook([{ options: { id: 'e', text: '' } }, welcome]), {
    backgroundColor: '#699bc3', textColor: 'rgba(255, 255, 255, 0.87)', fontFamily: 'Manrope', fontSize: 19, borderWidth: 0, cornerRadius: 10,
  })
  // A live note, as the engine holds it.
  assert.deepEqual(workshopCardLook([{ options: { text: 'Hi', backgroundColor: '#f0f0f0', fontColor: '#000000', fontFamily: 'Arial, sans-serif', fontSize: 14, borderColor: '#cccccc', borderWidth: 1, shape: 'rectangle' } }]),
    { backgroundColor: '#f0f0f0', textColor: '#000000', fontFamily: 'Arial, sans-serif', fontSize: 14, borderColor: '#cccccc', borderWidth: 1, cornerRadius: 0 })
  // A slate with no notes: the engine's plain note, the one a double-click makes.
  assert.deepEqual(workshopCardLook([]), { backgroundColor: '#f0f0f0', textColor: '#000000', fontFamily: 'Arial, sans-serif', fontSize: workshopNoteStyle.fontSize, borderColor: '#cccccc', borderWidth: 1, cornerRadius: 0 })
  assert.equal(workshopStyle([]).card.backgroundColor, '#f0f0f0')
  // The preview of a slate with a note draws its cards in that note's look, as the canvas does.
  const preview = slatePreview({ ...stored(), nodes: [welcome], nativeCanvasDrawing: true })
  const card = preview.nodes.find(n => n.options.id === 'card-fund-1').options
  assert.equal(card.backgroundColor, '#699bc3')
  assert.equal(card.foregroundColor, 'rgba(255, 255, 255, 0.87)')
  const lane = preview.nodes.find(n => n.options.id === 'lane-reserve').options
  assert.equal(lane.foregroundColor, workshopNoteStyle.textColor)
})
