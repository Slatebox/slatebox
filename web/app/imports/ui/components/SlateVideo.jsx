/* eslint-disable react/jsx-no-useless-fragment */
/* eslint-disable no-unused-expressions */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  useParticipantIds,
  useVideoTrack,
  useScreenShare,
  useLocalParticipant,
  useDailyEvent,
} from '@daily-co/daily-react-hooks'

import VideoParticipant from './VideoParticipant'
import UserMediaError from './UserMediaError'

export default function SlateVideo() {
  /* If a participant runs into a getUserMedia() error, we need to warn them. */
  const [getUserMediaError, setGetUserMediaError] = useState(false)

  /* We can use the useDailyEvent() hook to listen for daily-js events. Here's a full list
   * of all events: https://docs.daily.co/reference/daily-js/events */
  useDailyEvent(
    'camera-error',
    useCallback((ev) => {
      setGetUserMediaError(true)
    }, [])
  )

  /* This is for displaying our self-view. */
  const localParticipant = useLocalParticipant()
  const localParticipantVideoTrack = useVideoTrack(localParticipant?.session_id)
  const localVideoElement = useRef(null)

  useEffect(() => {
    if (!localParticipantVideoTrack.persistentTrack) return
    localVideoElement?.current &&
      (localVideoElement.current.srcObject =
        localParticipantVideoTrack.persistentTrack &&
        new MediaStream([localParticipantVideoTrack?.persistentTrack]))
  }, [localParticipantVideoTrack.persistentTrack])

  /* This is for displaying remote participants: this includes other humans, but also screen shares. */
  const { screens } = useScreenShare()
  const remoteParticipantIds = useParticipantIds({ filter: 'remote' })

  const renderBottomVideoBar = () => (
    <>
      {remoteParticipantIds?.length > 0 ||
        (screens?.length > 0 && (
          <div className={`${screens.length > 0 ? 'is-screenshare' : 'call'}`}>
            {/* Your self view */}
            {localParticipant && (
              <div
                className={
                  remoteParticipantIds?.length > 0 || screens?.length > 0
                    ? 'self-view'
                    : 'self-view alone'
                }
              >
                <video autoPlay muted playsInline ref={localVideoElement} />
              </div>
            )}
            <>
              {remoteParticipantIds.map((id) => (
                <VideoParticipant key={id} id={id} />
              ))}
              {screens.map((screen) => (
                <VideoParticipant
                  key={screen.screenId}
                  id={screen.session_id}
                  isScreenShare
                />
              ))}
            </>
          </div>
        ))}
    </>
  )

  return <>{getUserMediaError ? <UserMediaError /> : renderBottomVideoBar()}</>
}
