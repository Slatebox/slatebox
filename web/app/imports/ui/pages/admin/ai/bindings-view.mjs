// What the Bindings and Effective tabs say, without React (so it is tested under node): the
// matrix's groups and cells in words, the editor's form turned into ai.bindings.* input and back,
// and where each field of an effective binding came from.

// Rows of the matrix, grouped as people meet them (spec 3.4).
export const GROUPS = Object.freeze([
  { title: 'Conversation', surfaces: ['chat', 'chat.route'] },
  { title: 'Drafting', surfaces: ['generation'] },
  { title: 'Boards', surfaces: ['workshop', 'workshop.draft'] },
  { title: 'Agents', surfaces: ['canvas', 'agent.slatebox', 'connectors'] },
  { title: 'Pictures and shapes', surfaces: ['vision', 'images', 'shape'] },
  { title: 'Presentation', surfaces: ['presentation'] },
  { title: 'Library', surfaces: ['library'] },
  { title: 'Everything else', surfaces: ['default'] },
])

// When a fallback is tried, in words (the binding's `on` classes).
export const ON_LABELS = Object.freeze({
  infra: 'the service fails',
  shape: 'the answer is malformed',
  context: 'the request is too long',
  any: 'anything goes wrong',
})

export const PARAM_FIELDS = Object.freeze([
  { key: 'timeoutMs', label: 'Time limit (seconds)', scale: 1000, help: 'How long one call may take.' },
  { key: 'maxTokens', label: 'Longest answer (tokens)', scale: 1, help: 'Only ever lowers what the feature asks for.' },
  { key: 'infraRetries', label: 'Retries when the service fails', scale: 1 },
  { key: 'shapeRetries', label: 'Tries for an answer in the right shape', scale: 1 },
  { key: 'temperature', label: 'Temperature (0 to 2)', scale: 1, decimal: true },
])

const usd = (micros) => `$${(micros / 1_000_000).toFixed(micros % 10000 ? 4 : 2)}`

/** A chain entry's name: a model's label, a connection's name, or the built-in AI. */
export function entryText(entry, models = []) {
  if (!entry) return ''
  if (entry.model) {
    const row = models.find((m) => m._id === entry.model)
    return row?.label || row?.model || entry.model
  }
  if (entry.connection === 'builtin') return 'Built-in AI'
  return String(entry.connection || '').replace(/^server:/, '')
}

/** A stored chain in words: "agent-9, then chat-1 when the service fails". */
export function chainText(chain = [], models = []) {
  if (!chain?.length) return null
  return chain.map((entry, index) => (index === 0 ? entryText(entry, models) : `then ${entryText(entry, models)} when ${(entry.on || ['infra']).map((c) => ON_LABELS[c] || c).join(' or ')}`)).join(', ')
}

/** A binding's parameters, tools and limits in short words for the matrix ('' when none are set). */
export function paramsText(params) {
  if (!params) return ''
  const parts = []
  if (params.timeoutMs) parts.push(`${Math.round(params.timeoutMs / 1000)} s`)
  if (params.maxTokens) parts.push(`${params.maxTokens} tokens`)
  if (Number.isInteger(params.infraRetries)) parts.push(`${params.infraRetries} retries`)
  if (Number.isInteger(params.shapeRetries)) parts.push(`${params.shapeRetries} tries`)
  if (Number.isFinite(params.temperature)) parts.push(`temperature ${params.temperature}`)
  return parts.join(', ')
}
export function toolsText(tools) {
  if (!tools) return ''
  const parts = []
  if (tools.allow?.length) parts.push(`only ${tools.allow.join(', ')}`)
  if (tools.mode) parts.push({ forced: 'always a tool', auto: 'tool when it chooses', none: 'no tools' }[tools.mode])
  return parts.join('; ')
}
export function limitsText(limits) {
  if (!limits) return ''
  const parts = []
  if (limits.ceiling) parts.push(`at most ${usd(limits.ceiling)}`)
  if (limits.estimate) parts.push(`estimate ${usd(limits.estimate)}`)
  return parts.join(', ')
}

/** The options a chain entry may name: models from the model list (on), server connections, the built-in AI. */
export function chainOptions({ models = [], connections = [] } = {}) {
  return [
    { value: 'connection:builtin', label: 'Built-in AI' },
    ...connections.filter((c) => !c.aux && c.status !== 'disabled').map((c) => ({ value: `connection:server:${c.name}`, label: `${c.name}${c.model ? ` · ${c.model}` : ''}` })),
    ...models.filter((m) => m.status !== 'disabled').map((m) => ({ value: `model:${m._id}`, label: `${m.label || m.model} · model list` })),
  ]
}

const entryValue = (entry) => (entry.model ? `model:${entry.model}` : `connection:${entry.connection}`)
const blank = (value) => value === undefined || value === null ? '' : String(value)

/** A stored binding (or none) as the editor's form. */
export function formFromBinding(head, surface) {
  const params = {}
  for (const field of PARAM_FIELDS) params[field.key] = head?.params?.[field.key] == null ? '' : String(head.params[field.key] / field.scale)
  return {
    surface,
    enabled: head ? head.enabled !== false : true,
    disabledMessage: blank(head?.disabledMessage),
    chain: (head?.chain || []).map((entry, index) => ({ value: entryValue(entry), on: index === 0 ? [] : [...(entry.on || ['infra'])] })),
    onTrip: blank(head?.onTrip),
    params,
    allow: (head?.tools?.allow || []).join(', '),
    mode: blank(head?.tools?.mode),
    ceiling: head?.limits?.ceiling ? String(head.limits.ceiling / 1_000_000) : '',
    estimate: head?.limits?.estimate ? String(head.limits.estimate / 1_000_000) : '',
  }
}

