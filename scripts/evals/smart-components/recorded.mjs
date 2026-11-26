// Recorded and known-bad model answers to free-form builder requests, for the deterministic layer
// (smart-components.test.mjs). Each case: the prompt (an id in prompts.mjs), the answers the model gives in order
// ({ args } a draft_workshop call, an object or the text it sent; { text } words, with no tool call; { name } another
// tool), and what must come of it:
//   drafted  the agent's board is used (provider 'ai', "Drafted …"), after `requests` model calls;
//   starter  the board is started from the words ("Started …"), still a valid smart component, never an error;
//            `guest`: the preview tells a visitor that signing in lets the agent draft it;
//   error    one plain sentence for the person (`said`), nothing drawn.
// `retry` is what the second request must tell the model (the board's own sentence for what was wrong).
//
// The Muse Ember shapes are the ones the live eval met (2026-11-25, test's AI config): a complete call written as
// text in its own markup instead of tool_calls (12 of 18 refused answers in a diagnostic run), and a call with empty
// arguments. The quality gate's shapes are the ones the owner was shown: numbered copies of their words, no rule at all.

const board = (over = {}) => ({
  version: 1,
  title: 'Snap-together printable kit',
  lanes: [{ id: 'piece-tray', label: 'Piece tray' }, { id: 'compose', label: 'Compose', capacity: 6 }, { id: 'print-sheet', label: 'Print sheet', capacity: 4 }],
  cards: [
    { id: 'square', label: 'Square 1x1', laneId: 'piece-tray', allowedLaneIds: ['piece-tray', 'compose', 'print-sheet'] },
    { id: 'bar', label: 'Bar 1x2', laneId: 'piece-tray' },
    { id: 'corner', label: 'Corner L', laneId: 'piece-tray' },
    { id: 'frame', label: 'Page frame', laneId: 'piece-tray', allowedLaneIds: ['piece-tray', 'print-sheet'] },
  ],
  ...over,
})
export const GOOD = board()

// The owner's words are a printable page (owner's choice, 2026-11-25): a good answer is a draft_grid call, a page of
// cells composed as a finished example with a tray of stamps and the sheet's rules (builder-grid.mjs).
export const GOOD_GRID = {
  title: 'Printable page kit',
  page: { size: 'letter', orientation: 'portrait', margin: 0.5 }, grid: { rows: 4, cols: 2, gutter: 0.125 },
  tray: [{ type: 'heading', label: 'Lesson title' }, { type: 'question', label: 'Question', body: 'Why do leaves change color in fall?' },
    { type: 'answer-lines', label: 'Answer lines', body: '3' }, { type: 'image', label: 'Picture', alt: 'A labeled drawing' },
    { type: 'word-bank', label: 'Word bank', words: ['root', 'stem', 'leaf'] }],
  pages: [{ label: 'Page 1', tiles: [
    { type: 'heading', label: 'Parts of a plant', row: 1, col: 1, cols: 2 },
    { type: 'panel', label: 'A sunflower', body: 'Draw a sunflower and label its root, stem and leaf.', row: 2, col: 1, rows: 2 },
    { type: 'question', label: 'Roots', body: 'What do roots take in from the soil?', row: 2, col: 2 },
    { type: 'answer-lines', label: 'Your answer', body: '3', row: 3, col: 2 },
    { type: 'word-bank', label: 'Words to use', words: ['root', 'stem', 'leaf', 'flower'], row: 4, col: 1 },
  ] }],
  rules: [{ kind: 'max', type: 'heading', max: 1, per: 'page' }, { kind: 'needs', type: 'heading' }, { kind: 'span', type: 'image', rows: 2, cols: 2 }],
}
// The toy a page composer can be: numbered questions with nothing in them, and no rule that matters.
const GRID_TOY = { ...GOOD_GRID, tray: [{ type: 'question', label: 'Question' }, { type: 'answer-lines', label: 'Answer lines', body: '3' }],
  pages: [{ tiles: [1, 2, 3, 4].map((n) => ({ type: 'question', label: 'Question ' + n, row: n, col: 1 })) }], rules: [{ kind: 'max', type: 'question', max: 8 }] }

