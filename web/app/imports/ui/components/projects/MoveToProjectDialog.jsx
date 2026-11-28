// "Move to project…" on a slate (SlateMenu): the drives and folders the person may put it in, and
// "Not in a project" when it is in one. The server checks the move again (projects.moveSlate).
import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import FolderSharedOutlinedIcon from '@mui/icons-material/FolderSharedOutlined'
import DashboardIcon from '@mui/icons-material/Dashboard'
import projectsApi from '../../../api/client/projects'
import usePhoneView from '../../common/usePhoneView'
import useProjects, { useProjectsChanged } from './useProjects'
import { moveTargets, projectErrorWords } from './projectsModel.mjs'

export default function MoveToProjectDialog({ open, slate, onClose, onMoved }) {
  const projects = useProjects()
  const phone = usePhoneView()
  const changed = useProjectsChanged()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setBusy(false); setError('') } }, [open])
  const currentProjectId = slate?.projectId || null
  const rows = projects ? moveTargets({ slate, userId: Meteor.userId(), projects, currentProjectId, phone }) : null
  const name = slate?.options?.name || slate?.name || 'this slate'
  async function move(projectId) {
    if (projectId === currentProjectId) { onClose(); return }
    setBusy(true)
    setError('')
    try {
      await projectsApi.moveSlate({ shareId: slate.shareId, projectId })
      changed()
      onMoved(projectId)
    } catch (e) {
      setError(projectErrorWords(e))
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="move-to-project-title">
      <DialogTitle id="move-to-project-title">Move “{name}” to a project</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {rows === null && <Typography sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center' }} color="text.secondary"><CircularProgress size={16} /> Finding your projects…</Typography>}
        {rows?.length === 0 && <Typography sx={{ p: 2 }} color="text.secondary">No project you can add slates to yet. Make one from Projects in the menu.</Typography>}
        <List dense disablePadding>
          {rows?.map((row) => (
            <ListItemButton key={row.id ?? 'none'} onClick={() => move(row.id)} disabled={busy} selected={Boolean(row.current)}
              data-move-target={row.id ?? 'none'} sx={{ pl: 2 + row.depth * 2 }}>
              <ListItemIcon>{row.id === null ? <DashboardIcon /> : row.shared ? <FolderSharedOutlinedIcon /> : <FolderOutlinedIcon />}</ListItemIcon>
              <ListItemText primary={row.label} secondary={row.current ? 'It is here now' : row.detail} />
            </ListItemButton>
          ))}
        </List>
        {error && <Typography role="alert" color="error" variant="body2" sx={{ p: 2 }}>{error}</Typography>}
      </DialogContent>
      <DialogActions>
        {busy && <CircularProgress size={20} sx={{ mr: 'auto', ml: 1 }} aria-label="Moving" />}
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
      </DialogActions>
    </Dialog>
  )
}

MoveToProjectDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  slate: PropTypes.shape({ shareId: PropTypes.string, userId: PropTypes.string, projectId: PropTypes.string, name: PropTypes.string, options: PropTypes.object }),
  onClose: PropTypes.func.isRequired,
  onMoved: PropTypes.func.isRequired,
}
