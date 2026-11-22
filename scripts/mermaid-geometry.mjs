// What an imported Mermaid diagram looks like on the slate, read from its plans alone: the notes
// and frames (add_nodes) and the lines (connect_nodes), drawn the way the canvas draws them.
//   - A line runs straight between its two notes' centres and is drawn from border to border
//     (the canvas's connectors aim each end at the other note's centre).
//   - Its label sits at the middle of the drawn line, or as far along it as the line's
//     labelPosition says, in a 13px chip (svg.connectable setLabel / positionLabel).
//   - A frame's title sits in the top-left corner, under FRAME_STYLE.
// problems() lists every way a drawing breaks the import's layout rules:
//   1. a line passes through a note that is not one of its ends (or a frame holding neither end);
//   2. a label covers a note, a frame's title, a frame that holds neither end of its line, or
//      another label;
//   3. two boxes overlap without one holding the other (a note outside a frame overlaps it).
import { FRAME_STYLE } from '../web/app/imports/api/common/mermaid/plan.mjs'

const LINE_CLEARANCE = 4 // a line keeps at least this far from a note it does not join
export const labelSize = (text) => ({ width: [...`${text}`].length * 7.5 + 12, height: 20 })
export const titleBox = (frame) => {
  const chars = [...`${frame.text ?? ''}`].length
  return { x: frame.x, y: frame.y, width: Math.min(frame.width, chars * 9.6 + 28), height: 40 }
}

export function drawingFromPlans(plans) {
  const boxes = new Map()
  const lines = []
  for (const plan of plans) {
    for (const op of plan.operations) {
      if (op.kind === 'add_nodes') {
        const frame = op.style?.borderStyle === FRAME_STYLE.borderStyle && op.style?.textYAlign === 'top' && op.style?.backgroundColor === FRAME_STYLE.backgroundColor
        boxes.set(op.ids[0], { id: op.ids[0], x: op.x, y: op.y, width: op.width, height: op.height, text: op.text, frame, style: op.style || {} })
      } else if (op.kind === 'connect_nodes')
        lines.push({ from: op.from.ids[0], to: op.to.ids[0], label: op.style?.label || '', at: op.style?.labelPosition ?? 0.5 })
    }
  }
  return { boxes, lines }
}

const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
const inside = (outer, inner) =>
  outer !== inner && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const grow = (b, by) => ({ x: b.x - by, y: b.y - by, width: b.width + by * 2, height: b.height + by * 2 })

/** Where the straight line from p (inside box) towards q leaves the box. */
function exitPoint(box, p, q) {
  const dx = q.x - p.x
  const dy = q.y - p.y
  let t = 1
  if (dx > 0) t = Math.min(t, (box.x + box.width - p.x) / dx)
  if (dx < 0) t = Math.min(t, (box.x - p.x) / dx)
  if (dy > 0) t = Math.min(t, (box.y + box.height - p.y) / dy)
  if (dy < 0) t = Math.min(t, (box.y - p.y) / dy)
  return { x: p.x + dx * t, y: p.y + dy * t }
}

/** The drawn part of a line: border to border. */
export function drawnSegment(a, b) {
  const ca = centre(a)
  const cb = centre(b)
  return [exitPoint(a, ca, cb), exitPoint(b, cb, ca)]
}

/** Does the segment p-q cross the box (Liang-Barsky)? */
export function segmentHitsBox(p, q, box) {
  let t0 = 0
  let t1 = 1
  const dx = q.x - p.x
  const dy = q.y - p.y
  const edges = [
    [-dx, p.x - box.x],
    [dx, box.x + box.width - p.x],
    [-dy, p.y - box.y],
    [dy, box.y + box.height - p.y],
  ]
  for (const [pp, qq] of edges) {
    if (pp === 0) {
      if (qq <= 0) return false
    } else {
      const r = qq / pp
      if (pp < 0) {
        if (r > t1) return false
        if (r > t0) t0 = r
      } else {
        if (r < t0) return false
        if (r < t1) t1 = r
      }
    }
  }
  return t1 - t0 > 1e-6
}

export function problems({ boxes, lines }) {
  const found = []
  const chips = []
  const all = [...boxes.values()]
  const frames = all.filter((b) => b.frame)
  const name = (b) => `"${b.text}"`
  // 3. Boxes either keep apart or one holds the other.
  for (let i = 0; i < all.length; i += 1)
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i]
      const b = all[j]
      if (overlap(a, b) && !inside(a, b) && !inside(b, a)) found.push(`${name(a)} and ${name(b)} overlap`)
    }
  for (const line of lines) {
    const a = boxes.get(line.from)
    const b = boxes.get(line.to)
    if (!a || !b) continue
    const holdsAnEnd = (f) => f === a || f === b || inside(f, a) || inside(f, b)
    const [p, q] = drawnSegment(a, b)
    const what = `the line ${name(a)} to ${name(b)}`
    // 1. Through a note that is not an end, or a frame holding neither end.
    for (const other of all) {
      if (other === a || other === b) continue
      if (other.frame && holdsAnEnd(other)) continue
      // A note inside an end that is a frame is behind the line's end, not on its way.
      if ((a.frame && inside(a, other)) || (b.frame && inside(b, other))) continue
      if (segmentHitsBox(p, q, grow(other, LINE_CLEARANCE))) found.push(`${what} passes through ${name(other)}`)
    }
    // A line crossing into a frame passes clear of its title.
    for (const frame of frames) {
      if (frame === a || frame === b) continue
      if (segmentHitsBox(p, q, titleBox(frame))) found.push(`${what} crosses the title of ${name(frame)}`)
    }
    // 2. The label.
    if (line.label) {
      const mid = { x: p.x + (q.x - p.x) * line.at, y: p.y + (q.y - p.y) * line.at }
      const { width, height } = labelSize(line.label)
      const chip = { x: mid.x - width / 2, y: mid.y - height / 2, width, height }
      for (const other of chips) if (overlap(chip, other.chip)) found.push(`the labels "${other.label}" and "${line.label}" overlap`)
      chips.push({ chip, label: line.label })
      for (const other of all) {
        if (other.frame) {
          if (overlap(chip, titleBox(other))) found.push(`the label "${line.label}" covers the title of ${name(other)}`)
          if (!holdsAnEnd(other) && overlap(chip, other) && !inside(other, chip)) found.push(`the label "${line.label}" covers the frame ${name(other)}`)
          else if (!holdsAnEnd(other) && inside(other, chip)) found.push(`the label "${line.label}" sits inside the frame ${name(other)}`)
        } else if (overlap(chip, other)) found.push(`the label "${line.label}" covers ${name(other)}`)
      }
    }
  }
  return found
}
