import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import libraryApi from '../../../api/client/library'
import { authorStatus } from './libraryCopy.mjs'

const PublishDialog = React.lazy(() => import('./PublishDialog'))

/** The caller's library item made from this slate (as a slate or as a presentation), or null. */
export function useLibraryItemFor(shareId, kind, refresh = 0) {
  const [item, setItem] = React.useState(undefined)
  React.useEffect(() => {
    let live = true
    if (!shareId || !Meteor.userId()) { setItem(null); return undefined }
    libraryApi.mine().then((answer) => {
      if (live) setItem(answer.items.find((row) => row.kind === kind && row.sourceShareId === shareId) || null)
    }, () => { if (live) setItem(null) })
    return () => { live = false }
  }, [shareId, kind, refresh])
  return item
}

// The library row of the Share dialog and the presentation settings: "Publish to the library" (or
// "Send an update"), and once sent, the item's status with a link to My library. A guest is asked to
// sign up first: guests cannot publish.
export default function PublishStatus({ kind, shareId, name, description, libraryOrigin, previewSlate, guest, disabled, disabledReason }) {
  const [open, setOpen] = React.useState(false)
  const [refresh, setRefresh] = React.useState(0)
  const [sent, setSent] = React.useState(false)
  const item = useLibraryItemFor(guest ? null : shareId, kind, refresh)
  if (guest) {
    return (
      <Box data-testid="library-publish" sx={{ display: 'grid', gap: 1, justifyItems: 'start' }}>
        <Typography variant="body2">Sign up to publish to the library. Your slates come with you.</Typography>
        <Button variant="outlined" component={RouterLink} to="/signup">Sign up to publish</Button>
      </Box>
    )
  }
  const status = item ? authorStatus(item) : null
  const canSend = !item || ['draft', 'changes_requested', 'rejected', 'unpublished'].includes(item.status) ||
    (item.status === 'published' && (!item.reviewStatus || ['changes_requested', 'rejected'].includes(item.reviewStatus)))
  const label = item?.status === 'published' ? 'Send an update to the library' : item ? 'Send it for review again' : 'Publish to the library'
  return (
    <Box data-testid="library-publish" sx={{ display: 'grid', gap: 1, justifyItems: 'start' }}>
      {status && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <Chip size="small" label={status.label} color={status.tone === 'default' ? 'default' : status.tone} data-testid="library-status" />
          <Button size="small" component={RouterLink} to="/library/mine">My library</Button>
        </Box>
      )}
      {sent && <Typography variant="body2" role="status" data-testid="publish-done" sx={{ color: 'success.dark' }}>
        Sent for review. You will hear back in your notifications and by email, and can follow it in My library.
      </Typography>}
      {item?.lastMessage?.by === 'reviewer' && <Typography variant="body2" color="text.secondary">The reviewer wrote: {item.lastMessage.text}</Typography>}
      {canSend && (
        <Button variant="contained" onClick={() => setOpen(true)} disabled={disabled || item === undefined} data-testid="library-publish-open">{label}</Button>
      )}
      {disabled && disabledReason && <Typography variant="caption" color="text.secondary">{disabledReason}</Typography>}
      {open && (
        <React.Suspense fallback={null}>
          <PublishDialog open={open} onClose={() => setOpen(false)} onSubmitted={() => { setSent(true); setRefresh((n) => n + 1) }} kind={kind} shareId={shareId}
            name={name} description={description} libraryOrigin={libraryOrigin} existing={item} previewSlate={previewSlate} />
        </React.Suspense>
      )}
    </Box>
  )
}

PublishStatus.propTypes = {
  kind: PropTypes.oneOf(['slate', 'presentation']).isRequired,
  shareId: PropTypes.string,
  name: PropTypes.string,
  description: PropTypes.string,
  libraryOrigin: PropTypes.object,
  previewSlate: PropTypes.object,
  guest: PropTypes.bool,
  disabled: PropTypes.bool,
  disabledReason: PropTypes.string,
}

PublishStatus.defaultProps = {
  shareId: null, name: '', description: '', libraryOrigin: null, previewSlate: null, guest: false, disabled: false, disabledReason: '',
}
