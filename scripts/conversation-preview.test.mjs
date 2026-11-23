// What a conversation preview draws on the canvas: every kind of draft the conversation makes
// becomes provisional notes in the places Keep would put them, and no saved note ever holds a
// line to a preview note.
import assert from 'node:assert/strict'
import test from 'node:test'
import { nativeCanvasDraft } from '../web/app/imports/api/common/native-canvas-conversation.mjs'
import { nativeSlateFromBrief } from '../web/app/imports/api/common/native-diagram-brief.mjs'
import { canvasOfWrites } from '../web/app/server/exec/conversation.mjs'
import { applyPlanToJSON } from 'slateboxjs/operations'
import {
  PREVIEW_CAPTION, PREVIEW_CAPTION_TEXT, READABLE_ZOOM, besideExisting, previewArtwork, previewCanvasOf, previewCaption, previewShown, previewView,
} from '../web/app/imports/api/common/conversation-preview.mjs'

const req = 'pReViEw1234567890'
const existingOf = board => board.nodes.map(n => ({ id: n.options.id, x: n.options.xPos, y: n.options.yPos, width: n.options.width, height: n.options.height }))
const ids = art => art.notes.map(n => n.options.id)
const held = art => new Set(art.links.map(l => l.holderId))

function sound(art, existing) {
  const previews = new Set(ids(art))
  assert.ok(previews.size > 0)
  for (const id of previews) assert.match(id, /^preview-/)
  for (const note of art.notes) {
    if (note.overlay) continue
    assert.equal(note.options.borderStyle, 'dashed', 'a preview note is outlined as provisional')
  }
  for (const link of art.links) {
    // Every line is held by a preview note, so a saved note never carries one.
    assert.ok(previews.has(link.holderId), link.holderId)
    assert.equal(link.association.parentId, link.holderId)
    assert.equal(link.association.childId, link.targetId)
    assert.ok(previews.has(link.targetId) || existing.some(n => n.id === link.targetId), link.targetId)
    assert.match(link.association.id, /^preview-/)
  }
  assert.ok(art.bounds.width > 0 && art.bounds.height > 0)
}

test('typed steps that continue an existing note: the new note where Keep puts it, its line held by the preview', () => {
  const board = nativeSlateFromBrief('Welcome!')
  const draft = nativeCanvasDraft(board, 'Welcome! → Next step', req)
  const existing = existingOf(board)
  const art = previewArtwork(previewCanvasOf(draft), existing)
  sound(art, existing)
  const kept = draft.nodes.find(n => n.options.text === 'Next step')
  const shown = art.notes.find(n => n.options.id === 'preview-' + kept.options.id)
  assert.equal(shown.options.text, 'Next step')
  assert.deepEqual([shown.options.xPos, shown.options.yPos], [kept.options.xPos, kept.options.yPos])
  // The line from Welcome! to Next step is held by a see-through preview note over Welcome!, so it
  // leaves from Welcome!'s edge and keeps its arrow at Next step.
  const welcome = board.nodes[0].options
  assert.equal(art.links.length, 1)
  const [link] = art.links
  const over = art.notes.find(n => n.overlay)
  assert.equal(link.holderId, 'preview-over-' + welcome.id)
  assert.equal(over.options.id, link.holderId)
  assert.deepEqual([over.options.xPos, over.options.yPos, over.options.width, over.options.height], [welcome.xPos, welcome.yPos, welcome.width, welcome.height])
  assert.equal(over.options.opacity, 0)
  assert.equal(link.targetId, shown.options.id)
  assert.equal(link.association.showChildArrow, draft.links[0].association.showChildArrow)
  // The see-through note is not part of where the preview is shown.
  assert.deepEqual([art.bounds.x, art.bounds.y], [kept.options.xPos, kept.options.yPos])
})

test('pasted lines: several paths become several preview notes and every connection between them', () => {
  const board = nativeSlateFromBrief('Start')
  const draft = nativeCanvasDraft(board, 'Intake → Review\nReview → Send a reply\nIntake → Archive', req)
  const existing = existingOf(board)
  const art = previewArtwork(previewCanvasOf(draft), existing)
  sound(art, existing)
  assert.deepEqual(art.notes.map(n => n.options.text).sort(), ['Archive', 'Intake', 'Review', 'Send a reply'])
  assert.equal(art.links.length, draft.nodes.reduce((sum, n) => sum + n.relationships.associations.length, 0))
})

