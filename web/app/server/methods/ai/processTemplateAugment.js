/* eslint-disable no-await-in-loop */
/* eslint-disable no-param-reassign */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-undef */
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import CONSTANTS from '../../../imports/api/common/constants'
import { AIContent } from '../../../imports/api/common/models'

import req from './req'

export default async function processTemplateAugment(aiOpts) {
  // alternatively to writing the aicontent, we could write directly to the Collaboration index and use an instanceId like 'ai_unicorn' or something
  // that all listening slates would then get --but this requires a server side version of slateboxjs for the calculations - mostly doable, also
  // this would be needed to do an API drive slateboxjs

  const user = await Meteor.userAsync()

  async function createNode(pendingNode) {
    const node = {
      ...pendingNode,
      aid: aiOpts.id,
      userId: aiOpts.userId,
      orgId: aiOpts.orgId,
      created: Date.now(),
      type: CONSTANTS.ai.types.template,
      slateShareId: aiOpts.shareId,
      role: CONSTANTS.ai.role.node,
    }
    await AIContent.insertAsync(node)
  }

  const { prompts } = JSON.parse(JSON.stringify(aiOpts))
  const mainPrompts = JSON.parse(JSON.stringify(prompts))

  // kicks off the init
  await AIContent.insertAsync({
    _id: Random.id(),
    aid: aiOpts.id,
    type: CONSTANTS.ai.types.template,
    role: CONSTANTS.ai.role.coordinator,
    state: CONSTANTS.ai.state.pending,
    engine: CONSTANTS.ai.engines.chatgpt,
    fullPrompt: aiOpts.prompts,
    userPrompt: aiOpts.userPrompt,
    userId: Meteor.userId(),
    orgId: user.orgId,
    created: Date.now(),
    slateShareId: aiOpts.shareId,
  })

  console.log('kicking off processing', { aid: aiOpts.id, prompts: prompts.length })
  let nodeError = null

  async function kickOff() {
    const response = await req(prompts, aiOpts)
    return response
  }

  let response = null
  try {
    response = await kickOff()

    if (!response || response.abort) {
      // the meter refused or the request could not be sent: one plain note
      for (const n of [response?.abortMessage || "AI could not run for this request. See Credits in your profile."]) {
        console.log('adding aborted aicontent', n)
        const node = {
          _id: Random.id(),
          text: n,
          category: aiOpts.categories[0],
          aid: aiOpts.id,
          userId: aiOpts.userId,
          orgId: aiOpts.orgId,
          created: Date.now(),
          type: CONSTANTS.ai.types.scratch,
          slateShareId: aiOpts.shareId,
          role: CONSTANTS.ai.role.node,
        }
        await AIContent.insertAsync(node)
      }
      return
    }

    if (response.json.idea) {
      createNode({
        _id: Random.id(),
        text: response.json.idea,
        category: response.json.category,
      })
    }
    // add the response to assistant
    prompts.push({
      role: 'assistant',
      content: JSON.stringify(response.json),
    })
    mainPrompts.push({
      role: 'assistant',
      content: JSON.stringify(response.json),
    })
  } catch (err) {
    nodeError = err.message
  }

  // requiresSequentialProcessing is a flag that will force the AI to go through each category in order
  // otherwise it will generate categoryIterations ideas for each category in paralllel (which defaults
  // to 3)
  // async function genStickiesForCategory(category) {
  //   const categPrompts = [...mainPrompts]
  //   console.log('categPrompts are', categPrompts)
  //   for (let i = 0; i < aiOpts.categoryIterations; i += 1) {
  //     try {

  //       categPrompts.push({
  //         role: 'user',
  //         content: JSON.stringify({
  //           category,
  //         }),
  //       })
  //       console.log('sending category', categPrompts, 'for iteration', i)
  //       const nextIdea = await req(categPrompts, aiOpts)
  //       categPrompts.push({
  //         role: 'assistant',
  //         content: JSON.stringify(nextIdea.json),
  //       })
  //       console.log('got idea', nextIdea)
  //       createNode({
  //         _id: Random.id(),
  //         text: nextIdea.json.idea,
  //         category,
  //       })
  //     } catch (err) {
  //       nodeError = err.message
  //     }
  //   }
  // }

  // now start requesting and creating all the rest of the nodes
  if (!nodeError) {
    // if (!aiOpts.requiresSequentialProcessing) {
    //   for (const category of aiOpts.categories) {
    //     promises.push(genStickiesForCategory(category))
    //   }
    //   await Promise.all(promises)
    // } else {
    for (const category of aiOpts.categories) {
      for (let i = 0; i < aiOpts.categoryIterations; i += 1) {
        try {
          prompts.push({
            role: 'user',
            content: JSON.stringify({
              category,
            }),
          })
          const nextIdea = await req(prompts, aiOpts)
          console.log('got idea', { aid: aiOpts.id, errs: nextIdea?.errs ?? 0 })
          prompts.push({
            role: 'assistant',
            content: JSON.stringify(nextIdea.json),
          })
          createNode({
            _id: Random.id(),
            text: nextIdea.json.idea,
            category,
          })
        } catch (err) {
          nodeError = err.message
        }
      }
      // }
    }
  }

  if (!nodeError) {
    // completed
    await AIContent.insertAsync({
      _id: `${aiOpts.id}_completed`,
      aid: aiOpts.id,
      type: CONSTANTS.ai.types.template,
      role: CONSTANTS.ai.role.coordinator,
      state: CONSTANTS.ai.state.complete,
      engine: CONSTANTS.ai.engines.chatgpt,
      fullPrompt: prompts,
      userId: aiOpts.userId,
      orgId: aiOpts.orgId,
      created: Date.now(),
      month: new Date().getMonth() + 1,
      slateShareId: aiOpts.shareId,
    })
  } else {
    console.log('failed!', nodeError)
    await AIContent.insertAsync({
      _id: `${aiOpts.id}_failed`,
      aid: aiOpts.id,
      type: CONSTANTS.ai.types.template,
      role: CONSTANTS.ai.role.coordinator,
      state: CONSTANTS.ai.state.failed,
      engine: CONSTANTS.ai.engines.chatgpt,
      err: nodeError,
      fullPrompt: prompts,
      userId: aiOpts.userId,
      orgId: aiOpts.orgId,
      created: Date.now(),
      slateShareId: aiOpts.shareId,
    })
  }
}
