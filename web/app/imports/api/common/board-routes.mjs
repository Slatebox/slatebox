// The starter routes for the business boards: /new/launch-plan, /new/hiring-plan, /new/pipeline,
// /new/budget and /new/nest open the sample board. A workshop link whose model is one of these
// boards (#model=…) opens too. Their rules are not in the model a plain slate loads, so they load
// first (loadBoardRoute).

/** Each board route and the name of the sample it opens. */
export const BOARD_SAMPLES = { 'launch-plan': 'sampleLaunchPlan', 'hiring-plan': 'hiringPlanSample', pipeline: 'samplePipeline', budget: 'sampleBudget', nest: 'sortEvidenceSample' }

/** Whether a workshop link (#model=…) holds one of these boards. */
export const boardInLink = hash => {
  try { return Object.hasOwn(BOARD_SAMPLES, JSON.parse(new URLSearchParams(hash.slice(1)).get('model') ?? 'null')?.kind) } catch { return false }
}

/**
 * What a board route needs before its board is read; `kind` is the route's board, or null for a link: the
 * kinds' rules, and the rulebook's module, which reads a board that comes with rules (a hiring plan, a
 * nested board, or any board a person has given rules).
 */
export async function loadBoardRoute(kind) {
  // A nested board's sample is in the library's samples chunk (which loads the rules with it).
  const [rules, , samples] = await Promise.all([import('slateboxjs/workshops/rules'), import('slateboxjs/workshops/behaviour'),
    kind === 'nest' ? import('slateboxjs/workshops/samples') : null])
  return samples ? { ...rules, ...samples } : rules
}
