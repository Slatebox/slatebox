// What a new, empty slate shows in the middle of its canvas: the tile mark with its first tile
// placed, "Your slate is ready", and the two ways to begin (a note, or a board from the library).
// It is not on the slate: nothing is saved, and it goes as soon as the slate holds a note or a
// board (and comes back if the slate is emptied). It covers only itself: a double-click on the
// canvas around it makes the same note Add a note does (common/newNote.mjs). Theme tokens only, so
// it reads the same in light and dark.
import React, { useEffect, useId, useState } from 'react'
import { Box, Button, Typography } from '@mui/material'
import { keyframes } from '@mui/material/styles'
import EditNoteIcon from '@mui/icons-material/EditNote'
import DashboardCustomizeOutlined from '@mui/icons-material/DashboardCustomizeOutlined'
import { TileLoader } from './SlateLoading'
import { requestLibrary } from './library/libraryBus'
import { addNoteInView } from '../common/newNote.mjs'
import { space } from '../common/AccountLayout' // the app's spacing scale
import { Meteor } from 'meteor/meteor'
import { Link as RouterLink } from 'react-router-dom'
import { startGroup } from '../../api/common/first-slate.mjs'

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
    // No stacking of its own: what floats over the canvas after it (a huddle's strip, the style bar) stays on top.
    p: space.group, pb: phone ? 9 : space.group, pointerEvents: 'none', boxSizing: 'border-box', containerType: 'size' }}>
    <Box component="section" aria-labelledby={titleId} sx={{
      pointerEvents: 'auto', textAlign: 'center', maxWidth: 440, width: '100%', boxSizing: 'border-box',
      px: { xs: space.block, sm: space.section }, py: { xs: space.block, sm: space.section }, borderRadius: '20px', border: 1, borderColor: 'divider',
      bgcolor: 'background.paper', color: 'text.primary',
      boxShadow: theme => (theme.palette.mode === 'dark' ? '0 18px 48px rgb(0 0 0 / 45%)' : '0 18px 48px rgb(25 53 41 / 12%)'),
      animation: `${arrive} .35s ease-out both`, '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      [compact]: { py: space.group, px: space.block, borderRadius: '16px' },
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: space.group, [compact]: { display: 'none' } }}>
        <TileLoader once size={phone ? 72 : 96} />
      </Box>
      <Typography id={titleId} component="h2" variant={phone ? 'h6' : 'h5'} sx={{ fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.15, [compact]: { typography: 'h6', fontWeight: 700 } }}>
        Your slate is ready
      </Typography>
      <Typography variant="body1" sx={{ color: 'text.secondary', lineHeight: 1.5, mt: space.tight, mx: 'auto', maxWidth: 340,
        [compact]: { typography: 'body2', mt: space.hair }, [tiny]: { display: 'none' } }}>{lede}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: space.tight, mt: space.group, [compact]: { mt: space.text } }}>
        <Button variant="contained" disableElevation size={phone ? 'medium' : 'large'} startIcon={<EditNoteIcon />} onClick={() => addNoteInView(slate, canvasId)}
          sx={{ borderRadius: 6, px: space.block }}>Add a note</Button>
        {canPick && !boardsInSight && <Button variant="outlined" size={phone ? 'medium' : 'large'} startIcon={<DashboardCustomizeOutlined />}
          onClick={() => requestLibrary({ start: startGroup(Meteor.user()?.profile?.start) ? { group: startGroup(Meteor.user()?.profile?.start) } : {} })} sx={{ borderRadius: 6, px: space.block }}>Pick a board</Button>}
      </Box>
      {!phone && <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: space.group, mb: 0, '@media (pointer: coarse)': { display: 'none' } }}>
        Or double-click anywhere on the canvas.
      </Typography>}
      {/* The first run again: a working board for a job, set up from a one-click answer. */}
      <Button component={RouterLink} to="/new?again=1" size="small" data-start-from-job="" sx={{ mt: space.text, textTransform: 'none', color: 'text.secondary', [tiny]: { display: 'none' } }}>Start from a job</Button>
    </Box>
  </Box>
}
