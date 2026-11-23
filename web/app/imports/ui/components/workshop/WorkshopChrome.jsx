import React, { useEffect, useRef, useState } from 'react'
import { Box, Button, Paper, Typography } from '@mui/material'
import { resolveWorkshopSignals } from 'slateboxjs/workshops/model'
import { noticeKeeper, standingLines } from '../../../api/common/workshop-notice.mjs'

// Kept in the page for screen readers, drawn nowhere.
const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }
// A line that may hold a long card name or reason: its words break anywhere and it holds two lines.
const twoLines = { overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minWidth: 0 }
const shownFor = 6000
// A refusal or failure holds three lines; a tap or the keyboard (it can take focus) shows all of it,
// so the part that says what to do is never out of reach on a phone, where there is no hover.
const reasonLines = { ...twoLines, WebkitLineClamp: 3, cursor: 'pointer', borderRadius: 1,
  '&:focus': { display: 'block', overflow: 'visible', WebkitLineClamp: 'none' }, '&:focus-visible': { outline: '2px solid currentColor' } }

/**
 * What a person may do with the workshop on this slate, and the one change they can take back.
 * A small strip in the lower corner of the canvas, clear of the toolbar's own floating controls;
 * `docked` gives it a row of its own under the canvas instead (a phone, where it would cover a card).
 */
export function WorkshopStatus({ board, docked = false, conversationOpen = false, onReview }) {
  const { editable, canJoin, joining, canUndo, saving, offline, error, failure, previewing, notice } = board
  // An embed is always read-only and says nothing about it.
  const viewOnly = board.ready && !editable && !canJoin && !board.embedded
  if (!failure && !canJoin && !viewOnly && !canUndo && !saving && !error && !previewing && !notice) return null
  // Docked, it is drawn over the collaborator names pinned near the bottom of the page, so a
  // name never covers "Join to edit" or another of its buttons.
  const place = docked
    ? { flexShrink: 0, minWidth: 0, borderRadius: 0, borderTop: 1, borderColor: 'divider', position: 'relative', zIndex: 2 }
    : { position: 'absolute', bottom: 12, left: 12, zIndex: 5, maxWidth: 'min(420px, calc(100% - 24px))', borderRadius: 2 }
  return <Paper elevation={docked ? 0 : 2} role="group" aria-label="Workshop" sx={{ ...place,
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, px: 1.5, py: .75 }}>
    {canJoin && <>
      <Button variant="contained" size="small" disabled={joining} onClick={board.join}>{joining ? 'Joining…' : 'Join to edit'}</Button>
      <Typography variant="body2">Join as a guest to save changes to this shared slate.</Typography>
    </>}
    {viewOnly && <Typography variant="body2">View only</Typography>}
    {/* A proposal holds the board still until it is answered. With the conversation closed, say so and offer the way back. */}
    {previewing && <Typography variant="body2" role="status">{conversationOpen
      ? 'Preview: a proposed change, not saved yet.'
      : 'Preview: a proposed change is on the canvas. Cards stay where they are until you keep or discard it.'}</Typography>}
    {previewing && !conversationOpen && onReview && <Button variant="contained" size="small" onClick={onReview}>Review proposal</Button>}
    {canUndo && <Button size="small" disabled={saving} onClick={board.undo}>Undo last change</Button>}
    {saving && <Typography variant="body2" role="status">{offline ? 'Offline. Your changes will be saved when the connection is back.' : 'Saving…'}</Typography>}
    {failure && <Typography variant="body2" role="alert" tabIndex={0} title={failure} sx={reasonLines}>{failure}</Typography>}
    {failure && board.retryBoard && <Button size="small" onClick={board.retryBoard}>Try again</Button>}
    {error && <Typography variant="body2" color="error" role="alert" tabIndex={0} title={error} sx={reasonLines}>{error}</Typography>}
    {notice && !error && <Typography variant="body2" role="status" sx={{ color: 'warning.dark' }}>{notice.text}</Typography>}
  </Paper>
}


/**
 * What the workshop says as it stands: where each token of a map is and what happens there,
 * and each placement outcome. Read aloud when a move changes it, so a move made from the
 * keyboard has an announced result. The board shows where every card is and each stop's outcome,
 * so no line under it repeats them. Placement outcomes are drawn nowhere on the board: a small
 * "Outcomes" button at its top corner lists them at any time. What a change adds (a stop's
 * outcome, a placement's outcome) shows for a moment beside it.
 */
export function WorkshopOutcomes({ workshop }) {
  const map = Boolean(workshop.lanes[0].station)
  const signals = workshop.signals?.length ? resolveWorkshopSignals(workshop) : []
  const lines = standingLines(workshop, signals)
  const said = lines.map(line => line.said).join('\n')
  const before = useRef(null)
  const [notice, setNotice] = useState(null)
  const [listed, setListed] = useState(false)
  const keeper = useRef(null)
  if (!keeper.current) keeper.current = noticeKeeper(setNotice, shownFor)
  useEffect(() => () => keeper.current.stop(), [])
  useEffect(() => {
    const was = before.current
    before.current = lines
    if (was) keeper.current.change(was, lines)
  }, [said])
  if (!map && !signals.length) return null
  const corner = { position: 'absolute', left: 12, zIndex: 5, maxWidth: 'min(420px, calc(100% - 24px))', boxSizing: 'border-box', borderRadius: 2 }
  return <>
    <Box sx={visuallyHidden}>
      {map && <section aria-label="Where things stand" aria-live="polite">
        {lines.filter(line => line.key.startsWith('card:')).map(line => <p key={line.key}>{line.said}</p>)}
      </section>}
      {signals.length > 0 && <section aria-label="Placement outcomes" aria-live="polite">
        {lines.filter(line => line.key.startsWith('signal:')).map(line => <p key={line.key}>{line.said}</p>)}
      </section>}
    </Box>
    {signals.length > 0 && <Paper elevation={2} className="sb-workshop-outcomes" sx={{ ...corner, top: 12, overflow: 'hidden' }}>
      <Button size="small" aria-expanded={listed} aria-controls="sb-workshop-outcome-list" onClick={() => setListed(open => !open)}
        sx={{ px: 1.5, textTransform: 'none' }}>{`Outcomes (${signals.length})`}</Button>
      {listed && <Box component="ul" id="sb-workshop-outcome-list" aria-label="Outcomes on this board"
        sx={{ m: 0, px: 1.5, pb: 1, pt: 0, listStyle: 'none', maxHeight: '40vh', overflowY: 'auto' }}>
        {signals.map(signal => <Typography component="li" key={signal.id} variant="body2" sx={{ overflowWrap: 'anywhere', py: .25 }}>
          <strong>{signal.label}</strong> — {signal.text}</Typography>)}
      </Box>}
    </Paper>}
    {/* Already read aloud above: drawn for the eye only, at the board's top corner (under the Outcomes button). */}
    {notice && !listed && <Paper elevation={2} aria-hidden="true" className="sb-workshop-notice" title={`${notice.place}: ${notice.text}`}
      sx={{ ...corner, top: signals.length ? 56 : 12, px: 1.5, py: .75, pointerEvents: 'none' }}>
      <Typography variant="body2" sx={twoLines}><strong>{notice.place}</strong> — {notice.text}</Typography>
    </Paper>}
  </>
}
