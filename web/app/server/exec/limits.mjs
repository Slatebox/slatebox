// The one source of exec's limits. describe publishes them; the sealed runner, the gate and
// the result shaping read them from here. A self-hosted operator may change any number in
// settings.selfHosted.exec (same keys); Cloud uses these values for everyone.
export const EXEC_LIMITS = Object.freeze({
  wallMs: 30000, // the run's wall clock; the parent kills the runner 5 s after it
  killGraceMs: 5000,
  cpuMs: 10000, // guest JavaScript time
  memoryBytes: 32 * 1024 * 1024,
  stackBytes: 1024 * 1024,
  codeBytes: 64 * 1024, // the caller's code
  sourceBytes: 96 * 1024, // code plus the client prelude
  calls: 64, // client calls per script, below the 120-per-token rate limit
  callsInFlight: 4,
  callInputBytes: 256 * 1024,
  callOutputBytes: 512 * 1024,
  operations: 200, // operations summed over every plan in one script
  notesCreated: 200,
  rewriteTextWithoutConfirm: 10, // existing notes whose text a script may change, over every slate it writes
  resultChars: 40000,
  logBytes: 16 * 1024,
  runsPerProcess: 2,
  slotWaitMs: 10000, // a run waits this long for a free runner slot before answering exec_busy
  idleMs: 2000, // a script with no call running and nothing computing for this long is stopped
  runsPerAccount: 1,
  confirmMinutes: 10,
  auditDays: 30,
})

const POSITIVE = (value) => Number.isSafeInteger(value) && value > 0

// Self-host overrides: only known keys, only positive integers. Anything else is ignored.
export function resolveExecLimits(overrides) {
  const limits = { ...EXEC_LIMITS }
  if (overrides && typeof overrides === 'object')
    for (const [key, value] of Object.entries(overrides))
      if (Object.hasOwn(EXEC_LIMITS, key) && POSITIVE(value)) limits[key] = value
  return Object.freeze(limits)
}

// The public view: what describe and GET /api/v1/instance publish.
export const publicLimits = (limits = EXEC_LIMITS) => ({
  wallSeconds: limits.wallMs / 1000,
  cpuSeconds: limits.cpuMs / 1000,
  memoryMiB: limits.memoryBytes / 1048576,
  codeKiB: limits.codeBytes / 1024,
  callsPerScript: limits.calls,
  callsInFlight: limits.callsInFlight,
  operationsPerScript: limits.operations,
  notesCreatedPerScript: limits.notesCreated,
  textRewritesBeforeConfirm: limits.rewriteTextWithoutConfirm,
  resultChars: limits.resultChars,
  logKiB: limits.logBytes / 1024,
  runsAtOncePerAccount: limits.runsPerAccount,
  idleSecondsWithoutCall: limits.idleMs / 1000,
  confirmationMinutes: limits.confirmMinutes,
  auditDays: limits.auditDays,
})
