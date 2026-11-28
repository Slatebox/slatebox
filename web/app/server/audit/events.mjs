// The activity log's vocabulary: every action it can hold, the group a filter shows it under and
// the sentence a row reads as, and the one builder every entry passes through. Pure, so the
// recorder, the store, the export and scripts/audit.test.mjs run the same code.
//
// What an entry holds: who (a kind, an account or token id, and a name to show), what (an action
// from AUDIT_ACTIONS), on what (a target: a type, an id and a name), through which door (via), a
// keyed hash of the address it came from, and a few details from a fixed list (old and new names,
// a role, a link mode, a format, a count, a fixed code). Never note text, node data, comment
// bodies or prompts: buildEntry refuses any other detail, and any value that is not a short
// string, a number or a boolean.
import { createHmac, hkdfSync } from 'node:crypto'
import { AUDIT_GROUPS } from '../../imports/api/common/audit-words.mjs'

// The groups a filter shows (shared with the page: imports/api/common/audit-words.mjs).
export { AUDIT_GROUPS }

// id → { group, text }. text is the row's sentence after the person's name; {target} is the
// target's name (or its kind when it has none), {from} {to} {role} {mode} {format} {count}
// {method} {actionId} {domain} {group} the details of the same names.
export const AUDIT_ACTIONS = Object.freeze({
  // Slates
  'slate.created': { group: 'slates', text: 'created {target}' },
  'slate.copied': { group: 'slates', text: 'made {target} as a copy' },
  'slate.renamed': { group: 'slates', text: 'renamed {from} to {to}' },
  'slate.edited': { group: 'slates', text: 'edited {target}' },
  'slate.settingsChanged': { group: 'slates', text: 'changed the settings of {target}' },
  'slate.deleted': { group: 'slates', text: 'deleted {target}' },
  // Sharing
  'sharing.linkChanged': { group: 'sharing', text: 'made {target} {mode}: people with the link can {role}' },
  'sharing.memberChanged': { group: 'sharing', text: "set a teammate's access to {target}: {role}" },
  'sharing.inviteIssued': { group: 'sharing', text: 'made an invitation link to {target}' },
  'sharing.inviteRevoked': { group: 'sharing', text: 'turned off an invitation link to {target}' },
  'sharing.embedOpened': { group: 'sharing', text: 'opened the embed code of {target}' },
  'sharing.cloudLink': { group: 'sharing', text: 'made a {format} cloud link to a picture of {target}' },
  'sharing.guestAdmitted': { group: 'sharing', text: 'opened {target} as a guest' },
  // Members
  'member.invited': { group: 'members', text: 'invited {count} people to the team' },
  'member.joined': { group: 'members', text: 'joined the team' },
  'member.roleChanged': { group: 'members', text: 'changed what {target} may do: {role}' },
  'member.removed': { group: 'members', text: 'removed {target} from the team, with {count} slates' },
  'account.deleted': { group: 'members', text: 'deleted their account' },
  'team.created': { group: 'members', text: 'made the team {target}' },
  'team.deleted': { group: 'members', text: 'deleted the team {target}' },
  // Export and download
  'export.team': { group: 'exports', text: 'exported everything the team owns' },
  'export.mermaid': { group: 'exports', text: 'exported {target} as Mermaid' },
  'export.download': { group: 'exports', text: 'downloaded {target} as {format}' },
  'export.google': { group: 'exports', text: 'sent {target} to Google ({format})' },
  'import.team': { group: 'exports', text: 'imported a team ({method})' },
  'move.team': { group: 'exports', text: 'moved a team to this server ({method})' },
  // Publishing
  'presentation.published': { group: 'publishing', text: 'published the presentation of {target}' },
  'presentation.unpublished': { group: 'publishing', text: 'unpublished the presentation of {target}' },
  'library.submitted': { group: 'publishing', text: 'sent {target} to the library' },
  'library.published': { group: 'publishing', text: 'published {target} in the library' },
  'library.unpublished': { group: 'publishing', text: 'took {target} out of the library' },
  // Comments
  'comment.added': { group: 'comments', text: 'commented on {target}' },
  'comment.resolved': { group: 'comments', text: 'resolved comments on {target}' },
  'comment.removed': { group: 'comments', text: 'removed a comment on {target}' },
  // Agents and API
  'agent.write': { group: 'agents', text: 'made a change through {actionId}' },
  'token.created': { group: 'agents', text: 'made the access token {target}' },
  'token.revoked': { group: 'agents', text: 'revoked the access token {target}' },
  'integration.invited': { group: 'agents', text: 'brought an outside agent onto {target}' },
  'integration.removed': { group: 'agents', text: 'took an outside agent off a slate' },
  'integration.approved': { group: 'agents', text: 'kept what an outside agent suggested' },
  'integration.changed': { group: 'agents', text: 'changed an integration ({actionId})' },
  // Recipes (enterprise/server/recipes): agents that keep a project's slates up to date
  'recipe.created': { group: 'recipes', text: 'added the recipe {target}' },
  'recipe.updated': { group: 'recipes', text: 'changed the recipe {target}' },
  'recipe.deleted': { group: 'recipes', text: 'deleted the recipe {target}' },
  'recipe.enabled': { group: 'recipes', text: 'turned on the recipe {target}' },
  'recipe.paused': { group: 'recipes', text: 'paused the recipe {target} ({reason})' },
  'recipe.resumed': { group: 'recipes', text: 'resumed the recipe {target}' },
  'recipe.transferred': { group: 'recipes', text: 'took over the recipe {target}' },
  'recipe.run': { group: 'recipes', text: 'ran {target}: {outcome}, {count} slates changed' },
  'recipe.permission_granted': { group: 'recipes', text: 'let {target} make changes outside Slatebox ({kind})' },
  'recipe.permission_revoked': { group: 'recipes', text: 'took back the permission of {target} ({kind})' },
  'recipe.outside_write': { group: 'recipes', text: 'made a change outside Slatebox through {target} ({kind})' },
  'recipe.hook_added': { group: 'recipes', text: 'added a {kind} webhook to {target}' },
  'recipe.hook_removed': { group: 'recipes', text: 'removed a webhook from {target}' },
  'recipe.hook_secret_rotated': { group: 'recipes', text: 'rotated a webhook secret of {target}' },
  'recipe.install_enabled': { group: 'recipes', text: 'turned recipes {outcome} on this server' },
  // Sign-in
  'signin.succeeded': { group: 'signin', text: 'signed in ({method})' },
  'signin.failed': { group: 'signin', text: 'failed to sign in ({method})' },
  'signin.breakGlass': { group: 'signin', text: 'signed in without single sign-on ({method})' },
  'signout': { group: 'signin', text: 'signed out' },
  // Single sign-on (server/sso calls audit.record with these)
  'sso.connectionSaved': { group: 'sso', text: 'saved the sign-in connection {target}' },
  'sso.connectionRemoved': { group: 'sso', text: 'removed the sign-in connection {target}' },
  'sso.domainAdded': { group: 'sso', text: 'added the domain {domain}' },
  'sso.domainVerified': { group: 'sso', text: 'verified the domain {domain}' },
  'sso.domainLost': { group: 'sso', text: 'lost the verification of {domain}' },
  'sso.domainRemoved': { group: 'sso', text: 'removed the domain {domain}' },
  'sso.policyChanged': { group: 'sso', text: 'changed the sign-in rules' },
  // SCIM (server/scim calls audit.record with these)
  'scim.tokenCreated': { group: 'scim', text: 'made a provisioning token {target}' },
  'scim.tokenRevoked': { group: 'scim', text: 'revoked the provisioning token {target}' },
  'scim.userCreated': { group: 'scim', text: 'added {target}' },
  'scim.userAttached': { group: 'scim', text: 'brought the existing account {target} into the team' },
  'scim.userUpdated': { group: 'scim', text: 'updated {target}' },
  'scim.userDeactivated': { group: 'scim', text: 'deactivated {target}, moving {count} slates' },
  'scim.userReactivated': { group: 'scim', text: 'reactivated {target}' },
  'scim.userRemoved': { group: 'scim', text: 'stopped provisioning {target} (the account stays, turned off)' },
  'scim.groupCreated': { group: 'scim', text: 'added the group {target}' },
  'scim.groupUpdated': { group: 'scim', text: 'changed the group {target}' },
  'scim.groupRemoved': { group: 'scim', text: 'removed the group {target}' },
  'scim.groupMapped': { group: 'scim', text: 'mapped {target} to {role}' },
  'scim.roleChanged': { group: 'scim', text: 'changed the role of {target} to {role} through its directory groups' },
  'scim.recipientSet': { group: 'scim', text: 'chose {target} to receive the slates of people turned off' },
  // The log itself
  'audit.exported': { group: 'log', text: 'exported the activity log ({format})' },
  'audit.viewedByStaff': { group: 'log', text: 'opened the activity log (Slatebox staff)' },
  'audit.gap': { group: 'log', text: 'an entry was never written' },
})

