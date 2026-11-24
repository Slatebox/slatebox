// Where a new note goes so it lands on free space: no Meteor, shared by the canvas and its tests.

const overlaps = (a, b, gap) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap

/**
 * Where a new note of this size goes near a point (its centre): there when free, else the nearest
 * free spot in rings around it, so pasted videos never land on each other or on notes. → top-left.
 */
export function freeSpotNear(centre, size, taken, { gap = 24, step = 60, rings = 12 } = {}) {
  const at = (dx, dy) => ({ x: Math.round(centre.x - size.width / 2 + dx), y: Math.round(centre.y - size.height / 2 + dy), width: size.width, height: size.height })
  const free = (box) => !taken.some((other) => other && overlaps(box, other, gap))
  if (free(at(0, 0))) return at(0, 0)
  for (let ring = 1; ring <= rings; ring++) {
    const r = ring * step
    // right, below, left, above, then the corners and between, nearest first
    const spots = []
    for (let i = -ring; i <= ring; i++) spots.push([r, i * step], [i * step, r], [-r, i * step], [i * step, -r])
    spots.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))
    for (const [dx, dy] of spots) if (free(at(dx, dy))) return at(dx, dy)
  }
  return at(0, 0)
}

/** The boxes of the notes on a canvas (engine notes, or stored ones). */
export function noteBoxes(slate) {
  const engine = slate?.v2 ?? slate
  const nodes = engine?.nodes?.allNodes ?? slate?.nodes?.allNodes ?? []
  return nodes.map((node) => node?.options ?? node).filter((o) => Number.isFinite(o?.xPos) && Number.isFinite(o?.yPos))
    .map((o) => ({ x: o.xPos, y: o.yPos, width: Number(o.width) || 0, height: Number(o.height) || 0 }))
}
