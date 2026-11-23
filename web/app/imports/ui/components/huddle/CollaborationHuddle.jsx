/* eslint-disable consistent-return */
/* eslint-disable no-restricted-syntax */
/* eslint-disable react/jsx-no-useless-fragment */
/* eslint-disable no-underscore-dangle */
import React, { useEffect, useCallback, useRef, useState } from 'react'
import { useAtomValue, useAtom, useSetAtom } from 'jotai'
import { createTheme, useTheme } from '@mui/material/styles'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Grid from '@mui/material/Grid2'
import Chip from '@mui/material/Chip'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Button from '@mui/material/Button'
import VideocamIcon from '@mui/icons-material/Videocam'
import { HuddleCalls } from '../../../api/common/models'
import CameraWarning from '../billing/CameraWarning'
import { usePayAction } from '../PayNotice'
import {
  DailyAudio,
  useActiveSpeakerId,
  useParticipantIds,
  useDaily,
} from '@daily-co/daily-react'
import CONSTANTS from '../../../api/common/constants'
import promisify from '../../../api/client/promisify'
import VideoParticipant from '../VideoParticipant'
import { Avatar } from '../AccountMenu'

import {
  slateHuddleType,
  huddleEnabled,
  isHuddlePropertiesOpen,
  listeningForTranscriptionMessages,
  collaborationUsers,
  canManageHuddleTranscription,
} from '../../jotai/atoms'

import HuddleProperties from '../HuddleProperties'
import { AgentChips, useAgentPresence } from '../AgentPresenceListener'


const theme = createTheme()

