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
import AddIcon from '@mui/icons-material/Add'
import DashboardIcon from '@mui/icons-material/Dashboard'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Box from '@mui/material/Box'
import CONSTANTS from '../../../../api/common/constants'
import useProjects from '../../projects/useProjects'
import { ROLE_RANK, sortDrives } from '../../projects/projectsModel.mjs'

/**
 * "Add to a slate" for a smart component: a new slate, or one of the person's own slates (most recently saved first),
 * or a slate in one of their projects they may edit (the project picker).
 * The choice goes back to the item page, which adds the board with library.fork and opens that slate.
 */
export default function AddToSlateDialog({ open, title, busy, onPick, onClose }) {
  const [slates, setSlates] = useState(null)
  // '' is My slates; otherwise a drive the person edits in (editor or more).
  const [projectId, setProjectId] = useState('')
  const projects = useProjects()
  const { owned, shared } = sortDrives((projects || []).filter((p) => (ROLE_RANK[p.role] ?? 0) >= ROLE_RANK.editor), Meteor.userId())
  const drives = [...owned, ...shared]

  useEffect(() => {
    if (!open) return
    if (!Meteor.userId()) { setSlates([]); return }
    let gone = false
    setSlates(null)
    Meteor.callAsync(CONSTANTS.methods.slates.get, projectId ? { type: 'project', projectId, skip: 0, limit: 20 } : { type: 'mine', skip: 0, limit: 20 })
      .then(answer => { if (!gone) setSlates((answer?.slates ?? []).filter(slate => slate?.shareId)) }, () => { if (!gone) setSlates([]) })
    return () => { gone = true }
  }, [open, projectId])

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="add-to-slate-title">
      <DialogTitle id="add-to-slate-title">Add {title} to a slate</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {drives.length > 0 && (
          <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
            <Select size="small" fullWidth value={projectId} onChange={e => setProjectId(e.target.value)} displayEmpty inputProps={{ 'aria-label': 'Where to look' }}>
              <MenuItem value="">My slates</MenuItem>
              {drives.map(d => <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>)}
            </Select>
          </Box>
        )}
        <List dense disablePadding>
          <ListItemButton onClick={() => onPick(null)} disabled={busy} data-add-target="new">
            <ListItemIcon><AddIcon /></ListItemIcon>
            <ListItemText primary="New slate" secondary="A new slate with this board on it" />
          </ListItemButton>
          {slates === null && <Typography sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center' }} color="text.secondary"><CircularProgress size={16} /> Finding your slates…</Typography>}
          {slates?.map(slate => (
            <ListItemButton key={slate.shareId} onClick={() => onPick(slate)} disabled={busy} data-add-target={slate.shareId}>
              <ListItemIcon><DashboardIcon /></ListItemIcon>
              <ListItemText primary={slate.options?.name || 'Untitled slate'} secondary="Beside the boards already there" />
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        {busy && <CircularProgress size={20} sx={{ mr: 'auto', ml: 1 }} aria-label="Adding" />}
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
      </DialogActions>
    </Dialog>
  )
}

AddToSlateDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  title: PropTypes.string,
  busy: PropTypes.bool,
  onPick: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
}
