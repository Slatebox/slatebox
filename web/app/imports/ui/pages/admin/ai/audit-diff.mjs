// The Changes tab's before/after diff and CSV export, without React so it can be tested.
// Audit rows never carry a key: a key-bearing value is { redacted: true, fingerprint } or a
// keyFingerprint field ("…a91f", "sha256:1a2b3c4d…a91f"). The diff shows those as which key it is.

const isPlain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
const isRedacted = (value) => isPlain(value) && value.redacted === true

// Flattens a document to { 'path': value }. A list of named things (connections) is keyed by
// name, so a change to one connection reads as that connection's change.
export function flatten(value, prefix = '', out = {}) {
  if (isRedacted(value) || (!isPlain(value) && !Array.isArray(value))) {
    if (prefix) out[prefix] = value
    return out
  }
  if (Array.isArray(value)) {
    const named = value.length > 0 && value.every((item) => isPlain(item) && typeof item.name === 'string')
    if (!value.length && prefix) out[prefix] = []
    value.forEach((item, index) => flatten(item, `${prefix}[${named ? item.name : index}]`, out))
    return out
  }
  const keys = Object.keys(value)
  if (!keys.length && prefix) out[prefix] = {}
  for (const key of keys) flatten(value[key], prefix ? `${prefix}.${key}` : key, out)
  return out
}

/** A value in words for the diff. */
export function shown(value, path = '') {
  if (value === undefined) return '—'
  if (value === null) return /keyFingerprint$/.test(path) ? 'no key' : 'none'
  if (isRedacted(value)) return value.fingerprint ? `a key (${value.fingerprint})` : 'a key'
  if (/keyFingerprint$/.test(path)) return String(value)
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/** The fields that differ: [{ path, before, after }] in words, sorted by path. */
export function diffRows(before, after) {
  const a = flatten(before ?? {})
  const b = flatten(after ?? {})
  const rows = []
  for (const path of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (JSON.stringify(a[path]) === JSON.stringify(b[path])) continue
    // connections[gem].keyFingerprint reads as "connections[gem] key: …a91f → sha256:…07c2"
    const label = path.replace(/\.keyFingerprint$/, ' key')
    rows.push({ path: label, before: shown(a[path], path), after: shown(b[path], path) })
  }
  return rows
}

/** Who made a change, in words. */
export function actorText(actor = {}) {
  const who = actor.userId || 'unknown account'
  const how = { ddp: 'in the app', http: 'with a token', exec: 'from a script', mcp: 'over MCP', cli: 'from the CLI', system: 'by the server' }[actor.via] || ''
  return `${who}${actor.principal === 'agent' ? ' (agent)' : ''}${how ? ` ${how}` : ''}`
}

const cell = (value) => {
  const text = value === null || value === undefined ? '' : String(value)
  // a cell a spreadsheet would run as a formula is kept as text
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The rows as CSV: when, who, via, action, what, reason, outcome, changes. */
export function auditCsv(rows) {
  const head = ['when', 'account', 'principal', 'via', 'token', 'action', 'kind', 'id', 'reason', 'outcome', 'changes']
  const lines = rows.map((row) => [
    new Date(row.at).toISOString(), row.actor?.userId, row.actor?.principal, row.actor?.via, row.actor?.tokenId, row.action,
    row.target?.kind, row.target?.id, row.reason, row.outcome || 'ok',
    diffRows(row.before, row.after).map((d) => `${d.path}: ${d.before} -> ${d.after}`).join('; '),
  ].map(cell).join(','))
  return [head.join(','), ...lines].join('\n') + '\n'
}