// The slate's people while this person is in a huddle (or has been): Daily's call, its participants and
// voices, and presence as before. It loads with the first huddle (HuddleIsland), never with the page.
export default function CollaborationHuddle({
  localCollaborator,
  slate,
}) {
  const theme = useTheme()
  const [isHuddleEnabled, setHuddleEnabled] = useAtom(huddleEnabled)
  const setCanTranscribe = useSetAtom(canManageHuddleTranscription)
  const [joinError, setJoinError] = useState('')
  const [notice, setNotice] = useState('')
  // A refusal's way on (Get Pro, top up) beside the message, and what runs again after (design §4.1).
  const [joinAction, setJoinAction] = useState(null)
  const [noticeAction, setNoticeAction] = useState(null)
  const payAction = usePayAction()
  const [cameraAsk, setCameraAsk] = useState(false)
  const wantsCamera = useRef(false)
  // after a top-up from the voice fallback: the camera on again in the same call
  function videoOnAgain(callId) {
    wantsCamera.current = true
    Meteor.callAsync(CONSTANTS.methods.daily.useVideo, { callId }).catch(error => setNotice(error.reason || 'Video is not available for this call.'))
  }
  const [joined, setJoined] = useState(null) // { callId, roomName }
  const slateHuddle = useAtomValue(slateHuddleType)
  // The open call on this slate: its mode, room and notices. Who pays is never sent here.
  const call = useTracker(() => {
    if (!slate?.shareId) return null
    Meteor.subscribe('meter.calls', slate.shareId)
    return HuddleCalls.findOne({ shareId: slate.shareId, state: 'open' })
  }, [slate?.shareId])
  const huddleType = call ? (call.mode === 'video' ? 'video' : 'audio') : slateHuddle
  const currentCollaborators = useAtomValue(collaborationUsers)
  // Agents saving to this slate: their own chips, never Huddle participants.
  const agents = useAgentPresence(slate?.shareId).shown
  const callObject = useDaily() // Meteor.callObject // useDaily() //useAtom(callObj)

  const [isListening, setListening] = useAtom(listeningForTranscriptionMessages)
  const isTranscribing = useTracker(
    () => Meteor.user()?.profile?.transcribeOnStart
  )

  const styles = {
    // At the foot of the canvas, above its zoom and quick-add row: clear of the "Ask Slatebox" panel
    // (beside the canvas from 1000px, under it below that) and of the bar under a narrow canvas. The
    // canvas page sets the two distances from the window's edges.
    pinBottom: {
      position: 'fixed',
      left: 0,
      right: 'var(--sb-canvas-right, 0px)',
      bottom: 'var(--sb-canvas-bottom, 0px)',
      width: 'auto',
      boxSizing: 'border-box',
      paddingLeft: '10px',
      marginBottom: huddleType === 'video' ? '100px' : '68px',
      // Over the canvas, only the people (and their controls) take the pointer: the strip's empty room
      // between and beside them leaves the notes under it to be held and dragged.
      pointerEvents: 'none',
      '& > *': { pointerEvents: 'auto' },
    },
    liveVideoChat: {
      height: '100px',
      paddingTop: '5px',
      borderTop: '1px solid black',
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
    liveAudioChat: {
      height: '90px',
      paddingTop: '5px',
      borderTop: '1px solid black',
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
    pendingChat: {
      height: '68px',
      borderTop: '1px solid black',
      paddingTop: '5px',
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
  }

  const [getHuddlePropertyDetails, setHuddlePropertyDetails] = useAtom(
    isHuddlePropertiesOpen
  )

  function endHuddle() {
    setCanTranscribe(false)
    if (isListening) {
      callObject?.stopTranscription()
    }
    callObject?.leave()
    if (joined?.callId) Meteor.callAsync(CONSTANTS.methods.daily.leave, { callId: joined.callId }).catch(() => {})
    setJoined(null)
    // callObject?.destroy().then(() => {
    // setCallObject(null)
    setListening(false)
    // const currentCollabs = [...currentCollaborators]
    // if (currentCollaborators.length > 0) {

    slate.collab.updateUserData({
      videoParticipantId: null,
    })
  }

  async function provisionAndJoinRoom() {
    if (slate) {
      const { url, token, canTranscribe, callId, starterNotice, starter, voiceFallback } = await Meteor.callAsync(CONSTANTS.methods.daily.join, { shareId: slate.shareId })
      const joinResult = await callObject.join({ url, token })
      setJoined({ callId, url, starter: Boolean(starter) })
      if (starterNotice) {
        setNotice(starterNotice)
        // video fell back to voice: a top-up turns it on, then the camera goes on again
        setNoticeAction(voiceFallback ? payAction({ code: 'video-stage', reason: starterNotice }, { from: 'call', retry: () => videoOnAgain(callId) }) : null)
      }
      setCanTranscribe(canTranscribe)

      // will notify all that the user has joined
      slate.collab?.updateUserData({
        videoParticipantId: joinResult?.local.session_id,
      })

      if (canTranscribe && isTranscribing && !isListening) {
        callObject.startTranscription({
          model: 'nova-2',
          endpointing: 1500,
          punctuate: true,
        })
        setListening(true)
      }
    }
  }

  useEffect(() => {
    if (isHuddleEnabled && callObject) {
      setJoinError('')
      provisionAndJoinRoom().catch((error) => {
        setHuddleEnabled(false)
        setJoinError(error.reason || 'The call could not be opened.')
        // no Pro, calls used up, a low balance: the pay sheet in place, then join again
        setJoinAction(payAction(error, { from: 'call', retry: () => setHuddleEnabled(true) }))
      })
    } else if (callObject && !isHuddleEnabled) {
      endHuddle()
    }
  }, [isHuddleEnabled, huddleType, callObject])

  // The call moved rooms (video ran out, or someone turned a camera on): follow it.
  useEffect(() => {
    if (!isHuddleEnabled || !callObject || !joined || !call || call._id !== joined.callId) return
    if (!call.roomName || joined.url?.endsWith('/' + call.roomName)) return
    const toVoice = call.mode === 'voice'
    ;(async () => {
      await callObject.leave()
      await provisionAndJoinRoom()
      if (toVoice) {
        setNotice('Video for this month is used up, so the call carries on as voice.')
        // the person who started the call (and pays for it) can top up for video
        setNoticeAction(joined.starter ? payAction({ code: 'video-stage', reason: 'Video for this month is used up.' }, { from: 'call', retry: () => videoOnAgain(joined.callId) }) : null)
      }
      else if (wantsCamera.current) callObject.setLocalVideo(true)
      wantsCamera.current = false
    })().catch(error => setJoinError(error.reason || 'The call could not be opened.'))
  }, [call?.roomName])

  // The call is about to end: say why, once.
  useEffect(() => {
    if (!isHuddleEnabled || !call?.warning) return
    setNotice(call.warning === 'alone'
      ? 'This call ends in 2 minutes because nobody else is here.'
      : `This call ends in 2 minutes. ${call.starterName}'s included calls for this month are used up.`)
    // the starter can top up to keep it going (the meter's next tick sees the balance)
    setNoticeAction(call.warning !== 'alone' && joined?.starter ? payAction({ code: 'calls-month', reason: 'Your included calls for this month are used up.' }, { from: 'call' }) : null)
  }, [call?.warning])

  // The call ended while this browser was in it.
  useEffect(() => {
    if (isHuddleEnabled && joined && !call) setHuddleEnabled(false)
  }, [Boolean(call)])

  const turnOnCamera = async () => {
    setCameraAsk(false)
    wantsCamera.current = true
    try {
      await Meteor.callAsync(CONSTANTS.methods.daily.useVideo, { callId: joined.callId })
    } catch (error) {
      setNotice(error.reason || 'Video is not available for this call.')
      // the starter's refusal (no Pro, video used up, a low balance): top up, then video on again
      setNoticeAction(payAction(error, { from: 'call', retry: () => turnOnCamera() }))
    }
  }

  const handlePlayFailed = useCallback((e) => {
    console.error(
      `Failed to play ${e.type} for ${e.sessionId}. Audio tag: ${e.target}.`
    )
  }, [])

  const activeSpeakerId = useActiveSpeakerId()

  const participantIds = useParticipantIds()

  const cssClass =
    huddleType === 'audio' ? styles.liveAudioChat : styles.liveVideoChat

  // always leave the huddle when CollaborationUsers is left
  useEffect(
    () => () => {
      endHuddle()
    },
    []
  )

  return (
    <>
      <Snackbar open={Boolean(notice)} autoHideDuration={noticeAction ? 30000 : 12000} onClose={() => { setNotice(''); setNoticeAction(null) }}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert severity="info" onClose={() => { setNotice(''); setNoticeAction(null) }}
          action={noticeAction && <Button color="inherit" size="small" onClick={() => { setNotice(''); setNoticeAction(null); noticeAction.run() }}>{noticeAction.label}</Button>}>{notice}</Alert>
      </Snackbar>
      <CameraWarning open={cameraAsk} starterName={call?.starterName} metered={Boolean(Meteor.settings.public.metered)} onConfirm={turnOnCamera} onCancel={() => setCameraAsk(false)} />
      <Snackbar open={Boolean(joinError)} autoHideDuration={joinAction ? 30000 : 10000} onClose={() => { setJoinError(''); setJoinAction(null) }}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert severity="warning" onClose={() => { setJoinError(''); setJoinAction(null) }}
          action={joinAction && <Button color="inherit" size="small" onClick={() => { setJoinError(''); setJoinAction(null); joinAction.run() }}>{joinAction.label}</Button>}>{joinError}</Alert>
      </Snackbar>
      {(currentCollaborators.length > 0 || isHuddleEnabled || agents.length > 0) && (
        <>
          <Grid
            container
            spacing={1}
            sx={{
              ...styles.pinBottom,
              ...(isHuddleEnabled && huddleType
                ? cssClass
                : styles.pendingChat),
            }}
            component="section"
            aria-label="Huddle"
          >
            {isHuddleEnabled
              ? participantIds.map((sessionId) => (
                  <VideoParticipant
                    key={sessionId}
                    sessionId={sessionId}
                    audioOnly={huddleType === 'audio'}
                    isActiveSpeaker={activeSpeakerId === sessionId}
                  />
                )).concat(huddleType === 'audio' && joined ? [
                  <Tooltip key="camera" title="Turn on your camera">
                    <IconButton aria-label="Turn on your camera" onClick={() => setCameraAsk(true)} color="inherit">
                      <VideocamIcon />
                    </IconButton>
                  </Tooltip>,
                ] : [])
              // One chip per person: you once, however many tabs you have open, then each other person.
              : [{ key: 'you', userName: 'You', color: localCollaborator?.color }, ...currentCollaborators].map((person) => (
                  <Chip key={person.key} label={person.userName}
                    avatar={<Avatar name={person.key === 'you' ? 'You' : person.userName} colour={person.color} size={24} />} />
                ))}
            <AgentChips records={agents} />
          </Grid>
          <DailyAudio onPlayFailed={handlePlayFailed} />
          <HuddleProperties
            slate={slate}
            open={getHuddlePropertyDetails.open}
            audioOnly={huddleType === 'audio'}
            huddleType={huddleType === 'audio' ? 'Audio' : 'Video'}
            onClose={(e) => {
              setHuddlePropertyDetails({ open: false })
            }}
          />
        </>
      )}
    </>
  )
}
