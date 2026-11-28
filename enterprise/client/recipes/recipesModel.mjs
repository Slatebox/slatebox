// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The recipes UI's words and rules, pure so they are tested in node (scripts/recipes-ui.test.mjs):
// state chips, "runs for Ana", last and next run lines, schedule presets, the form a recipe's
// configSchema makes, the standing-permission rows, webhook events and samples, and the run and
// delivery tables. The server checks everything again (enterprise/server/recipes/*): the UI only
// leaves out what would be refused, so no control does nothing.

export const RECIPES_OFF_COPY = 'An admin turns recipes on in Admin › Recipes.'

export const INTEGRATION_WORDS = Object.freeze({
  github: 'GitHub', linear: 'Linear', slack: 'Slack', google: 'Google Drive', null: 'Webhooks and schedules',
})
const INTEGRATION_ORDER = ['github', 'linear', 'slack', 'google', null]

export const STATE_WORDS = Object.freeze({
  draft: { label: 'Draft', color: 'default', help: 'Not turned on yet.' },
  active: { label: 'On', color: 'success', help: 'Runs on its triggers.' },
  paused: { label: 'Paused', color: 'default', help: 'Paused. Nothing runs until it is resumed.' },
  needs_sign_in: { label: 'Needs sign-in', color: 'warning', help: 'Its integration needs signing in again.' },
  blocked_access: { label: 'Lost access', color: 'warning', help: 'Its owner no longer has access to this project. A manager can take it over.' },
  blocked_limit: { label: 'Over its limit', color: 'warning', help: 'It reached its run or usage limit for now.' },
  failed: { label: 'Stopped after errors', color: 'error', help: 'It failed 3 times in a row and paused itself.' },
})

export const stateChip = (state) => STATE_WORDS[state] || { label: 'Unknown', color: 'default', help: '' }

/** Why a recipe stopped, said on its card (the runtime pauses with a reason; a person's pause has none to tell). */
export const PAUSED_WORDS = Object.freeze({
  failures: { label: 'Stopped after errors', color: 'error', help: 'It failed 3 times in a row and paused itself. Runs says why; Resume tries again.' },
  sign_in: { label: 'Needs sign-in', color: 'warning', help: 'Sign in to its integration again, then resume it.' },
  access: { label: 'Lost access', color: 'warning', help: 'Its owner no longer has access to this project. A manager can take it over.' },
  grant_revoked: { label: 'Paused', color: 'warning', help: 'A permission it used was taken back. Resume runs it without that change.' },
  permissions_changed: { label: 'Paused', color: 'warning', help: 'Its integration’s permissions changed. Check them, then resume it.' },
  uninstalled: { label: 'Paused', color: 'warning', help: 'The Slatebox app was removed from its integration. Add it again, then resume it.' },
  unknown_recipe: { label: 'Paused', color: 'warning', help: 'This server no longer carries this recipe.' },
})
/** The chip for an instance: its state, or why it was paused. */
export const instanceChip = (instance) => (instance?.state === 'paused' && PAUSED_WORDS[instance.pausedReason]) || stateChip(instance?.state)
/** States a person can resume from (Resume runs it again; sign-in and access need fixing first). */
export const canResume = (state) => ['paused', 'failed', 'blocked_limit'].includes(state)
export const canPause = (state) => state === 'active'

export const RUN_STATE_WORDS = Object.freeze({
  queued: 'Waiting', running: 'Running', done: 'Done', partial: 'Partly done', failed: 'Failed', skipped: 'Skipped', cancelled: 'Canceled',
})
export const SKIPPED_WORDS = Object.freeze({
  paused: 'paused', kill_switch: 'recipes are off', no_change: 'nothing had changed', debounced: 'folded into the next run',
  budget: 'over its budget', blocked_access: 'lost access', slate_changed: 'the slate changed while it worked', hook_failed: 'a webhook did not answer',
})

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || ''
/** "GitHub architect · runs for Ana": the agent's name and whose sign-ins it uses. */
export function runsFor(agentName, ownerName) {
  const who = firstName(ownerName)
  return who ? `${agentName} · runs for ${who}` : agentName
}

const MINUTE = 60e3
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const time = (at) => (at instanceof Date ? at.getTime() : typeof at === 'string' || typeof at === 'number' ? new Date(at).getTime() : NaN)

