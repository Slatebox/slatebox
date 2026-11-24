// Eval cases for custom shapes (spec 6.5): each runs a built-in sample (fixtures/shape.mjs) with the
// candidate prompt on the binding's primary model. Deterministic checks block a publish; latency is
// reported.
export default [
  { name: 'A cloud with a hole', sample: 'cloud', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'An arrow', sample: 'arrow', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'A house', sample: 'house', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
]
