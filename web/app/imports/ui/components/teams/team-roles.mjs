/* eslint-disable no-underscore-dangle */
// The team page's plain-language roles, read from the permission rows the server stores (claims in
// api/common/constants.js, rows in the Permissions collection). Display only: the server keeps
// storing the same claim ids, and a role change is the same users.changeRoles call the old
// checkbox table made, one entry per claim group. Pure, no Meteor (scripts/team-roles.test.mjs).
//
//   Owner    the person who made the team (users.isOrgOwner): not changed here
//   Admin    the admin claim: everything (every team slate and person, billing, settings)
//   Manager  all four people claims: see the team list, invite, edit names and roles, remove
//   Member   none of the people claims: works on slates, no team list
//   Custom   any other mix of the people claims (set under Advanced permissions)
//
// The slate claims (create team slates, copy team slates, remove comments) sit beside a role, not
// in it: a role change leaves them as they are, and Advanced permissions toggles them one by one.

export const ADMIN = 'admin'
export const SERVER_ADMIN = 'uberMensch'
export const PEOPLE_CLAIMS = Object.freeze(['canViewUsers', 'canEditUsers', 'canAddUsers', 'canRemoveUsers'])

export const ROLES = Object.freeze({
  owner: Object.freeze({ id: 'owner', label: 'Owner', blurb: 'Made the team. Can do everything.' }),
  admin: Object.freeze({ id: 'admin', label: 'Admin', blurb: 'Everything: every team slate and person, billing and settings.' }),
  manager: Object.freeze({ id: 'manager', label: 'Manager', blurb: 'Sees the team list, invites people, edits names and roles, removes people.' }),
  member: Object.freeze({ id: 'member', label: 'Member', blurb: 'Works on slates. Does not see the team list.' }),
  custom: Object.freeze({ id: 'custom', label: 'Custom', blurb: 'A mix of permissions set under Advanced permissions.' }),
})

// The roles a person may pick for someone else: Admin only when they are an admin themselves (the
// old table showed the admin column to admins only).
export const assignableRoles = ({ viewerIsAdmin }) =>
  (viewerIsAdmin ? ['admin', 'manager', 'member'] : ['manager', 'member']).map((id) => ROLES[id])

// Plain words for each stored claim, keyed by its id. The stored label stays as it is: these are
// what the page shows. A claim not listed here shows its stored label and description.
export const CLAIM_WORDS = Object.freeze({
  admin: { label: 'Admin', description: 'Everything: every team slate and person.' },
  canViewUsers: { label: 'See the team list', description: 'Read-only view of the people on the team.' },
  canEditUsers: { label: 'Edit people and roles', description: 'Change names, email addresses and roles.' },
  canAddUsers: { label: 'Invite people', description: 'Send email invitations and resend them.' },
  canRemoveUsers: { label: 'Remove people', description: 'Remove someone and the slates they own.' },
  canAddSlates: { label: 'Create team slates', description: 'Make slates on behalf of other members.' },
  canCopyTeamSlates: { label: 'Copy team slates', description: 'Copy a team slate for their own use.' },
  canRemoveComments: { label: 'Remove comments', description: 'Remove comments from slates.' },
  uberMensch: { label: 'Server administrator', description: 'Runs this Slatebox server. Set on the server, not here.' },
})

export const claimWords = (claim) => CLAIM_WORDS[claim?._id] || { label: claim?.label || claim?._id || '', description: claim?.description || '' }

// The order Advanced permissions lists claims in: admin, the people claims, then the rest.
const ORDER = [ADMIN, ...PEOPLE_CLAIMS, 'canAddSlates', 'canCopyTeamSlates', 'canRemoveComments', SERVER_ADMIN]
export const sortClaims = (claims) => [...claims].sort((a, b) => {
  const ia = ORDER.indexOf(a._id); const ib = ORDER.indexOf(b._id)
  return (ia < 0 ? ORDER.length : ia) - (ib < 0 ? ORDER.length : ib)
})

/** The role a person's stored claims add up to. claimIds: the claim ids of their Permissions rows. */
export function roleOf({ isOrgOwner = false, claimIds = [] } = {}) {
  if (isOrgOwner) return ROLES.owner
  const held = new Set(claimIds)
  if (held.has(ADMIN)) return ROLES.admin
  const people = PEOPLE_CLAIMS.filter((id) => held.has(id)).length
  if (people === PEOPLE_CLAIMS.length) return ROLES.manager
  if (people === 0) return ROLES.member
  return ROLES.custom
}

/** The claims beside the role (held, not admin, not a people claim): what "+N more" counts. */
export const extraClaims = (claimIds = []) => claimIds.filter((id) => id !== ADMIN && id !== SERVER_ADMIN && !PEOPLE_CLAIMS.includes(id))

