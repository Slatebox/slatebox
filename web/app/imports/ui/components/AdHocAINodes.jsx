/* eslint-disable react/forbid-prop-types */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
// @ts-nocheck
import { Meteor } from 'meteor/meteor'
import { useAtom, useSetAtom } from 'jotai'
import { forwardRef, useImperativeHandle, useEffect } from 'react'
import PropTypes from 'prop-types'
import { Slatebox } from 'slateboxjs'

import slateProps from '../propTypes/slateProps'
import CONSTANTS from '../../api/common/constants'
import initAIConversation from '../../api/common/initAIConversation'
import { adhocKind } from '../../api/common/adhoc-kind.mjs'
import { imageFromGeneration } from '../../api/common/note-style.mjs'
import { usePayAction } from './PayNotice'

import {
  createSlateWithAIContent,
  conversationOpen,
  globalMessage,
  outstandingAIRequests,
} from '../jotai/atoms'

const AdHocAINodes = forwardRef(({ slate, collaborator }, ref) => {
  const [currentAIContext, setAIContext] = useAtom(createSlateWithAIContent)
  const setChatOpen = useSetAtom(conversationOpen)
  const setGlobalMessage = useSetAtom(globalMessage)
  // a refusal by the meter offers its way on (Get Pro, top up) and runs this again after
  const payAction = usePayAction()
  const [areAIRequestsOutstanding, setOutstandingAIRequests] = useAtom(
    outstandingAIRequests
  )

  const potentiallySetAIContext = async (aiContext) => {
    if (!currentAIContext?.aid && aiContext?.aid) {
      setAIContext(aiContext) // this causes other components to update, but not Canvas.jsx
      // setLocalAIContext(entireAIContext) // the jotai use above does not update on Canvas.jsx - so this is a hack
      setChatOpen(aiContext.openChat)
    }
  }

  const adhocAINodes = async (pkgs) => {
    const aiData = pkgs[0].data
    const node = slate.nodes.one(aiData.id)
    const parentIds =
      node.relationships.associations?.map((a) => a.parent.options.id) || []
    const parentNode =
      parentIds.length > 0 ? slate.nodes.one(parentIds[0]) : null
    const detailAddOn =
      (aiData.ai.textToChildNodes?.length && aiData.ai.isDetailedChild) ||
      (aiData.ai.generateSimilar && aiData.ai.isDetailedSimilar)
        ? 'Be detailed and compelling in your response. Use between 20-30 words to convey this thought.'
        : 'Keep responses to 10 words or less'
    let prompt = ``

    const nodeText = node?.options?.text.replace(/\n/gi, ' ').trim()
    const parentText = parentNode?.options?.text.replace(/\n/gi, ' ').trim()

    if (aiData.ai.textToImage?.length) {
      setOutstandingAIRequests(true)
      prompt = `${aiData.ai.textToImage}`
      try {
        const res = await Meteor.callAsync(
          CONSTANTS.methods.stabilityai.generate,
          {
            prompts: [prompt],
            slateShareId: slate.shareId,
          }
        )
        if (res[0]?.error) {
          setGlobalMessage({
            visible: false,
            text: ``,
          })
          setTimeout(() => {
            setGlobalMessage({
              visible: true,
              text: `Error generating image: ${res[0].message}. Please check your prompt and try again.`,
              severity: 'error',
              autoHide: 10000,
            })
          }, 100)
        }
        // An error answer (out of credit, refused) is said above and never set as the picture.
        const img = imageFromGeneration(res)
        if (img) {
          slate?.collab.exe({
            type: 'onNodeImageChanged',
            data: {
              id: node.options.id,
              instanceId: collaborator.instanceId,
              img,
              w: 512,
              h: 512,
            },
          })
        }
      } catch (err) {
        // Out of credit or no Pro is not the prompt's fault: the meter's own words, with its action.
        const paid = payAction(err, { from: 'image', retry: () => adhocAINodes(pkgs) })
        setGlobalMessage({
          visible: true,
          text: paid ? err.reason : `Error generating image: ${err.reason || err.message}. Please check your prompt and try again.`,
          severity: paid ? 'warning' : 'error',
          autoHide: paid ? 30000 : 10000,
          ...(paid && { action: paid }),
        })
        console.log('unable to create image for node', err)
      } finally {
        setOutstandingAIRequests(false)
      }
    } else if (aiData.ai.tone || aiData.ai.shrink || aiData.ai.grow) {
      const currentWordCount = nodeText.split(' ').length
      let newLineBreaks = Math.ceil(currentWordCount / 4)
      let useWordCount = currentWordCount
      if (aiData.ai.shrink) {
        useWordCount = Math.ceil(currentWordCount - currentWordCount * 0.2)
      } else if (aiData.ai.grow) {
        const multiplier = currentWordCount < 20 ? 0.4 : 0.2
        useWordCount = Math.ceil(
          currentWordCount + currentWordCount * multiplier
        )
      }

      if (aiData.ai.tone) {
        prompt = `Rewrite this text in a ${aiData.ai.tone} tone: "${nodeText}". Use the same number of words. Send the text back in JSON: { text: 'Rewritten text...' }`
      } else if (aiData.ai.shrink) {
        prompt = `Make this text more concise using around ${useWordCount} words total: "${nodeText}" Send the text back in JSON: { text: 'Shorter text...' }`
        newLineBreaks -= 1
      } else if (aiData.ai.grow) {
        prompt = `Expand on this text using around ${useWordCount} words total: "${nodeText}" Send the text back in JSON: { text: 'Longer text...' }`
        newLineBreaks += 1
      }
      setOutstandingAIRequests(true)
      const aiOpts = {
        content: prompt.replace(/\n/, ' ').trim(),
        processImmediately: true,
        aid: currentAIContext.aid,
        shareId: slate?.shareId,
        maxSize: aiData.ai.shrink || aiData.ai.grow ? useWordCount : null,
      }
      // console.log('getting immediate feedback', aiOpts)
      try {
        const textResults = await Meteor.callAsync(
          CONSTANTS.methods.openai.chat,
          aiOpts
        )
        // console.log('textResults', newLineBreaks, textResults)
        slate?.collab.exe({
          type: 'onNodeTextChanged',
          data: {
            id: node.options.id,
            instanceId: collaborator.instanceId,
            text: Slatebox.utils
              .createMultiLineText(textResults?.json?.text, newLineBreaks)
              .trim(),
          },
        })
        setOutstandingAIRequests(false)
      } catch (err) {
        setGlobalMessage({
          visible: false,
          text: ``,
          severity: 'info',
        })
        setTimeout(() => {
          setGlobalMessage({
            visible: true,
            text: `Error generating text: ${err.message}. Please try again.`,
            severity: 'error',
            autoHide: 10000,
          })
        }, 100)
      }
    } else {
      if (aiData.ai.textToChildNodes?.length) {
        if (parentNode) {
          prompt = `Given the idea of "${parentText}" begetting this idea "${nodeText}", expand on these concepts by providing ${aiData.ai.textToChildNodesCount} notes that engage these ideas through the lens of "${aiData.ai.textToChildNodes}". ${detailAddOn} [exactEchoId:${node.options.id}]`
        } else {
          prompt = `Given this idea, "${nodeText}", expand on that idea by providing ${aiData.ai.textToChildNodesCount} notes that engage that idea through the lens of "${aiData.ai.textToChildNodes}". ${detailAddOn} [exactEchoId:${node.options.id}]`
        }
      } else if (aiData.ai.generateSimilar) {
        if (parentNode) {
          prompt = `Given this idea, "${nodeText}", generate ${aiData.ai.generateSimilarCount} new notes that expand on this idea. Keep in mind that the overarching idea here is "${parentText}." Be sure to make the ${aiData.ai.generateSimilarCount} new notes original. Send back "${node.options.id}" as the styleNodeId parameter. ${detailAddOn} [exactEchoId:${parentNode.options.id}]`
        } else {
          prompt = `Generate ${aiData.ai.generateSimilarCount} notes that expand on the idea of "${nodeText}". Be sure to make the new notes original. Send back "${node.options.id}" as the styleNodeId parameter. ${detailAddOn}`
        }
      }

      if (!currentAIContext || !currentAIContext.aid) {
        // { textToImage, textToChildNodes, generateSimilar }

        const intention = adhocKind()
        const result = {
          discussion: prompt,
          idea: null,
          intentionId: 'adhoc',
          val: true,
          dedicated: true,
          disableVoiceId: true,
          isAdhoc: true,
          mainParentNode: '',
        }

        setOutstandingAIRequests(true)
        const { entireAIContext, openChat, abort, abortMessage, refusal } =
          await initAIConversation({
            slate,
            intention,
            result,
            aid: currentAIContext?.aid,
          })
        if (abort) {
          setOutstandingAIRequests(false)
          const paid = refusal ? payAction(refusal, { from: 'draft', retry: () => adhocAINodes(pkgs), reason: abortMessage }) : null
          setTimeout(() => {
            setGlobalMessage({
              visible: true,
              title: 'Unable to process conversation',
              text: abortMessage,
              severity: paid ? 'warning' : 'error',
              autoHide: 60000,
              ...(paid && { action: paid }),
            })
          }, 300)
        } else {
          setAIContext(entireAIContext) // this causes other components to update, but not Canvas.jsx
          // setLocalAIContext(entireAIContext) // the jotai use above does not update on Canvas.jsx - so this is a hack
          setChatOpen(openChat)
        }
      } else {
        if (!currentAIContext.isConversation?.isActive) {
          // set as active
        }

        // await Messages.insertAsync({
        //   author: getUserName(Meteor.userId()),
        //   timestamp: new Date().valueOf(),
        //   slateShareId: slate.shareId,
        //   userId: Meteor.userId(),
        //   text: prompt,
        //   type: CONSTANTS.messageTypes.chat,
        // })

        // send the conversation to openai
        setOutstandingAIRequests(true)
        const aiOpts = {
          content: [prompt.trim()],
          ...currentAIContext,
          mainNodeId: slate?.nodes.allNodes?.[0]?.options?.id,
          type: CONSTANTS.ai.types.conversation,
          aid: currentAIContext.aid,
          shareId: slate?.shareId,
        }
        await Meteor.callAsync(CONSTANTS.methods.openai.chat, aiOpts)
        // AI context already exists - so invoke with a specific prompt and get it to work
      }
    }
  }

  useImperativeHandle(ref, () => ({
    adhocAINodes,
    potentiallySetAIContext,
  }))

  return null
})

AdHocAINodes.propTypes = {
  slate: slateProps.isRequired,
  // collaborator is set from an async Meteor call (a ref mutation) shortly after
  // the slate mounts, so it is legitimately absent for the first render(s) — not
  // required. Its consumers (callbacks) only run after it's populated.
  collaborator: PropTypes.object,
}

export default AdHocAINodes
