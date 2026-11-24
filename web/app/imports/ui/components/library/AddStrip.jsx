import React, { useEffect } from 'react'
import { Box, Button, ButtonBase, Typography } from '@mui/material'
import { prefetchLibrary } from './libraryBus'
import { stripPicks } from './picks'

const short = '@media (max-height:500px)'
const phone = '@media (max-width:600px)'

/**
 * "Add to this slate", under the message box on every slate (library final.md §2.2): three small
 * pictures of what can be added, ranked by what the slate holds, and Browse ›. The pictures are
 * stills (nothing under the message box moves on its own); the library plays its loops. A picture's
 * tap sends its add message; Browse opens the library in the conversation. On a short screen, or on
 * a phone once the conversation has something in it (`compact`), one "Add ›" instead.
 */
export default function AddStrip({ empty, hasBoard, onAdd, onBrowse, compact = false }) {
  useEffect(() => { prefetchLibrary() }, [])
  const picks = stripPicks({ empty, hasBoard })
  return <>
    <Box role="group" aria-label="Add to this slate" sx={{ display: 'flex', alignItems: 'center', gap: .75, mt: 1, [short]: { display: 'none' }, ...(compact && { [phone]: { display: 'none' } }) }}>
      <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Add to this slate</Typography>
      <Box sx={{ display: 'flex', gap: .5, minWidth: 0, flex: '1 1 auto' }}>
        {picks.map(([id, name]) => <ButtonBase key={id} aria-label={'Add ' + name} title={name} onClick={() => onAdd(id)}
          // A finger's size: 44px tall at the least, the picture centred in it.
          sx={{ borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider', flex: '0 1 72px', minWidth: 44, minHeight: 44, px: .5,
            display: 'flex', alignItems: 'center', justifyContent: 'center', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
          <img src={'/library/' + id + '-still.svg'} alt="" width="56" height="32" style={{ display: 'block', width: '100%', height: 'auto' }} />
        </ButtonBase>)}
      </Box>
      <Button size="small" onClick={onBrowse} sx={{ whiteSpace: 'nowrap', minWidth: 0 }}>Browse ›</Button>
    </Box>
    {compact && <Button size="small" onClick={onBrowse} sx={{ display: 'none', mt: .5, [phone]: { display: 'inline-flex' }, [short]: { display: 'none' } }}>Add to this slate ›</Button>}
  </>
}

/** On a short screen (a phone held sideways), the strip is one button beside the message box. */
export function AddShort({ onBrowse }) {
  return <Button size="small" onClick={onBrowse} sx={{ display: 'none', [short]: { display: 'inline-flex' } }}>Add ›</Button>
}
