import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useDispatch, useSelector } from 'react-redux'
import { useHistory } from 'react-router-dom'
import { useTracker } from 'meteor/react-meteor-data'
import { useTheme } from '@material-ui/core'
import Menu from '@material-ui/core/Menu'
import MenuItem from '@material-ui/core/MenuItem'
import IconButton from '@material-ui/core/IconButton'
import AccountCircleIcon from '@material-ui/icons/AccountCircle'
import Typography from '@material-ui/core/Typography'
import Chip from '@material-ui/core/Chip'
import Grid from '@material-ui/core/Grid'
import { promisify } from '../../api/client/promisify'
import { CONSTANTS } from '../../api/common/constants'
import { PricingTiers, Organizations } from '../../api/common/models'
import Button from '@material-ui/core/Button'
import { useMediaQuery } from '@material-ui/core'
import { getUserName } from '../../api/common/getUserName'

export const ProfileMenu = (props) => {
  const dispatch = useDispatch()
  const theme = useTheme()
  const history = useHistory()
  const smmq = useMediaQuery(theme.breakpoints.up('sm'))
  const mdmq = useMediaQuery(theme.breakpoints.up('md'))
  const lgmq = useMediaQuery(theme.breakpoints.up('lg'))

  const userDetails = useTracker(() => {
    //get pricing data
    Meteor.subscribe(CONSTANTS.publications.pricingTiers)
    if (Meteor.user()) {
      let plan = Meteor.user().orgId
        ? Organizations.findOne()?.planType
        : Meteor.user().planType
      plan = plan || 'free'
      let name = getUserName(Meteor.userId())
      let color = plan === 'free' ? 'default' : 'secondary'
      let isVerified = false
      if (
        Meteor.user() &&
        !Meteor.user().isAnonymous &&
        Meteor.user().emails &&
        Meteor.user().emails.length > 0 &&
        Meteor.user().emails[0].verified
      ) {
        isVerified = true
      }
      return { plan, name, color, isVerified }
    }
    return { plan: 'free', name: 'Guest', color: 'primary', isVerified: false }
  })

  let headerPlanMessage = ''
  useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.pricingTiers)
    let pt = Meteor.user().orgId
      ? Organizations.findOne()?.planType
      : Meteor.user().planType
    const tier = PricingTiers.findOne({
      $or: [{ 'yearly.priceId': pt }, { 'monthly.priceId': pt }],
    })
    headerPlanMessage = tier?.headerText || 'Forever Free Team'
  })
  const logout = () => {
    Meteor.logout()
  }

  const [anchorEl, setAnchorEl] = React.useState(null)
  const showProfile = (e) => {
    setAnchorEl(e.currentTarget)
  }
  const loadProfile = () => {
    history.push('/profile')
    setAnchorEl(null)
  }

  const createPortalSession = async () => {
    if (Meteor.user().isAnonymous) {
      dispatch({
        type: 'registration',
        registrationOpen: true,
        registrationMessage: `Register to create an account.`,
      })
    } else if (
      Meteor.user().planType === 'free' ||
      Organizations.findOne()?.planType === 'free'
    ) {
      dispatch({
        type: 'payment',
        paymentOpen: true,
        paymentMessage: `You are currently on the forever free plan.`,
        paymentFocus: null,
      })
    } else {
      const url = await promisify(
        Meteor.call,
        CONSTANTS.methods.stripe.createSession,
        { type: 'portal', returnUrl: window.location.href }
      )
      if (url) {
        window.location.href = url
      } else {
        console.error('error creating biling session')
      }
    }
  }

  function openSupport() {
    window.$chatwoot.toggle()
  }

  return (
    <Grid container spacing={1} alignItems="center" justify="flex-end">
      <Grid item>
        {lgmq && (
          <Chip
            variant="outlined"
            color={userDetails.isVerified ? userDetails.color : 'default'}
            style={
              userDetails.isVerified ? {} : { color: theme.palette.error.main }
            }
            size="small"
            label={
              userDetails.isVerified ? (
                <span>Email Verified</span>
              ) : (
                <span>Email NOT Verified</span>
              )
            }
          />
        )}
      </Grid>
      <Grid item>
        {mdmq && (
          <Chip
            variant="outlined"
            color={userDetails.color}
            size="small"
            label={headerPlanMessage}
            onClick={createPortalSession}
          />
        )}
      </Grid>
      <Grid item>
        {lgmq && (
          <Typography variant="subtitle2">{userDetails.name}</Typography>
        )}
      </Grid>
      <Grid item>
        <IconButton
          aria-controls="profile-menu"
          aria-haspopup="true"
          color="inherit"
          onClick={showProfile}
        >
          <AccountCircleIcon />
        </IconButton>
        <Menu
          id="profile-menu"
          anchorEl={anchorEl}
          keepMounted
          open={Boolean(anchorEl)}
          onClose={() => setAnchorEl(null)}
        >
          <MenuItem onClick={loadProfile}>Profile</MenuItem>
          {mdmq ? null : <MenuItem onClick={openSupport}>Support</MenuItem>}
          <MenuItem onClick={createPortalSession}>
            {(Organizations.findOne() &&
              Organizations.findOne().planType !== 'free') ||
            Meteor.user().planType !== 'free'
              ? 'Billing'
              : 'Upgrade'}
          </MenuItem>
          {mdmq ? null : <MenuItem onClick={openSupport}>Support</MenuItem>}
          <MenuItem onClick={logout}>Logout</MenuItem>
        </Menu>
      </Grid>
    </Grid>
  )
}