export function ago(at, now = Date.now()) {
  const t = time(at)
  if (!Number.isFinite(t)) return ''
  const d = Math.max(0, now - t)
  if (d < MINUTE) return 'just now'
  if (d < HOUR) return `${Math.floor(d / MINUTE)} min ago`
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`
  if (d < 2 * DAY) return 'yesterday'
  return `${Math.floor(d / DAY)} days ago`
}

export function until(at, now = Date.now()) {
  const t = time(at)
  if (!Number.isFinite(t)) return ''
  const d = t - now
  if (d <= MINUTE) return 'any moment'
  if (d < HOUR) return `in ${Math.ceil(d / MINUTE)} min`
  if (d < DAY) return `in ${Math.round(d / HOUR)} h`
  if (d < 2 * DAY) return 'tomorrow'
  return `in ${Math.round(d / DAY)} days`
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "2 min ago · 3 notes changed" for an instance card. */
export function lastRunLine(lastRun, now = Date.now()) {
  if (!lastRun?.at) return 'No runs yet'
  const when = ago(lastRun.at, now)
  const changed = Number(lastRun.ops ?? lastRun.changed ?? 0)
  if (lastRun.outcome === 'failed') return `${when} · failed (Runs says why)`
  if (lastRun.outcome === 'skipped') return `${when} · skipped`
  const line = `${when} · ${changed ? `${plural(changed, 'note')} changed` : 'nothing changed'}`
  return lastRun.outcome === 'partial' ? `${line} · done in part` : line
}

export const EVENT_TRIGGER_WORDS = Object.freeze({
  'github.push': 'On every push',
  'github.pull_request': 'On every pull request',
  'slack.fold': 'As the channels talk (every 30 minutes)',
  'google.watch': 'When the file changes',
  'project.slates_changed': 'When the project’s slates change',
  'recipe.after': 'After another recipe changes its slates',
  'slate.saved': 'When someone edits a kept slate',
})

export const RECIPE_EVENT_WORDS = Object.freeze({
  'architecture.updated': 'After Living architecture changes a synced slate',
})

/** "10 minutes", "1 minute", "30 seconds": a trigger's quiet time. */
export function quietWords(ms) {
  const n = Number.isFinite(ms) ? ms : 0
  if (n >= 60000) return plural(Math.round(n / 60000), 'minute')
  return plural(Math.max(0, Math.round(n / 1000)), 'second')
}

export const CRON_PRESETS = Object.freeze([
  { id: 'every-15', label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { id: 'hourly', label: 'Every hour', cron: '0 * * * *' },
  { id: 'daily-3', label: 'Every day at 03:00', cron: '0 3 * * *' },
  { id: 'daily-9', label: 'Every day at 09:00', cron: '0 9 * * *' },
  { id: 'weekday-18', label: 'Every weekday at 18:00', cron: '0 18 * * 1-5' },
  { id: 'monday-0730', label: 'Every Monday at 07:30', cron: '30 7 * * 1' },
  { id: 'monday-8', label: 'Every Monday at 08:00', cron: '0 8 * * 1' },
])

export function cronWords(cron) {
  const preset = CRON_PRESETS.find((p) => p.cron === String(cron || '').trim())
  return preset ? preset.label : `On the schedule ${cron}`
}

const FIELD_RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
function fieldOk(part, [lo, hi]) {
  return part.split(',').every((piece) => {
    const [range, step] = piece.split('/')
    if (step !== undefined && !/^\d+$/.test(step)) return false
    if (range === '*') return true
    const [a, b] = range.split('-')
    const n = (x) => /^\d+$/.test(x) && Number(x) >= lo && Number(x) <= hi
    return b === undefined ? n(a) : n(a) && n(b) && Number(a) <= Number(b)
  })
}

/** The smallest gap, in minutes, between runs the minute field allows (60 for one fixed minute). */
function minuteGap(minute) {
  if (minute === '*') return 1
  const step = minute.match(/^\*\/(\d+)$/)
  if (step) return Number(step[1])
  if (/^\d+$/.test(minute)) return 60
  const values = minute.split(',').flatMap((piece) => {
    const [range, s] = piece.split('/')
    const [a, b = a] = range === '*' ? ['0', '59'] : range.split('-')
    const out = []
    for (let i = Number(a); i <= Number(b); i += Number(s || 1)) out.push(i)
    return out
  }).sort((x, y) => x - y)
  if (values.length < 2) return 60
  let gap = 60 - values[values.length - 1] + values[0]
  for (let i = 1; i < values.length; i += 1) gap = Math.min(gap, values[i] - values[i - 1])
  return gap
}

/** A five-field schedule, no more often than every `minMinutes` (RECIPE_LIMITS.minScheduleMinutes). */
export function validateCron(cron, { minMinutes = 15 } = {}) {
  const parts = String(cron || '').trim().split(/\s+/)
  if (parts.length !== 5) return { ok: false, error: 'A schedule has five parts: minute, hour, day, month and weekday.' }
  if (!parts.every((p, i) => fieldOk(p, FIELD_RANGES[i]))) return { ok: false, error: 'One of the five parts is not a valid value.' }
  if (minuteGap(parts[0]) < minMinutes) return { ok: false, error: `Recipes run at most every ${minMinutes} minutes.` }
  return { ok: true, error: null }
}

export function triggerWords(trigger) {
  if (!trigger) return ''
  if (trigger.kind === 'schedule') return cronWords(trigger.cron)
  if (trigger.kind === 'vendor') return EVENT_TRIGGER_WORDS[trigger.event] || `On ${trigger.event}`
  if (trigger.kind === 'manual') return 'When someone clicks Run now'
  if (trigger.kind === 'inbound') return 'When a webhook calls it'
  if (trigger.kind === 'slate_saved') return `When someone edits a synced slate (${quietWords(trigger.debounceMs)} after the last edit)`
  if (trigger.kind === 'recipe_event') return RECIPE_EVENT_WORDS[trigger.event] || 'After another recipe changes a synced slate'
  return trigger.kind
}

/** "Next run in 5 min", "Runs on every push", or why it will not run. */
export function nextRunLine(instance, now = Date.now()) {
  if (!instance) return ''
  if (instance.state !== 'active') return instanceChip(instance).help
  if (instance.nextDueAt) return `Next run ${until(instance.nextDueAt, now)}`
  const vendor = (instance.triggers || []).find((t) => t.kind === 'vendor')
  if (vendor) return `Runs ${triggerWords(vendor).replace(/^On /, 'on ')}`
  if ((instance.triggers || []).some((t) => t.kind === 'slate_saved')) return 'Runs after someone edits a synced slate'
  if ((instance.triggers || []).some((t) => t.kind === 'inbound')) return 'Runs when a webhook calls it'
  return 'Runs when someone clicks Run now'
}

export const COST_WORDS = Object.freeze({
  low: 'Light: mostly reads, little agent work',
  medium: 'Some agent work each run',
  high: 'Heavy: agent work on every run',
})

/** The catalog by integration, GitHub first and webhook/schedule recipes last. */
export function groupCatalog(recipes) {
  const list = Array.isArray(recipes) ? recipes : []
  return INTEGRATION_ORDER
    .map((integration) => ({
      integration,
      label: INTEGRATION_WORDS[integration],
      recipes: list.filter((r) => (r.integration ?? null) === integration).sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .filter((g) => g.recipes.length)
}

/** "Makes: Service map, Modules for each repo, What changed (board)". */
export function outputsLine(manifest) {
  const names = (manifest?.outputs || []).filter((o) => o.role !== 'status').map((o) => {
    const name = String(o.name || o.role).replace(/\s*[—-]\s*\{[^}]+\}/g, '').replace(/\{[^}]+\}/g, '').trim()
    const per = o.per ? ` for each ${o.per}` : ''
    return `${name}${per}${o.kind === 'board' ? ' (board)' : ''}`
  })
  return names.length ? `Makes: ${names.join(', ')}` : ''
}

/** Whether the recipe's integration still needs connecting (the dialog's step 2). */
export function needsConnection(manifest) {
  return Boolean(manifest?.integration) && manifest.connected !== true
}

const humanize = (key) => {
  const words = String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The form a recipe's configSchema makes (ConfigForm.jsx): one field per property, in order.
 * `x-slatebox-picker` names a picker: 'repos' (GitHub repos the install sees), 'channels' (Slack
 * channels the person is in), 'files' (Google Picker), 'cron' (schedule presets), 'paths' (globs).
 */
// The recipes' own picker names (x-picker in enterprise/recipes/*/manifest.mjs) as the form's.
// 'server': Slatebox fills the value in from the person's connection (the Slack workspace), so the
// form shows no field for it.
const X_PICKERS = Object.freeze({ 'slack.channel': 'channels', 'google.doc': 'files', 'google.sheet': 'files', 'slack.workspace': 'server' })
const pickerOf = (p) => p['x-slatebox-picker'] || X_PICKERS[p['x-picker']] || null

export function configFields(schema) {
  const props = schema?.properties || {}
  const required = new Set(schema?.required || [])
  return Object.entries(props).filter(([, p]) => pickerOf(p) !== 'server').map(([key, p]) => {
    const picker = pickerOf(p)
    let kind = 'text'
    if (picker === 'repos' && p.type !== 'array') kind = 'repos'
    else if (picker) kind = picker
    else if (Array.isArray(p.enum)) kind = 'select'
    else if (p.type === 'boolean') kind = 'boolean'
    else if (p.type === 'integer' || p.type === 'number') kind = 'number'
    else if (p.type === 'array' && Array.isArray(p.items?.enum)) kind = 'multiselect'
    else if (p.type === 'array') kind = 'list'
    return {
      key,
      kind,
      label: p.title || humanize(key),
      help: p.description || '',
      required: required.has(key),
      default: p.default,
      options: Array.isArray(p.enum) ? p.enum : Array.isArray(p.items?.enum) ? p.items.enum : null,
      optionLabels: p['x-slatebox-labels'] || null,
      min: p.minimum ?? p.minItems ?? p.minLength ?? null,
      max: p.maximum ?? p.maxItems ?? p.maxLength ?? null,
      multiple: p.type === 'array',
    }
  })
}

export function defaultConfig(schema) {
  const out = {}
  for (const f of configFields(schema)) {
    if (f.default !== undefined) out[f.key] = f.default
    else if (f.multiple) out[f.key] = []
    else if (f.kind === 'boolean') out[f.key] = false
  }
  return out
}

/** The schema's own rules on a config (the server validates again): errors by field key. */
export function validateConfig(schema, value) {
  const errors = {}
  const props = schema?.properties || {}
  const v = value || {}
  for (const key of schema?.required || []) {
    const x = v[key]
    if (x === undefined || x === null || x === '' || (Array.isArray(x) && !x.length)) errors[key] = 'Fill this in.'
  }
  for (const [key, p] of Object.entries(props)) {
    const x = v[key]
    if (errors[key] || x === undefined || x === null || x === '') continue
    if (p.type === 'string' && typeof x !== 'string') errors[key] = 'Enter text.'
    else if ((p.type === 'integer' || p.type === 'number') && (typeof x !== 'number' || !Number.isFinite(x) || (p.type === 'integer' && !Number.isInteger(x)))) errors[key] = 'Enter a number.'
    else if (p.type === 'boolean' && typeof x !== 'boolean') errors[key] = 'Choose yes or no.'
    else if (p.type === 'array' && !Array.isArray(x)) errors[key] = 'Choose one or more.'
    else if (Array.isArray(p.enum) && !p.enum.includes(x)) errors[key] = 'Choose one of the options.'
    else if (typeof x === 'number' && p.minimum !== undefined && x < p.minimum) errors[key] = `At least ${p.minimum}.`
    else if (typeof x === 'number' && p.maximum !== undefined && x > p.maximum) errors[key] = `At most ${p.maximum}.`
    else if (typeof x === 'string' && p.maxLength !== undefined && x.length > p.maxLength) errors[key] = `At most ${p.maxLength} characters.`
    else if (typeof x === 'string' && p.minLength !== undefined && x.length < p.minLength) errors[key] = `At least ${p.minLength} characters.`
    else if (Array.isArray(x) && p.minItems !== undefined && x.length < p.minItems) errors[key] = `Choose at least ${p.minItems}.`
    else if (Array.isArray(x) && p.maxItems !== undefined && x.length > p.maxItems) errors[key] = `Choose at most ${p.maxItems}.`
    else if (Array.isArray(x) && Array.isArray(p.items?.enum) && x.some((i) => !p.items.enum.includes(i))) errors[key] = 'Choose from the options.'
    else if (pickerOf(p) === 'cron') { const c = validateCron(x); if (!c.ok) errors[key] = c.error }
  }
  if (schema?.additionalProperties === false) {
    for (const key of Object.keys(v)) if (!props[key]) errors[key] = 'This recipe has no such setting.'
  }
  return { ok: Object.keys(errors).length === 0, errors }
}

const list = (items, none) => {
  const a = (Array.isArray(items) ? items : []).filter(Boolean)
  if (!a.length) return none
  if (a.length === 1) return a[0]
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`
}

