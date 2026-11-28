// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Changes outside Slatebox (a pull request in someone's GitHub, a post in their Slack): never made
// without a person's say.
//   standing permission   a signed-in person grants one per recipe, per kind, with an exact scope
//                         ("pull requests in acme/api, branches slatebox/…, only docs/architecture/*.mmd"),
//                         optionally until a date. Only in the app: never a token, a script or MCP
//                         (recipes.grant is DDP-only and NEVER_BOUND). Granted and revoked in the log.
//   no permission         the change waits as an action card on the recipe's status slate; a person
//                         approving it makes it once.
//   hard limits           no permission lifts these: never merge, never delete, never push to a
//                         default or protected branch, a pull request only from slatebox/ branches,
//                         a Slack post only in a channel the permission names.
// Every change made is recorded as recipe.outside_write.
import { validate } from '/server/actions/schema.mjs'
import { WRITE_KINDS } from '../../common/recipes/manifest.mjs'
import { isDuplicate } from './store.mjs'

export { WRITE_KINDS }

export const HARD_LIMITS = Object.freeze({
  // The branch a pull request comes from, as the target names it (ref or branch, as the GitHub vendor
  // pushes to target.branch): every name given is a slatebox/ branch, and at least one is given.
  'github.pull_request': (w) => (!slateboxBranches(w.target) || w.target?.targetsDefaultBranch || w.target?.protected ? 'refused' : null),
  'github.*': (w) => (w.body?.merge || w.body?.delete || w.target?.merge || w.target?.delete ? 'refused' : null),
  'slack.post': (w, grant) => (grant && !(grant.scope?.channels || []).includes(w.target?.channel) ? 'refused' : null),
})

function slateboxBranches(target = {}) {
  const names = [target?.ref, target?.branch].filter((v) => v !== undefined && v !== null)
  return names.length > 0 && names.every((v) => /^(refs\/heads\/)?slatebox\/[^\s]+$/.test(String(v)))
}

export class PermissionRefused extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

const globToRegExp = (glob) => new RegExp('^' + String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '[^/]') + '$')

// Scope fields and the target fields they bound: a list in the scope admits only targets inside it.
const BOUNDS = [
  ['repos', (t) => (t.repo ? [t.repo] : [])],
  ['channels', (t) => (t.channel ? [t.channel] : [])],
  ['fileIds', (t) => (t.fileId ? [t.fileId] : [])],
]

/** Whether a grant's scope covers a write's target. Paths are globs (docs/architecture/*.mmd). */
export function scopeCovers(scope, target = {}) {
  for (const [field, of] of BOUNDS) {
    if (!Array.isArray(scope?.[field])) continue
    const values = of(target)
    if (!values.length || values.some((v) => !scope[field].includes(v))) return false
  }
  if (Array.isArray(scope?.paths)) {
    const paths = target.paths || []
    if (!paths.length) return false
    const globs = scope.paths.map(globToRegExp)
    if (paths.some((p) => !globs.some((g) => g.test(p)))) return false
  }
  return true
}

/** The hard limit a write breaks, or null. vendorLimit: the vendor's own (vendor.checkHardLimits). */
export function hardLimit(write, grant = null, vendorLimit = null) {
  const vendor = String(write.kind).split('.')[0]
  for (const rule of [HARD_LIMITS[`${vendor}.*`], HARD_LIMITS[write.kind]]) {
    if (rule && rule(write, grant) === 'refused') return 'refused'
  }
  if (vendorLimit && vendorLimit(write) === 'refused') return 'refused'
  return null
}

const alive = (grant, now) => !grant.revokedAt && (!grant.expiresAt || new Date(grant.expiresAt).getTime() > now)

/**
 * deps: { store, clock, audit(entry), randomId, manifestOf(recipeId), vendorOf(kind) → vendor plug-in,
 *         onRevoked(instance, grant) (pauses the instance), emit(event) }
 */
