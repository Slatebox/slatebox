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
import { KIT_KINDS, PREVIEW_CAPTION_TEXT, draftShownBox, previewBoardOf, previewCaption, previewCanvasOf, previewKeepSentence } from '../web/app/imports/api/common/conversation-preview.mjs'
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

test('a board draft brought into view includes its tag at the size it is drawn, and the room a phone\'s toolbar takes (review)', () => {
  const frame = { x: 100, y: 50, width: 800, height: 400 }
  // At 100% on a laptop the engine's frame already holds the tag.
  assert.deepEqual(draftShownBox(frame, { zoom: 1 }), frame)
  // Zoomed out, the tag keeps its size on screen, so it stands further above the frame in world units.
  const out = draftShownBox(frame, { zoom: 0.5 })
  assert.equal(out.y, 50 - 12)
  assert.equal(out.y + out.height, 450)
  // On a phone at 80%: the tag keeps its 24px (it is no button), and 52px of toolbar lie over the canvas's top.
  const phone = draftShownBox(frame, { zoom: 0.8, above: 52 })
  const tagGrowth = 12 / 0.8 - 12
  assert.ok(Math.abs(phone.y - (50 - tagGrowth - 52 / 0.8)) < 1e-9)
})

test('on the dark canvas the chrome reads: the title in light ink, the focus frame and tags amber, chips and badges a raised surface (dark mode with board polish)', async () => {
  const { BOARD_CHROME, BOARD_INK, CANVAS, contrast, inkCanvas } = await import('../web/app/imports/ui/common/canvasTheme.mjs')
  const { JSDOM } = await import('jsdom')
  const t = BOARD_CHROME.dark
  const bg = CANVAS.dark.background
  // Every token is one the engine's chrome reads (chromeInk / layerInk), so none is a typo the engine ignores.
  const dist = new URL('../web/app/node_modules/slateboxjs/dist/', import.meta.url)
  const engine = readdirSync(dist).filter(f => f.endsWith('.js')).map(f => readFileSync(new URL(f, dist), 'utf8')).join('\n')
  for (const name of Object.keys(t)) assert.ok(engine.includes(`var(${name},`), `${name} is read by the engine`)
  assert.ok(contrast(t['--slatebox-board-title'], bg) >= 7, 'a board\'s title is AAA on the dark canvas')
  assert.ok(contrast(t['--slatebox-board-chip-ink'], t['--slatebox-board-chip']) >= 4.5, 'a legend chip\'s words')
  assert.ok(contrast(BOARD_INK.dark['--slatebox-board-ink'], t['--slatebox-board-badge']) >= 4.5, 'a badge\'s icon (the board\'s ink)')
  assert.ok(contrast(t['--slatebox-board-focus'], bg) >= 3, 'the focus frame on the canvas')
  assert.ok(contrast(t['--slatebox-board-focus-ink'], t['--slatebox-board-focus']) >= 4.5, '"Editing" on its tag')
  assert.ok(contrast(t['--slatebox-board-focus'], t['--slatebox-board-halo']) >= 4.5, '"Done" on its tag')
  assert.ok(contrast(t['--slatebox-board-preview'], bg) >= 3, 'a draft\'s dashed frame')
  assert.ok(contrast(t['--slatebox-board-preview-ink'], t['--slatebox-board-preview-fill']) >= 4.5, 'a draft\'s tag')
  assert.ok(contrast(t['--slatebox-board-canvas-ink'], bg) >= 7, 'a plan\'s header and dates on the canvas')
  // Set with the board's ink on every themed surface (canvas, presenter, share page), and taken off in light mode.
  const doc = new JSDOM('<!doctype html><body><div id="c"></div></body>').window.document
  const el = doc.getElementById('c')
  const { themeCanvas } = await import('../web/app/imports/ui/common/canvasTheme.mjs')
  const undo = themeCanvas(el, { mode: 'dark', getContainerStyle: () => ({}) })
  assert.equal(el.style.getPropertyValue('--slatebox-board-title'), t['--slatebox-board-title'])
  assert.equal(el.style.getPropertyValue('--slatebox-board-focus'), t['--slatebox-board-focus'])
  undo()
  assert.equal(el.style.getPropertyValue('--slatebox-board-title'), '')
  // A second board's plan bar (b2:card-…) takes the dark card surface, as the first board's does.
  const page = new JSDOM(`<!doctype html><body><div id="slateCanvas"><svg><g data-node-id="b2:card-design"><path data-node-background-path fill="#fffdf6" stroke="#667872"></path><text fill="#1d2b2a">Design</text></g></svg></div></body>`).window.document
  inkCanvas(page.getElementById('slateCanvas'), 'dark')
  assert.notEqual(page.querySelector('[data-node-id="b2:card-design"] path').style.getPropertyValue('fill'), '')
  // A second board's columns are lanes on the dark canvas too, not white slabs.
  const css = readFileSync(new URL('../web/app/imports/ui/common/main.css', import.meta.url), 'utf8')
  assert.match(css, /\[data-sb-canvas=dark\] g\[data-node-id\*=":column-"\] \[data-node-background-path\],/)
})
