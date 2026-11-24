// Everything the installer prints goes through here, and through the redactor.
// With --json (or in agent mode) stdout carries one JSON event per line and
// people's text goes to stderr; otherwise people's text goes to stdout.

export class Output {
  /**
   * @param {{stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, json: boolean, debug: boolean, redactor: import('./secrets.mjs').Redactor}} options
   */
  constructor({ stdout, stderr, json, debug, redactor }) {
    this.stdout = stdout
    this.stderr = stderr
    this.json = json
    this.debugOn = debug
    this.redactor = redactor
  }

  #text(stream, text) {
    stream.write(this.redactor.redact(text) + (text.endsWith('\n') ? '' : '\n'))
  }

  /** A line for people. */
  say(text = '') {
    this.#text(this.json ? this.stderr : this.stdout, text)
  }

  /** A warning for people, always on stderr. */
  warn(text) {
    this.#text(this.stderr, `! ${text}`)
  }

  debug(text) {
    if (this.debugOn) this.#text(this.stderr, `[debug] ${text}`)
  }

  /** A machine-readable event: {"event":"plan"|"step"|"done"|"error", ...}. Only with --json. */
  event(event) {
    if (!this.json) return
    this.stdout.write(this.redactor.redact(JSON.stringify(event)) + '\n')
  }

  /** A step in progress, for both audiences. */
  step(id, status, detail = '') {
    this.event({ event: 'step', id, status, ...(detail ? { detail } : {}) })
    if (!this.json || this.debugOn) {
      const mark = { start: '…', ok: '✓', skip: '–', warn: '!', fail: '✗' }[status] || '·'
      this.#text(this.json ? this.stderr : this.stdout, `${mark} ${detail || id}`)
    } else if (status === 'fail' || status === 'warn') {
      this.#text(this.stderr, `${status === 'fail' ? '✗' : '!'} ${detail || id}`)
    }
  }
}
