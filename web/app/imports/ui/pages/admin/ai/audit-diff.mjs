// The Changes tab's before/after diff and CSV export, without React so it can be tested.
// Audit rows never carry a key: a key-bearing value is { redacted: true, fingerprint } or a
// keyFingerprint field ("…a91f", "sha256:1a2b3c4d…a91f"). The diff shows those as which key it is.

const isPlain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
const isRedacted = (value) => isPlain(value) && value.redacted === true

// Flattens a document to { 'path': value }. A list of named things (a person's connections) is
// keyed by name, so a change to one connection reads as that connection's change.
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

// Bookkeeping every stored document carries: who and when are the row's own columns.
const BOOKKEEPING = new Set(['_id', 'updatedAt', 'updatedBy'])
const withoutBookkeeping = (value) => (isPlain(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => !BOOKKEEPING.has(key))) : value)

/** The fields that differ: [{ path, before, after }] in words, sorted by path. */
export function diffRows(before, after) {
  const a = flatten(withoutBookkeeping(before ?? {}))
  const b = flatten(withoutBookkeeping(after ?? {}))
  const rows = []
  for (const path of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (JSON.stringify(a[path]) === JSON.stringify(b[path])) continue
    // connections[gem].keyFingerprint reads as "connections[gem] key: …a91f → sha256:…07c2"
    const label = path.replace(/\.keyFingerprint$/, ' key')
    rows.push({ path: label, before: shown(a[path], path), after: shown(b[path], path) })
  }
  return rows
}

/**
 * Who made a change, in words: the person's name (ai.audit.list adds actor.name), never an account
 * id. An account that is gone reads "a deleted account"; a change with no account, the server.
 */
export function actorText(actor = {}) {
  const who = actor.name || (actor.userId ? 'a deleted account' : actor.via === 'system' ? 'Slatebox' : 'an unknown account')
  const how = { ddp: 'in the app', http: 'with a token', exec: 'from a script', mcp: 'over MCP', cli: 'from the CLI', system: 'by the server' }[actor.via] || ''
  return `${who}${actor.principal === 'agent' ? ' (agent)' : ''}${how ? ` ${how}` : ''}`
}

