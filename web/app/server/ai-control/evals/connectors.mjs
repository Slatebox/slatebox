// Eval cases for invited agents: each turn answers with its own tool, in the shape the server reads.
export default [
  { name: 'Choosing lookups', sample: 'plan', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'A second planning round', sample: 'planNext', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'Choosing lookups for a GitHub agent', sample: 'plan-github', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'Laying out exactly what was asked', sample: 'layoutBudget', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'Laying out results', sample: 'layout', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
]
