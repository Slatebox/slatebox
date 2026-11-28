// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One run, start to finish:
//   1 switches   server off, install off, the team's switch, the owner's "pause all my recipes",
//                the project's pause, the instance's state (a preview runs in draft too)
//   2 access     the owner still edits the project (and is still in its team), else blocked_access
//   3 sign-in    the vendor session, as the owner (SignInNeeded: needs_sign_in)
//   4 context    what the recipe sees (context.mjs), as recipePrincipal
//   5 the run    recipe.run(ctx) under the run's AbortSignal (10 minutes) → a DesiredSet
//   6 hooks      graph.ready and output.ready intercepts
//   7 slates     each desired slate made if missing (in the project, its folder), reconciled
//                (reconcile.mjs) and saved through slates.applyOperations as the recipe: saved
//                directly on its own slates once the owner chose auto, else suggestions; the
//                named cursor walks where it works (presence). A mapped slate (desired.slateId: one
//                a person put in the recipe's sync map, watchSlates) takes the recipe's own plans
//                as they are, saved directly on the revision the recipe read (a person mapping a
//                slate to a file is their say that the file's merged edits land on it), then its
//                notes (legend, conflicts) reconciled as on any slate
//   8 outside    proposed writes: a standing permission makes them, else an action card waits
//   9 finish     the status slate, webhooks (run.finished, slate.updated, diagram.changed, the
//                recipe's own), the activity log, queue.finish; then the project's recipes that run
//                after this one's events (recipe_event) on a slate it saved are queued
// Preview (mode preview) does 1–6 and reconciles in memory: nothing is saved anywhere.
import { budgetLimits, createBudget, BudgetExceeded } from './budgets.mjs'
import { createRecipeContext } from './context.mjs'
import { createRecipeAI } from './metering.mjs'
import { recipePrincipal, savesDirectly } from './principal.mjs'
import { isRetryable, logLine, RECIPE_LIMITS } from './queue.mjs'
import { reconcileBoard, reconcileSlate, matchNewItems, contentHash } from './reconcile.mjs'
import { touchedSince } from './ownership.mjs'
import { statusDesired, STATUS_ROLE } from './status-slate.mjs'
import { applyGraphPatch, applyOutputNotes, InterceptFailed } from './webhooks/intercept.mjs'

export const EDITOR_ROLES = Object.freeze(['editor', 'manager', 'owner'])
export const FIRST_RUN_DIRECT_ITEMS = 400

export class SignInNeeded extends Error {
  constructor(vendor) {
    super(`Sign in to ${vendor} again to keep this recipe running.`)
    this.name = 'SignInNeeded'
    this.code = 'sign_in_needed'
    this.vendor = vendor
  }
}
// A switch turned or access lost while the run was under way: it stops before it saves or changes
// anything outside Slatebox (stillAllowed, between the steps that do).
export class RunStopped extends Error {
  constructor(reason) {
    super('Recipes were paused or turned off while this run was under way.')
    this.name = 'RunStopped'
    this.code = reason
    this.reason = reason
  }
}
export class AccessLost extends Error {
  constructor(code = 'access_lost') {
    super('The person this recipe runs for no longer has access to its project.')
    this.name = 'AccessLost'
    this.code = code
  }
}

const roleKeyOf = (slate) => (slate.key ? `${slate.role}/${slate.key}` : slate.role)
const validDesired = (desired) => desired && Array.isArray(desired.slates)

/**
 * deps: { store, queue, clock, recipeOf(id) → { manifest, run }, projects (A.6), switches, vendors (Map),
 *         slates (the app side: read, waiting, events, apply, applyPreview, comment, paused, board,
 *         addBoard, boardEdits, mermaidHash), presence, permissions, outbound, intercepts,
 *         complete (the model call), withAI, audit, notify, firstName, quarantine, origin,
 *         budgetOverrides, limits }
 */
