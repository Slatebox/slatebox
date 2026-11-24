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

// How the header makes room for the build bar, one step at a time and always in this order (`level` in BuildBar): the
// branched-from words move into the summary's details (still read out, and on hover); where it stands takes its short
// words ("Building", "Saved", "Submitted"; the rest read out); "Submit" stands for "Submit to the library" (its name
// unchanged); the item's name may end in an ellipsis, never narrower than FIT.min; the guest's "Save your work" becomes
// its icon (its name unchanged); the privacy chip steps aside (the slate menu and Share still say it); the slate's own
// name may end in an ellipsis, never narrower than FIT.min; then the header's own Huddle, Present and Ask Slatebox, in
// that order, as their icons (each keeps its name). Only below 1024px is there a step past that: the one Builder button.
// No step ever shrinks text to nothing: a line is either whole, or cut at a readable width.
export const FIT = { dropFrom: 1, shortStatus: 2, shortSubmit: 3, truncateName: 4, saveIcon: 5, privacy: 6, slateName: 7, huddleIcon: 8, presentIcon: 9, askIcon: 10, fold: 11, min: 96 }

// The floors that keep text readable whatever flex does: the slate name's box and the bar may shrink only down to their
// text's own width (whole), or, once `level` allows the ellipsis, to FIT.min of it (or all of a shorter one). Each floor
// is the box's own parts around its text plus the text's floor, measured with both boxes at their natural size (floors
// lifted, not shrinking: before paint, so never seen), so a floor neither ratchets itself up nor reads a squeezed box.
// Lifted entirely (`level` null) when the bar is not in the header row.
export function setFloors(toolbar, summary, level) {
  const name = toolbar.querySelector('.sb-board-name')
  // The bar's element is the same one folded or whole (React keeps it), so its floor is found and lifted in the header.
  const bar = toolbar.querySelector('[data-build-bar]')
  const boxes = [name, bar].filter(Boolean)
  boxes.forEach((el) => el.style.removeProperty('min-width'))
  if (level === null) return
  const strong = name?.querySelector('.sb-board-title strong')
  const lines = summary?.querySelector('[data-build-lines]')
  const stands = lines?.querySelector('[data-build-line="stands"]')
  const item = lines?.querySelector('[data-build-line="name"]')
  const w = (el) => el.getBoundingClientRect().width
  boxes.forEach((el) => el.style.setProperty('flex-shrink', '0'))
  const around = { name: strong ? w(name) - w(strong) : 0, bar: lines ? w(bar) - w(lines) : 0 }
  boxes.forEach((el) => el.style.removeProperty('flex-shrink'))
  if (strong) name.style.setProperty('min-width', `${Math.ceil(around.name + (level >= FIT.slateName ? Math.min(strong.scrollWidth, FIT.min) : strong.scrollWidth))}px`)
  if (lines && stands && item) {
    const keep = Math.max(stands.scrollWidth, level >= FIT.truncateName ? Math.min(item.scrollWidth, FIT.min) : item.scrollWidth)
    bar.style.setProperty('min-width', `${Math.ceil(around.bar + keep)}px`)
  }
}

