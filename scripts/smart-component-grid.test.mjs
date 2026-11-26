// A printable page built from a description (snap-grid spec, owner's choice 2026-11-25: "a page-sized grid where equal
// tiles snap into cells and the composed page exports to print/PDF"): which words go to a grid sheet, the starter kits,
// the quality gate (each case with a negative) and its repairs, the draft_grid tool's reading, the drafting check's retry
// codes, the sheet's own sentences in chat, and what the preview says.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import 'slateboxjs/workshops/behaviour'
import { rulebook, validateWorkshop } from 'slateboxjs/workshops/model'
import { gridBoard, gridDescription, gridKitId, gridQuality, gridSaid, gridStarter, repairGrid } from '../web/app/imports/api/common/builder-grid.mjs'
import { builderBoard, builderSaid } from '../web/app/imports/api/common/builder-freeform.mjs'
import { gridChat, gridEditFormats, gridTypeOf } from '../web/app/imports/api/common/grid-chat.mjs'
import { gridAuthorTool, gridDraftCheck, parseGridDraft } from '../web/app/server/methods/workshop-grid-draft.mjs'
import { laneSystemValues } from '../web/app/server/methods/lane-chat.mjs'
import { PROMPTS } from './evals/smart-components/prompts.mjs'
import { GOOD_GRID, gridDraftOf } from './evals/smart-components/recorded.mjs'

const OWNER = 'snappable congruent pieces to compose new printable materials'
const pages = PROMPTS.filter((p) => p.expect?.kind === 'grid')
const sheet = (message = OWNER) => validateWorkshop(gridStarter(message))
const call = (args, name = 'draft_grid') => ({ name, arguments: args })

test('the words that name a composed page go to a grid sheet; a board of lanes keeps its own', () => {
  for (const { id, prompt } of pages) assert.equal(gridDescription(prompt), true, id)
  assert.equal(gridDescription('a recipe card builder: drag ingredients and steps onto a card I can print'), true)
  for (const negative of ['a seating chart where students snap to desks, four desks per table group', 'a floor plan with rooms that snap together: kitchen, two bedrooms, bath, living room',
    'what can I build?', 'quarterly OKRs: objectives with key results moving from draft to committed to achieved', 'camping packing list: to pack, packed, in the car',
    'a Gantt-style plan with dependencies: design before build, build before test, test before launch', 'a lesson plan grid for a week: warm-up, main activity, practice and exit ticket each day',
    'what does a printable worksheet look like?']) assert.equal(gridDescription(negative), false, negative)
  // The owner's words, the jigsaw's 2 by 2 frame and the comic strip: pages, not lanes.
  for (const yes of [OWNER, 'jigsaw-like puzzle pieces that fit into a 2 by 2 frame', 'comic strip panel builder with characters and speech bubbles I can arrange and print']) assert.equal(gridDescription(yes), true, yes)
})

