// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// What people and their agents can do with recipes, with every permission checked here (the
// actions in actions.mjs are thin). Who may do what, by their role in the recipe's project
// (projects.roleFor) and whose the recipe is:
//   read (list, get, runs, deliveries, notes on a slate)   anyone who can see the project
//   run now, preview                                       editors of the project
//   create                                                 editors (the recipe runs for them)
//   change its config, triggers, auto apply; turn it on;
//   grant or revoke permissions; approve outside changes   the person it runs for
//   pause, resume, delete, webhooks                        the person it runs for, or a manager
//   take over                                              a manager (the recipe then runs for them)
// The switches, widest first: the server's settings.recipes.off, the install switch (Admin ›
// Recipes; on by default on Slatebox Cloud, off on a self-hosted install until an admin turns it
// on), the team's switch, the owner's "pause all my recipes", the project's pause, the instance's.
import { validate } from '/server/actions/schema.mjs'
import { isValidCron, isValidTimeZone, shortestGapMinutes } from '../../common/recipes/cron.mjs'
import { defaultTriggers, MIN_SCHEDULE_MINUTES, publicManifest } from '../../common/recipes/manifest.mjs'
import { eventsFor } from '../../common/recipes/events.mjs'
import { RECIPES_OFF, RECIPES_OFF_TEAM, STATE_WORDS, runsFor } from '../../common/recipes/words.mjs'
import { nextDueFor, RECIPE_LIMITS } from './queue.mjs'
import { newSecret, ROTATION_OVERLAP_MS } from './webhooks/sign.mjs'
import { hostOf } from './webhooks/outbound.mjs'
import { makeMine } from './ownership.mjs'
import { pointerOf } from './webhooks/inbound.mjs'

export const ROLE_RANK = Object.freeze({ none: 0, viewer: 1, commenter: 2, editor: 3, manager: 4, owner: 5 })
export const HOOK_LIMITS = Object.freeze({ perScope: 10, urlChars: 2000 })
const PALETTE = 6

export class RecipeRefused extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'RecipeRefused'
    this.status = status
    this.code = code
    if (details) this.details = details
  }
}
const refuse = (status, code, message, details) => {
  throw new RecipeRefused(status, code, message, details)
}
const NOT_FOUND = 'That recipe is not there any more.'

/** A manifest's triggers as an instance keeps them, checked: kinds the recipe takes, a valid cron at most every 15 minutes, a known time zone. */
export function checkTriggers(manifest, triggers) {
  if (!Array.isArray(triggers) || !triggers.length || triggers.length > 8) refuse(400, 'bad_triggers', 'A recipe has 1 to 8 triggers.')
  return triggers.map((t, k) => {
    const offered = manifest.triggers.filter((m) => m.kind === t?.kind)
    if (!offered.length) refuse(400, 'bad_triggers', `This recipe does not run ${t?.kind === 'vendor' ? 'on that event' : `on ${t?.kind}`}.`, { field: `triggers[${k}]` })
    if (t.kind === 'schedule') {
      const tz = t.tz || 'UTC'
      if (!isValidCron(t.cron)) refuse(400, 'bad_cron', 'A schedule is five fields: minute hour day month weekday.', { field: `triggers[${k}].cron` })
      if (!isValidTimeZone(tz)) refuse(400, 'bad_time_zone', 'That time zone is not known.', { field: `triggers[${k}].tz` })
      if (shortestGapMinutes(t.cron, tz) < MIN_SCHEDULE_MINUTES) refuse(400, 'too_often', `A recipe runs at most every ${MIN_SCHEDULE_MINUTES} minutes.`, { field: `triggers[${k}].cron` })
      return { kind: 'schedule', cron: t.cron.trim().split(/\s+/).join(' '), tz }
    }
    if (t.kind === 'vendor') {
      const spec = offered.find((m) => m.event === t.event) || (t.event ? null : offered[0])
      if (!spec) refuse(400, 'bad_triggers', 'This recipe does not run on that event.', { field: `triggers[${k}].event` })
      const debounceMs = Number.isInteger(t.debounceMs) ? Math.max(0, Math.min(6 * 3600e3, t.debounceMs)) : spec.debounceMs ?? 0
      return { kind: 'vendor', event: spec.event, debounceMs }
    }
    return { kind: t.kind }
  })
}

/**
 * deps: {
 *   store, queue, runner, clock, randomId,
 *   recipeOf(id) → { manifest, run } | null, catalog() → manifests,
 *   projects (A.6), switches { serverOff, installEnabled, setInstallEnabled, orgRecipesOff, ownerPaused, isMember },
 *   permissions, outbound, sealer { seal(hookId, plain), open(hookId, sealed) }, checkHookUrl(url) (throws),
 *   slateIdFor(principal, shareId) → { slateId, canRead } | null, undo(principal, slateId, operationRunId),
 *   connected(userId, integration) → bool, firstName(userId), orgOf(projectId) → orgId | null,
 *   isServerAdmin(userId), audit(entry), notify(userId, message), via ('cloud'|'self-host'),
 *   resolveMatch(manifest, match, ownerId) → match (a vendor fills in what config does not say, such
 *     as the GitHub installation holding the picked repositories; refuses when there is none)
 * }
 */
