import React from 'react'
import PropTypes from 'prop-types'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

// Shown before any camera turns on in a voice call: one camera makes the whole call video.
// Only a metered server speaks of included calls (Pro credits, or the free amount where Pro is not needed).
export default function CameraWarning({ open, starterName, metered, onConfirm, onCancel }) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs">
      <DialogTitle>Turn on your camera?</DialogTitle>
      <DialogContent>
        <Typography>
          {metered ? `A camera makes this a video call for everyone, which uses more of ${starterName}'s included calls.` : 'A camera makes this a video call for everyone.'}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Keep voice</Button>
        <Button variant="contained" onClick={onConfirm}>Turn on camera</Button>
      </DialogActions>
    </Dialog>
  )
}

CameraWarning.propTypes = {
  open: PropTypes.bool.isRequired,
  starterName: PropTypes.string,
  metered: PropTypes.bool,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
}
