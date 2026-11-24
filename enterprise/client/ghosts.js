// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Invited agents' suggestions, drawn ON the slate as ghost notes while the agent works: real
// engine notes that the slate never saves (dashed, see-through, in the agent's colour), with
// "Keep" and "Discard" right under each group and "from <name>" above it. Everyone who can read
// the slate sees them (the server publishes them to every screen); only people who can edit get
// the two buttons. A ghost is inert: nobody can move, edit, connect or delete it, and the engine
// leaves it out of saves, undo, exports and what it sends to collaborators. Each ghost note is
// drawn under ghost-<id> (the id the note will have once kept), so the agent's cursor can point
// at it.
import { useEffect, useRef } from 'react'
import { compat, AGENT_PALETTE } from 'slateboxjs'
import { previewArtwork } from '/imports/api/common/conversation-preview.mjs'

const inert = Object.freeze({ canMove: false, canResize: false, canRotate: false, canDelete: false, canDuplicate: false,
  canConnect: false, canEditText: false, canSelect: false, persist: false, exportable: false })

export const colorOf = (index) => AGENT_PALETTE[(Number(index) || 1) % AGENT_PALETTE.length]

// The artwork for one waiting suggestion: its notes and lines, ids moved into the ghost space.
export function ghostArtwork(item, suggestion, existing, color) {
  const art = previewArtwork(item.canvas, existing)
  const scope = `${suggestion._id}-${item.n}`
  const rename = (id) => {
    if (typeof id !== 'string' || !id.startsWith('preview-')) return id
    const rest = id.slice('preview-'.length)
    return rest.startsWith('over-') ? `ghost-o${scope}-${rest.slice(5)}` : `ghost-${rest}`
  }
  const notes = art.notes.map((note) => ({
    ...note,
    options: {
      ...note.options,
      id: rename(note.options.id),
      ...(!note.overlay && { borderColor: color, borderStyle: 'dashed', borderWidth: 2, opacity: 0.72 }),
    },
  }))
  const links = art.links.map((link) => ({
    holderId: rename(link.holderId),
    targetId: rename(link.targetId),
    association: { ...link.association, id: rename(link.association.id), parentId: rename(link.association.parentId), childId: rename(link.association.childId), lineColor: color, lineOpacity: 0.8 },
  }))
  return { notes, links, bounds: art.bounds, scope }
}

// The label above a group and the two buttons under it, as notes.
function chrome({ bounds, scope, color, name, label, canEdit }) {
  const top = Math.round(bounds.y - 46)
  const left = Math.round(bounds.x)
  const below = Math.round(bounds.y + bounds.height + 12)
  const tag = {
    options: { id: `ghost-t${scope}`, text: `from ${name} · ${label}`.slice(0, 80), xPos: left, yPos: top, width: Math.max(180, Math.min(360, bounds.width)), height: 34,
      fontSize: 14, foregroundColor: '#ffffff', backgroundColor: color, borderWidth: 0 },
    relationships: { associations: [] }, role: 'tag',
  }
  if (!canEdit) return [tag]
  const button = (kind, text, x, filled) => ({
    options: { id: `ghost-${kind}${scope}`, text, xPos: x, yPos: below, width: 92, height: 34, fontSize: 15,
      foregroundColor: filled ? '#ffffff' : color, backgroundColor: filled ? color : '#ffffff', borderColor: color, borderWidth: 2 },
    relationships: { associations: [] }, role: kind,
  })
  return [tag, button('k', 'Keep', left, true), button('d', 'Discard', left + 104, false)]
}

/**
 * Draws every waiting suggestion on `engine` (the page's v2 slate) until they change.
 * suggestions: AgentSuggestions docs; colorFor(connectionId) -> colour; onDecide(suggestionId, n, keep).
 */
// A new suggestion the person asked for, outside what they see: the view glides over to it, at
// the same zoom. Nobody else's view moves.
function reveal(engine, bounds) {
  const view = engine.canvas?.viewbox?.()
  if (!view || !(view.width > 0)) return
  const inside = bounds.x >= view.x && bounds.y - 50 >= view.y && bounds.x + bounds.width <= view.x + view.width && bounds.y + bounds.height + 50 <= view.y + view.height
  if (inside) return
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  engine.canvas.viewbox(cx - view.width / 2, cy - view.height / 2, view.width, view.height)
}

