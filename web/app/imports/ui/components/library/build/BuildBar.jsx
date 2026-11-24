import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import PropTypes from 'prop-types'
import { useAtomValue } from 'jotai'
import { Box, Button, ButtonBase, Drawer, IconButton, Paper, Popover, Snackbar, Tooltip, Typography, useMediaQuery } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import HandymanOutlined from '@mui/icons-material/HandymanOutlined'
import useBuilder from './useBuilder'
import SaveSheet from './SaveSheet'
import { SAVED_SENTENCE, SUBMITTED_SENTENCE, buildBarWords, buildFirstTurn, statusShort } from './buildTurns.mjs'
import { builderHeaderSlot, conversationIntroSlot } from '../../../jotai/atoms'

// A branch's first words, once: closed, they stay closed on this slate (on this browser).
const greetingKey = (shareId) => `slatebox:build-greeting-closed:${shareId}`
const greetingClosed = (shareId) => { try { return localStorage.getItem(greetingKey(shareId)) === '1' } catch { return false } }
const closeGreeting = (shareId) => { try { localStorage.setItem(greetingKey(shareId), '1') } catch { /* Shown again next visit. */ } }

// Read out, not shown: one pixel (in px: a bare 1 in sx is 100%), at the corner of what holds it, so it never widens the bar.
const visuallyHidden = { position: 'absolute', left: 0, top: 0, width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }

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
 * the canvas: two lines, "Building" (or where it stands: "Submitted for review") over "<title> · Branched from Retro
 * (Meetings)", then Save and Submit to the library beside the header's own buttons. The slate's name is never cut for it:
 * short of room, "Submit" stands for "Submit to the library", the branched-from words move into the summary's details
 * (a click on the summary), then the status takes its short words. The board is grown by Ask Slatebox (opened in build
 * mode) and by the rule controls on the board itself; this bar only names it and sends it. A branch's first words are
 * drawn at the top of Ask Slatebox, closable. Below 1000px wide (or below 1024px when even that has no room) the bar is
 * one Builder button that opens a sheet with all of it; from 1024px it is always whole. The Save sheet opens under the
 * header (a bottom sheet on a phone), never a modal.
 */
