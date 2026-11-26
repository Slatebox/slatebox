// The header's Move to Cloud on a self-hosted install (owner, 2026-11-25), for this server's
// administrator only: it opens the panel that moves the team to Slatebox Cloud in one click
// (MoveToCloudPanel). After a finished move it reads On Slatebox Cloud and still opens the panel. Integrations are free on every install (owner, 2026-11-26), so there is
// nothing else to offer here. A quiet button, never a sales pill; on a phone it collapses to an
// icon with its name for screen readers, so the header never overflows. Nothing on Slatebox Cloud,
// for guests, for members, or before the server says who is admin.
// Who sees it: imports/api/common/selfhost-options.mjs cloudMoveOffer (scripts/selfhost-options.test.mjs).
import React from 'react'
import { Meteor } from 'meteor/meteor'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import useMediaQuery from '@mui/material/useMediaQuery'
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined'
import { cloudMoveOffer, moveLabel } from '../../../api/common/selfhost-options.mjs'
import useSelfhostStatus from './useSelfhostStatus'

const MoveToCloudPanel = React.lazy(() => import('./MoveToCloudPanel'))

export default function MoveToCloudButton() {
  const status = useSelfhostStatus()
  const [open, setOpen] = React.useState(false)
  const phone = useMediaQuery('(max-width:599px)')
  const offer = cloudMoveOffer({ settings: Meteor.settings, signedIn: Boolean(status), serverAdmin: status ? status.serverAdmin === true : null })
  if (offer.show === 'none') return null
  const label = moveLabel(status)
  const common = { onClick: () => setOpen(true), 'aria-haspopup': 'dialog', 'data-testid': 'header-move-to-cloud' }
  const entry = phone ? (
    <IconButton {...common} aria-label={label} sx={{ color: 'shell.secondaryInk', flex: 'none' }}><CloudUploadOutlinedIcon /></IconButton>
  ) : (
    <Button {...common} startIcon={<CloudUploadOutlinedIcon sx={{ fontSize: '18px !important' }} />}
      sx={{ color: 'shell.secondaryInk', fontWeight: 600, textTransform: 'none', flex: 'none', borderRadius: 999, px: 1.25 }}>
      {label}
    </Button>
  )
  return <>
    {entry}
    {open && (
      <React.Suspense fallback={null}>
        <MoveToCloudPanel open={open} onClose={() => setOpen(false)} status={status} />
      </React.Suspense>
    )}
  </>
}
