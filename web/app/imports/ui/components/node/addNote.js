/* eslint-disable new-cap */
/* eslint-disable no-underscore-dangle */
import cloneDeep from 'lodash.clonedeep'
import { Slatebox } from 'slateboxjs'
import defaultShapes from './defaultShapes'
import { dockNoteStyle, stickyNoteLook } from '../../common/noteStyle.mjs'
import pathAtOrigin from './pathAtOrigin'

/**
 * The style a new note starts from: the slate's last note of its own or, on a slate without one,
 * its new-note look (the organisation's default preset, or the default note: common/noteStyle.mjs).
 */
export function noteBase(ownNotes, noteStyle) {
  return cloneDeep(ownNotes[ownNotes.length - 1]?.options) || dockNoteStyle(noteStyle)
}

/**
 * The middle of what the person sees, in canvas coordinates. The canvas viewBox already is the
 * visible area at the current zoom and pan, so nothing is divided by the zoom (that sent a note
 * added at 50% to twice its canvas coordinates, far off screen). Falls back to the middle of the
 * slate's notes.
 */
export function visibleCenter(slate) {
  try {
    const vb = slate?.v2?.canvas?.viewbox?.()
    if (vb && [vb.x, vb.y, vb.width, vb.height].every(Number.isFinite) && vb.width > 0 && vb.height > 0) {
      return { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 }
    }
  } catch (e) {
    /* the notes' middle below */
  }
  const orient = slate?.getOrientation?.() ?? { left: 10000, top: 10000, width: 0, height: 0 }
  return { x: orient.left + orient.width / 2, y: orient.top + orient.height / 2 }
}

/**
 * Add a note of a shape (a key from defaultShapes, or addText, comment, searchCustom with a
 * path) in the middle of the view, and send it to collaborators. Used by the tool dock and,
 * on a phone, by "+ Add".
 */
