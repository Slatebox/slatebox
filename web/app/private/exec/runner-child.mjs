// The sealed exec runner: a child process the app starts with an empty environment and Node's
// permission model (read access to this file and the `run` package only; no file writes, no
// child processes, no native addons). Inside it, `run` evaluates each script in QuickJS
// compiled to WebAssembly, in a worker thread, with no Node, file, network, module, timer or
// eval access. The script's one capability is __slatebox.call(method, input), which this
// process forwards to the app over the IPC channel; the app answers through its exec gate
// and the action registry, with the caller's own token and rules.
//
// argv: [node, this file, <absolute path of run's entry>, <max runs at once>]
// Messages (JSON, v:1): see web/app/server/exec/runner-pool.mjs.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const entry = process.argv[2]
const runModule = await import(pathToFileURL(entry).href)
const { createRunner, setMaxWorkers, getHostFunctionContext } = runModule
const runVersion = JSON.parse(readFileSync(new URL('../package.json', pathToFileURL(entry)), 'utf8')).version
setMaxWorkers(Math.max(1, Number(process.argv[3]) || 2))
const runner = createRunner({})
const runs = new Map() // runId -> { controller, waiting: Map(seq -> resolve), lastActivity, idleMs, idle }

// A script has no timers and no I/O of its own: only a slatebox call can resolve what it awaits.
// A run with no call in flight, no call for idleMs, while this process is quiet (so no script
// here is computing), is waiting on nothing and never will finish: it is stopped as idle, so it
// gives its slot back instead of holding it for the whole wall clock.
const TICK_MS = 100
let lastCpu = process.cpuUsage()
let lastTick = Date.now()
let quietSince = Date.now()
const idleTimer = setInterval(() => {
  const at = Date.now()
  const cpu = process.cpuUsage(lastCpu)
  lastCpu = process.cpuUsage()
  const busyMs = (cpu.user + cpu.system) / 1000
  // Waiting scripts cost a few percent of a core each (run's own clock); one that computes costs
  // a whole core, and still well above a fifth of one on a busy host.
  if (busyMs > Math.max(1, at - lastTick) * 0.2) quietSince = at
  lastTick = at
  for (const state of runs.values())
    if (!state.idle && state.waiting.size === 0 && at - state.lastActivity >= state.idleMs && at - quietSince >= state.idleMs) {
      state.idle = true
      state.controller.abort()
    }
}, TICK_MS)
idleTimer.unref()

const send = (message) => {
  if (process.connected) process.send({ v: 1, ...message })
}

function locate(error) {
  const found = /run\.js:(\d+):(\d+)/.exec(String(error?.stack || ''))
  return found && Number(found[1]) > 1 ? { line: Number(found[1]) - 1, column: Number(found[2]) } : {}
}

const clip = (text, max = 1000) => String(text ?? '').slice(0, max)

function failure(error) {
  const code = error?.code
  if (code === 'RUN_CPU_TIMEOUT') return { code: 'cpu_timeout', message: 'The script used more than its CPU time.' }
  if (code === 'RUN_TIMEOUT') return { code: 'timeout', message: 'The script ran past its time limit.' }
  if (code === 'RUN_BRIDGE_LIMIT') return { code: 'call_limit', message: 'The script made more calls than one script may.' }
  if (code === 'RUN_DETACHED_BRIDGE_REQUEST')
    return { code: 'detached_call', message: 'The script returned before a call finished. Await every slatebox call.' }
  if (code === 'RUN_SOURCE_TOO_LARGE') return { code: 'code_too_large', message: 'The script is too large.' }
  if (code === 'RUN_CONCURRENCY_LIMIT') return { code: 'exec_busy', message: 'Too many scripts are running. Retry shortly.' }
  if (code === 'RUN_ABORTED') return { code: 'cancelled', message: 'The script was stopped.' }
  if (code === 'RUN_SERIALIZATION_ERROR') return { code: 'result_not_json', message: 'Return a JSON value.' }
  if (code === 'RUN_USER_SOURCE_ERROR') {
    if (error?.name === 'InternalError' && /out of memory/i.test(error?.message || ''))
      return { code: 'memory', message: 'The script used more than its memory.' }
    return { code: 'script_error', message: clip(`${error?.name || 'Error'}: ${error?.message || ''}`), ...locate(error) }
  }
  return { code: 'runner_error', message: 'The script could not be run.' }
}

