// Eval cases for the interview: every turn asks exactly one question (none when the person wants to
// stop) and never asks for anything sensitive; the first question proposes nothing and uses a
// connected tool when there is one; an answer's facts come with remember, only from what the person
// said, never sensitive; a skipped question is not asked again (fixtures/interview.mjs parses).
export default [
  { name: 'First question: one question, nothing remembered', sample: 'opening', assert: ['renders', 'noPlaceholders', 'answered', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'First question: uses the tool they connected', sample: 'opening-tools', assert: ['renders', 'noPlaceholders', 'answered', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'First question: builds on what is known', sample: 'opening-known', assert: ['renders', 'noPlaceholders', 'answered', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'An answer: remember proposes only what they said', sample: 'answer', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'An answer after a connected tool: remember proposes only what they said', sample: 'answer-tools', assert: ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'A skipped question: moves on, remembers nothing', sample: 'skip', assert: ['renders', 'noPlaceholders', 'answered', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'Something sensitive offered: never asked for, never remembered', sample: 'sensitive', assert: ['renders', 'noPlaceholders', 'answered', 'parses', { maxLatencyMs: 20000 }] },
  { name: 'The person wants to stop: thanks them, asks nothing more', sample: 'stop', assert: ['renders', 'noPlaceholders', 'answered', 'parses', { maxLatencyMs: 20000 }] },
]
