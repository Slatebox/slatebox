import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import PropTypes from 'prop-types'
import { useAtomValue } from 'jotai'
import { Box, Button, Drawer, IconButton, Paper, Snackbar, Tooltip, Typography, useMediaQuery } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import useBuilder from './useBuilder'
import SaveSheet from './SaveSheet'
import { SAVED_SENTENCE, SUBMITTED_SENTENCE, buildBarWords, buildFirstTurn } from './buildTurns.mjs'
import { builderHeaderSlot, conversationIntroSlot } from '../../../jotai/atoms'

// A branch's first words, once: closed, they stay closed on this slate (on this browser).
const greetingKey = (shareId) => `slatebox:build-greeting-closed:${shareId}`
const greetingClosed = (shareId) => { try { return localStorage.getItem(greetingKey(shareId)) === '1' } catch { return false } }
const closeGreeting = (shareId) => { try { localStorage.setItem(greetingKey(shareId), '1') } catch { /* Shown again next visit. */ } }

// Read out, not shown.
const visuallyHidden = { position: 'absolute', width: 1, height: 1, p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }

function Dot() {
  return <Box component="span" aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main', flex: 'none',
    '@media (prefers-reduced-motion: no-preference)': { animation: 'sbBuildPulse 2.4s ease-in-out infinite' },
    '@keyframes sbBuildPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: .35 } } }} />
}

// The Save sheet: from the foot of a phone; elsewhere under the header, centred below 1000px, or its right edge under the
// bar's buttons (`right`) on a wide screen.
function sheetPlace(phone, narrow, right) {
  if (phone) return { position: 'fixed', zIndex: 1300, left: 0, right: 0, bottom: 0, maxHeight: '80dvh', overflowY: 'auto', borderRadius: '16px 16px 0 0', p: 2.5 }
  const under = { position: 'fixed', zIndex: 1300, top: 76, width: 420, maxHeight: 'calc(100dvh - 100px)', overflowY: 'auto', borderRadius: 3, p: 2.5 }
  return narrow ? { ...under, left: '50%', transform: 'translateX(-50%)' } : { ...under, right }
}

/**
 * The build bar on a builder slate (library spec §4.2), in the canvas header after the slate's name, never over
 * the canvas: "Building a smart component" over "<title> · Branched from Retro (Meetings)", then Save and Submit
 * to the library beside the header's own buttons. The board is grown by Ask Slatebox (opened in build mode) and by
 * the rule controls on the board itself; this bar only names it and sends it. A branch's first words are drawn at
 * the top of Ask Slatebox, closable. Below 1000px wide, or when the header has no room for it, the bar is one Builder
 * button that opens a sheet with all of it. The Save sheet opens under the header (a bottom sheet on a phone), never a modal.
 */
