import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useDispatch, useSelector } from 'react-redux'
import { useHistory } from 'react-router-dom'
import { useTracker } from 'meteor/react-meteor-data'
import { useTheme, useMediaQuery } from '@material-ui/core'
import Menu from '@material-ui/core/Menu'
import MenuItem from '@material-ui/core/MenuItem'
import IconButton from '@material-ui/core/IconButton'
import AccountCircleIcon from '@material-ui/icons/AccountCircle'
import Typography from '@material-ui/core/Typography'
import Chip from '@material-ui/core/Chip'
import Grid from '@material-ui/core/Grid'
import getUserName from '../../api/common/getUserName'

export default function ProfileMenu() {
  const theme = useTheme()
  const history = useHistory()
  const mdmq = useMediaQuery(theme.breakpoints.up('md'))
  const lgmq = useMediaQuery(theme.breakpoints.up('lg'))

  const userDetails = useTracker(() => {
    // get pricing data
    const color = 'secondary'
    if (Meteor.user()) {
      const name = getUserName(Meteor.userId())
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
      return { plan: 'team', name, color, isVerified }
    }
    return { plan: 'team', name: 'Guest', color, isVerified: false }
  })

  const headerPlanMessage = 'Team'
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

  const openSupport = () => {
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
          <MenuItem onClick={logout}>Logout</MenuItem>
        </Menu>
      </Grid>
    </Grid>
  )
}
