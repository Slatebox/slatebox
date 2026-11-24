// Eval cases for the Slatebox agent: an exec call with code, or a short reply.
export default [
  { name: 'A task with a handoff', sample: 'handoff', assert: ['renders', 'noPlaceholders', 'answered', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'A task with two notes', sample: 'two-notes', assert: ['renders', 'noPlaceholders', 'answered', 'parses', { maxLatencyMs: 20000 }] },
]