// Whether the header holds everything at `level`: nothing overflows it, and each line of text is whole, or (once its
// step allows) cut no narrower than FIT.min.
export function fits(toolbar, summary, level) {
  const cut = (el) => Boolean(el && el.scrollWidth > el.clientWidth + 1)
  const readable = (el, allowed) => !cut(el) || (allowed && el.clientWidth >= FIT.min)
  // Overflow is read against the header's content box: its end padding would hide the first pixels of an overflow from
  // scrollWidth, and the last button would sit in it, or past the edge.
  const style = getComputedStyle(toolbar)
  const box = toolbar.getBoundingClientRect()
  const inRow = [...toolbar.children].flatMap((el) => (getComputedStyle(el).display === 'contents' ? [...el.children] : [el]))
    .filter((el) => !['absolute', 'fixed'].includes(getComputedStyle(el).position))
  const end = Math.max(...inRow.map((el) => el.getBoundingClientRect().right))
  if (toolbar.scrollWidth > toolbar.clientWidth || end > box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth) + 0.5) return false
  if (!readable(toolbar.querySelector('.sb-board-title strong'), level >= FIT.slateName)) return false
  if (!readable(summary?.querySelector('[data-build-line="stands"]'), false)) return false
  return readable(summary?.querySelector('[data-build-line="name"]'), level >= FIT.truncateName)
}

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
 * (Meetings)", then Save and Submit to the library beside the header's own buttons. Short of room, the header gives way
 * step by step in the order FIT names, measuring what is actually there (no width or name is assumed): never a line cut
 * to nothing, never anything pushed out of the header. The board is grown by Ask Slatebox (opened in build
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
  // How much of the header the bar has room for, measured in the header itself after every change (never tuned to a
  // width or a name). Each step gives up one thing more, in a fixed order, until nothing overflows the header and no text
  // is cut below a readable width (FIT.min px); see FIT. Stepped down while anything does not fit, and back up from 0
  // whenever the header's width or its other contents change.
  const [level, setLevel] = useState(0)
  const [, setRecheck] = useState(0)
  const toolbar = header?.parentElement ?? null
  const lastLevel = desktop ? FIT.askIcon : FIT.fold
  useLayoutEffect(() => {
    if (!toolbar) return
    // What the header itself gives up (CSS in main.css reads these): "Save your work" as its icon, the privacy chip, the
    // slate name's room beyond a readable width, and Huddle, Present and Ask Slatebox as their icons.
    const gives = narrow ? [] : [level >= FIT.saveIcon && 'save', level >= FIT.privacy && 'privacy', level >= FIT.slateName && 'name',
      level >= FIT.huddleIcon && 'huddle', level >= FIT.presentIcon && 'present', level >= FIT.askIcon && 'ask'].filter(Boolean)
    if (gives.length) toolbar.setAttribute('data-build-fit', gives.join(' ')); else toolbar.removeAttribute('data-build-fit')
    setFloors(toolbar, summary.current, narrow || level >= FIT.fold ? null : level)
    if (narrow || level >= lastLevel) return
    if (!fits(toolbar, summary.current, level)) setLevel(level + 1)
  })
  useEffect(() => () => { if (toolbar) { toolbar.removeAttribute('data-build-fit'); setFloors(toolbar, null, null) } }, [toolbar])
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
  const folds = narrow || level >= FIT.fold
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
  const said = level >= FIT.shortStatus ? statusShort(builder.status) : words.state
  const stands = words.state
    ? <Typography component="span" role="status" data-build-status={builder.status}
        sx={{ fontSize: 'inherit', lineHeight: 'inherit', fontWeight: 'inherit', color: builder.status === 'submitted' ? 'success.main' : 'inherit' }}>
        {said}{said !== words.state && <Box component="span" sx={visuallyHidden}>{words.state.slice(said.length)}</Box>}</Typography>
    : <>Building<Box component="span" sx={visuallyHidden}>{words.heading.replace(/^Building/, '')}</Box></>
  const save = <Button variant="outlined" color="inherit" onClick={() => open('save')} disabled={off}>Save</Button>
  const submit = (short) => <Button variant="contained" color="primary" disableElevation onClick={() => open('submit')} disabled={off}
    aria-label={short ? 'Submit to the library' : undefined}>{short ? 'Submit' : 'Submit to the library'}</Button>
  const lineSx = { display: 'block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

  // Two lines inside the header, pushed to the header's buttons (ml auto; the slate's name does not grow on a builder slate,
  // so its box measures its own parts), its floor set by setFloors (minWidth 0 here: a flex item's own floor would be the
  // whole of its text): where it stands, then the item's name (and, with room, where it came from). The summary
  // opens its details under it: the heading, the name, where it came from and the branch's first words.
  const wide = <Box ref={bar} data-build-bar="" role="region" aria-label="Building a smart component"
    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.25, flex: '0 50 auto', minWidth: 0, ml: 'auto' }}>
    {/* On hover, what the summary no longer shows (where it came from, the whole name once it is cut); a click opens all of it. */}
    <Tooltip title={!about ? [level >= FIT.truncateName && words.title, level >= FIT.dropFrom && aside].filter(Boolean).join(' · ') : ''} placement="bottom" describeChild>
      <ButtonBase ref={summary} data-build-summary="" aria-haspopup="dialog" aria-expanded={about} onClick={() => setAbout(true)}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flex: '0 1 auto', minWidth: 0, justifyContent: 'center', textAlign: 'center', px: 2, py: .75, minHeight: 40, borderRadius: '22px',
          bgcolor: 'var(--sb-offset)', border: '1px solid var(--sb-border)', color: 'inherit', '&:hover': { borderColor: 'var(--sb-ink2)' } }}>
        <Dot />
        <Box data-build-lines="" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', minWidth: 0, lineHeight: 1.3 }}>
          <Box component="span" data-build-line="stands" sx={{ ...lineSx, fontWeight: 700, fontSize: 13.5, lineHeight: 1.3 }}>{stands}</Box>
          <Box component="span" data-build-line="name" sx={{ ...lineSx, fontSize: 12.5, lineHeight: 1.3, color: 'var(--sb-ink2)' }}>
            <span data-build-title="">{words.title}</span>
            {aside && (level < FIT.dropFrom ? <span> · {aside}</span> : <Box component="span" sx={visuallyHidden}> · {aside}</Box>)}</Box>
        </Box>
      </ButtonBase>
    </Tooltip>
    {save}
    {submit(level >= FIT.shortSubmit)}
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
  const folded = <Box ref={bar} data-build-bar="" role="region" aria-label="Building a smart component" sx={{ display: 'flex', flex: 'none', ml: 'auto' }}>
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
