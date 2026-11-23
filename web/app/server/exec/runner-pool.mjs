// The parent side of the sealed runner. It runs inside the app process but never evaluates a
// script: it starts one runner child per app process (web/app/private/exec/runner-child.mjs),
// sends it scripts, answers its calls through the gate, and treats everything the child says
// as untrusted (checked field by field). A message that breaks the protocol kills the child;
// a call whose method or input is malformed is the script's own doing (it can pass anything to
// __slatebox.call), so it fails that call only: one script must never stop other people's runs.
//
// Wire format, JSON over the IPC channel, v:1, at most 1 MiB per message:
//   C→P {t:'ready', node, run}
//   P→C {t:'run', runId, source, limits}
//   C→P {t:'call', runId, seq, method, input}        seq = run's requestIndex (1-based)
//   P→C {t:'reply', runId, seq, envelope}
//   C→P {t:'done', runId, outcome:{status:'completed', value} | {status:'failed', error}}
//   P→C {t:'cancel', runId}
//   P→C {t:'selftest'}  C→P {t:'selftest', envKeys, fsDenied, fsWriteDenied, childProcessDenied, ...}
import { fork as nodeFork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { problem } from '../actions/errors.mjs'
import { EXEC_LIMITS } from './limits.mjs'

const MAX_MESSAGE = 1024 * 1024
const READY_MS = 5000
const STDERR_PER_MINUTE = 16 * 1024

// The run package's own folder (the child may read it and nothing else of the app).
export const runPackageDir = (runEntry) => dirname(dirname(runEntry))

export function runnerExecArgv({ childPath, runEntry, heapMiB = 192 }) {
  return [
    '--permission',
    `--allow-fs-read=${childPath}`,
    `--allow-fs-read=${runPackageDir(runEntry)}`,
    '--allow-worker',
    `--max-old-space-size=${heapMiB}`,
    '--disallow-code-generation-from-strings',
    '--no-warnings',
  ]
}

export function createRunnerPool({
  childPath,
  runEntry,
  limits = EXEC_LIMITS,
  nodePath = process.execPath,
  fork = nodeFork,
  log = (line) => console.error(line),
  now = Date.now,
}) {
  let child = null
  let starting = null
  let refused = null // a selftest that failed: the pool stays shut, and says why in the log
  const spawns = []
  const inFlight = new Map() // runId -> { resolve, onCall, timer }
  let stderrBudget = { minute: 0, used: 0 }

  const unavailable = (why) => problem(503, 'exec_unavailable', 'Scripts cannot run on this server right now. Retry shortly.', { details: { reason: why } })

  // Runs waiting for a free slot, first come first served (a full runner queues, then refuses).
  const waiters = []
  function release(runId) {
    inFlight.delete(runId)
    // One freed slot wakes one waiter, which takes it before any other task runs.
    if (waiters.length && inFlight.size < limits.runsPerProcess) waiters.shift()()
  }

  function failAll(code) {
    for (const [runId, run] of inFlight) {
      clearTimeout(run.timer)
      release(runId)
      run.resolve?.({ status: 'failed', error: code === 'timeout'
        ? { code: 'timeout', message: 'The script ran past its time limit.' }
        : { code: 'exec_unavailable', message: 'The script runner stopped. Retry shortly.' } })
    }
  }

  function kill(reason) {
    if (!child) return
    const dying = child
    child = null
    log(`[exec-runner] stopping the runner: ${reason}`)
    try {
      dying.kill('SIGKILL')
    } catch {}
  }

  const validCall = (m) =>
    typeof m.runId === 'string' && inFlight.has(m.runId) && Number.isSafeInteger(m.seq) && m.seq > 0
  const wellFormedRequest = (m) =>
    typeof m.method === 'string' && m.method.length > 0 && m.method.length <= 120 &&
    m.input !== null && typeof m.input === 'object' && !Array.isArray(m.input)

  async function onMessage(proc, message) {
    if (proc !== child) return
    let size
    try {
      size = JSON.stringify(message).length
    } catch {
      size = Infinity
    }
    if (!message || message.v !== 1 || size > MAX_MESSAGE) return kill('a malformed message')
    if (message.t === 'call') {
      if (!validCall(message)) return kill('a malformed call')
      const run = inFlight.get(message.runId)
      let envelope
      if (!wellFormedRequest(message)) {
        envelope = { ok: false, error: { code: 'invalid_request', status: 400, message: 'A call takes a method name and one plain object.' } }
      } else {
        try {
          envelope = await run.onCall(message.seq, message.method, message.input)
        } catch {
          envelope = { ok: false, error: { code: 'internal_error', status: 500, message: 'The call could not be completed.' } }
        }
      }
      if (JSON.stringify(envelope).length > MAX_MESSAGE)
        envelope = { ok: false, error: { code: 'output_too_large', status: 422, message: 'The answer was too large.' } }
      if (proc === child && inFlight.has(message.runId))
        proc.send({ v: 1, t: 'reply', runId: message.runId, seq: message.seq, envelope })
      return
    }
    if (message.t === 'done') {
      const run = inFlight.get(message.runId)
      const outcome = message.outcome
      if (!run || !outcome || !['completed', 'failed'].includes(outcome.status)) return kill('a malformed result')
      if (outcome.status === 'failed' && (typeof outcome.error?.code !== 'string' || typeof outcome.error?.message !== 'string'))
        return kill('a malformed failure')
      clearTimeout(run.timer)
      release(message.runId)
      run.resolve(outcome)
      return
    }
    if (message.t === 'ready' || message.t === 'selftest') return proc.emit('slatebox:' + message.t, message)
    kill('an unknown message')
  }

  function spawn() {
    const minuteAgo = now() - 60000
    while (spawns.length && spawns[0] < minuteAgo) spawns.shift()
    if (spawns.length >= 3) throw unavailable('restarted too often')
    spawns.push(now())
    const proc = fork(childPath, [runEntry, String(limits.runsPerProcess)], {
      execPath: nodePath,
      execArgv: runnerExecArgv({ childPath, runEntry }),
      env: {},
      cwd: runPackageDir(runEntry),
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'json',
    })
    proc.stderr?.on('data', (chunk) => {
      const minute = Math.floor(now() / 60000)
      if (stderrBudget.minute !== minute) stderrBudget = { minute, used: 0 }
      if (stderrBudget.used >= STDERR_PER_MINUTE) return
      const text = String(chunk).slice(0, STDERR_PER_MINUTE - stderrBudget.used)
      stderrBudget.used += text.length
      log(`[exec-runner] ${text.trimEnd()}`)
    })
    proc.on('message', (message) => void onMessage(proc, message))
    proc.on('exit', () => {
      if (proc === child) child = null
      failAll('exec_unavailable')
    })
    proc.on('error', () => {
      if (proc === child) child = null
    })
    return proc
  }

  function waitFor(proc, event) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${event}`)), READY_MS)
      proc.once('slatebox:' + event, (message) => {
        clearTimeout(timer)
        resolve(message)
      })
      proc.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('exited'))
      })
    })
  }

  // A runner that fails its selftest is never used: the reason is logged, callers get 503.
  const sealed = (t) =>
    t.envKeys === 0 && t.fsDenied === true && t.fsWriteDenied === true && t.childProcessDenied === true &&
    t.addonsDenied === true && t.workerAllowed === true

  async function ensure() {
    if (refused) throw unavailable(refused)
    if (child) return child
    if (starting) return starting
    starting = (async () => {
      const proc = spawn()
      child = proc
      try {
        const ready = await waitFor(proc, 'ready')
        proc.send({ v: 1, t: 'selftest' })
        const test = await waitFor(proc, 'selftest')
        if (!sealed(test)) {
          refused = 'the runner is not sealed: ' + JSON.stringify(test)
          kill(refused)
          throw unavailable(refused)
        }
        proc.info = { node: ready.node, run: ready.run, selftest: test }
        return proc
      } catch (error) {
        if (proc === child) kill('it did not start')
        if (error?.code === 'exec_unavailable') throw error
        throw unavailable('it did not start')
      } finally {
        starting = null
      }
    })()
    return starting
  }

  async function run({ source, onCall }) {
    if (inFlight.size >= limits.runsPerProcess) {
      const waited = await new Promise((resolve) => {
        const wake = () => {
          clearTimeout(timer)
          resolve(true)
        }
        const timer = setTimeout(() => {
          const at = waiters.indexOf(wake)
          if (at >= 0) waiters.splice(at, 1)
          resolve(false)
        }, limits.slotWaitMs ?? 0)
        waiters.push(wake)
      })
      if (!waited || inFlight.size >= limits.runsPerProcess)
        throw problem(429, 'exec_busy', 'Too many scripts are running here. Retry shortly.', { retryAfter: 5 })
    }
    const runId = randomUUID()
    const slot = { resolve: null, onCall, timer: null }
    inFlight.set(runId, slot) // hold the slot while the child starts
    let proc
    try {
      proc = await ensure()
    } catch (error) {
      release(runId)
      throw error
    }
    return new Promise((resolve) => {
      slot.resolve = resolve
      slot.timer = setTimeout(() => {
        // Past the wall clock and its grace: the child is stuck. Kill it; the next run respawns.
        failAll('timeout')
        kill('a script passed its wall clock')
      }, limits.wallMs + limits.killGraceMs)
      proc.send({ v: 1, t: 'run', runId, source, limits })
    })
  }

  async function selftest() {
    const proc = await ensure()
    return proc.info
  }

  function close() {
    failAll('exec_unavailable')
    if (child) {
      try {
        child.disconnect()
      } catch {}
      kill('closing')
    }
  }

  return { run, selftest, close, inFlight: () => inFlight.size, pid: () => child?.pid ?? null }
}
