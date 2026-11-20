/* eslint-disable default-case */
/* eslint-disable no-inner-declarations */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-param-reassign */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-undef */
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import omit from 'lodash.omit'
import get from 'lodash.get'
import utils from '../../../imports/api/common/utils'
import CONSTANTS from '../../../imports/api/common/constants'
import { AIContent, Messages } from '../../../imports/api/common/models'

import defaultShapes from '../../../imports/ui/components/node/defaultShapes'
import req from './req'
import { searchGoogleImages, svgToPng } from '../images'
import getNounPaths from './getNounPaths'
import { getNormalizedAssistantContent } from './provider.mjs'
import { keepActionOpen } from '../../metering/context.mjs'
import {
  normalizeGenerationParentIds,
  shouldAttachGenerationOrphansToMain,
} from './generation-response.mjs'

const pendingErrors = {}
let queuePostProcessing = null
// ends the hold a queued rerun keeps open when that rerun is replaced before it runs
let releaseQueuedRerun = () => {}
let currentlyProcessing = false

export default async function processConversation(aiOpts, skynet) {
  const useClaude = aiOpts?.provider
    ? aiOpts.provider === 'anthropic'
    : aiOpts?.engine?.includes('claude')

  async function createNode(pendingNode) {
    const nouns = []
    if (aiOpts.defaultShapes) {
      const def = defaultShapes.find(
        (d) =>
          d.key ===
          aiOpts.defaultShapes[pendingNode.isCategory ? 'category' : 'note']
      )
      if (def) {
        nouns.push(def.path)
      }
    }
    // add an icon for category nodes
    if (pendingNode.noun && pendingNode.isCategory && aiOpts.defaultShapes) {
      const iconPath = await getNounPaths(
        [pendingNode.noun],
        1,
        pendingNode.boundToIconPack
      )
      nouns.push(iconPath)
    }

    // add an icon for category nodes
    if (pendingNode.backgroundNoun) {
      const backgroundNounPath = await getNounPaths(
        [pendingNode.backgroundNoun],
        1
      )
      pendingNode.backgroundNoun = backgroundNounPath
    }

    // add the noun if given
    if (
      nouns.length === 0 &&
      pendingNode.noun &&
      !['rectangle', 'roundedrectangle', 'ellipse'].includes(
        pendingNode.noun
      ) &&
      !aiOpts.defaultShapes
    ) {
      const iconPath = await getNounPaths([pendingNode.noun], 1)
      nouns.push(iconPath)
    }

    if (pendingNode.imageSearch) {
      try {
        const getImages = await searchGoogleImages(
          { query: pendingNode.imageSearch, limit: 1, page: 0, filter: '' }
        )
        const firstImage = getImages.items[0]
        pendingNode.image = firstImage.link
        pendingNode.imageOrigWidth = firstImage.image.width
        pendingNode.imageOrigHeight = firstImage.image.height

        // Calculate scale factors based on the maximum allowed dimensions.
        const widthFactor = pendingNode.width / firstImage.image.width
        const heightFactor = pendingNode.height / firstImage.image.height
        // Use the smaller factor so that neither dimension exceeds the allowed size.
        const scaleFactor = Math.min(widthFactor, heightFactor)
        // Adjust both the width and height proportionately.
        pendingNode.width = Math.round(firstImage.image.width * scaleFactor)
        pendingNode.height = Math.round(firstImage.image.height * scaleFactor)

        // console.log(
        //   'got image details',
        //   firstImage.image.width,
        //   firstImage.image.height,
        //   widthFactor,
        //   heightFactor,
        //   scaleFactor,
        //   pendingNode.image,
        //   pendingNode.width,
        //   pendingNode.height
        // )
      } catch (err) {
        console.error('error searching for images', err)
      }
    }

    // console.log('got nouns', pendingNode.noun, nouns)

    // cleans up unneeded
    const cleanNode = Object.fromEntries(
      Object.entries(pendingNode).filter(([key, value]) => value !== undefined)
    )

    const node = {
      aid: aiOpts.id,
      userId: aiOpts.userId,
      orgId: aiOpts.orgId,
      created: Date.now(),
      type: CONSTANTS.ai.types.conversation,
      slateShareId: aiOpts.shareId,
      role: CONSTANTS.ai.role.node,
      ...cleanNode,
      defaultShaped: !cleanNode.noun || !!aiOpts.defaultShapes,
      aiDerived: true,
      nouns,
    }

    if (
      aiOpts.transparentConnections &&
      cleanNode.layoutStyle === 'slideDeck'
    ) {
      node.transparent = true
    }

    // console.log(
    //   'will create node',
    //   aiOpts.transparentConnections,
    //   pendingNode.layoutStyle,
    //   JSON.stringify(node, null, 2)
    // )

    try {
      // console.log('inserting node for ai content', node)
      await AIContent.upsertAsync({ _id: node._id }, omit(node, '_id'))
      // await AIContent.insertAsync(node)
    } catch (err) {
      console.error(`Unable to insert aicontent: ${err}`)
      // await Messages.insertAsync({
      //   timestamp: new Date().valueOf(),
      //   userId: Meteor.userId(),
      //   aid: aiOpts.id,
      //   text: `Sorry, I'm having a little trouble - just keep chatting and I'll catch up!`,
      //   read: false,
      //   type: CONSTANTS.messageTypes.ai,
      // })
    }
  }

  const { prompts, system } = JSON.parse(JSON.stringify(aiOpts))

  // console.log(`AI: ${JSON.stringify(prompts[prompts.length - 1])}`)
  currentlyProcessing = true

  if (aiOpts.isNew) {
    // here we know the aiOpts.prompts with document types like the below have
    // already been sent to Claude and we just need to retain the structure of the
    // conversation but omit the actual base64 data. The initial data was sent as:
    // {
    //   type:  'document',
    //   source: {
    //     type: 'base64',
    //     media_type: 'application/pdf,
    //     data: base64.split(',')[1],
    //   },
    //   cache_control: { type: 'ephemeral' },
    // }
    // and now we need to iterate over the prompts and remove the data property
    // from any content that has a source type of base64

    // cache any base64 data in the aiOpts.prompts wherever cache_control is
    // ephemeral
    // aiOpts.prompts.forEach((p, i) => {
    //   if (p?.content) {
    //     p.content.forEach((c) => {
    //       if (c.source?.type === 'base64' && c.cache_control?.type === 'ephemeral') {
    //         documentCache[i] = c.source.data;
    //       }
    //     });
    //   }
    // });
    // const removedBase64Prompts = aiOpts.prompts.map((p) => {
    //   if (p?.content) {
    //     return {
    //       ...p,
    //       content: p.content.map((c) => {
    //         if (c.source?.type === 'base64') {
    //           // Keep the source structure but omit the data property
    //           return {
    //             ...c,
    //             source: {
    //               ...c.source,
    //               data: '',
    //             },
    //           }
    //         }
    //         return c
    //       }),
    //     }
    //   }
    //   return p
    // })

    // console.log(
    //   'removedBase64Prompts',
    //   JSON.stringify(removedBase64Prompts, null, 2)
    // )

    // kicks off the init
    const aiContent = {
      _id: Random.id(),
      aid: aiOpts.id,
      type: CONSTANTS.ai.types.conversation,
      role: CONSTANTS.ai.role.coordinator,
      state: CONSTANTS.ai.state.pending,
      engine: aiOpts.engine || CONSTANTS.ai.engines.chatgpt,
      levelOfDetail: aiOpts.detailLevel,
      wordsPerNode: aiOpts.wordsPerNode,
      fullPrompt: aiOpts.prompts,
      system: aiOpts.system,
      userId: Meteor.userId(),
      orgId: (await Meteor.userAsync())?.orgId,
      created: Date.now(),
      slateShareId: aiOpts.shareId,
      instructions: aiOpts.instructions,
    }

    // console.log('AI Content fullPrompt check:', {
    //   hasBase64Source: aiOpts.prompts.some(
    //     (p) => p?.content?.[0]?.source?.data
    //   ),
    //   originalPromptCount: aiOpts.prompts.length,
    //   processedPromptCount: aiContent.fullPrompt.length,
    //   sampleProcessedPrompt: JSON.stringify(
    //     aiContent.fullPrompt[0]?.content?.[0]?.source || {}
    //   ).substring(0, 100),
    //   stillContainsBase64: JSON.stringify(aiContent.fullPrompt).includes(
    //     'base64,'
    //   ),
    // })

    await AIContent.insertAsync(aiContent)
  }

  async function kickoff() {
    const response = await req({ ...aiOpts, sdkChat: true })
    const responseUsesClaude = response?.provider
      ? response.provider === 'anthropic'
      : useClaude
    const responseUsesDeepInfra = response?.provider === 'deepinfra'

    // console.log(
    //   'raw response convo',
    //   useClaude,
    //   JSON.stringify(response, null, 2)
    // )

    pendingErrors[aiOpts.id] = []
    let parsedResponse = null
    try {
      if (!response.abort) {
        if (response.toolCall?.arguments != null) {
          parsedResponse =
            typeof response.toolCall.arguments === 'string'
              ? JSON.parse(response.toolCall.arguments)
              : response.toolCall.arguments
        } else if (responseUsesClaude) {
          parsedResponse =
            response.json?.content?.find((c) => !!c.input)?.input || {}
        } else {
          parsedResponse = JSON.parse(response.json?.arguments)
        }

        // Move provider-normalized text beside a tool call into the chat box.
        const replaceSuggestion = getNormalizedAssistantContent(response).find(
          (content) => content.type === 'text'
        )?.text
        if (replaceSuggestion) parsedResponse.suggestion = replaceSuggestion
      }
    } catch (err) {
      pendingErrors[aiOpts.id].push(
        `You sent invalid JSON in the array of responses: ${err.message}`
      )
    }

    // console.log('raw parsedResponse', JSON.stringify(parsedResponse, null, 2))

    if (!parsedResponse && !response.abort) {
      pendingErrors[aiOpts.id].push(
        `You have not provided the JSON response, please do so now.`
      )
    }

    if (parsedResponse) {
      let fatal = false
      for (const prop of ['notes', 'categories']) {
        if (!fatal) {
          const singleProp = prop === 'notes' ? 'note' : 'category'
          if (parsedResponse[prop]) {
            for (const args of parsedResponse[prop]) {
              // null entries from malformed replies: every check below
              // dereferences args; a null here aborts the pipeline otherwise.
              if (!args || typeof args !== 'object') {
                continue
              }
              if (!fatal) {
                if (
                  typeof parsedResponse[prop] === 'string' &&
                  ['notes', 'categories'].includes(prop)
                ) {
                  try {
                    parsedResponse[prop] = JSON.parse(parsedResponse[prop])
                  } catch (err) {
                    pendingErrors[aiOpts.id].push(
                      `You created the ${prop} as a string, but it should be an array. Please recreate it as an array.`
                    )
                    fatal = true
                  }
                }
              }
              for (const check of aiOpts.errorChecks) {
                switch (check.type) {
                  case 'noteWordCount': {
                    if (prop === 'notes') {
                      // console.log(
                      //   'checking note word count',
                      //   args?.note?.description?.split(' ').length
                      // )
                      if (args?.description?.split(' ').length > check.limit) {
                        pendingErrors[aiOpts.id].push(
                          `You created note id ${args?.note?.id ?? 'unknown'} with ${
                            args?.description?.split(' ').length
                          } words but I asked you to keep descriptions under ${
                            check.limit
                          } words. Please recreate it with no more than ${
                            check.limit
                          } words.`
                        )
                      }
                    }
                    break
                  }
                  case 'noImmediateBackground': {
                    // not sure how to implmement
                    break
                  }
                  case 'noteAndCategoryIdsSet': {
                    const alreadyExists =
                      parsedResponse[prop].filter(
                        (p) => p?.id && args?.id && p?.id === args?.id
                      ).length > 1

                    if (
                      args?.isUpdate &&
                      (await AIContent.find({
                        nodeId: `${singleProp}_${args?.id}`,
                      }).countAsync()) === 0
                    ) {
                      pendingErrors[aiOpts.id].push(
                        `You set isUpdate to true for the ${singleProp} id of ${args.id} but that ${singleProp} does not exist.`
                      )
                    } else if (
                      alreadyExists ||
                      (args?.description && args?.id == null)
                    ) {
                      if (alreadyExists) {
                        pendingErrors[aiOpts.id].push(
                          `You provided a duplicate ${singleProp} id for the ${singleProp} with this description: ${args.description}. Please recreate this ${singleProp} with a unique id. Remember to always provide a ${singleProp} id or use 'main' as the ${singleProp} id if you want to attach it to the main topic.`
                        )
                      } else {
                        pendingErrors[aiOpts.id].push(
                          `You did not provide a unique ${singleProp} id for the ${singleProp} with this description: ${args.description}. Please recreate this ${singleProp} with a correct id. Remember to always provide a ${singleProp} id or use 'main' as the ${singleProp} id if you want to attach it to the main topic.`
                        )
                      }
                    }
                    break
                  }
                }
              }
            }
          }
        }
      }
    }

    if (pendingErrors[aiOpts.id].length > 0) {
      if (response.json) {
        const assistantContent = getNormalizedAssistantContent(response)
        prompts.push({
          role: 'assistant',
          content:
            responseUsesClaude || responseUsesDeepInfra
              ? assistantContent
              : JSON.stringify(response.json),
        })
      }

      if (responseUsesClaude || responseUsesDeepInfra) {
        const resp = parsedResponse
          ? {
              type: 'tool_result',
              tool_use_id:
                response.toolCall?.id ||
                response.json?.content?.find((c) => c.type === 'tool_use')?.id,
              content: pendingErrors[aiOpts.id].join(', '),
              is_error: true,
            }
          : { type: 'text', text: pendingErrors[aiOpts.id].join(', ') }
        console.log('pendingErrors fired', { aid: aiOpts.id, errors: pendingErrors[aiOpts.id].length })
        prompts.push({
          role: 'user',
          content: [resp],
        })
      } else {
        prompts.push({
          role: 'system',
          content: pendingErrors[aiOpts.id].join(', '),
        })
      }
      return kickoff()
    }
    return { response, parsedResponse }
  }

  /*
  {
    json: {
      id: 'msg_01USDDoXXGygdM5E5UMyVhgP',
      type: 'message',
      role: 'assistant',
      model: 'example-model',
      content: [ [Object] ],
      stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 2916,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 151
        }
      },
      message: {
        id: 'msg_01USDDoXXGygdM5E5UMyVhgP',
        type: 'message',
        role: 'assistant',
        model: 'example-model',
        content: [ [Object] ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 2916,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 151
        }
      },
      errs: 0
  }
  */
  const { response, parsedResponse } = await kickoff(prompts)

  // console.log('parsedResponse is', parsedResponse)

  if (response.abort) {
    await Messages.insertAsync({
      author: `Slatebox AI`,
      timestamp: new Date().valueOf(),
      slateShareId: aiOpts.shareId,
      userId: `ai`,
      text: response.abortMessage,
      type: CONSTANTS.messageTypes.chat,
      // a meter refusal handed to the pipeline: the person refused is offered the pay sheet's action
      ...(response.refusal && { refusal: { code: response.refusal.code, userId: aiOpts.userId } }),
    })
    const abortNode = {
      _id: `${aiOpts.id}_abort_${Random.id()}`,
      aid: aiOpts.id,
      userId: aiOpts.userId,
      orgId: aiOpts.orgId,
      created: Date.now(),
      abort: true,
      text: response.abortMessage,
      ...(response.refusal && { refusal: { code: response.refusal.code, userId: aiOpts.userId } }),
      type: CONSTANTS.ai.types.conversation,
      slateShareId: aiOpts.shareId,
      role: CONSTANTS.ai.role.node,
    }
    await AIContent.insertAsync(abortNode)
    return false
  }


  const nodeDetails = new Set()
  const allArgParams = Object.keys(parsedResponse)
  let deletableIds = []

  for (const key of allArgParams) {
    const value = parsedResponse[key]
    // console.log('checking key', key, value)
    switch (key) {
      case 'deleteNoteIds': {
        deletableIds = [
          ...deletableIds,
          ...(value.map((v) => `note_${v}`) || []),
        ]
        break
      }
      case 'deleteCategoryIds': {
        deletableIds = [
          ...deletableIds,
          ...(value.map((v) => `category_${v}`) || []),
        ]
        break
      }
      case 'suggestion': {
        // to put in chatbox
        // console.log('adding suggestion', key, parsedResponse, value)
        if (value.length) {
          await Messages.insertAsync({
            author: `Slatebox AI`,
            timestamp: new Date().valueOf(),
            slateShareId: aiOpts.shareId,
            userId: `ai`,
            text: value,
            type: CONSTANTS.messageTypes.chat,
          })
          // to put at top as suggestion info box
          // await Messages.insertAsync({
          //   timestamp: new Date().valueOf(),
          //   userId: Meteor.userId(),
          //   aid: aiOpts.id,
          //   text: args.suggestion,
          //   read: false,
          //   type: CONSTANTS.messageTypes.ai,
          // })
        }
        break
      }
      case 'waiting': {
        nodeDetails.add({
          _id: `${aiOpts.id}_waiting_${Random.id()}`.toLowerCase(),
        })
      }
    }
  }

  // console.log('deletableIds', deletableIds)

  // mark nodes as deleted
  if (deletableIds.length > 0) {
    const delQuery = {
      slateShareId: aiOpts.shareId,
      $or: [
        { parentId: { $in: deletableIds } },
        { childId: { $in: deletableIds } },
      ],
    }
    const deletableNodes = await AIContent.find(delQuery).fetchAsync()
    if (deletableNodes.length > 0) {
      const removingContent = deletableNodes
        .map((a) => a.description)
        .join(', ')

      await AIContent.updateAsync(
        delQuery,
        { $set: { deleted: true, created: Date.now() } },
        { multi: true }
      )
      if (removingContent.length) {
        await Messages.insertAsync({
          author: `Slatebox AI`,
          timestamp: new Date().valueOf(),
          slateShareId: aiOpts.shareId,
          userId: `ai`,
          text: `I removed ${deletableNodes.length} ${
            deletableNodes.length > 1 ? 'ideas' : 'idea'
          } that ${
            deletableNodes.length > 1 ? 'are' : 'is'
          } no longer relevant.`,
          type: CONSTANTS.messageTypes.chat,
        })
      }
      // await Messages.insertAsync({
      //   timestamp: new Date().valueOf(),
      //   userId: Meteor.userId(),
      //   aid: aiOpts.id,
      //   text: `I removed these ideas because they aren't relevant now: ${removingContent}`,
      //   read: false,
      //   type: CONSTANTS.messageTypes.ai,
      // })
    } else {
      console.error(
        `**error finding nodes to delete: ${JSON.stringify(delQuery)}`
      )
    }
  }

  const attachOrphansToMain = shouldAttachGenerationOrphansToMain(aiOpts)

  if (parsedResponse.categories) {
    for (const category of parsedResponse.categories) {
      // Malformed model replies can include null entries; reading .id on
      // them used to abort the whole pipeline mid-apply.
      if (!category) {
        continue
      }
      const cid = aiOpts.isAdhoc ? Random.id() : category.id
      if (cid) {
        const categoryId = `category_${cid.replace('category_', '')}`
        const parentCategoryIds = normalizeGenerationParentIds(
          category.parentCategoryIds,
          {
            mainNodeId: aiOpts.mainNodeId,
            attachOrphansToMain,
          }
        )

        nodeDetails.add({
          _id: `${aiOpts.id}_${categoryId}`,
          isUpdate: category.isUpdate,
          isCategory: true,
          parentCategoryIds,
          childId: categoryId,
          nodeId: categoryId,
          groupId: parentCategoryIds?.[0],
          noun: category.noun,
          imageSearch: category.imageSearch,
          description: category.description,
          xPos: category.xPos,
          yPos: category.yPos,
          height: category.height,
          width: category.width,
          fontFamily: category.fontFamily,
          fontSize: category.fontSize,
          rotationAngle: category.rotationAngle ?? 0,
          filter: category.filter,
          textLines: category.textLines,
          color: category.color,
        })
      }
    }
  }

  if (parsedResponse.notes) {
    for (const note of parsedResponse.notes) {
      if (!note) {
        continue
      }
      const nid = aiOpts.isAdhoc ? Random.id() : note.id
      if (nid) {
        const noteId = `note_${nid.replace('note_', '')}`

        // non adhoc requests always send the parentCategoryIds in without the prefix,
        // but aiOpts.exactEchoId means use the exact thing sent which includes the prefix
        let parentCategoryIds = []
        if (aiOpts.exactEchoId?.length) {
          parentCategoryIds = [aiOpts.exactEchoId]
        } else {
          const receivedNoteIds = parsedResponse.notes
            .filter((n) => !!n)
            .map((n) => n.id)
          parentCategoryIds = normalizeGenerationParentIds(
            note.parentCategoryIds,
            {
              mainNodeId: aiOpts.mainNodeId,
              noteIds: receivedNoteIds,
              forceNoteParents: aiOpts.skipCategories,
              attachOrphansToMain,
            }
          )
        }

        const n = {
          _id: `${aiOpts.id}_${noteId}`,
          isUpdate: note.isUpdate,
          isCategory: false,
          parentCategoryIds,
          childId: noteId,
          nodeId: noteId,
          groupId: parentCategoryIds?.[0],
          noun: note.noun,
          imageSearch: note.imageSearch,
          description: note.description,
          styleNodeId: note.styleNodeId,
          xPos: note.xPos,
          yPos: note.yPos,
          height: note.height,
          width: note.width,
          fontFamily: note.fontFamily,
          fontSize: note.fontSize,
          rotationAngle: note.rotationAngle ?? 0,
          filter: note.filter,
          animation: note.animation,
          textLines: note.textLines,
          color: note.color,
          opacity: note.opacity,
          borderWidth: note.borderWidth,
          borderOpacity: note.borderOpacity,
          borderStyle: note.borderStyle,
          borderColor: note.borderColor,
          layoutStyle: note.layoutStyle,
          backgroundNoun: note.backgroundNoun,
          meta: {},
        }

        let addNote = true
        if (note.templateDetails) {
          n.noun = null
          n.nouns = []
          n.groupId = null
          n.parentCategoryIds = []
          n.meta.description = note.templateDetails?.description || ''
          n.description = null
          try {
            const escapedSvgString = note.templateDetails.svgString.replace(
              /(<text[^>]*>)([\s\S]*?)(<\/text>)/g,
              (match, openingTag, textContent, closingTag) =>
                openingTag +
                textContent.replace(
                  /[&<>"']/g,
                  (char) =>
                    ({
                      '&': '&amp;',
                      '<': '&lt;',
                      '>': '&gt;',
                      '"': '&quot;',
                      "'": '&apos;',
                    }[char] || char)
                ) +
                closingTag
            )

            console.log('escapedSvgString', { note: noteId, length: escapedSvgString.length })
            n.image = await svgToPng({
              svg: escapedSvgString,
              fileName: noteId,
            })
            if (note.templateDetails?.description?.length) {
              await Messages.insertAsync({
                author: `Slatebox AI`,
                timestamp: new Date().valueOf(),
                slateShareId: aiOpts.shareId,
                userId: `ai`,
                text: `Added custom visual: ${note.templateDetails.description}`,
                type: CONSTANTS.messageTypes.chat,
              })
            }
            n.width = note.templateDetails.width
            n.height = note.templateDetails.height
            n.imageOrigWidth = note.templateDetails.width
            n.imageOrigHeight = note.templateDetails.height
          } catch (err) {
            await Messages.insertAsync({
              author: `Slatebox AI`,
              timestamp: new Date().valueOf(),
              slateShareId: aiOpts.shareId,
              userId: `ai`,
              text: `Sorry, I ran into a problem trying to create a custom visual: ${note.templateDetails.description}. Please ask to have it recreated (${err.message})`,
              type: CONSTANTS.messageTypes.chat,
            })
            addNote = false
          }
        }
        if (addNote) {
          nodeDetails.add(n)
        }
      }
    }
  }

  // always insert the human content
  // createNode({
  //   _id: `${aiOpts.id}_user_${Random.id()}`.toLowerCase(),
  //   nodeId: '',
  //   groupId: '',
  //   description: '',
  //   prompt: {
  //     role: 'user',
  //     content: null,
  //   },
  // })

  // these should not have prompts attached
  for (const nodeDetail of nodeDetails) {
    await createNode({
      ...nodeDetail,
    })
  }

  // always save off the prompt - just one aiContent record with a prompt
  const responseUsesClaude = response?.provider
    ? response.provider === 'anthropic'
    : useClaude
  const responseUsesDeepInfra = response?.provider === 'deepinfra'
  const savePrompt = responseUsesClaude || responseUsesDeepInfra
    ? {
        role: 'assistant',
        content: getNormalizedAssistantContent(response),
      }
    : {
        role: 'assistant',
        content: null,
        function_call: response.json,
      }

  await createNode({
    prompt: savePrompt,
  })

  // Preserve the completed tool turn for providers that use tool content.
  if (responseUsesClaude || responseUsesDeepInfra) {
    const toolUseId =
      response.toolCall?.id ||
      response.json?.content?.find((c) => c.type === 'tool_use')?.id

    console.log('marking tool use id', toolUseId, { bytes: JSON.stringify(response.json ?? null).length })
    if (toolUseId) {
      await createNode({
        prompt: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: [
                {
                  type: 'text',
                  text: `Received ${
                    parsedResponse.notes?.length ?? 0
                  } notes and ${
                    parsedResponse.categories?.length ?? 0
                  } categories to process`,
                },
              ],
              is_error: false,
            },
          ],
        },
      })
    }
  }

  currentlyProcessing = false

  // console.log(
  //   'postProcessing is',
  //   skynet,
  //   currentlyProcessing,
  //   aiOpts.postProcessing
  // )

  // lastly, if this is postProcessing, enact it
  if (
    Array.isArray(aiOpts.postProcessing?.scenarios) &&
    !skynet &&
    !currentlyProcessing
  ) {
    // run the first scenario that happens
    for (const scenario of aiOpts.postProcessing.scenarios) {
      const autoPrompts = []
      let delay = 0
      switch (scenario.type) {
        case 'sizeCheck': {
          const tot = await AIContent.find({ aid: aiOpts.id }).countAsync()
          if (tot >= scenario.limit) {
            const { prompt, delayInSeconds } = scenario
            if (prompt) {
              autoPrompts.push(prompt)
            }
            delay = delayInSeconds
          }
          break
        }
        case 'whenTrue': {
          if (
            allArgParams.some(
              (a) =>
                scenario.params.some((ax) => ax.startsWith(a)) &&
                [
                  ...(parsedResponse?.notes || []),
                  ...(parsedResponse?.categories || []),
                ].some((obj) => get(obj, a) === true)
            )
          ) {
            const { prompt, delayInSeconds } = scenario
            if (prompt) {
              autoPrompts.push(prompt)
            }
            delay = delayInSeconds
          }
          break
        }
        case 'checkJSON': {
          const invalidJson = []
          scenario.params.forEach((a) => {
            if (!utils.isJSON(parsedResponse[a])) {
              invalidJson.push(a)
            }
          })
          if (invalidJson.length > 0) {
            const { prompt, delayInSeconds } = scenario
            if (prompt) {
              autoPrompts.push(
                prompt.replace('{invalidJSON}', invalidJson.join(', '))
              )
            }
            delay = delayInSeconds
          }
          break
        }
        case 'missing':
        default: {
          const isMissing = !scenario.params?.every((a) =>
            allArgParams.includes(a)
          )
          if (isMissing) {
            const { prompt, delayInSeconds } = scenario
            if (prompt) {
              autoPrompts.push(prompt)
            }
            delay = delayInSeconds
          }
          break
        }
      }

      if (autoPrompts.length > 0) {
        clearTimeout(queuePostProcessing)
        releaseQueuedRerun()
        let rerunEnded
        // the rerun is part of the same counted AI request: it stays open until the rerun ends
        keepActionOpen(new Promise((resolve) => { rerunEnded = resolve }))
        releaseQueuedRerun = rerunEnded
        const rerun = () => {
          const resendOpts = {
            ...aiOpts,
            prompts: [
              ...aiOpts.prompts,
              {
                role: 'user',
                content: autoPrompts.join(' '),
              },
            ],
          }
          return processConversation(resendOpts, true).catch((err) => {
            console.error('conversation rerun failed', err?.message || err)
          }).finally(rerunEnded)
        }
        queuePostProcessing = setTimeout(
          Meteor.bindEnvironment(rerun),
          delay * 1000
        )
      }
    }
  }
}