export const WRITE_KIND_WORDS = Object.freeze({
  'github.check_run': (s) => `Add a check to pushes in ${list(s.repos, 'the chosen repos')}`,
  'github.pr_comment': (s) => `Comment on pull requests in ${list(s.repos, 'the chosen repos')}, one comment kept up to date`,
  'github.pull_request': (s) => `Open pull requests in ${list(s.repos, 'the chosen repos')} on branches named slatebox/…, changing only ${list(s.paths, 'the mapped files')}`,
  'slack.post': (s) => `Post to ${list((s.channels || []).map((c) => (String(c).startsWith('#') ? c : `#${c}`)), 'the chosen channels')}`,
  'google.write_sheet': (s) => `Write back to ${list(s.files, 'the chosen sheets')}`,
})

/** The exact words for one outside change a recipe may make, with its scope filled in. */
export function writePermissionText(kind, scope = {}) {
  const words = WRITE_KIND_WORDS[kind]
  return words ? words(scope || {}) : `Make ${kind} changes`
}

/** The paths a sync map writes: its folder (all of it) and any mapped file outside the folder. */
export function syncPaths(config = {}) {
  const raw = typeof config.folder === 'string' ? config.folder : 'docs/architecture/'
  const folder = raw && !raw.endsWith('/') ? `${raw}/` : raw
  const files = (config.maps || []).map((m) => m?.file).filter((f) => typeof f === 'string' && f && !(folder && f.startsWith(folder)))
  return [...new Set([folder ? `${folder}**` : '**', ...files])]
}

