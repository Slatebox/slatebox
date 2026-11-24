// Exit codes, as documented in README.md and printed by `slatebox --help`.
export const EXIT = Object.freeze({
  OK: 0,
  USAGE: 2, // bad flags or answers; details list each field
  NEEDS_INPUT: 3, // a missing answer or a confirmation, and nobody to ask
  PRECONDITION: 4, // no Docker, no kube context, CPU, port taken, image unavailable, not available yet
  ROLLED_BACK: 5, // changes applied, health failed, rolled back cleanly
  ROLLBACK_FAILED: 6, // a person must act; details carry the commands
  CANCELLED: 7,
})

export class InstallError extends Error {
  /**
   * @param {number} exitCode one of EXIT
   * @param {string} message what happened and what to do, in plain words
   * @param {object} [details] machine-readable extras for --json (fields, missing, commands)
   */
  constructor(exitCode, message, details = {}) {
    super(message)
    this.exitCode = exitCode
    this.details = details
  }
}