test('every starter kit is a finished example page that passes the sheet’s gate and its own quality gate', () => {
  const kits = {
    printable: OWNER, worksheet: 'printable math worksheet maker: drag problem blocks onto a page, a page holds six blocks', flashcards: 'a printable flashcard sheet for Spanish vocabulary',
    bingo: 'bingo card maker: 5 by 5 squares', comic: 'a comic page with panels', stickers: 'a sticker sheet for classroom rewards, A4, 3 across', recipe: 'a recipe card I can print',
    jigsaw: 'jigsaw-like puzzle pieces that fit into a 2 by 2 frame',
  }
  for (const [kit, message] of Object.entries(kits)) {
    assert.equal(gridKitId(message), kit, message)
    const made = sheet(message)
    assert.equal(made.kind, 'grid')
    assert.deepEqual(gridQuality(made, { message }), [], message)
    assert.ok(made.cards.some((card) => card.tile.stamp), kit + ': the tray has stamps')
    assert.ok(made.cards.some((card) => card.laneId === 'page-1'), kit + ': page 1 is composed')
  }
  // The owner's page: Letter portrait, 4 by 2 cells, seven stamps, the water cycle composed with a cell left free.
  const owner = sheet()
  assert.deepEqual([owner.title, owner.grid.page, owner.grid.cells], ['Printable page kit', { size: 'letter', orientation: 'portrait', margin: 0.5 }, { rows: 4, cols: 2, gutter: 0.125 }])
  assert.equal(owner.cards.filter((card) => card.tile.stamp).length, 7)
  assert.deepEqual(rulebook().lines(owner), ['Tiles snap to free cells; none overlap.', 'A page holds at most 1 heading.', 'Every page needs a heading.', 'Pictures can span up to 2 by 2 cells.'])
  // The words decide the page: six blocks per page is the worksheet's limit; A4 and 3 across the sticker sheet's.
  assert.equal(sheet('a worksheet builder, six blocks per page').behaviour.rules.find((rule) => rule.kind === 'tileMax' && rule.type === 'question').max, 6)
  const stickers = sheet('a sticker sheet for classroom rewards, A4, 3 across')
  assert.deepEqual([stickers.grid.page.size, stickers.grid.cells.cols], ['a4', 3])
  const bingo = sheet('bingo card maker')
  assert.equal(bingo.cards.find((card) => card.cell?.row === 3 && card.cell.col === 2).label, 'Free')
})

