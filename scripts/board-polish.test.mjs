// Boards look designed (board polish, audit #3 #7 #16): a library preview of any board is drawn by the board
// renderer itself (a launch plan's too), tagged in the brand's amber "Preview · not added yet"; the words under it
// say what Keep does in the board's own terms; the chat's "Rules" chips are the legend the board draws above itself;
// and what a person reads says "column", while the chat still reads "lane".
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { boardLegend, DRAFT_TAG, validateWorkshop } from 'slateboxjs/workshops/model'
import { catalogPreset } from 'slateboxjs/catalog'
import { catalogSamples } from 'slateboxjs/workshops/samples'
import 'slateboxjs/workshops/behaviour'
import 'slateboxjs/workshops/rules'
import { KIT_KINDS, PREVIEW_CAPTION_TEXT, previewBoardOf, previewCaption, previewCanvasOf, previewKeepSentence } from '../web/app/imports/api/common/conversation-preview.mjs'
import { boardRuleChips } from '../web/app/imports/api/common/board-rules.mjs'
import { proposeLaneEdit, proposeLaneReply } from '../web/app/imports/api/common/lane-conversation.mjs'
import { workshopStarters } from '../web/app/imports/api/common/workshop-starters.mjs'

const preset = id => validateWorkshop(catalogPreset(id, undefined, catalogSamples))
const draftOf = (id, origin) => ({ mode: 'play', component: id, format: preset(id).kind ?? 'lanes', canvas: previewCanvasOf({ mode: 'play', workshop: preset(id), ...(origin && { origin }) }) })

test('15. a Retro, a Now / Next / Later and a launch plan draft are each drawn as the board itself, where Keep puts it', () => {
  const existing = [{ id: 'welcome', x: 40, y: 40, width: 200, height: 100 }]
  for (const id of ['retro', 'now-next-later', 'launch-plan']) {
    const board = previewBoardOf(draftOf(id).canvas, existing)
    assert.ok(board, id + ' is drawn as a board')
    assert.equal(board.workshop.title, preset(id).title)
    // Past the right of what the slate holds, as Keep would put it.
    assert.deepEqual(board.origin, { x: 320, y: 40 })
  }
  // The server's own place wins.
  assert.deepEqual(previewBoardOf(draftOf('retro', { x: 1600, y: 96 }).canvas, existing).origin, { x: 1600, y: 96 })
  // A plan needs its kit to be drawn; a drawing is not a board.
  assert.ok(KIT_KINDS.includes(preset('launch-plan').kind))
  assert.equal(previewBoardOf({ nodes: [], links: [] }, existing), null)
})

test('16. "play the route" is a map’s only; a plan says its own sentence; a board of columns takes notes', () => {
  assert.equal(previewKeepSentence(draftOf('decision-path')), 'Keep this to play the route alongside your original drawing.')
  assert.equal(previewKeepSentence(draftOf('launch-plan')), 'Keep it to add the plan; slide a task and what waits on it follows.')
  assert.equal(previewKeepSentence(draftOf('hiring-plan')), 'Keep it to add the plan; slide a task and what waits on it follows.')
  for (const id of ['retro', 'now-next-later', 'team-board']) assert.equal(previewKeepSentence(draftOf(id)), 'Drag notes onto it after Keep: each becomes a card.')
  for (const id of ['launch-plan', 'sales-pipeline', 'budget', 'retro']) assert.doesNotMatch(previewKeepSentence(draftOf(id)) ?? '', /play the route/)
  assert.equal(previewKeepSentence({ canvas: { nodes: [], links: [] } }), null)
})

/** Every source file under a folder (no node_modules). */
function* sources(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* sources(path)
    else if (/\.(m?js|jsx|css|html)$/.test(name)) yield path
  }
}

test('17. the preview tag is the brand’s, with the engine’s words; the off-brand blue is gone', () => {
  assert.equal(PREVIEW_CAPTION_TEXT, 'Preview · not added yet')
  assert.equal(PREVIEW_CAPTION_TEXT, DRAFT_TAG)
  const tag = previewCaption({ x: 0, y: 100, width: 300, height: 200 }).options
  assert.equal(tag.backgroundColor, '#f6cf86')
  assert.equal(tag.foregroundColor, '#1f3d33')
  const root = new URL('../web/app/', import.meta.url).pathname
  const blue = []
  for (const folder of ['imports', 'server', 'client']) for (const file of sources(join(root, folder))) if (/#2f5fd0/i.test(readFileSync(file, 'utf8'))) blue.push(file)
  assert.deepEqual(blue, [])
})

test('19. the chat’s “Rules” chips are the legend the board draws above itself', () => {
  for (const id of ['team-board', 'must-should-could', 'retro', 'launch-plan', 'hiring-plan', 'sales-pipeline', 'sort-evidence']) {
    const board = preset(id)
    assert.deepEqual(boardRuleChips(board).map(chip => chip.text), boardLegend(board).map(item => item.text), id)
  }
  assert.deepEqual(boardRuleChips(preset('team-board')).map(chip => chip.text), ['One column at a time', 'Won\'t do is a bin'])
  // A Retro's rules are its counters' to say ("0 / 3"): no chips.
  assert.deepEqual(boardRuleChips(preset('retro')), [])
  assert.deepEqual(boardRuleChips(null), [])
})

test('9. what a person reads says "column"; the chat still reads "lane"', () => {
  const board = preset('team-board')
  const lane = /\blanes?\b/i
  for (const { text } of workshopStarters(board)) assert.doesNotMatch(text, lane, text)
  for (const { text } of workshopStarters(board, { kind: 'lane', id: 'doing' })) assert.doesNotMatch(text, lane, text)
  // Refusals and replies.
  for (const said of ['Add a lane', 'Remove this', 'Add a card called X to Blocked']) {
    try { proposeLaneEdit(board, said, null) } catch (error) { assert.doesNotMatch(error.message, lane, said) }
  }
  // Both words are read.
  assert.match(proposeLaneReply(validateWorkshop({ ...board, behaviour: undefined, lanes: board.lanes.slice(0, 4) }), 'Add a lane called Later', null).reply, /Added the column “Later”/)
  assert.match(proposeLaneReply(validateWorkshop({ ...board, behaviour: undefined, lanes: board.lanes.slice(0, 4) }), 'Add a column called Later', null).reply, /Added the column “Later”/)
})
