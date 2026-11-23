/* eslint-disable no-underscore-dangle */
import React, { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { Meteor } from 'meteor/meteor'
import Avatar from '@mui/material/Avatar'
import { useNavigate, useParams } from 'react-router-dom'
import Grid from '@mui/material/Grid2'
import { useTheme } from '@mui/material/styles'
import SvgIcon from '@mui/material/SvgIcon'
import Typography from '@mui/material/Typography'
import Container from '@mui/material/Container'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import CSSUnicorn from '../components/ai/Unicorn'
import createAnonymousUser from '../../api/client/createAnonymousUser'
import { aiSettingsIcon } from '../common/aiSettingsIcon'
import { initialPrompt } from '../jotai/atoms'
import CONSTANTS from '../../api/common/constants'

export default function AIPassthrough({
  referralCode = null,
  welcomeMessage,
  extendedPrompt,
  templateId,
  isEmbedded,
  intentionId,
}) {
  const theme = useTheme()
  const { prompt } = useParams()
  const setInitialPrompt = useSetAtom(initialPrompt)

  const history = useNavigate()

  async function createAISlate() {
    const shareId = await Meteor.callAsync(
      CONSTANTS.methods.slates.generateShareId
    )
    history(`/canvas/${shareId}`)
  }

  async function attempt() {
    setInitialPrompt(prompt)
    if (!Meteor.userId()) {
      try {
        await createAnonymousUser({ referralCode })
        await createAISlate()
      } catch (err) {
        console.error('Unable to conjure the unicorns, one moment', err)
        setTimeout(() => {
          attempt()
        }, 1000)
      }
    } else {
      await createAISlate()
    }
  }
  // already know it's authorized
  useEffect(() => {
    attempt()
  }, [])

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
        <Avatar
          sx={{
            margin: theme.spacing(1),
            backgroundColor: theme.palette.secondary.main,
          }}
        >
          <SvgIcon style={{ color: '#fff' }} viewBox="0 0 60 60">
            <path strokeWidth="1px" stroke="#fff" d={aiSettingsIcon} />
          </SvgIcon>
        </Avatar>
        <Typography component="h1" variant="h5" sx={{ color: '#fff' }}>
          One Moment!
        </Typography>
        <Grid container>
          <CSSUnicorn />
        </Grid>
      </Box>
    </Container>
  )
}

AIPassthrough.propTypes = {
  referralCode: PropTypes.string,
}
