// Pages that make a slate (/new, a starter, /ai). On a phone slates are for viewing, so these show a
// calm note and one way on instead. It sits outside GuestStartGate: a phone visit makes no guest.
import React from 'react'
import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Box, Button, Typography } from '@mui/material'
import BrandBar from '../common/BrandBar'
import { TileArt } from './EmptyState'
import usePhoneView from '../common/usePhoneView'
import { PHONE_GATE_COPY } from '../common/phoneView.mjs'

export default function PhoneViewGate({ children }) {
  const phoneView = usePhoneView()
  const signedIn = useTracker(() => Boolean(Meteor.userId()), [])
  if (!phoneView) return children
  const next = signedIn ? PHONE_GATE_COPY.signedIn : PHONE_GATE_COPY.signedOut
  return (
    <Box sx={{ minHeight: '100svh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <BrandBar />
      <Box component="main" data-testid="phone-view-gate" aria-labelledby="phone-view-gate-line" sx={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', gap: 2, px: 3, py: 6,
      }}>
        <TileArt variant="empty" size={120} />
        <Typography id="phone-view-gate-line" component="h1" sx={{ fontSize: 19, fontWeight: 650, lineHeight: 1.4,
          color: 'text.primary', maxWidth: 360 }}>
          {PHONE_GATE_COPY.line}
        </Typography>
        <Button component={Link} to={next.to} variant="contained" color="primary" disableElevation size="large"
          sx={{ borderRadius: 6, px: 3 }}>
          {next.label}
        </Button>
      </Box>
    </Box>
  )
}

PhoneViewGate.propTypes = { children: PropTypes.node.isRequired }
