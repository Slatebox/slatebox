/* eslint-disable jsx-a11y/media-has-caption */
import React, { useRef, useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { isAIActivelySpeaking, currentSlateAudioUrl } from '../jotai/atoms'

function SlateAudioPlayer() {
  const audioRef = useRef(null)
  const setAIActivelySpeaking = useSetAtom(isAIActivelySpeaking)
  const audioSrc = useAtomValue(currentSlateAudioUrl)

  if (!audioSrc && audioRef.current) {
    audioRef.current?.pause()
    setAIActivelySpeaking(false)
  }

  useEffect(() => {
    const audio = audioRef.current
    // console.log('starting audio', audioSrc)

    const handlePlaying = () => {
      // console.log('audio is playing')
      setAIActivelySpeaking(true)
    }

    const handleEnded = () => {
      // console.log('audio has ended')
      setTimeout(() => {
        setAIActivelySpeaking(false)
      }, 500)
    }

    if (audio) {
      audio.addEventListener('playing', handlePlaying)
      audio.addEventListener('ended', handleEnded)

      // Cleanup event listeners on component unmount
      return () => {
        audio.removeEventListener('playing', handlePlaying)
        audio.removeEventListener('ended', handleEnded)
      }
    }
  }, [])

  return <audio ref={audioRef} src={audioSrc} autoPlay />
}

export default SlateAudioPlayer
