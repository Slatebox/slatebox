// Eval cases for the use-case interview on the start page (start.interview): a follow-up is one
// specific question in the person's own terms, never a question anyone would get, and never asks
// for anything sensitive, and never asks again what the person skipped; the plan's boards match what the
// person said (a draft board or a weekly lineup board for fantasy football, a launch calendar for a
// marketing team, an operating review for an executive, an operating or quarterly review for a COO whose
// company's numbers are fine to plan with), hold nothing sensitive (even after the person offered some),
// and number at most four (fixtures/start.mjs parses).
const asks = ['renders', 'noPlaceholders', 'answered', 'parses', { maxLatencyMs: 20000 }]
const plans = ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 30000 }]
export default [
  { name: 'Fantasy football: a specific follow-up, not a generic one', sample: 'fantasy', assert: asks },
  { name: 'An obscure hobby: a specific follow-up in their terms', sample: 'obscure', assert: asks },
  { name: 'Signed in: builds on About you, asks something specific', sample: 'known', assert: asks },
  { name: 'Something sensitive offered: never asked for, never planned', sample: 'sensitive', assert: asks },
  { name: 'A skipped question: the next one is a different question', sample: 'skipped', assert: asks },
  { name: 'Fantasy football: a draft board or a weekly lineup board, at most four boards', sample: 'fantasy-plan', assert: plans },
  { name: 'A marketing team: a launch calendar, at most four boards', sample: 'marketing-plan', assert: plans },
  { name: 'An executive: an operating review, at most four boards', sample: 'exec-plan', assert: plans },
  { name: 'A COO: a quarterly operating review with the company\'s numbers, a plan that parses', sample: 'coo-plan', assert: plans },
  { name: 'After something sensitive was offered: the plan leaves it out', sample: 'sensitive-plan', assert: plans },
]