export default function BuildBar({ slate }) {
  const builder = useBuilder(slate)
  const header = useAtomValue(builderHeaderSlot)
  const intro = useAtomValue(conversationIntroSlot)
  const narrow = useMediaQuery('(max-width:999.98px)')
  const phone = useMediaQuery('(max-width:599.98px)')
  const bar = useRef(null)
  const [sheet, setSheet] = useState(null)
  const [sheetRight, setSheetRight] = useState(16)
  const [details, setDetails] = useState(false)
  const [toast, setToast] = useState(null)
  const [greeting, setGreeting] = useState(true)
  const opened = useRef(false)
  // How much of the bar the header has room for, without pushing anything out of it or cutting the slate's name short: 0 all of it; 1 "Building" for
  // the heading; 2 "Submit" for "Submit to the library" (its name unchanged); 3 the one Builder button. Stepped down
  // while the header overflows, and back up from 0 whenever the header grows or its other buttons change.
  const [level, setLevel] = useState(0)
  const [, setRecheck] = useState(0)
  const toolbar = header?.parentElement ?? null
  useLayoutEffect(() => {
    if (!toolbar || narrow || level >= 3) return
    // The slate's own name keeps room to be read too (up to 100px of it before the bar gives way).
    const name = toolbar.querySelector('.sb-board-title strong')
    const nameCut = name && name.scrollWidth > name.clientWidth + 1 && name.clientWidth < 100
    if (toolbar.scrollWidth > toolbar.clientWidth + 1 || nameCut) setLevel(level + 1)
  })
  useEffect(() => {
    if (!toolbar) return undefined
    let width = toolbar.clientWidth
    const again = () => { setLevel(0); setRecheck((n) => n + 1) }
    const sized = new ResizeObserver(() => { const now = toolbar.clientWidth; if (now !== width) { width = now; again() } })
    // A button coming or going in the header, or the slate's name changing, asks again (never the bar's own changes,
    // nor sizes, which the bar itself moves).
    const changed = new MutationObserver(again)
    sized.observe(toolbar)
    changed.observe(toolbar, { childList: true })
    const name = toolbar.querySelector('.sb-board-name')
    if (name) changed.observe(name, { childList: true, subtree: true, characterData: true })
    return () => { sized.disconnect(); changed.disconnect() }
  }, [toolbar, header])
  const folds = narrow || level >= 3
  // Ask Slatebox opens in build mode once, as the builder slate opens.
  useEffect(() => {
    if (opened.current || !builder.shareId) return
    opened.current = true
    if (greetingClosed(builder.shareId)) setGreeting(false)
    window.dispatchEvent(new Event('slatebox:open-canvas-conversation'))
  }, [builder.shareId])
  const words = buildBarWords({ library: builder.library, title: builder.item?.title ?? builder.board?.title, status: builder.status })
  const first = buildFirstTurn(builder.library)
  const hasBoard = Boolean(builder.board)
  const open = (which) => {
    builder.clearError()
    setDetails(false)
    // On a wide screen the sheet hangs under the header, its right edge under the bar's buttons.
    const box = bar.current?.getBoundingClientRect()
    if (box) setSheetRight(Math.max(8, Math.min(window.innerWidth - box.right, window.innerWidth - 428)))
    setSheet(which)
  }
  const done = async (input, note, credit) => {
    const sent = sheet === 'submit' ? await builder.submit(input, note, credit) : await builder.save(input)
    if (!sent) return
    setToast(sheet === 'submit' ? SUBMITTED_SENTENCE : SAVED_SENTENCE)
    setSheet(null)
  }
  const blocked = !hasBoard ? 'Make a board first: pick a shape in Ask Slatebox, or describe it.' : null
  const off = Boolean(blocked) || builder.waiting || Boolean(builder.busy)
  const firstWords = first.kind === 'branch' ? `${first.title} ${first.line}${words.category ? ` Category: ${words.category}.` : ''}` : null
  const aside = words.from || (blocked && first.kind === 'scratch' ? blocked : null)
  const status = words.state && <Typography component="span" variant="body2" role="status" data-build-status={builder.status}
    sx={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 'inherit', color: builder.status === 'submitted' ? 'success.main' : 'inherit', fontWeight: 600 }}>{words.state}</Typography>
  // About as wide as its words, at most: the line under the heading, or the heading (in the line's own size).
  const line = [words.title, aside, words.state].filter(Boolean).join(' · ')
  // The least the heading's column takes: all of the heading; or "Building" and, once saved or sent, where it stands.
  let leastWidth = 190
  if (level) leastWidth = words.state ? 150 : 96
  const room = Math.ceil(Math.max(line.length * .82, (level ? 8 : words.heading.length) * .95))
  const save = <Button variant="outlined" color="inherit" onClick={() => open('save')} disabled={off}>Save</Button>
  const submit = (short) => <Button variant="contained" color="primary" disableElevation onClick={() => open('submit')} disabled={off}
    aria-label={short ? 'Submit to the library' : undefined}>{short ? 'Submit' : 'Submit to the library'}</Button>

  const wide = <Box ref={bar} data-build-bar="" role="region" aria-label="Building a smart component"
    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.25, flex: '1 1 auto' }}>
    <Tooltip describeChild title={[words.title, aside, firstWords].filter(Boolean).join(' · ')} placement="bottom">
      <Box data-build-summary="" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flex: '1 1 auto', justifyContent: 'center', fontSize: 12.5, maxWidth: `min(460px, calc(${room}ch + 56px))`, px: 1.75, py: .75, borderRadius: '22px',
        bgcolor: 'var(--sb-offset)', border: '1px solid var(--sb-border)' }}>
        <Dot />
        {/* The heading sets the least width; the line under it (name, where it came from, where it stands) takes what room
            the header has to spare (shared with the slate's name), and gives way first. */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', flex: '1 1 auto', minWidth: leastWidth, lineHeight: 1.25 }}>
          <Typography component="span" sx={{ position: 'relative', fontWeight: 700, fontSize: 13.5, lineHeight: 1.25, whiteSpace: 'nowrap' }}>
            {/* Short of room it shows "Building"; the rest of the heading is still read out. */}
            {level ? <>Building<Box component="span" sx={visuallyHidden}>{words.heading.replace(/^Building/, '')}</Box></> : words.heading}</Typography>
          {/* Where it stands first, once it has been saved or sent; the name (and where it came from) gives way before it. */}
          <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%', contain: 'inline-size', overflow: 'hidden', fontSize: 12.5, lineHeight: 1.25, color: 'var(--sb-ink2)', whiteSpace: 'nowrap' }}>
            {status}
            <Box component="span" sx={{ flex: status ? '0 100 auto' : '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {status && '\u00a0· '}<span data-build-title="">{words.title}</span>{aside && <span> · {aside}</span>}</Box>
          </Box>
        </Box>
      </Box>
    </Tooltip>
    {save}
    {submit(level >= 2)}
  </Box>

  // Below 1000px: one button in the header; its sheet holds what the wide bar shows, and Save and Submit.
  const folded = <Box ref={bar} data-build-bar="" role="region" aria-label="Building a smart component" sx={{ display: 'flex', flex: 'none' }}>
    <Button variant="outlined" color="inherit" startIcon={<Dot />} aria-haspopup="dialog" aria-expanded={details} onClick={() => setDetails(true)}
      sx={{ '& .MuiButton-startIcon': { mr: .75, ml: 0 }, ...(phone && { paddingInline: '12px !important' }) }}>Builder</Button>
  </Box>

  const detailsSheet = folds && <Drawer anchor="bottom" open={details} onClose={() => setDetails(false)} sx={{ zIndex: 1300 }}
    PaperProps={{ 'aria-label': 'Builder', 'data-build-details': '', sx: { borderRadius: '16px 16px 0 0', px: 3, pt: 2.5, pb: 'max(20px, env(safe-area-inset-bottom))', maxHeight: '80dvh' } }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
      <Dot />
      <Typography component="h2" sx={{ fontWeight: 800, fontSize: 18, flex: '1 1 auto' }}>{words.heading}</Typography>
      <IconButton aria-label="Close" onClick={() => setDetails(false)} sx={{ mr: -1 }}><CloseIcon /></IconButton>
    </Box>
    <Box sx={{ textAlign: 'center', my: 2, display: 'flex', flexDirection: 'column', gap: .5 }}>
      <Typography variant="body1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{words.title}</Typography>
      {aside && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{aside}</Typography>}
      {status && <Typography variant="body2" component="div" sx={{ color: 'text.secondary' }}>{status}</Typography>}
      {firstWords && <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>{firstWords}</Typography>}
    </Box>
    <Box sx={{ display: 'flex', gap: 1.5, '& .MuiButton-root': { flex: '1 1 0', minHeight: 44, textTransform: 'none', fontWeight: 700, borderRadius: '22px' } }}>
      {save}
      {submit(false)}
    </Box>
  </Drawer>

  // A branch's first words, at the top of Ask Slatebox: whose copy this is and how to change it, until closed.
  const firstTurn = greeting && firstWords && <Box data-build-greeting="" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mt: 1, mb: .5, pl: 2, pr: 1, py: 1.25,
    borderRadius: 2, bgcolor: 'action.hover' }}>
    <Typography variant="body2" sx={{ color: 'text.secondary', flex: '1 1 auto', pt: .5 }}>{firstWords}</Typography>
    <IconButton size="small" aria-label="Close this note" onClick={() => { setGreeting(false); closeGreeting(builder.shareId) }}><CloseIcon fontSize="inherit" /></IconButton>
  </Box>

  return <>
    {header && createPortal(folds ? folded : wide, header)}
    {intro && firstTurn && createPortal(firstTurn, intro)}
    {detailsSheet}
    {sheet && <Paper elevation={6} data-build-sheet={sheet}
      sx={sheetPlace(phone, narrow, sheetRight)}>
      <SaveSheet submitting={sheet === 'submit'} defaults={builder.defaults} locked={builder.locked} parentTitle={builder.library?.parent?.title ?? null}
        busy={builder.busy} error={builder.error} guest={builder.guest} askName={builder.askName} onSave={done} onCancel={() => setSheet(null)} />
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