export default function BuildBar({ slate }) {
  const builder = useBuilder(slate)
  const header = useAtomValue(builderHeaderSlot)
  const intro = useAtomValue(conversationIntroSlot)
  const narrow = useMediaQuery('(max-width:999.98px)')
  // From 1024px wide (a desktop or a laptop) the bar's controls are always whole in the header, never one Builder button.
  const desktop = useMediaQuery('(min-width:1024px)')
  const phone = useMediaQuery('(max-width:599.98px)')
  const bar = useRef(null)
  const summary = useRef(null)
  const [sheet, setSheet] = useState(null)
  const [sheetRight, setSheetRight] = useState(16)
  const [details, setDetails] = useState(false)
  const [about, setAbout] = useState(false)
  const [toast, setToast] = useState(null)
  const [greeting, setGreeting] = useState(true)
  const opened = useRef(false)
  // How much of the bar the header has room for, without pushing anything out of it, cutting the slate's name short, or
  // cutting a word of the bar's own: 0 all of it; 1 "Submit" for "Submit to the library" (its name unchanged); 2 the
  // branched-from line moves into the summary's details (still read out); 3 where it stands in its short words ("Saved",
  // "Submitted"; the rest read out); 4 the summary is its dot alone (a click still opens all of it), so Save and Submit
  // stay whole on any desktop; 5 the one Builder button, only below 1024px. Stepped down while anything is cut, and back
  // up from 0 whenever the header grows or its other buttons change.
  const [level, setLevel] = useState(0)
  const [, setRecheck] = useState(0)
  const toolbar = header?.parentElement ?? null
  const lastLevel = desktop ? 4 : 5
  useLayoutEffect(() => {
    if (!toolbar || narrow || level >= lastLevel) return
    const cut = (el) => Boolean(el && el.scrollWidth > el.clientWidth + 1)
    // The slate's own name is read in full first: the bar gives way before it is cut.
    const nameCut = cut(toolbar.querySelector('.sb-board-title strong'))
    const lineCut = level < 4 && [...(summary.current?.querySelectorAll('[data-build-line]') ?? [])].some(cut)
    if (toolbar.scrollWidth > toolbar.clientWidth + 1 || nameCut || lineCut) setLevel(level + 1)
  })
  useEffect(() => {
    if (!toolbar) return undefined
    let width = toolbar.clientWidth
    const again = () => { setLevel(0); setRecheck((n) => n + 1) }
    const sized = new ResizeObserver(() => { const now = toolbar.clientWidth; if (now !== width) { width = now; again() } })
    // Anything else in the header changing (a button coming or going, the slate's name, a label) asks again, and so do
    // the header's fonts arriving; never the bar's own changes, nor sizes, which the bar itself moves.
    const changed = new MutationObserver((records) => { if (records.some((r) => !header?.contains(r.target))) again() })
    sized.observe(toolbar)
    changed.observe(toolbar, { childList: true, subtree: true, characterData: true })
    let live = true
    document.fonts?.ready?.then(() => { if (live) again() })
    return () => { live = false; sized.disconnect(); changed.disconnect() }
  }, [toolbar, header])
  const folds = narrow || level >= 5
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
    sx={{ fontSize: 'inherit', lineHeight: 'inherit', color: builder.status === 'submitted' ? 'success.main' : 'inherit', fontWeight: 'inherit' }}>{words.state}</Typography>
  // Where it stands, in the header's first line: "Building" until it is saved or sent, then its status (in short words once
  // the header is short of room; the whole of it is still read out).
  const said = level >= 3 ? statusShort(builder.status) : words.state
  const stands = words.state
    ? <Typography component="span" role="status" data-build-status={builder.status}
        sx={{ fontSize: 'inherit', lineHeight: 'inherit', fontWeight: 'inherit', color: builder.status === 'submitted' ? 'success.main' : 'inherit' }}>
        {said}{said !== words.state && <Box component="span" sx={visuallyHidden}>{words.state.slice(said.length)}</Box>}</Typography>
    : <>Building<Box component="span" sx={visuallyHidden}>{words.heading.replace(/^Building/, '')}</Box></>
  const save = <Button variant="outlined" color="inherit" onClick={() => open('save')} disabled={off}>Save</Button>
  const submit = (short) => <Button variant="contained" color="primary" disableElevation onClick={() => open('submit')} disabled={off}
    aria-label={short ? 'Submit to the library' : undefined}>{short ? 'Submit' : 'Submit to the library'}</Button>
  const dotOnly = level >= 4
  const lineSx = { display: 'block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

  // Two lines inside the header: where it stands, then the item's name (and, with room, where it came from). The summary
  // opens its details under it: the heading, the name, where it came from and the branch's first words.
  const wide = <Box ref={bar} data-build-bar="" role="region" aria-label="Building a smart component"
    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.25, flex: '0 50 auto' }}>
    {/* On hover, what the summary no longer shows (where it came from); a click opens all of it. */}
    <Tooltip title={!about && level >= 2 ? [dotOnly && (words.state || words.heading), dotOnly && words.title, aside].filter(Boolean).join(' · ') : ''} placement="bottom" describeChild>
      <ButtonBase ref={summary} data-build-summary="" aria-haspopup="dialog" aria-expanded={about} onClick={() => setAbout(true)}
        aria-label={dotOnly ? [words.heading, words.state, words.title, aside].filter(Boolean).join('. ') : undefined}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flex: '0 1 auto', minWidth: dotOnly ? 40 : 0, justifyContent: 'center', textAlign: 'center', px: dotOnly ? 1.5 : 2, py: .75, minHeight: 40, borderRadius: '22px',
          bgcolor: 'var(--sb-offset)', border: '1px solid var(--sb-border)', color: 'inherit', '&:hover': { borderColor: 'var(--sb-ink2)' } }}>
        <Dot />
        <Box sx={dotOnly ? visuallyHidden : { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', minWidth: 0, lineHeight: 1.3 }}>
          <Box component="span" data-build-line="stands" sx={{ ...lineSx, fontWeight: 700, fontSize: 13.5, lineHeight: 1.3 }}>{stands}</Box>
          <Box component="span" data-build-line="name" sx={{ ...lineSx, fontSize: 12.5, lineHeight: 1.3, color: 'var(--sb-ink2)' }}>
            <span data-build-title="">{words.title}</span>
            {aside && (level < 2 ? <span> · {aside}</span> : <Box component="span" sx={visuallyHidden}> · {aside}</Box>)}</Box>
        </Box>
      </ButtonBase>
    </Tooltip>
    {save}
    {submit(level >= 1)}
  </Box>

  const aboutSheet = !folds && <Popover open={about} anchorEl={summary.current} onClose={() => setAbout(false)}
    anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
    slotProps={{ paper: { 'aria-label': 'Building a smart component', 'data-build-about': '', sx: { mt: 1.5, p: 2.5, width: 360, maxWidth: 'calc(100vw - 24px)', borderRadius: 3 } } }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.5 }}>
      <Dot />
      <Typography component="h2" sx={{ fontWeight: 800, fontSize: 16, flex: '1 1 auto' }}>{words.heading}</Typography>
      <IconButton size="small" aria-label="Close" onClick={() => setAbout(false)} sx={{ mr: -1 }}><CloseIcon fontSize="small" /></IconButton>
    </Box>
    <Box sx={{ display: 'grid', gap: .75 }}>
      <Typography variant="body1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{words.title}</Typography>
      {aside && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{aside}</Typography>}
      {words.state && <Typography variant="body2" sx={{ color: builder.status === 'submitted' ? 'success.main' : 'text.secondary', fontWeight: 600 }}>{words.state}</Typography>}
      {firstWords && <Typography variant="body2" sx={{ color: 'text.secondary', mt: .75 }}>{firstWords}</Typography>}
    </Box>
  </Popover>

  // Below 1000px: one button in the header; its sheet holds what the wide bar shows, and Save and Submit. On a phone it is
  // a round button (named Builder), so the slate's own name keeps room to be read.
  const folded = <Box ref={bar} data-build-bar="" role="region" aria-label="Building a smart component" sx={{ display: 'flex', flex: 'none' }}>
    {phone
      ? <Button variant="outlined" color="inherit" aria-haspopup="dialog" aria-expanded={details} onClick={() => setDetails(true)}
          sx={{ position: 'relative', minWidth: 0, width: 40, height: 40, p: '0 !important', borderRadius: '50% !important' }}>
          <HandymanOutlined fontSize="small" aria-hidden="true" />
          <Box component="span" aria-hidden="true" sx={{ position: 'absolute', top: 5, right: 5, display: 'flex' }}><Dot /></Box>
          <Box component="span" sx={visuallyHidden}>Builder</Box>
        </Button>
      : <Button variant="outlined" color="inherit" startIcon={<Dot />} aria-haspopup="dialog" aria-expanded={details} onClick={() => setDetails(true)}
          sx={{ '& .MuiButton-startIcon': { mr: .75, ml: 0 } }}>Builder</Button>}
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
    {aboutSheet}
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
