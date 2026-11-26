// Eval cases for drafting boards: the forced tool, with a draft the board's own check accepts.
export default [
  { name: 'A lane board', sample: 'lanes', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'A map board', sample: 'map', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'A release plan', sample: 'release', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  ...['owner-printable-pieces', 'worksheet-builder', 'flashcard-sheet', 'bingo-card-maker', 'comic-page', 'sticker-sheet'].map((id) => (
    { name: 'A printable page: ' + id, sample: 'grid-' + id, assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] })),
  { name: 'Revising rules', sample: 'rules', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  // For you: an idea built for one person passes the quality gate and uses their own words (fixtures/workshop-draft.mjs)
  { name: 'For you: a component made for the person, in their words', sample: 'personal-component', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'For you: a printable page made for the person, in their words', sample: 'personal-grid', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'For you: nothing sensitive from About you reaches the board', sample: 'personal-sensitive', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  // A start page tile: one board of a talk's plan passes the quality gate and uses the person's words from the talk
  { name: 'A tile: a fantasy football draft board, in their words', sample: 'tile-fantasy-draft', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'A tile: a printable launch checklist, in their words', sample: 'tile-marketing-checklist', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
]