/**
 * The editor's form as ai.bindings.* input. → { binding } or { error } in words. Blank fields
 * mean "the built-in value".
 */
export function bindingFromForm(form) {
  const binding = { surface: form.surface, enabled: Boolean(form.enabled) }
  const message = String(form.disabledMessage || '').trim()
  if (message) binding.disabledMessage = message
  if (!form.enabled && !message) return { error: 'Write the message people see while it is off.' }
  if (form.chain.length) {
    binding.chain = []
    for (const [index, row] of form.chain.entries()) {
      if (!row.value) return { error: `Choose a model for line ${index + 1} of the chain.` }
      const [kind, ...rest] = row.value.split(':')
      const ref = rest.join(':')
      const entry = kind === 'model' ? { model: ref } : { connection: ref }
      if (index > 0) {
        if (!row.on?.length) return { error: `Say when line ${index + 1} is tried.` }
        entry.on = [...row.on]
      }
      binding.chain.push(entry)
    }
    // only a chain of two or more ever trips (one entry is a choice)
    if (form.chain.length > 1 && ['fallback', 'report'].includes(form.onTrip)) binding.onTrip = form.onTrip
  }
  const params = {}
  for (const field of PARAM_FIELDS) {
    const text = String(form.params?.[field.key] ?? '').trim()
    if (!text) continue
    const value = Number(text)
    if (!Number.isFinite(value)) return { error: `${field.label} is a number.` }
    params[field.key] = field.decimal ? value : Math.round(value * field.scale)
  }
  if (Object.keys(params).length) binding.params = params
  const allow = String(form.allow || '').split(/[\s,]+/).map((t) => t.trim()).filter(Boolean)
  if (allow.length || form.mode) binding.tools = { ...(allow.length && { allow }), ...(form.mode && { mode: form.mode }) }
  const limits = {}
  for (const key of ['ceiling', 'estimate']) {
    const text = String(form[key] ?? '').trim()
    if (!text) continue
    const dollars = Number(text)
    if (!Number.isFinite(dollars) || dollars <= 0) return { error: `${key === 'ceiling' ? 'The most per request' : 'The estimate'} is an amount in dollars above 0.` }
    limits[key] = Math.round(dollars * 1_000_000)
  }
  if (Object.keys(limits).length) binding.limits = limits
  return { binding }
}

/** Moves a chain line up or down (the editor's reorder buttons); the new primary keeps no `on`. */
export function moveLine(chain, index, by) {
  const to = index + by
  if (to < 0 || to >= chain.length) return chain
  const next = chain.map((row) => ({ ...row, on: [...(row.on || [])] }))
  ;[next[index], next[to]] = [next[to], next[index]]
  return next.map((row, i) => ({ ...row, on: i === 0 ? [] : row.on.length ? row.on : ['infra'] }))
}

/**
 * An effective binding's on/off in words: null while on, 'Off', or 'Off (follows Conversation and
 * edits)' for a part with no binding of its own that is off because the part it follows is.
 * titles: { [surfaceId]: title }
 */
export function offText(binding, titles = {}) {
  if (!binding || binding.enabled !== false) return null
  return binding.disabledBy ? `Off (follows ${titles[binding.disabledBy] || binding.disabledBy})` : 'Off'
}

/** Where a field of an effective binding came from, in words (resolve.mjs provenance). */
export function layerText(layer) {
  const value = String(layer || 'code')
  if (value === 'code') return 'Built in'
  if (value === 'file') return 'Settings file'
  if (value === 'db:global') return 'AI for everyone switch'
  const version = /@v(\d+)$/.exec(value)
  if (/^db:server@v/.test(value)) return `Set here (version ${version[1]})`
  if (/^db:plan/.test(value)) return `Plan override (version ${version?.[1] ?? '?'})`
  if (/^db:(me|team):choice$/.test(value)) return value.startsWith('db:me') ? 'Their own AI settings' : 'Their team\'s AI settings'
  if (value === 'db:server:choice') return 'AI settings'
  if (/^db:team/.test(value)) return 'Team override'
  if (/^db:me/.test(value)) return 'Person override'
  return value
}

/** The rows of the Effective tab for one surface: each field, its value in words and where it came from. */
export function effectiveRows(binding, models = [], titles = {}) {
  if (!binding) return []
  const p = binding.provenance || {}
  const rows = [
    { field: 'On or off', value: binding.enabled ? 'On' : `${offText(binding, titles)}: ${binding.disabledMessage}`, from: layerText(p.enabled) },
    { field: 'Model chain', value: binding.chain?.length ? binding.chain.map((c, i) => `${i ? 'then ' : ''}${c.model || entryText(c, models)}${c.connection && c.connection !== 'builtin' ? ` (${c.connection.replace(/^server:/, '')})` : c.connection === 'builtin' ? ` (built in · ${c.provider || ''})` : ''}${i ? ` when ${(c.on || []).map((o) => ON_LABELS[o] || o).join(' or ')}` : ''}`).join(', ') : 'None', from: `${layerText(p.chain)}${binding.followed ? ` · follows ${binding.followed}` : ''}` },
  ]
  for (const field of PARAM_FIELDS) {
    const value = binding.params?.[field.key]
    rows.push({ field: field.label, value: value === null || value === undefined ? 'The feature\'s own' : String(field.scale === 1000 ? value / 1000 : value), from: layerText(p[`params.${field.key}`]) })
  }
  rows.push({ field: 'Allowed tools', value: binding.tools?.allow?.length ? binding.tools.allow.join(', ') : 'Every tool the feature uses', from: layerText(p['tools.allow']) })
  rows.push({ field: 'Most per request', value: binding.limits?.ceiling ? usd(binding.limits.ceiling) : 'The meter\'s default', from: layerText(p['limits.ceiling']) })
  return rows
}