export const AUDIT_ACTION_IDS = Object.freeze(Object.keys(AUDIT_ACTIONS))
export const ACTOR_KINDS = Object.freeze(['person', 'guest', 'agent', 'integration', 'scim', 'sso', 'system', 'staff'])
export const VIAS = Object.freeze(['app', 'api', 'mcp', 'exec', 'scim', 'sso', 'system'])
export const TARGET_TYPES = Object.freeze(['slate', 'team', 'person', 'token', 'comment', 'presentation', 'library', 'connection', 'domain', 'group', 'log', 'integration', 'recipe'])
// The only details an entry may carry. Values: a string of at most DETAIL_MAX characters, a
// number or a boolean.
export const DETAIL_KEYS = Object.freeze([
  'from', 'to', 'role', 'mode', 'format', 'count', 'method', 'reason', 'actionId', 'source',
  'reported', 'protocol', 'preset', 'domain', 'group', 'scope', 'staff',
  // recipes
  'instanceId', 'recipeId', 'runId', 'outcome', 'kind', 'hookId',
])
export const DETAIL_MAX = 120
export const NAME_MAX = 120
const ID = /^[A-Za-z0-9_.:@|-]{1,200}$/
const SCOPE = /^(server|[A-Za-z0-9_-]{1,64})$/

