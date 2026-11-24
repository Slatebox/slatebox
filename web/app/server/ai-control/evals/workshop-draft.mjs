// Eval cases for drafting boards: the forced tool, with a draft the board's own check accepts.
export default [
  { name: 'A lane board', sample: 'lanes', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'A map board', sample: 'map', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'A release plan', sample: 'release', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'Revising rules', sample: 'rules', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
]
