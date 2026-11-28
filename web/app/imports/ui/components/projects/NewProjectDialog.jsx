// New project: a drive of slates, personal or the team's, that is shared like a drive.
import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import projectsApi from '../../../api/client/projects'
import { DESCRIPTION_MAX, NAME_MAX, PROJECT_COLORS, projectErrorWords, validateDescription, validateProjectName } from './projectsModel.mjs'

export default function NewProjectDialog({ open, onClose, onCreated }) {
  const orgId = useTracker(() => Meteor.user()?.orgId || null, [])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setName(''); setDescription(''); setError(''); setBusy(false); setColor(0) } }, [open])
  const nameCheck = validateProjectName(name)
  const descriptionCheck = validateDescription(description)
  async function create(event) {
    event.preventDefault()
    if (!nameCheck.ok || !descriptionCheck.ok) { setError(nameCheck.error || descriptionCheck.error); return }
    setBusy(true)
    setError('')
    try {
      const project = await projectsApi.create({
        name: nameCheck.value,
        description: descriptionCheck.value,
        color,
      })
      onCreated(project)
    } catch (e) {
      setError(projectErrorWords(e))
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="new-project-title">
      <Box component="form" onSubmit={create} noValidate>
        <DialogTitle id="new-project-title">New project</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
          <Typography variant="body2" color="text.secondary">A project keeps slates together, in folders if you like, and is shared like a drive.</Typography>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required
            slotProps={{ htmlInput: { maxLength: NAME_MAX } }} error={Boolean(error) && !nameCheck.ok} />
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2}
            slotProps={{ htmlInput: { maxLength: DESCRIPTION_MAX } }} />
          {/* projects.create takes no owner: the server makes it the team's when the person is in one */}
          {orgId && <Typography variant="body2" color="text.secondary">It is your team’s project: you own it, and your team’s admins can manage it too.</Typography>}
          <Box role="radiogroup" aria-label="Color" sx={{ display: 'flex', gap: 1 }}>
            {PROJECT_COLORS.map((hex, i) => (
              <Box key={hex} component="button" type="button" role="radio" aria-checked={color === i} aria-label={`Color ${i + 1}`}
                onClick={() => setColor(i)}
                sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: hex, border: 2, cursor: 'pointer',
                  borderColor: color === i ? 'text.primary' : 'transparent', outlineOffset: 2 }} />
            ))}
          </Box>
          {error && <Typography role="alert" color="error" variant="body2">{error}</Typography>}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="contained" disableElevation disabled={busy || !nameCheck.ok}>Create project</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}

NewProjectDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
}
