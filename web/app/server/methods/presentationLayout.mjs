// The presenter's layout of a slate as the server stores it, for a presentation made without a
// browser (presentations.create, the create_presentation tool): the same tree the engine's
// extractPresentationLayout gives the Present button ({ presentationWidth, presentationHeight,
// nodes: [{ nodeId, description, metrics: { rotation, bbox }, childrenNodes }] }). A workshop's
// lanes and cards are its notes too; its captions, columns and handles are the board's own drawing
// and are not stops. Category frames are not stops either. Boxes are relative to the notes' top
// left. Pure: it reads the slate and returns a new object.
import { slatePreview } from '../../imports/api/common/slate-preview.mjs'

const DECORATION = /^(?:[a-z0-9]+:)?(?:caption|column|image|handle|gauge)-/
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)

function placeOf(options) {
  return {
    x: num(options.xPos ?? options.x),
    y: num(options.yPos ?? options.y),
    width: num(options.width),
    height: num(options.height),
  }
}

export function storedSlateLayout(slate) {
  const drawn = slatePreview(slate || {}).nodes || []
  const stops = drawn.filter((node) => {
    const id = node?.options?.id
    return typeof id === 'string' && id && !node.options.isCategory && !DECORATION.test(id)
  })
  const places = new Map(stops.map((node) => [node.options.id, placeOf(node.options)]))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const box of places.values()) {
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0 }

  const byId = new Map(stops.map((node) => [node.options.id, node]))
  const childIdsOf = (node) => (node.relationships?.associations || [])
    .filter((link) => link?.parentId === node.options.id || link?.parentId == null)
    .map((link) => link?.childId)
    .filter((id) => id !== node.options.id && byId.has(id))
  const childIds = new Set(stops.flatMap(childIdsOf))
  const processed = new Set()
  // Walked with a stack, so a deep chain cannot exhaust the server's stack.
  const build = (root) => {
    const top = { childrenNodes: [] }
    const stack = [{ node: root, into: top.childrenNodes }]
    while (stack.length) {
      const { node, into } = stack.pop()
      const id = node.options.id
      if (processed.has(id)) continue
      processed.add(id)
      const box = places.get(id)
      const entry = {
        nodeId: id,
        metrics: {
          rotation: Math.ceil(num(node.options.rotate?.rotationAngle)),
          bbox: {
            x: Number((box.x - minX).toFixed(2)),
            y: Number((box.y - minY).toFixed(2)),
            width: Number(box.width.toFixed(2)),
            height: Number(box.height.toFixed(2)),
          },
        },
        description: String(node.options.text || node.options.description || ''),
        childrenNodes: [],
      }
      into.push(entry)
      const kids = childIdsOf(node).map((kid) => byId.get(kid))
      for (let i = kids.length - 1; i >= 0; i -= 1) stack.push({ node: kids[i], into: entry.childrenNodes })
    }
    return top.childrenNodes[0]
  }
  const nodes = stops.filter((node) => !childIds.has(node.options.id)).map(build).filter(Boolean)
  // A loop of connected notes has no note without a parent: each part not yet visited starts a tree.
  for (const node of stops) if (!processed.has(node.options.id)) nodes.push(build(node))
  return {
    presentationWidth: Math.ceil(maxX - minX),
    presentationHeight: Math.ceil(maxY - minY),
    nodes: nodes.filter(Boolean),
  }
}
