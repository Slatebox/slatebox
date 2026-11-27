// An address the app has no page for: a calm message and two ways on, never a blank page.
import React from 'react'
import { Link } from 'react-router-dom'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Box, Button, Typography } from '@mui/material'
import { TileArt } from '../components/EmptyState'
import AppPage from '../common/AppPage'
import usePhoneView from '../common/usePhoneView'

export default function NotFound() {
  // A visitor who is not signed in is offered Sign in, not a list they do not have.
  const signedIn = useTracker(() => Boolean(Meteor.userId()), [])
  // A phone views slates and makes none (phoneView.mjs): no Start a new slate there.
  const phoneView = usePhoneView()
  const home = { variant: 'contained', color: 'primary', disableElevation: true, size: 'large', sx: { borderRadius: 6, px: 3 } }
  return (
    // the shared page layout's edges; the message itself sits in the middle of the page, as an empty list's does
    <AppPage component="section" aria-labelledby="not-found-title" sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
      gap: 1.5, minHeight: 'calc(100svh - 64px - 48px)',
    }}>
      <Box sx={{ mb: 2 }}><TileArt variant="lost" size={176} /></Box>
      <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '.12em', fontWeight: 700 }}>404</Typography>
      <Typography id="not-found-title" component="h1" sx={{ fontWeight: 750, letterSpacing: '-.025em', lineHeight: 1.1,
        fontSize: { xs: 32, md: 40 }, color: 'text.primary' }}>
        This page isn’t here
      </Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: 17, lineHeight: 1.5, maxWidth: 440 }}>
        The link may be old, or the page may have moved. Your slates are where you left them.
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 1.25, mt: 2 }}>
        {signedIn
          ? <Button component={Link} to="/" {...home}>Open My slates</Button>
          : <Button component={Link} to="/login" {...home}>Sign in</Button>}
        {!phoneView && <Button component={Link} to="/new" variant="outlined" color="primary" size="large" sx={{ borderRadius: 6, px: 3 }}>
          Start a new slate
        </Button>}
      </Box>
    </AppPage>
  )
}
