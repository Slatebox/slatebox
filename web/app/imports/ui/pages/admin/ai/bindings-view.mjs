// What the Bindings, Overview and "What a person gets" tabs say, without React (so it is tested
// under node): where a part's model comes from, a route in words ("Meta (Muse) · Muse Ember"), the
// options of a part's one dropdown, and what a Save sends.

/** A route in words: what the provider is and the model's name, or why it cannot answer. */
export function routeText(route) {
  if (!route) return '—'
  if (route.error) return route.error
  if (route.aux) return route.label || 'Built-in image service'
  return `${route.providerLabel || route.provider} · ${route.label || route.model}`
}

/** Where a part's model comes from, in words. titles: { [surfaceId]: title } */
export function sourceText(resolved, titles = {}) {
  if (!resolved) return ''
  if (resolved.own) return `Their own AI (${resolved.own.label})`
  switch (resolved.source) {
    case 'off-global': return 'AI is off for everyone'
    case 'off': return resolved.disabledBy ? `Turned off (follows ${titles[resolved.disabledBy] || resolved.disabledBy})` : 'Turned off'
    case 'part': return 'Set for this part'
    case 'followed': return `Follows ${titles[resolved.followed] || resolved.followed}`
    case 'stability': return 'Built-in image service'
    case 'default': return 'The default'
    case 'builtin': return 'The built-in default'
    default: return resolved.source || ''
  }
}

const VERB = { tools: 'cannot call tools', vision: 'cannot read images', images: 'cannot make images' }
/** Why a model cannot serve a part (its flags miss what the part needs), or null. */
export function gapOf(needs = [], model = {}) {
  const caps = model.capabilities || {}
  const need = needs.find((n) => (n === 'images' ? caps.images !== true : caps[n] === false))
  return need ? VERB[need] : null
}

/**
 * The options of one part's dropdown, grouped by provider: every enabled model, disabled with the
 * reason when it cannot do what the part needs; a provider with no key says so.
 * → [{ provider, label, hasKey, items: [{ value, label, disabled, reason }] }]
 */
export function choiceGroups({ providers = [], models = [], keys = {}, needs = [] }) {
  return providers
    .filter((p) => !p.aux && p.status !== 'archived')
    .map((p) => ({
      provider: p.id, label: p.label, hasKey: Boolean(keys[p.id]),
      items: models.filter((m) => m.provider === p.id && m.status !== 'disabled').map((m) => {
        const reason = gapOf(needs, m)
        return { value: m._id, label: m.label || m.model, disabled: Boolean(reason), reason }
      }),
    }))
    .filter((group) => group.items.length)
}

/**
 * "Use the default (…)": what the default resolves to for this part. surface: a row of
 * ai.bindings.list; rows: every row (for the parent it follows); defaultRoute: ai.control.get's.
 */
export function defaultChoiceText(surface, rows = [], defaultRoute = null) {
  if (surface.surface === 'default') return `Use the built-in default (Meta (Muse) · Muse Ember)`
  if (surface.surface === 'images') return 'Use the default (the built-in image service, Stability)'
  const parent = surface.follows && surface.follows !== 'default' ? rows.find((r) => r.surface === surface.follows) : null
  if (parent && parent.binding?.use !== 'default') {
    const route = parent.binding.use === 'off' ? 'turned off' : routeText(parent.resolved?.route)
    return `Use the default (follows ${parent.title}: ${route})`
  }
  if (parent?.resolved?.followed || parent?.resolved?.source === 'followed') return `Use the default (follows ${parent.title}: ${routeText(parent.resolved.route)})`
  return `Use the default (${routeText(defaultRoute)})`
}

/** A row's choice as the dropdown's value: 'default', 'off' or a model id. */
export const choiceValue = (binding) => (!binding || binding.use === 'default' ? 'default' : binding.use === 'off' ? 'off' : binding.model)

/** What a Save sends: only the rows whose choice changed. saved/draft: { [surface]: value } */
export function changesOf(saved = {}, draft = {}) {
  return Object.entries(draft)
    .filter(([surface, value]) => (saved[surface] ?? 'default') !== value)
    .map(([surface, value]) => (value === 'default' || value === 'off' ? { surface, use: value } : { surface, use: 'model', model: value }))
}
