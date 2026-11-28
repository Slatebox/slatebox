// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// On a slate a recipe keeps in step with a file in a repository (Diagrams as code; slot
// canvas.recipes, beside MaintainedNotes): "Synced with acme/api docs/architecture/checkout.mmd @
// 1a2b3c4", whether edits wait to go out or wait in the pull request, and Save to repo now for
// editors (the export runs at once instead of 10 minutes after the last edit). Read with
// recipes.syncedOn; nothing shows on a slate no recipe syncs.
import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import recipesApi from './recipesApi'
import { recipeErrorWords, syncedLine, syncedState } from './recipesModel.mjs'

const REFRESH_MS = 60000

export default function SyncedWithRepo({ slate, canEdit }) {
  const shareId = slate?.shareId
  const [synced, setSynced] = useState([])
  const [busy, setBusy] = useState(null)
  const [note, setNote] = useState('')
  const load = () => recipesApi.syncedOn({ shareId }).then((a) => setSynced(Array.isArray(a?.synced) ? a.synced : []), () => setSynced([]))
  useEffect(() => {
    if (!shareId) return undefined
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [shareId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!synced.length) return null
  async function saveNow(s) {
    setBusy(s.instanceId); setNote('')
    try {
      await recipesApi.saveNow({ instanceId: s.instanceId, shareId })
      setNote('Saving to the repository now.')
      setTimeout(load, 5000)
    } catch (e) { setNote(recipeErrorWords(e)) } finally { setBusy(null) }
  }
  return (
    <Paper data-synced-with-repo="" elevation={2}
      sx={{ position: 'fixed', left: 16, bottom: 'calc(var(--sb-canvas-bottom, 0px) + 232px)', zIndex: 1200, display: { xs: 'none', md: 'grid' }, gap: 0.75, p: 1.25, maxWidth: 380 }}>
      {synced.map((s) => (
        <Box key={s.instanceId} sx={{ display: 'grid', gap: 0.5 }}>
          <Typography variant="body2" fontWeight={650} sx={{ overflowWrap: 'anywhere' }}>{syncedLine(s)}</Typography>
          <Typography variant="caption" color="text.secondary">{syncedState(s)}</Typography>
          {canEdit && s.canSave && (
            <Button size="small" variant="outlined" sx={{ justifySelf: 'start' }} disabled={busy !== null} onClick={() => saveNow(s)}>Save to repo now</Button>
          )}
        </Box>
      ))}
      {note && <Typography role="status" variant="caption">{note}</Typography>}
    </Paper>
  )
}

SyncedWithRepo.propTypes = {
  slate: PropTypes.object,
  canEdit: PropTypes.bool,
}