const cell = (value) => {
  const text = value === null || value === undefined ? '' : String(value)
  // a cell a spreadsheet would run as a formula is kept as text
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The rows as CSV: when, who (account and name), via, action, what, reason, outcome, changes. */
export function auditCsv(rows) {
  const head = ['when', 'account', 'name', 'principal', 'via', 'token', 'action', 'kind', 'id', 'reason', 'outcome', 'changes']
  const lines = rows.map((row) => [
    new Date(row.at).toISOString(), row.actor?.userId, row.actor?.name, row.actor?.principal, row.actor?.via, row.actor?.tokenId, row.action,
    row.target?.kind, row.target?.id, row.reason, row.outcome || 'ok',
    diffRows(row.before, row.after).map((d) => `${d.path}: ${d.before} -> ${d.after}`).join('; '),
  ].map(cell).join(','))
  return [head.join(','), ...lines].join('\n') + '\n'
}

const ACTIONS = {
  'ai.update': 'Changed own AI settings',
  'ai.check': 'Tested a connection',
  'ai.control.reset': 'Reset AI control',
  'ai.control.setGlobal': 'Switched AI for everyone',
  'ai.providers.add': 'Added a provider',
  'ai.providers.save': 'Changed a provider',
  'ai.providers.archive': 'Archived a provider',
  'ai.keys.add': 'Added a key',
  'ai.keys.import': 'Moved a key from the settings file',
  'ai.keys.activate': 'Switched to a key',
  'ai.keys.rotate': 'Replaced a key',
  'ai.keys.revoke': 'Revoked a key',
  'ai.keys.remove': 'Deleted a key',
  'ai.keys.test': 'Tested a key',
  'ai.models.save': 'Saved models',
  'ai.models.remove': 'Removed a model',
  'ai.models.test': 'Tested a model',
  'ai.bindings.set': 'Changed which model a part uses',
  'ai.bindings.remove': 'Returned a part to the default',
  'ai.bindings.history': 'Kept the history of earlier bindings',
  'ai.prompts.saveDraft': 'Saved a prompt draft',
  'ai.prompts.test': 'Test-ran a prompt',
  'ai.prompts.publish': 'Published a prompt',
  'ai.prompts.rollback': 'Rolled back a prompt',
  'chatIntentions.save': 'Saved a persona',
  'chatIntentions.delete': 'Deleted a persona',
}

/**
 * What one audit row did, in words: a binding's row says what the part uses now ("Meta (Muse) ·
 * muse-ember-1.0", "Use the default", "Turned off"); a key's row says which key, never the key.
 */
export function actionText(row = {}) {
  const base = ACTIONS[row.action] || row.action || 'A change'
  if (row.outcome === 'refused') return base
  if (String(row.action || '').startsWith('ai.prompts.')) return promptText(base, row)
  if (row.action === 'ai.bindings.set' || row.action === 'ai.bindings.remove') {
    if (!row.after) return `${base}: use the default`
    return `${base}: ${row.after.use === 'off' ? 'turned off' : row.after.model}`
  }
  if (String(row.action || '').startsWith('ai.keys.') && row.after?.keyFingerprint) return `${base}: ${row.after.keyFingerprint}${row.after.status ? ` (${row.after.status})` : ''}`
  return base
}

// A prompt's rows: a version saved, a test run, or the label moved (version 0 is the built-in text).
function promptText(base, row) {
  const doc = row.after
  if (!doc) return base
  if (row.action === 'ai.prompts.test' && doc.failed) return `${base}: ${doc.version ? `version ${doc.version}` : doc.version === 0 ? 'the built-in text' : 'unsaved text'}, no answer (${doc.failed})`
  if (row.action === 'ai.prompts.test') return `${base}: ${doc.version ? `version ${doc.version}` : doc.version === 0 ? 'the built-in text' : 'unsaved text'}, ${doc.parses ? 'answer usable' : 'answer not usable'}`
  if (doc.promptId) return `${base}: version ${doc.version} saved${doc.status === 'draft' ? ' as a draft' : ''}${doc.origin === 'ai-proposal' ? ' (suggested by an agent)' : ''}`
  // the prompt's own record, written with its first draft: nothing went live
  if (doc.labels && row.action === 'ai.prompts.saveDraft') return `${base}: first draft of this prompt`
  if (doc.labels) return `${base}: ${doc.labels.published ? `version ${doc.labels.published} live` : 'the built-in text live'}`
  return base
}

// What a reset target, a state row and the other kinds of change are, in words.
const RESETS = { binding: 'one part back to the default', bindings: 'every part back to the default', prompt: 'one prompt', prompts: 'every prompt', all: 'everything in AI control' }
const STATES = { global: 'AI for everyone' }
const list = (id) => String(id || '').split(',').filter(Boolean).join(', ')

/**
 * What a change was made to, in words: a binding as the plain title of its part of Slatebox
 * ("Conversation and edits"), never "binding: chat|server". titles: { [surfaceId]: title }
 */
export function targetText(target = {}, titles = {}) {
  const { kind, id } = target || {}
  if (!kind) return ''
  if (kind === 'binding' || kind === 'bindings' || kind === 'bindingVersions') {
    const surface = String(id || '').split('|')[0]
    return titles[surface] || surface
  }
  if (kind === 'state') return STATES[id] || 'AI control'
  if (kind === 'reset') return `Reset: ${RESETS[id] || id}`
  if (kind === 'aiSettings') {
    if (id === 'server') return 'Own AI for everyone'
    return String(id).startsWith('team:') ? 'A team\'s AI settings' : 'A person\'s own AI settings'
  }
  if (kind === 'providers') return `Provider ${id}`
  if (kind === 'key') return `Key of ${id}`
  if (kind === 'models') return `Model list: ${list(id)}`
  if (kind === 'intention') return 'A persona'
  if (kind === 'prompt' || kind === 'prompts' || kind === 'promptVersions') return `Prompt ${String(id || '').split('@')[0]}`
  return `${kind}${id ? ` ${id}` : ''}`
}