// The text form Muse Ember answered with now and then, as it was sent (one complete invoke block).
const asText = (draft, tool = 'draft_workshop', ns = 'atem') => [
  `<${ns}:function_calls>`, `<${ns}:invoke name="${tool}">`,
  ...Object.entries(draft).map(([key, value]) => `<${ns}:parameter name="${key}">${typeof value === 'string' ? value : JSON.stringify(value)}</${ns}:parameter>`),
  `</${ns}:invoke>`, `</${ns}:function_calls>`,
].join('\n')

// The board the owner was shown (2026-11-25): numbered copies of their own words in generic lanes, no rule at all.
const toy = {
  version: 1, title: 'Snappable congruent pieces',
  lanes: [{ id: 'piece-library', label: 'Piece library' }, { id: 'composing-canvas', label: 'Composing canvas' }, { id: 'printable-sheet', label: 'Printable sheet' }],
  cards: [1, 2, 3, 4, 5, 6].map((n) => ({ id: 'piece-' + n, label: 'Snappable congruent piece ' + n, laneId: 'piece-library' })),
}
// GOOD with no behavior: no capacity, no allowed lanes, no rules.
const plain = board({ lanes: GOOD.lanes.map(({ capacity, ...lane }) => lane), cards: GOOD.cards.map(({ allowedLaneIds, ...card }) => card) })
const manyCards = Array.from({ length: 30 }, (_, i) => ({ id: 'piece-' + (i + 1), label: 'Piece ' + (i + 1), laneId: 'piece-tray' }))
const sixLanes = Array.from({ length: 6 }, (_, i) => ({ id: 'lane-' + (i + 1), label: 'Lane ' + (i + 1) }))

