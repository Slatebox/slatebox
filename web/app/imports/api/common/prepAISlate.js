/* eslint-disable camelcase */
import { Meteor } from 'meteor/meteor'
import CONSTANTS from './constants'

export default async function prepAISlate({
  slate,
  prompt,
  functions,
  function_call,
  isOnCanvas,
  tone,
  levelOfDetail,
  wordsPerNode,
  aiSettings,
}) {
  const prepAISettings = {
    ...aiSettings,
    tone,
    levelOfDetail,
    wordsPerNode,
  }

  if (isOnCanvas) {
    if (slate) {
      if (aiSettings?.isConversation) {
        // start a conversation
        const chatOpts = {
          content: prompt,
          functions,
          function_call,
          type: CONSTANTS.ai.types.conversation,
          ...prepAISettings,
          shareId: slate.shareId,
        }
        const getDetails = await Meteor.callAsync(
          CONSTANTS.methods.openai.chat,
          chatOpts
        )
        const { aid, asOfDate, slatePalette, abort, abortMessage, refusal } =
          getDetails || {}

        // refusal: the meter's code and the pay sheet's action (server/methods/openai.js metered)
        if (abort) {
          return { abort, abortMessage, refusal }
        }

        return {
          aiContext: {
            aid,
            prompt,
            asOfDate,
            palette: slatePalette,
            ...prepAISettings,
          },
        }
      }
    }
    return null
  }

  // for scratch types - not on canvas, so no slate yet
  // const start = Date.now()
  const shareId = await Meteor.callAsync(
    CONSTANTS.methods.slates.generateShareId
  )
  const getAIDetails = await Meteor.callAsync(CONSTANTS.methods.openai.chat, {
    content: prompt,
    type: CONSTANTS.ai.types.scratch,
    ...aiSettings,
    shareId,
  })
  const { aid, titleFont, textFont, slatePalette } = getAIDetails || {}

  // const slatePalette = await Meteor.callAsync(
  //   CONSTANTS.methods.colors.buildColorPalette,
  //   { type: 'palette' }
  // )

  return {
    shareId,
    aiContext: {
      aid,
      titleFont,
      textFont,
      asOfDate: Date.now(),
      palette: slatePalette,
      prompt,
      ...aiSettings,
    },
  }

  // to just set it to null and test flow
  // return {
  //   aid: 'test',
  //   titleFont: 'Roboto',
  //   textFont: 'Roboto',
  //   palette: ['#33333', '#f3f3f3'],
  //   ...aiSettings,
  // }
}
