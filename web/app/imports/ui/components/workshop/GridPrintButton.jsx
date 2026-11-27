import React, { useEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { Button, ButtonGroup, Menu, MenuItem, Paper, Typography } from '@mui/material'
import { downloadGridPdf, printGrid } from './gridPrint'
import { currentSlate, isPresentOpen } from '../../jotai/atoms'
import noteDownload from '../../../api/client/noteDownload'

/**
 * "Print / Export PDF" for a grid sheet on the slate (snap-grid spec §5): this page (the one selected, or page 1) or
 * all pages, printed (the browser's dialog, which also saves a PDF) or downloaded as a PDF. The chat's "print page 2"
 * and "export a PDF" run the same (a slatebox:grid-print event, WorkshopConversation.jsx). On a wide screen it floats at the
 * canvas's top right; on a phone (`docked`) it has a row of its own under the canvas, so it covers no card, chip or title.
 * Never while the slate is presented: the presenter is not the place to print from.
 */
export default function GridPrintButton({ board, engine, docked = false }) {
  const presenting = useAtomValue(isPresentOpen)
  const shareId = useAtomValue(currentSlate)?.shareId
  const workshop = board?.model
  const [anchor, setAnchor] = useState(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const latest = useRef({ board, engine })
  latest.current = { board, engine }
  const latestShareId = useRef(shareId)
  latestShareId.current = shareId
  const run = async ({ pdf, pages }) => {
    const { board: now, engine: slate } = latest.current
    if (!now?.model || !slate) return
    setAnchor(null)
    setBusy(true)
    setSaid('')
    try {
      const made = await (pdf ? downloadGridPdf : printGrid)({ engine: slate, workshop: now.visible ?? now.model, pageIds: pages })
      if (made) setSaid(pdf ? 'Saved the PDF.' : 'Opened the print dialog.')
      if (made && pdf) noteDownload(latestShareId.current, 'pdf')
    } catch (error) { setSaid(error?.message || 'The page could not be printed.') }
    finally { setBusy(false) }
  }
  useEffect(() => {
    const onPrint = event => {
      if (event.detail?.boardId && event.detail.boardId !== latest.current.board?.boardId) return
      run({ pdf: Boolean(event.detail?.pdf), pages: event.detail?.pages })
    }
    window.addEventListener('slatebox:grid-print', onPrint)
    return () => window.removeEventListener('slatebox:grid-print', onPrint)
  }, [])
  if (workshop?.kind !== 'grid' || !board.ready || presenting) return null
  const selectedPage = () => {
    const sel = board.selection
    const pageOf = sel?.cardId ? workshop.cards.find(card => card.id === sel.cardId)?.laneId : sel?.laneId
    return pageOf && pageOf !== workshop.lanes[0].id ? pageOf : workshop.lanes[1].id
  }
  const many = workshop.lanes.length > 2
  const place = docked
    ? { flexShrink: 0, borderRadius: 0, borderTop: 1, borderColor: 'divider', position: 'relative', zIndex: 2, justifyContent: 'flex-end', flexWrap: 'wrap' }
    : { position: 'absolute', top: 72, right: 12, zIndex: 5, borderRadius: 2 }
  return <Paper elevation={docked ? 0 : 2} role="group" aria-label="Print or export the page" data-grid-print-control="" data-docked={docked ? '' : undefined}
    sx={{ ...place, display: 'flex', alignItems: 'center', gap: 1, px: 1, py: .5 }}>
    <ButtonGroup size="small" variant="contained" disabled={busy}>
      <Button data-grid-print="" onClick={event => many ? setAnchor({ el: event.currentTarget, pdf: false }) : run({ pdf: false, pages: [workshop.lanes[1].id] })}>Print</Button>
      <Button data-grid-pdf="" onClick={event => many ? setAnchor({ el: event.currentTarget, pdf: true }) : run({ pdf: true, pages: [workshop.lanes[1].id] })}>Export PDF</Button>
    </ButtonGroup>
    <Menu open={Boolean(anchor)} anchorEl={anchor?.el} onClose={() => setAnchor(null)}>
      <MenuItem onClick={() => run({ pdf: anchor.pdf, pages: [selectedPage()] })}>This page</MenuItem>
      <MenuItem onClick={() => run({ pdf: anchor.pdf })}>All pages</MenuItem>
    </Menu>
    {said && <Typography variant="body2" role="status">{said}</Typography>}
  </Paper>
}