test('a line between two notes already on the slate is held by a see-through preview note over the one it starts at', () => {
  const board = nativeSlateFromBrief('Alpha\nBeta')
  const draft = nativeCanvasDraft(board, 'Alpha → Beta', req)
  assert.equal(draft.nodes.length, 0)
  assert.equal(draft.links.length, 1)
  const existing = existingOf(board)
  const art = previewArtwork(previewCanvasOf(draft), existing)
  sound(art, existing)
  const alpha = board.nodes.find(n => n.options.text === 'Alpha').options
  const over = art.notes.find(n => n.overlay)
  assert.equal(over.options.id, 'preview-over-' + alpha.id)
  assert.deepEqual([over.options.xPos, over.options.yPos, over.options.width, over.options.height], [alpha.xPos, alpha.yPos, alpha.width, alpha.height])
  assert.equal(over.options.opacity, 0)
  assert.equal(art.links[0].targetId, board.nodes.find(n => n.options.text === 'Beta').options.id)
  assert.deepEqual([...held(art)], [over.options.id])
})

// Restated on purpose (combined release): an AI draft is no longer a graph handed to
// nativeCanvasDraft. On exec the model's program writes canvas operations, and the preview is what
// those writes add (canvasOfWrites). The checks are the same: drawn like typed steps, its three
// notes and both links, each note where Keep puts it.
test('an AI draft is previewed like typed steps', () => {
  const board = nativeSlateFromBrief('Welcome!')
  const operations = [
    { kind: 'add_nodes', count: 1, ids: ['a'], text: 'Plan', shape: 'rectangle', x: 600, y: 40, width: 220, height: 90 },
    { kind: 'add_nodes', count: 1, ids: ['b'], text: 'Build', shape: 'rectangle', x: 900, y: 40, width: 220, height: 90 },
    { kind: 'add_nodes', count: 1, ids: ['c'], text: 'Ship', shape: 'rectangle', x: 1200, y: 40, width: 220, height: 90 },
    { kind: 'connect_nodes', from: { ids: ['a'] }, to: { ids: ['b'] } },
    { kind: 'connect_nodes', from: { ids: ['b'] }, to: { ids: ['c'] } },
  ]
  const writes = [{ method: 'slates.applyOperations', input: { shareId: 'demo' }, body: { message: 'A plan for our launch', operations } }]
  const canvas = canvasOfWrites(board, writes, 'demo')
  const existing = existingOf(board)
  const art = previewArtwork(canvas, existing)
  sound(art, existing)
  assert.deepEqual(art.notes.map(n => n.options.text), ['Plan', 'Build', 'Ship'])
  assert.equal(art.links.length, 2)
  const kept = applyPlanToJSON(structuredClone(board), { message: 'A plan for our launch', operations }).slate.nodes.filter(n => ['a', 'b', 'c'].includes(n.options.id))
  for (const [i, node] of kept.entries()) assert.deepEqual([art.notes[i].options.xPos, art.notes[i].options.yPos], [node.options.xPos, node.options.yPos])
})

test('a workshop and an interactive route are previewed as their lanes, beside the drawing where they would be attached', () => {
  const board = nativeSlateFromBrief('Intake → Review')
  const existing = existingOf(board)
  for (const [message, labels] of [['Make a workshop with Now, Next and Later', ['Now', 'Next', 'Later']], ['Make this drawing interactive', ['Intake', 'Review']]]) {
    const draft = nativeCanvasDraft(board, message, req)
    const canvas = previewCanvasOf(draft)
    assert.ok(canvas.workshop)
    const art = previewArtwork(canvas, existing)
    sound(art, existing)
    for (const label of labels) assert.ok(art.notes.some(n => n.options.id.startsWith('preview-lane-') && n.options.text.includes(label)), label)
    const right = Math.max(...existing.map(n => n.x + n.width))
    assert.ok(art.bounds.x >= right, 'drawn past the right of the drawing')
    assert.deepEqual(besideExisting(existing), { x: Math.round(right + 80), y: Math.min(...existing.map(n => n.y)) })
  }
})

test('the caption that marks a preview sits above it and says what it is', () => {
  const caption = previewCaption({ x: 100, y: 300, width: 400, height: 200 })
  assert.equal(caption.options.id, PREVIEW_CAPTION)
  assert.equal(caption.options.text, PREVIEW_CAPTION_TEXT)
  assert.match(PREVIEW_CAPTION_TEXT, /^Preview/)
  assert.ok(caption.options.yPos + caption.options.height <= 300)
})

