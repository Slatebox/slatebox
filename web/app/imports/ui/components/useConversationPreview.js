import { useEffect } from 'react'
import { compat } from 'slateboxjs'
import { PREVIEW_CAPTION, boundsOf, draftShownBox, previewArtwork, previewBoardOf, previewCaption, previewShown, previewView } from '../../api/common/conversation-preview.mjs'
import { workshopNoteStyle, workshopStyle } from '../../api/common/workshop-look.mjs'
import { drawBoard } from './workshop/boardRender'

// A preview note is drawn but not part of the slate: nobody can select, move, edit, connect or
// delete it, and the engine leaves it out of saves, undo, exports and what it sends to collaborators.
const inert = Object.freeze({ canMove: false, canResize: false, canRotate: false, canDelete: false, canDuplicate: false,
  canConnect: false, canEditText: false, canSelect: false, persist: false, exportable: false })

/**
 * Draw a conversation preview on the live slate (`engine`, the page's v2 Slate) as native notes
 * and connectors, plainly marked as a preview, until `preview` changes or the page leaves.
 *
 * `preview` is { canvas } for a draft from nativeCanvas.preview (drawn in full, in the places
 * Keep would put it), or { frame, focus } for a proposal the canvas already shows in place (a
 * workshop's proposal), which only gains the caption above `frame`. `focus` is what the proposal
 * changes (boxes, most context first; see previewShown), brought into view when the whole cannot be
 * read at once (stacked lanes on a phone).
 */
export default function useConversationPreview(engine, preview) {
  useEffect(() => {
    if (!engine || !preview || typeof engine.setDragPolicy !== 'function') return undefined
    const existing = engine.freeNodes().map(({ id, options: o }) => ({ id, x: o.x, y: o.y, width: o.width, height: o.height }))
    // A whole board (a library add, an interactive route) is drawn by the board renderer itself, see-through in
    // its dashed "Preview · not added yet" frame: every kind of board shows, a plan's bars and grid included.
    const draftBoard = preview.canvas ? previewBoardOf(preview.canvas, existing) : null
    if (draftBoard) return drawBoardDraft(engine, draftBoard, preview)
    let artwork
    try {
      artwork = preview.canvas ? previewArtwork(preview.canvas, existing, workshopNoteStyle) : { notes: [], links: [], bounds: preview.frame }
    } catch (err) {
      console.warn('The preview could not be drawn on the canvas.', err)
      return undefined
    }
    if (!artwork.bounds) return undefined
    // A proposal for a board already here (no canvas of its own, only that board's frame) is a change, not an addition.
    const caption = previewCaption(artwork.bounds, { change: !preview.canvas })
    const notes = [...artwork.notes, caption]
    const wanted = new Set(notes.map(note => note.options.id))
    const owned = new Map()
    const linked = new Map()
    let gone = false
    let drawing = Promise.resolve()

    const release = engine.setDragPolicy({
      governs: node => (wanted.has(node?.id) ? inert : null),
      onEnd: () => ({ accept: false }),
      // A load from the room replaced every note, the preview's too: draw it again.
      onNotesReplaced() { owned.clear(); linked.clear(); draw(false) },
    })

    function mark(node, note) {
      const group = node.svgGroup?.node
      if (!group) return
      group.style.pointerEvents = 'none'
      if (note.overlay) return
      if (note.options.id === PREVIEW_CAPTION) group.setAttribute('aria-hidden', 'true')
      else {
        group.setAttribute('data-conversation-preview', '')
        group.setAttribute('aria-label', 'Preview, not kept yet: ' + String(note.options.text ?? ''))
      }
    }

    function connect() {
      engine.withPolicyAuthority(() => {
        for (const { holderId, targetId, association } of artwork.links) {
          if (linked.has(association.id)) continue
          const holder = owned.get(holderId), target = owned.get(targetId) ?? engine.nodes.one(targetId)
          if (!holder?.relationships || !target?.svgGroup) continue
          holder.relationships.addAssociation(target, compat.v1AssociationToV2(association))
          linked.set(association.id, holder)
          // Dashed like the preview's outlines, and as inert as its notes: no press selects,
          // re-plugs or deletes it (the engine does this itself for a line between two governed notes).
          const line = holder.connector?.getConnections?.().find(c => c.id === association.id)?.connectable
          line?.connector?.attr?.({ 'stroke-dasharray': '8 6', 'pointer-events': 'none', 'data-governed': 'line' })
          line?.hitArea?.attr?.({ 'pointer-events': 'none' })
        }
      })
      engine.notifyNodeChanged?.()
    }

    // Bring the preview into view at a size that can be read (see previewView), and remember the
    // view the person had (where its centre was, and its zoom) to give it back when the preview goes.
    // The canvas can change size meanwhile (on a phone, the panel under it grows as a preview
    // arrives), so it is the centre and zoom that come back, not the exact box. Both are read the
    // way the engine keeps them across a resize: from the canvas's own width in pixels, so a view
    // box the engine has not yet re-fitted to a resized canvas still gives the person's zoom.
    let before = null
    function current() {
      const view = engine.canvas?.viewbox?.()
      const rect = engine.element?.getBoundingClientRect?.()
      if (!view || !rect || !(rect.width > 0) || !(rect.height > 0) || !(view.width > 0)) return null
      const zoom = rect.width / view.width
      const cx = view.x + view.width / 2, cy = view.y + view.height / 2
      const height = rect.height / zoom
      return { x: view.x, y: cy - height / 2, width: view.width, height, zoom, cx, cy, rect }
    }
    function reveal() {
      const whole = boundsOf([artwork.bounds, { x: caption.options.xPos, y: caption.options.yPos, width: caption.options.width, height: caption.options.height }])
      const view = current()
      if (!whole || !view) return
      const box = previewShown(whole, preview.focus ?? null, view)
      const next = previewView(box, view)
      if (!next) return
      before = { cx: view.cx, cy: view.cy, zoom: view.zoom }
      engine.canvas.viewbox(next.x, next.y, next.width, next.height)
    }
    function giveViewBack() {
      if (!before) return
      try {
        const view = current()
        if (view) {
          const width = view.rect.width / before.zoom, height = view.rect.height / before.zoom
          engine.canvas.viewbox(before.cx - width / 2, before.cy - height / 2, width, height)
        }
      } catch { /* The page is leaving. */ }
      before = null
    }

    function draw(show) {
      const waiting = []
      engine.withPolicyAuthority(() => {
        for (const note of notes) {
          const id = note.options.id
          if (owned.has(id)) continue
          const node = engine.nodes.add(compat.v1NodeToV2(note.options))
          owned.set(id, node)
          waiting.push(Promise.resolve(node.ready).then(() => {
            if (gone || owned.get(id) !== node) return
            node.applyGovernance?.()
            mark(node, note)
          }).catch(() => undefined))
        }
      })
      drawing = Promise.all([drawing, ...waiting]).then(() => {
        if (gone) return
        connect()
        if (show) reveal()
      })
    }
    draw(true)

    return () => {
      gone = true
      engine.withPolicyAuthority(() => {
        for (const [id, holder] of linked) holder.relationships?.removeAssociation(id)
        for (const [id, node] of owned) if (engine.nodes.one(id) === node) engine.nodes.remove(id)
      })
      linked.clear()
      owned.clear()
      release()
      giveViewBack()
      engine.notifyNodeChanged?.()
    }
  }, [engine, preview])
}

