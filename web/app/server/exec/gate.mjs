// The exec gate: the one implementation of the script rules. Every client call a script makes
// passes through here, whichever runner made it:
//   - the sealed runner's bridge calls gate.call(ctx, ...) in process;
//   - a local script's HTTP calls carry Slatebox-Exec-* headers, and the HTTP layer hands them
//     to gate.httpCall(...), which keeps the run's state in its execRuns record.
// After the rules, every call is registry.run with the caller's own principal, so the
// registry's checks (admission, scope, rate limit, validation, idempotency) all still apply.
//
// The rules, in order: the method must be in the client; at most `calls` calls; a preview run
// previews every write; an in-app run writes only to its own slate; plan operation and new
// note caps; a save that deletes, rewrites more than N notes' text, changes someone else's
// notes, widens who sees content, or grants access is held for confirmation; then the call,
// with a key derived from the run's key and the call's place.
import { randomUUID } from 'node:crypto'
import { problem, ActionError, toActionError } from '../actions/errors.mjs'
import { requestFingerprint } from '../actions/registry.mjs'
import { deriveKey, newConfirmationId as defaultConfirmationId, sha256 } from './keys.mjs'
import { EXEC_LIMITS } from './limits.mjs'

export const AUDIENCE_RANK = Object.freeze({ private: 0, invite: 1, public: 2 })
const ADDITIVE_KINDS = new Set(['add_nodes', 'connect_nodes'])
const MAP_AUTHORING_KINDS = new Set(['add_map_branch', 'update_map_outcome'])
// Workshop edits that only add something new. A plan of these alone, on the caller's own
// slate, saves with no preview. Every other edit kind (a move, a rename, a new outcome, a
// picture taken off, and any kind the engine adds later) is previewed first: the preview's
// report says what it took away (removed*, by comparing the boards), and on someone else's
// slate every edit that changed something of theirs counts as their notes. Nothing is listed
// by hand as "removing", so a new edit kind cannot skip the hold.
const ADDING_EDITS = new Set(['add_card', 'add_lane', 'add_station'])
// What a workshop report says was taken away (workshop-operation-api.mjs removedBetween, and
// disconnect_workshop_card's removedLines).
const REMOVED_FIELDS = ['removedCards', 'removedLanes', 'removedLinks', 'removedOutcomes', 'removedPaths', 'removedImages', 'removedLines']
const workshopEdits = (op) => (op?.kind === 'workshop_edits' && Array.isArray(op.edits) ? op.edits : null)
const EXEC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const KEY = /^[!-~]{1,128}$/
const CONFIRM = /^cf_[A-Za-z0-9]{24}$/
const SHA = /^[0-9a-f]{64}$/
// What a confirmation for a plain API call (no script) is bound to in place of a script's code.
const DIRECT_CODE = sha256('slatebox:direct-api-call')

const isPlain = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value))

const sameText = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// Refusals that come before the caller may open the slate: they reveal nothing of its content.
const NOT_OPENED = new Set([401, 403, 404])

const errorEnvelope = (failure) => ({
  ok: false,
  error: {
    code: failure.code,
    status: failure.status,
    message: failure.message,
    ...(failure.details !== undefined && { details: failure.details }),
    ...(failure.retryAfter !== undefined && { retryAfter: failure.retryAfter }),
  },
})

// A plan's size: each workshop edit counts as an operation, and a workshop card is a note.
function planCounts(input) {
  const operations = Array.isArray(input?.plan?.operations) ? input.plan.operations : []
  let notes = 0
  let count = 0
  const edits = []
  for (const op of operations) {
    const list = workshopEdits(op)
    if (list) {
      count += list.length
      for (const edit of list) {
        edits.push(edit?.kind)
        if (edit?.kind === 'add_card') notes += 1
      }
      continue
    }
    count += 1
    if (op?.kind === 'add_nodes')
      notes += Array.isArray(op.ids) && op.ids.length ? op.ids.length : Number.isInteger(op.count) ? op.count : 1
  }
  return { operations: count, notes, kinds: operations.map((op) => op?.kind), edits }
}