export function createRunner(deps) {
  const { store, queue, clock = Date.now, recipeOf, projects, switches, vendors = new Map(), slates, presence = null, permissions, outbound, intercepts = null, complete, withAI = (_i, fn) => fn(), audit = async () => {}, notify = async () => {}, firstName = async () => null, quarantine = (v) => v, origin = () => '', budgetOverrides = () => null, limits = RECIPE_LIMITS } = deps

  const emitSafe = (event) => outbound?.emit(event).catch(() => [])

  async function setInstance(instanceId, set) {
    await store.instances.updateOne({ _id: instanceId }, { $set: { ...set, updated: new Date(clock()) }, $inc: { rev: 1 } })
  }

  /** Stops an instance until a person acts (and says why, to its owner and to hooks). */
  async function stopInstance(instance, state, reason, run = null) {
    await setInstance(instance._id, { state, pausedReason: reason, pausedBy: null, nextDueAt: null, debounceUntil: null, pendingTrigger: null, slateSaves: [], savesDueAt: null })
    // A run of it under way stops too: its signal aborts at the next heartbeat (the run itself, when
    // it is the one stopping the instance, ends on its own).
    await store.runs.updateMany({ instanceId: instance._id, state: 'running', ...(run?._id && { _id: { $ne: run._id } }) }, { $set: { cancelRequested: true, cancelledBy: null } })
    await emitSafe({ type: 'recipe.paused', instance, run, data: { reason, by: null } })
    await audit({ action: 'recipe.paused', instance, details: { instanceId: instance._id, reason } })
    await notify(instance.ownerId, { code: `recipe_${reason}`, instanceId: instance._id, projectId: instance.projectId, text: `${instance.name} stopped: ${reasonText(reason)}` }).catch(() => {})
  }

  async function switchesSay(instance, run) {
    if (await switches.serverOff()) return 'kill_switch'
    if (!(await switches.installEnabled())) return 'kill_switch'
    if (instance.orgId && (await switches.orgRecipesOff(instance.orgId))) return 'kill_switch'
    if (await switches.ownerPaused(instance.ownerId)) return 'paused'
    if (await projects.isRecipesPaused(instance.projectId)) return 'paused'
    if (run.mode === 'preview' ? !['draft', 'active', 'paused'].includes(instance.state) : instance.state !== 'active') return 'paused'
    return null
  }

  async function checkAccess(instance) {
    const role = await projects.roleFor(instance.ownerId, instance.projectId)
    if (!EDITOR_ROLES.includes(role)) throw new AccessLost()
    if (instance.orgId && !(await switches.isMember(instance.ownerId, instance.orgId))) throw new AccessLost('left_team')
  }

  // Between the steps that change things (each slate, each write outside Slatebox): the switches
  // and the owner's access, read again, so a kill switch or a lost role stops a run already going.
  async function stillAllowed(instance, run) {
    if (run.mode === 'preview') return
    const fresh = (await store.instances.findOne({ _id: instance._id })) || { ...instance, state: 'deleted' }
    const skip = await switchesSay(fresh, run)
    if (skip) throw new RunStopped(skip)
    try {
      await checkAccess(fresh)
    } catch (error) {
      if (error instanceof AccessLost) throw new RunStopped('blocked_access')
      throw error
    }
  }

  async function openVendors(instance, manifest, signal, budget) {
    const out = {}
    const names = new Set([manifest.integration, ...Object.keys(manifest.needs || {})].filter(Boolean))
    for (const name of names) {
      const vendor = vendors.get(name)
      if (!vendor) throw new SignInNeeded(name)
      try {
        out[name] = await vendor.session(instance, { signal, budget })
      } catch (error) {
        if (error?.name === 'SignInNeeded' || error?.code === 'sign_in_needed' || error?.status === 401) throw new SignInNeeded(name)
        throw error
      }
    }
    return out
  }

  // The project's slates, read once per run (a mapped slate must be one of them).
  const listed = new WeakMap()
  async function projectSlates(instance) {
    if (!listed.has(instance)) listed.set(instance, projects.listSlates(instance.projectId, { folders: true }).catch(() => []))
    return listed.get(instance)
  }

  /** A slate of the project a recipe reads by its shareId (ctx.slates.read({ shareId })): what it
   * holds, its revision, and the recipe's own notes on it (metaNoteIds: its legend, its conflicts). */
  async function readProjectSlate(instance, { shareId } = {}) {
    if (typeof shareId !== 'string') return null
    const hit = (await projectSlates(instance)).find((s) => s.shareId === shareId)
    if (!hit) return null
    const read = await slates.read(hit._id)
    if (!read) return null
    const rows = await store.notes.find({ instanceId: instance._id, slateId: hit._id }).toArray()
    const name = read.name ?? hit.name ?? 'Untitled slate'
    return { slate: { ...read.slate, shareId, options: { ...(read.slate.options || {}), name } }, revision: read.revision, slateId: hit._id, shareId, name, metaNoteIds: rows.map((r) => r.noteId) }
  }

  /** The slate a mapped entry names, when it is in the project and in the instance's sync map; else null. */
  async function mappedTarget(instance, desired) {
    const hit = (await projectSlates(instance)).find((s) => s._id === desired.slateId)
    if (!hit || !(instance.watchSlates || []).includes(hit.shareId)) return null
    const read = await slates.read(hit._id)
    return read ? { slateId: hit._id, roleKey: roleKeyOf(desired), ...read, shareId: read.shareId || hit.shareId, made: false, mapped: true } : null
  }

  // The slate a desired entry lands on: a mapped slate (desired.slateId), the instance's own, else a
  // new one in the project (its folder).
  async function slateFor(instance, desired, { create }) {
    if (desired.slateId) return mappedTarget(instance, desired)
    const roleKey = roleKeyOf(desired)
    const known = instance.slateMap?.[roleKey]
    if (known) {
      const read = await slates.read(known)
      if (read) return { slateId: known, roleKey, ...read, made: true }
    }
    if (!create) return { slateId: null, roleKey, slate: { nodes: [] }, revision: 0, made: false }
    let parent = instance.projectId
    for (const name of desired.folder || []) parent = (await projects.ensureFolder(instance.ownerId, parent, String(name).slice(0, 120)))._id
    const made = await projects.createSlate(instance.ownerId, parent, { name: String(desired.name || 'Untitled').slice(0, 120), source: `recipe:${instance.recipeId}` })
    await store.instances.updateOne({ _id: instance._id }, { $set: { [`slateMap.${roleKey}`]: made.slateId } })
    instance.slateMap = { ...(instance.slateMap || {}), [roleKey]: made.slateId }
    const read = await slates.read(made.slateId)
    return { slateId: made.slateId, roleKey, ...(read || { slate: { nodes: [] }, revision: made.revision, shareId: made.shareId }), made: true, fresh: true }
  }

  async function ownedNotes(instanceId, slateId) {
    // notes and lines only: a board's cards and lanes are reconciled by applyBoard
    const rows = await store.notes.find({ instanceId, slateId, kind: { $in: ['note', 'connector'] } }).toArray()
    return new Map(rows.map((row) => [row.noteId, row]))
  }

  async function saveOwned(updates, removals, instanceId, slateId) {
    for (const row of updates) await store.notes.updateOne({ _id: row._id }, { $set: row }, { upsert: true })
    for (const id of removals) await store.notes.deleteOne({ _id: `${instanceId}:${slateId}:${id}` })
  }

  /**
   * One desired slate saved. → { slateId, shareId, stats, changes[], kept, revision } or null when it
   * could not be saved this run (the slate kept changing).
   */
  async function applySlate({ instance, manifest, run, principal, desired, gone, sourceLine, log, budget, revisionBySlate, statusSlate = false }) {
    let target = await slateFor(instance, desired, { create: true })
    if (!target) {
      log('warn', 'not_mapped', 'A slate the recipe keeps in step is no longer in this project or its sync map; it is left as it is.')
      return { slateId: desired.slateId, shareId: null, stats: null, changes: [], skipped: 'not_mapped', revision: null }
    }
    if (await slates.paused(target.slateId)) {
      log('warn', 'agents_paused', `${desired.name || target.name || 'A slate'}: people paused agents on it.`)
      return { slateId: target.slateId, shareId: target.shareId, stats: null, changes: [], skipped: 'agents_paused', revision: target.revision }
    }
    const principalFor = (direct) => ({ ...principal, direct })
    // A mapped slate first takes the recipe's own plans, on the revision the recipe read. A slate that
    // changed since is not guessed at: the run fails (retryable) before anything outside Slatebox,
    // and its cursor is not kept, so the next attempt reads the slate and the file again.
    const mappedChanges = []
    const mappedStats = { added: 0, updated: 0, removed: 0 }
    if (target.mapped && desired.plans?.length) {
      let revision = Number.isInteger(desired.expectedRevision) ? desired.expectedRevision : target.revision
      for (const plan of desired.plans) {
        budget.spend('ops', plan.operations?.length || 0)
        let saved
        try {
          saved = await slates.apply(principalFor(true), target.slateId, plan, revision, { runId: run._id })
        } catch (error) {
          if (error?.code === 'slate_changed') throw Object.assign(new Error('The slate changed while the recipe worked.'), { name: 'SlateChanged', code: 'slate_changed', status: 409 })
          throw error
        }
        if (saved.outcome === 'saved') revision = saved.revision
        mappedChanges.push({ slateId: target.slateId, operationRunId: saved.operationRunId || null, actionId: saved.actionId || null, outcome: saved.outcome })
        for (const op of plan.operations || []) {
          const n = Array.isArray(op.ids) ? op.ids.length : Number.isInteger(op.count) ? op.count : 1
          if (['add_nodes', 'connect_nodes'].includes(op.kind)) mappedStats.added += n
          else if (['delete_nodes', 'disconnect_nodes'].includes(op.kind)) mappedStats.removed += n
          else mappedStats.updated += 1
        }
      }
      target = { ...target, ...(await slates.read(target.slateId)) }
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const owned = await ownedNotes(instance._id, target.slateId)
      const before = new Map([...owned].map(([id, row]) => [id, { ...row }]))
      const since = instance.lastRun?.revisionBySlate?.[target.slateId] ?? (target.fresh || target.mapped ? target.revision : -1)
      const events = await slates.events(target.slateId, since)
      const touched = touchedSince(events, target.slateId, since, principal.tokenId)
      const waiting = await slates.waiting(target.slateId, principal)
      const pendingBefore = new Set([...owned.values()].filter((r) => r.pending).map((r) => r.noteId))
      const result = reconcileSlate({ desired, current: target.slate, owned, touched, waiting, gone, prefix: manifest.idPrefix, instanceId: instance._id, slateId: target.slateId, source: sourceLine, now: new Date(clock()) })
      const kept = result.ownedUpdates.filter((r) => pendingBefore.has(r.noteId) && r.pending === false && r.owner === 'recipe').length
      if (result.ops) budget.spend('ops', result.ops)
      // direct: the status slate always; the recipe's own slates once the owner chose auto; a first
      // build too large to review as suggestions is saved as one undoable action (the person saw it in Preview).
      const ownSlate = Object.values(instance.slateMap || {}).includes(target.slateId)
      const large = !instance.firstRunKept && ownSlate && result.ops > FIRST_RUN_DIRECT_ITEMS
      const direct = statusSlate || target.mapped || savesDirectly(instance, target.slateId) || large
      if (large) log('info', 'first_run_direct', `${desired.name}: ${result.ops} changes are saved as one action you can undo.`)
      let revision = target.revision
      const changes = [...mappedChanges]
      let conflict = false
      try {
        if (presence && result.plans.length && !statusSlate) await presence.plan(principalFor(direct), { _id: target.slateId, shareId: target.shareId }, [result.stats.added ? `Adding ${result.stats.added}` : 'Updating', 'Connecting', 'Done'].slice(0, 3)).catch(() => {})
        for (const plan of result.plans) {
          const saved = await slates.apply(principalFor(direct), target.slateId, plan, revision, { runId: run._id })
          if (saved.outcome === 'saved') revision = saved.revision
          changes.push({ slateId: target.slateId, operationRunId: saved.operationRunId || null, actionId: saved.actionId || null, outcome: saved.outcome })
        }
      } catch (error) {
        if (error?.code !== 'slate_changed' || changes.length > mappedChanges.length) throw error
        conflict = true
      }
      if (conflict) {
        if (attempt === 0) {
          log('info', 'slate_changed', `${desired.name} changed while the recipe worked; reading it again.`)
          target = { ...target, ...(await slates.read(target.slateId)) }
          continue
        }
        log('warn', 'slate_changed', `${desired.name} kept changing; it tries again next run.`)
        return null
      }
      const suggested = changes.some((c) => c.outcome === 'suggested')
      // Suggested, not saved: a new note's row waits (pending) until a person keeps it; a change to
      // one the recipe already keeps is not recorded, so a discarded suggestion is proposed again.
      const updates = []
      for (const row of result.ownedUpdates) {
        const prev = before.get(row.noteId)
        if (!prev) updates.push(suggested ? { ...row, pending: true } : row)
        else if (prev.owner !== row.owner || Boolean(prev.pending) !== Boolean(row.pending) || Boolean(prev.gone) !== Boolean(row.gone)) updates.push(suggested ? { ...row, hash: prev.hash } : row)
        else if (!suggested) updates.push(row)
      }
      await saveOwned(updates, suggested ? result.ownedRemovals.filter((id) => !before.has(id) || before.get(id).pending) : result.ownedRemovals, instance._id, target.slateId)
      for (const comment of result.comments) await slates.comment(principal, target.slateId, comment.noteId, comment.text).catch(() => log('warn', 'comment_failed', 'A removal comment could not be added.'))
      // boards on the slate (team boards, timelines)
      const boardStats = { added: 0, updated: 0, removed: 0, keptByPerson: 0 }
      for (const board of desired.boards || []) {
        const done = await applyBoard({ instance, principal: principalFor(direct), slateId: target.slateId, board, log })
        for (const key of Object.keys(boardStats)) boardStats[key] += done?.[key] || 0
      }
      revisionBySlate[target.slateId] = revision
      const stats = { ...result.stats }
      for (const key of Object.keys(mappedStats)) stats[key] = (stats[key] || 0) + mappedStats[key]
      for (const key of Object.keys(boardStats)) stats[key] = (stats[key] || 0) + boardStats[key]
      return { slateId: target.slateId, shareId: target.shareId, stats, changes, kept, revision, roleKey: target.roleKey, name: desired.name }
    }
    return null
  }

  /**
   * The recipe's own boards on one of its slates, as they stand: [{ key, cards: [{ key, lane, owner,
   * label }] }] by the recipe's keys (a card a person moved is owner 'person', in the lane they put it).
   * Cards and lanes the recipe does not keep are left out. null when the slate is not made yet.
   */
  async function boardStateOf(instance, role, key = '') {
    const slateId = instance.slateMap?.[key ? `${role}/${key}` : role]
    if (!slateId || !slates.board) return null
    const rows = await store.notes.find({ instanceId: instance._id, slateId, kind: { $in: ['board', 'card', 'lane'] } }).toArray()
    const out = []
    for (const row of rows.filter((r) => r.kind === 'board')) {
      const current = await slates.board(slateId, row.key, instance._id)
      if (!current) continue
      const mineOn = (kind, id) => rows.find((r) => r.kind === kind && r.noteId === id && r.boardKey === row.key)
      const laneKeyOf = (id) => mineOn('lane', id)?.key?.replace(/^lane:/, '') ?? null
      const cards = []
      for (const card of current.cards || []) {
        const mine = mineOn('card', card.id)
        if (mine && !mine.gone) cards.push({ key: mine.key.replace(/^card:/, ''), lane: laneKeyOf(card.laneId), owner: mine.owner, label: card.label })
      }
      out.push({ key: row.key.replace(/^board:/, ''), cards })
    }
    return out
  }

  async function applyBoard({ instance, principal, slateId, board, log }) {
    const boardKey = `board:${board.key}`
    let current = await slates.board(slateId, boardKey, instance._id)
    if (!current) {
      await slates.addBoard(principal, slateId, { key: boardKey, component: board.component, title: board.title, instanceId: instance._id })
      current = await slates.board(slateId, boardKey, instance._id)
      if (!current) {
        log('warn', 'board_missing', `The ${board.title} board could not be added.`)
        return null
      }
    }
    const rows = await store.notes.find({ instanceId: instance._id, slateId, kind: { $in: ['card', 'lane'] }, boardKey }).toArray()
    const owned = new Map(rows.map((r) => [r.noteId, r]))
    const since = instance.lastRun?.revisionBySlate?.[slateId] ?? -1
    const touched = touchedSince(await slates.events(slateId, since), slateId, since, principal.tokenId)
    const result = reconcileBoard({ desired: board, current, owned, touched, instanceId: instance._id, slateId, now: new Date(clock()) })
    const updates = result.ownedUpdates.map((r) => ({ ...r, boardKey }))
    if (result.edits.length) {
      for (let start = 0; start < result.edits.length; start += 50) {
        const part = result.edits.slice(start, start + 50)
        await slates.boardEdits(principal, slateId, current.boardId, part.map(({ key: _key, ...edit }) => edit))
      }
      const after = await slates.board(slateId, boardKey, instance._id)
      for (const made of matchNewItems(result.edits, current, after || current)) {
        updates.push({ _id: `${instance._id}:${slateId}:${made.id}`, instanceId: instance._id, slateId, noteId: made.id, key: made.key, kind: made.kind, owner: 'recipe', personProps: [], hash: contentHash(made.key), gone: false, pending: false, updated: new Date(clock()), boardKey })
      }
    }
    await saveOwned(updates, result.ownedRemovals, instance._id, slateId)
    return result.stats
  }

  /**
   * Runs one claimed run to its end and records it (queue.finish). Never throws: a failure is the
   * run's outcome. → { state, preview?, result }
   */
  async function runOne({ run, instance }) {
    const started = clock()
    const log = []
    const say = (level, code, msg) => {
      if (log.length < limits.logLines) log.push(logLine(clock(), level, code, msg))
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(Object.assign(new Error('The run took longer than 10 minutes.'), { code: 'timeout' })), limits.runMs)
    const beat = setInterval(() => {
      queue.heartbeat(run._id).then((ok) => {
        if (!ok) controller.abort(Object.assign(new Error('The run was cancelled.'), { code: 'cancelled' }))
      }).catch(() => {})
    }, limits.heartbeatMs)
    const entry = recipeOf(instance.recipeId)
    const finish = (outcome) => queue.finish(run._id, outcome)
    try {
      if (!entry) {
        await stopInstance(instance, 'paused', 'unknown_recipe', run)
        return { state: (await finish({ state: 'skipped', skippedReason: 'paused', log: [logLine(clock(), 'warn', 'unknown_recipe', 'This server does not carry that recipe.')] })).state }
      }
      const { manifest } = entry
      const skip = await switchesSay(instance, run)
      if (skip) return { state: (await finish({ state: 'skipped', skippedReason: skip, log: [logLine(clock(), 'info', skip, 'Recipes are paused or off here.')] })).state }
      try {
        await checkAccess(instance)
      } catch (error) {
        if (!(error instanceof AccessLost)) throw error
        if (run.mode !== 'preview') await stopInstance(instance, 'blocked_access', 'access', run)
        return { state: (await finish({ state: 'skipped', skippedReason: 'blocked_access', log: [logLine(clock(), 'warn', error.code, error.message)] })).state }
      }
      const outcome = await withAI(instance, () => execute({ run, instance, manifest, recipe: entry, signal: controller.signal, say, log }))
      if (run.mode === 'preview') {
        await finish({ state: outcome.state, stats: outcome.stats, log, skippedReason: outcome.skippedReason || null })
        return { state: outcome.state, preview: outcome.preview }
      }
      const finished = await finish({ state: outcome.state, stats: outcome.stats, changes: outcome.changes, writes: outcome.writes, log, skippedReason: outcome.skippedReason || null, revisionBySlate: outcome.revisionBySlate, cursor: outcome.cursor })
      await afterRun({ instance, manifest, run, outcome, finished, startedAt: started })
      return { state: finished.state, result: outcome }
    } catch (error) {
      const aborted = controller.signal.aborted
      const reasonCode = aborted ? controller.signal.reason?.code || 'timeout' : null
      const err = aborted ? { name: 'Error', status: null, code: reasonCode } : error
      if (error instanceof SignInNeeded && run.mode !== 'preview') await stopInstance(instance, 'needs_sign_in', 'sign_in', run)
      if (error?.name === 'GrantRevoked' && run.mode !== 'preview') await stopInstance(instance, 'paused', 'grant_revoked', run)
      if (error instanceof RunStopped) {
        if (error.reason === 'blocked_access') await stopInstance(instance, 'blocked_access', 'access', run)
        const done = await finish({ state: 'skipped', skippedReason: error.reason, log: [...log, logLine(clock(), 'warn', error.reason, error.message)] })
        return { state: done.state }
      }
      if (error instanceof InterceptFailed) {
        const done = await finish({ state: 'skipped', skippedReason: 'hook_failed', log: [...log, logLine(clock(), 'warn', 'hook_failed', error.message)] })
        return { state: done.state }
      }
      // The server log keeps where an unexpected failure came from (a stack: code paths, never content).
      if (!aborted && !(error instanceof SignInNeeded) && !Number.isInteger(error?.status)) deps.onUnexpected?.(error, { runId: run._id, recipeId: instance.recipeId })
      say('error', err?.code || 'failed', error instanceof SignInNeeded ? error.message : aborted ? (reasonCode === 'cancelled' ? 'The run was cancelled.' : 'The run took longer than 10 minutes.') : 'The run failed.')
      const retryable = run.mode !== 'preview' && !(error instanceof SignInNeeded) && reasonCode !== 'cancelled' && (aborted || isRetryable(error))
      const finished = await finish({ state: reasonCode === 'cancelled' ? 'cancelled' : 'failed', log, error: err, retryable })
      if (finished.paused) {
        await emitSafe({ type: 'recipe.paused', instance, run, data: { reason: 'failures', by: null } })
        await audit({ action: 'recipe.paused', instance, details: { instanceId: instance._id, reason: 'failures' } })
        await notify(instance.ownerId, { code: 'recipe_failures', instanceId: instance._id, projectId: instance.projectId, text: `${instance.name} stopped after 3 failed runs in a row.` }).catch(() => {})
      }
      if (finished.state === 'failed') await emitSafe({ type: 'run.failed', instance, run, data: { name: String(err?.name || 'Error').slice(0, 60), status: Number.isInteger(err?.status) ? err.status : null, code: String(err?.code || 'failed').slice(0, 60) } })
      return { state: finished.state, error: err }
    } finally {
      clearTimeout(timer)
      clearInterval(beat)
      if (presence?.end) await presence.end(run._id, 'done').catch(() => {})
    }
  }

  async function execute({ run, instance, manifest, recipe, signal, say, log }) {
    const budget = createBudget(budgetLimits(manifest.cost.class, budgetOverrides()))
    let partial = null
    const principal = recipePrincipal(instance, run._id, manifest)
    const vendorSessions = await openVendors(instance, manifest, signal, budget)
    const ai = createRecipeAI({ instance, recipeId: manifest.id, budget, complete, signal, onRefused: (code) => { partial = partial || (code === 'budget' ? 'budget' : 'ai_refused') }, log: say })
    const { ctx, log: recipeLog, emitted, cursor, cursorChanged } = createRecipeContext({
      instance, run, manifest, signal, clock, budget, vendors: vendorSessions, ai, store, quarantine,
      readSlate: async (role, key = '') => {
        if (role && typeof role === 'object') return readProjectSlate(instance, role)
        const id = instance.slateMap?.[key ? `${role}/${key}` : role]
        return id ? slates.read(id) : null
      },
      mermaid: (slateId, options) => slates.mermaid?.(slateId, options) ?? null,
      boardState: (role, key = '') => boardStateOf(instance, role, key),
      project: {
        listSlates: async ({ folders = true } = {}) => (await projects.listSlates(instance.projectId, { folders })).map(({ _id, shareId, name, lastSaved, projectId }) => ({ _id, shareId, name, lastSaved, projectId, url: `${origin()}/canvas/${shareId}` })),
        recipes: async () => (await store.instances.find({ projectId: instance.projectId }, { limit: 100 }).toArray()).map((r) => ({ id: r._id, name: r.name, agentName: recipeOf(r.recipeId)?.manifest?.agentName || r.name, slateMap: r.slateMap || {} })),
      },
    })
    let answer
    try {
      answer = await abortable(Promise.resolve().then(() => recipe.run(ctx)), signal)
    } catch (error) {
      if (!(error instanceof BudgetExceeded)) throw error
      throw Object.assign(new Error('The recipe used its budget before it had anything to show.'), { name: 'BudgetExceeded', code: 'budget' })
    } finally {
      log.push(...recipeLog.slice(0, Math.max(0, limits.logLines - log.length)))
    }
    let desired = answer?.desired
    if (!validDesired(desired)) throw Object.assign(new Error('The recipe answered no desired slates.'), { name: 'RecipeAnswer', code: 'bad_answer' })
    if (desired.partial) partial = partial || 'budget'
    desired = { ...desired, slates: desired.slates.filter((s) => s.role !== STATUS_ROLE && manifest.outputs.some((o) => o.role === s.role)) }
    if (intercepts && manifest.intercepts.includes('graph.ready')) {
      const patch = await intercepts.call('graph.ready', { instance, run, data: { slates: desired.slates.map((s) => ({ role: s.role, key: s.key, nodes: s.graph?.nodes.length || 0, edges: s.graph?.edges.length || 0 })) }, signal })
      if (patch) desired = applyGraphPatch(desired, patch)
    }
    if (intercepts && manifest.intercepts.includes('output.ready')) {
      const notes = await intercepts.call('output.ready', { instance, run, data: { slates: desired.slates.map((s) => ({ role: s.role, key: s.key })) }, signal })
      if (notes) desired = applyOutputNotes(desired, notes)
    }
    const stats = { vendorCalls: 0, tokensIn: 0, tokensOut: 0, ops: 0, added: 0, updated: 0, removed: 0, keptByPerson: 0, slatesChanged: [] }
    const finalize = (extra) => Object.assign(stats, budget.used, extra)

    if (run.mode === 'preview') {
      const preview = []
      for (const entryDesired of desired.slates) {
        const target = await slateFor(instance, entryDesired, { create: false })
        if (!target) continue
        let slate = target.slate
        for (const plan of target.mapped ? entryDesired.plans || [] : []) slate = slates.applyPreview(slate, plan)
        const owned = target.slateId ? await ownedNotes(instance._id, target.slateId) : new Map()
        const result = reconcileSlate({ desired: entryDesired, current: slate, owned, prefix: manifest.idPrefix, instanceId: instance._id, slateId: target.slateId || 'preview', now: new Date(clock()) })
        for (const plan of result.plans) slate = slates.applyPreview(slate, plan)
        preview.push({ role: entryDesired.role, key: entryDesired.key || '', name: entryDesired.name, slate, counts: result.stats })
        for (const key of ['added', 'updated', 'removed', 'keptByPerson']) stats[key] += result.stats[key]
      }
      finalize({})
      return { state: partial ? 'partial' : 'done', stats, preview, skippedReason: null }
    }

    // Links a recipe names as { url } or { slate: { role, key } } (one of its own slates) become the
    // address a note carries. A slate made later in this run is linked on the next run.
    const shareIdOf = new Map()
    const linkOf = async (link) => {
      if (!link || typeof link === 'string') return link || null
      if (typeof link.url === 'string') return link.url
      if (link.slate?.role) {
        const slateId = instance.slateMap?.[link.slate.key ? `${link.slate.role}/${link.slate.key}` : link.slate.role]
        if (!slateId) return null
        if (!shareIdOf.has(slateId)) shareIdOf.set(slateId, (await slates.read(slateId))?.shareId || null)
        return shareIdOf.get(slateId) ? `${origin()}/canvas/${shareIdOf.get(slateId)}` : null
      }
      return null
    }
    const withLinks = async (items) => Promise.all((items || []).map(async (item) => (item?.link !== undefined ? { ...item, link: await linkOf(item.link) } : item)))
    desired = {
      ...desired,
      slates: await Promise.all(desired.slates.map(async (d) => ({
        ...d,
        ...(d.graph && { graph: { ...d.graph, nodes: await withLinks(d.graph.nodes) } }),
        ...(d.notes && { notes: await withLinks(d.notes) }),
        ...(d.boards && { boards: await Promise.all(d.boards.map(async (b) => ({ ...b, cards: await withLinks(b.cards) }))) }),
      }))),
    }

    // A mapped slate with plans that cannot take them (agents paused on it): nothing is saved or sent
    // and the cursor stays, so the import is read again on a run after people resume agents there.
    for (const entryDesired of desired.slates) {
      if (!entryDesired.slateId || !entryDesired.plans?.length) continue
      const target = await mappedTarget(instance, entryDesired)
      if (target && (await slates.paused(target.slateId))) {
        say('warn', 'agents_paused', `${target.name || 'A synced slate'}: people paused agents on it, so the file's changes wait.`)
        finalize({})
        return { state: 'skipped', stats, changes: [], writes: [], changed: [], emitted: [], revisionBySlate: instance.lastRun?.revisionBySlate || {}, cursor: undefined, skippedReason: 'agents_paused', summary: '' }
      }
    }
    const revisionBySlate = { ...(instance.lastRun?.revisionBySlate || {}) }
    const changes = []
    const changed = []
    let keptAny = 0
    let skippedSlate = false
    const sourceLine = String(answer.source || answer.summary || manifest.label).slice(0, 80)
    for (const entryDesired of desired.slates) {
      if (signal.aborted) throw signal.reason
      await stillAllowed(instance, run)
      const roleKey = roleKeyOf(entryDesired)
      const done = await applySlate({ instance, manifest, run, principal, desired: entryDesired, gone: desired.gone?.[roleKey] || null, sourceLine, log: say, budget, revisionBySlate })
      if (!done) {
        skippedSlate = true
        continue
      }
      changes.push(...done.changes)
      keptAny += done.kept || 0
      if (done.stats) {
        for (const key of ['added', 'updated', 'removed', 'keptByPerson']) stats[key] += done.stats[key] || 0
        if ((done.stats.added || 0) + (done.stats.updated || 0) + (done.stats.removed || 0) > 0) {
          stats.slatesChanged.push(done.slateId)
          changed.push(done)
        }
      }
    }
    // The owner kept the first run's suggestions: "Apply future updates automatically" is offered.
    if (keptAny && !instance.firstRunKept) {
      await setInstance(instance._id, { firstRunKept: true })
      instance.firstRunKept = true
    }
    // Outside Slatebox.
    const writes = []
    for (const write of (answer.writes || []).slice(0, 20)) {
      if (signal.aborted) throw signal.reason
      await stillAllowed(instance, run)
      const intercept = intercepts
        ? (w) => intercepts.call('writeback.proposed', { instance, run, data: { kind: w.kind, target: w.target, decision: w.decision }, signal })
        : null
      writes.push(await permissions.perform(instance, write, run, { signal, intercept }))
    }
    finalize({})
    const state = partial ? 'partial' : skippedSlate && !changes.length ? 'skipped' : 'done'
    return {
      state, stats, changes, writes, changed, emitted, revisionBySlate,
      cursor: cursorChanged() ? cursor() : undefined,
      skippedReason: state === 'skipped' ? 'slate_changed' : null,
      summary: String(answer.summary || '').slice(0, 200),
    }
  }

  // After the run is recorded: the status slate, the webhooks and the activity log.
  async function afterRun({ instance, manifest, run, outcome, finished }) {
    const fresh = (await store.instances.findOne({ _id: instance._id })) || instance
    const lastRun = await store.runs.findOne({ _id: run._id })
    try {
      const slateRows = []
      for (const [roleKey, slateId] of Object.entries(fresh.slateMap || {})) {
        if (roleKey === STATUS_ROLE) continue
        const read = await slates.read(slateId)
        if (read) slateRows.push({ name: read.name || roleKey, shareId: read.shareId })
      }
      const cards = await store.cards.find({ instanceId: instance._id, state: 'waiting' }, { limit: 20 }).toArray()
      const desired = statusDesired({ instance: fresh, manifest, ownerFirstName: await firstName(instance.ownerId), lastRun, slates: slateRows, cards, origin: origin(), tz: fresh.triggers?.find((t) => t.tz)?.tz || 'UTC' })
      const budget = createBudget({ vendorCalls: 0, tokensIn: 0, tokensOut: 0, ops: 2000 })
      await applySlate({ instance: fresh, manifest, run, principal: recipePrincipal(fresh, run._id, manifest), desired, gone: null, sourceLine: 'the recipe', log: () => {}, budget, revisionBySlate: {}, statusSlate: true })
    } catch {
      // the status slate is a courtesy: a run's result stands without it
    }
    await emitSafe({ type: 'run.finished', instance, run, data: { state: finished.state, durationMs: Math.max(0, clock() - new Date(lastRun?.startedAt || clock()).getTime()), stats: pickStats(outcome.stats), slatesChanged: outcome.stats.slatesChanged } })
    for (const done of outcome.changed || []) {
      await emitSafe({ type: 'slate.updated', instance, run, data: { slateId: done.slateId, shareId: done.shareId, url: `${origin()}/canvas/${done.shareId}`, added: done.stats.added || 0, updated: done.stats.updated || 0, removed: done.stats.removed || 0 } })
      if (slates.mermaidHash) {
        const after = await slates.mermaidHash(done.slateId).catch(() => null)
        if (after) await emitSafe({ type: 'diagram.changed', instance, run, data: { slateId: done.slateId, shareId: done.shareId, before: instance.lastRun?.mermaidBySlate?.[done.slateId] ?? null, after, mermaidUrl: `${origin()}/slates/${done.shareId}.mmd` } })
      }
    }
    for (const event of outcome.emitted || []) await emitSafe({ type: event.type, instance, run, data: event.data, manifest })
    await audit({ action: 'recipe.run', instance, coalesce: true, details: { instanceId: instance._id, recipeId: instance.recipeId, runId: run._id, outcome: finished.state, count: outcome.stats.slatesChanged.length } })
    await afterEvents({ instance, run, outcome }).catch(() => {})
  }

  // The project's recipes that run after this one's events (recipe_event), on a slate this run saved
  // that is in their sync map: one run each, at once, named after this run (so never twice).
  async function afterEvents({ instance, run, outcome }) {
    const types = new Set((outcome.emitted || []).map((e) => e.type))
    const saved = (outcome.changed || []).filter((c) => c.shareId && (c.changes || []).some((x) => x.outcome === 'saved')).map((c) => c.shareId)
    if (!types.size || !saved.length) return
    const rows = await store.instances.find({ projectId: instance.projectId, state: 'active', watchSlates: { $in: saved } }, { limit: 50 }).toArray()
    for (const other of rows) {
      if (other._id === instance._id) continue
      const spec = (other.triggers || []).find((t) => t.kind === 'recipe_event' && types.has(t.event))
      if (!spec) continue
      const shareIds = saved.filter((id) => (other.watchSlates || []).includes(id))
      await queue.enqueue(other, { kind: 'recipe_event', event: spec.event, from: instance._id, fromRun: run._id, shareIds }, { id: `${other._id}:re:${run._id}` })
    }
  }

  return { runOne, execute, applySlate, stopInstance }
}

const pickStats = (s = {}) => ({ vendorCalls: s.vendorCalls || 0, tokensIn: s.tokensIn || 0, tokensOut: s.tokensOut || 0, ops: s.ops || 0, added: s.added || 0, updated: s.updated || 0, removed: s.removed || 0, keptByPerson: s.keptByPerson || 0 })

function abortable(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then((value) => {
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }, (error) => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
  })
}

function reasonText(reason) {
  return {
    access: 'the person it runs for no longer has access to the project. A manager can take it over.',
    sign_in: 'sign in to the integration again, then resume it.',
    failures: 'it failed 3 times in a row.',
    grant_revoked: 'a permission it used was taken back.',
    admin: 'an administrator paused every recipe on this server.',
    unknown_recipe: 'this server does not carry that recipe.',
    uninstalled: 'the app was removed from the integration.',
    permissions_changed: 'the integration\'s permissions changed.',
  }[reason] || 'it was paused.'
}
