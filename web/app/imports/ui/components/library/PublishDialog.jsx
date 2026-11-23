import React from 'react'
import PropTypes from 'prop-types'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Alert from '@mui/material/Alert'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import { Link as RouterLink } from 'react-router-dom'
import libraryApi from '../../../api/client/library'
import LibraryPreview from './LibraryPreview'
import { PUBLISH_LINE, kindLabel, publishDefaults, publishInput } from './libraryCopy.mjs'

// "Publish to the library" for a slate (Share) or a presentation (its settings): a preview of what
// goes, the details people find it by, and a note for the reviewer. A category is a smart component's
// (the reviewer may still give a slate one). It sends library.submit; the
// item waits in the review queue until an administrator approves it. Nothing is public before that.
export default function PublishDialog({ open, onClose, onSubmitted, kind, shareId, name, description, libraryOrigin, existing, previewSlate }) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const [fields, setFields] = React.useState(() => publishDefaults({ kind, name, description, libraryOrigin }))
  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')
  const [done, setDone] = React.useState(null)
  React.useEffect(() => {
    if (!open) return
    const start = publishDefaults({ kind, name, description, libraryOrigin })
    if (existing) Object.assign(start, { title: existing.title || start.title, summary: existing.summary || start.summary, description: existing.description || '' })
    setFields(start)
    setProblem('')
    setDone(null)
  }, [open, kind, shareId])
  const set = (field) => (event) => setFields((now) => ({ ...now, [field]: event.target.value }))
  const what = kindLabel(kind)
  const ready = fields.title.trim() && fields.summary.trim()

  async function submit() {
    if (!ready || busy) return
    setBusy(true)
    setProblem('')
    try {
      const result = await libraryApi.submit(publishInput(fields, { shareId }))
      setDone(result)
      onSubmitted?.(result)
    } catch (error) {
      setProblem(error?.reason || error?.message || 'It could not be sent for review. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(open)} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={phone} aria-labelledby="publish-library-title">
      <DialogTitle id="publish-library-title">{existing?.status === 'published' ? `Send an update of this ${what}` : `Publish this ${what} to the library`}</DialogTitle>
      <DialogContent>
        {done ? (
          <Box data-testid="publish-done" sx={{ display: 'grid', gap: 1.5, pt: 1 }}>
            <Alert severity="success">Sent for review. You will hear back in your notifications and by email.</Alert>
            <Typography variant="body2">Follow it, and reply to the reviewer, in <RouterLink to="/library/mine">My library</RouterLink>.</Typography>
          </Box>
        ) : (
          <Box component="form" onSubmit={(event) => { event.preventDefault(); submit() }} sx={{ display: 'grid', gap: 2, pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              An administrator reviews everything before it is public. People can then open a copy of your {what} and change it as their own.
            </Typography>
            {previewSlate && <LibraryPreview content={{ kind: 'slate', slate: previewSlate }} title={fields.title} height={phone ? 140 : 180} />}
            {fields.basedOn && <Typography variant="body2" data-testid="publish-based-on">Based on {fields.basedOn}</Typography>}
            <TextField label="Title" value={fields.title} onChange={set('title')} required inputProps={{ maxLength: 80 }} fullWidth autoFocus />
            <TextField label="One line about it" value={fields.summary} onChange={set('summary')} required inputProps={{ maxLength: 160 }}
              helperText="What it is and what it holds, in one line." fullWidth />
            <TextField label="Description (optional)" value={fields.description} onChange={set('description')} multiline minRows={2}
              inputProps={{ maxLength: 2000 }} fullWidth />
            <TextField label="Note for the reviewer (optional)" value={fields.note} onChange={set('note')} multiline minRows={2}
              inputProps={{ maxLength: 2000 }} fullWidth />
            <Typography variant="caption" color="text.secondary">{PUBLISH_LINE}</Typography>
            {problem && <Alert severity="error" role="alert">{problem}</Alert>}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {done ? <Button variant="contained" onClick={onClose}>Done</Button> : <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={!ready || busy} data-testid="publish-submit">
            {busy ? 'Sending…' : 'Send for review'}
          </Button>
        </>}
      </DialogActions>
    </Dialog>
  )
}

PublishDialog.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  onSubmitted: PropTypes.func,
  kind: PropTypes.oneOf(['slate', 'presentation']).isRequired,
  shareId: PropTypes.string,
  name: PropTypes.string,
  description: PropTypes.string,
  libraryOrigin: PropTypes.shape({ title: PropTypes.string }),
  existing: PropTypes.shape({ title: PropTypes.string, summary: PropTypes.string, description: PropTypes.string, status: PropTypes.string }),
  previewSlate: PropTypes.object,
}

PublishDialog.defaultProps = {
  open: false, onSubmitted: null, shareId: null, name: '', description: '', libraryOrigin: null, existing: null, previewSlate: null,
}
