/* eslint-disable no-param-reassign */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-undef */
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import CONSTANTS from '../../../imports/api/common/constants'
import { AIContent, AIAudit } from '../../../imports/api/common/models'
import req from './req'
import getNounPaths from './getNounPaths'

export default async function processScratch(aiOpts) {
  const user = await Meteor.userAsync()
  // alternatively to writing the aicontent, we could write directly to the Collaboration index and use an instanceId like 'ai_unicorn' or something
  // that all listening slates would then get --but this requires a server side version of slateboxjs for the calculations - mostly doable, also
  // this would be needed to do an API drive slateboxjs

  async function createNode(pendingNode) {
    const node = {
      ...pendingNode,
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

  const { prompts } = JSON.parse(JSON.stringify(aiOpts))

  // kicks off the init
  await AIContent.insertAsync({
    _id: Random.id(),
    aid: aiOpts.id,
    type: CONSTANTS.ai.types.scratch,
    role: CONSTANTS.ai.role.coordinator,
    state: CONSTANTS.ai.state.pending,
    engine: CONSTANTS.ai.engines.chatgpt,
    levelOfDetail: aiOpts.detailLevel,
    wordsPerNode: aiOpts.wordsPerNode,
    fullPrompt: aiOpts.prompts,
    userId: Meteor.userId(),
    orgId: user?.orgId,
    created: Date.now(),
    slateShareId: aiOpts.shareId,
  })

  console.log('kicking off processing', prompts)
  let nodeError = null

  async function kickOff() {
    const response = await req(prompts, aiOpts)

    if (response.abort) {
      return false
    }

    console.log('full JSON', JSON.stringify(response, null, 2))
    if (
      !response?.json?.ideaPlan ||
      response?.json?.ideaPlan?.length === 0 ||
      !response?.json?.nouns ||
      response?.json?.nouns?.length === 0 ||
      !response?.json?.title ||
      !response?.json?.body
    ) {
      const missing = []
      aiOpts.errorCount += 1

      if (!response?.json?.ideaPlan || response?.json?.ideaPlan?.length === 0) {
        missing.push(`ideaPlan`)
      }
      if (!response?.json?.title) {
        missing.push(`title`)
      }
      if (!response?.json?.body) {
        missing.push(`body`)
      }
      if (!response?.json?.nouns || response?.json?.nouns?.length === 0) {
        missing.push(`nouns`)
      }
      // if (!response?.json?.image) {
      //   missing.push(`image`)
      // }
      if (aiOpts.errorCount > 5) {
        throw Error(
          `Unable to continue, error threshold ${aiOpts.errorCount} met`
        )
      }
      prompts.push(
        {
          role: 'assistant',
          content: JSON.stringify(response.json),
        },
        {
          role: 'system',
          content: `You sent back JSON without these properties: ${missing.join(
            ', '
          )}. Please resend the JSON with these properties included. Remember, all responses must be in JSON format and should not include any additional text or explanations.`,
        }
      )
      return kickOff()
    }
    return response
  }

  let response = null
  let ideaPlan = []
  try {
    response = await kickOff()

    if (!response || response.abort) {
      // the meter refused or the request could not be sent
      const node = {
        _id: `${aiOpts.id}_threshold`,
        nodeId: `main_idea`,
        title: response?.abortMessage || "AI could not run for this request. See Credits in your profile.",
        description: 'Add your own key or top up in your profile.',
        ...(response?.refusal && { refusal: { code: response.refusal.code, userId: aiOpts.userId } }),
        aid: aiOpts.id,
        userId: aiOpts.userId,
        orgId: aiOpts.orgId,
        created: Date.now(),
        type: CONSTANTS.ai.types.scratch,
        slateShareId: aiOpts.shareId,
        role: CONSTANTS.ai.role.node,
      }
      await AIContent.insertAsync(node)
      return
    }

    // add the response to assistant
    prompts.push({ role: 'assistant', content: JSON.stringify(response.json) })

    // will be long on the first reply, as it will give the "ideaPlan" and main idea "node" back
    // console.log('first response is ', response.json)

    if (!response.json.ideaPlan.every((i) => i.startsWith('sub_idea'))) {
      console.error('Not every id starts correctly')
    }

    const maxIdeas = 40
    ideaPlan = response.json.ideaPlan.slice(0, maxIdeas)
    console.log('going to get nounpaths', response.json.nouns.length)
    const nounPaths = await getNounPaths(response.json.nouns.slice(0, 10))

    // console.log('got nounPaths', nounPaths.length)

    // create idea map -- this will cause Slatebox to make the nodes
    await AIContent.insertAsync({
      _id: `${aiOpts.id}_ideaPlan`,
      aid: aiOpts.id,
      userId: aiOpts.userId,
      orgId: aiOpts.orgId,
      created: Date.now(),
      slateShareId: aiOpts.shareId,
      role: CONSTANTS.ai.role.attribute,
      rawIdeaPlan: response.json.ideaPlan,
      rawIdeaPlanLength: response.json.ideaPlan.length,
      nouns: nounPaths,
      ideaPlan,
      ideaPlanLength: ideaPlan.length,
    })

    // insert main idea
    createNode({
      _id: `${aiOpts.id}_main_idea`,
      nodeId: 'main_idea',
      title: response.json.title,
      description: response.json.body,
      imageSearch: response.json.image,
    })
  } catch (err) {
    nodeError = err.message
  }

  // now start requesting and creating all the rest of the nodes
  if (!nodeError) {
    for (const idea of ideaPlan) {
      prompts.push({ role: 'user', content: JSON.stringify({ id: idea }) })
      try {
        const nextIdea = await req(prompts, aiOpts)
        console.log('got nextIdea', nextIdea)
        aiOpts.errorCount = nextIdea.errs
        prompts.push({
          role: 'assistant',
          content: JSON.stringify(nextIdea.json),
        })
        // console.log('got nextIdea', nextIdea)
        createNode({
          _id: `${aiOpts.id}_${idea}`,
          nodeId: idea,
          title: nextIdea.json.title,
          description: nextIdea.json.body,
          imageSearch: nextIdea.json.image,
        })
      } catch (err) {
        // completed
        nodeError = err.message
      }
    }
  }

  if (!nodeError) {
    // completed
    await AIContent.insertAsync({
      _id: `${aiOpts.id}_completed`,
      aid: aiOpts.id,
      type: CONSTANTS.ai.types.scratch,
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
      type: CONSTANTS.ai.types.scratch,
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
