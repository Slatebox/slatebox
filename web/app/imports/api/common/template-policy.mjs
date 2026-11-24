export function userSelectableTemplateSelector(additional = {}) {
  return {
    ...additional,
    'options.isTemplate': true,
    'options.templateApproved': true,
  }
}

export function isUserSelectableTemplate(template) {
  return Boolean(
    template &&
    template.options?.isTemplate === true &&
    template.options?.templateApproved === true
  )
}

export function publicTemplateSelector(additional = {}) {
  return userSelectableTemplateSelector({
    ...additional,
    'options.isPublic': true,
    'options.isPrivate': { $ne: true },
    'options.isUnlisted': { $ne: true },
    archivedDate: { $exists: false },
  })
}

export function templateSlug(value) {
  return typeof value === 'string' ? value.normalize('NFKD').replace(/\p{M}/gu, '')
    .trim().toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') : ''
}

// Legacy creation links identify either an approved template's share ID or a
// human-readable name. The directory owns approval, ambiguity and availability.
export function legacyTemplateDestination(search) {
  const params = new URLSearchParams(search)
  const selected = params.get('template')?.trim() || params.get('templateId')?.trim()
  if (!selected) return null
  if (selected.length > 240) return '/templates'
  const key = /^proConScaffold$/i.test(selected) ? 'pro-con-analysis'
    : /^[A-Za-z0-9_-]+$/.test(selected) ? selected : templateSlug(selected)
  if (!key) return '/templates'
  const topic = templateCopyTopic(params)
  const suffix = topic ? '?' + new URLSearchParams({ topic }) : ''
  return '/templates/' + encodeURIComponent(key) + suffix
}

export function templateCopyTopic(params) {
  return (params.get('topic') || '').trim().slice(0, 160)
}