// What a save did, counted as the caps count it.
function savedCounts(body) {
  let operations = 0
  for (const op of Array.isArray(body?.operations) ? body.operations : []) operations += workshopEdits(op)?.length ?? 1
  const report = body?.report || {}
  const notes = (Array.isArray(report.created) ? report.created.length : 0) + (Array.isArray(report.addedCards) ? report.addedCards.length : 0)
  return { operations, notes }
}

// The fingerprint a confirmation holds: the method and the input it would save.
export const callFingerprint = (method, input) => {
  const { mode: _mode, ...rest } = input || {}
  return requestFingerprint(method, rest)
}

export function createGate({
  registry,
  manifest,
  limits = EXEC_LIMITS,
  readSlate, // (shareId) -> stored slate or null; called only after the caller may read it
  audienceOf, // async (slate) -> 'private' | 'invite' | 'public'
  isReplay = async () => false, // (subject, key) -> true when that key already saved
  store, // createExecStore(...)
  now = Date.now,
  newConfirmationId = defaultConfirmationId,
}) {
  const methods = new Map(manifest.methods.map((method) => [method.name, method]))
  const byAction = new Map(manifest.methods.map((method) => [method.id, method]))
  const localTurns = new Map() // execId -> the promise the next local call of that run waits for

  const rankOf = async (shareId) => {
    const slate = await readSlate(shareId)
    return slate ? AUDIENCE_RANK[await audienceOf(slate)] ?? AUDIENCE_RANK.public : null
  }

  // One call at a time per run. A call's checks (caps, text rewrites, what the run has read)
  // read the run's counters before their awaits and the effects land after, so calls a script
  // sends at once (Promise.all) would otherwise each pass checks the others should have failed.
  function serial(ctx, task) {
    const turn = (ctx.turn || Promise.resolve()).then(task)
    ctx.turn = turn.catch(() => {})
    return turn
  }

  function newContext({
    execId,
    principal,
    surface,
    mode = 'save',
    execKey,
    codeSha256,
    intent,
    confirmation = null,
    writableShareIds = null,
  }) {
    return {
      execId,
      principal,
      subject: principal.tokenId || principal.userId,
      surface,
      mode,
      execKey: execKey || execId,
      codeSha256,
      intent,
      confirmation, // {id, fingerprints, used: Set}
      writableShareIds,
      counters: { calls: 0, operations: 0, notesCreated: 0, rewrittenText: 0 },
      minReadRank: null,
      held: null, // {id, expiresAt, reasons}
      calls: [],
      writes: [],
    }
  }

  // Why a save would be held; [] when it may save. Runs the same input as a preview through the
  // registry when the plan could remove or change existing content (the probe counts once
  // toward the rate limit, not toward the call cap).
  async function assess(ctx, action, input, { probe = true } = {}) {
    const reasons = []
    const shareId = typeof input.shareId === 'string' ? input.shareId : undefined
    // A call that only reaches outside and changes no slate (readOnly, such as testing an AI
    // connection, or changesNoSlate, such as drawing shape candidates) widens nothing.
    const widensAccess =
      (action.scope === 'slates:share' && !action.destructive) || (action.openWorld && !action.changesNoSlate) || action.confirm
    // A call whose effect depends on the slate as it stands (slates.undo: the edit it takes back) is read
    // first: held only when it removes something, and the agreement names the edit it would take back.
    if (action.peek && typeof registry.peek === 'function') {
      if (widensAccess) reasons.push({ rule: 'widens_access', ...(shareId && { shareId }) })
      let seen = null
      try {
        seen = await registry.peek(ctx.principal, action.id, input)
      } catch {
        // The save itself answers with the same refusal.
        return { reasons }
      }
      if (seen?.removes) reasons.push({ rule: 'removes', ...(shareId && { shareId }), count: seen.removes, ...(seen.edit && { edit: seen.edit }) })
      return { reasons, ...(seen?.edit && { fingerprintInput: { ...input, edit: seen.edit } }) }
    }
    if (action.id !== 'slates.applyOperations') {
      if (action.destructive && (!action.removes || action.removes(input))) reasons.push({ rule: 'removes', ...(shareId && { shareId }) })
      if (widensAccess) reasons.push({ rule: 'widens_access', ...(shareId && { shareId }) })
      return { reasons }
    }
    if (widensAccess) reasons.push({ rule: 'widens_access', shareId })
    const { kinds, edits } = planCounts(input)
    const audienceMatters = ctx.minReadRank !== null && ctx.minReadRank < AUDIENCE_RANK.public
    let additive = kinds.length > 0 && kinds.every((kind) => ADDITIVE_KINDS.has(kind))
    if (kinds.length > 0 && kinds.every((kind) => kind === 'workshop_edits')) {
      // Workshop edits that only add skip the preview on the caller's own slate. On someone
      // else's slate every plan is previewed, so what it changes of theirs is counted.
      additive = edits.every((kind) => ADDING_EDITS.has(kind)) && (await readSlate(shareId))?.userId === ctx.principal.userId
    }
    if (!probe || (additive && !audienceMatters)) return { reasons }
    let preview
    try {
      preview = await registry.run(ctx.principal, action.id, { ...input, mode: 'preview' })
    } catch {
      // The save itself answers with the same refusal.
      return { reasons }
    }
    const slate = await readSlate(shareId)
    if (!slate) return { reasons }
    const report = preview.body?.report || {}
    const created = new Set(report.created || [])
    const deleted = (report.deleted || []).filter((id) => !created.has(id))
    const disconnected = report.disconnected || []
    // A workshop edit's report names what it took away.
    const removedFromWorkshop = REMOVED_FIELDS.reduce(
      (sum, field) => sum + (Array.isArray(report[field]) ? report[field].length : 0),
      0
    )
    if (deleted.length || disconnected.length || removedFromWorkshop)
      reasons.push({ rule: 'removes', shareId, count: deleted.length + disconnected.length + removedFromWorkshop })
    // A card moved past a board's rule (a move made anyway): the person agrees first, shown the rule it breaks.
    const overrides = Array.isArray(report.overrides) ? report.overrides : []
    if (overrides.length)
      reasons.push({ rule: 'breaks_board_rule', shareId, count: overrides.length, rules: overrides.map((item) => String(item.sentence).slice(0, 300)) })
    const texts = new Map((slate.nodes || []).map((node) => [node.options?.id, sameText(node.options?.text)]))
    let rewrites = 0
    for (const op of preview.body?.operations || []) {
      if (op?.kind !== 'update_nodes' || op.changes?.text === undefined) continue
      for (const id of op.target?.ids || [])
        if (texts.has(id) && texts.get(id) !== sameText(op.changes.text)) rewrites += 1
    }
    // The owner's rule counts per script: existing notes whose text the whole script changes,
    // on every slate it writes to.
    const before = ctx.counters.rewrittenText
    if (rewrites && before + rewrites > limits.rewriteTextWithoutConfirm)
      reasons.push({ rule: 'rewrites_text', shareId, count: before + rewrites })
    if (slate.userId !== ctx.principal.userId) {
      const touched = new Set([
        ...(report.updated || []).filter((id) => !created.has(id)),
        ...deleted,
      ])
      const authoring = kinds.some((kind) => MAP_AUTHORING_KINDS.has(kind))
      // On a workshop: every edit that changed something already there (a rename, a move, new
      // words, a picture), and everything taken away. Only adding something new is not theirs.
      const rewritten = (report.edits || []).filter((edit) => !ADDING_EDITS.has(edit?.kind) && edit?.changed !== false).length
      const count = touched.size + disconnected.length + (report.connectionsUpdated || []).length + rewritten + removedFromWorkshop
      if (count || authoring) reasons.push({ rule: 'others_notes', shareId, ...(count && { count }) })
    }
    if (audienceMatters) {
      const rank = AUDIENCE_RANK[await audienceOf(slate)] ?? AUDIENCE_RANK.public
      if (rank > ctx.minReadRank) reasons.push({ rule: 'widens_audience', shareId })
    }
    return { reasons, rewrites }
  }

  // One call. Returns {ok, status, body | failure, meta, record, effects}; the caller applies
  // the effects to the run (in memory for a sealed run, in its record for a local run).
  async function step(ctx, { seq, method: name, input }) {
    const started = now()
    const method = methods.get(name)
    const effects = { operations: 0, notesCreated: 0, rewritten: null, readRank: null, confirmedUsed: null, held: null }
    const finish = (outcome) => ({
      ...outcome,
      effects,
      record: {
        n: seq,
        method: name,
        mode: outcome.mode ?? null,
        ok: outcome.ok,
        status: outcome.status,
        ...(!outcome.ok && { code: outcome.failure.code }),
        ...(outcome.held && { held: true }),
        ...(outcome.meta?.replayed && { replayed: true }),
        ...(outcome.runKey && { runKey: outcome.runKey }),
        ms: Math.max(0, Math.round(now() - started)),
      },
    })
    const refuse = (failure, extra = {}) => finish({ ok: false, status: failure.status, failure, ...extra })
    if (!method) return refuse(problem(404, 'unknown_method', `There is no client method ${String(name).slice(0, 80)}.`))
    if (ctx.counters.calls > limits.calls)
      return refuse(problem(422, 'call_limit', `A script makes at most ${limits.calls} calls.`))
    if (!isPlain(input))
      return refuse(problem(400, 'invalid_request', `${name} takes one plain object as its argument.`))
    const action = registry.get(method.id)
    const write = action.kind === 'write'
    let given = { ...input }
    if (write && ctx.mode === 'preview') {
      if (!action.modes.includes('preview'))
        return refuse(
          problem(400, 'preview_unavailable', `${name} cannot be previewed, so this preview run stops here.`, {
            details: { method: name },
          })
        )
      given.mode = 'preview'
    }
    const mode = write ? (given.mode === undefined ? 'save' : given.mode) : null
    // A call that changes no slate (changesNoSlate, such as drawing shape candidates) may run in
    // an in-app conversation; every other write is kept to the conversation's own slate.
    if (write && !action.changesNoSlate && ctx.writableShareIds && !ctx.writableShareIds.includes(given.shareId))
      return refuse(problem(403, 'out_of_scope', 'This conversation may change only its own slate.'), { mode })
    if (action.id === 'slates.applyOperations') {
      const counts = planCounts(given)
      if (ctx.counters.operations + counts.operations > limits.operations)
        return refuse(problem(422, 'operation_limit', `A script carries at most ${limits.operations} plan operations.`), { mode })
      if (ctx.counters.notesCreated + counts.notes > limits.notesCreated)
        return refuse(problem(422, 'note_limit', `A script adds at most ${limits.notesCreated} notes.`), { mode })
    }
    const runKey = write && action.idempotency !== 'none' ? deriveKey(ctx.subject, ctx.execKey, seq) : undefined
    let rewrites = 0
    if (mode === 'save' && !(runKey && (await isReplay(ctx.subject, runKey)))) {
      // A call the caller may not make (a permission the token lacks) is refused now, before
      // the person is asked to agree to it.
      const refusal = refusedBeforeHold(ctx.principal, action, given)
      if (refusal) return refuse(refusal, { mode })
      const assessed = await assess(ctx, action, given)
      rewrites = assessed.rewrites || 0
      if (assessed.reasons.length) {
        const fingerprint = callFingerprint(name, assessed.fingerprintInput ?? given)
        const confirmed =
          ctx.confirmation &&
          ctx.confirmation.fingerprints.includes(fingerprint) &&
          !ctx.confirmation.used.has(fingerprint)
        if (confirmed) {
          ctx.confirmation.used.add(fingerprint)
          effects.confirmedUsed = fingerprint
        } else {
          const reasons = assessed.reasons.map((reason) => ({ n: seq, ...reason }))
          const id = await holdId(ctx)
          const expiresAt = new Date(now() + limits.confirmMinutes * 60000)
          await store.addHeld(id, { subject: ctx.subject, codeSha256: ctx.codeSha256, expiresAt }, fingerprint, reasons)
          effects.held = { id, expiresAt: expiresAt.toISOString(), reasons }
          const failure = problem(
            409,
            'confirmation_required',
            'This change needs the person to agree first. Show them the reasons; if they agree, run the same code again with confirm and the same idempotencyKey.',
            { details: { confirmationId: id, expiresAt: expiresAt.toISOString(), reasons: assessed.reasons } }
          )
          return refuse(failure, { mode, held: true, meta: { execHeld: id } })
        }
      }
    }
    let result
    try {
      // The call runs as the caller, marked with this run: what it saves shows on the slate as
      // this run's agent (server/presence/agentPresence.mjs).
      result = await registry.run({ ...ctx.principal, runId: ctx.execId }, action.id, given, runKey ? { idempotencyKey: runKey } : {})
    } catch (error) {
      const failure = error instanceof ActionError ? error : toActionError(error)
      // A refusal from inside an open slate (a selector that matched nothing, a conflict) can
      // still tell the script something about it.
      if (typeof given.shareId === 'string' && !NOT_OPENED.has(failure.status)) effects.readRank = await rankOf(given.shareId)
      return refuse(failure, { mode, meta: error?.meta, runKey })
    }
    const body = result.body
    if (JSON.stringify(body ?? null).length > limits.callOutputBytes)
      return refuse(problem(422, 'output_too_large', `${name} answered with more than ${limits.callOutputBytes} bytes.`), {
        mode,
        meta: result.meta,
        runKey,
      })
    if (action.id === 'slates.applyOperations') {
      const counts = savedCounts(body)
      effects.operations = counts.operations
      effects.notesCreated = counts.notes
      if (mode === 'save' && rewrites) effects.rewritten = { shareId: given.shareId, count: rewrites }
    }
    // Every call that names a slate reads it: a read returns its content, and a write (saved or
    // previewed) answers with the notes its selectors matched, so either can carry content out.
    if (typeof given.shareId === 'string') effects.readRank = await rankOf(given.shareId)
    return finish({ ok: true, status: result.status, body, meta: result.meta, mode, runKey, given, method: name })
  }

  // The refusal registry.run would answer for who calls and what they ask, or null. Only a
  // registry that can say (registry.admits) is asked; the call itself still runs every check.
  function refusedBeforeHold(principal, action, input) {
    if (typeof registry.admits !== 'function') return null
    try {
      registry.admits(principal, action.id, input)
      return null
    } catch (error) {
      return error instanceof ActionError ? error : toActionError(error)
    }
  }

  async function holdId(ctx) {
    if (ctx.held?.id) return ctx.held.id
    if (ctx.local) return store.heldIdFor(ctx.execId, newConfirmationId())
    return newConfirmationId()
  }

  function apply(ctx, outcome) {
    const { effects } = outcome
    ctx.counters.operations += effects.operations
    ctx.counters.notesCreated += effects.notesCreated
    if (effects.rewritten) ctx.counters.rewrittenText += effects.rewritten.count
    if (effects.readRank !== null)
      ctx.minReadRank = ctx.minReadRank === null ? effects.readRank : Math.min(ctx.minReadRank, effects.readRank)
    if (effects.held) {
      ctx.held ||= { id: effects.held.id, expiresAt: effects.held.expiresAt, reasons: [] }
      ctx.held.reasons.push(...effects.held.reasons)
    }
    ctx.calls.push(outcome.record)
    // The writes that went through, with their exact inputs: the in-app conversation keeps
    // what it previewed by sending these again in save mode.
    if (outcome.ok && outcome.mode) ctx.writes.push({ n: outcome.record.n, method: outcome.method, input: outcome.given, mode: outcome.mode, body: outcome.body })
  }

  // A sealed run's call: state lives in ctx.
  async function call(ctx, request) {
    ctx.counters.calls += 1
    return serial(ctx, async () => {
      const outcome = await step(ctx, request)
      apply(ctx, outcome)
      return outcome.ok ? { ok: true, value: outcome.body } : errorEnvelope(outcome.failure)
    })
  }

  // A local run's calls arrive as separate requests, possibly at once and possibly on different
  // app processes. Each takes the run's turn here (in process) and its lock in the store (across
  // processes) before it reads the run's record, and gives both back after recording its effects.
  async function localTurn(execId, task) {
    const previous = localTurns.get(execId) || Promise.resolve()
    let release
    const mine = new Promise((resolve) => (release = resolve))
    const chained = previous.then(() => mine)
    localTurns.set(execId, chained)
    await previous
    const key = `exec-run:${execId}`
    const holder = randomUUID()
    try {
      const deadline = now() + limits.wallMs
      for (let wait = 5; !(await store.lock(key, holder, limits.wallMs)); wait = Math.min(wait * 2, 100)) {
        if (now() > deadline)
          throw problem(429, 'exec_busy', 'Another call of this run is still being decided. Retry shortly.', { retryAfter: 1 })
        await pause(wait)
      }
      try {
        return await task()
      } finally {
        await store.unlock(key, holder).catch(() => {})
      }
    } finally {
      release()
      if (localTurns.get(execId) === chained) localTurns.delete(execId)
    }
  }

  function readExecHeaders(exec) {
    const bad = (what) => problem(400, 'invalid_request', `The ${what} header is missing or malformed.`)
    const execId = String(exec.id || '').toLowerCase()
    if (!EXEC_ID.test(execId)) throw bad('Slatebox-Exec-Id')
    if (!KEY.test(exec.key || '')) throw bad('Slatebox-Exec-Key')
    const n = Number(exec.call)
    if (!/^[1-9][0-9]{0,5}$/.test(exec.call || '') || !Number.isSafeInteger(n)) throw bad('Slatebox-Exec-Call')
    const codeSha256 = String(exec.codeSha256 || '').toLowerCase()
    if (!SHA.test(codeSha256)) throw bad('Slatebox-Exec-Code-Sha256')
    if (!['save', 'preview'].includes(exec.mode)) throw bad('Slatebox-Exec-Mode')
    let intent
    try {
      intent = decodeURIComponent(exec.intent || '')
    } catch {
      throw bad('Slatebox-Exec-Intent')
    }
    if (!intent || intent.length > 200) throw bad('Slatebox-Exec-Intent')
    if (exec.confirm !== undefined && !CONFIRM.test(exec.confirm)) throw bad('Slatebox-Exec-Confirm')
    return { execId, execKey: exec.key, n, codeSha256, mode: exec.mode, intent, confirm: exec.confirm }
  }

  // A local script's call, arriving over HTTP with Slatebox-Exec-* headers. Answers the way
  // registry.run does (a result, or a thrown ActionError), so the HTTP layer is unchanged.
  async function httpCall(principal, actionId, input, { idempotencyKey, exec }) {
    if (idempotencyKey !== undefined)
      throw problem(400, 'invalid_request', 'Send no Idempotency-Key with exec headers: keys inside a script are derived.')
    if (principal?.kind !== 'agent') throw problem(401, 'unauthorized', 'A valid Slatebox API token is required.')
    const h = readExecHeaders(exec)
    const method = byAction.get(actionId)
    if (!method) throw problem(404, 'unknown_method', 'This route is not part of the exec client.')
    return localTurn(h.execId, () => localStep(principal, method, input, h))
  }

  async function localStep(principal, method, input, h) {
    const subject = principal.tokenId || principal.userId
    const record = await store.claimLocalCall(h.execId, subject, {
      userId: principal.userId,
      tokenId: principal.tokenId,
      tokenName: principal.tokenName,
      surface: 'local',
      intent: h.intent,
      codeSha256: h.codeSha256,
      mode: h.mode,
      execKeySha256: sha256(h.execKey),
      confirmId: h.confirm || null,
    })
    if (
      record.codeSha256 !== h.codeSha256 ||
      record.mode !== h.mode ||
      record.execKeySha256 !== sha256(h.execKey) ||
      (record.confirmId || null) !== (h.confirm || null)
    )
      throw problem(400, 'invalid_request', 'The exec headers changed within one run. Start a new run.')
    let confirmation = null
    if (h.confirm) {
      const claimed = await store.claimConfirmation({ id: h.confirm, subject, codeSha256: h.codeSha256, execId: h.execId })
      confirmation = { id: h.confirm, fingerprints: claimed.fingerprints || [], used: new Set(record.confirmedUsed || []) }
    }
    const ctx = {
      ...newContext({
        execId: h.execId,
        principal,
        surface: 'local',
        mode: h.mode,
        execKey: h.execKey,
        codeSha256: h.codeSha256,
        intent: h.intent,
        confirmation,
      }),
      local: true,
      held: record.heldId ? { id: record.heldId, reasons: [] } : null,
    }
    ctx.counters = {
      calls: record.counters?.calls ?? 1,
      operations: record.counters?.operations ?? 0,
      notesCreated: record.counters?.notesCreated ?? 0,
      rewrittenText: record.counters?.rewrittenText ?? 0,
    }
    ctx.minReadRank = record.minReadRank ?? null
    const outcome = await step(ctx, { seq: h.n, method: method.name, input })
    await store.recordLocalCall(h.execId, {
      call: outcome.record,
      operations: outcome.effects.operations,
      notesCreated: outcome.effects.notesCreated,
      rewritten: outcome.effects.rewritten,
      readRank: outcome.effects.readRank,
      confirmedUsed: outcome.effects.confirmedUsed,
    })
    if (outcome.ok) return { status: outcome.status, body: outcome.body, meta: outcome.meta || {} }
    const failure = outcome.failure
    failure.meta = { ...(failure.meta || {}), ...(outcome.meta || {}) }
    throw failure
  }

  // An agent's API call that carries no exec headers (a plain REST call with an API token).
  // The same holds apply as for a script: a save that removes something, changes someone
  // else's notes, rewrites more text than the owner's rule allows, or widens access answers
  // 409 confirmation_required with a confirmation id. The caller shows the person the reasons
  // and, if they agree, sends the same request again with the Slatebox-Confirm header set to
  // that id (and the same Idempotency-Key). A person's own calls (the app, DDP) are not agents
  // and go straight through, as before.
  async function directCall(principal, actionId, input, { idempotencyKey, confirm } = {}) {
    const action = registry.get(actionId)
    const save = action?.kind === 'write' && (input?.mode === undefined || input.mode === 'save')
    // Only the calls a script could make are held here; exec.run gates its own script's calls.
    if (principal?.kind !== 'agent' || !save || !byAction.has(actionId) || !isPlain(input)) {
      if (confirm !== undefined)
        throw problem(400, 'invalid_request', 'Send Slatebox-Confirm only to save a change an agent was asked to confirm.')
      return registry.run(principal, actionId, input, { idempotencyKey })
    }
    if (confirm !== undefined && !CONFIRM.test(confirm)) throw problem(400, 'invalid_request', 'The Slatebox-Confirm header is malformed.')
    const subject = principal.tokenId || principal.userId
    // A key that already saved answers with its stored response, as it always has.
    if (idempotencyKey !== undefined && (await isReplay(subject, idempotencyKey)))
      return registry.run(principal, actionId, input, { idempotencyKey })
    const ctx = newContext({ execId: 'api', principal, surface: 'api', codeSha256: DIRECT_CODE, intent: 'API call' })
    if (refusedBeforeHold(principal, action, input)) return registry.run(principal, actionId, input, { idempotencyKey })
    const assessed = await assess(ctx, action, input)
    if (assessed.reasons.length) {
      const fingerprint = callFingerprint(actionId, assessed.fingerprintInput ?? input)
      if (confirm !== undefined) {
        // Single use: the first request that presents the id takes it.
        const claimed = await store.claimConfirmation({ id: confirm, subject, codeSha256: DIRECT_CODE, execId: 'api:' + confirm })
        if (claimed.usedAt || !(claimed.fingerprints || []).includes(fingerprint))
          throw problem(409, 'confirmation_invalid', 'That confirmation is used, or for a different change. Send the request again without Slatebox-Confirm.')
      } else {
        const id = newConfirmationId()
        const expiresAt = new Date(now() + limits.confirmMinutes * 60000)
        await store.addHeld(id, { subject, codeSha256: DIRECT_CODE, expiresAt }, fingerprint, assessed.reasons)
        throw problem(
          409,
          'confirmation_required',
          'This change needs the person to agree first. Show them the reasons; if they agree, send the same request again with the Slatebox-Confirm header set to confirmationId.',
          { details: { confirmationId: id, expiresAt: expiresAt.toISOString(), reasons: assessed.reasons } }
        )
      }
    } else if (confirm !== undefined) {
      throw problem(400, 'invalid_request', 'This change needs no confirmation. Send it without Slatebox-Confirm.')
    }
    return registry.run(principal, actionId, input, { idempotencyKey })
  }

  return { newContext, call, httpCall, directCall, assess, step, apply, methods }
}
