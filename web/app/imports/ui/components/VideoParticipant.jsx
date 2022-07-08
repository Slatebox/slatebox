/* eslint-disable no-unused-expressions */
/* eslint-disable no-underscore-dangle */
import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useSelector } from 'react-redux'
import { makeStyles } from '@material-ui/core/styles'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import {
  useDaily,
  useAudioTrack,
  useVideoTrack,
  useMediaTrack,
  useDailyEvent,
  useParticipant,
  useLocalParticipant,
  useParticipantIds,
} from '@daily-co/daily-react-hooks'
import Grid from '@material-ui/core/Grid'
import Avatar from '@material-ui/core/Avatar'
import MicIcon from '@material-ui/icons/Mic'
import MicOffIcon from '@material-ui/icons/MicOff'
import VideocamIcon from '@material-ui/icons/Videocam'
import VideocamOffIcon from '@material-ui/icons/VideocamOff'
import { IconButton } from '@material-ui/core'
import { green } from '@material-ui/core/colors'
import { Collaborators } from '../../api/common/models'

const useStyles = makeStyles((theme) => ({
  videoAvatar: {
    backgroundColor: theme.palette.secondary.main,
    border: `1px solid ${theme.palette.primary.main}`,
    width: theme.spacing(14),
    height: theme.spacing(14),
  },
  audioAvatar: {
    backgroundColor: theme.palette.secondary.main,
    border: `1px solid ${theme.palette.primary.main}`,
    width: theme.spacing(7),
    height: theme.spacing(7),
  },
  videoSize: {
    width: theme.spacing(25),
    height: theme.spacing(25),
  },
  controlIcon: {
    marginTop: '-28px',
    '& .MuiSvgIcon-root': { color: '#000' },
  },
  viewIcon: {
    marginTop: '-10px',
    '& .MuiSvgIcon-root': { color: '#000' },
    zIndex: '999',
  },
  viewIconBg: {
    backgroundColor: '#fff',
    width: theme.spacing(3),
    height: theme.spacing(3),
  },
  controlIconBg: {
    backgroundColor: '#fff',
    width: theme.spacing(3),
    height: theme.spacing(3),
  },
  '@keyframes ripple': {
    '0%': {
      boxShadow: `0 0 0 0rem rgba($ripple-color, 0.2),
        0 0 0 1rem rgba($ripple-color, 0.2),
        0 0 0 2rem rgba($ripple-color, 0.2),
        0 0 0 5rem rgba($ripple-color, 0.2)`,
    },
    '100%': {
      boxShadow: `0 0 0 1rem rgba($rippleC-color, 0.2),
        0 0 0 2rem rgba($ripple-color, 0.2),
        0 0 0 5rem rgba($ripple-color, 0.2),
        0 0 0 8rem rgba($ripple-color, 0)`,
    },
  },
  dot: {
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: '3.5rem',
    backgroundColor: '#2E2E2E',
    borderRadius: '50px',
    animation: '$ripple 2s linear infinite',
  },
}))

