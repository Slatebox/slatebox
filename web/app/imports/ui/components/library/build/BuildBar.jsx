import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Box, Button, IconButton, Paper, Snackbar, Typography, useMediaQuery } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import useBuilder from './useBuilder'
import SaveSheet from './SaveSheet'
import { SAVED_SENTENCE, SUBMITTED_SENTENCE, buildBarWords, buildFirstTurn } from './buildTurns.mjs'

/**
 * The build bar on a builder slate (library spec §4.2), over the top of the canvas: "Building a smart component ·
 * <title> · Branched from Retro (Meetings)", with Save and Submit to the library. The board is grown by Ask Slatebox
 * (opened in build mode) and by the rule controls on the board itself; this bar only names it and sends it. On a
 * phone it is one row: Building · Save · Submit. The sheet opens under the bar (a bottom sheet on a phone), never a modal.
 */
export default function BuildBar({ slate }) {
  const builder = useBuilder(slate)
  const phone = useMediaQuery('(max-width:599.98px)')
  const [sheet, setSheet] = useState(null)
  const [toast, setToast] = useState(null)
  const [greeting, setGreeting] = useState(true)
  const opened = useRef(false)
  // Ask Slatebox opens in build mode once, as the builder slate opens.
  useEffect(() => {
    if (opened.current || !builder.shareId) return
    opened.current = true
    window.dispatchEvent(new Event('slatebox:open-canvas-conversation'))
  }, [builder.shareId])
  const words = buildBarWords({ library: builder.library, title: builder.item?.title ?? builder.board?.title, status: builder.status })
  const first = buildFirstTurn(builder.library)
  const hasBoard = Boolean(builder.board)
  const open = (which) => { builder.clearError(); setSheet(which) }
  const done = async (input, note) => {
    const sent = sheet === 'submit' ? await builder.submit(input, note) : await builder.save(input)
    if (!sent) return
    setToast(sheet === 'submit' ? SUBMITTED_SENTENCE : SAVED_SENTENCE)
    setSheet(null)
  }
  const blocked = !hasBoard ? 'Make a board first: pick a shape in Ask Slatebox, or describe it.' : null
  return <>
    <Paper data-build-bar="" role="region" aria-label="Building a smart component" elevation={3}
      sx={{ position: 'fixed', zIndex: 1250, top: phone ? 60 : 76, left: '50%', transform: 'translateX(-50%)', borderRadius: 3,
        maxWidth: phone ? 'calc(100vw - 16px)' : 'min(760px, calc(100vw - 420px))', px: phone ? 1 : 1.75, py: .75,
        display: 'flex', flexDirection: 'column', gap: .5, bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: phone ? .5 : 1.25, minWidth: 0 }}>
        <Box component="span" aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main', flex: 'none',
          '@media (prefers-reduced-motion: no-preference)': { animation: 'sbBuildPulse 2.4s ease-in-out infinite' },
          '@keyframes sbBuildPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: .35 } } }} />
        <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{phone ? 'Building' : words.heading}</Typography>
        <Box sx={{ flex: '1 1 auto' }} />
        <Button size="small" onClick={() => open('save')} disabled={Boolean(blocked) || builder.waiting || Boolean(builder.busy)} sx={{ minHeight: phone ? 44 : 32, flex: 'none' }}>Save</Button>
        <Button size="small" variant="contained" onClick={() => open('submit')} disabled={Boolean(blocked) || builder.waiting || Boolean(builder.busy)}
          sx={{ minHeight: phone ? 44 : 32, whiteSpace: 'nowrap', flex: 'none' }}>{phone ? 'Submit' : 'Submit to the library'}</Button>
      </Box>
      {/* What it is and where it stands, on a line of its own so nothing is cut off beside the buttons (Ask Slatebox open). */}
      {(words.state || !phone) && <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: .75, rowGap: 0, alignItems: 'baseline', minWidth: 0 }}>
        {!phone && <Typography variant="body2" data-build-title="" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{words.title}</Typography>}
        {!phone && words.from && <Typography variant="body2" sx={{ color: 'text.secondary', minWidth: 0 }}>· {words.from}</Typography>}
        {words.state && <Typography variant="body2" role="status" data-build-status={builder.status}
          sx={{ color: builder.status === 'submitted' ? 'success.main' : 'text.secondary', fontWeight: 600 }}>{phone ? '' : '· '}{words.state}</Typography>}
      </Box>}
      {/* A branch's first words, until the person closes them: whose copy this is and how to change it. */}
      {greeting && first.kind === 'branch' && !sheet && <Box sx={{ display: 'flex', alignItems: 'center', gap: .5 }} data-build-greeting="">
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{first.title} {first.line}{words.category ? ` Category: ${words.category}.` : ''}</Typography>
        <IconButton size="small" aria-label="Close this note" onClick={() => setGreeting(false)}><CloseIcon fontSize="inherit" /></IconButton>
      </Box>}
      {blocked && !sheet && first.kind === 'scratch' && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{blocked}</Typography>}
    </Paper>
    {sheet && <Paper elevation={6} data-build-sheet={sheet}
      sx={phone
        ? { position: 'fixed', zIndex: 1300, left: 0, right: 0, bottom: 0, maxHeight: '80dvh', overflowY: 'auto', borderRadius: '16px 16px 0 0', p: 2 }
        : { position: 'fixed', zIndex: 1300, top: 160, left: '50%', transform: 'translateX(-50%)', width: 420, maxHeight: 'calc(100dvh - 188px)', overflowY: 'auto', borderRadius: 3, p: 2 }}>
      <SaveSheet submitting={sheet === 'submit'} defaults={builder.defaults} locked={builder.locked} parentTitle={builder.library?.parent?.title ?? null}
        busy={builder.busy} error={builder.error} guest={builder.guest} onSave={done} onCancel={() => setSheet(null)} />
    </Paper>}
    <Snackbar open={Boolean(toast)} message={toast} autoHideDuration={6000} onClose={() => setToast(null)}
      anchorOrigin={{ vertical: phone ? 'top' : 'bottom', horizontal: 'center' }} />
  </>
}

BuildBar.propTypes = {
  slate: PropTypes.shape({
    shareId: PropTypes.string,
    library: PropTypes.shape({ mode: PropTypes.string, itemId: PropTypes.string, boardId: PropTypes.string, parent: PropTypes.object }),
  }),
}
BuildBar.defaultProps = { slate: null }
