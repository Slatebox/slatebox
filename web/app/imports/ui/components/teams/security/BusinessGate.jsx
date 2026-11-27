/* eslint-disable no-underscore-dangle */
// The notice single sign-on, SCIM and the activity log show when the server has them off for the
// team, with its one action (business-gate-model.mjs). useBusinessAccess reads what the notice needs
// about the person and the team: the edition, whether Business is sold here, whether the team's
// Business has ended, and whether this person may buy it.
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../../api/common/constants'
import AuthManager from '../../../../api/common/AuthManager'
import { Organizations } from '../../../../api/common/models'
import { isCloudEdition } from '../../../../api/common/edition.mjs'
import { businessActive } from '../../../../api/business/membership.mjs'
import { paymentsHere } from '../../billing/pay/pay-env'

export function useBusinessAccess() {
  const user = useTracker(() => Meteor.user(), [])
  const business = useTracker(() => Organizations.findOne()?.business ?? null, [])
  const [admin, setAdmin] = React.useState(false)
  const userId = user?._id
  const orgId = user?.orgId
  React.useEffect(() => {
    let live = true
    if (userId && orgId) {
      AuthManager.userHasClaim(userId, [CONSTANTS.claims.admin._id])
        .then((yes) => live && setAdmin(Boolean(yes)))
        .catch(() => live && setAdmin(false))
    }
    return () => { live = false }
  }, [userId, orgId])
  return {
    cloud: isCloudEdition(Meteor.settings),
    billingHere: paymentsHere(),
    lapsed: Boolean(business) && !businessActive({ business }),
    manager: Boolean(orgId && (user?.isOrgOwner === true || admin)),
  }
}

export default function BusinessGateNotice({ gate }) {
  if (!gate) return null
  const { action } = gate
  let button = null
  if (action?.kind === 'link') {
    button = <Button component={RouterLink} to={action.to} variant="contained" size="small" disableElevation data-business-gate-action="link">{action.label}</Button>
  } else if (action?.kind === 'href') {
    button = <Button href={action.href} target="_blank" rel="noopener noreferrer" variant="outlined" size="small" data-business-gate-action="href">{action.label}</Button>
  }
  return (
    <Alert severity="info" data-business-gate={gate.feature} sx={{ '& .MuiAlert-message': { minWidth: 0, width: '100%' } }}>
      <Box sx={{ display: 'grid', gap: 1 }}>
        <Typography variant="body2">{gate.text}</Typography>
        {button && <Box>{button}</Box>}
        {action?.kind === 'ask' && <Typography variant="body2" sx={{ fontWeight: 600 }} data-business-gate-action="ask">{action.label}</Typography>}
      </Box>
    </Alert>
  )
}
BusinessGateNotice.propTypes = {
  gate: PropTypes.shape({
    feature: PropTypes.string.isRequired,
    text: PropTypes.string.isRequired,
    action: PropTypes.shape({ kind: PropTypes.string.isRequired, label: PropTypes.string.isRequired, to: PropTypes.string, href: PropTypes.string }),
  }),
}
BusinessGateNotice.defaultProps = { gate: null }