/**
 * Draw a board draft with attachWorkshop (`draft: true`, view-only, in the scope `pv`) where Keep will put it, bring its
 * frame into view, and take it away (and give the view back) when the preview goes. Its kit and rules load first.
 */
function drawBoardDraft(engine, { workshop, origin }, preview) {
  let gone = false
  let board = null
  let before = null
  ;(async () => {
    try {
      // The one renderer (boardRender.js): the same kit, rules and layout as the kept board, drawn as a draft.
      const width = engine.element?.clientWidth || window.innerWidth
      const drawn = await drawBoard(engine, workshop, { how: 'draft', origin, width, style: workshopStyle(engine.freeNodes?.() ?? []) })
      if (gone) { drawn.destroy(); return }
      board = drawn
      await board.whenDrawn()
      if (gone) return
      // Into view at a size that can be read, the dashed frame and its tag included; the person's view comes back after.
      const view = viewOf(engine)
      if (!view) return
      // On a phone the toolbar's floating buttons lie over the canvas's top (52px, as for a board's own fit).
      const narrow = view.rect.width < 600
      const whole = draftShownBox(board.frame, { zoom: view.zoom, above: narrow ? 52 : 0 })
      const next = previewView(previewShown(whole, preview.focus ?? null, view), view)
      if (!next) return
      before = { cx: view.cx, cy: view.cy, zoom: view.zoom }
      engine.canvas.viewbox(next.x, next.y, next.width, next.height)
    } catch (err) {
      console.warn('The preview could not be drawn on the canvas.', err)
    }
  })()
  return () => {
    gone = true
    try { board?.destroy() } catch { /* The slate is already gone. */ }
    if (before) {
      try {
        const view = viewOf(engine)
        if (view) {
          const width = view.rect.width / before.zoom, height = view.rect.height / before.zoom
          engine.canvas.viewbox(before.cx - width / 2, before.cy - height / 2, width, height)
        }
      } catch { /* The page is leaving. */ }
    }
  }
}

/** The view now, as the preview reads it: the box, the zoom (from the canvas's width in pixels) and its centre. */
function viewOf(engine) {
  const view = engine.canvas?.viewbox?.()
  const rect = engine.element?.getBoundingClientRect?.()
  if (!view || !rect || !(rect.width > 0) || !(rect.height > 0) || !(view.width > 0)) return null
  const zoom = rect.width / view.width
  const cx = view.x + view.width / 2, cy = view.y + view.height / 2
  const height = rect.height / zoom
  return { x: view.x, y: cy - height / 2, width: view.width, height, zoom, cx, cy, rect }
}