export const RECORDED = Object.freeze([
  // ---- answers that are boards, as sent or once their slips are repaired: one request ----
  { id: 'good-call', prompt: 'owner-printable-pieces', answers: [{ name: 'draft_grid', args: GOOD_GRID }], expect: { outcome: 'drafted', requests: 1, title: 'Printable page kit',
    rules: ['Tiles snap to free cells; none overlap.', 'A page holds at most 1 heading.', 'Every page needs a heading.', 'Pictures can span up to 2 by 2 cells.'] } },
  { id: 'muse-text-call', prompt: 'owner-printable-pieces', answers: [{ text: asText(GOOD_GRID, 'draft_grid') }], expect: { outcome: 'drafted', requests: 1, title: 'Printable page kit' } },
  // A lane board's call answered to a page's request is no page: asked again for draft_grid, and the good one used.
  { id: 'lanes-for-a-page', prompt: 'owner-printable-pieces', answers: [{ args: GOOD }, { name: 'draft_grid', args: GOOD_GRID }], expect: { outcome: 'drafted', requests: 2, retry: /Call the requested tool\./ } },
  { id: 'text-call-other-markup', prompt: 'reading-list', answers: [{ text: 'Here it is.\n' + asText(board({ title: 'Reading list' }), 'draft_workshop', 'fn') }], expect: { outcome: 'drafted', requests: 1, title: 'Reading list' } },
  { id: 'text-call-numeric-title', prompt: 'odd-all-caps', answers: [{ text: asText(board({ title: '2024' })) }], expect: { outcome: 'drafted', requests: 1, title: '2024' } },
  { id: 'counts-as-text', prompt: 'kanban-wip', answers: [{ args: board({ version: '1', lanes: [{ id: 'piece-tray', label: 'Backlog' }, { id: 'compose', label: 'In progress', capacity: '3' }, { id: 'print-sheet', label: 'Review', capacity: ' 2 ' }] }) }], expect: { outcome: 'drafted', requests: 1, capacities: [3, 2] } },
  { id: 'lists-double-encoded', prompt: 'bill-of-materials', answers: [{ args: { ...GOOD, lanes: JSON.stringify(GOOD.lanes), cards: JSON.stringify(GOOD.cards) } }], expect: { outcome: 'drafted', requests: 1 } },
  { id: 'arguments-double-encoded', prompt: 'habit-tracker', answers: [{ args: JSON.stringify(JSON.stringify(GOOD)) }], expect: { outcome: 'drafted', requests: 1 } },
  { id: 'optional-nulls', prompt: 'seating-chart', answers: [{ args: board({ signals: null, lanes: [{ id: 'piece-tray', label: 'Unassigned', capacity: null }, { id: 'compose', label: 'Table 1', capacity: 4 }, { id: 'print-sheet', label: 'Table 2', capacity: 4 }], cards: GOOD.cards.map((card) => ({ ...card, allowedLaneIds: null })) }) }], expect: { outcome: 'drafted', requests: 1 } },
  { id: 'non-english', prompt: 'japanese-study', answers: [{ args: board({ title: '試験勉強の計画', lanes: [{ id: 'todo', label: '未着手' }, { id: 'doing', label: '学習中', capacity: 3 }, { id: 'done', label: '完了' }], cards: [{ id: 'math', label: '数学', laneId: 'todo' }, { id: 'english', label: '英語', laneId: 'todo' }, { id: 'history', label: '歴史', laneId: 'todo' }] }) }], expect: { outcome: 'drafted', requests: 1, title: '試験勉強の計画' } },
  // Rules as data: one-step, a path and an archive lane become the board's rulebook, said in its own sentences.
  { id: 'rules-drafted', prompt: 'terse-blocks', answers: [{ args: board({ rules: [{ kind: 'one-step' }, { kind: 'path', from: 'print-sheet', to: ['compose'] }, { kind: 'archive', lane: 'print-sheet' }] }) }], expect: { outcome: 'drafted', requests: 1, ruleKinds: ['path', 'path', 'bin'] } },
  { id: 'rules-as-text', prompt: 'terse-blocks', answers: [{ args: board({ rules: '[{"kind":"one-step"}]' }) }], expect: { outcome: 'drafted', requests: 1, ruleKinds: ['path'] } },
  // A repeated card, and a placeholder beside named ones, are left out; the rest of the draft is used as sent.
  { id: 'duplicate-and-placeholder-repaired', prompt: 'bill-of-materials', answers: [{ args: board({ cards: [...GOOD.cards, { id: 'square-again', label: 'square 1X1', laneId: 'piece-tray' }, { id: 'part-7', label: 'Part 7', laneId: 'piece-tray' }] }) }], expect: { outcome: 'drafted', requests: 1, cards: ['square', 'bar', 'corner', 'frame'] } },

  // ---- the quality gate: a valid board that is a toy is asked again, naming what is wrong ----
  // The owner's toy, as lanes: on a request for lanes, asked again naming what is wrong.
  { id: 'owner-toy-draft', prompt: 'terse-blocks', answers: [{ args: toy }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /Name every card as the real, specific thing it is: “Snappable congruent piece 1”, “Snappable congruent piece 2”, “Snappable congruent piece 3” are only a phrase counted off with a number, letter or numeral\. Give the board at least one rule/ } },
  // And as a page: numbered questions with no words are asked again, naming them.
  { id: 'owner-toy-page', prompt: 'owner-printable-pieces', answers: [{ name: 'draft_grid', args: GRID_TOY }, { name: 'draft_grid', args: GOOD_GRID }], expect: { outcome: 'drafted', requests: 2, retry: /Write real content in every tile: “Question”, “Question 1”, “Question 2” are only a placeholder or has no words\./ } },
  { id: 'lettered-cards', prompt: 'decision-matrix', answers: [{ args: board({ cards: ['A', 'B', 'C', 'D'].map((letter) => ({ id: 'laptop-' + letter.toLowerCase(), label: 'Laptop ' + letter, laneId: 'piece-tray' })) }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /“Laptop A”, “Laptop B”, “Laptop C” are only a phrase counted off with a number, letter or numeral/ } },
  { id: 'no-behavior', prompt: 'packing-list', answers: [{ args: plain }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /Give the board at least one rule: a lane capacity, allowedLaneIds on a card, or a rule such as one-step\./ } },
  { id: 'too-few-cards', prompt: 'german-moving', answers: [{ args: board({ cards: GOOD.cards.slice(0, 1) }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /Give the board at least three cards people will drag\./ } },
  { id: 'toy-twice', prompt: 'owner-printable-pieces', answers: [{ name: 'draft_grid', args: GRID_TOY }, { name: 'draft_grid', args: GRID_TOY }], expect: { outcome: 'starter', requests: 2 } },

  // ---- answers that are not boards: the retry names what was wrong, and a good second answer is used ----
  { id: 'empty-arguments', prompt: 'reading-list', answers: [{ args: '{}' }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /The last draft could not be used: The draft_workshop call came with no board/ } },
  { id: 'prose-instead-of-call', prompt: 'party-vague', answers: [{ text: 'Sure! I would make lanes for Ideas, Planning and Ready.' }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /could not be used: Call the requested tool\./ } },
  { id: 'text-call-to-another-tool', prompt: 'party-vague', answers: [{ text: asText(GOOD, 'make_board') }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /Call the requested tool/ } },
  { id: 'half-written-text-call', prompt: 'terse-blocks', answers: [{ text: asText(GOOD).replace(/<\/atem:invoke>[\s\S]*$/, '') }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2 } },
  { id: 'wrong-tool', prompt: 'bug-triage', answers: [{ name: 'propose_workshop_edits', args: GOOD }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /Call the requested tool/ } },
  { id: 'unknown-lane', prompt: 'storyboard', answers: [{ args: board({ cards: [{ id: 'scene-1', label: 'Scene 1', laneId: 'beginning' }] }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /Card refers to an unknown lane\./ } },
  { id: 'capacity-below-cards', prompt: 'reading-list', answers: [{ args: board({ lanes: [{ id: 'piece-tray', label: 'Want to read', capacity: 2 }, ...GOOD.lanes.slice(1)] }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /Lane "Want to read" exceeds its capacity\./ } },
  { id: 'capacity-zero', prompt: 'chore-chart', answers: [{ args: board({ lanes: [GOOD.lanes[0], { id: 'compose', label: 'Kid 1', capacity: 0 }, GOOD.lanes[2]] }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /Lane capacity must be a whole number from 1 to 24\./ } },
  { id: 'capacity-fraction', prompt: 'meal-planner', answers: [{ args: board({ lanes: [GOOD.lanes[0], { id: 'compose', label: 'Monday', capacity: 1.5 }, GOOD.lanes[2]] }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /whole number/ } },
  { id: 'too-many-lanes', prompt: 'lesson-plan-grid', answers: [{ args: board({ lanes: sixLanes, cards: [{ id: 'warm-up', label: 'Warm-up', laneId: 'lane-1' }] }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /A workshop needs 2 to 5 lanes\./ } },
  { id: 'one-lane', prompt: 'packing-list', answers: [{ args: board({ lanes: GOOD.lanes.slice(0, 1) }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /2 to 5 lanes/ } },
  { id: 'id-with-spaces', prompt: 'floor-plan-rooms', answers: [{ args: board({ lanes: [{ id: 'Piece Tray', label: 'Rooms' }, ...GOOD.lanes.slice(1)] }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /IDs must be short alphanumeric slugs\./ } },
  { id: 'missing-label', prompt: 'tournament-bracket', answers: [{ args: board({ lanes: [{ id: 'piece-tray' }, ...GOOD.lanes.slice(1)] }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /Labels must contain 1 to 80 characters\./ } },
  { id: 'label-too-long', prompt: 'rambling-wedding', answers: [{ args: board({ title: 'x'.repeat(130) }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /1 to 120 characters/ } },
  { id: 'markup-in-label', prompt: 'mood-board', answers: [{ args: board({ lanes: [{ id: 'piece-tray', label: '<b>Color</b>' }, ...GOOD.lanes.slice(1)] }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /plain text without markup/ } },
  { id: 'allowed-lanes-without-start', prompt: 'decision-matrix', answers: [{ args: board({ cards: [{ id: 'laptop-a', label: 'Laptop A', laneId: 'piece-tray', allowedLaneIds: ['compose'] }] }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /Allowed lanes must exist and include the starting lane\./ } },
  { id: 'duplicate-card-ids', prompt: 'card-sorting-study', answers: [{ args: board({ cards: [GOOD.cards[0], GOOD.cards[0]] }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /Duplicate card ID\./ } },
  { id: 'wrong-version', prompt: 'okr-planner', answers: [{ args: board({ version: 2 }) }, { args: GOOD }], expect: { outcome: 'drafted', requests: 2, retry: /Unsupported workshop version\./ } },

  // ---- answers that stay bad: the board is started from the words instead, a valid component, never an error ----
  { id: 'too-many-cards-twice', prompt: 'worksheet-generator', answers: [{ args: board({ cards: manyCards }) }, { args: board({ cards: manyCards }) }], expect: { outcome: 'starter', requests: 2 } },
  { id: 'wrong-types-twice', prompt: 'gantt-dependencies', answers: [{ args: { version: 1, title: 'Plan', lanes: { design: 'Design' }, cards: 4 } }, { args: { version: 1, title: 7, lanes: [], cards: [] } }], expect: { outcome: 'starter', requests: 2 } },
  { id: 'prose-twice', prompt: 'vague-organize', answers: [{ text: 'You could sort things by room.' }, { text: 'Try boxes labeled by room.' }], expect: { outcome: 'starter', requests: 2 } },
  { id: 'map-instead-of-lanes', prompt: 'odd-dragon-hoard', answers: [{ args: { version: 1, title: 'Hoard', lanes: [{ id: 'cave', label: 'Cave', station: { column: 0, row: 0, next: ['bed'], outcome: 'Dark' } }, { id: 'bed', label: 'Bedroom', station: { column: 1, row: 0, next: ['cave'], outcome: 'Cozy' } }], cards: [{ id: 'cup', label: 'Golden cup', laneId: 'cave' }] } }], expect: { outcome: 'starter', requests: 2, retry: /Draft a board of plain lanes/ } },
  { id: 'business-kind', prompt: 'hiring-pipeline', answers: [{ args: { ...GOOD, kind: 'pipeline' } }, { args: { ...GOOD, kind: 'pipeline' } }], expect: { outcome: 'starter', requests: 2 } },
  { id: 'endpoint-fails', prompt: 'owner-printable-pieces', answers: [], expect: { outcome: 'starter', requests: 1 } },

  // ---- no agent to draft: the starter at once, no model call ----
  { id: 'guest', prompt: 'owner-printable-pieces', answers: [], as: 'guest', expect: { outcome: 'starter', requests: 0, guest: true, title: 'Printable page kit', lanes: ['Tiles', 'Page 1'],
    cards: ['tile-1', 'tile-2', 'tile-3', 'tile-4', 'tile-5', 'tile-6', 'tile-7', 'tile-8', 'tile-9', 'tile-10', 'tile-11', 'tile-12', 'tile-13'],
    rules: ['Tiles snap to free cells; none overlap.', 'A page holds at most 1 heading.', 'Every page needs a heading.', 'Pictures can span up to 2 by 2 cells.'] } },
  { id: 'no-agent-configured', prompt: 'classroom-manipulatives', answers: [], noAI: true, expect: { outcome: 'starter', requests: 0 } },
  { id: 'part-turned-off', prompt: 'recipe-card-builder', answers: [], off: { message: 'Drafting boards is turned off on this server.' }, expect: { outcome: 'starter', requests: 0 } },

  // ---- refusals a person can act on: said plainly, nothing drawn ----
  { id: 'one-draft-a-minute', prompt: 'owner-printable-pieces', answers: [], locked: true, expect: { outcome: 'error', requests: 0, said: 'Please wait a minute before requesting another draft.' } },
  { id: 'agent-allowance-used', prompt: 'owner-printable-pieces', answers: [], refuse: { error: 'ai-today', reason: "You've used today's agent allowance. It renews tomorrow.", details: { pay: true } }, expect: { outcome: 'error', requests: 0, said: "You've used today's agent allowance. It renews tomorrow." } },
])

/** A grid sheet as the draft_grid call that would make it: a good, domain-fit answer for any page prompt (its starter, retitled). */
export function gridDraftOf(sheet, title = sheet.title) {
  const tile = (card, placed) => ({ type: card.tile.type, label: card.label, ...(card.tile.body && { body: card.tile.body }), ...(card.tile.words && { words: card.tile.words }),
    ...(card.tile.image && { alt: card.tile.image.alt }), ...(placed && { row: card.cell.row + 1, col: card.cell.col + 1, ...(card.cell.rows && { rows: card.cell.rows }), ...(card.cell.cols && { cols: card.cell.cols }) }) })
  const kinds = { tileTypes: 'allow', tileMax: 'max', tileNeeds: 'needs', tileSpan: 'span' }
  return {
    title, page: sheet.grid.page, grid: sheet.grid.cells,
    tray: sheet.cards.filter((card) => card.laneId === sheet.lanes[0].id).map((card) => tile(card, false)),
    pages: sheet.lanes.slice(1).map((lane) => ({ label: lane.label, tiles: sheet.cards.filter((card) => card.laneId === lane.id).map((card) => tile(card, true)) })),
    rules: sheet.behaviour.rules.map(({ kind, types, type, max, per, atLeast, rows, cols }) => ({ kind: kinds[kind], ...(types && { types }), ...(type && { type }), ...(max && { max }), ...(per && kind === 'tileMax' && { per }),
      ...(atLeast && { atLeast }), ...(rows && { rows }), ...(cols && { cols }) })),
  }
}
