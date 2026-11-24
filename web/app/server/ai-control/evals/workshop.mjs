// Eval cases for board chat: a proposal or a short reply is fine (the board's own check decides).
export default [
  { name: 'Lane board: move a card', sample: 'lanes-move', assert: ['renders', 'noPlaceholders', 'answered', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'Lane board: a question', sample: 'lanes-question', assert: ['renders', 'noPlaceholders', 'answered', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'Map board: add a station', sample: 'map-add', assert: ['renders', 'noPlaceholders', 'answered', 'parses', { maxLatencyMs: 20000 }] },
]
