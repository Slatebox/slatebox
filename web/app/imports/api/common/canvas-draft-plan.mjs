// A drawing request's draft (nativeCanvasDraft: new notes, their arrows, and arrows from notes
// already on the board) as one canvas plan for slates.applyOperations, so the conversation's
// direct path previews and saves through the same action as every other writer.
import { SLATE_OPERATION_TOOL } from 'slateboxjs/operations'

const opSchema = SLATE_OPERATION_TOOL.parameters.properties.operations.items.properties
const STYLE_KEYS = Object.keys(opSchema.style.properties)
const SHAPES = new Set(opSchema.shape.enum)

function styleOf(source) {
  const style = {}
  for (const key of STYLE_KEYS) {
    const value = source?.[key]
    if (value === undefined || value === null) continue
    const spec = opSchema.style.properties[key]
    if (spec.type === 'number' && typeof value === 'number' && (spec.minimum === undefined || value >= spec.minimum) && (spec.maximum === undefined || value <= spec.maximum)) style[key] = value
    else if (spec.type === 'string' && typeof value === 'string' && (!spec.enum || spec.enum.includes(value)) && (!spec.maxLength || value.length <= spec.maxLength)) style[key] = value
    else if (spec.type === 'boolean' && typeof value === 'boolean') style[key] = value
  }
  return style
}

const noteStyle = (options) => {
  const { lineColor: _a, lineWidth: _b, lineType: _c, showChildArrow: _d, showParentArrow: _e, ...rest } = styleOf(options)
  return rest
}

export function draftToPlan(draft, message = '') {
  if (draft?.mode !== 'draw') throw new Error('Only a drawing draft becomes a canvas plan.')
  const operations = []
  for (const node of draft.nodes || []) {
    const o = node.options
    const shape = SHAPES.has(o.shapeHint) ? o.shapeHint : SHAPES.has(o.vectorPath) ? o.vectorPath : 'rectangle'
    const style = noteStyle(o)
    operations.push({
      kind: 'add_nodes',
      count: 1,
      ids: [o.id],
      text: String(o.text ?? ''),
      shape,
      x: o.xPos,
      y: o.yPos,
      width: o.width,
      height: o.height,
      ...(Object.keys(style).length && { style }),
    })
  }
  // Every arrow, new notes' own and those from notes already on the board, grouped by the note
  // it starts from and its look, so a long draft stays within one plan.
  const arrows = [
    ...(draft.nodes || []).flatMap((node) => node.relationships?.associations || []),
    ...(draft.links || []).map((link) => link.association),
  ]
  const groups = new Map()
  for (const a of arrows) {
    const style = styleOf(a)
    const key = JSON.stringify([a.parentId, style])
    if (!groups.has(key)) groups.set(key, { parentId: a.parentId, style, to: [], ids: [] })
    const group = groups.get(key)
    group.to.push(a.childId)
    group.ids.push(a.id)
  }
  // One connector per pair: a group whose targets repeat would ask for more pairs than ids.
  for (const group of groups.values()) {
    operations.push({
      kind: 'connect_nodes',
      from: { ids: [group.parentId] },
      to: { ids: group.to },
      ids: group.ids,
      ...(Object.keys(group.style).length && { style: group.style }),
    })
  }
  const labels = draft.labels || (draft.nodes || []).map((node) => node.options.text)
  const plan = {
    message: message || `Drew ${labels.join(' → ')}.`.slice(0, 1000),
    operations,
  }
  return { plan, labels, links: arrows.length }
}
