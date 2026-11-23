import { templateCategories } from '../bootstrap/template-categories.mjs'
import { templateSlug } from '../../imports/api/common/template-policy.mjs'

function aliases(row) {
  return [row.options.urlName, row.options.url_name, row.options.name].map(templateSlug).filter(Boolean)
}

export function tagNames(row) {
  const values = [row.options.tags, row.options.templateTags].filter(Array.isArray).flat()
  return [...new Set(values.map(value => typeof value === 'string' ? value : value?.title).filter(value => templateSlug(value)))]
}

function summary(row, slug, categories) {
  return { slug, name: row.options.name, description: row.options.description || '',
    tags: tagNames(row).map(title => categories.get(title) || { title, slug: templateSlug(title) }) }
}

export function resolveTemplateDirectory(rows, savedTags, kind, key) {
  const usedTitles = new Set(rows.flatMap(tagNames))
  // Historic drafts wrote tags to the same collection as public categories.
  // Only the curated seed and titles on currently selectable boards are public.
  const curatedTitles = new Set(templateCategories.map(tag => tag.title))
  const categories = new Map()
  for (const tag of [...templateCategories, ...savedTags]) {
    if (curatedTitles.has(tag.title) || usedTitles.has(tag.title)) {
      categories.set(tag.title, { title: tag.title, slug: tag.urlTitle || templateSlug(tag.title), description: tag.summary || '' })
    }
  }
  for (const title of usedTitles) {
    if (!categories.has(title)) categories.set(title, { title, slug: templateSlug(title), description: '' })
  }
  const tags = [...categories.values()]
  const counts = new Map()
  const allAliases = rows.map(aliases)
  for (const tag of tags) counts.set(templateSlug(tag.slug), 1)
  for (const names of allAliases) for (const s of new Set(names)) counts.set(s, (counts.get(s) || 0) + 1)
  const items = rows.map((row, i) => summary(row, allAliases[i].find(s => counts.get(s) === 1) || row.shareId, categories))
  if (kind === 'list') return { type: 'list', items, tags }
  const slug = templateSlug(key)
  if (!slug) return { type: 'unavailable' }
  // Archived /templates/:name routes give the stored tag URL precedence.
  const tag = tags.find(t => t.slug === key) || tags.find(t => templateSlug(t.slug) === slug)
  if (tag) return { type: 'tag', title: tag.title, description: tag.description,
    items: items.filter(item => item.tags.some(t => t.title === tag.title)) }
  if (kind !== 'slug') return { type: 'unavailable' }
  const index = rows.findIndex((row, i) => row.shareId === key || (counts.get(slug) === 1 && allAliases[i].includes(slug)))
  if (index === -1) return { type: 'unavailable' }
  return { type: 'template', ...items[index], key: rows[index].shareId }
}