/** "Synced with acme/api docs/architecture/checkout.mmd @ 1a2b3c4", for a synced slate. */
export function syncedLine(s) {
  if (!s?.repo) return ''
  const where = [s.repo, s.path].filter(Boolean).join(' ')
  return `Synced with ${where}${s.commit ? ` @ ${String(s.commit).slice(0, 7)}` : ''}`
}

/** What a synced slate says beside its line: changes waiting in a pull request, or the next save. */
export function syncedState(s, now = Date.now()) {
  if (!s) return ''
  if (s.state !== 'active') return 'Paused: edits are not saved to the repository until it is resumed.'
  if (s.savesDueAt) return `Your edits go to the repository ${until(s.savesDueAt, now)}.`
  if (s.pending) return 'Changes wait in the pull request for a review.'
  return 'Up to date with the repository.'
}

/** A file for the browser to download (a Mermaid file from a waiting change): its name and text. */
export function downloadName(path) {
  return String(path || 'diagram.mmd').split('/').pop().replace(/[^\w.-]+/g, '-') || 'diagram.mmd'
}

/**
 * The standing-permission rows for an instance: each kind the manifest may write, its exact scope
 * (from the config: repos, channels, paths, files), and whether it is granted. Unchecked by default.
 * A kind the install has not verified (offered: false) is left out, never shown disabled.
 */
