/* eslint-disable consistent-return */
/* eslint-disable no-restricted-syntax */
/* eslint-disable react/jsx-no-useless-fragment */
/* eslint-disable no-underscore-dangle */
// Streamy is global, so no import needed
import React, { useRef, useEffect, useCallback, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { makeStyles } from '@material-ui/core/styles'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import cloneDeep from 'lodash.clonedeep'
import Grid from '@material-ui/core/Grid'
import DailyIframe from '@daily-co/daily-js'
import { DailyProvider } from '@daily-co/daily-react-hooks'
import CONSTANTS from '../../api/common/constants'
import { Collaborators, Collaboration } from '../../api/common/models'
import getUserName from '../../api/common/getUserName'
import promisify from '../../api/client/promisify'
import VideoParticipant from './VideoParticipant'

import Button from '@material-ui/core/Button'

const BASE_DAILY_URL = Meteor.settings.public.dailyBaseUrl

const useStyles = makeStyles((theme) => ({
  pinBottom: {
    bottom: '0',
    position: 'absolute',
  },
  liveVideoChat: {
    height: '150px',
    backgroundColor: 'transparent',
    borderTop: '1px solid black',
  },
  liveAudioChat: {
    height: '100px',
    backgroundColor: 'transparent',
    borderTop: '1px solid black',
  },
  pendingChat: {
    height: '60px',
    padding: '10px',
  },
  chatConstrained: {
    width: `calc(100% - 265px)`,
  },
}))

/* We decide what UI to show to users based on the state of the app, which is dependent on the state of the call object: see line 137. */
const STATE_IDLE = 'STATE_IDLE'
const STATE_CREATING = 'STATE_CREATING'
const STATE_JOINING = 'STATE_JOINING'
const STATE_JOINED = 'STATE_JOINED'
const STATE_LEAVING = 'STATE_LEAVING'
const STATE_ERROR = 'STATE_ERROR'

export default function CollaborationUsers({ slate }) {
  const collaborator = useSelector((state) => state.collaborator)
  const chatOpen = useSelector((state) => state.chatOpen)
  const huddleEnabled =
    useSelector((state) => state.huddleEnabled) || slate?.options.huddleEnabled
  const slateHuddleType =
    useSelector((state) => state.slateHuddleType) || slate?.options.huddleType
  const [callObject, setCallObject] = useState(null)
  const [appState, setAppState] = useState(STATE_IDLE)
  const classes = useStyles()
  const dispatch = useDispatch()

  const currentCollaborators = useTracker(() => [
    collaborator,
    ...Collaborators.find(
      { _id: { $ne: collaborator?._id } },
      { sort: { created: -1 } }
    ).fetch(),
  ])
  async function provisionRoom() {
    console.log('calling provision', slate?.shareId)
    if (slate) {
      const createRoom = await promisify(
        Meteor.call,
        CONSTANTS.methods.daily.createRoom,
        slate.shareId
      )
      console.log('room created?', createRoom)
      if (createRoom) {
        const callOpts = {
          dailyConfig: {
            experimentalChromeVideoMuteLightOff: true,
          },
        }
        if (slateHuddleType === 'audio') {
          callOpts.audioSource = true
          callOpts.videoSource = false
        }
        const newCallObject = DailyIframe.createCallObject(callOpts)
        setCallObject(newCallObject)
        setAppState(STATE_JOINING)
        const joinResult = await newCallObject.join({
          url: `${BASE_DAILY_URL}/${slate?.shareId}`,
          userName: collaborator._id,
        })
        /*
        {
          "local": {
            "session_id": "51942055-283f-4c60-a691-8fd49a83f08b",
            "user_name": "kdbjaFie66LDrHbEy",
            "user_id": "51942055-283f-4c60-a691-8fd49a83f08b",
            "joined_at": "2022-07-04T02:09:35.516Z",
            "local": true,
            "owner": false,
            "will_eject_at": "1970-01-01T00:00:00.000Z",
            "audio": false,
            "video": false,
            "screen": false,
            "tracks": {
              "audio": {
                "state": "off",
                "off": {
                  "byUser": true
                },
                "persistentTrack": null
              },
              "video": {
                "state": "off",
                "off": {
                  "byUser": true
                },
                "persistentTrack": null
              },
              "screenVideo": {
                "state": "off",
                "off": {
                  "byUser": true
                },
                "persistentTrack": null
              },
              "screenAudio": {
                "state": "off",
                "off": {
                  "byUser": true
                },
                "persistentTrack": null
              }
            },
            "cam_info": {},
            "screen_info": {},
            "record": false
          }
          */
        Collaborators.update(
          { _id: collaborator._id },
          { $set: { videoParticipantId: joinResult.local.session_id } }
        )
      }
    }
  }

  useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.collaborators, [slate?.shareId])
    // Collaborators.find({ shareId: slate?.shareId }).observe({
    //   removed: (doc) => {
    //     // ensure that the video doesn't persist when there are no collaborators
    //     console.log('collab removed', currentCollaborators.length)
    //     if (currentCollaborators.length <= 1) {
    //       callObject?.destroy().then(() => {
    //         setCallObject(null)
    //         setAppState(STATE_IDLE)
    //       })
    //     }
    //   },
    // })
  }, [slate?.shareId])

  useTracker(() => {
    if (slate?.shareId) {
      Meteor.subscribe(
        CONSTANTS.publications.collaboration,
        [slate?.shareId],
        [collaborator?.instanceId],
        new Date().valueOf()
      )

      // wires up collaboration
      Collaboration.find().observe({
        added(doc) {
          if (doc.instanceId !== collaborator?.instanceId) {
            // no need for this, as it's excluded in the query
            slate?.collab.invoke(doc)
          }
        },
      })
    }
  }, [slate?.shareId])

  useEffect(() => {
    if (!callObject) return

    const events = ['joined-meeting', 'left-meeting', 'error', 'camera-error']

    function handleNewMeetingState() {
      switch (callObject.meetingState()) {
        case 'joined-meeting':
          setAppState(STATE_JOINED)
          break
        case 'left-meeting':
          callObject.destroy().then(() => {
            setCallObject(null)
            setAppState(STATE_IDLE)
          })
          break
        case 'error':
          console.log('error with camera', callObject.meetingState())
          setAppState(STATE_ERROR)
          break
        default:
          break
      }
    }

    // Use initial state
    handleNewMeetingState()

    // Listen for changes in state
    for (const event of events) {
      /*
        We can't use the useDailyEvent hook (https://docs.daily.co/reference/daily-react-hooks/use-daily-event) for this
        because right now, we're not inside a <DailyProvider/> (https://docs.daily.co/reference/daily-react-hooks/daily-provider)
        context yet. We can't access the call object via daily-react-hooks just yet, but we will later in Call.js.
      */
      callObject.on(event, handleNewMeetingState)
    }

    // Stop listening for changes in state
    return function cleanup() {
      for (const event of events) {
        callObject.off(event, handleNewMeetingState)
      }
    }
  }, [callObject])

  useEffect(() => {
    if (huddleEnabled && slateHuddleType !== 'disabled') {
      provisionRoom()
    } else {
      console.log('destroy callObject')
      callObject?.destroy().then(() => {
        setCallObject(null)
        setAppState(STATE_IDLE)
        Collaborators.update(
          { _id: collaborator._id },
          { $unset: { videoParticipantId: true } }
        )
      })
    }
  }, [huddleEnabled, slateHuddleType])

  const cssClass =
    slateHuddleType === 'audio' ? classes.liveAudioChat : classes.liveVideoChat
  if (huddleEnabled && slateHuddleType !== 'disabled') {
    return (
      <DailyProvider callObject={callObject}>
        <Grid
          container
          spacing={2}
          className={`${classes.pinBottom} ${
            huddleEnabled && slateHuddleType ? cssClass : classes.pendingChat
          } ${chatOpen ? classes.chatConstrained : ''}`}
        >
          <>
            {currentCollaborators.map((c) => (
              <VideoParticipant
                collaborator={c}
                audioOnly={slateHuddleType === 'audio'}
              />
            ))}
          </>
        </Grid>
      </DailyProvider>
    )
  }
  return null
}