test('a draft with nothing to draw is refused rather than shown empty', () => {
  assert.throws(() => previewArtwork({}, []), /nothing to show/)
})

// Where the canvas looks to show a preview: the whole of it when it fits at a size that can be
// read, otherwise its start (the caption and the first steps) at the smallest readable size, with
// the rest a pan away. Never a view zoomed out until the notes are specks.
const view = (x, y, width, height, zoom) => ({ x, y, width, height, zoom })
const inside = (box, v) => box.x >= v.x && box.y >= v.y && box.x + box.width <= v.x + v.width && box.y + box.height <= v.y + v.height

test('a preview already in view leaves the view alone; one just outside it is panned to, not zoomed', () => {
  assert.equal(previewView({ x: 100, y: 100, width: 300, height: 200 }, view(0, 0, 1000, 800, 1)), null)
  const next = previewView({ x: 900, y: 100, width: 300, height: 200 }, view(0, 0, 1000, 800, 1))
  assert.equal(next.width, 1000)
  assert.equal(next.height, 800)
  assert.ok(inside({ x: 900, y: 100, width: 300, height: 200 }, next))
})

test('a preview wider than the canvas is zoomed out only as far as it needs, and is centred', () => {
  const box = { x: 0, y: 0, width: 1400, height: 200 }
  const next = previewView(box, view(0, 0, 1000, 800, 1))
  assert.ok(inside(box, next))
  const zoom = 1000 / next.width
  assert.ok(zoom >= READABLE_ZOOM && zoom < 1, String(zoom))
  assert.equal(Math.round(next.width / next.height * 100), Math.round(1000 / 800 * 100), 'the canvas keeps its shape')
})

test('a preview too large to read whole shows its start at the smallest readable size, on a desktop and on a phone', () => {
  // 24 long steps in a row, as the largest typed brief makes, with the caption above the first.
  const box = { x: 40, y: -12, width: 24 * 260, height: 140 }
  for (const [width, height] of [[1096, 836], [390, 380]]) {
    const next = previewView(box, view(0, 0, width, height, 1))
    const zoom = width / next.width
    assert.equal(Math.round(zoom * 100), Math.round(READABLE_ZOOM * 100), 'never below a readable size')
    // The caption and the first step are in view, at the left of the canvas.
    assert.ok(next.x <= box.x && box.x - next.x <= 48, 'starts at the preview\'s first step')
    assert.ok(next.y <= box.y && box.y + 100 <= next.y + next.height)
  }
})

test('a person who has zoomed out further than readable is not zoomed in; the preview is centred at their zoom', () => {
  const box = { x: 0, y: 0, width: 3000, height: 200 }
  const next = previewView(box, view(0, 0, 4000, 3200, 0.25))
  assert.equal(next.width, 4000)
  assert.ok(inside(box, next))
})

// ui-fix (2026-11-20): on a phone a workshop's lanes are stacked, and a proposal for the last lane
// was framed by the board's top, below the fold. What the proposal changes is shown instead.
test('a proposal whose board cannot be read whole shows what it changes; one that can is shown whole', () => {
  const board = { x: 0, y: -52, width: 260, height: 1400 }
  const change = { x: 20, y: 1100, width: 220, height: 160 }
  // A phone: the stacked board is too tall to read whole, so the change is what is brought into view.
  const phone = view(0, 0, 650, 520, 0.6)
  assert.deepEqual(previewShown(board, change, phone), change)
  const next = previewView(previewShown(board, change, phone), phone)
  assert.ok(inside(change, next))
  // A desktop: the board fits at a readable size, so it is shown whole, caption and all.
  const wide = { x: 0, y: -52, width: 820, height: 420 }
  assert.deepEqual(previewShown(wide, { x: 560, y: 200, width: 220, height: 160 }, view(0, 0, 1096, 836, 1)), wide)
  // Nothing marked as changed: the board as before.
  assert.deepEqual(previewShown(board, null, phone), board)
  // The change with its lane's name when that can be read whole, else the change alone.
  const withLane = { x: 0, y: 1040, width: 260, height: 220 }, tall = { x: 0, y: 700, width: 260, height: 600 }
  assert.deepEqual(previewShown(board, [withLane, change], phone), withLane)
  assert.deepEqual(previewShown(board, [tall, change], phone), change)
})

test('READABLE_ZOOM keeps a preview note\'s text legible', () => {
  assert.ok(READABLE_ZOOM >= 0.5 && READABLE_ZOOM < 1)
})
