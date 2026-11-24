import assert from 'node:assert/strict'
import test from 'node:test'
import { publicTemplateSelector } from '../imports/api/common/template-policy.mjs'
import { resolveTemplateDirectory } from '../server/common/resolve-template-directory.mjs'

const rows = [
  { shareId: 's101', options: { name: 'Mapping & Diagramming', urlName: 'mapping-diagramming', tags: ['Learning'] } },
  { shareId: 's102', options: { name: 'Pro/Con Analysis', templateTags: [{ title: 'Learning' }] } },
  { shareId: 's103', options: { name: 'Atlas', url_name: 'coastal-atlas' } },
]
const categories = [
  { title: 'Mapping & Diagramming', urlTitle: 'mapping-diagramming', summary: 'Diagrams and maps.' },
  { title: 'Learning', urlTitle: 'teaching-tools' },
]
const resolve = (kind, key) => resolveTemplateDirectory(rows, categories, kind, key)

test('preserves tag priority, custom category URLs, and empty published categories', () => {
  assert.deepEqual(resolve('slug', 'mapping-diagramming'), {
    type: 'tag', title: 'Mapping & Diagramming', description: 'Diagrams and maps.', items: [],
  })
  const lessons = resolve('tag', 'teaching-tools')
  assert.deepEqual(lessons.items.map(item => item.name), ['Mapping & Diagramming', 'Pro/Con Analysis'])
  const listing = resolve('list', '')
  assert.equal(listing.items[0].slug, 's101')
  assert.equal(resolve('slug', listing.items[0].slug).key, 's101')
})

test('resolves stored legacy and derived slugs and rejects missing selections', () => {
  assert.equal(resolve('slug', 'coastal-atlas').key, 's103')
  assert.equal(resolve('slug', 'pro-con-analysis').key, 's102')
  assert.equal(resolve('slug', 'retired-template').type, 'unavailable')
  assert.equal(resolve('tag', 'coastal-atlas').type, 'unavailable')
})

test('listing, preview lookup and exact selected copy use the approved public selector', () => {
  assert.deepEqual(publicTemplateSelector({ shareId: 's102' }), {
    shareId: 's102',
    'options.isTemplate': true, 'options.templateApproved': true, 'options.isPublic': true,
    'options.isPrivate': { $ne: true }, 'options.isUnlisted': { $ne: true }, archivedDate: { $exists: false },
  })
})

test('historical draft tags stay private across all directory links until an eligible board uses them', () => {
  const historical = { title: 'Unreleased exhibit', urlTitle: 'vault-wing' }
  const stored = [...categories, historical]
  const directory = input => resolveTemplateDirectory(input, stored, 'list', '')
  assert.equal(directory(rows).tags.some(tag => tag.title === historical.title), false)
  for (const key of ['vault-wing', 'unreleased-exhibit']) {
    for (const kind of ['slug', 'tag']) assert.equal(resolveTemplateDirectory(rows, stored, kind, key).type, 'unavailable')
  }
  const featured = [...rows, { shareId: 's104', options: { name: 'Exhibition', tags: [historical.title] } }]
  assert.ok(directory(featured).tags.some(tag => tag.slug === historical.urlTitle))
  assert.equal(resolveTemplateDirectory(featured, stored, 'slug', 'vault-wing').items[0].name, 'Exhibition')
  assert.deepEqual(resolveTemplateDirectory(rows, stored, 'tag', 'roadmap').items, [])
})
