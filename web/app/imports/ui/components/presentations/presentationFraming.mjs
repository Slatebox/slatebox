// Where the presenter's camera looks. Pure: the layout (the slate's analysis: each note's box,
// in the presented SVG's coordinates, and its rotation) in, numbers out.

function flatten(nodes, into = new Map()) {
  ;(nodes || []).forEach((node) => {
    if (node?.nodeId != null && !into.has(String(node.nodeId))) into.set(String(node.nodeId), node)
    flatten(node?.childrenNodes, into)
  })
  return into
}

/** Every note of a layout by id. */
export const layoutNotes = (layout) => flatten(layout?.nodes)

/**
 * The box a note covers once it is rotated about its centre (a note's layout box is the box
 * before rotation).
 */
export function rotatedBounds({ x, y, width, height }, rotation = 0) {
  if (!rotation || !(rotation % 360)) return { x, y, width, height }
  const angle = (rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(angle))
  const sin = Math.abs(Math.sin(angle))
  const w = width * cos + height * sin
  const h = width * sin + height * cos
  return { x: x + width / 2 - w / 2, y: y + height / 2 - h / 2, width: w, height: h }
}

function boxOf(note) {
  const bbox = note?.metrics?.bbox
  if (!bbox || ![bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite)) return null
  return { bbox, rotation: Number(note.metrics.rotation) || 0 }
}

/**
 * What the camera frames for these notes: { centerX, centerY, width, height, rotation }.
 * A group is framed by the union of the boxes its notes cover, rotation included, with the
 * camera level. One rotated note alone is straightened: the camera turns by its rotation and
 * frames the note's own size. Null when none of the notes is in the layout.
 */
export function viewpointFrame(nodeIds, layout, notes = layoutNotes(layout)) {
  const boxes = (nodeIds || []).map((id) => boxOf(notes.get(String(id)))).filter(Boolean)
  if (!boxes.length) return null
  if (boxes.length === 1 && boxes[0].rotation % 360) {
    const { bbox, rotation } = boxes[0]
    return {
      centerX: bbox.x + bbox.width / 2,
      centerY: bbox.y + bbox.height / 2,
      width: Math.max(bbox.width, 1),
      height: Math.max(bbox.height, 1),
      rotation: -rotation,
    }
  }
  const covered = boxes.map(({ bbox, rotation }) => rotatedBounds(bbox, rotation))
  const minX = Math.min(...covered.map((box) => box.x))
  const minY = Math.min(...covered.map((box) => box.y))
  const maxX = Math.max(...covered.map((box) => box.x + box.width))
  const maxY = Math.max(...covered.map((box) => box.y + box.height))
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
    rotation: 0,
  }
}

/** The frame of the whole slate: every note. */
export const wholeSlateFrame = (layout) => {
  const notes = layoutNotes(layout)
  return viewpointFrame([...notes.keys()], layout, notes)
}

/**
 * The frame that holds all of these (level frames, or boxes { x, y, width, height }): the whole
 * drawing, when the notes' frame is joined with what is drawn around them (a lane's column, its
 * caption and picture, which are not notes of the layout). Null when there is none.
 */
export function unionFrame(...items) {
  const boxes = items.filter(Boolean).map((item) => ('centerX' in item
    ? { x: item.centerX - item.width / 2, y: item.centerY - item.height / 2, width: item.width, height: item.height }
    : item)).filter((box) => [box.x, box.y, box.width, box.height].every(Number.isFinite))
  if (!boxes.length) return null
  const minX = Math.min(...boxes.map((box) => box.x))
  const minY = Math.min(...boxes.map((box) => box.y))
  const maxX = Math.max(...boxes.map((box) => box.x + box.width))
  const maxY = Math.max(...boxes.map((box) => box.y + box.height))
  return { centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1), rotation: 0 }
}

/**
 * A box measured on screen, in the presented SVG's own pixels: the units of the layout and of the
 * camera (its origin is the SVG's top left). The SVG's user units are not those: its viewBox may
 * start far from 0 (a note at 10 000), so a box in user units joined with the layout's frames from
 * the origin to the note. `svgBox` is the SVG on screen and `svgWidth` its own width in pixels.
 */
export function inSvgPixels(box, svgBox, svgWidth) {
  const scale = svgBox.width / (svgWidth || svgBox.width || 1) || 1
  return { x: (box.left - svgBox.left) / scale, y: (box.top - svgBox.top) / scale, width: box.width / scale, height: box.height / scale }
}

/** The most the camera zooms in: a single small note is shown large, not enormous. */
export const MAX_ZOOM = 3

/**
 * Fit a frame in the presenter: `width` × `height` is the presenter, `top` the room the
 * narrative takes over it and `bottom` the room the controls take under it. The frame is
 * centred in what is left, with a margin on every side, so none of it is ever behind the
 * narrative or the controls, or off screen. Returns { scale, x, y }: the zoom and where the
 * frame's centre lands on screen.
 */
export function fitFrame(frame, { width, height, top = 0, bottom = 0 }) {
  // Little room (a phone held sideways, a long narrative): the margin shrinks before the slate does.
  const free = Math.max(height - top - bottom, 1)
  const margin = Math.min(Math.max(16, Math.min(width, height) * 0.04), free / 6)
  const room = Math.max(free - margin * 2, 1)
  const across = Math.max(width - margin * 2, 1)
  const scale = Math.min(across / frame.width, room / frame.height, MAX_ZOOM)
  return { scale, x: width / 2, y: top + margin + room / 2 }
}

/** The CSS transform that puts a fitted frame on screen (the camera's origin is its top left). */
export function cameraTransform(frame, fit) {
  return `translate3d(${fit.x}px, ${fit.y}px, 0) scale3d(${fit.scale}, ${fit.scale}, 1)${
    frame.rotation ? ` rotate3d(0, 0, 1, ${frame.rotation}deg)` : ''
  } translate3d(${-frame.centerX}px, ${-frame.centerY}px, 0)`
}
