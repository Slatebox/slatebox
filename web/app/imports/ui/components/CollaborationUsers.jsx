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
import {
  DailyProvider,
  useDailyEvent,
  useDaily,
} from '@daily-co/daily-react-hooks'
import CONSTANTS from '../../api/common/constants'
import { Collaborators, Collaboration } from '../../api/common/models'
import getUserName from '../../api/common/getUserName'
import promisify from '../../api/client/promisify'
import VideoParticipant from './VideoParticipant'

const BASE_DAILY_URL = Meteor.settings.public.dailyBaseUrl

const useStyles = makeStyles((theme) => ({
  pinBottom: {
    bottom: '0',
    position: 'absolute',
    height: '150px',
    borderTop: '1px solid black',
    backgroundColor: '#ddd',
  },
  bubble: {
    width: '150px',
    height: '150px',
  },
  xlarge: {
    backgroundColor: theme.palette.secondary.main,
    border: `1px solid ${theme.palette.primary.main}`,
    width: theme.spacing(14),
    height: theme.spacing(14),
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
}))

export default function CollaborationUsers({ slate }) {
  const collaborator = useSelector((state) => state.collaborator)
  const [callObject, setCallObject] = useState(null)
  const classes = useStyles()
  const dispatch = useDispatch()
  const capacityIssue = useRef()

  const currentCollaborators = useTracker(() =>
    Collaborators.find({ _id: { $ne: collaborator?.instanceId } }).fetch()
  )
  const [currentParticipants, setParticipants] = React.useState([])

  // const handleDominantSpeaker = (speaker) => {
  //   setDominantSpeaker(speaker)
  // }

  // const handleTrackPublished = (trackPublication, participant) => {
  //   function displayTrack(track) {
  //     console.log('publishing track', track, participant)
  //     dispatch({
  //       type: `mediaChanged-${participant.collaborator.instanceId}`,
  //       track,
  //     })
  //   }

  //   // check if the trackPublication contains a `track` attribute. If it does,
  //   // we are subscribed to this track. If not, we are not subscribed.
  //   if (trackPublication.track) {
  //     displayTrack(trackPublication.track)
  //   }

  //   // listen for any new subscriptions to this track publication
  //   trackPublication.on('subscribed', displayTrack)
  // }

  // const participantConnected = (participant) => {
  //   console.log('adding participant', participant)
  //   setParticipants([...currentParticipants, participant])
  // }

  // const participantDisconnected = (participant) => {
  //   let newParticipants = cloneDeep(currentParticipants)
  //   newParticipants = newParticipants.filter(
  //     (p) => p.identity !== participant.identity
  //   )
  //   setParticipants(newParticipants)
  // }

  useDailyEvent(
    'joined-meeting',
    useCallback((participant) => {
      console.log('joined-meeting', participant)
      setParticipants([...currentParticipants, participant])
    }, [])
  )

  useDailyEvent(
    'left-meeting',
    useCallback((participant) => {
      console.log('left-meeting', participant)
      let newParticipants = cloneDeep(currentParticipants)
      newParticipants = newParticipants.filter(
        (p) => p.identity !== participant.identity
      )
      setParticipants(newParticipants)
      // Continue by updating your app UI to render the call UI
    }, [])
  )

  //   let newParticipants = cloneDeep(currentParticipants)
  //   newParticipants = newParticipants.filter(
  //     (p) => p.identity !== participant.identity
  //   )
  //   setParticipants(newParticipants)

  const getParticipant = (collaboratorId) => {
    const p = currentParticipants.find((p) => p.identity === collaboratorId)
    console.log('found participant', collaboratorId, p, currentParticipants)
    return p
  }

  async function provisionRoomAndAccessToken() {
    console.log('calling provision', slate?.shareId)
    if (slate) {
      const createRoom = await promisify(
        Meteor.call,
        CONSTANTS.methods.daily.createRoom,
        slate.shareId
      )
      console.log('room created?', createRoom)
      if (createRoom) {
        const newCallObject = DailyIframe.createCallObject()
        setCallObject(newCallObject)
        console.log('joining room ', `${BASE_DAILY_URL}/${slate?.shareId}`)
        newCallObject.join({ url: `${BASE_DAILY_URL}/${slate?.shareId}` })

        // const tokenOpts = {
        //   room: slate.shareId,
        //   userName: getUserName(Meteor.userId()),
        //   identity: collaborator._id,
        //   // local + remote collaborators
        //   validCollaborators: [
        //     collaborator._id,
        //     ...currentCollaborators.map((c) => c._id),
        //   ],
        // }
        // console.log('getting access token', tokenOpts)
        // try {
        //   accessToken = await promisify(
        //     Meteor.call,
        //     CONSTANTS.methods.twilio.generateAccessToken,
        //     tokenOpts
        //   )
        //   if (accessToken.error) {
        //     console.log(
        //       'too much capacity - current collaboratorId',
        //       collaborator._id,
        //       accessToken
        //     )
        //     capacityIssue.current = true
        //   } else {
        //     capacityIssue.current = false
        //     console.log('created access token', accessToken)
        //     const room = await Video.connect(accessToken, {
        //       room: slate.shareId,
        //       video: { width: 125, height: 125 },
        //     })
        //     console.log('created room', room)
        //     // room.on('dominantSpeakerChanged', handleDominantSpeaker)
        //     // room.localParticipant.on('trackPublished', (track) => {
        //     //   handleTrackPublished(track, room.localParticipant)
        //     // })
        //     room.on('participantConnected', participantConnected)
        //     room.on('participantDisconnected', participantDisconnected)
        //     participantConnected(room.localParticipant)
        //     room.participants.forEach(participantConnected)
        //   }
        // } catch (err) {
        //   console.log('current collaboratorId', collaborator._id)
        //   console.error(err)
        // }
        // clientRoom.participants.forEach((p) => {
        //   p.on('trackPublished', (track) => {
        //     handleTrackPublished(track, p)
        //   })
        // })
        console.log('set up all listeners')
      }
    }
  }

  useEffect(() => {
    provisionRoomAndAccessToken()
  }, [slate])

  // useEffect(() => {
  //   if (room) {
  //     room.on('dominantSpeakerChanged', handleDominantSpeaker)
  //     room.localParticipant.on('trackPublished', (track) => {
  //       handleTrackPublished(track, room.localParticipant)
  //     })
  //     room.on('participantConnected', participantConnected)
  //     room.on('participantDisconnected', participantDisconnected)
  //     room.participants.forEach((p) => {
  //       p.on('trackPublish', (track) => {
  //         handleTrackPublished(track, p)
  //       })
  //     })
  //     return () => {
  //       room.off('dominantSpeakerChanged', handleDominantSpeaker)
  //       room.localParticipant.off('trackPublished', (track) => {
  //         handleTrackPublished(track, null)
  //       })
  //     }
  //   }
  //   return null
  // }, [room])

  useTracker(() => {
    if (slate?.shareId) {
      Meteor.subscribe(CONSTANTS.publications.collaborators, [slate?.shareId])
      // wires hearbeat
      if (collaborator?.instanceId) {
        Collaborators.find({ _id: collaborator?.instanceId }).observe({
          added(doc) {
            if (doc.heartbeat === false) {
              Collaborators.update(
                { _id: collaborator?.instanceId },
                { $set: { heartbeat: true } }
              )
            }
            // const collab = copyCollaborators()
            // const ri = collab.findIndex((c) => c._id === doc._id)
            // if (ri === -1) {
            //   collab.push(doc)
            //   setCollaborators(collab)
            // }
          },
          changed: (doc) => {
            if (doc.heartbeat === false) {
              Collaborators.update(
                { _id: collaborator?.instanceId },
                { $set: { heartbeat: true } }
              )
            }
            // const collab = copyCollaborators()
            // const ri = collab.findIndex((c) => c._id === doc._id)
            // if (ri === -1) {
            //   currentCollaborators[ri] = doc
            //   setCollaborators(collab)
            // }
          },
        })
      }
      // retry logic
      Collaborators.find({ shareId: slate.shareId }).observe({
        removed: (doc) => {
          console.log(
            'removed collaborator...retry video',
            capacityIssue.current
          )
          provisionRoomAndAccessToken()
          // if (capacityIssue.current) {
          //   // try to connect again
          //   provisionRoomAndAccessToken()
          // }
        },
      })
    }
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

  return (
    <DailyProvider callObject={callObject}>
      {currentCollaborators.length > 0 ? (
        <Grid container spacing={2} className={classes.pinBottom}>
          <VideoParticipant
            participant={getParticipant(collaborator._id)}
            collaborator={collaborator}
            isLocal
          />
          {currentCollaborators.map((c) => (
            <VideoParticipant
              participant={getParticipant(c._id)}
              collaborator={c}
            />
          ))}
        </Grid>
      ) : null}
    </DailyProvider>
  )
}