export function createPermissions({ store, clock = Date.now, audit = async () => {}, randomId, manifestOf, vendorOf = () => null, onRevoked = async () => {}, emit = async () => {} }) {
  const { grants, cards, instances } = store
  const newId = randomId || (() => Math.random().toString(36).slice(2, 14))

  function writeSpec(instance, kind) {
    const manifest = manifestOf(instance.recipeId)
    return manifest?.writes?.find((w) => w.kind === kind) || null
  }

  /** A standing permission. Only a person signed in to the app calls this (recipes.grant). */
  async function grant(userId, instance, kind, scope, expiresAt = null) {
    if (instance.ownerId !== userId) throw new PermissionRefused(403, 'not_owner', 'Only the person a recipe runs for can let it change things outside Slatebox.')
    if (!WRITE_KINDS.includes(kind)) throw new PermissionRefused(400, 'unknown_kind', 'That is not a change a recipe can make.')
    const spec = writeSpec(instance, kind)
    if (!spec) throw new PermissionRefused(400, 'not_offered', 'This recipe does not make that change.')
    const invalid = validate(spec.scopeSchema, scope)
    if (invalid) throw new PermissionRefused(400, 'bad_scope', invalid.message)
    const until = expiresAt ? new Date(expiresAt) : null
    if (until && (Number.isNaN(until.getTime()) || until.getTime() <= clock())) throw new PermissionRefused(400, 'bad_expiry', 'The end date is in the past.')
    const now = new Date(clock())
    // one live grant per kind: a new one replaces the old
    await grants.updateMany({ instanceId: instance._id, kind, revokedAt: null }, { $set: { revokedAt: now, revokedBy: userId, replaced: true } })
    const doc = { _id: newId(), instanceId: instance._id, kind, scope, describe: spec.describe(scope), grantedBy: userId, grantedAt: now, expiresAt: until, revokedAt: null }
    await grants.insertOne(doc)
    await audit({ action: 'recipe.permission_granted', instance, details: { kind, instanceId: instance._id } })
    return doc
  }

  async function revoke(userId, grantId) {
    const doc = await grants.findOne({ _id: grantId })
    if (!doc || doc.revokedAt) throw new PermissionRefused(404, 'not_found', 'That permission is not there any more.')
    const instance = await instances.findOne({ _id: doc.instanceId })
    if (!instance || instance.ownerId !== userId) throw new PermissionRefused(404, 'not_found', 'That permission is not there any more.')
    await grants.updateOne({ _id: grantId }, { $set: { revokedAt: new Date(clock()), revokedBy: userId } })
    await audit({ action: 'recipe.permission_revoked', instance, details: { kind: doc.kind, instanceId: instance._id } })
    await onRevoked(instance, doc)
    return { revoked: true }
  }

  async function liveGrants(instanceId) {
    const now = clock()
    return (await grants.find({ instanceId, revokedAt: null }).toArray()).filter((g) => alive(g, now))
  }

  /** What happens to a proposed write: allow (a grant covers it), card (a person approves it), refused. */
  async function check(instance, write) {
    if (!WRITE_KINDS.includes(write?.kind) || !writeSpec(instance, write.kind)) return { decision: 'refused', reason: 'not_offered' }
    const vendor = vendorOf(write.kind)
    const live = (await liveGrants(instance._id)).filter((g) => g.kind === write.kind)
    const covering = live.find((g) => scopeCovers(g.scope, write.target))
    if (hardLimit(write, covering || null, vendor?.checkHardLimits ? (w) => vendor.checkHardLimits(w) : null)) return { decision: 'refused', reason: 'hard_limit' }
    if (covering) return { decision: 'allow', grant: covering }
    return { decision: 'card' }
  }

  /** A card on the status slate: one per write key, the newest body wins while it waits. */
  async function propose(instance, write, run) {
    const now = new Date(clock())
    const existing = await cards.findOne({ instanceId: instance._id, key: write.key })
    if (existing && existing.state === 'waiting') {
      await cards.updateOne({ _id: existing._id }, { $set: { target: write.target, body: write.body, runId: run?._id ?? null, updated: now } })
      return { ...existing, target: write.target, body: write.body }
    }
    if (existing && ['done', 'declined'].includes(existing.state) && existing.bodyHash === hashOf(write.body)) return existing
    const doc = { _id: existing?._id || newId(), instanceId: instance._id, ownerId: instance.ownerId, key: write.key, kind: write.kind, target: write.target, body: write.body, bodyHash: hashOf(write.body), state: 'waiting', runId: run?._id ?? null, created: now, updated: now }
    if (existing) await cards.updateOne({ _id: existing._id }, { $set: doc })
    else {
      try {
        await cards.insertOne(doc)
      } catch (error) {
        if (!isDuplicate(error)) throw error
      }
    }
    return doc
  }

  /** Makes the change through its vendor, records it, tells hooks. → { ref } */
  async function make(instance, write, { grant = null, run = null, signal = null, via = 'grant' } = {}) {
    const vendor = vendorOf(write.kind)
    if (!vendor?.perform) throw new PermissionRefused(409, 'vendor_missing', 'This server cannot make that change.')
    const answer = (await vendor.perform(write, { instance, grant, signal })) || {}
    // The vendor's own last check (a hard limit GitHub's answers showed, a repository not picked):
    // nothing was changed, so nothing is logged as changed.
    if (answer.refused) {
      await emit({ type: 'writeback.declined', instance, run, data: { kind: write.kind, target: targetLine(write.target), reason: 'hard_limit' } }).catch(() => {})
      return { ref: null, refused: String(answer.refused).slice(0, 60) }
    }
    const { ref = null } = answer
    await audit({ action: 'recipe.outside_write', instance, details: { kind: write.kind, instanceId: instance._id, runId: run?._id, outcome: via } })
    await emit({ type: 'writeback.done', instance, run, data: { kind: write.kind, target: targetLine(write.target), ...(ref && { ref: String(ref).slice(0, 300) }) } }).catch(() => {})
    return { ref }
  }

  /** One proposed write, decided and done. → the run's writes[] entry. */
  async function perform(instance, write, run, { signal = null, intercept = null } = {}) {
    const decided = await check(instance, write)
    if (decided.decision === 'refused') {
      await emit({ type: 'writeback.declined', instance, run, data: { kind: write.kind, target: targetLine(write.target), reason: decided.reason } }).catch(() => {})
      return { kind: write.kind, target: targetLine(write.target), state: 'refused' }
    }
    let body = write.body
    let decision = decided.decision
    if (intercept) {
      const answer = await intercept({ ...write, decision })
      if (answer?.decision === 'veto') {
        await emit({ type: 'writeback.declined', instance, run, data: { kind: write.kind, target: targetLine(write.target), reason: 'veto' } }).catch(() => {})
        return { kind: write.kind, target: targetLine(write.target), state: 'refused' }
      }
      if (answer?.decision === 'defer') decision = 'card'
      // approve never widens: a hook's body stays inside the grant's scope and hard limits
      if (answer?.body && decision === 'allow') {
        const edited = { ...write, body: answer.body }
        const again = await check(instance, edited)
        if (again.decision === 'allow') body = answer.body
      }
    }
    if (decision === 'allow') {
      const { ref, refused } = await make(instance, { ...write, body }, { grant: decided.grant, run, signal })
      if (refused) return { kind: write.kind, target: targetLine(write.target), state: 'refused' }
      return { kind: write.kind, target: targetLine(write.target), state: 'done', ...(ref && { ref }) }
    }
    const card = await propose(instance, { ...write, body }, run)
    if (card.state === 'waiting') await emit({ type: 'approval.needed', instance, run, data: { cardId: card._id, kind: write.kind, target: targetLine(write.target) } }).catch(() => {})
    return { kind: write.kind, target: targetLine(write.target), state: 'card', cardId: card._id }
  }

  /** A person's answer to a card: approve makes the change once (checked again), decline closes it. */
  async function decide(userId, cardId, decision, { signal = null } = {}) {
    const card = await cards.findOne({ _id: cardId })
    if (!card) throw new PermissionRefused(404, 'not_found', 'That change is not waiting any more.')
    const instance = await instances.findOne({ _id: card.instanceId })
    if (!instance || instance.ownerId !== userId) throw new PermissionRefused(403, 'not_owner', 'Only the person this recipe runs for can approve its changes outside Slatebox.')
    const taken = await cards.updateOne({ _id: cardId, state: 'waiting' }, { $set: { state: decision === 'approve' ? 'running' : 'declined', decidedBy: userId, decidedAt: new Date(clock()) } })
    if (!taken.modifiedCount) throw new PermissionRefused(409, 'already_decided', 'Someone already answered this change.')
    if (decision !== 'approve') {
      await emit({ type: 'writeback.declined', instance, data: { kind: card.kind, target: targetLine(card.target), reason: 'declined' } }).catch(() => {})
      return { state: 'declined' }
    }
    const write = { kind: card.kind, target: card.target, body: card.body, key: card.key }
    if (hardLimit(write, null, vendorOf(card.kind)?.checkHardLimits ? (w) => vendorOf(card.kind).checkHardLimits(w) : null)) {
      await cards.updateOne({ _id: cardId }, { $set: { state: 'failed', reason: 'hard_limit' } })
      return { state: 'failed' }
    }
    try {
      const { ref, refused } = await make(instance, write, { signal, via: 'card' })
      if (refused) {
        await cards.updateOne({ _id: cardId }, { $set: { state: 'failed', reason: refused } })
        return { state: 'failed' }
      }
      await cards.updateOne({ _id: cardId }, { $set: { state: 'done', ref: ref ?? null } })
      return { state: 'done', ref }
    } catch (error) {
      await cards.updateOne({ _id: cardId }, { $set: { state: 'failed', reason: String(error?.code || 'failed').slice(0, 60) } })
      throw error
    }
  }

  return { grant, revoke, check, perform, propose, decide, liveGrants }
}

const hashOf = (body) => JSON.stringify(body ?? null).length + ':' + [...JSON.stringify(body ?? null)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)

/** A write's target in one short line (for cards, events and the log): "acme/api #42", "#general". */
export function targetLine(target = {}) {
  if (target.repo && target.number) return `${target.repo} #${target.number}`
  if (target.repo) return String(target.repo)
  if (target.channel) return `channel ${target.channel}`
  if (target.fileId) return `file ${target.fileId}`
  return 'outside Slatebox'
}
