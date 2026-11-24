import React from 'react'
import Tooltip from '@mui/material/Tooltip'
import ButtonBase from '@mui/material/ButtonBase'
import Typography from '@mui/material/Typography'
import { requestLibrary } from './libraryBus'
import { stripPicks } from './picks'

// The + menu's "Boards and starters" rows (library final.md §2.2): the desktop dock's and the phone
// sheet's. A chunk of their own, out of the eager bundle: fetched when the + menu first draws.

/** "Boards and starters" in the desktop dock: three pictures (stills: nothing here moves on its own) and See all (library final.md §2.2). */
export function BoardsDock({ onDone, dark = false }) {
  const go = (detail) => { onDone?.(); requestLibrary(detail) }
  // On the dock's dark panel (`dark`) its link and focus ring take the dark mode's amber, in either mode.
  const accent = (theme) => (dark ? (theme.colorSchemes?.dark ?? theme).palette.primary.main : theme.palette.primary.main)
  const look = { display: 'block', borderRadius: 4, overflow: 'hidden', '&:focus-visible': { outline: '2px solid', outlineColor: accent } }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Typography variant="caption" aria-hidden="true" sx={{ fontWeight: 700, whiteSpace: 'nowrap', mr: .5 }}>Boards and starters</Typography>
      {stripPicks({}).map(([id, name]) => (
        <Tooltip key={id} title={'Add ' + name} placement="top">
          <ButtonBase aria-label={'Add ' + name} onClick={() => go({ add: id })}
            sx={{ ...look, width: 64, minHeight: 44, border: '1px solid rgba(0,0,0,.15)', background: '#faf8f2' }}>
            <img src={'/library/' + id + '-still.svg'} alt="" width="64" height="36" style={{ display: 'block' }} />
          </ButtonBase>
        </Tooltip>
      ))}
      <ButtonBase onClick={() => go({})} sx={{ ...look, whiteSpace: 'nowrap', fontSize: 13, px: 1, py: .5, color: accent, fontWeight: 600 }}>See all ›</ButtonBase>
    </span>
  )
}

/** "Boards and starters", the + menu's first row: three pictures and See all (the library, in Ask Slatebox). */
export function BoardsRow({ onDone, hasBoard = false }) {
  const go = (detail) => { onDone?.(); requestLibrary(detail) }
  return (
    <div role="group" aria-label="Boards and starters" style={{ marginBottom: 14 }}>
      <div className="sb-label" style={{ marginBottom: 6 }}>Boards and starters</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {stripPicks({ hasBoard }).map(([id, name]) => (
          <button key={id} type="button" className="sb-btn" aria-label={'Add ' + name} title={name} onClick={() => go({ add: id })}
            style={{ flex: '1 1 0', minWidth: 44, minHeight: 44, height: 'auto', padding: 4, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: 2 }}>
            <img src={'/library/' + id + '-still.svg'} alt="" style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 4 }} />
            <span style={{ fontSize: 11, lineHeight: 1.2 }}>{name}</span>
          </button>
        ))}
        <button type="button" className="sb-btn" onClick={() => go({})} style={{ flex: '0 0 auto', height: 'auto' }}>See all ›</button>
      </div>
    </div>
  )
}
