// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// On a slate (slot canvas.recipes): which notes recipes keep up to date. The notes are real notes on
// the canvas, never an overlay; this is the small panel beside the agents that says so:
//   "Maintained by GitHub architect · runs for Ana: 42 notes" with Select them (the engine's own
//   selection), and, when selected notes are kept by a recipe, "Kept up to date by GitHub architect"
//   with Make it mine (the recipe never changes those notes again). Locking a note keeps it too.
import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import recipesApi from './recipesApi'
import { maintainedSummary, recipeErrorWords, selectedMaintained } from './recipesModel.mjs'

const REFRESH_MS = 120000

export default function MaintainedNotes({ slate, canEdit, readSelection }) {
  const shareId = slate?.shareId
  const [instances, setInstances] = useState([])
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState([])
  const [note, setNote] = useState('')
  const load = () => recipesApi.notesOn({ shareId }).then((a) => setInstances(Array.isArray(a?.instances) ? a.instances : []), () => setInstances([]))
  useEffect(() => {
    if (!shareId) return undefined
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [shareId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !readSelection) return undefined
    const read = () => setPicked(readSelection() || [])
    read()
    const timer = setInterval(read, 700)
    return () => clearInterval(timer)
  }, [open, readSelection])
  const summary = maintainedSummary(instances)
  if (!summary.length) return null
  const kept = selectedMaintained(instances, picked)
  function selectThem(noteIds) {
    const v2 = slate?.v2
    const nodes = noteIds.map((id) => v2?.getNode?.(id)).filter(Boolean)
    if (nodes.length && v2?.selectNodes) v2.selectNodes(nodes, false)
    else if (nodes.length && slate?.selectNodes) slate.selectNodes(nodes, false)
  }
  async function makeMine(entry) {
    setNote('')
    try { await recipesApi.makeMine({ shareId, noteIds: entry.noteIds }); setNote('Those notes are yours now.'); load() } catch (e) { setNote(recipeErrorWords(e)) }
  }
  return (
    <Box data-maintained-notes="" sx={{ position: 'fixed', left: 16, bottom: 'calc(var(--sb-canvas-bottom, 0px) + 184px)', zIndex: 1200, display: { xs: 'none', md: 'block' } }}>
      <Button size="small" variant="outlined" aria-expanded={open} onClick={() => setOpen(!open)} sx={{ bgcolor: 'background.paper' }}>
        Kept up to date by {summary.length === 1 ? summary[0].agent.split(' · ')[0] : `${summary.length} recipes`}
      </Button>
      {open && (
        <Paper elevation={3} sx={{ position: 'absolute', bottom: 40, left: 0, width: 340, p: 1.5, display: 'grid', gap: 1 }}>
          {summary.map((s) => (
            <Box key={s.instanceId} sx={{ display: 'grid', gap: 0.5 }}>
              <Typography variant="body2">{s.line}</Typography>
              <Button size="small" sx={{ justifySelf: 'start' }} onClick={() => selectThem(s.noteIds)}>Select them</Button>
            </Box>
          ))}
          {kept.map((k) => (
            <Box key={k.instanceId} sx={{ borderTop: 1, borderColor: 'divider', pt: 1, display: 'grid', gap: 0.5 }}>
              <Typography variant="body2" fontWeight={650}>{k.line}</Typography>
              <Typography variant="caption" color="text.secondary">{k.noteIds.length === 1 ? 'The selected note' : `${k.noteIds.length} selected notes`} change when the source changes. Lock a note to keep it as it is.</Typography>
              {canEdit && <Button size="small" sx={{ justifySelf: 'start' }} onClick={() => makeMine(k)}>Make it mine</Button>}
            </Box>
          ))}
          {!kept.length && <Typography variant="caption" color="text.secondary">Edit one of these notes, or select it and choose Make it mine, and the recipe leaves it as you made it.</Typography>}
          {note && <Typography role="status" variant="body2">{note}</Typography>}
        </Paper>
      )}
    </Box>
  )
}

MaintainedNotes.propTypes = {
  slate: PropTypes.object,
  canEdit: PropTypes.bool,
  readSelection: PropTypes.func,
}
