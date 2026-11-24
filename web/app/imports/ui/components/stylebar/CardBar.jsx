import React from 'react'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import EastIcon from '@mui/icons-material/East'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { BarButton, Pop, useRoving } from './parts'

/**
 * A workshop card's bar: only what the workshop allows. Edit the card's name on the canvas,
 * move it to a lane it may go to, ask about it, and (for the slate's author) remove it.
 */
export default function CardBar({ bar, mode, onEdit, onMove, onAsk, onRemove, layer, barRef, noteRect }) {
  const [open, setOpen] = React.useState(false)
  const [asking, setAsking] = React.useState(false)
  const anchor = React.useRef(null)
  const removeRef = React.useRef(null)
  useRoving(barRef, [mode, bar.controls.join()])
  React.useEffect(() => { setOpen(false); setAsking(false) }, [bar.card?.id])
  const compact = mode !== 'full'
  const has = (c) => bar.controls.includes(c)
  return (
    <>
      <div ref={barRef} className="sb-style-bar" data-mode={mode === 'phone' ? 'compact' : mode} role="toolbar" aria-label={`Card: ${bar.card?.label || 'Empty card'}`}>
        {has('edit') && (
          <BarButton label="Edit the card's name" tip={compact} onClick={onEdit}><EditOutlinedIcon aria-hidden />{!compact && 'Edit'}</BarButton>
        )}
        {has('move') && (
          <BarButton ref={anchor} label={bar.moveLabel} tip={false} caret expanded={open} controls="sb-pop-card-move"
            style={{ background: 'var(--sb-selected)', color: 'var(--sb-selected-ink)' }} onClick={() => setOpen((o) => !o)}>
            <EastIcon aria-hidden />{compact ? 'Move' : bar.moveLabel}
          </BarButton>
        )}
        {has('ask') && (
          <BarButton className="sb-ask" tip={compact} label={`Ask Slatebox about ${bar.card?.label || 'this card'}`} onClick={onAsk}>
            <AutoAwesomeIcon aria-hidden style={{ width: 16, height: 16 }} />{compact ? 'Ask' : 'Ask Slatebox'}
          </BarButton>
        )}
        {has('remove') && (
          <BarButton ref={removeRef} className="sb-danger" label="Remove card" expanded={asking} controls="sb-pop-card-remove"
            onClick={() => { setOpen(false); setAsking((a) => !a) }}><DeleteOutlineIcon aria-hidden /></BarButton>
        )}
      </div>
      {/* Removing a card asks first. Once removed, "Undo last change" on the workshop strip brings it back. */}
      <Pop id="sb-pop-card-remove" open={asking} onClose={(refocus) => { setAsking(false); if (refocus) removeRef.current?.focus() }}
        anchor={removeRef.current} layer={layer} note={noteRect} label={`Remove ${bar.card?.label || 'card'}?`} takeFocus>
        <div style={{ display: 'grid', gap: 8, width: 260 }}>
          <div className="sb-label" style={{ margin: 0 }}>Remove {bar.card?.label || 'this card'}?</div>
          <p className="sb-value" style={{ margin: 0 }}>It leaves the workshop for everyone. Undo last change brings it back.</p>
          <div className="sb-actions">
            <button type="button" className="sb-quiet" data-autofocus="" onClick={() => { setAsking(false); removeRef.current?.focus() }}>Cancel</button>
            <button type="button" className="sb-primary sb-danger-fill" onClick={() => { setAsking(false); onRemove() }}>Remove {bar.card?.label || 'card'}</button>
          </div>
        </div>
      </Pop>
      <Pop id="sb-pop-card-move" open={open} onClose={(refocus) => { setOpen(false); if (refocus) anchor.current?.focus() }} anchor={anchor.current} layer={layer} note={noteRect} label={`Move ${bar.card?.label || 'card'} to`} side>
        <div className="sb-label">Move {bar.card?.label || 'this card'} to</div>
        <div className="sb-menu" role="radiogroup" aria-label={`Move ${bar.card?.label || 'card'} to`} style={{ padding: 0 }}>
          {bar.lanes.map((lane, i) => (
            <button key={lane.id} type="button" className="sb-row" role="radio" aria-checked={lane.here} data-autofocus={i === 0 ? '' : undefined}
              onClick={() => { if (!lane.here) onMove(lane.id); setOpen(false) }}>
              <span /><span>{lane.label}</span><span className="sb-value">{lane.here ? 'here' : lane.asks ? 'asks first' : ''}</span><span />
            </button>
          ))}
        </div>
      </Pop>
    </>
  )
}
