import React, { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'

const failure = (err, fallback) => err?.reason || err?.message || fallback

// A change that cannot be undone by saving again (revoke a key, archive a provider, remove a model,
// publish a prompt): it asks why, for the change history. optional: the reason may be left empty.
export function ReasonDialog({ open, title, body, action, onClose, onConfirm, optional = false, danger = false }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) {
      setReason('')
      setError('')
    }
  }, [open])
  if (!open) return null
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      await onConfirm(reason.trim())
    } catch (err) {
      setError(failure(err, 'That did not work.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="reason-dialog-title">
      <DialogTitle id="reason-dialog-title">{title}</DialogTitle>
      <DialogContent>
        {body}
        <TextField label={optional ? 'Why (optional, kept in the change history)' : 'Why (kept in the change history)'} value={reason} onChange={(e) => setReason(e.target.value)} fullWidth multiline minRows={2} inputProps={{ maxLength: 500 }} autoFocus sx={{ mt: 2 }} />
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color={danger ? 'error' : 'primary'} disabled={busy || (!optional && !reason.trim())} onClick={run}>{action}</Button>
      </DialogActions>
    </Dialog>
  )
}

export default ReasonDialog
