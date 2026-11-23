// What a new, empty slate shows in the middle of its canvas: the tile mark with its first tile
// placed, "Your slate is ready", and the two ways to begin (a note, or a board from the library).
// It is not on the slate: nothing is saved, and it goes as soon as the slate holds a note or a
// board (and comes back if the slate is emptied). It covers only itself: a double-click on the
// canvas around it still makes a note. Theme tokens only, so it reads the same in light and dark.
import React, { useEffect, useId, useState } from 'react'
import { Box, Button, Typography } from '@mui/material'
import { keyframes } from '@mui/material/styles'
import EditNoteIcon from '@mui/icons-material/EditNote'
import DashboardCustomizeOutlined from '@mui/icons-material/DashboardCustomizeOutlined'
import { TileLoader } from './SlateLoading'
import { requestLibrary } from './library/libraryBus'
import { DEFAULT_NOTE } from '../common/canvasTheme.mjs'

const arrive = keyframes`from { opacity: 0; transform: translateY(8px) scale(.98) } to { opacity: 1; transform: none }`
// Sized by the canvas it sits in (a container), not the screen: on a phone the canvas is what Ask
// Slatebox's sheet leaves above it, so a short canvas gets the compact card.
const compact = '@container (max-height: 360px)'
const tiny = '@container (max-height: 230px)'

/** Whether the slate holds nothing: no note in its data and none drawn (a board's lanes are drawn as notes). */
function slateIsEmpty(slate, canvas) {
  const notes = slate?.v2?.getAllNodes?.() ?? slate?.nodes?.allNodes ?? []
  return notes.length === 0 && !canvas?.querySelector('g[data-node-id]')
}

/** The slate's emptiness, watched: the canvas's drawing changes whenever a note or board comes or goes. */
function useEmpty(slate, canvasId, active) {
  const [empty, setEmpty] = useState(false)
  useEffect(() => {
    if (!active || !slate) { setEmpty(false); return undefined }
    const canvas = document.getElementById(canvasId)
    let frame = 0
    // A moment's grace before it first shows, so a slate whose notes are still being drawn never flashes it.
    let settled = false
    const check = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setEmpty(settled && slateIsEmpty(slate, canvas))) }
    const timer = setTimeout(() => { settled = true; check() }, 450)
    const observer = typeof MutationObserver === 'function' && canvas ? new MutationObserver(check) : null
    observer?.observe(canvas, { childList: true, subtree: true })
    return () => { clearTimeout(timer); cancelAnimationFrame(frame); observer?.disconnect() }
  }, [slate, canvasId, active])
  return empty
}

/**
 * A note in the middle of what the canvas shows, in the slate's default note look (AA text in both
 * modes), with its words being typed: the same note a double-click makes, ready to write in.
 */
function addFirstNote(slate, canvasId) {
  const v2 = slate?.v2
  const canvas = document.getElementById(canvasId)
  if (!v2?.addNode || !canvas) return
  const box = canvas.getBoundingClientRect()
  const at = v2.canvas?.point?.(box.left + box.width / 2, box.top + box.height / 2) ?? { x: 10000, y: 10000 }
  const width = 180
  const height = 84
  const node = v2.addNode({
    x: Math.round(at.x - width / 2), y: Math.round(at.y - height / 2), width, height, text: '',
    shape: 'roundedrectangle', backgroundColor: DEFAULT_NOTE.backgroundColor, fontColor: DEFAULT_NOTE.foregroundColor,
    fontFamily: 'Manrope', fontSize: 18, borderWidth: 0,
  })
  Promise.resolve(node?.ready).then(() => {
    v2.selectNodes?.([node])
    node?.editor?.startInline?.()
  })
}

export default function SlateWelcome({ slate, canvasId, active, phone = false, askOpen = false, canPick = true }) {
  const empty = useEmpty(slate, canvasId, active)
  const titleId = useId()
  if (!empty) return null
  // With Ask Slatebox open beside the canvas (or under it on a phone) its boards are in sight already.
  const boardsInSight = askOpen && canPick
  const where = phone ? 'below' : 'from Ask Slatebox'
  const lede = boardsInSight ? `Write a first note, or pick a board ${where}.` : 'Write a first note, or let Slatebox set up a board for the work in front of you.'
  // On a phone the zoom control floats at the canvas's foot: the card keeps clear of it.
  return <Box data-slate-welcome="" sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    p: 2, pb: phone ? 9 : 2, pointerEvents: 'none', zIndex: 3, boxSizing: 'border-box', containerType: 'size' }}>
    <Box component="section" aria-labelledby={titleId} sx={{
      pointerEvents: 'auto', textAlign: 'center', maxWidth: 440, width: '100%', boxSizing: 'border-box',
      px: { xs: 2.5, sm: 4 }, py: { xs: 2.5, sm: 3.5 }, borderRadius: '20px', border: 1, borderColor: 'divider',
      bgcolor: 'background.paper', color: 'text.primary',
      boxShadow: theme => (theme.palette.mode === 'dark' ? '0 18px 48px rgb(0 0 0 / 45%)' : '0 18px 48px rgb(25 53 41 / 12%)'),
      animation: `${arrive} .35s ease-out both`, '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      [compact]: { py: 2, px: 2.5, borderRadius: '16px' },
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1.75, [compact]: { display: 'none' } }}>
        <TileLoader once size={phone ? 72 : 96} />
      </Box>
      <Typography id={titleId} component="h2" sx={{ fontWeight: 750, letterSpacing: '-.02em', lineHeight: 1.15, fontSize: phone ? 22 : 28, [compact]: { fontSize: 20 } }}>
        Your slate is ready
      </Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: phone ? 15 : 16, lineHeight: 1.5, mt: 1, mx: 'auto', maxWidth: 340,
        [compact]: { fontSize: 14.5, mt: .5 }, [tiny]: { display: 'none' } }}>{lede}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 1, mt: 2.25, [compact]: { mt: 1.5 } }}>
        <Button variant="contained" disableElevation size={phone ? 'medium' : 'large'} startIcon={<EditNoteIcon />} onClick={() => addFirstNote(slate, canvasId)}
          sx={{ borderRadius: 6, px: 2.75 }}>Add a note</Button>
        {canPick && !boardsInSight && <Button variant="outlined" size={phone ? 'medium' : 'large'} startIcon={<DashboardCustomizeOutlined />}
          onClick={() => requestLibrary({ start: {} })} sx={{ borderRadius: 6, px: 2.75 }}>Pick a board</Button>}
      </Box>
      {!phone && <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 2, mb: 0, '@media (pointer: coarse)': { display: 'none' } }}>
        Or double-click anywhere on the canvas.
      </Typography>}
    </Box>
  </Box>
}
