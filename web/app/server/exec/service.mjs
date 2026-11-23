// exec on a Slatebox server: run one script in the sealed runner, every call through the gate,
// and keep its audit record. POST /api/v1/exec, the hosted /mcp endpoint and the in-app
// conversation all come here; the code never runs in the app process.
import { problem } from '../actions/errors.mjs'
import { newExecId as defaultExecId, sha256 } from './keys.mjs'
import { EXEC_LIMITS } from './limits.mjs'

const clip = (text, max) => String(text ?? '').slice(0, max)
const isInt = (value) => Number.isSafeInteger(value)

function capLogs(logs, maxBytes) {
  const out = []
  let used = 0
  for (const line of Array.isArray(logs) ? logs : []) {
    if (typeof line !== 'string') continue
    if (used + line.length + 1 > maxBytes) {
      out.push(`[logs cut at ${Math.round(maxBytes / 1024)} KiB]`)
      break
    }
    used += line.length + 1
    out.push(line)
  }
  return out
}



// Codes a script's own failure may carry without the gate having answered them this run.
const GUEST_CODES = new Set(['script_error', 'result_not_json'])

// The answer, from what the runner reported. The guest's envelope is untrusted: the script's
// code shares the client's wrapper, so it can hand back any object. Only its shape is read, a
// bad shape is a failed run, and a server code survives only when the gate answered it.
function shapeOutput({ ctx, outcome, mode, execId, execKey, answered, stillPending, limits }) {
  const output = {
    execId,
    status: 'completed',
    mode,
    idempotencyKey: execKey,
    logs: [],
    calls: [
      ...ctx.calls.map(({ runKey: _runKey, ...call }) => call),
      ...stillPending.map(([n, entry]) => ({ n, method: entry.method, pending: true })),
    ].sort((a, b) => a.n - b.n),
  }
  const fail = (error) => {
    output.status = 'failed'
    output.error = error
  }
  const value = outcome.status === 'completed' ? outcome.value : null
  if (outcome.status === 'failed') {
    fail(outcome.error?.code === 'exec_unavailable' ? { ...outcome.error } : runnerError(outcome.error))
  } else if (!value || typeof value !== 'object' || typeof value.ok !== 'boolean') {
    fail({ code: 'runner_error', message: 'The script could not be run.' })
  } else {
    output.logs = capLogs(value.logs, limits.logBytes)
    if (!value.ok) fail(guestError(value.error, answered))
    else if (value.json === null || value.json === undefined) output.result = null
    else if (typeof value.json !== 'string') fail({ code: 'result_not_json', message: 'Return a JSON value.' })
    else if (value.json.length > limits.resultChars) {
      output.result = value.json.slice(0, limits.resultChars)
      output.truncated = { chars: value.json.length }
    } else {
      try {
        output.result = JSON.parse(value.json)
      } catch {
        delete output.result
        fail({ code: 'result_not_json', message: 'Return a JSON value.' })
      }
    }
  }
  if (stillPending.length && output.status !== 'completed')
    output.error.message +=
      ' Calls marked pending were still running and may yet save; rerun with the same idempotencyKey so a saved call replays instead of saving twice.'
  else if (ctx.calls.length && ['timeout', 'cpu_timeout', 'idle'].includes(output.error?.code))
    output.error.message += ' Calls listed ran as shown; rerun with the same idempotencyKey so saved calls replay instead of saving twice.'
  if (ctx.held) {
    output.status = 'confirmation_required'
    delete output.result
    delete output.truncated
    if (output.error?.code === 'confirmation_required') delete output.error
    output.confirmation = { id: ctx.held.id, expiresAt: ctx.held.expiresAt, reasons: ctx.held.reasons }
  }
  return output
}

// The runner's own failures (it maps run's errors to these): known shape, bounded text.
function runnerError(error) {
  return {
    code: typeof error?.code === 'string' ? clip(error.code, 64) : 'runner_error',
    message: clip(error?.message, 2000) || 'The script could not be run.',
    ...(isInt(error?.line) && { line: error.line }),
    ...(isInt(error?.column) && { column: error.column }),
  }
}

