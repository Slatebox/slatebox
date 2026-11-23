/* eslint-disable no-underscore-dangle */
/* eslint-disable react/forbid-prop-types */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import React, { useRef, useEffect, useCallback } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useAtomValue, useAtom, useSetAtom } from 'jotai'
import { useDaily, useAppMessage } from '@daily-co/daily-react'
import {
  createSlateWithAIContent,
  listeningForTranscriptionMessages,
  isAIActivelySpeaking,
  currentSlate,
  currentSlateAudioUrl,
  huddleEnabled,
  outstandingAIRequests,
} from '../../jotai/atoms'

import promisify from '../../../api/client/promisify'
import { Transcripts, Messages } from '../../../api/common/models'
import CONSTANTS from '../../../api/common/constants'
import getUserName from '../../../api/common/getUserName'

export default function AIAudioListener() {
  const callObject = useDaily() // Meteor.callObject // useDaily() //useAtom(callObj)
  // const localSpeaking = React.useRef(false);
  const slate = useAtomValue(currentSlate)
  const queuedMessages = React.useRef([])
  const queuedSentences = React.useRef([])
  const ticksBetween = React.useRef(0)
  const isListening = useAtomValue(listeningForTranscriptionMessages)
  const isSlateSpeaking = useAtomValue(isAIActivelySpeaking)
  const setOutstandingAIRequests = useSetAtom(outstandingAIRequests)

  // const [isActivelySpeaking, setIsActivelySpeaking] = useAtom(activelySpeaking);
  const isTranscribing = useTracker(
    () => Meteor.user()?.profile?.transcribeOnStart
  )
  const [currentAIContext, setCurrentAIContext] = useAtom(
    createSlateWithAIContent
  )

  const setHuddleEnabled = useSetAtom(huddleEnabled)
  const setSlateAudioURL = useSetAtom(currentSlateAudioUrl)

  useEffect(() => {
    let currentTimeoutId = null
    const batchSentences =
      currentAIContext?.isConversation?.sentenceBatchSize || 1
    async function speak() {
      ticksBetween.current += 1
      // console.log(
      //   'current ticks',
      //   isSlateSpeaking,
      //   ticksBetween,
      //   batchSentences,
      //   queuedMessages.current,
      //   queuedSentences.current
      // )
      if (!isSlateSpeaking && queuedMessages.current.length) {
        // localSpeaking.current = true;
        const fullConvo = queuedMessages.current.join(' ').trim()
        const firstSentenceTerminator = fullConvo.search(/\.|\?|!/gi)
        // console.log(
        //   'checking for terminator',
        //   batchSentences,
        //   fullConvo,
        //   firstSentenceTerminator
        // )
        // if (
        //   firstSentenceTerminator === -1 &&
        //   fullConvo.length > 0 &&
        //   ticksBetween.current >= 10
        // ) {
        //   firstSentenceTerminator = fullConvo.length
        // }
        if (firstSentenceTerminator > -1) {
          const sentenceToProcess = fullConvo
            .substring(0, firstSentenceTerminator + 1)
            .trim()
          queuedSentences.current.push(sentenceToProcess)

          const remainder = fullConvo.replace(sentenceToProcess, '').trim()
          // console.log(
          //   'queuedSentences.current.length',
          //   queuedSentences.current.length,
          //   'fullConvo:',
          //   fullConvo,
          //   'remainder:',
          //   remainder
          // )
          if (remainder.length > 0) {
            queuedMessages.current = [remainder]
          } else {
            queuedMessages.current = []
          }

          if (
            queuedSentences.current.length >= batchSentences //  ||  (queuedSentences.current.length >= 1 && ticksBetween.current >= 3
          ) {
            ticksBetween.current = 0
            const phraseToProcess = queuedSentences.current.join(' ')
            // console.log('sentenceToProcess', phraseToProcess, remainder)

            await Messages.insertAsync({
              author: getUserName(),
              timestamp: new Date().valueOf(),
              slateShareId: slate?.shareId,
              userId: Meteor.userId(),
              orgId: Meteor.user()?.orgId,
              text: phraseToProcess,
              type: CONSTANTS.messageTypes.chat,
            })

            // Transcripts.insert({
            //   slateShareId: slate?.shareId,
            //   userId: Meteor.userId(),
            //   orgId: Meteor.user()?.orgId,
            //   timestamp: Date.now(),
            //   message: phraseToProcess,
            //   userName: getUserName(),
            // })

            // send the conversation to openai
            setOutstandingAIRequests(true)
            const res = await Meteor.callAsync(CONSTANTS.methods.openai.chat, {
              content: [phraseToProcess],
              ...currentAIContext,
              type: CONSTANTS.ai.types.conversation,
              shareId: slate?.shareId,
            })
            if (res.abort) {
              setOutstandingAIRequests(false)
              if (
                currentAIContext?.isConversation ||
                Object.keys(currentAIContext ?? {}).filter((k) => k != null)
                  .length <= 1
              ) {
                setCurrentAIContext(null)
              }

              // stop transcription (if it is running)
              callObject.stopTranscription()

              // always disable the huddle
              setHuddleEnabled(false)

              setSlateAudioURL(null)
            }
            queuedSentences.current = []
          }

          // } else {
          //   queuedMessages.current = [queuedSentences.join(''), remainder]
          // }
        }
      }

      currentTimeoutId = setTimeout(async () => {
        speak()
      }, 2500) // Adjust interval time as needed
      // setIsActivelySpeaking(localSpeaking.current);
    }

    // kickoff
    speak()

    // Cleanup interval on unmount
    return () => clearTimeout(currentTimeoutId)
  }, [])

  useAppMessage({
    onAppMessage: useCallback(
      async (ev) => {
        if (
          isTranscribing &&
          isListening &&
          currentAIContext?.isConversation?.active
        ) {
          // console.log('received speech ev', ev.data)
          if (ev.fromId === 'transcription' && ev.data?.is_final) {
            queuedMessages.current.push(ev.data.text)
          }
        }
      },
      [callObject, isTranscribing, currentAIContext, isListening]
    ),
  })

  return null
}