export function permissionRows(manifest, config = {}, grants = []) {
  return (manifest?.writes || []).filter((w) => w.offered !== false).map((w) => {
    const scope = scopeFromConfig(w.kind, config)
    const grant = (grants || []).find((g) => g.kind === w.kind && !g.revokedAt)
    return { kind: w.kind, scope, text: writePermissionText(w.kind, scope), granted: Boolean(grant), grantId: grant?._id || grant?.grantId || null, expiresAt: grant?.expiresAt || null }
  })
}

export function scopeFromConfig(kind, config = {}) {
  const c = config || {}
  // Diagrams as code: one repository, its folder and each mapped file outside it, slatebox/ branches.
  if (kind === 'github.pull_request' && typeof c.repo === 'string') return { repos: [c.repo], branchPrefix: 'slatebox/', paths: syncPaths(c) }
  if (kind.startsWith('github.')) return { repos: c.repos || (c.repo ? [c.repo] : []), ...(kind === 'github.pull_request' && { paths: c.paths || ['docs/architecture/*.mmd'] }) }
  if (kind === 'slack.post') return { channels: c.postChannels || c.channels || [] }
  if (kind === 'google.write_sheet') return { files: c.fileNames || c.files || [] }
  // Linear: the teams the recipe reads, and only an issue's status.
  if (kind === 'linear.update_item') return { teams: c.teams || [], fields: ['state'] }
  if (kind === 'linear.comment') return { teams: c.teams || [] }
  return {}
}

