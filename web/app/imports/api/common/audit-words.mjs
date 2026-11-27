// The activity log's words the page and the server share: the groups a filter offers, the doors
// an entry came through, and the line that says whether the log is unbroken. Pure (the page,
// server/audit/events.mjs and scripts/audit.test.mjs read the same).

export const AUDIT_GROUPS = Object.freeze({
  slates: 'Slates',
  sharing: 'Sharing',
  members: 'Members',
  exports: 'Export and download',
  publishing: 'Publishing',
  comments: 'Comments',
  agents: 'Agents and API',
  signin: 'Sign-in',
  sso: 'Single sign-on',
  scim: 'Provisioning (SCIM)',
  log: 'Activity log',
})

export const VIA_LABELS = Object.freeze({
  app: 'App',
  api: 'API',
  mcp: 'MCP',
  exec: 'Script',
  scim: 'SCIM',
  sso: 'Single sign-on',
  system: 'Slatebox',
})

const day = (iso) => {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? null : time.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

/**
 * The badge over the log, from audit.verify: { tone: 'ok' | 'warn' | 'empty', text, detail }.
 */
export function chainBadge(result) {
  if (!result) return { tone: 'empty', text: 'Checking the log…', detail: null }
  if (!result.ok) {
    const what = { edited: 'was changed after it was written', missing: 'is missing', chain: 'does not follow the entry before it', checkpoint: 'does not match the daily checkpoint' }[result.problem?.kind] || 'does not check out'
    return { tone: 'warn', text: `Entry ${result.problem?.seq ?? '?'} ${what}`, detail: 'Export the log and contact whoever runs this server.' }
  }
  if (!result.checked) return { tone: 'empty', text: result.pending ? 'New entries are being sealed' : 'No entries yet', detail: null }
  const since = day(result.since)
  const pending = result.pending ? ` ${result.pending} newer ${result.pending === 1 ? 'entry is' : 'entries are'} being sealed.` : ''
  return {
    tone: 'ok',
    text: since ? `Chain unbroken since ${since}` : 'Chain unbroken',
    detail: `${result.checked.toLocaleString('en-US')} ${result.checked === 1 ? 'entry' : 'entries'} checked.${pending}`,
  }
}

/** How long entries are kept, for the line under the title (keptDays from audit.verify; null: for ever). */
export function keptFor({ cloud, keptDays }) {
  if (cloud) return 'Entries are kept for a year. Export the log to keep a copy for longer.'
  if (keptDays === null) return 'Entries are kept until you remove them.'
  const days = Number.isInteger(keptDays) ? keptDays : 365
  return `Entries are kept for ${days} days. The server's SLATEBOX_AUDIT_RETENTION_DAYS setting decides.`
}
