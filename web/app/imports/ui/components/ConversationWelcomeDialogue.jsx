/* eslint-disable jsx-a11y/media-has-caption */
import React, { useRef, useEffect } from 'react'
import { Meteor } from 'meteor/meteor'
import { useSetAtom } from 'jotai'
import PropTypes from 'prop-types'
import { useTheme } from '@mui/material/styles'
import CONSTANTS from '../../api/common/constants'
import promisify from '../../api/client/promisify'
import confirmService from '../common/confirm'
import { huddleEnabled } from '../jotai/atoms'

function ConversationWelcomeDialogue({
  shareId,
  intentionId,
  personaId,
  prompt,
}) {
  // const audioRef = useRef(null)
  // const [audioDetails, setAudioDetails] = React.useState(null)
  const theme = useTheme()

  // async function explainDownload(message) {
  //   await confirmService.show({
  //     theme,
  //     title: message.title,
  //     message: message.body
  //       .replace(/{{audioUrl}}/gi, audioDetails.url)
  //       .replace(/{{slateId}}/gi, shareId),
  //     actionItems: [{ label: 'OK', return: true }],
  //   })
  // }

  useEffect(() => {
    async function loadWelcome() {
      // const ytAudioDetails = await Meteor.callAsync(
      //   CONSTANTS.methods.youtube.urlToAudio,
      //   {
      //     ytUrl: url,
      //     slateShareId: shareId,
      //   }
      // )
      const userWelcomeMessage = await Meteor.callAsync(
        CONSTANTS.methods.users.getConversationWelcome,
        {
          prompt,
          personaId,
          intentionId,
        }
      )
      // setAudioDetails(userWelcomeMessage)

      /*
       message: userWelcomeMessage.description
        .replace(/{{audioUrl}}/gi, ytAudioDetails.url)
        .replace(/{{slateId}}/gi, shareId),
      */

      if (userWelcomeMessage) {
        await confirmService.show({
          theme,
          title: userWelcomeMessage.title,
          message: userWelcomeMessage.description.replace(/{{idea}}/gi, prompt),
          actionItems: [{ label: 'OK', return: true }],
        })

        // explainDownload(audioDetails.message)
      }
    }
    loadWelcome()

    // const audio = audioRef.current
    // console.log('starting audio', audioSrc)

    // const handlePlaying = () => {
    //   console.log('audio is playing')
    // }

    // const handleEnded = () => {
    //   console.log('audio has ended')
    // }

    // if (audioDetails?.message) {
    //   explainDownload(audioDetails.message)
    // }

    // if (audio) {
    //   audio.addEventListener('playing', handlePlaying)
    //   audio.addEventListener('ended', handleEnded)

    //   // Cleanup event listeners on component unmount
    //   return () => {
    //     audio.removeEventListener('playing', handlePlaying)
    //     audio.removeEventListener('ended', handleEnded)
    //   }
    // }
  }, [])

  return null
  // (
  //   <>
  //     <audio ref={audioRef} src={audioDetails.url} autoPlay controls />
  //     <a href={audioUrl} target="_blank">
  //       right click to download
  //     </a>
  //   </>
  // )
}

ConversationWelcomeDialogue.propTypes = {
  shareId: PropTypes.string.isRequired,
  prompt: PropTypes.string.isRequired,
  intentionId: PropTypes.string.isRequired,
  personaId: PropTypes.string.isRequired,
}

export default ConversationWelcomeDialogue
