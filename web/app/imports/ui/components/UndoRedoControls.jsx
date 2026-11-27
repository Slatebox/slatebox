import React from 'react'
import { createPortal } from 'react-dom'
import { IconButton, Snackbar, Tooltip } from '@mui/material'
import UndoIcon from '@mui/icons-material/Undo'
import RedoIcon from '@mui/icons-material/Redo'
import { undoRedoKeys } from '../../api/common/undo-redo-keys.mjs'

const stop = (event) => event.stopPropagation()

/**
 * Undo and Redo for the person at this canvas: their own steps only (a teammate's or an agent's
 * changes are not theirs to take back), in the engine's history, which also holds their changes to
 * a board (useWorkshopOnCanvas). Drawn inside the canvas, at its bottom-left corner from a tablet up
 * and as a slim column at the left on a phone, level with the zoom control. Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z
 * and Ctrl+Y do the same from the keyboard. What an undo could not do is said under the canvas.
 */
export default function UndoRedoControls({ slate, narrow = false }) {
  const engine = slate?.v2 ?? slate
  const element = engine?.element ?? null
  const [state, setState] = React.useState({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null })
  const [said, setSaid] = React.useState(null)
  React.useEffect(() => {
    if (!slate?.onUndoRedo) return undefined
    return slate.onUndoRedo((next, outcome) => {
      setState(next)
      if (outcome?.message) setSaid({ key: Date.now(), text: outcome.message })
    })
  }, [slate])
  // The pill sits in the bottom-left corner (a column on a phone), where the presence pill
  // (CornerPresence) would cover it: that starts right of where it ends (--sb-undo-redo-end, in the viewport).
  const pill = React.useRef(null)
  React.useLayoutEffect(() => {
    const node = pill.current
    if (!node || typeof document === 'undefined') return undefined
    const root = document.documentElement
    const place = () => root.style.setProperty('--sb-undo-redo-end', `${Math.round(node.getBoundingClientRect().right)}px`)
    place()
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null
    watch?.observe(node)
    window.addEventListener('resize', place)
    return () => {
      watch?.disconnect()
      window.removeEventListener('resize', place)
      root.style.removeProperty('--sb-undo-redo-end')
    }
  }, [narrow, element, slate])
  if (!element || !slate?.onUndoRedo) return null
  const keys = undoRedoKeys(typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent)
  // A phone has no keyboard to name.
  const hint = (key) => narrow ? '' : ` (${key})`
  const undoTitle = (state.undoLabel ? `Undo ${lower(state.undoLabel)}` : 'Undo') + hint(keys.undo)
  const redoTitle = (state.redoLabel ? `Redo ${lower(state.redoLabel)}` : 'Redo') + hint(keys.redo)
  const size = narrow ? 40 : 32
  const button = { width: size, height: size, color: 'inherit', '&.Mui-disabled': { color: 'inherit', opacity: 0.35 } }
  return <>
    {createPortal(
      <div ref={pill} className="sb-undo-redo" role="group" aria-label="Undo and redo" data-compact={narrow ? '' : undefined}
        // Presses here are not presses on the canvas: no marquee, no new note on a double-click.
        onPointerDown={stop} onMouseDown={stop} onTouchStart={stop} onDoubleClick={stop} onClick={stop}
        style={{
          position: 'absolute', zIndex: 1000, left: narrow ? 12 : 16,
          bottom: narrow ? 'calc(var(--slatebox-zoom-offset, 0px) + 12px)' : 21,
          display: 'flex', flexDirection: narrow ? 'column' : 'row', alignItems: 'center', gap: narrow ? 0 : 2,
          padding: narrow ? '4px 0' : '2px 6px', borderRadius: 18,
          background: 'var(--sb-surface, #fffef8)', color: 'var(--sb-ink, #193c2f)',
          border: '1px solid var(--sb-border, #c6d1bf)', boxShadow: '0 2px 10px rgb(25 53 41 / 12%)',
        }}>
        <Tooltip title={undoTitle} placement={narrow ? 'right' : 'top'}>
          <span><IconButton aria-label="Undo" aria-keyshortcuts={keys.undoAria} disabled={!state.canUndo} sx={button}
            onClick={() => slate.undo()}><UndoIcon fontSize={narrow ? 'medium' : 'small'} /></IconButton></span>
        </Tooltip>
        <Tooltip title={redoTitle} placement={narrow ? 'right' : 'top'}>
          <span><IconButton aria-label="Redo" aria-keyshortcuts={keys.redoAria} disabled={!state.canRedo} sx={button}
            onClick={() => slate.redo()}><RedoIcon fontSize={narrow ? 'medium' : 'small'} /></IconButton></span>
        </Tooltip>
      </div>,
      element,
    )}
    <Snackbar data-undo-notice key={said?.key} open={Boolean(said)} message={said?.text} autoHideDuration={6000}
      onClose={(_, reason) => { if (reason !== 'clickaway') setSaid(null) }}
      anchorOrigin={{ vertical: narrow ? 'top' : 'bottom', horizontal: 'center' }} sx={narrow ? { top: '64px !important' } : undefined} />
  </>
}

const lower = (label) => label.charAt(0).toLowerCase() + label.slice(1)
