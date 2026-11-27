// Who is an administrator of this Slatebox server, in one place. Pure: no Meteor.
//
// A server administrator holds the uberMensch claim: a Permissions row { userId, claimId:
// 'uberMensch' } that belongs to no team (no orgId). It is not the team 'admin' claim, which says
// someone runs a team: a team admin is not a server admin, and a server admin needs no team at all.
// The server decides every admin page and method from the row alone (server/permissions.js
// isInstanceAdmin); a browser only asks (the admin.status method) to know which links to draw.

export const SERVER_ADMIN_CLAIM = 'uberMensch'
export const TEAM_ADMIN_CLAIM = 'admin'

/** The Mongo selector of the one row that makes userId a server administrator. */
export const serverAdminSelector = (userId) => ({ userId, claimId: SERVER_ADMIN_CLAIM })

/** From Permissions rows: whether userId holds the server administrator claim (any orgId or none). */
export function isServerAdminFromRows(rows, userId) {
  if (typeof userId !== 'string' || !userId) return false
  return (rows || []).some((row) => row && row.userId === userId && row.claimId === SERVER_ADMIN_CLAIM)
}

/**
 * How AuthManager.userHasClaim reads a list of claims: the server administrator claim on its own,
 * the team claims (with the team 'admin' claim added, as before: a team admin holds every team
 * claim) apart. → { serverAdmin: boolean, team: string[] }
 */
export function splitClaims(claims) {
  const list = (Array.isArray(claims) ? claims : [claims]).filter((c) => typeof c === 'string' && c)
  const serverAdmin = list.includes(SERVER_ADMIN_CLAIM)
  const rest = list.filter((c) => c !== SERVER_ADMIN_CLAIM)
  const team = rest.length ? [...new Set([...rest, TEAM_ADMIN_CLAIM])] : []
  return { serverAdmin, team }
}

/**
 * The answer, given what the person holds. teamClaimIds: their claims in the team they are in now.
 * Asking for uberMensch alone needs uberMensch alone; it never also needs the team admin claim.
 */
export function decideClaims({ claims, isServerAdmin, teamClaimIds = [], mustBeInAll = false }) {
  const { serverAdmin, team } = splitClaims(claims)
  const held = new Set(teamClaimIds)
  const teamAll = team.length > 0 && team.every((c) => held.has(c))
  const teamAny = team.some((c) => held.has(c))
  if (serverAdmin && team.length === 0) return Boolean(isServerAdmin)
  if (serverAdmin) return mustBeInAll ? Boolean(isServerAdmin) && teamAll : Boolean(isServerAdmin) || teamAny
  return mustBeInAll ? teamAll : teamAny
}

/**
 * What an admin route shows: 'wait' (signing in or still asking), 'allow', or 'notfound' (the
 * same page any unknown address shows, so the route says nothing to a person who is not an admin).
 * Signed-out people are sent to sign in by PrivateRoute before this is asked.
 */
export function adminRouteState({ loggingIn = false, userId = null, admin = null }) {
  if (loggingIn) return 'wait'
  if (!userId) return 'notfound'
  if (admin === null || admin === undefined) return 'wait'
  return admin === true ? 'allow' : 'notfound'
}

/** The server admin pages, in the order the admin home, the account menu and the profile list them. */
export const ADMIN_SECTIONS = Object.freeze([
  Object.freeze({ id: 'overview', to: '/admin', title: 'Admin overview', detail: 'People, plans, payments and agent usage on this server' }),
  Object.freeze({ id: 'ai', to: '/admin/ai', title: 'AI control', detail: 'Models, providers, bindings and prompts' }),
  Object.freeze({ id: 'library', to: '/admin/library', title: 'Library review', detail: 'Submissions waiting for review' }),
  Object.freeze({ id: 'audit', to: '/admin/audit', title: 'Activity log', detail: "What people did on this server's slates, team by team" }),
])

/** Pages only a self-hosted server has (settings.public.env 'selfhost', not the Cloud edition). */
export const SELF_HOST_SECTIONS = Object.freeze([
  Object.freeze({ id: 'updates', to: '/admin/updates', title: 'Updates', detail: 'New versions from GitHub, when they are applied, and what happened' }),
])

/** Pages only Slatebox Cloud has (the growth funnel: imports/api/common/growth.mjs growthOn). */
export const CLOUD_SECTIONS = Object.freeze([
  Object.freeze({ id: 'growth', to: '/admin/growth', title: 'Growth', detail: 'Which links bring people, and how far they get' }),
])

/** Whether these settings are a self-hosted server's (the same rule as the setup link's). */
export const selfHostedServer = (settings) => settings?.public?.env === 'selfhost' && settings?.public?.edition !== 'cloud'

/**
 * The admin links a person sees: all of them for a server administrator, none for anyone else (or
 * while unknown). A self-hosted server adds its own (Updates).
 */
export const adminLinksFor = (admin, { selfHosted = false } = {}) => (admin === true ? (selfHosted ? [...ADMIN_SECTIONS, ...SELF_HOST_SECTIONS] : ADMIN_SECTIONS) : [])
