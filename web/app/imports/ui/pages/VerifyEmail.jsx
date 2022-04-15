import React, { useEffect } from 'react'
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import Avatar from '@material-ui/core/Avatar'
import LockOutlinedIcon from '@material-ui/icons/LockOutlined'
import Typography from '@material-ui/core/Typography'
import { makeStyles } from '@material-ui/core/styles'
import { useHistory, useParams, Link as RouterLink } from 'react-router-dom'
import Container from '@material-ui/core/Container'
import { useSelector, useDispatch } from 'react-redux'
import Box from '@material-ui/core/Box'
import Button from '@material-ui/core/Button'
import CircularProgress from '@material-ui/core/CircularProgress'
import Grid from '@material-ui/core/Grid'
import Link from '@material-ui/core/Link'
import { Messages } from '../../api/common/models'
import CONSTANTS from '../../api/common/constants'

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

export default function VerifyEmail() {
  const classes = useStyles()
  const history = useHistory()
  const dispatch = useDispatch()
  const [verified, setVerified] = React.useState(false)
  const warning = useSelector((state) => state.globalMessage) || {
    visible: false,
  }
  // dispatch({ type: "canvas", noDrawer: true });

  if (Meteor.user()) {
    history.push('/')
  }

  const { token } = useParams()

  function dashboard() {
    // dispatch({ type: "canvas", noDrawer: false });
    setVerified(true)
  }

  useEffect(() => {
    Accounts.verifyEmail(token, (err) => {
      if (Meteor.user() && Meteor.user().emails[0].verified) {
        dashboard()
        Messages.insert({
          timestamp: new Date().valueOf(),
          userId: Meteor.userId(),
          title: 'Email Verified',
          text: `Hooray, you've verified your email!`,
          read: false,
          type: CONSTANTS.messageTypes.system,
          priority: 10,
        })
      } else if (err) {
        dispatch({
          type: 'canvas',
          globalMessage: {
            visible: true,
            text: `Oh Snap. There was a problem verifying your email. (Error: ${err.reason})`,
            severity: 'error',
            autoHide: 60000,
          },
        })
      } else {
        dashboard()
      }
    })
  }, [])

  const retry = () => {
    dispatch({
      type: 'registration',
      registrationOpen: true,
      registrationTitle: `Retry Email Verification`,
      registrationMessage: `Please try verifying your email again.`,
    })
  }

  return (
    <Container component="main" maxWidth="xs">
      <div className={classes.paper}>
        <Avatar className={classes.avatar}>
          <LockOutlinedIcon />
        </Avatar>
        {!verified && (
          <>
            <Typography component="h1" variant="h5" style={{ color: '#fff' }}>
              {warning.visible ? (
                <>Unable to Verify Email</>
              ) : (
                <>Verifying Email...</>
              )}
            </Typography>
            <Grid
              container
              alignItems="center"
              justify="center"
              className={classes.form}
            >
              {warning.visible ? (
                <Button variant="outlined" color="secondary" onClick={retry}>
                  Try Verifying Again
                </Button>
              ) : (
                <CircularProgress color="secondary" />
              )}
            </Grid>
          </>
        )}
        {verified && (
          <Grid
            container
            alignItems="center"
            justify="center"
            className={classes.form}
            spacing={10}
          >
            <Grid item xs={12}>
              <Box m="auto">
                <Typography
                  component="h1"
                  variant="h5"
                  style={{ color: '#fff' }}
                >
                  Woohoo! Email Verified.
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12}>
              <Box m="auto">
                <Typography
                  component="div"
                  variant="subtitle1"
                  style={{ color: '#fff', margin: 'auto' }}
                >
                  Congrats, you&apos;re verified! You can close this window and
                  go back to building your slate, or just{' '}
                  <Link component={RouterLink} style={{ color: '#fff' }} to="/">
                    go to your dashboard
                  </Link>{' '}
                  and continue here.
                </Typography>
              </Box>
            </Grid>
          </Grid>
        )}
      </div>
    </Container>
  )
}
