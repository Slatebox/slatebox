import React from 'react'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import { workshopDestinations, workshopNodeIds, workshopOverrideCandidate } from 'slateboxjs/workshops/model'
import { placeBar, barMode, cardBar, forNote } from '../../../api/common/note-style.mjs'
import NoteBar from './NoteBar'
import LineBar from './LineBar'
import CardBar from './CardBar'
import BoardBar from './BoardBar'
import BoardGear from './BoardGear'
import './bar.css'

/**
 * The small bar over whatever is selected on the canvas, drawn from the engine's selection
 * frame (`onSelectionFrame`): a note, several notes, a line, or a workshop card. It sits 12px
 * above the top connect dot (below the selection when there is no room), stays inside the
 * visible canvas, and steps aside while the selection is dragged, resized, turned, panned
 * or zoomed. On a phone it is five buttons whose choices open in sheets from the bottom.
 */
export default function StyleBar({
  slate, frame, editable, conversation, author, updateNode, updateLine, onAsk, workshop, boards, tick, onBarTick, onChangeBoard: changeBoard,
}) {
  const theme = useTheme()
  const phone = useMediaQuery('(max-width:599.95px)')
  const layerRef = React.useRef(null)
  const barRef = React.useRef(null)
  const [at, setAt] = React.useState(null)
  const [phoneSheet, setPhoneSheet] = React.useState(null)
  const [, setLocalTick] = React.useState(0)
  const v2 = slate?.v2
  const shell = theme.palette.shell ?? {}
  const vars = {
    '--sb-surface': shell.surface ?? '#fffef8',
    '--sb-ink': shell.ink ?? '#193c2f',
    '--sb-secondary-ink': shell.secondaryInk ?? '#486351',
    '--sb-border': shell.border ?? '#c6d1bf',
    // A control's own edge (an outlined button, a shape tile): 3:1 on the surface, where --sb-border is a quiet divider.
    '--sb-edge': theme.palette.thematic?.borderColor ?? '#819786',
    '--sb-selected': shell.selected ?? '#dce9ce',
    '--sb-selected-ink': shell.selectedInk ?? '#183d28',
    '--sb-offset': shell.offset ?? '#edf0e5',
    '--sb-hover': shell.offset ?? '#edf0e5',
    '--sb-ask': theme.palette.mode === 'dark' ? (shell.selected ?? '#3c5344') : (shell.appBar ?? '#223e32'),
    '--sb-ask-ink': theme.palette.mode === 'dark' ? (shell.selectedInk ?? '#ffe0a4') : '#ffffff',
    '--sb-danger': theme.palette.mode === 'dark' ? '#ff8a80' : '#c62828',
    '--sb-focus': theme.palette.mode === 'dark' ? '#f2ce8b' : '#1f6feb',
    '--sb-add': theme.palette.primary?.main ?? '#254b3b',
    '--sb-add-ink': theme.palette.primary?.contrastText ?? '#ffffff',
  }

  // The same colours for what is drawn outside the bar's layer (the phone's sheets).
  React.useEffect(() => {
    const root = document.documentElement.style
    Object.entries(vars).forEach(([k, v]) => root.setProperty(k, v))
  }, [theme.palette.mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // "Change this board" for the board the bar is about (a slate holds up to 8; each has its own gear).
  const onChangeBoard = changeBoard ? () => changeBoard(workshop?.boardId ?? 'main') : null
  // What the bar is about.
  const kind = frame?.kind
  const nodes = (kind === 'node' || kind === 'nodes') && v2 ? frame.ids.map((id) => v2.getNode(id)).filter(Boolean) : []
  const selectedCard = workshop?.ready && kind === 'node' && workshop.selection?.kind === 'card' ? workshop.selection.id : null
  const governed = nodes.some((n) => v2?.governanceOf?.(n))
  const line = kind === 'line' ? slate?.getSelectedLine?.() : null
  // A lane of the board selected (its header, or its caption or column, which select it): the board's
  // bar, with "Change this board", for a phone and the keyboard. Only where the board can be changed.
  const selectedLane = workshop?.ready && onChangeBoard && kind === 'node' && nodes.length === 1 && workshop.selection?.kind === 'lane'
    ? workshop.model?.lanes?.find((l) => l.id === workshop.selection.id) : null
  // A map's path picked (outside focus, where a map's paths are fixed): the same bar, "Change this board" (boards S2b).
  const selectedPath = workshop?.ready && onChangeBoard && !workshop.focus && workshop.selection?.kind === 'path'
    ? workshop.selection : null
  const pathEl = selectedPath ? document.querySelector(`#slateCanvas [data-board-link="${CSS.escape(selectedPath.id)}"]`) : null
  const pathRect = pathEl?.getBoundingClientRect()
  const pathFrame = pathRect ? { kind: 'path', ids: [], rect: { left: pathRect.left, top: pathRect.top, right: pathRect.right, bottom: pathRect.bottom,
    width: pathRect.width, height: pathRect.height } } : null
  const stepName = (id) => workshop?.model?.lanes?.find((l) => l.id === id)?.label ?? id
  let what = null
  if (selectedCard) what = 'card'
  else if (selectedLane) what = 'board'
  else if (pathFrame) what = 'path'
  else if (kind === 'line' && line && editable) what = 'line'
  else if (nodes.length && !governed && editable) what = 'note'

  const layerBox = layerRef.current?.getBoundingClientRect()
  const canvasWidth = layerBox?.width ?? window.innerWidth
  const mode = phone ? 'phone' : barMode({ kind: what === 'note' && nodes.length > 1 ? 'nodes' : what ?? 'note', canvasWidth })
  // The card's bar sits above its lane, so the lane's title and the other cards stay readable.
  let anchorTop = null
  if (what === 'card' && v2) {
    const card = workshop.model?.cards?.find((c) => c.id === selectedCard)
    // The workshop's own lane note (a slate's ordinary note may carry the same name).
    const name = card && workshopNodeIds.of(workshop.boardId === 'main' ? undefined : workshop.boardId).lane(card.laneId)
    const lane = card && v2.getAllNodes().find((n) => (n.id === name || n.id.startsWith(`${name}--`)) && v2.governanceOf?.(n))
    if (lane) anchorTop = v2.worldToClient({ x: lane.options.x ?? 0, y: lane.options.y ?? 0 }).y
  }
  // The board's bar sits above the board, clear of its lanes' names.
  if (what === 'board' && v2 && workshop.frame) anchorTop = v2.worldToClient({ x: workshop.frame.x, y: workshop.frame.y }).y
  const cardModel = what === 'card' ? cardBar({
    workshop: workshop.visible ?? workshop.model,
    cardId: selectedCard,
    destinations: workshopDestinations,
    asksFirst: (board, cardId, laneId) => workshopOverrideCandidate(board, cardId, laneId, { by: 'check', at: new Date(0).toISOString() }) !== null,
    editable: workshop.editable,
    canEdit: nodes[0] ? v2?.capabilitiesOf?.(nodes[0])?.canEdit !== false : false,
    author,
    conversation,
  }) : null

  React.useLayoutEffect(() => {
    const layer = layerRef.current
    const bar = barRef.current
    const set = (next) => setAt((prev) => (prev?.left === next?.left && prev?.top === next?.top ? prev : next))
    if (!layer || !bar || !what) { set(null); return }
    const box = layer.getBoundingClientRect()
    const size = bar.getBoundingClientRect()
    const place = placeBar({ frame: what === 'path' ? pathFrame : frame, bar: { width: size.width, height: size.height }, canvas: box, anchorTop })
    set(place ? { left: Math.round(place.left - box.left), top: Math.round(place.top - box.top) } : null)
  })

  // A phone sheet keeps the note in view above it.
  React.useEffect(() => {
    if (!phoneSheet || !frame?.rect || !v2) return
    requestAnimationFrame(() => {
      const sheet = document.querySelector('.sb-sheet')
      if (!sheet) return
      const top = sheet.getBoundingClientRect().top
      const overlap = frame.rect.bottom + 16 - top
      if (overlap > 0) v2.panBy({ x: 0, y: overlap / (v2.getZoom?.() || 1) })
    })
  }, [phoneSheet]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { setPhoneSheet(null) }, [frame?.ids?.join(','), phone])

  // A note locked meanwhile (by someone else, before this bar heard of it) takes no style change.
  const send = (pkgs) => {
    updateNode((node) => forNote(node.options, typeof pkgs === 'function' ? pkgs(node) : pkgs), nodes)
    setLocalTick((t) => t + 1)
    onBarTick?.()
  }
  const sendLine = (pkg) => { updateLine(pkg, line); setLocalTick((t) => t + 1) }

  // Keyboard: Tab goes note, its connect dots, then the bar (before the zoom controls and the
  // rest of the page); Shift+Tab goes back; Escape on a bar button goes back to the note, which
  // stays selected.
  const ids = frame?.ids?.join(',') ?? ''
  React.useEffect(() => {
    if (!what) return undefined
    const noteEl = () => {
      const id = what === 'line' ? frame?.line?.nodeId : frame?.ids?.[0]
      return id ? document.querySelector(`#slateCanvas [data-node-id="${CSS.escape(id)}"]`) : null
    }
    const key = (event) => {
      const bar = barRef.current
      if (!bar || (event.key !== 'Tab' && event.key !== 'Escape')) return
      const active = document.activeElement
      const items = [...bar.querySelectorAll('[data-roving]')].filter((el) => !el.disabled && el.offsetParent !== null)
      const inBar = items.includes(active)
      // The note's connect dots of this selection, in order (the engine puts them right after the note).
      const dots = () => {
        const n = noteEl()
        const r = n?.getBoundingClientRect()
        return r ? [...document.querySelectorAll('#slateCanvas .connection-handle')].filter((d) => {
          const box = d.getBoundingClientRect()
          return box.width > 0 && box.left >= r.left - 40 && box.right <= r.right + 40 && box.top >= r.top - 60 && box.bottom <= r.bottom + 60
        }) : []
      }
      if (event.key === 'Tab' && !event.shiftKey && !inBar) {
        // Note, its connect dots, then the bar: Tab from the last dot (or from the note when it
        // has no dots) comes here. The engine may already have moved focus in the same press,
        // so the press's own target is what counts.
        if (document.querySelector('.sb-inline-editor')) return
        const from = event.target instanceof Element ? event.target : active
        const list = dots()
        const fromNote = from?.closest?.('#slateCanvas [data-node-id]')
        const lastDot = list.length && from === list[list.length - 1]
        const noteWithoutDots = fromNote && frame?.ids?.includes(fromNote.getAttribute('data-node-id')) && !list.length
        if (!lastDot && !noteWithoutDots) return
        const first = items.find((el) => el.tabIndex === 0) ?? items[0]
        if (!first) return
        event.preventDefault()
        event.stopImmediatePropagation()
        first.focus()
      } else if (event.key === 'Tab' && event.shiftKey && inBar && what !== 'line') {
        // Back to the last connect dot, or the note.
        const list = dots()
        const back = list[list.length - 1] ?? noteEl()
        if (!back) return
        event.preventDefault()
        event.stopPropagation()
        back.focus({ preventScroll: true })
      } else if (inBar && ((event.key === 'Tab' && event.shiftKey) || event.key === 'Escape')) {
        // An open popover closes first (its own Escape); the next Escape comes here.
        if (event.key === 'Escape' && document.querySelector('.sb-pop')) return
        const n = noteEl()
        if (!n) return
        event.preventDefault()
        event.stopPropagation()
        n.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [what, ids]) // eslint-disable-line react-hooks/exhaustive-deps

  const noteRect = frame?.rect ?? null
  const hidden = !at
  const style = { left: at?.left ?? -9999, top: at?.top ?? -9999, visibility: hidden ? 'hidden' : 'visible' }
  return (
    <div ref={layerRef} className="sb-style-layer" style={vars} data-tick={tick}>
      {what && !(hidden && frame?.moving) && (
        <div style={{ position: 'absolute', ...style }} className="sb-style-anchor" data-placement-ready={at ? 'true' : 'false'}>
          {what === 'note' && (
            <NoteBar slate={slate} nodes={nodes} mode={mode} send={send} onAsk={onAsk} canAsk={conversation}
              layer={layerRef.current} barRef={barRef} noteRect={noteRect} phoneSheet={phoneSheet} setPhoneSheet={setPhoneSheet} />
          )}
          {what === 'line' && (
            <LineBar slate={slate} line={line} mode={mode} sendLine={sendLine} layer={layerRef.current} barRef={barRef} noteRect={noteRect} />
          )}
          {what === 'board' && (
            <BoardBar title={workshop.model.title} lane={selectedLane.label} mode={mode} barRef={barRef}
              onChangeBoard={onChangeBoard} onAsk={() => onAsk(nodes, { card: true })} />
          )}
          {what === 'path' && (
            <BoardBar title={workshop.model.title} path={`${stepName(selectedPath.from)} to ${stepName(selectedPath.to)}`} mode={mode} barRef={barRef}
              onChangeBoard={onChangeBoard} />
          )}
          {what === 'card' && cardModel.controls.length > 0 && (
            <CardBar bar={cardModel} mode={mode} layer={layerRef.current} barRef={barRef} noteRect={noteRect}
              onEdit={() => nodes[0]?.editor?.startInline?.()}
              onMove={(laneId) => workshop.move?.(selectedCard, laneId)}
              onAsk={() => onAsk(nodes, { card: true })}
              onRemove={() => workshop.removeCard?.(selectedCard)} />
          )}
        </div>
      )}
      {/* The gear over each board, on a laptop: "Change this board". */}
      {changeBoard && !phone && (boards?.length ? boards : workshop ? [workshop] : []).map((board) => board.ready && board.frame && (
        <BoardGear key={board.boardId ?? 'main'} v2={v2} frame={board.frame} focused={Boolean(board.focus)} layer={layerRef.current}
          onChangeBoard={() => changeBoard(board.boardId ?? 'main')} />
      ))}
    </div>
  )
}