// The events every recipe sends (enterprise/common/recipes/events.mjs), and what each means.
export const COMMON_EVENTS = Object.freeze([
  { id: 'run.started', label: 'A run started' },
  { id: 'run.finished', label: 'A run finished' },
  { id: 'run.failed', label: 'A run failed' },
  { id: 'slate.updated', label: 'A slate was updated' },
  { id: 'diagram.changed', label: 'A diagram changed (with its Mermaid)' },
  { id: 'approval.needed', label: 'A change outside Slatebox waits for approval' },
  { id: 'writeback.done', label: 'A change outside Slatebox was made' },
  { id: 'writeback.declined', label: 'A change outside Slatebox was declined' },
  { id: 'recipe.paused', label: 'The recipe paused' },
  { id: 'recipe.resumed', label: 'The recipe resumed' },
])

/** The outbound hook's checklist: the common events, then the recipe's own (none for a project-wide hook). */
export function hookEvents(manifest) {
  const own = (manifest?.events || []).map((id) => ({ id, label: humanize(id.replace(/\./g, ' ')), own: true }))
  return [...COMMON_EVENTS, ...own]
}

export const INTERCEPT_WORDS = Object.freeze({
  'graph.ready': 'Before it draws: add, change or drop parts of the diagram',
  'output.ready': 'After it draws: add up to 12 notes beside the legend',
  'writeback.proposed': 'Before a change outside Slatebox: approve, veto or hold it',
})

export function interceptPoints(manifest) {
  const points = [...(manifest?.intercepts || [])]
  if ((manifest?.writes || []).length && !points.includes('writeback.proposed')) points.push('writeback.proposed')
  return points.map((id) => ({ id, label: INTERCEPT_WORDS[id] || id }))
}

/** A URL an outbound hook or intercept may call: https, and not a local or private address (the server checks again). */
export function hookUrlProblem(url) {
  let u
  try { u = new URL(String(url || '').trim()) } catch { return 'Enter the full address, starting with https://' }
  if (u.protocol !== 'https:') return 'The address must start with https://'
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return 'The address must be reachable on the internet.'
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '::1' || /^f[cd]/i.test(host)) return 'The address must be reachable on the internet.'
  return null
}

/**
 * The curl sample for an inbound hook: the body signed with the hook's secret, as Slatebox signs
 * outbound ones (t=<unix>,v1=<hex hmac_sha256(secret, t + "." + body)>). The secret stays in an
 * environment variable; it is never written into the sample.
 */
export function inboundCurlSample(url, inputExample = {}) {
  const body = JSON.stringify({ reason: 'Called from my build', data: inputExample || {} })
  return [
    `BODY='${body.replace(/'/g, "'\\''")}'`,
    'T=$(date +%s)',
    'SIG=$(printf \'%s.%s\' "$T" "$BODY" | openssl dgst -sha256 -hmac "$SLATEBOX_HOOK_SECRET" | sed \'s/^.* //\')',
    `curl -X POST '${url}' \\`,
    "  -H 'Content-Type: application/json' \\",
    '  -H "Slatebox-Signature: t=$T,v1=$SIG" \\',
    '  -H "Slatebox-Delivery: $(uuidgen)" \\',
    '  --data "$BODY"',
  ].join('\n')
}

export function formatDuration(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1000) return `${Math.round(n)} ms`
  const s = Math.round(n / 1000)
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

export function formatTokens(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return '0'
  if (v < 1000) return String(Math.round(v))
  if (v < 1e6) return `${(v / 1000).toFixed(v < 10000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`
}

const TRIGGER_KIND_WORDS = { schedule: 'Schedule', vendor: 'Change', manual: 'Run now', inbound: 'Webhook' }

