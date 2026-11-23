import React, { useEffect } from 'react'
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import Avatar from '@mui/material/Avatar'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom'
import Container from '@mui/material/Container'
import { useAtom } from 'jotai'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid2'
import Link from '@mui/material/Link'
import { Messages } from '../../api/common/models'
import CONSTANTS from '../../api/common/constants'
import { globalMessage, registrationDetails } from '../jotai/atoms'

export default function VerifyEmail() {
  const theme = useTheme()
  const history = useNavigate()
  const [verified, setVerified] = React.useState(false)
  const [warning, setWarning] = useAtom(globalMessage)
  const [getRegistrationDetails, setRegistrationDetails] =
    useAtom(registrationDetails)

  if (Meteor.user()) {
    history('/')
  }

  const { token } = useParams()

  async function dashboard() {
    setVerified(true)
  }

  useEffect(() => {
    Accounts.verifyEmail(token, async (err) => {
      if (Meteor.user() && Meteor.user().emails[0].verified) {
        await dashboard()
        await Messages.insertAsync({
          timestamp: new Date().valueOf(),
          userId: Meteor.userId(),
          title: 'Email Verified',
          text: `Hooray, you've verified your email!`,
          read: false,
          type: CONSTANTS.messageTypes.system,
          priority: 10,
        })
      } else if (err) {
        setWarning({
          visible: true,
          text: `Oh Snap. There was a problem verifying your email. (Error: ${err.reason})`,
          severity: 'error',
          autoHide: 60000,
        })
      } else {
        dashboard()
      }
    })
  }, [])

  const retry = () => {
    setRegistrationDetails({
      type: 'registration',
      registrationOpen: true,
      registrationTitle: `Retry Email Verification`,
      registrationMessage: `Please try verifying your email again.`,
    })
  }

  return (
    <Container component="main" maxWidth="xs">
      <Box
        sx={{
          marginTop: theme.spacing(8),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Avatar sx={{ m: 1, bgcolor: 'secondary.main' }}>
          <LockOutlinedIcon />
        </Avatar>
        {!verified && (
          <>
            <Typography component="h1" variant="h5" sx={{ color: '#fff' }}>
              {warning.visible ? (
                <>Unable to Verify Email</>
              ) : (
                <>Verifying Email...</>
              )}
            </Typography>
            <Box
              sx={{
                width: '100%',
                height: '250px',
                mt: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {warning.visible ? (
                <Button variant="outlined" color="secondary" onClick={retry}>
                  Try Verifying Again
                </Button>
              ) : (
                <CircularProgress color="secondary" />
              )}
            </Box>
          </>
        )}
        {verified && (
          <Grid
            container
            alignItems="center"
            justifyContent="center"
            spacing={10}
            sx={{ width: '100%', height: '250px', mt: 1 }}
          >
            <Grid size={12}>
              <Box m="auto">
                <Typography component="h1" variant="h5" sx={{ color: '#fff' }}>
                  Woohoo! Email Verified.
                </Typography>
              </Box>
            </Grid>
            <Grid size={12}>
              <Box m="auto">
                <Typography
                  component="div"
                  variant="subtitle1"
                  sx={{ color: '#fff', margin: 'auto' }}
                >
                  Congrats, you&apos;re verified! You can close this window and
                  go back to building your slate, or just{' '}
                  <Link component={RouterLink} sx={{ color: '#fff' }} to="/">
                    go to your dashboard
                  </Link>{' '}
                  and continue here.
                </Typography>
              </Box>
            </Grid>
          </Grid>
        )}
      </Box>
    </Container>
  )
}
