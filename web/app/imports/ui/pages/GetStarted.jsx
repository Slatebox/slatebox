import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTracker } from 'meteor/react-meteor-data'
import { Meteor } from 'meteor/meteor'
import { useSetAtom } from 'jotai'
import { Box, Button, Typography } from '@mui/material'
import CONSTANTS from '../../api/common/constants'
import createAnonymousUser from '../../api/client/createAnonymousUser'
import { initialPrompt, createSlateWithAIContent } from '../jotai/atoms'

export default function GetStarted() {
  const navigate = useNavigate()
  const setPrompt = useSetAtom(initialPrompt)
  const setAIContext = useSetAtom(createSlateWithAIContent)
  const loggingIn = useTracker(() => Meteor.loggingIn(), [])
  const creation = useRef(null)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (loggingIn) return undefined
    let active = true
    creation.current ||= (async () => {
      if (!Meteor.userId()) await createAnonymousUser()
      const shareId = await Meteor.callAsync(CONSTANTS.methods.slates.generateShareId)
      if (!shareId) throw new Error('Missing share ID')
      return shareId
    })()
    creation.current.then(shareId => {
      if (!active) return
      setPrompt('')
      setAIContext(null)
      navigate('/canvas/' + shareId, { replace: true })
    }).catch(() => { if (active) setError('Could not open the board. Try again.') })
    return () => { active = false }
  }, [loggingIn, navigate, retry, setPrompt, setAIContext])

  return <Box component="main" sx={{ minHeight: '100svh', bgcolor: 'background.default', color: 'text.primary', p: 3 }}>
    {error ? <><Typography role="alert">{error}</Typography><Button onClick={() => {
      creation.current = null
      setError('')
      setRetry(attempt => attempt + 1)
    }}>Try again</Button></> : <Typography role="status">Opening your slate…</Typography>}
  </Box>

}
