import React, { useRef, useState } from 'react'
import { Accounts } from 'meteor/accounts-base'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Link } from '@mui/material'
import CONSTANTS from '../../api/common/constants'

export default function KeepNativeSlate({ routeKey, proof, slateId, visitor }) {
  const userId = useTracker(() => Meteor.userId())
  const busy = useRef(false)
  const [status, setStatus] = useState('ready')
  const [message, setMessage] = useState('')
  const dismissalKey = 'dismissNativeKeep:' + routeKey
  const [dismissed, setDismissed] = useState(() => {
    try { return Boolean(sessionStorage.getItem(dismissalKey)) } catch { return false }
  })
  function dismiss() {
    setDismissed(true)
    try { sessionStorage.setItem(dismissalKey, '1') } catch { /* in-memory dismissal is sufficient */ }
  }

  async function keep() {
    if (busy.current || userId) return
    busy.current = true
    setStatus('saving')
    setMessage('')
    try {
      // Refresh the admission on the current DDP connection if the network reconnected.
      await Meteor.callAsync(CONSTANTS.methods.organizations.trackGuest, { slateId, guestCollaboratorId: visitor })
      await new Promise((resolve, reject) => Accounts.callLoginMethod({
        methodArguments: [{ keepNativeEdit: { key: routeKey, proof } }],
        userCallback: error => error ? reject(error) : resolve(),
      }))
      setStatus('saved')
      try { sessionStorage.removeItem('nativeEdit:' + routeKey) } catch { /* private browsing */ }
    } catch (error) {
      if (error.error === 'keep-unavailable') {
        setMessage('This invitation can no longer be kept.')
        setStatus('unavailable')
      } else {
        setMessage('Could not keep this slate. Try again.')
        setStatus('ready')
      }
    } finally { busy.current = false }
  }

  if (dismissed || (userId && status === 'ready')) return null
  return <Box sx={{ position:'fixed', zIndex:1100, top:'calc(72px + env(safe-area-inset-top))', left:'50%', transform:'translateX(-50%)',
    '& .MuiButton-root': { minHeight:44 }, display:'flex', alignItems:'center', gap:1, flexWrap:'wrap', justifyContent:'center',
    bgcolor:'background.paper', borderRadius:2, boxShadow:3, p:1, maxWidth:'calc(100vw - 24px)', width:'max-content' }}>
    {status === 'saved'
      ? <><span role="status">Saved to My slates</span>{' '}<Link component={RouterLink} to="/">Open My slates</Link></>
      : <>{status !== 'unavailable' && <Button size="small" onClick={keep} disabled={status === 'saving'}>Keep in My slates</Button>}
        {message && <span role="status">{message}</span>}</>}
    <Button size="small" aria-label="Dismiss Keep in My slates" onClick={dismiss}>Dismiss</Button>
  </Box>
}