export function createRecipeService(deps) {
  const { store, queue, runner, clock = Date.now, recipeOf, catalog, projects, switches, permissions, outbound, sealer, checkHookUrl = () => {}, slateIdFor, undo, connected = async () => false, firstName = async () => null, isServerAdmin = async () => false, audit = async () => {}, notify = async () => {} } = deps
  const newId = deps.randomId || (() => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10))
  const { instances, runs, hooks, deliveries, notes, grants, cards } = store
  const resolveMatch = deps.resolveMatch || (async (_manifest, match) => match)

  async function requireOn(orgId = null) {
    if ((await switches.serverOff()) || !(await switches.installEnabled())) refuse(409, 'recipes_off', RECIPES_OFF)
    if (orgId && (await switches.orgRecipesOff(orgId))) refuse(409, 'recipes_off', RECIPES_OFF_TEAM)
  }
  const rank = (role) => ROLE_RANK[role || 'none'] || 0
  async function roleIn(principal, projectId) {
    return projects.roleFor(principal.userId, projectId)
  }
  async function needRole(principal, projectId, least, doing) {
    const role = await roleIn(principal, projectId)
    if (!role) refuse(404, 'not_found', 'That project is not there, or it is not shared with you.')
    if (rank(role) < rank(least)) refuse(403, 'forbidden', `Only ${least === 'editor' ? 'editors' : least === 'manager' ? 'managers' : 'the owner'} of this project can ${doing}.`)
    return role
  }
  async function instanceFor(principal, instanceId, least = 'viewer', doing = 'see its recipes') {
    const instance = typeof instanceId === 'string' ? await instances.findOne({ _id: instanceId }) : null
    if (!instance) refuse(404, 'not_found', NOT_FOUND)
    const role = await roleIn(principal, instance.projectId)
    if (!role) refuse(404, 'not_found', NOT_FOUND)
    if (rank(role) < rank(least)) refuse(403, 'forbidden', `Only ${least === 'editor' ? 'editors' : 'managers'} of this project can ${doing}.`)
    return { instance, role }
  }
  const ownerOrManager = (principal, instance, role, doing) => {
    if (instance.ownerId !== principal.userId && rank(role) < rank('manager')) refuse(403, 'forbidden', `Only the person this recipe runs for, or a manager, can ${doing}.`)
  }
  const ownerOnly = (principal, instance, doing) => {
    if (instance.ownerId !== principal.userId) refuse(403, 'not_owner', `Only the person this recipe runs for can ${doing}.`)
  }
  const manifestOf = (recipeId) => recipeOf(recipeId)?.manifest || null
  const record = (action, instance, details = {}, extra = {}) => audit({ action, instance, details: { instanceId: instance._id, recipeId: instance.recipeId, ...details }, ...extra })

  async function publicInstance(instance, viewerId) {
    const manifest = manifestOf(instance.recipeId)
    const first = await firstName(instance.ownerId).catch(() => null)
    return {
      instanceId: instance._id, recipeId: instance.recipeId, projectId: instance.projectId, name: instance.name,
      agentName: manifest?.agentName || instance.recipeId, runsFor: runsFor(manifest?.agentName || instance.recipeId, first),
      state: instance.state, stateText: STATE_WORDS[instance.state] || instance.state, pausedReason: instance.pausedReason ?? null,
      applyMode: instance.applyMode, firstRunKept: Boolean(instance.firstRunKept), canAuto: Boolean(instance.firstRunKept),
      config: instance.config, triggers: instance.triggers,
      nextRunAt: instance.nextDueAt ? new Date(instance.nextDueAt).toISOString() : null,
      lastRun: instance.lastRun ? { at: new Date(instance.lastRun.at).toISOString(), runId: instance.lastRun.runId, outcome: instance.lastRun.outcome, changed: instance.lastRun.changed ?? 0 } : null,
      slates: Object.entries(instance.slateMap || {}).map(([role, slateId]) => ({ role, slateId })),
      colorIndex: instance.colorIndex ?? 0, mine: instance.ownerId === viewerId, created: new Date(instance.created).toISOString(),
    }
  }

  function checkConfig(manifest, config) {
    const invalid = validate(manifest.configSchema, config ?? {})
    if (invalid) refuse(400, 'bad_config', invalid.message, { pointer: pointerOf(invalid.path) })
    return config ?? {}
  }

  return {
    async catalog(principal) {
      const out = []
      for (const m of catalog()) out.push({ ...publicManifest(m), connected: m.integration ? Boolean(await connected(principal.userId, m.integration)) : true })
      return { recipes: out, on: !(await switches.serverOff()) && Boolean(await switches.installEnabled()) }
    },

    async list(principal, projectId) {
      await needRole(principal, projectId, 'viewer', 'see its recipes')
      const rows = await instances.find({ projectId }, { sort: { created: 1 }, limit: 100 }).toArray()
      return { recipes: await Promise.all(rows.map((row) => publicInstance(row, principal.userId))) }
    },

    async get(principal, instanceId) {
      const { instance, role } = await instanceFor(principal, instanceId)
      const managing = rank(role) >= rank('manager')
      const [live, hookRows, waiting] = await Promise.all([
        permissions.liveGrants(instance._id),
        hooks.find({ 'scope.instanceId': instance._id }).toArray(),
        cards.find({ instanceId: instance._id, state: 'waiting' }, { limit: 20 }).toArray(),
      ])
      return {
        recipe: await publicInstance(instance, principal.userId),
        permissions: live.map((g) => ({ grantId: g._id, kind: g.kind, scope: g.scope, describe: g.describe, grantedAt: new Date(g.grantedAt).toISOString(), expiresAt: g.expiresAt ? new Date(g.expiresAt).toISOString() : null })),
        hooks: hookRows.map((row) => publicHook(row, { full: managing || row.ownerId === principal.userId })),
        waiting: waiting.map((c) => ({ cardId: c._id, kind: c.kind, target: c.target, created: new Date(c.created).toISOString() })),
      }
    },

    async create(principal, projectId, { recipeId, config, triggers, name } = {}) {
      const entry = recipeOf(recipeId)
      if (!entry) refuse(404, 'unknown_recipe', 'There is no such recipe.')
      await needRole(principal, projectId, 'editor', 'add recipes')
      const project = await projects.get(projectId)
      await requireOn(project?.orgId ?? null)
      if ((await instances.countDocuments({ ownerId: principal.userId })) >= RECIPE_LIMITS.instancesPerOwner) refuse(409, 'too_many', `A person runs at most ${RECIPE_LIMITS.instancesPerOwner} recipes.`)
      const { manifest } = entry
      const checked = checkConfig(manifest, config)
      const now = new Date(clock())
      const doc = {
        _id: newId(), recipeId, recipeVersion: manifest.version, projectId, ownerId: principal.userId, orgId: project?.orgId ?? null,
        name: String(name || defaultName(manifest, checked)).replace(/\s+/g, ' ').trim().slice(0, 120),
        config: checked, triggers: triggers ? checkTriggers(manifest, triggers) : defaultTriggers(manifest),
        match: await resolveMatch(manifest, matchFor(manifest, checked), principal.userId), state: 'draft', pausedBy: null, pausedReason: null, applyMode: 'suggest', firstRunKept: false,
        nextDueAt: null, debounceUntil: null, pendingTrigger: null, lock: null, cursor: {}, slateMap: {}, failures: 0, lastRun: null,
        colorIndex: (await instances.countDocuments({ projectId })) % PALETTE, created: now, updated: now, rev: 0,
      }
      await instances.insertOne(doc)
      await record('recipe.created', doc)
      return { recipe: await publicInstance(doc, principal.userId) }
    },

    async update(principal, instanceId, { config, triggers, name, applyMode } = {}) {
      const { instance } = await instanceFor(principal, instanceId)
      ownerOnly(principal, instance, 'change it')
      const manifest = manifestOf(instance.recipeId)
      const set = {}
      if (config !== undefined) {
        set.config = checkConfig(manifest, config)
        set.match = await resolveMatch(manifest, matchFor(manifest, set.config), instance.ownerId)
      }
      if (triggers !== undefined) set.triggers = checkTriggers(manifest, triggers)
      if (name !== undefined) set.name = String(name).replace(/\s+/g, ' ').trim().slice(0, 120) || instance.name
      if (applyMode !== undefined) {
        if (applyMode === 'auto' && !instance.firstRunKept) refuse(409, 'keep_first_run', 'Keep the first run\'s suggestions first; then its updates can apply automatically.')
        set.applyMode = applyMode
      }
      if (instance.state === 'active' && set.triggers) set.nextDueAt = nextDueFor(set.triggers, clock())
      await instances.updateOne({ _id: instance._id }, { $set: { ...set, updated: new Date(clock()) }, $inc: { rev: 1 } })
      await record('recipe.updated', instance, { outcome: Object.keys(set).join(',').slice(0, 60) })
      return { recipe: await publicInstance({ ...instance, ...set }, principal.userId) }
    },

    /** The first run, in memory: what each slate would look like, its counts and token use. Nothing is saved. */
    async preview(principal, instanceId, { waitMs = 60000 } = {}) {
      const { instance } = await instanceFor(principal, instanceId, 'editor', 'preview recipes')
      await requireOn(instance.orgId)
      const now = new Date(clock())
      const run = { _id: `pv_${newId()}`, instanceId: instance._id, ownerId: instance.ownerId, recipeId: instance.recipeId, projectId: instance.projectId, trigger: { kind: 'manual', by: principal.userId, preview: true }, mode: 'preview', state: 'running', dueAt: now, attempts: 0, leaseUntil: new Date(clock() + RECIPE_LIMITS.leaseMs), worker: 'preview', created: now, startedAt: now, finishedAt: null, log: [], changes: [], writes: [] }
      await runs.insertOne(run)
      let timer
      const result = await Promise.race([
        runner.runOne({ run, instance }),
        new Promise((resolve) => { timer = setTimeout(() => resolve({ state: 'timeout' }), waitMs) }),
      ]).finally(() => clearTimeout(timer))
      if (result.state === 'timeout') refuse(504, 'preview_timeout', 'The preview took longer than a minute. Try again, or turn the recipe on and watch its first run.')
      const finished = await runs.findOne({ _id: run._id })
      if (result.state === 'failed') refuse(422, 'preview_failed', 'The preview failed. Check the recipe\'s settings and its integration.', { code: finished?.error?.code || 'failed' })
      if (result.state === 'skipped') refuse(409, finished?.skippedReason === 'blocked_access' ? 'forbidden' : 'recipes_paused', finished?.skippedReason === 'blocked_access' ? 'The recipe\'s owner cannot edit this project.' : 'Recipes are paused here.')
      return { runId: run._id, state: result.state, slates: result.preview || [], stats: finished?.stats || null, log: (finished?.log || []).map((l) => ({ level: l.level, code: l.code, msg: l.msg })) }
    },

    async activate(principal, instanceId) {
      const { instance } = await instanceFor(principal, instanceId)
      ownerOnly(principal, instance, 'turn it on')
      await requireOn(instance.orgId)
      if (!['draft', 'paused', 'needs_sign_in', 'blocked_limit', 'failed'].includes(instance.state)) refuse(409, 'already_on', 'This recipe is already on.')
      const nextDueAt = nextDueFor(instance.triggers, clock())
      await instances.updateOne({ _id: instance._id }, { $set: { state: 'active', pausedBy: null, pausedReason: null, failures: 0, nextDueAt, updated: new Date(clock()) }, $inc: { rev: 1 } })
      const active = { ...instance, state: 'active', nextDueAt }
      const run = await queue.enqueue(active, { kind: 'manual', by: principal.userId, reason: instance.lastRun ? 'resumed' : 'first run' })
      await record(instance.state === 'draft' ? 'recipe.enabled' : 'recipe.resumed', instance)
      if (instance.state !== 'draft') await outbound.emit({ type: 'recipe.resumed', instance: active, data: { by: principal.userId } }).catch(() => {})
      return { recipe: await publicInstance(active, principal.userId), runId: run._id }
    },

    async runNow(principal, instanceId, { reason, data } = {}) {
      const { instance } = await instanceFor(principal, instanceId, 'editor', 'run recipes')
      await requireOn(instance.orgId)
      if (instance.state !== 'active') refuse(409, 'recipe_not_on', 'Turn this recipe on first.')
      const manifest = manifestOf(instance.recipeId)
      if (data !== undefined) {
        if (!manifest.inputSchema) refuse(400, 'bad_payload', 'This recipe takes no data.', { pointer: '/data' })
        const invalid = validate(manifest.inputSchema, data)
        if (invalid) refuse(400, 'bad_payload', invalid.message, { pointer: '/data' + pointerOf(invalid.path) })
      }
      const lastHour = await runs.countDocuments({ instanceId: instance._id, 'trigger.kind': { $in: ['manual', 'inbound'] }, created: { $gt: new Date(clock() - 3600e3) } })
      if (lastHour >= RECIPE_LIMITS.manualPerHourPerInstance) refuse(429, 'rate_limited', `A recipe runs on request at most ${RECIPE_LIMITS.manualPerHourPerInstance} times an hour.`)
      const trigger = data !== undefined ? { kind: 'inbound', by: principal.userId, input: data, ...(reason && { reason: String(reason).slice(0, 200) }) } : { kind: 'manual', by: principal.userId, ...(reason && { reason: String(reason).slice(0, 200) }) }
      const run = await queue.enqueue(instance, trigger)
      return { runId: run._id, state: run.state }
    },

    async pause(principal, instanceId) {
      const { instance, role } = await instanceFor(principal, instanceId)
      ownerOrManager(principal, instance, role, 'pause it')
      if (instance.state === 'paused') return { recipe: await publicInstance(instance, principal.userId) }
      const set = { state: 'paused', pausedBy: principal.userId, pausedReason: 'person', nextDueAt: null, debounceUntil: null, pendingTrigger: null }
      await instances.updateOne({ _id: instance._id }, { $set: { ...set, updated: new Date(clock()) }, $inc: { rev: 1 } })
      await runs.updateMany({ instanceId: instance._id, state: 'queued' }, { $set: { state: 'cancelled', finishedAt: new Date(clock()), cancelledBy: principal.userId } })
      await record('recipe.paused', instance, { reason: 'person' })
      await outbound.emit({ type: 'recipe.paused', instance, data: { reason: 'person', by: principal.userId } }).catch(() => {})
      return { recipe: await publicInstance({ ...instance, ...set }, principal.userId) }
    },

    async resume(principal, instanceId) {
      const { instance, role } = await instanceFor(principal, instanceId)
      ownerOrManager(principal, instance, role, 'resume it')
      await requireOn(instance.orgId)
      if (instance.state === 'blocked_access') refuse(409, 'blocked_access', 'The person it runs for lost access. A manager can take it over.')
      if (instance.state === 'active') return { recipe: await publicInstance(instance, principal.userId) }
      if (instance.state === 'draft') refuse(409, 'not_on', 'Turn this recipe on first.')
      const nextDueAt = nextDueFor(instance.triggers, clock())
      const set = { state: 'active', pausedBy: null, pausedReason: null, failures: 0, nextDueAt }
      await instances.updateOne({ _id: instance._id }, { $set: { ...set, updated: new Date(clock()) }, $inc: { rev: 1 } })
      await record('recipe.resumed', instance)
      await outbound.emit({ type: 'recipe.resumed', instance, data: { by: principal.userId } }).catch(() => {})
      return { recipe: await publicInstance({ ...instance, ...set }, principal.userId) }
    },

    async remove(principal, instanceId) {
      const { instance, role } = await instanceFor(principal, instanceId)
      ownerOrManager(principal, instance, role, 'delete it')
      await purge(instance._id)
      await record('recipe.deleted', instance)
      return { deleted: true }
    },

    async runsOf(principal, instanceId, { limit = 20, before = null } = {}) {
      const { instance } = await instanceFor(principal, instanceId)
      const rows = await runs.find({ instanceId: instance._id, mode: 'run', ...(before && { created: { $lt: new Date(before) } }) }, { sort: { created: -1 }, limit: Math.min(50, Math.max(1, limit)) }).toArray()
      return { runs: rows.map(publicRun), next: rows.length === limit ? new Date(rows.at(-1).created).toISOString() : null }
    },

    async undoRun(principal, runId) {
      const run = typeof runId === 'string' ? await runs.findOne({ _id: runId }) : null
      if (!run) refuse(404, 'not_found', 'That run is not there any more.')
      const { instance, role } = await instanceFor(principal, run.instanceId)
      ownerOrManager(principal, instance, role, 'undo its runs')
      const saved = (run.changes || []).filter((c) => c.outcome === 'saved' && c.operationRunId)
      if (!saved.length) refuse(409, 'nothing_to_undo', 'This run saved nothing that can be undone (its suggestions are kept or discarded on the slate).')
      const out = []
      for (const change of [...saved].reverse()) out.push({ slateId: change.slateId, ...(await undo(principal, change.slateId, change.operationRunId)) })
      return { undone: out.length, slates: [...new Set(out.map((o) => o.slateId))] }
    },

    /** The notes recipes keep on a slate: for its agent panel ("Maintained by …") and its note pane. */
    async notesOn(principal, shareId) {
      const slate = await slateIdFor(principal, shareId)
      if (!slate?.canRead) refuse(404, 'not_found', 'That slate is not there, or it is not shared with you.')
      const rows = await notes.find({ slateId: slate.slateId, owner: 'recipe', gone: false }, { limit: 5000 }).toArray()
      const byInstance = new Map()
      for (const row of rows) {
        if (row.pending) continue
        if (!byInstance.has(row.instanceId)) byInstance.set(row.instanceId, [])
        byInstance.get(row.instanceId).push(row.noteId)
      }
      const out = []
      for (const [instanceId, noteIds] of byInstance) {
        const instance = await instances.findOne({ _id: instanceId })
        if (!instance) continue
        const manifest = manifestOf(instance.recipeId)
        out.push({ instanceId, name: instance.name, runsFor: runsFor(manifest?.agentName || instance.recipeId, await firstName(instance.ownerId).catch(() => null)), colorIndex: instance.colorIndex ?? 0, noteIds })
      }
      return { recipes: out }
    },

    /** "Make it mine": a note a recipe keeps becomes the person's (the recipe never changes it again). */
    async makeMine(principal, shareId, noteId) {
      const slate = await slateIdFor(principal, shareId)
      if (!slate?.canEdit) refuse(403, 'forbidden', 'Only people who can edit this slate can take a note over.')
      const rows = await notes.find({ slateId: slate.slateId, noteId, owner: 'recipe' }).toArray()
      if (!rows.length) refuse(404, 'not_found', 'No recipe keeps that note.')
      for (const row of rows) await notes.updateOne({ _id: row._id }, { $set: makeMine(row, new Date(clock())) })
      return { noteId, owner: 'person' }
    },

    // ---------- webhooks ----------
    async hooksList(principal, { instanceId, projectId }) {
      const scope = await hookScope(principal, { instanceId, projectId }, false)
      const rows = await hooks.find(scope.instanceId ? { 'scope.instanceId': scope.instanceId } : { 'scope.projectId': scope.projectId }).toArray()
      // A hook's address may carry its receiver's own secret (a path token): only the person who
      // added it and the project's managers see it whole; everyone else sees its host.
      const managing = rank(await roleIn(principal, scope.projectId)) >= rank('manager')
      return { hooks: rows.map((row) => publicHook(row, { full: managing || row.ownerId === principal.userId })) }
    },

    async hooksAdd(principal, { instanceId, projectId, direction, url, events, point, failMode = 'open' }) {
      const scope = await hookScope(principal, { instanceId, projectId }, true)
      if (!['outbound', 'inbound', 'intercept'].includes(direction)) refuse(400, 'bad_hook', 'A hook is outbound, inbound or intercept.')
      if (direction === 'inbound' && !scope.instanceId) refuse(400, 'bad_hook', 'An inbound hook runs one recipe: add it on the recipe.')
      const manifest = scope.instance ? manifestOf(scope.instance.recipeId) : null
      if (direction === 'inbound' && !manifest?.inputSchema) refuse(400, 'bad_hook', 'This recipe takes no data, so it has no inbound hook.')
      if (direction !== 'inbound') {
        if (typeof url !== 'string' || url.length > HOOK_LIMITS.urlChars) refuse(400, 'bad_url', 'A hook needs an https address.')
        try {
          checkHookUrl(url)
        } catch (error) {
          refuse(400, 'bad_url', error?.message || 'Slatebox sends hooks only to public https addresses.')
        }
      }
      let names = null
      if (direction === 'outbound') {
        const allowed = eventsFor(manifest)
        names = Array.isArray(events) && events.length ? [...new Set(events)] : ['*']
        const unknown = names.find((name) => name !== '*' && !allowed.includes(name) && !(scope.projectId && !scope.instanceId))
        if (unknown) refuse(400, 'bad_events', `This recipe does not send ${unknown}.`)
      }
      if (direction === 'intercept') {
        const points = [...(manifest?.intercepts || []), 'writeback.proposed']
        if (!points.includes(point)) refuse(400, 'bad_point', `This recipe stops for hooks at ${points.join(', ')}.`)
        if (!['open', 'closed'].includes(failMode)) refuse(400, 'bad_hook', 'failMode is open or closed.')
      }
      const filter = scope.instanceId ? { 'scope.instanceId': scope.instanceId } : { 'scope.projectId': scope.projectId }
      if ((await hooks.countDocuments(filter)) >= HOOK_LIMITS.perScope) refuse(409, 'too_many', `At most ${HOOK_LIMITS.perScope} hooks here.`)
      const _id = `rh_${newId()}`
      const plain = newSecret()
      const now = new Date(clock())
      const doc = {
        _id, ownerId: principal.userId, scope: scope.instanceId ? { instanceId: scope.instanceId } : { projectId: scope.projectId },
        direction, url: direction === 'inbound' ? null : url, events: names, point: direction === 'intercept' ? point : null,
        secrets: [{ id: newId(), sealed: sealer.seal(_id, plain), created: now, retiresAt: null }],
        failMode: direction === 'intercept' ? failMode : 'open', state: 'active', failures: 0, lastDelivery: null, created: now,
      }
      await hooks.insertOne(doc)
      await audit({ action: 'recipe.hook_added', instance: scope.instance, project: scope.projectId, details: { hookId: _id, kind: direction } })
      return { hook: publicHook(doc), secret: plain, ...(direction === 'inbound' && { url: `/hooks/recipes/${_id}` }) }
    },

    async hooksRemove(principal, hookId) {
      const hook = await ownHook(principal, hookId)
      await hooks.deleteOne({ _id: hook._id })
      await deliveries.deleteMany({ hookId: hook._id, state: 'pending' })
      await audit({ action: 'recipe.hook_removed', instance: hook.instance, project: hook.scope.projectId, details: { hookId: hook._id } })
      return { removed: true }
    },

    async hooksRotate(principal, hookId) {
      const hook = await ownHook(principal, hookId)
      const now = clock()
      const plain = newSecret()
      const secrets = [{ id: newId(), sealed: sealer.seal(hook._id, plain), created: new Date(now), retiresAt: null }, ...hook.secrets.filter((s) => !s.retiresAt || new Date(s.retiresAt).getTime() > now).map((s) => ({ ...s, retiresAt: s.retiresAt || new Date(now + ROTATION_OVERLAP_MS) }))]
      await hooks.updateOne({ _id: hook._id }, { $set: { secrets, state: hook.state === 'disabled' ? 'active' : hook.state, failures: 0 } })
      await audit({ action: 'recipe.hook_secret_rotated', instance: hook.instance, project: hook.scope.projectId, details: { hookId: hook._id } })
      return { secret: plain, oldSecretRetiresAt: new Date(now + ROTATION_OVERLAP_MS).toISOString() }
    },

    async hooksTest(principal, hookId) {
      const hook = await ownHook(principal, hookId)
      if (hook.direction !== 'outbound') refuse(400, 'bad_hook', 'Only an outbound hook sends test pings.')
      const instance = hook.instance || { _id: null, projectId: hook.scope.projectId, recipeId: null, name: '' }
      const [delivery] = await outbound.emit({ type: 'ping', hookId: hook._id, instance: { ...instance, _id: hook.scope.instanceId || 'project' }, data: { hookId: hook._id } }).catch(() => [])
      if (!delivery) refuse(409, 'not_sent', 'This hook is turned off. Rotate its secret to turn it on again.')
      const result = await outbound.deliver(delivery)
      return { delivered: result.ok, status: result.status }
    },

    async deliveriesOf(principal, hookId, { limit = 50 } = {}) {
      const hook = await ownHook(principal, hookId, false)
      const rows = await deliveries.find({ hookId: hook._id }, { sort: { created: -1 }, limit: Math.min(100, limit) }).toArray()
      return { deliveries: rows.map((d) => ({ deliveryId: d._id, event: d.event, attempt: d.attempt, state: d.state, responseCode: d.responseCode, durationMs: d.durationMs, at: new Date(d.created).toISOString() })) }
    },

    // ---------- permissions outside Slatebox ----------
    async grant(principal, instanceId, { kind, scope, expiresAt = null }) {
      if (principal.kind !== 'person') refuse(403, 'session_required', 'Only you, signed in to Slatebox, can let a recipe change things outside it.')
      const { instance } = await instanceFor(principal, instanceId)
      const doc = await permissions.grant(principal.userId, instance, kind, scope, expiresAt)
      return { grantId: doc._id, kind: doc.kind, describe: doc.describe }
    },

    async revoke(principal, grantId) {
      if (principal.kind !== 'person') refuse(403, 'session_required', 'Only you, signed in to Slatebox, can change a recipe\'s permissions.')
      return permissions.revoke(principal.userId, grantId)
    },

    async decideWrite(principal, cardId, decision) {
      if (principal.kind !== 'person') refuse(403, 'session_required', 'Only you, signed in to Slatebox, can approve a change outside it.')
      if (decision === 'approve') {
        // An approval makes the change now, so it obeys what a run obeys: every switch, the
        // recipe still on (or paused by a person), and its owner still an editor of the project.
        const card = typeof cardId === 'string' ? await cards.findOne({ _id: cardId }) : null
        const instance = card ? await instances.findOne({ _id: card.instanceId }) : null
        if (instance && instance.ownerId === principal.userId) {
          await requireOn(instance.orgId)
          if ((await switches.ownerPaused(instance.ownerId)) || (await projects.isRecipesPaused(instance.projectId)))
            refuse(409, 'recipes_paused', 'Recipes are paused here. Resume them to approve this change.')
          if (['blocked_access', 'needs_sign_in'].includes(instance.state))
            refuse(409, 'recipe_stopped', 'This recipe is stopped. Fix what stopped it, then approve the change.')
          if (rank(await roleIn(principal, instance.projectId)) < rank('editor'))
            refuse(403, 'forbidden', 'You no longer edit this project, so its recipe cannot change things outside Slatebox for you.')
        }
      }
      return permissions.decide(principal.userId, cardId, decision)
    },

    // ---------- people and switches ----------
    async transfer(principal, instanceId) {
      const { instance, role } = await instanceFor(principal, instanceId)
      if (rank(role) < rank('manager')) refuse(403, 'forbidden', 'Only a manager of this project can take a recipe over.')
      if (instance.ownerId === principal.userId) refuse(409, 'already_yours', 'This recipe already runs for you.')
      const now = new Date(clock())
      await grants.updateMany({ instanceId: instance._id, revokedAt: null }, { $set: { revokedAt: now, revokedBy: principal.userId, reason: 'transferred' } })
      const state = instance.state === 'draft' ? 'draft' : 'paused'
      await instances.updateOne({ _id: instance._id }, { $set: { ownerId: principal.userId, state, pausedReason: state === 'paused' ? 'person' : null, pausedBy: principal.userId, applyMode: 'suggest', nextDueAt: null, updated: now }, $inc: { rev: 1 } })
      await record('recipe.transferred', instance)
      await notify(instance.ownerId, { code: 'recipe_transferred', instanceId: instance._id, text: `${instance.name} now runs for someone else in the project.` }).catch(() => {})
      return { recipe: await publicInstance({ ...instance, ownerId: principal.userId, state }, principal.userId) }
    },

    async setInstallEnabled(principal, enabled) {
      if (principal.kind !== 'person' || !(await isServerAdmin(principal.userId))) refuse(403, 'forbidden', 'Only an administrator of this server can turn recipes on or off.')
      await switches.setInstallEnabled(Boolean(enabled), principal.userId)
      await audit({ action: 'recipe.install_enabled', server: true, details: { outcome: enabled ? 'on' : 'off' } })
      const counts = { active: await instances.countDocuments({ state: 'active' }), all: await instances.countDocuments({}) }
      return { enabled: Boolean(enabled), counts }
    },

    async adminStatus(principal) {
      if (!(await isServerAdmin(principal.userId))) refuse(403, 'forbidden', 'Only an administrator of this server can see this.')
      return { enabled: Boolean(await switches.installEnabled()), serverOff: Boolean(await switches.serverOff()), counts: { active: await instances.countDocuments({ state: 'active' }), all: await instances.countDocuments({}), running: await runs.countDocuments({ state: 'running' }) }, limits: { ...RECIPE_LIMITS } }
    },

    // ---------- the wider switches (B.10): project, owner, team, server ----------
    /** "Pause recipes in this project" (manager or above): no recipe there runs until it is resumed. */
    async pauseProject(principal, projectId, paused) {
      await needRole(principal, projectId, 'manager', 'pause its recipes')
      await projects.setRecipesPaused(principal.userId, projectId, Boolean(paused))
      const rows = await instances.find({ projectId }, { limit: 200 }).toArray()
      for (const instance of rows) await outbound.emit({ type: paused ? 'recipe.paused' : 'recipe.resumed', instance, data: paused ? { reason: 'project', by: principal.userId } : {} }).catch(() => {})
      return { projectId, paused: Boolean(paused) }
    },

    /** Whether the caller paused every recipe that runs for them (the profile switch). */
    async mine(principal) {
      return { paused: Boolean(await switches.ownerPaused(principal.userId)), count: await instances.countDocuments({ ownerId: principal.userId }) }
    },

    /** "Pause all my recipes": none that runs for the caller runs until they turn it back. */
    async pauseMine(principal, paused) {
      if (principal.kind !== 'person') refuse(403, 'forbidden', 'Only you can pause all your recipes, in your profile.')
      await switches.setOwnerPaused(principal.userId, Boolean(paused))
      const rows = await instances.find({ ownerId: principal.userId }, { limit: 200 }).toArray()
      for (const instance of rows) {
        await record(paused ? 'recipe.paused' : 'recipe.resumed', instance, paused ? { reason: 'owner' } : {})
        await outbound.emit({ type: paused ? 'recipe.paused' : 'recipe.resumed', instance, data: paused ? { reason: 'owner', by: principal.userId } : {} }).catch(() => {})
      }
      return { paused: Boolean(paused) }
    },

    /** Whether a team allows recipes (Team settings). Any member may read it. */
    async teamGet(principal, orgId) {
      if (!(await switches.isMember(principal.userId, orgId))) refuse(404, 'not_found', 'That team is not yours.')
      return { orgId, allowed: !(await switches.orgRecipesOff(orgId)) }
    },

    /** "Allow recipes for this team" (team admins): off, no recipe in the team's projects runs. */
    async teamSet(principal, orgId, allowed) {
      if (principal.kind !== 'person' || !(await switches.isMember(principal.userId, orgId)) || !(await switches.isTeamAdmin(principal.userId, orgId))) refuse(403, 'forbidden', 'Only an admin of this team can change this.')
      await switches.setOrgRecipesOff(orgId, !allowed)
      await audit({ action: allowed ? 'recipe.resumed' : 'recipe.paused', project: `team:${orgId}`, orgId, details: { reason: 'team', outcome: allowed ? 'allowed' : 'off' } })
      return { orgId, allowed: Boolean(allowed) }
    },

    /** Every active recipe on this server paused at once (Admin › Recipes). */
    async adminPauseAll(principal) {
      if (principal.kind !== 'person' || !(await isServerAdmin(principal.userId))) refuse(403, 'forbidden', 'Only an administrator of this server can pause every recipe.')
      const rows = await instances.find({ state: 'active' }, { limit: 5000 }).toArray()
      for (const instance of rows) await runner.stopInstance(instance, 'paused', 'admin')
      return { paused: rows.length }
    },

    /** The choices a config picker offers the caller: GitHub repositories the App sees, Slack channels. */
    async pickerOptions(principal, recipeId, picker) {
      const manifest = manifestOf(recipeId)
      if (!manifest) refuse(404, 'unknown_recipe', 'There is no such recipe.')
      const options = deps.pickerOptions ? await deps.pickerOptions(principal.userId, manifest, picker) : []
      return { options: (options || []).slice(0, 500) }
    },

    /** Called when a person loses access to a project (removed from the team, unshared, account deleted). */
    // userId null: a team lost its grant on projectId, so every recipe there is checked. Each owner's
    // role is read again (a person unshared by name may still edit through their team).
    async ownerLostAccess(userId, projectId = null) {
      if (!userId && !projectId) return { stopped: 0 }
      const rows = await instances.find({ ...(userId && { ownerId: userId }), ...(projectId && { projectId }), state: { $nin: ['blocked_access'] } }).toArray()
      let stopped = 0
      for (const instance of rows) {
        const still = await projects.roleFor(instance.ownerId, instance.projectId)
        if (still && rank(still) >= rank('editor')) continue
        await runner.stopInstance(instance, 'blocked_access', 'access')
        stopped += 1
      }
      return { stopped }
    },

    /** A drive deleted (projects.onDeleted): its recipes, runs, hooks and notes go; its slates follow the drive's rule. */
    async onProjectDeleted(projectId) {
      const rows = await instances.find({ projectId }).toArray()
      for (const instance of rows) await purge(instance._id)
      await hooks.deleteMany({ 'scope.projectId': projectId })
      return { deleted: rows.length }
    },
  }

  async function purge(instanceId) {
    await runs.updateMany({ instanceId, state: 'queued' }, { $set: { state: 'cancelled', finishedAt: new Date(clock()) } })
    const hookRows = await hooks.find({ 'scope.instanceId': instanceId }).toArray()
    for (const hook of hookRows) await deliveries.deleteMany({ hookId: hook._id })
    await hooks.deleteMany({ 'scope.instanceId': instanceId })
    await grants.deleteMany({ instanceId })
    await notes.deleteMany({ instanceId })
    await cards.deleteMany({ instanceId })
    await store.ledger.deleteMany({ instanceId })
    await instances.deleteOne({ _id: instanceId })
  }

  async function hookScope(principal, { instanceId, projectId }, write) {
    if (instanceId) {
      const { instance, role } = await instanceFor(principal, instanceId)
      if (write) ownerOrManager(principal, instance, role, 'add webhooks')
      return { instanceId: instance._id, projectId: instance.projectId, instance }
    }
    if (!projectId) refuse(400, 'invalid_request', 'Name the recipe or the project.')
    await needRole(principal, projectId, write ? 'manager' : 'viewer', write ? 'add project webhooks' : 'see its webhooks')
    return { instanceId: null, projectId, instance: null }
  }

  async function ownHook(principal, hookId, write = true) {
    const hook = typeof hookId === 'string' ? await hooks.findOne({ _id: hookId }) : null
    if (!hook) refuse(404, 'not_found', 'That webhook is not there any more.')
    if (hook.scope.instanceId) {
      const { instance, role } = await instanceFor(principal, hook.scope.instanceId)
      if (write) ownerOrManager(principal, instance, role, 'change its webhooks')
      return { ...hook, instance }
    }
    await needRole(principal, hook.scope.projectId, write ? 'manager' : 'viewer', 'change its webhooks')
    return { ...hook, instance: null }
  }
}