// The script's failure, as the caller reads it. A code the gate answered this run keeps its
// name and the gate's own status and details; any other code is the script's own error.
function guestError(error, answered) {
  if (!error || typeof error !== 'object') return { code: 'script_error', message: 'The script failed.' }
  const code = typeof error.code === 'string' ? error.code : 'script_error'
  const message = clip(typeof error.message === 'string' ? error.message : '', 2000) || 'The script failed.'
  const where = {
    ...(isInt(error.line) && { line: error.line }),
    ...(isInt(error.column) && { column: error.column }),
  }
  const server = answered.get(code)
  if (server)
    return {
      code,
      message: clip(server.message, 2000),
      ...where,
      ...(isInt(server.status) && { status: server.status }),
      ...(server.details !== undefined && { details: server.details }),
    }
  if (GUEST_CODES.has(code)) return { code, message, ...where }
  return { code: 'script_error', message, ...where }
}

export function createExecService({
  gate,
  pool,
  store,
  wrap, // (code) -> prelude + "\n" + code + trailer
  limits = EXEC_LIMITS,
  now = Date.now,
  newExecId = defaultExecId,
  log = (line) => console.error(line),
  presence = null, // server/presence/agentPresence.mjs: the run's pointer and plan end with it
  redact = (code) => code, // redact.mjs: the code as the record keeps it, secret fields replaced
}) {
  async function run({
    principal,
    surface = 'api',
    intent,
    code,
    mode = 'save',
    confirm,
    idempotencyKey,
    writableShareIds = null,
  }) {
    if (typeof code !== 'string' || !code.trim() || Buffer.byteLength(code) > limits.codeBytes)
      throw problem(400, 'invalid_request', `code must be 1 to ${limits.codeBytes} bytes of JavaScript or TypeScript.`)
    if (!['save', 'preview'].includes(mode)) throw problem(400, 'mode_unavailable', 'exec runs with mode "save" or "preview".')
    const execId = newExecId()
    const execKey = idempotencyKey || execId
    const codeSha256 = sha256(code)
    const subject = principal.tokenId || principal.userId
    if (!(await store.lock(principal.userId, execId, limits.wallMs + limits.killGraceMs + 5000)))
      throw problem(429, 'exec_busy', 'Another script of yours is running. Retry when it finishes.', { retryAfter: 5 })
    const startedAt = now()
    let ended = 'stopped'
    try {
      let confirmation = null
      if (confirm) {
        const claimed = await store.claimConfirmation({ id: confirm, subject, codeSha256, execId })
        confirmation = { id: confirm, fingerprints: claimed.fingerprints || [], used: new Set() }
      }
      const ctx = gate.newContext({
        execId, principal, surface, mode, execKey, codeSha256, intent, confirmation, writableShareIds,
      })
      // Every call the script starts is tracked until it settles, so a call still running when
      // the script ends is waited for (and listed), never lost from the answer or the record.
      const pending = new Map() // seq -> { method, promise }
      const answered = new Map() // error code the gate answered this run -> its error
      let recorded = null // resolves once the run's record is written
      const onCall = (seq, method, input) => {
        const promise = gate.call(ctx, { seq, method, input }).then((envelope) => {
          if (envelope && !envelope.ok && typeof envelope.error?.code === 'string') answered.set(envelope.error.code, envelope.error)
          return envelope
        })
        const entry = { method: typeof method === 'string' ? clip(method, 120) : String(method), promise }
        pending.set(seq, entry)
        promise.finally(() => {
          pending.delete(seq)
          // Settled after the record was written: settle it in the record too.
          if (entry.late) recorded.then(() => settleLate(seq)).catch(() => {})
        }).catch(() => {})
        return promise
      }
      async function settleLate(seq) {
        const record = ctx.calls.find((call) => call.n === seq)
        try {
          await store.settleRunCall(execId, seq, record ? { ...record } : null)
        } catch (error) {
          log(`[exec] could not settle call ${seq} of ${execId}: ${error?.message}`)
        }
      }
      // pool.run refuses (busy, or no runner) before the script starts, so before any call.
      const outcome = await pool.run({ source: wrap(code), onCall })
      // A call the runner started may still be saving: wait for it, within the kill grace.
      if (pending.size) {
        let timer
        await Promise.race([
          Promise.allSettled([...pending.values()].map((entry) => entry.promise)),
          new Promise((resolve) => (timer = setTimeout(resolve, limits.killGraceMs))),
        ])
        clearTimeout(timer)
      }
      const stillPending = [...pending.entries()].sort(([a], [b]) => a - b)
      for (const [, entry] of stillPending) entry.late = true
      const output = shapeOutput({ ctx, outcome, mode, execId, execKey, answered, stillPending, limits })
      output.usage = {
        calls: ctx.counters.calls,
        maxCalls: limits.calls,
        operations: ctx.counters.operations,
        notesCreated: ctx.counters.notesCreated,
        wallMs: Math.max(0, Math.round(now() - startedAt)),
      }
      // The record is written whatever the script handed back.
      recorded = (async () => {
        try {
          await store.writeRun({
            _id: execId,
            subject,
            userId: principal.userId,
            tokenId: principal.tokenId || null,
            tokenName: principal.tokenName || null,
            surface,
            intent: clip(intent, 200),
            codeSha256,
            // The code that ran is codeSha256; the text kept has secret fields replaced.
            code: redact(code),
            mode,
            execKeySha256: sha256(execKey),
            confirmId: confirm || null,
            status: output.status,
            ...(output.error && { error: { code: output.error.code, message: clip(output.error.message, 500) } }),
            calls: ctx.calls.slice(),
            pending: Object.fromEntries(stillPending.map(([seq, entry]) => [String(seq), entry.method])),
            counters: ctx.counters,
            minReadRank: ctx.minReadRank,
            heldId: ctx.held?.id || null,
            startedAt: new Date(startedAt),
            endedAt: new Date(now()),
          })
        } catch (error) {
          log(`[exec] could not write the audit record for ${execId}: ${error?.message}`)
          throw error
        }
      })()
      await recorded.catch(() => {})
      // The runner died under the script: it did not finish, so say so as the request's status.
      if (outcome.status === 'failed' && outcome.error?.code === 'exec_unavailable')
        throw problem(503, 'exec_unavailable', 'The script runner stopped. Calls listed in the run record may have saved; rerun with the same idempotencyKey.', {
          details: { execId },
          retryAfter: 5,
        })
      // The in-app conversation reads the calls' inputs back (to keep what it previewed).
      Object.defineProperty(output, 'context', { value: ctx, enumerable: false })
      ended = output.status === 'failed' ? 'stopped' : 'done'
      return output
    } finally {
      // Everyone on the slate sees the run end: its list stays a moment, then fades.
      if (presence && mode === 'save')
        await presence.end(execId, ended).catch((error) => log(`[exec] could not end the presence of ${execId}: ${error?.message}`))
      await store.unlock(principal.userId, execId).catch(() => {})
    }
  }

  async function get(principal, execId) {
    const record = await store.getRun(principal.tokenId || principal.userId, execId)
    if (!record) throw problem(404, 'not_found', 'There is no such run of yours.')
    const { _id, subject: _subject, confirmedUsed: _used, expiresAt, startedAt, endedAt, ...rest } = record
    const iso = (value) => (value ? new Date(value).toISOString() : null)
    return {
      execId: _id,
      ...rest,
      calls: (rest.calls || []).map(({ runKey: _runKey, ...call }) => call),
      startedAt: iso(startedAt),
      endedAt: iso(endedAt),
      expiresAt: iso(expiresAt),
    }
  }

  return { run, get }
}
