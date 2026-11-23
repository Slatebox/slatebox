import React, { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useTracker } from 'meteor/react-meteor-data'
import { Meteor } from 'meteor/meteor'
import { Box, Button, Typography } from '@mui/material'
import createAnonymousUser from '../../api/client/createAnonymousUser'
import SlateLoading from '../components/SlateLoading'
import { proSheetPath } from '../components/billing/pay/pay-url.mjs'

// /pro?plan=monthly|yearly: the site's "Get Slatebox Pro". Anyone lands in the pay sheet at once,
// with the plan they picked: a member as they are, a new visitor as a guest made here (no sign-up
// first; the email is asked in the sheet and names the account after the payment, server/pro-claim.mjs).
let making = null
const ensureGuest = () => { making ||= createAnonymousUser().finally(() => { making = null }); return making }

export default function GetPro() {
  const [params] = useSearchParams()
  const loggingIn = useTracker(() => Meteor.loggingIn(), [])
  const userId = useTracker(() => Meteor.userId(), [])
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (loggingIn || userId) return
    ensureGuest().catch(() => setError('Slatebox could not open just now. Try again.'))
  }, [loggingIn, userId, retry])

  if (userId && !loggingIn) return <Navigate replace to={proSheetPath(params)} />
  if (!error) return <Box component="main"><SlateLoading /></Box>
  return (
    <Box component="main" sx={{ minHeight: '100svh', bgcolor: 'background.default', color: 'text.primary', p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, textAlign: 'center' }}>
      <Typography role="alert" sx={{ fontSize: 17 }}>{error}</Typography>
      <Button variant="contained" disableElevation sx={{ borderRadius: 6, px: 3 }} onClick={() => { setError(''); setRetry(n => n + 1) }}>Try again</Button>
    </Box>
  )
}