export default function VideoParticipant({ collaborator, audioOnly }) {
  const callObject = useDaily()
  const collab = useSelector((state) => state.collaborator)
  const isLocal = collab?._id === collaborator?._id
  const videoParticipant = isLocal
    ? useLocalParticipant()
    : useParticipant(collaborator?.videoParticipantId)
  const audioTrack = useAudioTrack(videoParticipant?.session_id)
  const videoTrack = useVideoTrack(videoParticipant?.session_id)
  const videoRef = React.useRef(null)
  const audioRef = React.useRef(null)
  const videoMuted = videoTrack.isOff
  const audioMuted = audioTrack.isOff

  useDailyEvent(
    'camera-error',
    useCallback(() => {
      console.log('camera error vp page')
    }, [])
  )

  const toggleVideo = useCallback(() => {
    console.log('setting local video', videoMuted)
    callObject.setLocalVideo(videoMuted)
    setTimeout(() => {
      console.log('videoTrack state', videoTrack)
      if (videoMuted) {
        console.log('shut off and on again...')
        if (videoTrack.state === 'off') {
          console.log('shut localVideo off')
          callObject.setLocalVideo(false)
          setTimeout(() => {
            console.log('turned localVideo back on')
            callObject.setLocalVideo(true)
          }, 500)
        }
      } else {
        console.log('rebinding video')
        bindVideoPersistentTrack()
      }
    }, 1000)
    // Collaborators.update({ _id: collaborator?._id }, { $set: { videoMuted } })
  }, [callObject, videoMuted])

  const bindVideoPersistentTrack = function () {
    console.log('video persistentTrack', videoTrack)
    if (!videoTrack.persistentTrack) return
    videoRef?.current &&
      (videoRef.current.srcObject =
        videoTrack.persistentTrack &&
        new MediaStream([videoTrack?.persistentTrack]))
  }

  const toggleMic = useCallback(() => {
    console.log('setting local audio', audioMuted)
    callObject.setLocalAudio(audioMuted)
    // Collaborators.update({ _id: collaborator?._id }, { $set: { audioMuted } })
  }, [callObject, audioMuted])

  useEffect(() => {
    bindVideoPersistentTrack()
  }, [videoTrack.persistentTrack])

  useEffect(() => {
    console.log('audio persistentTrack', audioTrack.persistentTrack)
    if (!audioTrack.persistentTrack) return
    audioRef?.current &&
      (audioRef.current.srcObject =
        audioTrack.persistentTrack &&
        new MediaStream([audioTrack?.persistentTrack]))
  }, [audioTrack.persistentTrack])

  const classes = useStyles()
  const iconSize = isLocal ? 'large' : 'medium'

  useParticipantIds({
    onActiveSpeakerChange: (as) => {
      console.log('active speaker changes', as)
    },
  })

  return (
    <Grid item>
      <Avatar
        alt={collaborator?.instanceId}
        className={audioOnly ? classes.audioAvatar : classes.videoAvatar}
      >
        {collaborator?.userName}
        {!audioOnly && (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ display: videoMuted ? 'none' : 'block' }}
            className={classes.videoSize}
          />
        )}
        <audio ref={audioRef} autoPlay muted playsInline />
      </Avatar>
      <Grid container justify="center">
        <Grid item className={isLocal ? classes.controlIcon : classes.viewIcon}>
          {isLocal ? (
            <IconButton onClick={toggleMic}>
              {audioMuted ? (
                <MicOffIcon style={{ color: '#000' }} fontSize={iconSize} />
              ) : (
                <MicIcon style={{ color: green[800] }} fontSize={iconSize} />
              )}
            </IconButton>
          ) : (
            <Avatar className={classes.viewIconBg}>
              {audioMuted ? (
                <MicOffIcon style={{ color: '#000' }} fontSize={iconSize} />
              ) : (
                <MicIcon style={{ color: green[800] }} fontSize={iconSize} />
              )}
            </Avatar>
          )}
        </Grid>
        {!audioOnly && (
          <Grid
            item
            className={isLocal ? classes.controlIcon : classes.viewIcon}
          >
            {isLocal ? (
              <IconButton onClick={toggleVideo}>
                {videoMuted ? (
                  <VideocamOffIcon
                    style={{ color: '#000' }}
                    fontSize={iconSize}
                  />
                ) : (
                  <VideocamIcon
                    style={{ color: green[800] }}
                    fontSize={iconSize}
                  />
                )}
              </IconButton>
            ) : (
              <Avatar className={classes.viewIconBg}>
                {videoMuted ? (
                  <VideocamOffIcon
                    style={{ color: '#000' }}
                    fontSize={iconSize}
                  />
                ) : (
                  <VideocamIcon
                    style={{ color: green[800] }}
                    fontSize={iconSize}
                  />
                )}
              </Avatar>
            )}
          </Grid>
        )}
      </Grid>
    </Grid>
  )
}
