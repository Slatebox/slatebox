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
          title: 'Email verified',
          text: `Your email is verified.`,
          read: false,
          type: CONSTANTS.messageTypes.system,
          priority: 10,
        })
      } else if (err) {
        setWarning({
          visible: true,
          text: `We couldn’t verify your email: ${err.reason}`,
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
      registrationTitle: `Verify your email`,
      registrationMessage: `Send yourself a new verification link.`,
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
            <Typography component="h1" variant="h5" sx={{ color: 'text.primary' }}>
              {warning.visible ? (
                <>Your email could not be verified</>
              ) : (
                <>Verifying your email…</>
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
                  Try again
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
                <Typography component="h1" variant="h5" sx={{ color: 'text.primary' }}>
                  Your email is verified
                </Typography>
              </Box>
            </Grid>
            <Grid size={12}>
              <Box m="auto">
                <Typography
                  component="div"
                  variant="subtitle1"
                  sx={{ color: 'text.secondary', margin: 'auto' }}
                >
                  You can close this window and go back to your slate, or{' '}
                  <Link component={RouterLink} sx={{ color: 'text.primary' }} to="/">
                    open My slates
                  </Link>{' '}
                  here.
                </Typography>
              </Box>
            </Grid>
          </Grid>
        )}
      </Box>
    </Container>
  )
}
