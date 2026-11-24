// Eval cases for library review: the refine tool with a reply.
export default [
  { name: 'A component', sample: 'component', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'A locked category', sample: 'locked', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'A slate', sample: 'slate', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
]