/**
 * Whether a person holds a claim, the way AuthManager.userHasClaim reads it on the client: the admin
 * claim counts for every claim.
 */
export const holds = (claimIds = [], wanted = []) => {
  const list = Array.isArray(wanted) ? wanted : [wanted]
  return claimIds.includes(ADMIN) || list.some((id) => claimIds.includes(id))
}

/**
 * The users.changeRoles entries that move someone from the claims they hold to a role, in order.
 * Admin: one 'add' of [admin] (the server clears their other rows first, as it always has for the
 * admin column). Manager: drop admin if held, then add the four people claims (the server skips
 * rows that exist). Member: delete admin and the people claims they hold. Slate claims stay.
 * → [{ claimIds, action }] (empty: nothing to change)
 */
export function roleChanges(claimIds, to) {
  if (!Array.isArray(claimIds)) throw new Error('roleChanges: pass the claim ids held')
  const held = new Set(claimIds)
  const current = roleOf({ claimIds })
  if (to === current.id) return []
  if (to === 'admin') return [{ claimIds: [ADMIN], action: 'add' }]
  if (to === 'manager') {
    const out = []
    if (held.has(ADMIN)) out.push({ claimIds: [ADMIN], action: 'delete' })
    out.push({ claimIds: [...PEOPLE_CLAIMS], action: 'add' })
    return out
  }
  if (to === 'member') {
    const drop = [ADMIN, ...PEOPLE_CLAIMS].filter((id) => held.has(id))
    return drop.length ? [{ claimIds: drop, action: 'delete' }] : []
  }
  throw new Error(`No such role: ${to}`)
}

/** A member's state on the team, from their published email: joined, invited, or brought by a team import. */
export function memberStatus(member) {
  const email = member?.emails?.[0]
  if (!email?.address) return { id: 'not-invited', label: 'Not invited yet' }
  if (!email.verified) return { id: 'invited', label: 'Invited · not accepted yet' }
  return { id: 'active', label: 'Active' }
}

export const displayName = (member) => {
  const name = [member?.profile?.firstName, member?.profile?.lastName].map((s) => (s || '').trim()).filter(Boolean).join(' ')
  return name || member?.emails?.[0]?.address || 'Unnamed person'
}

export const initials = (member) => {
  const first = (member?.profile?.firstName || '').trim()
  const last = (member?.profile?.lastName || '').trim()
  const letters = (first[0] || '') + (last[0] || '')
  if (letters) return letters.toUpperCase()
  return ((member?.emails?.[0]?.address || '?')[0] || '?').toUpperCase()
}

// ---------- inviting several people at once ----------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const capital = (word) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : '')

/** A first guess at a name from an address: jane.doe@x → Jane / Doe. The person checks it. */
export function guessName(email) {
  const local = String(email || '').split('@')[0].replace(/\+.*$/, '')
  const parts = local.split(/[._-]+/).filter((p) => /^[a-z]+$/i.test(p))
  if (parts.length === 0) return { firstName: '', lastName: '' }
  return { firstName: capital(parts[0]), lastName: parts.length > 1 ? capital(parts[parts.length - 1]) : '' }
}

/**
 * Pasted addresses (commas, semicolons, spaces or new lines between them; "Name <a@b.c>" works) →
 * { people: [{ email, firstName, lastName }], problems: [string] }. taken: addresses already on the
 * team or on the list; own: the inviter's own addresses.
 */
export function readInvites(text, { taken = [], own = [] } = {}) {
  const takenSet = new Set(taken.map((e) => e.toLowerCase()))
  const ownSet = new Set(own.map((e) => e.toLowerCase()))
  const people = []
  const problems = []
  const tokens = String(text || '').split(/[\s,;]+/).map((t) => t.replace(/^[<"'(]+|[>"')]+$/g, '').trim()).filter(Boolean)
  tokens.filter((token) => token.includes('@')).forEach((token) => {
    const email = token.toLowerCase()
    if (!EMAIL.test(email)) problems.push(`${token} is not an email address.`)
    else if (ownSet.has(email)) problems.push(`${email} is your own address.`)
    else if (takenSet.has(email)) problems.push(`${email} is already on the team or on the list.`)
    else {
      takenSet.add(email)
      people.push({ email, ...guessName(email) })
    }
  })
  if (!people.length && !problems.length && tokens.length) problems.push('Enter at least one email address.')
  return { people, problems }
}

/** Whether an invitation list is ready to send: every row has an address and both names (the server asks for both). */
export const invitesReady = (people = []) => people.length > 0 &&
  people.every((p) => EMAIL.test(p.email || '') && (p.firstName || '').trim() && (p.lastName || '').trim())