/** A hook as anyone may read it: never a secret. */
export function publicHook(hook, { full = true } = {}) {
  return {
    hookId: hook._id, direction: hook.direction, host: hook.url ? hostOf(hook.url) : null,
    url: hook.direction === 'inbound' ? `/hooks/recipes/${hook._id}` : full ? hook.url : (hook.url ? `https://${hostOf(hook.url)}/…` : null),
    events: hook.events, point: hook.point, failMode: hook.failMode, state: hook.state, failures: hook.failures || 0,
    scope: hook.scope, secrets: (hook.secrets || []).map((s) => ({ id: s.id, created: new Date(s.created).toISOString(), retiresAt: s.retiresAt ? new Date(s.retiresAt).toISOString() : null })),
    lastDelivery: hook.lastDelivery ? { at: new Date(hook.lastDelivery.at).toISOString(), status: hook.lastDelivery.status, code: hook.lastDelivery.code ?? null } : null,
    created: new Date(hook.created).toISOString(),
  }
}

export function publicRun(run) {
  return {
    runId: run._id, trigger: { kind: run.trigger?.kind, ...(run.trigger?.event && { event: run.trigger.event }), ...(run.trigger?.reason && { reason: run.trigger.reason }), ...(run.trigger?.count && { count: run.trigger.count }) },
    state: run.state, created: new Date(run.created).toISOString(), startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : null, finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
    durationMs: run.durationMs ?? null, attempts: run.attempts || 0, stats: run.stats || null,
    changes: (run.changes || []).map((c) => ({ slateId: c.slateId, outcome: c.outcome, undoable: Boolean(c.operationRunId && c.outcome === 'saved') })),
    writes: (run.writes || []).map((w) => ({ kind: w.kind, target: w.target, state: w.state, ...(w.cardId && { cardId: w.cardId }), ...(w.ref && { ref: w.ref }) })),
    log: (run.log || []).map((l) => ({ at: new Date(l.at).toISOString(), level: l.level, code: l.code, msg: l.msg })),
    error: run.error || null, skippedReason: run.skippedReason || null,
  }
}

function defaultName(manifest, config) {
  const target = config.repo || (Array.isArray(config.repos) ? config.repos.join(', ') : null) || config.channelName || config.fileName || null
  return target ? `${manifest.label} · ${target}` : manifest.label
}

/** How vendor events find this instance (RecipeInstance.match), from its config. */
export function matchFor(manifest, config) {
  if (manifest.integration === 'github') {
    const repos = [...new Set([config.repo, ...(config.repos || [])].filter(Boolean))]
    return { github: { installationId: config.installationId ?? null, repos } }
  }
  if (manifest.integration === 'slack') return { slack: { teamId: config.teamId ?? null, channels: [...new Set([config.channel, ...(config.channels || [])].filter(Boolean))] } }
  if (manifest.integration === 'google') return { google: { fileIds: [...new Set([config.fileId, ...(config.fileIds || [])].filter(Boolean))] } }
  return {}
}