export class AuditEntryError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AuditEntryError'
  }
}

const refuse = (message) => {
  throw new AuditEntryError(message)
}

// A name as an entry keeps it: one line, at most NAME_MAX characters.
export const clipName = (value, max = NAME_MAX) => {
  if (value === undefined || value === null) return undefined
  // eslint-disable-next-line no-control-regex -- control characters are what this removes
  const text = String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function cleanActor(actor) {
  if (!actor || typeof actor !== 'object') refuse('An entry needs an actor.')
  const allowed = ['kind', 'userId', 'tokenId', 'tokenName', 'integrationId', 'label', 'visitor']
  const extra = Object.keys(actor).filter((key) => !allowed.includes(key) && actor[key] !== undefined)
  if (extra.length) refuse(`An actor holds no ${extra.join(', ')}.`)
  if (!ACTOR_KINDS.includes(actor.kind)) refuse(`actor.kind is one of ${ACTOR_KINDS.join(', ')}.`)
  const out = { kind: actor.kind }
  for (const key of ['userId', 'tokenId', 'integrationId', 'visitor']) {
    if (actor[key] === undefined || actor[key] === null) continue
    if (typeof actor[key] !== 'string' || !ID.test(actor[key])) refuse(`actor.${key} is an id.`)
    out[key] = actor[key]
  }
  const tokenName = clipName(actor.tokenName)
  if (tokenName) out.tokenName = tokenName
  out.label = clipName(actor.label) || defaultLabel(out)
  return out
}

function defaultLabel(actor) {
  if (actor.kind === 'agent') return actor.tokenName ? `Agent (${actor.tokenName})` : 'An agent'
  if (actor.kind === 'guest') return 'A guest'
  if (actor.kind === 'scim') return 'Your directory (SCIM)'
  if (actor.kind === 'sso') return 'Single sign-on'
  if (actor.kind === 'staff') return 'Slatebox staff'
  if (actor.kind === 'integration') return 'An integration'
  if (actor.kind === 'system') return 'Slatebox'
  return 'Someone'
}

function cleanTarget(target) {
  if (target === undefined || target === null) return null
  if (typeof target !== 'object') refuse('target is { type, id, name }.')
  const extra = Object.keys(target).filter((key) => !['type', 'id', 'name'].includes(key) && target[key] !== undefined)
  if (extra.length) refuse(`A target holds no ${extra.join(', ')}.`)
  if (!TARGET_TYPES.includes(target.type)) refuse(`target.type is one of ${TARGET_TYPES.join(', ')}.`)
  const out = { type: target.type }
  if (target.id !== undefined && target.id !== null) {
    if (typeof target.id !== 'string' || !ID.test(target.id)) refuse('target.id is an id.')
    out.id = target.id
  }
  const name = clipName(target.name)
  if (name) out.name = name
  return out
}

function cleanDetails(details) {
  if (details === undefined || details === null) return null
  if (typeof details !== 'object' || Array.isArray(details)) refuse('details is an object.')
  const out = {}
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || value === null) continue
    if (!DETAIL_KEYS.includes(key)) refuse(`An entry keeps no "${key}": only ${DETAIL_KEYS.join(', ')}.`)
    if (typeof value === 'string') out[key] = clipName(value, DETAIL_MAX) ?? ''
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value
    else refuse(`details.${key} is a short text, a number or true or false.`)
  }
  return Object.keys(out).length ? out : null
}

/**
 * The entry as it is stored, before its place in the chain (seq, entryHash): checked and trimmed.
 * Throws AuditEntryError for anything the log does not keep.
 *   { scope, at, action, actor, target?, slateId?, orgId?, via, ipHash?, details?, expiresAt? }
 */
