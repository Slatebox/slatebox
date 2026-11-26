// After a team moved from this self-hosted server to Slatebox Cloud, its administrator may switch
// on a banner for everyone here pointing at Cloud (selfhost.movedBanner). Nothing is deleted or
// locked: the banner only says where the team works now. Hidden for the rest of the visit once closed.
import React from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import useSelfhostStatus from './useSelfhostStatus'

export default function MovedBanner() {
  const status = useSelfhostStatus()
  const [closed, setClosed] = React.useState(() => window.sessionStorage?.getItem('slatebox:moved-banner') === 'closed')
  if (!status?.moved || closed) return null
  const close = () => {
    window.sessionStorage?.setItem('slatebox:moved-banner', 'closed')
    setClosed(true)
  }
  return (
    <Alert severity="info" data-testid="moved-banner" onClose={close}
      action={<Button color="inherit" size="small" href={status.moved.url} target="_blank" rel="noopener">Open Slatebox Cloud</Button>}
      sx={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 16, zIndex: (theme) => theme.zIndex.drawer + 3, maxWidth: 'calc(100vw - 24px)', boxShadow: 3 }}>
      {status.moved.teamName ? `${status.moved.teamName} moved` : 'This team moved'} to Slatebox Cloud. Work there from now on; this copy stays as it was.
    </Alert>
  )
}
