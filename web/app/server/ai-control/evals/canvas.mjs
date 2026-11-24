// Eval cases for the canvas conversation: an exec call with code, or a short reply.
export default [
  { name: 'Add ideas', sample: 'add-ideas', assert: ['renders', 'noPlaceholders', 'answered', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'Connect notes', sample: 'connect', assert: ['renders', 'noPlaceholders', 'answered', 'parses', { maxLatencyMs: 20000 }] },
]