export function buildEntry(input) {
  if (!input || typeof input !== 'object') refuse('An entry is an object.')
  const allowed = ['scope', 'at', 'action', 'actor', 'target', 'slateId', 'orgId', 'via', 'ipHash', 'details', 'expiresAt']
  const extra = Object.keys(input).filter((key) => !allowed.includes(key) && input[key] !== undefined)
  if (extra.length) refuse(`An entry holds no ${extra.join(', ')}.`)
  if (typeof input.scope !== 'string' || !SCOPE.test(input.scope)) refuse('scope is a team id or "server".')
  if (!Object.hasOwn(AUDIT_ACTIONS, input.action)) refuse(`There is no action ${input.action} in the log's catalogue.`)
  const at = input.at instanceof Date ? input.at : new Date(input.at)
  if (Number.isNaN(at.getTime())) refuse('at is a time.')
  if (!VIAS.includes(input.via)) refuse(`via is one of ${VIAS.join(', ')}.`)
  const entry = { scope: input.scope, at, action: input.action, actor: cleanActor(input.actor), via: input.via }
  const target = cleanTarget(input.target)
  if (target) entry.target = target
  for (const key of ['slateId', 'orgId']) {
    if (input[key] === undefined || input[key] === null) continue
    if (typeof input[key] !== 'string' || !ID.test(input[key])) refuse(`${key} is an id.`)
    entry[key] = input[key]
  }
  if (input.ipHash !== undefined && input.ipHash !== null) {
    if (typeof input.ipHash !== 'string' || !/^[a-f0-9]{16,64}$/.test(input.ipHash)) refuse('ipHash is a hex digest.')
    entry.ipHash = input.ipHash
  }
  const details = cleanDetails(input.details)
  if (details) entry.details = details
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    const expiresAt = input.expiresAt instanceof Date ? input.expiresAt : new Date(input.expiresAt)
    if (Number.isNaN(expiresAt.getTime())) refuse('expiresAt is a time.')
    entry.expiresAt = expiresAt
  }
  return entry
}

/**
 * The keyed hash an entry keeps for the address a request came from: HMAC-SHA-256 with a key
 * derived per scope (HKDF from the server's key encryption key), so the same address hashes
 * differently in two teams' logs and no hash can be looked up without the server. The raw address
 * is never stored. Null without a master key or an address.
 */
export function createAddressHasher(masterKey) {
  if (!masterKey) return () => null
  const keys = new Map()
  const keyFor = (scope) => {
    if (!keys.has(scope)) keys.set(scope, Buffer.from(hkdfSync('sha256', masterKey, Buffer.from('slatebox-audit-address'), Buffer.from(String(scope)), 32)))
    return keys.get(scope)
  }
  return (scope, address) => {
    const text = typeof address === 'string' ? address.trim().replace(/^::ffff:/i, '').toLowerCase() : ''
    if (!text || text.length > 64) return null
    return createHmac('sha256', keyFor(scope)).update(text).digest('hex').slice(0, 32)
  }
}

export const DAY = 86_400_000
export const CLOUD_RETENTION_DAYS = 365

/**
 * How long entries are kept: Slatebox Cloud a year (a team exports to keep more); a self-hosted
 * server settings.audit.retentionDays (SLATEBOX_AUDIT_RETENTION_DAYS): at least 30, 0 for ever.
 * → a number of days, or null for ever.
 */
export function retentionDays({ cloud, settings }) {
  if (cloud) return CLOUD_RETENTION_DAYS
  const value = settings?.audit?.retentionDays
  if (value === 0) return null
  if (!Number.isInteger(value)) return CLOUD_RETENTION_DAYS
  return Math.max(30, value)
}

export const expiryFor = (at, days) => (days === null ? null : new Date(new Date(at).getTime() + days * DAY))

/** The row's sentence, after the person's name. */
export function describeEntry(entry) {
  const spec = AUDIT_ACTIONS[entry?.action]
  if (!spec) return entry?.action || ''
  const details = entry.details || {}
  const target = entry.target?.name || (entry.target?.type ? `a ${entry.target.type}` : 'something')
  return spec.text.replace(/\{([a-zA-Z]+)\}/g, (_, key) => {
    if (key === 'target') return target
    const value = details[key]
    return value === undefined || value === null || value === '' ? '?' : String(value)
  })
}

export const groupOf = (action) => AUDIT_ACTIONS[action]?.group || null
export const actionsInGroup = (group) => AUDIT_ACTION_IDS.filter((id) => AUDIT_ACTIONS[id].group === group)
