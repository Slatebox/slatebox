// Recorded and known-bad model answers to free-form builder requests, for the deterministic layer
// (smart-components.test.mjs). Each case: the prompt (an id in prompts.mjs), the answers the model gives in order
// ({ args } a draft_workshop call, an object or the text it sent; { text } words, with no tool call; { name } another
// tool), and what must come of it:
//   drafted  the agent's board is used (provider 'ai', "Drafted …"), after `requests` model calls;
//   starter  the board is started from the words ("Started …"), still a valid smart component, never an error;
//   error    one plain sentence for the person (`said`), nothing drawn.
// `retry` is what the second request must tell the model (the board's own sentence for what was wrong).
//
// The Muse Ember shapes are the ones the live eval met (2026-11-25, test's AI config): a complete call written as
// text in its own markup instead of tool_calls (5 of 56 answers), and a call with empty arguments.

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

// The text form Muse Ember answered with now and then, as it was sent (one complete invoke block).
const asText = (draft, tool = 'draft_workshop', ns = 'atem') => [
  `<${ns}:function_calls>`, `<${ns}:invoke name="${tool}">`,
  ...Object.entries(draft).map(([key, value]) => `<${ns}:parameter name="${key}">${typeof value === 'string' ? value : JSON.stringify(value)}</${ns}:parameter>`),
  `</${ns}:invoke>`, `</${ns}:function_calls>`,
].join('\n')

const manyCards = Array.from({ length: 30 }, (_, i) => ({ id: 'piece-' + (i + 1), label: 'Piece ' + (i + 1), laneId: 'piece-tray' }))
const sixLanes = Array.from({ length: 6 }, (_, i) => ({ id: 'lane-' + (i + 1), label: 'Lane ' + (i + 1) }))

export const RECORDED = Object.freeze([
  // ---- answers that are boards, as sent or once their slips are repaired: one request ----
  { id: 'good-call', prompt: 'owner-printable-pieces', answers: [{ args: GOOD }], expect: { outcome: 'drafted', requests: 1, title: 'Snap-together printable kit', rules: ['Compose holds 6.', 'Print sheet holds 4.'] } },
  { id: 'muse-text-call', prompt: 'owner-printable-pieces', answers: [{ text: asText(GOOD) }], expect: { outcome: 'drafted', requests: 1, title: 'Snap-together printable kit' } },
  { id: 'text-call-other-markup', prompt: 'reading-list', answers: [{ text: 'Here it is.\n' + asText(board({ title: 'Reading list' }), 'draft_workshop', 'fn') }], expect: { outcome: 'drafted', requests: 1, title: 'Reading list' } },
  { id: 'text-call-numeric-title', prompt: 'odd-all-caps', answers: [{ text: asText(board({ title: '2024' })) }], expect: { outcome: 'drafted', requests: 1, title: '2024' } },
  { id: 'counts-as-text', prompt: 'kanban-wip', answers: [{ args: board({ version: '1', lanes: [{ id: 'piece-tray', label: 'Backlog' }, { id: 'compose', label: 'In progress', capacity: '3' }, { id: 'print-sheet', label: 'Review', capacity: ' 2 ' }] }) }], expect: { outcome: 'drafted', requests: 1, capacities: [3, 2] } },
  { id: 'lists-double-encoded', prompt: 'bill-of-materials', answers: [{ args: { ...GOOD, lanes: JSON.stringify(GOOD.lanes), cards: JSON.stringify(GOOD.cards) } }], expect: { outcome: 'drafted', requests: 1 } },
  { id: 'arguments-double-encoded', prompt: 'habit-tracker', answers: [{ args: JSON.stringify(JSON.stringify(GOOD)) }], expect: { outcome: 'drafted', requests: 1 } },
  { id: 'optional-nulls', prompt: 'seating-chart', answers: [{ args: board({ signals: null, lanes: [{ id: 'piece-tray', label: 'Unassigned', capacity: null }, { id: 'compose', label: 'Table 1', capacity: 4 }, { id: 'print-sheet', label: 'Table 2', capacity: 4 }], cards: GOOD.cards.map((card) => ({ ...card, allowedLaneIds: null })) }) }], expect: { outcome: 'drafted', requests: 1 } },
  { id: 'non-english', prompt: 'japanese-study', answers: [{ args: board({ title: '試験勉強の計画', lanes: [{ id: 'todo', label: '未着手' }, { id: 'doing', label: '学習中', capacity: 3 }, { id: 'done', label: '完了' }], cards: [{ id: 'math', label: '数学', laneId: 'todo' }, { id: 'english', label: '英語', laneId: 'todo' }] }) }], expect: { outcome: 'drafted', requests: 1, title: '試験勉強の計画' } },

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
  { id: 'map-instead-of-lanes', prompt: 'odd-dragon-hoard', answers: [{ args: { version: 1, title: 'Hoard', lanes: [{ id: 'cave', label: 'Cave', station: { column: 0, row: 0, next: ['bed'], outcome: 'Dark' } }, { id: 'bed', label: 'Bedroom', station: { column: 1, row: 0, next: ['cave'], outcome: 'Cozy' } }], cards: [{ id: 'cup', label: 'Golden cup', laneId: 'cave' }] } }], expect: { outcome: 'starter', requests: 1 } },
  { id: 'business-kind', prompt: 'hiring-pipeline', answers: [{ args: { ...GOOD, kind: 'pipeline' } }, { args: { ...GOOD, kind: 'pipeline' } }], expect: { outcome: 'starter', requests: 2 } },
  { id: 'endpoint-fails', prompt: 'owner-printable-pieces', answers: [], expect: { outcome: 'starter', requests: 1 } },

  // ---- no agent to draft: the starter at once, no model call ----
  { id: 'guest', prompt: 'owner-printable-pieces', answers: [], as: 'guest', expect: { outcome: 'starter', requests: 0, title: 'Snappable congruent pieces to compose new printable materials', lanes: ['Kit', 'Compose', 'Ready to print'], rules: ['Compose holds 4.', 'Cards move one column at a time.'] } },
  { id: 'no-agent-configured', prompt: 'classroom-manipulatives', answers: [], noAI: true, expect: { outcome: 'starter', requests: 0 } },
  { id: 'part-turned-off', prompt: 'recipe-card-builder', answers: [], off: { message: 'Drafting boards is turned off on this server.' }, expect: { outcome: 'starter', requests: 0 } },

  // ---- refusals a person can act on: said plainly, nothing drawn ----
  { id: 'one-draft-a-minute', prompt: 'owner-printable-pieces', answers: [], locked: true, expect: { outcome: 'error', requests: 0, said: 'Please wait a minute before requesting another draft.' } },
  { id: 'agent-allowance-used', prompt: 'owner-printable-pieces', answers: [], refuse: { error: 'ai-today', reason: "You've used today's agent allowance. It renews tomorrow.", details: { pay: true } }, expect: { outcome: 'error', requests: 0, said: "You've used today's agent allowance. It renews tomorrow." } },
])
