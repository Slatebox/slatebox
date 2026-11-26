// A fake raw terminal for the wizard, in process: stdin with setRawMode, a sized stderr, and a
// script of keys, each sent once the screen shows what it waits for.
import { PassThrough } from 'node:stream'
import { main } from '../src/cli.mjs'

export const KEY = { up: '\x1b[A', down: '\x1b[B', left: '\x1b[D', right: '\x1b[C', enter: '\r', ctrlC: '\x03', ctrlU: '\x15', esc: '\x1b' }
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
export const plainText = text => text.replace(ANSI, '')

export function rawTerminal({ columns = 100, rows = 40, depth = 8 } = {}) {
  const stdin = new PassThrough()
  stdin.isTTY = true
  stdin.modes = []
  stdin.setRawMode = on => { stdin.isRaw = on; stdin.modes.push(on); return stdin }
  const stderr = new PassThrough()
  Object.assign(stderr, { isTTY: true, columns, rows, getColorDepth: () => depth })
  const stdout = new PassThrough()
  stdout.isTTY = true
  const screen = { err: '', out: '', writes: [] }
  stderr.on('data', chunk => { screen.err += chunk; screen.writes.push(String(chunk)) })
  stdout.on('data', chunk => { screen.out += chunk })
  let seen = 0
  /** Resolves once stderr (after the last match) matches; rejects after a while with what it shows. */
  const waitFor = (pattern, timeout = 4000) => new Promise((resolve, reject) => {
    const started = Date.now()
    const check = () => {
      const plain = plainText(screen.err)
      const regex = typeof pattern === 'string' ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)
      regex.lastIndex = seen
      const match = regex.exec(plain)
      if (match) {
        seen = match.index + match[0].length
        return resolve(match)
      }
      if (Date.now() - started > timeout) return reject(new Error(`The screen never showed ${pattern}. It shows:\n${plainText(screen.err.slice(-1500))}`))
      setTimeout(check, 5)
    }
    check()
  })
  return { stdin, stderr, stdout, screen, waitFor }
}

/**
 * Run the CLI on a fake raw terminal. script: [[pattern, keys], ...]: each key string is typed once
 * the screen shows its pattern (a string or RegExp); keys may be a function that returns them.
 */
export async function richCli(argv, { run, fetch, home, env = {}, columns = 100, depth = 8, script = [], platform = 'linux', io = {} } = {}) {
  const t = rawTerminal({ columns, depth })
  const done = main(argv, {
    env: { HOME: home, PATH: process.env.PATH, LANG: 'en_US.UTF-8', ...env, SLATEBOX_INSTALL_HOME: home },
    stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, run, platform,
    fetch: fetch || (async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })),
    statfs: () => ({ bavail: 1e9, bsize: 4096 }),
    ...io,
  })
  let failure = null
  const typing = (async () => {
    for (const [pattern, keys] of script) {
      await t.waitFor(pattern)
      // A moment for the question to take its keys (as a person would).
      await new Promise(resolve => setTimeout(resolve, 2))
      const typed = typeof keys === 'function' ? keys() : keys
      for (const key of Array.isArray(typed) ? typed : [typed]) {
        t.stdin.write(key)
        await new Promise(resolve => setTimeout(resolve, key === KEY.esc ? 80 : 2))
      }
    }
  })().catch(error => { failure = error; t.stdin.write(KEY.ctrlC) })
  const code = await done
  await typing
  if (failure) throw failure
  return { code, stderr: t.screen.err, stdout: t.screen.out, writes: t.screen.writes, text: plainText(t.screen.err), modes: t.stdin.modes }
}
