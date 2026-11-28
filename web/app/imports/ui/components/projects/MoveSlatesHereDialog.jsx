// "Move slates here" on a project page: the person's own slates that are not in this drive or
// folder yet, any number at once. Each moves with projects.moveSlate (the same check as one at a time).
import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Checkbox from '@mui/material/Checkbox'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import CONSTANTS from '../../../api/common/constants'
import projectsApi from '../../../api/client/projects'
import { useProjectsChanged } from './useProjects'
import { projectErrorWords } from './projectsModel.mjs'

export default function MoveSlatesHereDialog({ open, projectId, projectName, onClose, onMoved }) {
  const changed = useProjectsChanged()
  const [slates, setSlates] = useState(null)
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return undefined
    setPicked(new Set()); setError(''); setBusy(false)
    let live = true
    const timer = setTimeout(() => {
      Meteor.callAsync(CONSTANTS.methods.slates.get, { type: 'mine', skip: 0, limit: 50, filterString: filter || null })
        .then((answer) => { if (live) setSlates((answer?.slates ?? []).filter((s) => s?.shareId && s.userId === Meteor.userId() && s.projectId !== projectId)) },
          () => { if (live) setSlates([]) })
    }, filter ? 300 : 0)
    return () => { live = false; clearTimeout(timer) }
  }, [open, filter, projectId])
  const toggle = (shareId) => setPicked((had) => { const next = new Set(had); if (next.has(shareId)) next.delete(shareId); else next.add(shareId); return next })
  async function move() {
    setBusy(true)
    setError('')
    let moved = 0
    try {
      for (const shareId of picked) {
        // eslint-disable-next-line no-await-in-loop
        await projectsApi.moveSlate({ shareId, projectId })
        moved += 1
      }
      changed()
      onMoved(moved)
    } catch (e) {
      setError(`${moved ? `${moved} moved. ` : ''}${projectErrorWords(e)}`)
      setBusy(false)
      if (moved) changed()
    }
  }
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="move-here-title">
      <DialogTitle id="move-here-title">Move slates to {projectName}</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1 }}>
        <TextField size="small" label="Find a slate" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {slates === null && <Typography sx={{ display: 'flex', gap: 1, alignItems: 'center' }} color="text.secondary"><CircularProgress size={16} /> Finding your slates…</Typography>}
        {slates?.length === 0 && <Typography color="text.secondary">No slates of yours to move here.</Typography>}
        <List dense disablePadding>
          {slates?.map((s) => (
            <ListItem key={s.shareId} disablePadding>
              <ListItemButton onClick={() => toggle(s.shareId)} disabled={busy}>
                <ListItemIcon><Checkbox edge="start" tabIndex={-1} disableRipple checked={picked.has(s.shareId)} inputProps={{ 'aria-label': `Move ${s.options?.name || 'Untitled slate'}` }} /></ListItemIcon>
                <ListItemText primary={s.options?.name || 'Untitled slate'} secondary={s.projectId ? 'In another project now' : null} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
        {error && <Typography role="alert" color="error" variant="body2">{error}</Typography>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" disableElevation onClick={move} disabled={busy || picked.size === 0}>
          {picked.size > 1 ? `Move ${picked.size} slates` : 'Move slate'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

MoveSlatesHereDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  projectId: PropTypes.string.isRequired,
  projectName: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onMoved: PropTypes.func.isRequired,
}