export function useAgentGhosts(engine, suggestions, { canEdit, colorFor, onDecide, viewerId = null }) {
  const shown = useRef(new Set())
  const waiting = []
  for (const suggestion of suggestions)
    for (const item of suggestion.items || []) if (item.status === 'pending' && item.canvas) waiting.push({ suggestion, item })
  const key = waiting.map(({ suggestion, item }) => `${suggestion._id}:${item.n}`).join('|') + (canEdit ? ':e' : ':v')
  useEffect(() => {
    if (!engine || !waiting.length || typeof engine.setDragPolicy !== 'function') return undefined
    const existing = engine.freeNodes().map(({ id, options: o }) => ({ id, x: o.x, y: o.y, width: o.width, height: o.height }))
    const drawn = []
    for (const { suggestion, item } of waiting) {
      const color = colorFor(suggestion.connectionId)
      let art
      try {
        art = ghostArtwork(item, suggestion, existing, color)
      } catch (error) {
        console.warn('A suggestion could not be drawn.', error)
        continue
      }
      if (!art.bounds) continue
      const extra = chrome({ bounds: art.bounds, scope: art.scope, color, name: suggestion.name, label: item.label, canEdit })
      drawn.push({ ...art, notes: [...art.notes, ...extra], suggestion, item })
    }
    const fresh = drawn.filter((d) => !shown.current.has(d.scope))
    for (const d of drawn) shown.current.add(d.scope)
    const mine = fresh.filter((d) => viewerId && d.suggestion.ownerId === viewerId).at(-1)
    const wanted = new Set(drawn.flatMap((d) => d.notes.map((note) => note.options.id)))
    const owned = new Map()
    const linked = new Map()
    let gone = false
    const release = engine.setDragPolicy({
      governs: (node) => (wanted.has(node?.id) ? inert : null),
      onEnd: () => ({ accept: false }),
      onNotesReplaced() { owned.clear(); linked.clear(); draw() },
    })
    const wire = (node, note, entry) => {
      const group = node.svgGroup?.node
      if (!group) return
      if (note.role === 'k' || note.role === 'd') {
        // The one control on a ghost: a tap keeps or discards this group, for everyone on the slate.
        group.style.pointerEvents = 'auto'
        group.style.cursor = 'pointer'
        group.setAttribute('role', 'button')
        group.setAttribute('tabindex', '0')
        group.setAttribute('data-agent-ghost-action', note.role === 'k' ? 'keep' : 'discard')
        group.setAttribute('aria-label', `${note.role === 'k' ? 'Keep' : 'Discard'} ${entry.suggestion.name}'s suggestion: ${entry.item.label}`)
        const act = (event) => {
          event.preventDefault()
          event.stopPropagation()
          onDecide(entry.suggestion._id, entry.item.n, note.role === 'k')
        }
        group.addEventListener('pointerdown', (event) => event.stopPropagation())
        group.addEventListener('click', act)
        group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') act(event) })
        return
      }
      group.style.pointerEvents = 'none'
      if (note.overlay) return
      if (note.role === 'tag') group.setAttribute('aria-hidden', 'true')
      else {
        group.setAttribute('data-agent-ghost', entry.suggestion.connectionId)
        group.setAttribute('aria-label', `Suggestion from ${entry.suggestion.name}, not kept yet: ${String(note.options.text ?? '')}`)
      }
    }
    function connect() {
      engine.withPolicyAuthority(() => {
        for (const entry of drawn)
          for (const { holderId, targetId, association } of entry.links) {
            if (linked.has(association.id)) continue
            const holder = owned.get(holderId)
            const target = owned.get(targetId) ?? engine.nodes.one(targetId)
            if (!holder?.relationships || !target?.svgGroup) continue
            holder.relationships.addAssociation(target, compat.v1AssociationToV2(association))
            linked.set(association.id, holder)
            const line = holder.connector?.getConnections?.().find((c) => c.id === association.id)?.connectable
            line?.connector?.attr?.({ 'stroke-dasharray': '8 6', 'pointer-events': 'none', 'data-governed': 'line' })
            line?.hitArea?.attr?.({ 'pointer-events': 'none' })
          }
      })
      engine.notifyNodeChanged?.()
    }
    function draw() {
      const waits = []
      engine.withPolicyAuthority(() => {
        for (const entry of drawn)
          for (const note of entry.notes) {
            const id = note.options.id
            if (owned.has(id)) continue
            const node = engine.nodes.add(compat.v1NodeToV2(note.options))
            owned.set(id, node)
            waits.push(Promise.resolve(node.ready).then(() => {
              if (gone || owned.get(id) !== node) return
              node.applyGovernance?.()
              wire(node, note, entry)
            }).catch(() => undefined))
          }
      })
      Promise.all(waits).then(() => {
        if (gone) return
        connect()
        if (mine) { try { reveal(engine, mine.bounds) } catch { /* the page is leaving */ } }
      })
    }
    draw()
    return () => {
      gone = true
      engine.withPolicyAuthority(() => {
        for (const [id, holder] of linked) holder.relationships?.removeAssociation(id)
        for (const [id, node] of owned) if (engine.nodes.one(id) === node) engine.nodes.remove(id)
      })
      linked.clear()
      owned.clear()
      release()
      engine.notifyNodeChanged?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key])
}
