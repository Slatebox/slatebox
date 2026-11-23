import React, { useEffect } from 'react'
import { Meteor } from 'meteor/meteor'
import { useSetAtom } from 'jotai'
import { useTracker } from 'meteor/react-meteor-data'
import Avatar from '@mui/material/Avatar'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { useNavigate, useParams } from 'react-router-dom'
import Container from '@mui/material/Container'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid2'
import CONSTANTS from '../../api/common/constants'
import promisify from '../../api/client/promisify'
import { globalMessage } from '../jotai/atoms'
import { recalledLoginReturn } from '../../api/common/login-return.mjs'

const useStyles = (theme) => ({
  paper: {
    marginTop: theme.spacing(8),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  avatar: {
    margin: theme.spacing(1),
    backgroundColor: theme.palette.secondary.main,
  },
  form: {
    width: '100%', // Fix IE 11 issue.
    height: '250px',
    marginTop: theme.spacing(1),
  },
  submit: {
    margin: theme.spacing(3, 0, 2),
  },
  register: {
    margin: theme.spacing(3, 0, 2),
  },
})

export default function LoginLink() {
  const classes = useStyles(useTheme())
  const history = useNavigate()
  const { token } = useParams()
  const setGlobalMessage = useSetAtom(globalMessage)

  useTracker(() => {
    if (Meteor.user() && !Meteor.user().isAnonymous) {
      // Back to the workshop room or app consent page the person signed in for (login-return.mjs).
      history(recalledLoginReturn(localStorage, Date.now()))
      setGlobalMessage({
        visible: true,
        text: `You're logged in! If you'd like to change your password, you can do so in your profile.`,
        severity: 'info',
        autoHide: 5000,
      })
    }
  }, [])

  async function attemptLogin() {
    const loginToken = await Meteor.callAsync(
      CONSTANTS.methods.users.attemptLoginWithLink,
      {
        token,
      }
    )
    if (loginToken) {
      Meteor.loginWithToken(loginToken)
    } else {
      Meteor.logout()
      history('/login')
      setGlobalMessage({
        visible: true,
        text: `Unable to log you in, that link is invalid`,
        severity: 'error',
        autoHide: 10000,
      })
    }
  }

  useEffect(() => {
    attemptLogin()
  }, [])

  return (
    <Container component="main" maxWidth="xs">
      <div className={classes.paper}>
        <Avatar className={classes.avatar}>
          <LockOutlinedIcon />
        </Avatar>
        <Typography component="h1" variant="h5" style={{ color: '#fff' }}>
          Attempting to log you in...
        </Typography>
        <Grid
          container
          alignItems="center"
          justifyContent="center"
          className={classes.form}
        >
          <CircularProgress color="secondary" />
        </Grid>
      </div>
    </Container>
  )
}
