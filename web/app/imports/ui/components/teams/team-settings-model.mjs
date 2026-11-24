// Team settings (/team/settings): which sections a person sees, the rule for a team name and what
// deleting the team does, as plain data. Pure, so the page and scripts/team-settings.test.mjs run
// the same code. Every section is backed by something real: a server method, a collection field
// or a page. Nothing here invents a setting.

// The sections, in the order the left list shows them.
export const SECTIONS = Object.freeze([
  { id: 'general', label: 'General' },
  { id: 'members', label: 'Members & roles' },
  { id: 'billing', label: 'Plan & billing' },
  { id: 'ai', label: 'Agents & AI' },
  { id: 'branding', label: 'Branding' },
  { id: 'data', label: 'Data' },
  { id: 'danger', label: 'Danger zone' },
])

/**
 * The sections this person sees.
 *   inTeam     the person belongs to a team (users.orgId)
 *   admin      the team admin claim (permissions: claimId admin)
 *   owner      users.isOrgOwner
 *   billing    Slatebox Business is sold here (payments.cloud) or the server has a meter (team balance)
 * Members read General, Members & roles and Plan & billing; admins change them and also see Agents
 * & AI, Branding (the brand kit is admin-only) and Data (team.export is admin-only). The danger
 * zone is for admins: only the owner can delete, and an admin who is not is told who can.
 */
export function teamSettingsSections({ inTeam, admin, owner, billing }) {
  if (!inTeam) return []
  const show = {
    general: true,
    members: true,
    billing: Boolean(billing),
    ai: Boolean(admin),
    branding: Boolean(admin),
    data: Boolean(admin),
    danger: Boolean(admin || owner),
  }
  return SECTIONS.filter((s) => show[s.id])
}

/** The section to open: the one asked for when this person sees it, else the first. */
export function pickSection(sections, asked) {
  return sections.find((s) => s.id === asked)?.id ?? sections[0]?.id ?? null
}

// The same characters the page always accepted (letters, digits, underscores, inner spaces and
// dashes), and the 120-character cap organizations.create uses.
const NAME_CHARS = /^[_A-Za-z0-9]*((-|\s)*[_A-Za-z0-9])*$/
export const TEAM_NAME_MAX = 120

/** null when the name can be saved, else what to fix. */
export function teamNameProblem(name, noun = 'team') {
  const value = name ?? ''
  if (!value.trim()) return `Give the ${noun} a name.`
  if (value.length > TEAM_NAME_MAX) return `Keep the name under ${TEAM_NAME_MAX} characters.`
  if (value !== value.trim()) return 'The name cannot start or end with a space.'
  if (!NAME_CHARS.test(value)) return 'Use letters, numbers, spaces, dashes and underscores only.'
  return null
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`

/**
 * What the danger zone says and allows, from organizations.getCancellationImplications and who
 * is asking. organizations.delete removes the team only when no other member is left, and with it
 * the owner's slates in the team and the owner's account; balances are refunded and Business and
 * Pro end first, and if any of that fails nothing is removed (server/methods/organizations.js).
 * implications.ends says which of those apply to this owner (the server runs the delete's own
 * checks), so the dialog never claims a balance, Business or Pro the person does not have.
 *   → { state: 'loading' | 'failed' | 'not-owner' | 'members-left' | 'ready', lines, ... }
 */
export function deleteTeamState({ implications, failed = false, owner, teamName, noun = 'team', people = 'members' }) {
  if (!implications) return failed ? { state: 'failed', lines: [] } : { state: 'loading', lines: [] }
  if (!owner) {
    const who = implications.orgOwner
    const named = who ? `${who.name || 'the owner'}${who.email ? ` (${who.email})` : ''}` : 'the person who made it'
    return { state: 'not-owner', lines: [`Only the ${noun}'s owner, ${named}, can delete ${teamName}.`] }
  }
  if (implications.otherUsers > 0 || implications.otherSlates > 0) {
    const slates = implications.otherSlates > 0 ? `, with ${count(implications.otherSlates, 'slate', 'slates')} between them` : ''
    return {
      state: 'members-left',
      lines: [
        `${teamName} still has ${count(implications.otherUsers, `other ${people.replace(/s$/, '')}`, `other ${people}`)}${slates}.`,
        `Remove them on the ${noun} page first. Then you can delete the ${noun} here.`,
      ],
    }
  }
  const removed = [
    `The ${noun} ${teamName}.`,
    `Your ${count(implications.mySlates ?? 0, 'slate', 'slates')} in it.`,
    'Your Slatebox account. You are signed out and cannot sign in with it again.',
  ]
  const outside = implications.myOtherSlates ?? 0
  if (outside > 0) {
    removed.push(`Your ${count(outside, 'slate', 'slates')} outside the ${noun}: no one can open ${outside === 1 ? 'it' : 'them'} once your account is gone.`)
  }
  const ends = implications.ends ?? {}
  const first = []
  if (ends.balance) first.push(`Money left in the ${noun} balance or your own goes back to the card it was paid with.`)
  if (ends.business) first.push(`Slatebox Business for the ${noun} ends at once, with no refund for the current period.`)
  if (ends.pro) first.push('Your Slatebox Pro ends at once, with no refund for the current period.')
  return {
    state: 'ready',
    removed,
    first,
    lines: [`No other ${people} or their slates are left, so you can delete the ${noun}. This cannot be undone.`],
    safety: first.length ? 'If any of this fails, nothing is removed.' : null,
  }
}

/** The intro under the page title, naming only the sections this person sees. */
export function settingsIntro(sections, teamName) {
  const words = { general: 'its name', members: 'people', billing: 'plan', ai: 'AI', branding: 'brand kit', data: 'data' }
  const parts = sections.map((s) => words[s.id]).filter(Boolean)
  if (!teamName || parts.length === 0) return null
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `Everything about ${teamName} in one place: ${list}.`
}

/** The typed confirmation: the exact team name, ignoring spaces around it. */
export const confirmsName = (typed, teamName) => Boolean(teamName) && (typed ?? '').trim() === teamName.trim()