/** One row of the run history (RecipeRuns.jsx). */
export function runRow(run, now = Date.now()) {
  const stats = run?.stats || {}
  const added = stats.added || 0
  const updated = stats.updated || 0
  const removed = stats.removed || 0
  const writes = run?.writes || []
  const state = RUN_STATE_WORDS[run?.state] || run?.state || ''
  return {
    id: run?._id,
    when: ago(run?.startedAt || run?.dueAt, now),
    trigger: run?.trigger?.kind === 'vendor' ? (EVENT_TRIGGER_WORDS[run.trigger.event] || run.trigger.event) : (TRIGGER_KIND_WORDS[run?.trigger?.kind] || ''),
    preview: run?.mode === 'preview',
    state: run?.state === 'skipped' && run.skippedReason ? `${state}: ${SKIPPED_WORDS[run.skippedReason] || run.skippedReason}` : state,
    duration: formatDuration(run?.durationMs),
    tokens: formatTokens((stats.tokensIn || 0) + (stats.tokensOut || 0)),
    changes: added + updated + removed ? [added && `${added} added`, updated && `${updated} updated`, removed && `${removed} removed`].filter(Boolean).join(', ') : 'No changes',
    kept: stats.keptByPerson ? `${plural(stats.keptByPerson, 'note')} kept as people left them` : '',
    slates: run?.changes ? [...new Set(run.changes.map((c) => c.slateId))] : [],
    writes: writes.map((w) => ({ text: `${w.kind}${w.target?.repo ? ` · ${w.target.repo}` : ''}${w.target?.channel ? ` · ${w.target.channel}` : ''}`, state: w.state === 'card' ? 'waiting for approval' : w.state })),
    undoable: ['done', 'partial'].includes(run?.state) && (run?.changes || []).some((c) => c.outcome === 'saved'),
    log: (run?.log || []).map((l) => ({ ...l, when: ago(l.at, now) })),
    error: run?.error ? [run.error.name, run.error.code, run.error.status].filter(Boolean).join(' · ') : '',
  }
}

/** One row of a hook's delivery log. */
export function deliveryRow(d, now = Date.now()) {
  const words = { pending: 'Waiting to retry', delivered: 'Delivered', failed: 'Failed', dead: 'Gave up' }
  return {
    id: d?._id,
    event: d?.event,
    attempt: d?.attempt ?? 1,
    state: words[d?.state] || d?.state,
    code: d?.responseCode ?? '',
    duration: formatDuration(d?.durationMs),
    when: ago(d?.nextAt || d?.at, now),
  }
}

/**
 * The slate's agent panel: one line per recipe keeping notes on this slate.
 * @param {Array<{instanceId, agentName, ownerName, noteIds: string[], personNoteIds?: string[]}>} instances recipes.notesOn's answer
 */
export function maintainedSummary(instances) {
  return (Array.isArray(instances) ? instances : []).filter((i) => (i.noteIds || []).length).map((i) => ({
    instanceId: i.instanceId,
    agent: runsFor(i.agentName, i.ownerName),
    count: i.noteIds.length,
    line: `Maintained by ${runsFor(i.agentName, i.ownerName)}: ${plural(i.noteIds.length, 'note')}`,
    noteIds: i.noteIds,
  }))
}

/** The selected notes a recipe keeps up to date, by recipe ("Kept up to date by GitHub architect"). */
export function selectedMaintained(instances, selectedIds) {
  const picked = new Set(selectedIds || [])
  return (Array.isArray(instances) ? instances : []).map((i) => ({
    instanceId: i.instanceId,
    agentName: i.agentName,
    noteIds: (i.noteIds || []).filter((id) => picked.has(id)),
  })).filter((i) => i.noteIds.length).map((i) => ({ ...i, line: `Kept up to date by ${i.agentName}` }))
}

/** The first run's preview, in one line: "Makes 3 slates · 42 notes, 18 connectors · about 12k tokens". */
export function previewSummary(preview) {
  const slates = preview?.slates || []
  const sum = (k) => slates.reduce((n, s) => n + (Number(s.counts?.[k]) || 0), 0)
  const parts = [`Makes ${plural(slates.length, 'slate')}`]
  const what = [sum('notes') && plural(sum('notes'), 'note'), sum('connectors') && plural(sum('connectors'), 'connector'), sum('cards') && plural(sum('cards'), 'card')].filter(Boolean)
  if (what.length) parts.push(what.join(', '))
  const tokens = (preview?.tokens?.in || 0) + (preview?.tokens?.out || 0)
  if (tokens) parts.push(`about ${formatTokens(tokens)} tokens a run`)
  return parts.join(' · ')
}

/** What the recipes UI shows here: 'on', 'off-admin' (the switch, for a server admin) or 'hidden'. */
export function recipesAvailability({ answer = null, error = null, admin = false } = {}) {
  if (answer && !error) return 'on'
  const code = error?.error || error?.code
  if (code === 'recipes_off') return admin ? 'off-admin' : 'hidden'
  return 'hidden'
}

