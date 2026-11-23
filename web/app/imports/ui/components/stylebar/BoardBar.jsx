import React from 'react'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import { BarButton, useRoving } from './parts'

/**
 * A board's bar, over a selected lane (its header, caption or column): how a phone or the keyboard
 * reaches "Change this board", where a mouse has the gear over the board. The lane's own tap and
 * double-tap (drag, rename) are the canvas's, unchanged. Over a map's picked path (`path`, "Option A to
 * Decide"): a map's paths are fixed outside focus, so the bar says so and offers "Change this board".
 */
export default function BoardBar({ title, lane, path, mode, barRef, onChangeBoard, onAsk }) {
  useRoving(barRef, [mode])
  const compact = mode !== 'full'
  return (
    <div ref={barRef} className="sb-style-bar" data-mode={mode === 'phone' ? 'compact' : mode} role="toolbar"
      aria-label={path ? `Path from ${path} on ${title}` : `Board: ${title}`} {...(path && { 'data-board-path': '' })}>
      {path && !compact && <span className="sb-bar-note">Path · {path}</span>}
      <BarButton label="Change this board" tip={compact} onClick={onChangeBoard} data-board-change="">
        <SettingsOutlinedIcon aria-hidden />{compact ? 'Change' : 'Change this board'}
      </BarButton>
      {onAsk && (
        <BarButton className="sb-ask" tip={compact} label={`Ask Slatebox about ${lane || 'this lane'}`} onClick={onAsk}>
          <AutoAwesomeIcon aria-hidden style={{ width: 16, height: 16 }} />{compact ? 'Ask' : 'Ask Slatebox'}
        </BarButton>
      )}
    </div>
  )
}