test('the quality gate: each case refuses with its own sentence, and the starter passes them all', () => {
  const ok = sheet()
  assert.deepEqual(gridQuality(ok, { message: OWNER }), [])
  const pageOne = ok.cards.filter((card) => card.laneId === 'page-1'), tray = ok.cards.filter((card) => card.laneId === 'tray')
  const with_ = (cards, extra = {}) => validateWorkshop({ ...ok, cards, ...extra })
  const says = (board, pattern) => assert.ok(gridQuality(board, { message: OWNER }).some((line) => pattern.test(line)), String(pattern) + ' in ' + JSON.stringify(gridQuality(board, { message: OWNER })))
  says(with_([tray[0], pageOne[0]]), /^Give the sheet at least three tiles\.$/)
  says(with_(tray), /^Compose page 1 as a finished example\.$/)
  says(with_(pageOne), /^Put the tiles people add in the tray\.$/)
  says(with_([...ok.cards, { id: 'blank', label: 'Question 9', laneId: 'tray', tile: { type: 'question' } }]), /“Question 9” is only a placeholder/)
  says(with_([...ok.cards, { id: 'lorem', label: 'Filler', laneId: 'tray', tile: { type: 'text', body: 'Lorem ipsum dolor' } }]), /“Filler” is only a placeholder/)
  says(with_([...ok.cards, { id: 'caps', label: 'Your words', laneId: 'tray', tile: { type: 'text', body: 'YOUR TEXT HERE' } }]), /“Your words” is only a placeholder/)
  says(with_([...ok.cards, { id: 'tbd', label: 'Later', laneId: 'tray', tile: { type: 'text', body: 'TBD' } }]), /“Later” is only a placeholder/)
  // A numbered name with a real question in it passes.
  assert.deepEqual(gridQuality(with_([...ok.cards, { id: 'q1', label: 'Question 1', laneId: 'tray', tile: { type: 'question', body: 'What turns water into vapor?' } }]), { message: OWNER }), [])
  says(with_([...ok.cards, { ...tray[1], id: 'again' }]), /^Give each tile its own content: “Fact” appears more than once\.$/)
  const terms = (n) => Array.from({ length: n }, (_, i) => ({ id: 't' + i, label: ['Lion', 'Tiger', 'Zebra', 'Panda', 'Koala', 'Otter'][i], laneId: i ? 'page-1' : 'tray', tile: { type: 'term' }, ...(i && { cell: { row: Math.floor(i / 2), col: i % 2 } }) }))
  says(with_(terms(4), { behaviour: { ...ok.behaviour, rules: [] } }), /^Use more than one kind of tile/)
  assert.ok(!gridQuality(with_(terms(6), { behaviour: { version: 1, rev: 1, rules: [{ id: 'types', kind: 'tileTypes', types: ['term'], on: true, severity: 'refuse', set: ok.behaviour.rules[0].set }] } }), { message: OWNER }).some((line) => /more than one kind/.test(line)), 'six different terms pass')
  says(with_(ok.cards, { behaviour: { version: 1, rev: 1, rules: [] } }), /^Give the sheet at least one rule: allowed tiles, a maximum, a requirement or a span\.$/)
  says(with_(ok.cards, { behaviour: { ...ok.behaviour, rules: [...ok.behaviour.rules, { ...ok.behaviour.rules[0], id: 'qr-max', type: 'qr' }] } }), /^A rule names qr tiles, and no tile is one/)
  says(with_(ok.cards.filter((card) => card.tile.type !== 'heading' || card.laneId === 'tray')), /^Page 1 needs a heading\.$/)
  says(with_([...ok.cards, { id: 'qr', label: 'Class site', laneId: 'tray', tile: { type: 'qr' } }]), /“Class site” is a QR code with no web address/)
  // Domain fit: a page about something else entirely, for words that name a topic.
  const bingo = 'bingo card maker for my class'
  assert.match(gridQuality(validateWorkshop({ ...sheet(bingo), title: 'Plants', cards: sheet(OWNER).cards }), { message: bingo }).join(' '), /None of the tiles is about bingo/)
  for (const line of gridQuality(with_(tray), { message: OWNER })) assert.doesNotMatch(line, /\{|\[|undefined/)
})

test('repairs put right only what is unambiguous, never inventing content', () => {
  const ok = sheet()
  const draft = structuredClone(ok)
  draft.cards.push({ ...draft.cards[1], id: 'dup' })
  draft.cards.find((card) => card.label === 'Clouds over a hill').tile.image.src = 'https://made.up/clouds.png'
  draft.cards.push({ id: 'qr', label: 'Class site', laneId: 'tray', tile: { type: 'qr', link: 'https://invented.example/x' } })
  draft.cards.push({ id: 'wide', label: 'Wide picture', laneId: 'page-1', tile: { type: 'image', image: { alt: 'A wide picture' } }, cell: { row: 3, col: 1, cols: 3 } })
  draft.cards.push({ id: 'over', label: 'On the heading', laneId: 'page-1', tile: { type: 'text', body: 'Rain' }, cell: { row: 0, col: 0 } })
  draft.behaviour.rules.push({ id: 'types', kind: 'tileTypes', types: ['heading', 'text', 'image', 'question', 'answer-lines', 'word-bank', 'diagram', 'sticker'], on: true, severity: 'refuse', set: draft.behaviour.rules[0].set })
  const { workshop, repairs } = repairGrid(draft, { message: OWNER })
  const read = validateWorkshop(workshop)
  assert.equal(read.cards.filter((card) => card.label === 'Fact').length, 1, 'the repeated tile is left out')
  assert.equal(read.cards.find((card) => card.label === 'Clouds over a hill').tile.image.src, undefined, 'an invented picture address is taken away')
  assert.ok(!read.cards.some((card) => card.tile.type === 'qr'), 'a QR code whose address was invented goes')
  assert.deepEqual(read.cards.find((card) => card.id === 'wide').cell, { row: 3, col: 1 }, 'a span is clamped to the page')
  assert.deepEqual([read.cards.find((card) => card.id === 'over').laneId, read.cards.find((card) => card.id === 'over').cell], ['tray', undefined], 'a tile over another goes to the tray')
  assert.deepEqual(read.behaviour.rules.find((rule) => rule.kind === 'tileTypes').types, ['heading', 'text', 'image', 'question', 'answer-lines', 'word-bank', 'diagram'], 'tiles no tile uses come off the list')
  assert.ok(repairs.length >= 6, repairs.join('; '))
  // A picture address the person gave is kept.
  const given = structuredClone(ok)
  given.cards.find((card) => card.label === 'Clouds over a hill').tile.image.src = 'https://example.org/clouds.png'
  assert.equal(repairGrid(given, { message: OWNER + ' https://example.org/clouds.png' }).workshop.cards.find((card) => card.label === 'Clouds over a hill').tile.image.src, 'https://example.org/clouds.png')
})

test('the draft_grid tool: rows and columns from 1 become cells from 0; a picture or QR address is never taken from the model', () => {
  assert.deepEqual(gridAuthorTool.parameters.required, ['title', 'page', 'grid', 'tray', 'pages', 'rules'])
  assert.deepEqual(gridAuthorTool.parameters.$defs.type.enum.length, 12)
  const board = parseGridDraft(GOOD_GRID, { message: OWNER })
  assert.equal(board.kind, 'grid')
  assert.deepEqual(board.cards.find((card) => card.label === 'Parts of a plant').cell, { row: 0, col: 0, cols: 2 })
  assert.deepEqual(board.cards.find((card) => card.label === 'A sunflower').cell, { row: 1, col: 0, rows: 2 })
  assert.ok(board.cards.filter((card) => card.laneId === 'tray').every((card) => card.tile.stamp))
  assert.deepEqual(board.behaviour.rules.map((rule) => [rule.kind, rule.set.by, rule.set.via]), [['tileMax', 'Slatebox agent', 'chat'], ['tileNeeds', 'Slatebox agent', 'chat'], ['tileSpan', 'Slatebox agent', 'chat']])
  const qr = { ...GOOD_GRID, tray: [...GOOD_GRID.tray, { type: 'qr', label: 'Class site', link: 'https://class.example/home' }] }
  assert.ok(!parseGridDraft(qr, { message: OWNER }).cards.some((card) => card.tile.type === 'qr'), 'an address not in the words: the QR code goes')
  assert.equal(parseGridDraft(qr, { message: OWNER + ' https://class.example/home' }).cards.find((card) => card.tile.type === 'qr').tile.link, 'https://class.example/home')
  // Lists sent as text, numbers as strings: read as they were meant.
  const asText = { ...GOOD_GRID, tray: JSON.stringify(GOOD_GRID.tray), pages: JSON.stringify(GOOD_GRID.pages), grid: { rows: '4', cols: '2' } }
  assert.deepEqual(parseGridDraft(asText, { message: OWNER }).cards, board.cards)
  assert.throws(() => parseGridDraft({ ...GOOD_GRID, pages: [{ tiles: [{ type: 'text', label: 'Somewhere', body: 'x' }] }] }), /Place “Somewhere” at a row and a column, counted from 1\./)
  // A margin or gap a little off the steps is taken to the nearest; a name that starts with its kind loses it; words that
  // only repeat the name are said once.
  const off = parseGridDraft({ ...GOOD_GRID, page: { ...GOOD_GRID.page, margin: 0.4 }, grid: { ...GOOD_GRID.grid, gutter: 0.1 },
    tray: [...GOOD_GRID.tray, { type: 'sticker', label: 'Sticker – Great job!' }, { type: 'heading', label: "Heading: 'Plant parts'", body: 'Plant parts' }] }, { message: OWNER })
  assert.deepEqual([off.grid.page.margin, off.grid.cells.gutter], [0.375, 0.125])
  assert.ok(off.cards.some((card) => card.label === 'Great job!'))
  assert.deepEqual(off.cards.find((card) => card.label === 'Plant parts').tile, { type: 'heading', stamp: true })
})

test('the drafting check: a good page passes; a broken one and a weak one are asked again, naming what is wrong', () => {
  assert.equal(gridDraftCheck(call(GOOD_GRID), { message: OWNER }), null)
  const wrong = gridDraftCheck(call(GOOD_GRID, 'draft_workshop'), { message: OWNER })
  assert.equal(wrong.code, 'invalidGridDraft')
  assert.match(wrong.retryPrompt, /Repair the previous draft\. Call the requested tool\. Return a complete draft_grid tool call\.$/)
  const broken = gridDraftCheck(call({ ...GOOD_GRID, grid: { rows: 4, cols: 9 } }), { message: OWNER })
  assert.equal(broken.code, 'invalidGridDraft')
  const weak = gridDraftCheck(call({ ...GOOD_GRID, rules: [] }), { message: OWNER })
  assert.equal(weak.code, 'weakGridDraft')
  assert.match(weak.retryPrompt, /Give the sheet at least one rule: allowed tiles, a maximum, a requirement or a span\./)
  // Each eval prompt's own good page passes the check for its words.
  for (const { id, prompt } of pages) assert.equal(gridDraftCheck(call(gridDraftOf(sheet(prompt), 'Drafted ' + id)), { message: prompt }), null, id)
})

test('builderBoard and builderSaid for a page: the draft when it holds together, else the starter; the preview says what it made', () => {
  const drafted = builderBoard(parseGridDraft(GOOD_GRID, { message: OWNER }), OWNER, { kind: 'grid' })
  assert.equal(drafted.drafted, true)
  assert.equal(builderSaid(drafted.workshop, { drafted: true }), 'Drafted “Printable page kit”: a Letter portrait page, 4 by 2 cells, 5 tiles to drag. Say “make it 3 columns”, or print it from the page header.')
  for (const broken of [null, { version: 1, title: 'x' }, { ...parseGridDraft(GOOD_GRID, { message: OWNER }), behaviour: undefined }]) {
    const made = builderBoard(broken, OWNER, { kind: 'grid' })
    assert.equal(made.drafted, false)
    assert.equal(made.workshop.title, 'Printable page kit')
  }
  assert.equal(gridBoard(null, OWNER).drafted, false)
  assert.equal(gridSaid(sheet(), { drafted: false, guest: true }), 'Started “Printable page kit”: a Letter portrait page, 4 by 2 cells, 7 tiles to drag. This is a starter from your words: sign in and the agent drafts the whole page for you.')
  assert.match(gridSaid(sheet('bingo card maker'), { drafted: false, message: 'bingo card maker' }), /Say “duplicate page 1 shuffled” for a different card per player\.$/)
})

test('the sheet’s own sentences in chat are its edits; print is an action; a word bank without words asks which', () => {
  const board = sheet()
  const edits = (text, selection) => gridChat(board, text, selection)?.edits
  assert.deepEqual(edits('make it 3 columns'), [{ kind: 'set_grid', cols: 3 }])
  assert.deepEqual(edits('3 columns'), [{ kind: 'set_grid', cols: 3 }])
  assert.deepEqual(edits('4 rows'), [{ kind: 'set_grid', rows: 4 }])
  assert.deepEqual(edits('3 by 4'), [{ kind: 'set_grid', rows: 3, cols: 4 }])
  assert.deepEqual(edits('Set grid to 5 rows 2 columns'), [{ kind: 'set_grid', rows: 5, cols: 2 }])
  assert.deepEqual(edits('A4 landscape'), [{ kind: 'set_page', size: 'a4', orientation: 'landscape' }])
  assert.deepEqual(edits('letter'), [{ kind: 'set_page', size: 'letter' }])
  assert.deepEqual(edits('portrait'), [{ kind: 'set_page', orientation: 'portrait' }])
  assert.deepEqual(edits('half-inch margins'), [{ kind: 'set_page', margin: 0.5 }])
  assert.deepEqual(edits('no gaps'), [{ kind: 'set_grid', gutter: 0 }])
  assert.deepEqual(edits('add a word bank: sun, rain, cloud'), [{ kind: 'add_tile', type: 'word-bank', label: 'Word bank', words: ['sun', 'rain', 'cloud'] }])
  assert.deepEqual(gridChat(board, 'add a word bank'), { reply: 'Which words go in the bank? Say them, such as “Add a word bank: sun, rain, cloud”.' })
  assert.deepEqual(edits('add a heading “Fractions quiz”'), [{ kind: 'add_tile', type: 'heading', label: 'Fractions quiz' }])
  assert.deepEqual(edits('add a QR code to https://example.org/class'), [{ kind: 'add_tile', type: 'qr', label: 'Scan me', link: 'https://example.org/class' }])
  const picture = board.cards.find((card) => card.label === 'Clouds over a hill')
  assert.deepEqual(edits('make the picture 2 by 2'), [{ kind: 'place_tile', card: { id: picture.id }, page: { id: 'page-1' }, row: 2, col: 2, rows: 2, cols: 2 }])
  const fact = board.cards.find((card) => card.label === 'How water moves')
  assert.deepEqual(edits('span How water moves across'), [{ kind: 'place_tile', card: { id: fact.id }, page: { id: 'page-1' }, row: 2, col: 1, rows: 1, cols: 2 }])
  assert.deepEqual(edits('Put Question on Page 1 at row 4 column 2 spanning 1 by 1'), [{ kind: 'place_tile', card: { id: board.cards.find((card) => card.label === 'Question').id }, page: { id: 'page-1' }, row: 4, col: 2, rows: 1, cols: 1 }])
  assert.deepEqual(edits('add a page'), [{ kind: 'add_page' }])
  assert.deepEqual(edits('duplicate page 1'), [{ kind: 'add_page', copyOf: { id: 'page-1' } }])
  assert.deepEqual(edits('copy this page shuffled', { kind: 'lane', id: 'page-1' }), [{ kind: 'add_page', copyOf: { id: 'page-1' }, shuffle: true }])
  const two = validateWorkshop({ ...board, lanes: [...board.lanes, { id: 'page-2', label: 'Page 2' }] })
  assert.deepEqual(gridChat(two, 'remove page 2').edits, [{ kind: 'remove_lane', lane: { id: 'page-2' } }])
  const maxRule = board.behaviour.rules.find((rule) => rule.kind === 'tileMax')
  assert.deepEqual(edits('only one heading per page'), [{ kind: 'set_rule', rule: maxRule.id, max: 1, on: true }])
  assert.deepEqual(edits('every page needs a heading'), [{ kind: 'set_rule', rule: board.behaviour.rules.find((rule) => rule.kind === 'tileNeeds').id, atLeast: 1, on: true }])
  assert.deepEqual(edits('pictures can be 2 by 2'), [{ kind: 'set_rule', rule: board.behaviour.rules.find((rule) => rule.kind === 'tileSpan').id, rows: 2, cols: 2, on: true }])
  assert.deepEqual(edits('at most 3 questions per sheet'), [{ kind: 'add_rule', rule: { kind: 'tileMax', type: 'question', max: 3, per: 'sheet' } }])
  assert.deepEqual(edits('no QR codes'), [{ kind: 'add_rule', rule: { kind: 'tileTypes', types: ['heading', 'text', 'image', 'question', 'answer-lines', 'word-bank', 'diagram'] } }])
  assert.deepEqual(gridChat(board, 'print'), { reply: 'Printing Page 1.', action: { kind: 'print', pages: ['page-1'], pdf: false } })
  assert.deepEqual(gridChat(two, 'print page 2'), { reply: 'Printing Page 2.', action: { kind: 'print', pages: ['page-2'], pdf: false } })
  assert.deepEqual(gridChat(two, 'print all pages'), { reply: 'Printing all 2 pages.', action: { kind: 'print', pages: ['page-1', 'page-2'], pdf: false } })
  assert.deepEqual(gridChat(board, 'export pdf'), { reply: 'Saving Page 1 as a PDF.', action: { kind: 'print', pages: ['page-1'], pdf: true } })
  assert.deepEqual(gridChat(board, 'how many cells are free?'), { reply: 'Page 1 has 1 of 8 cells free.' })
  assert.match(gridChat(board, 'why can’t I put Question there?').reply, /^Question is a stamp: dropping it on a page makes a copy/)
  assert.equal(gridChat({ ...board, kind: 'nest' }, 'make it 3 columns'), null)
  assert.equal(gridTypeOf('word banks'), 'word-bank')
  assert.equal(gridTypeOf('a picture'), 'image')
  // The agent's chat proposes in the sheet's own formats.
  assert.equal(laneSystemValues(board).editFormats, gridEditFormats.join('; '))
  assert.notEqual(laneSystemValues({ kind: undefined }).editFormats, gridEditFormats.join('; '))
})