/** A refusal from a recipes.* action, in words to show. */
export function recipeErrorWords(error) {
  const code = error?.error || error?.code
  const words = {
    recipes_off: RECIPES_OFF_COPY,
    recipes_team_off: 'Your team’s admins have turned recipes off for the team.',
    limit_instances: 'You have the most recipes one person can run. Delete one first.',
    rate_limited: 'It ran a lot in the last hour. Try again later.',
    needs_sign_in: 'Its integration needs signing in again.',
    forbidden: 'You don’t have permission to do that here.',
    bad_config: 'Some settings need fixing.',
    not_found: 'This recipe isn’t here any more.',
    timeout: 'The preview took too long. Try fewer repos or channels.',
  }
  return words[code] || error?.reason || 'That didn’t work. Try again.'
}

/** The add-recipe dialog's steps; connecting is skipped when the integration is already connected. */
export function addRecipeSteps(manifest) {
  const steps = [{ id: 'pick', label: 'Pick a recipe' }]
  if (!manifest || needsConnection(manifest)) steps.push({ id: 'connect', label: 'Connect' })
  steps.push({ id: 'configure', label: 'Set it up' }, { id: 'preview', label: 'Preview and turn on' })
  return steps
}

// The triggers the setup step offers as switches.
const OPTIONAL_KINDS = Object.freeze(['vendor', 'schedule', 'slate_saved', 'recipe_event'])

/**
 * The triggers a new instance starts with: the manifest's defaults, and Run now always. Inbound runs
 * come from an inbound webhook (RecipeHooks), so they are added there, not here.
 */
export function defaultTriggers(manifest, tz = 'UTC') {
  const out = []
  for (const t of manifest?.triggers || []) {
    if (t.default !== true || !OPTIONAL_KINDS.includes(t.kind)) continue
    out.push(triggerFrom(t, tz))
  }
  if ((manifest?.triggers || []).some((t) => t.kind === 'manual') || !out.length) out.push({ kind: 'manual' })
  return out
}

/** The optional triggers the setup step offers as switches (everything but Run now and webhooks). */
export function optionalTriggers(manifest) {
  return (manifest?.triggers || []).filter((t) => OPTIONAL_KINDS.includes(t.kind))
    .map((t) => ({ ...t, key: triggerKey(t), label: triggerWords(t) }))
}

// One trigger as an instance keeps it.
export function triggerFrom(t, tz = 'UTC') {
  if (t.kind === 'schedule') return { kind: 'schedule', cron: t.cron, tz }
  if (t.kind === 'vendor') return { kind: 'vendor', event: t.event, ...(t.debounceMs && { debounceMs: t.debounceMs }) }
  if (t.kind === 'slate_saved') return { kind: 'slate_saved', ...(t.debounceMs && { debounceMs: t.debounceMs }) }
  if (t.kind === 'recipe_event') return { kind: 'recipe_event', event: t.event }
  return { kind: t.kind }
}

export const triggerKey = (t) => (t.kind === 'vendor' || t.kind === 'recipe_event' ? `${t.kind}:${t.event}` : t.kind)

/** A config as it is sent: a sync map's rows with no slate picked yet are left out. */
export function withoutEmptyMaps(config = {}) {
  if (!Array.isArray(config?.maps)) return config
  return { ...config, maps: config.maps.filter((m) => m && typeof m.shareId === 'string' && m.shareId) }
}

/** recipes.create's answer as the dialog keeps it: the instance, with _id (the server says instanceId). */
export function createdInstance(answer) {
  const made = answer?.instance || answer?.recipe || null
  return made ? { ...made, _id: made._id || made.instanceId } : null
}

/** recipes.get's live permissions as the permission rows read them (_id, kind). */
export function grantsOf(got) {
  return (got?.grants || got?.permissions || []).map((g) => ({ ...g, _id: g._id || g.grantId }))
}

/** "Living architecture · acme/api": the label and what it watches. */
export function instanceName(manifest, config = {}) {
  const c = config || {}
  const target = (c.repos || (c.repo ? [c.repo] : null) || c.channels || []).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean)
  const files = (c.files || []).map((f) => f?.name).filter(Boolean)
  const what = [...target, ...files]
  if (!what.length) return manifest?.label || 'Recipe'
  return `${manifest.label} · ${what.slice(0, 2).join(', ')}${what.length > 2 ? ` +${what.length - 2}` : ''}`
}