export default function addNote(slate, shape) {
  // A new note takes after the slate's last note of its own, never after a note a workshop draws there.
  const ownNotes = (slate?.nodes?.allNodes ?? []).filter(
    (n) => !slate.v2?.governanceOf?.(n.v2)
  )
  const baseOpts = noteBase(ownNotes, slate?.noteStyle)

  let { path } = shape
  if (shape.key === 'addText') {
    path = defaultShapes.find((s) => s.key === 'rect').path
  } else if (shape.key === 'comment') {
    path = `M 2.7402 0.25 C 1.3817 0.25 0.2805 1.155 0.2805 2.2714 c 0 0.5665 0.2836 1.0784 0.7404 1.4454 c -0.0232 0.3369 -0.175 0.7774 -0.8208 0.7262 c 0 0 0.9442 0.5851 1.7462 -0.2578 c 0.2491 0.0698 0.5162 0.1077 0.7941 0.1077 c 1.3586 0 2.4598 -0.905 2.4598 -2.0214 S 4.0987 0.25 2.7402 0.25 z`
  }

  let xPos = 0
  let yPos = 0
  // Where the new note's centre goes on a slate that already has notes: the middle of the view.
  let center = null
  if (ownNotes.length === 0 && !slate?.nodes?.allNodes.length) {
    xPos = 10000
    yPos = 10000
  } else {
    center = visibleCenter(slate)
    xPos = center.x
    yPos = center.y
  }

  let nodeOpts = {}

  function setDimens(tString) {
    const bcopy = cloneDeep(baseOpts)
    const placed = Slatebox.utils._transformPath(path, tString)
    const pbox = Slatebox.utils.getBBox({ path: placed })
    // Stored from its own origin, never in canvas coordinates (pathAtOrigin.js).
    const tpath = pathAtOrigin(placed)
    const iOpts = {
      text: '',
      xPos: xPos + pbox.width / 2 + 20,
      yPos: yPos + pbox.height / 2 + 20,
      height: pbox.height,
      width: pbox.width,
      vectorPath: tpath,
      allowMenu: true,
      allowDrag: true,
      opacity: 1,
      borderOpacity: 1,
      textOpacity: 1,
    }
    ;[
      'text',
      'groupId',
      'isComment',
      'id',
      'image',
      'xPos',
      'yPos',
      'height',
      'width',
      'shapeHint',
      'vectorPath',
      // A custom shape's own options never carry over to the next note (only the customShape
      // key below sets them): a quick-add rectangle after a rocket is a rectangle.
      'shape',
      'fillRule',
      'textBox',
      'shapeRef',
      'textBounds',
      'textOffset',
      'opacity',
      'borderOpacity',
      'textOpacity',
    ].forEach((p) => {
      delete bcopy[p]
    })
    Object.assign(iOpts, bcopy)
    if (!iOpts.rotate) {
      iOpts.rotate = { rotationAngle: 0 }
    }
    iOpts.rotate.rotationAngle = 0
    return iOpts
  }

  if (shape.key === 'addText') {
    nodeOpts = setDimens(`T${xPos + 100},${yPos}s15,2`)
    nodeOpts.opacity = 0
    nodeOpts.borderOpacity = 0
    nodeOpts.textOpacity = 1
    nodeOpts.foregroundColor = '#000'
    nodeOpts.backgroundColor = '#fff'
    nodeOpts.fontSize = nodeOpts.fontSize < 20 ? 20 : nodeOpts.fontSize
  } else if (shape.key === 'customShape') {
    // A shape from the shape maker or library: its normalised path as it is, 200 on its longer side.
    nodeOpts = setDimens(`T${xPos + 10},${yPos}`)
    const aspect = Math.min(10, Math.max(0.1, Number(shape.aspect) || 1))
    nodeOpts.width = Math.round(aspect >= 1 ? 200 : 200 * aspect)
    nodeOpts.height = Math.round(aspect >= 1 ? 200 / aspect : 200)
    nodeOpts.vectorPath = path
    nodeOpts.shape = 'custom'
    nodeOpts.fillRule = shape.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'
    nodeOpts.textBox = shape.textBox ?? null
    nodeOpts.shapeRef = shape.id ? { id: shape.id, name: shape.name } : { name: shape.name }
  } else if (shape.key === 'searchCustom') {
    nodeOpts = setDimens(`T${xPos + 10},${yPos}`)
  } else if (shape.key === 'comment') {
    nodeOpts = setDimens(`T${xPos},${yPos}s8,8`)
    nodeOpts.borderOpacity = 1
    nodeOpts.isComment = true
    nodeOpts.borderWidth = 1
    nodeOpts.borderColor = '#000'
    nodeOpts.borderStyle = '-'
    nodeOpts.backgroundColor = '#B76C0D'
    nodeOpts.foregroundColor = '#fff'
    nodeOpts.textXAlign = 'middle'
    nodeOpts.text = '?'
    nodeOpts.fontSize = 20
    nodeOpts.fontFamily = 'Bangers'
  } else if (shape.key === 'stickyNote') {
    // The default note's rounded shape and size, in sticky yellow, no border, the post-it shadow on;
    // as tall as the default note for the font size it copied from the last note.
    nodeOpts = setDimens(`T${xPos},${yPos}s6,6`)
    Object.assign(nodeOpts, stickyNoteLook(slate?.noteStyle, nodeOpts.fontSize))
  } else {
    if (shape.key === 'line') {
      nodeOpts.borderWidth = 3
    }
    nodeOpts = setDimens(`T${xPos},${yPos}s6,6`)
  }

  // Centred in the view, in the options collaborators receive too (not only moved there locally).
  if (center && Number.isFinite(nodeOpts.width) && Number.isFinite(nodeOpts.height)) {
    nodeOpts.xPos = center.x - nodeOpts.width / 2
    nodeOpts.yPos = center.y - nodeOpts.height / 2
  }

  // ensure shapeHint is set
  if (shape.key === 'searchCustom' || shape.key === 'customShape') {
    nodeOpts.shapeHint = 'custom'
  } else if (!['comment', 'addText', 'stickyNote'].includes(shape.key)) {
    nodeOpts.shapeHint = shape.key
  }

  // always assign an id so that collab is consistent
  nodeOpts.id = Slatebox.utils.guid(12)
  const node = new Slatebox.node(nodeOpts)

  slate?.nodes.add(node)

  // fix for proportionate resizing
  if (shape.key === 'searchCustom') {
    const bbox = node.vect.getBBox()
    node.options.origVectHeight = bbox.height
    node.options.origVectWidth = bbox.width
  }

  // send collaboration info
  const pkg = {
    type: 'onNodeAdded',
    data: { nodeOptions: nodeOpts },
  }
  slate?.collab.send(pkg)

  node.position('center')

  return node
}
