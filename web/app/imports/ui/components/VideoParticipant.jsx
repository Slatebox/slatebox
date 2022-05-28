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
  useLocalParticipant,
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
  xlarge: {
    backgroundColor: theme.palette.secondary.main,
    border: `1px solid ${theme.palette.primary.main}`,
    width: theme.spacing(14),
    height: theme.spacing(14),
  },
}))

export default function VideoParticipant({
  collaborator,
  participant,
  isLocal,
}) {
  const callObject = useDaily()
  console.log('callobj', callObject?.meetingState())
  const localParticipant = useLocalParticipant()
  const localVideo = useVideoTrack(localParticipant?.session_id)
  const localAudio = useAudioTrack(localParticipant?.session_id)
  const videoMuted = localVideo.isOff
  const audioMuted = localAudio.isOff
  const videoRef = React.useRef(null)
  const audioRef = React.useRef(null)

  const toggleVideo = useCallback(() => {
    console.log('setting local video', videoMuted)
    callObject.setLocalVideo(videoMuted)
    Collaborators.update({ _id: collaborator?._id }, { $set: { videoMuted } })
  }, [callObject, videoMuted])

  const toggleMic = useCallback(() => {
    callObject.setLocalAudio(audioMuted)
    Collaborators.update({ _id: collaborator?._id }, { $set: { audioMuted } })
  }, [callObject, audioMuted])

  console.log('sessionid ', localParticipant?.session_id)

  const videoTrack = useVideoTrack(localParticipant?.session_id)
  const audioTrack = useAudioTrack(localParticipant?.session_id)
  console.log('videoTrack is ', videoTrack.state, videoTrack)
  if (videoRef.current && videoTrack && videoTrack.state !== 'loading')
    videoRef.current.srcObject = videoTrack.track
  // if (audioRef.current && audioTrack && audioTrack.state !== 'loading')
  //   audioRef.current.srcObject = audioTrack

  const classes = useStyles()
  // const [micOn, setMic] = React.useState(collaborator?.micOn)
  // const [vidOn, setVid] = React.useState(collaborator?.vidOn)
  const [iconSize, setIconSize] = React.useState('medium')
  const [myIconSize, setMyIconSize] = React.useState('large')

  // const toggleVideo = async () => {
  //   setVid(!vidOn)
  //   console.log(
  //     'participant',
  //     participant,
  //     !vidOn,
  //     videoTracks[0],
  //     participant?.unpublishTrack,
  //     participant?.publishTrack
  //   )
  //   if (!vidOn) {
  //     videoTracks[0].detatch()
  //     //participant?.unpublishTrack(videoTracks[0])
  //   } else {
  //     videoTracks[0].attach(videoRef.current)
  //     // participant?.publishTrack(videoTracks[0])
  //   }
  //   Collaborators.update(
  //     { _id: collaborator?._id },
  //     { $set: { vidOn: !vidOn } }
  //   )
  // }

  // const toggleMic = () => {
  //   setMic(!micOn)
  //   if (!micOn) {
  //     participant?.unpublishTrack(audioTracks[0])
  //   } else {
  //     participant?.publishTrack(audioTracks[0])
  //   }
  //   Collaborators.update(
  //     { _id: collaborator?._id },
  //     { $set: { micOn: !micOn } }
  //   )
  // }

  // useEffect(() => {
  //   if (participant) {
  //     setVideoTracks(trackpubsToTracks(participant.videoTracks))
  //     setAudioTracks(trackpubsToTracks(participant.audioTracks))

  //     const trackSubscribed = (track) => {
  //       if (track.kind === 'video') {
  //         setVideoTracks((pVideoTracks) => [...pVideoTracks, track])
  //       } else if (track.kind === 'audio') {
  //         setAudioTracks((pAudioTracks) => [...pAudioTracks, track])
  //       }
  //     }

  //     const trackUnsubscribed = (track) => {
  //       if (track.kind === 'video') {
  //         setVideoTracks((pVideoTracks) =>
  //           pVideoTracks.filter((v) => v !== track)
  //         )
  //       } else if (track.kind === 'audio') {
  //         setAudioTracks((pAudioTracks) =>
  //           pAudioTracks.filter((a) => a !== track)
  //         )
  //       }
  //     }

  //     participant.on('trackSubscribed', trackSubscribed)
  //     participant.on('trackUnsubscribed', trackUnsubscribed)

  //     return () => {
  //       setVideoTracks([])
  //       setAudioTracks([])
  //       participant?.removeAllListeners()
  //     }
  //   }
  // }, [participant])

  // }

  // useEffect(() => {
  //   const videoTrack = videoTracks[0]
  //   if (videoTrack) {
  //     videoTrack.attach(videoRef.current)
  //     return () => {
  //       videoTrack?.detach()
  //     }
  //   }
  // }, [videoTracks])

  // useEffect(() => {
  //   const audioTrack = audioTracks[0]
  //   if (audioTrack) {
  //     audioTrack.attach(audioRef.current)
  //     return () => {
  //       audioTrack?.detach()
  //     }
  //   }
  // }, [audioTracks])

  return (
    <Grid item>
      <Avatar alt={collaborator?.instanceId} className={classes.xlarge}>
        {collaborator?.userName}
        <video ref={videoRef} autoPlay muted playsInline />
        <audio ref={audioRef} autoPlay muted playsInline />
      </Avatar>
      {isLocal ? (
        <Grid container justify="center">
          <Grid item className={classes.controlIcon}>
            <IconButton onClick={toggleMic}>
              {audioMuted ? (
                <MicIcon style={{ color: green[800] }} fontSize={myIconSize} />
              ) : (
                <MicOffIcon style={{ color: '#000' }} fontSize={myIconSize} />
              )}
            </IconButton>
          </Grid>
          <Grid item className={classes.controlIcon}>
            <IconButton onClick={toggleVideo}>
              {videoMuted ? (
                <VideocamIcon
                  style={{ color: green[800] }}
                  fontSize={myIconSize}
                />
              ) : (
                <VideocamOffIcon
                  style={{ color: '#000' }}
                  fontSize={myIconSize}
                />
              )}
            </IconButton>
          </Grid>
        </Grid>
      ) : (
        <Grid container spacing={2} justify="center">
          <Grid item className={classes.viewIcon}>
            <Avatar className={classes.viewIconBg}>
              {!collaborator?.audioMuted ? (
                <MicIcon style={{ color: green[800] }} fontSize={iconSize} />
              ) : (
                <MicOffIcon style={{ color: '#000' }} fontSize={iconSize} />
              )}
            </Avatar>
          </Grid>
          <Grid item className={classes.viewIcon}>
            <Avatar className={classes.viewIconBg}>
              {!collaborator?.videoMuted ? (
                <VideocamIcon
                  style={{ color: green[800] }}
                  fontSize={iconSize}
                />
              ) : (
                <VideocamOffIcon
                  style={{ color: '#000' }}
                  fontSize={iconSize}
                />
              )}
            </Avatar>
          </Grid>
        </Grid>
      )}
    </Grid>
  )
}