function bridge(runId) {
  return {
    call(method, input) {
      const state = runs.get(runId)
      if (!state) return { ok: false, error: { code: 'cancelled', status: 499, message: 'The script was stopped.' } }
      // The script can pass anything here; refuse what is not a call before it reaches the app.
      if (typeof method !== 'string' || !method || method.length > 120 || input === null || typeof input !== 'object' || Array.isArray(input))
        return { ok: false, error: { code: 'invalid_request', status: 400, message: 'A call takes a method name and one plain object.' } }
      const { requestIndex: seq } = getHostFunctionContext()
      state.lastActivity = Date.now()
      return new Promise((resolve) => {
        state.waiting.set(seq, resolve)
        send({ t: 'call', runId, seq, method, input })
      })
    },
  }
}

async function start({ runId, source, limits }) {
  const controller = new AbortController()
  const idleMs = Number.isSafeInteger(limits.idleMs) && limits.idleMs > 0 ? limits.idleMs : 2000
  const state = { controller, waiting: new Map(), lastActivity: Date.now(), idleMs, idle: false }
  runs.set(runId, state)
  const started = Date.now()
  try {
    const result = await runner.run({
      source,
      hostFunctions: { __slatebox: bridge(runId) },
      abortSignal: controller.signal,
      limits: {
        timeoutMs: limits.wallMs,
        cpuTimeoutMs: limits.cpuMs,
        memoryLimitBytes: limits.memoryBytes,
        maxStackSizeBytes: limits.stackBytes,
        maxSourceBytes: limits.sourceBytes,
        maxBridgeRequests: limits.calls,
        maxInFlightBridgeRequests: limits.callsInFlight,
        maxHostFunctionArgumentsBytes: limits.callInputBytes,
        maxHostFunctionOutputBytes: limits.callOutputBytes + 65536,
        maxResultBytes: limits.resultChars * 4 + limits.logBytes * 4 + 65536,
      },
    })
    send({ t: 'done', runId, outcome: { status: 'completed', value: result.value, wallMs: Date.now() - started } })
  } catch (error) {
    const reason = state.idle
      ? { code: 'idle', message: `The script waited ${Math.round(idleMs / 100) / 10} s with no slatebox call running. Scripts have no timers: await only slatebox calls.` }
      : failure(error)
    send({ t: 'done', runId, outcome: { status: 'failed', error: reason, wallMs: Date.now() - started } })
  } finally {
    runs.delete(runId)
  }
}

function selftest() {
  const has = (...args) => {
    try {
      return process.permission?.has(...args) === true
    } catch {
      return null
    }
  }
  let fsDenied = false
  try {
    readFileSync('/etc/hosts')
  } catch (error) {
    fsDenied = error?.code === 'ERR_ACCESS_DENIED'
  }
  const major = Number(process.versions.node.split('.')[0])
  send({
    t: 'selftest',
    // macOS adds its text-encoding variable to every process; it carries no secret.
    envKeys: Object.keys(process.env).filter((name) => name !== '__CF_USER_TEXT_ENCODING').length,
    fsDenied: fsDenied && has('fs.read', '/etc/hosts') === false,
    fsWriteDenied: has('fs.write') === false,
    childProcessDenied: has('child') === false,
    addonsDenied: has('addon') === false,
    workerAllowed: has('worker') === true,
    // Node 25 and later deny the network under --permission without --allow-net; Node 24 cannot.
    netDeniedByFlags: major >= 25 && has('net') === false,
  })
}

process.on('message', (message) => {
  if (!message || message.v !== 1) return
  if (message.t === 'run') return void start(message)
  if (message.t === 'reply') {
    const waiting = runs.get(message.runId)?.waiting
    const resolve = waiting?.get(message.seq)
    waiting?.delete(message.seq)
    const state = runs.get(message.runId)
    if (state) state.lastActivity = Date.now()
    return void resolve?.(message.envelope)
  }
  if (message.t === 'cancel') return void runs.get(message.runId)?.controller.abort()
  if (message.t === 'selftest') return void selftest()
})
process.on('disconnect', () => process.exit(0))
send({ t: 'ready', node: process.version, run: runVersion })
