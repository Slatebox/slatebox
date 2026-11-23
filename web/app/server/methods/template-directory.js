import { Meteor } from 'meteor/meteor'
import { Slates, Tags } from '../../imports/api/common/models'
import { publicTemplateSelector } from '../../imports/api/common/template-policy.mjs'

import { templateCategories } from '../bootstrap/template-categories.mjs'
import { resolveTemplateDirectory, tagNames } from '../common/resolve-template-directory.mjs'

const summaryFields = { shareId: 1, 'options.name': 1, 'options.urlName': 1, 'options.url_name': 1, 'options.tags': 1, 'options.templateTags': 1, 'options.description': 1 }
const canvasFields = { 'options.name': 1, 'options.description': 1, 'options.containerStyle': 1,
  'options.defaultLineColor': 1, 'options.mindMapMode': 1, 'options.layoutType': 1, 'nodes.relationships.associations': 1 }
const boardFields = { ...canvasFields, 'options.templateMarkdown': 1 }
const visualFields = [
  'id name text x y xPos yPos width height shape shapeHint vectorPath',
  'backgroundColor foregroundColor fontColor fontSize fontFamily fontStyle fontWeight textAlign textXAlign textYAlign',
  'borderColor borderWidth borderStyle borderOpacity opacity textOpacity lineColor lineWidth rotate rotationAngle',
  'textOffset resizeRotate filters image imageOrigWidth imageOrigHeight',
]
for (const field of visualFields.join(' ').split(' ')) boardFields['nodes.options.' + field] = 1

function board(row) {
  return { options: { id: row._id, name: row.options.name, description: row.options.description || '', isTemplate: true,
    containerStyle: row.options.containerStyle, defaultLineColor: row.options.defaultLineColor,
    mindMapMode: row.options.mindMapMode, layoutType: row.options.layoutType }, nodes: row.nodes || [] }
}

const validShareId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(id)
const unavailable = () => ({ type: 'unavailable' })

async function publicDirectory(kind, key) {
  const rows = await Slates.find(publicTemplateSelector(), {
    fields: summaryFields, sort: { 'options.name': 1, _id: 1 },
  }).fetchAsync()
  const titles = [...new Set([...templateCategories.map(tag => tag.title), ...rows.flatMap(tagNames)])]
  const savedTags = await Tags.find({ type: 'template', title: { $in: titles } }, {
    fields: { _id: 0, title: 1, urlTitle: 1, summary: 1 }, sort: { title: 1 },
  }).fetchAsync()
  return resolveTemplateDirectory(rows, savedTags, kind, key)
}

export async function publicTemplateSummary(kind, key) {
  if (!['slug', 'tag'].includes(kind) || typeof key !== 'string' || !key || key.length > 240) return null
  const entry = await publicDirectory(kind, key)
  return entry.type === 'unavailable' ? null : { type: entry.type, name: entry.name || entry.title, description: entry.description }
}

Meteor.methods({
  async 'templates.directory'(kind, key = '') {
    if (!['list', 'slug', 'tag', 'preview'].includes(kind) || typeof key !== 'string' || key.length > 240) return unavailable()
    if (kind === 'preview') {
      if (!this.userId || !validShareId(key)) return unavailable()
      const row = await Slates.findOneAsync({ shareId: key, userId: this.userId, archivedDate: { $exists: false } }, { fields: boardFields })
      return row ? { type: 'preview', name: row.options.name, description: row.options.description || '', markdown: row.options.templateMarkdown || '', board: board(row) } : unavailable()
    }
    const entry = await publicDirectory(kind, key)
    if (entry.type !== 'template') return entry
    const row = await Slates.findOneAsync(publicTemplateSelector({ shareId: entry.key }), { fields: boardFields })
    return row ? { ...entry, markdown: row.options.templateMarkdown || '', board: board(row) } : unavailable()
  },

  async 'templates.setDraft'(shareId, enabled) {
    if (!this.userId || !validShareId(shareId) || typeof enabled !== 'boolean') throw new Meteor.Error('unavailable', 'Only the owner can change this template.')
    const owner = { shareId, userId: this.userId, archivedDate: { $exists: false } }
    await Slates.updateAsync({ ...owner, 'options.isTemplate': { $ne: enabled } }, {
      $set: { 'options.isTemplate': enabled, 'options.templateApproved': false, 'options.isFeatured': false },
    })
    const row = await Slates.findOneAsync(owner, { fields: { 'options.isTemplate': 1 } })
    if (!row) throw new Meteor.Error('unavailable', 'Only the owner can change this template.')
    return row.options.isTemplate === true
  },

})
