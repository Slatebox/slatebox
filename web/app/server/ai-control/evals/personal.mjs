// Eval cases for For you (personal.suggest): every idea ties to what the person said or connected,
// none is generic, none names a tool they did not connect, none holds anything sensitive, none
// repeats one they turned down, and there are at least three (fixtures/personal.mjs parses).
const checks = ['renders', 'noPlaceholders', 'answered', 'toolCalled', 'parses', { maxLatencyMs: 30000 }]
export default [
  { name: 'Ideas tie to the facts and the tool connected', sample: 'pm-linear', assert: checks },
  { name: 'Ideas from facts alone, no tools named', sample: 'teacher', assert: checks },
  { name: 'Ideas from the connected tools alone', sample: 'tools-only', assert: checks },
  { name: 'No idea for a tool that is not connected', sample: 'unconnected-tool', assert: checks },
  { name: 'Nothing sensitive in any idea', sample: 'sensitive', assert: checks },
  { name: 'Nothing turned down comes back', sample: 'dismissed', assert: checks },
]
