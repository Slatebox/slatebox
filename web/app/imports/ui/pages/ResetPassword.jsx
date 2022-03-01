import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import Avatar from '@material-ui/core/Avatar'
import LockOutlinedIcon from '@material-ui/icons/LockOutlined'
import Typography from '@material-ui/core/Typography'
import { makeStyles } from '@material-ui/core/styles'
import { useHistory, useParams, Link as RouterLink } from 'react-router-dom'
import Container from '@material-ui/core/Container'
import { useDispatch } from 'react-redux'
import Button from '@material-ui/core/Button'
import Grid from '@material-ui/core/Grid'
import TextField from '@material-ui/core/TextField'
import Link from '@material-ui/core/Link'
import CONSTANTS from '../../api/common/constants'
import promisify from '../../api/client/promisify'

const useStyles = makeStyles((theme) => ({
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
}))

export default function ResetPassword({ asEnroll }) {
  const classes = useStyles()
  const history = useHistory()
  const dispatch = useDispatch()
  const [password, setPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [resetPassword, setResetPassword] = React.useState(false)
  const { token } = useParams()

  if (Meteor.user() && !resetPassword) {
    history.push('/')
  }

  const reset = () => {
    if (password !== '' && password === confirmPassword) {
      Accounts.resetPassword(token, password, (err) => {
        if (err) {
          dispatch({
            type: 'canvas',
            globalMessage: {
              visible: true,
              text: `Oh Snap. There was a problem setting your password. Please contact support. (Error: ${err.reason})`,
              severity: 'error',
              autoHide: 60000,
            },
          })
        } else {
          setResetPassword(true)
          // dispatch({ type: "canvas", noDrawer: false });
          setTimeout(() => {
            history.push('/')
          }, 10000)
        }
      })
    }
  }

  const handlePassword = (e) => {
    setPassword(e.target.value)
  }

  const handleConfirm = (e) => {
    setConfirmPassword(e.target.value)
  }

  const [userAndOrg, setUserAndOrgNames] = React.useState(null)
  useEffect(() => {
    async function getOrgAndUser() {
      const uo = await promisify(
        Meteor.call,
        CONSTANTS.methods.users.extractUserAndOrgNamesByResetToken,
        token
      )
      if (!uo) {
        // bad token, go back to homepage
        dispatch({
          type: 'canvas',
          globalMessage: {
            visible: true,
            text: `That enroll token is invalid. Please contact your team's administrator.`,
            severity: 'error',
            autoHide: 60000,
          },
        })
        history.push('/')
      } else {
        setUserAndOrgNames(uo)
      }
    }
    getOrgAndUser()
  }, [])

  return (
    <Container component="main" maxWidth="xs">
      <div className={classes.paper}>
        <Avatar className={classes.avatar}>
          <LockOutlinedIcon />
        </Avatar>
        {!resetPassword && (
          <Grid
            container
            alignItems="center"
            justify="center"
            className={classes.form}
            spacing={2}
          >
            <Grid item xs={12}>
              <Typography component="h1" variant="h5" style={{ color: '#fff' }}>
                {asEnroll ? (
                  <>
                    Welcome{userAndOrg?.name ? ` ${userAndOrg.name}` : ''}! You
                    are invited to join the{' '}
                    <Typography component="span" variant="h5" color="secondary">
                      {userAndOrg?.orgName}
                    </Typography>{' '}
                    team. Please enter a password below.
                  </>
                ) : (
                  <>
                    Welcome{userAndOrg?.name ? ` ${userAndOrg?.name}` : ''}!
                    Reset your password below.
                  </>
                )}
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <TextField
                variant="outlined"
                required
                fullWidth
                name="password"
                label="Password"
                type="password"
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={handlePassword}
                autofocus
                error={password.length < 8}
                InputLabelProps={{
                  style: { color: '#fff' },
                }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                variant="outlined"
                required
                fullWidth
                name="confirm-password"
                label="Confirm Password"
                type="password"
                id="confirm-password"
                autoComplete="current-confirm-password"
                value={confirmPassword}
                onChange={handleConfirm}
                error={confirmPassword !== password}
                InputLabelProps={{
                  style: { color: '#fff' },
                }}
              />
            </Grid>
            <Grid item>
              <Button
                variant="outlined"
                color="secondary"
                onClick={reset}
                disabled={password !== confirmPassword}
              >
                {asEnroll ? <>Set Password</> : <>Reset Password</>} &amp; Login
              </Button>
            </Grid>
          </Grid>
        )}
        {resetPassword && (
          <Grid
            container
            alignItems="center"
            justify="center"
            className={classes.form}
            spacing={10}
          >
            <Grid item xs={12}>
              <Typography component="h1" variant="h5" style={{ color: '#fff' }}>
                {asEnroll ? (
                  <>
                    Hooray, you&apos;ve created a password and joined the{' '}
                    {userAndOrg?.orgName} team!
                  </>
                ) : (
                  <>Horray, password reset!</>
                )}
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <Typography
                component="h1"
                variant="subtitle1"
                style={{ color: '#fff' }}
              >
                {asEnroll ? (
                  <div />
                ) : (
                  <>
                    You&apos;re logged in! Redirecting to your dashboard in 10
                    seconds, or{' '}
                    <Link
                      component={RouterLink}
                      to="/"
                      style={{ color: '#fff' }}
                    >
                      go there now
                    </Link>
                    !
                  </>
                )}
              </Typography>
            </Grid>
          </Grid>
        )}
      </div>
    </Container>
  )
}

ResetPassword.propTypes = {
  asEnroll: PropTypes.bool.isRequired,
}
