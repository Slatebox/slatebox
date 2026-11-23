import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { useTracker } from 'meteor/react-meteor-data'
import Dialog from '@mui/material/Dialog'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Grid from '@mui/material/Grid2'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Switch from '@mui/material/Switch'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Typography from '@mui/material/Typography'
import Container from '@mui/material/Container'
import CloseIcon from '@mui/icons-material/Close'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import VideocamIcon from '@mui/icons-material/Videocam'
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import { green } from '@mui/material/colors'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  useLocalParticipant,
  useVideoTrack,
  useDevices,
  useDaily,
  useDailyEvent,
  DailyVideo,
  useAudioTrack,
} from '@daily-co/daily-react'
import CONSTANTS from '../../api/common/constants'
import SlideTransition from './SlideTransition'
import Pulse from '../common/Pulse'
import { callObj, globalMessage } from '../jotai/atoms'
import TabPanel from '../common/TabPanel'
import { Transcripts } from '../../api/common/models'
import TranscriptionText from './TranscriptionText'
import promisify from '../../api/client/promisify'

export default function HuddleProperties({
  slate,
  audioOnly,
  open,
  onClose,
  huddleType,
}) {
  const localParticipant = useLocalParticipant()

  const {
    microphones,
    speakers,
    cameras,
    setMicrophone,
    setCamera,
    setSpeaker,
  } = useDevices()
  // const { callObject } = Meteor // useDaily() // useAtom(callObj)
  const callObject = useDaily() // Meteor.callObject // useAtom(callObj) // useDaily()
  const [audioMutedOnStart, setAudioMutedOnStart] = React.useState(
    Meteor?.user()?.profile?.audioMutedOnStart
  )
  const [transcribeOnStart, setTranscriptionOnStart] = React.useState(
    Meteor?.user()?.profile?.transcribeOnStart
  )
  const videoTrack = useVideoTrack(localParticipant?.session_id)
  const audioTrack = useAudioTrack(localParticipant?.session_id)
  const videoMuted = videoTrack?.isOff
  const audioMuted = audioTrack?.isOff

  const [tabValue, setTabValue] = React.useState(0)
  const setGlobalMessage = useSetAtom(globalMessage)

  const handleUserSettingChange = async (prop, val) => {
    await Meteor.callAsync(CONSTANTS.methods.users.update, {
      [prop]: val,
      userId: Meteor.userId(),
    })
  }

  const changeTab = (event, newValue) => {
    setTabValue(newValue)
  }

  const toggleVideo = useCallback(() => {
    callObject.setLocalVideo(videoMuted)
  }, [callObject, videoMuted])

  const toggleAudio = useCallback(() => {
    callObject.setLocalAudio(audioMuted)
  }, [callObject, audioMuted])

  // console.log(
  //   'devices',
  //   localParticipant,
  //   microphones,
  //   speakers,
  //   cameras,
  //   callObject
  // )

  const deviceCount = React.useRef(
    microphones.length + speakers.length + cameras.length
  )
  let devicesHaveSettled = false
  const tot = microphones.length + speakers.length + cameras.length

  if (deviceCount.current > 0 && deviceCount.current === tot) {
    devicesHaveSettled = true
  } else {
    deviceCount.current = tot
  }

  const [selectedSpeaker, setSelectedSpeaker] = useState(
    speakers.length > 0 ? speakers[0].device.deviceId : 'default'
  )
  const [selectedMic, setSelectedMic] = useState(
    microphones.length > 0 ? microphones[0].device.deviceId : 'default'
  )
  const [selectedCam, setSelectedCam] = useState(
    cameras.length > 0 ? cameras[0].device.deviceId : 'default'
  )

  if (selectedCam === 'default' && cameras.length > 0) {
    setSelectedCam(cameras[0].device.deviceId)
  }

  // console.log(
  //   'selected',
  //   selectedSpeaker,
  //   selectedMic,
  //   selectedCam,
  //   cameras.length,
  //   cameras.find((s) => s.device.deviceId === 'default'),
  //   cameras.length > 0 ? cameras[0].device.deviceId : 'default'
  // )

  const [getUserMediaError, setGetUserMediaError] = useState(false)

  // useDailyEvent(
  //   'camera-error',
  //   useCallback(() => {
  //     setGetUserMediaError(true)
  //   }, [])
  // )

  const updateMicrophone = (e) => {
    setSelectedMic(e.target.value)
    setMicrophone(e.target.value)
  }

  const updateSpeakers = (e) => {
    setSelectedSpeaker(e.target.value)
    setSpeaker(e.target.value)
  }

  const updateCamera = (e) => {
    setSelectedCam(e.target.value)
    setCamera(e.target.value)
  }

  const handleClose = () => {
    onClose()
  }

  useEffect(() => {
    if (open) {
      if (!videoMuted) {
        callObject.setLocalVideo(true)
      }
      if (!audioMuted) {
        callObject.setLocalAudio(true)
      }
    }
  }, [])

  return (
    <Dialog
      fullScreen
      open={open && devicesHaveSettled}
      onClose={handleClose}
      TransitionComponent={SlideTransition}
      // PaperProps={{ style: { backgroundColor: '#333', opacity: 0.96 } }}
    >
      <AppBar sx={{ position: 'relative' }}>
        <Toolbar>
          <IconButton
            edge="start"
            sx={{ color: '#fff' }}
            onClick={handleClose}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
          <Typography
            variant="h6"
            sx={{
              marginLeft: (theme) => theme.spacing(2),
              flex: 1,
              color: '#fff',
            }}
          >
            Huddle Settings
          </Typography>
        </Toolbar>
      </AppBar>
      <Container
        component="main"
        maxWidth="lg"
        sx={{ marginTop: (theme) => theme.spacing(8) }}
      >
        <Box
          sx={{
            width: '90%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <Tabs
            value={tabValue}
            onChange={changeTab}
            indicatorColor="primary"
            textColor="primary"
            sx={{ mb: 2 }}
          >
            <Tab
              label={
                <Grid container spacing={1}>
                  <Grid>Manage Setup</Grid>
                </Grid>
              }
            />
            <Tab
              label={
                <Grid container spacing={1}>
                  {transcribeOnStart ? (
                    <>
                      <Grid>
                        <Pulse>&nbsp;</Pulse>
                      </Grid>
                      <Grid style={{ marginTop: '3px;' }}>
                        Live Transcription (on)
                      </Grid>
                    </>
                  ) : (
                    <Grid>Live Transcription (off)</Grid>
                  )}
                </Grid>
              }
            />
          </Tabs>
          <TabPanel value={tabValue} index={0}>
            <Grid container spacing={3} alignItems="center">
              <Grid size={12}>
                <Typography variant="h5">
                  Manage Your LIVE {huddleType} Huddle Settings Below
                </Typography>
              </Grid>
              <Grid size={12}>
                {/* Video preview */}
                {localParticipant && !audioOnly && (
                  <DailyVideo
                    sessionId={localParticipant.session_id}
                    mirror
                    style={{
                      width: '400px',
                      height: '250px',
                      border: '1px solid #fff',
                    }}
                  />
                )}
              </Grid>
              <Grid size={3}>
                <Typography variant="overline" color="secondary">
                  Microphone:
                </Typography>
                <IconButton onClick={toggleAudio}>
                  {audioMuted ? (
                    <MicOffIcon fontSize="large" />
                  ) : (
                    <MicIcon style={{ color: green[600] }} />
                  )}
                </IconButton>
              </Grid>
              <Grid size={9}>
                {/* Microphone select */}
                <Select
                  variant="outlined"
                  placeholder="Select Microphone"
                  labelId="mic-select-label"
                  id="mic-select"
                  value={selectedMic}
                  onChange={updateMicrophone}
                  label="Microphones"
                >
                  {microphones?.map((mic) => [
                    <MenuItem
                      key={`mic-${mic.device.deviceId}`}
                      value={mic.device.deviceId}
                    >
                      {mic.device.label}
                    </MenuItem>,
                  ])}
                </Select>
              </Grid>
              <Grid size={3}>
                <Typography variant="overline" color="secondary">
                  Speaker:
                </Typography>
              </Grid>
              <Grid size={9}>
                {/* Speakers select */}
                <Select
                  labelId="speaker-select-label"
                  variant="outlined"
                  placeholder="Select Speaker"
                  id="speaker-select"
                  value={selectedSpeaker}
                  onChange={updateSpeakers}
                  label="Speakers"
                >
                  {speakers?.map((speaker) => [
                    <MenuItem
                      key={`speaker-${speaker.device.deviceId}`}
                      value={speaker.device.deviceId}
                    >
                      {speaker.device.label}
                    </MenuItem>,
                  ])}
                </Select>
              </Grid>
              <Grid size={3}>
                <Typography variant="overline" color="secondary">
                  Mute Audio On Start:
                </Typography>
              </Grid>
              <Grid size={9}>
                <Tooltip
                  title="Start muted"
                  placement="top"
                  aria-label="startMuted"
                >
                  <Switch
                    onChange={(e) => {
                      setAudioMutedOnStart(e.target.checked)
                      handleUserSettingChange(
                        'audioMutedOnStart',
                        e.target.checked
                      )
                    }}
                    checked={audioMutedOnStart}
                  />
                </Tooltip>
              </Grid>
              <Grid size={3}>
                <Typography variant="overline" color="secondary">
                  Enable transcription on start:
                </Typography>
              </Grid>
              <Grid size={9}>
                <Tooltip
                  title="Enable transcription when audio starts"
                  placement="top"
                  aria-label="startMuted"
                >
                  <Switch
                    onChange={(e) => {
                      setTranscriptionOnStart(e.target.checked)
                      handleUserSettingChange(
                        'transcribeOnStart',
                        e.target.checked
                      )
                    }}
                    checked={transcribeOnStart}
                  />
                </Tooltip>
              </Grid>
              <Grid size={2}>
                {!audioOnly && (
                  <Typography variant="overline" color="secondary">
                    Camera:
                  </Typography>
                )}
              </Grid>
              {!audioOnly && (
                <>
                  <Grid size={2}>
                    <IconButton onClick={toggleVideo}>
                      {videoMuted ? (
                        <VideocamOffIcon
                          style={{ color: '#000' }}
                          fontSize="large"
                        />
                      ) : (
                        <VideocamIcon
                          style={{ color: green[800] }}
                          fontSize="large"
                        />
                      )}
                    </IconButton>
                  </Grid>
                  <Grid>
                    {/* Camera select */}

                    <Select
                      variant="outlined"
                      placeholder="Select Camera"
                      labelId="mic-select-label"
                      id="mic-select"
                      value={selectedCam}
                      onChange={updateCamera}
                      label="Cameras"
                    >
                      {cameras?.map((camera) => [
                        <MenuItem
                          key={`cam-${camera.device.deviceId}`}
                          value={camera.device.deviceId}
                        >
                          {camera.device.label}
                        </MenuItem>,
                      ])}
                    </Select>
                  </Grid>
                </>
              )}
            </Grid>
          </TabPanel>
          <TabPanel value={tabValue} index={1}>
            <Grid container spacing={3} alignItems="center">
              <Grid size={12}>
                {callObject && slate && (
                  <TranscriptionText slateShareId={slate?.shareId} />
                )}
              </Grid>
            </Grid>
          </TabPanel>
        </Box>
        <Grid
          container
          spacing={3}
          style={{ marginTop: '10px' }}
          alignItems="center"
        >
          <Grid size={8}>
            <Box display="flex" justifyContent="flex-end">
              <Button
                color="secondary"
                variant="outlined"
                size="large"
                onClick={handleClose}
              >
                Done
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Container>
    </Dialog>
  )
}
