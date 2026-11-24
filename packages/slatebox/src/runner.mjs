// Runs programs (docker, ssh, kubectl, crontab). Arguments never carry a
// secret, because anyone on the machine can read them with ps: secrets travel
// on standard input or in files with mode 0600.
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'

/**
 * @returns {(cmd: string, args: string[], options?: {input?: string|Buffer, inputFile?: string, outputFile?: string, timeout?: number, env?: object}) => Promise<{code: number, stdout: string, stderr: string}>}
 */
export function makeRunner(out) {
  return function run(cmd, args, { input, inputFile, outputFile, timeout = 15 * 60_000, env } = {}) {
    out?.debug(`$ ${cmd} ${args.map(arg => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`)).join(' ')}${inputFile ? ` < ${inputFile}` : ''}${outputFile ? ` > ${outputFile}` : ''}`)
    return new Promise(resolve => {
      let child
      try {
        child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : process.env })
      } catch (error) {
        resolve({ code: 127, stdout: '', stderr: String(error.message) })
        return
      }
      const stdout = [], stderr = []
      let sink = null
      let failed = null
      if (outputFile) {
        sink = createWriteStream(outputFile, { mode: 0o600 })
        child.stdout.pipe(sink)
      } else {
        child.stdout.on('data', chunk => stdout.push(chunk))
      }
      child.stderr.on('data', chunk => stderr.push(chunk))
      const timer = setTimeout(() => { failed = 'timed out'; child.kill('SIGKILL') }, timeout)
      child.on('error', error => { failed = error.code === 'ENOENT' ? `${cmd} is not installed` : error.message })
      child.on('close', async code => {
        clearTimeout(timer)
        if (sink) await new Promise(done => (sink.closed ? done() : sink.on('close', done)))
        const err = Buffer.concat(stderr).toString('utf8')
        resolve({ code: failed ? (failed.endsWith('not installed') ? 127 : 124) : (code ?? 1), stdout: Buffer.concat(stdout).toString('utf8'), stderr: failed ? `${err}${failed}` : err })
      })
      child.stdin.on('error', () => {})
      if (inputFile) createReadStream(inputFile).on('error', () => child.stdin.end()).pipe(child.stdin)
      else child.stdin.end(input ?? '')
    })
  }
}

/** Quote one argument for a POSIX shell (the remote side of ssh joins its arguments into one command line). */
export function shq(value) {
  const text = String(value)
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`
}
