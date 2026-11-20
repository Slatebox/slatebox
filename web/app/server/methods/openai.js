/* eslint-disable prefer-const */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-inner-declarations */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-param-reassign */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-bitwise */
// methods.js

import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import { safeFetch } from '../common/safe-fetch.mjs'
import { readStoredFile, storedFileBase } from '../common/fileStore'
import { canEditSlate, canReadSlate, findSlate } from '../common/slate-access'
import { Random } from 'meteor/random'
// import { Configuration, OpenAIApi } from 'openai'
// import stringSimilarity from 'string-similarity'
import CONSTANTS from '../../imports/api/common/constants'
import processConversation from './ai/processConversation'
import req from './ai/req'
import { keepActionOpen, pinnedEngine, runAIAction } from '../metering/context.mjs'
import { refusalAnswer } from '../metering/refusal-pay.mjs'
import { mayPostRefusal } from '../metering/refusal-notice.mjs'
import { resolveAIFeatureConfig } from './ai/feature-config.mjs'
import {
  pruneEmptyTemplateCatalog,
  resolveTemplateFromText,
} from './ai/welcome-template-routing.mjs'
import { getNormalizedAssistantContent } from './ai/provider.mjs'
import {
  resolveWelcomeFunctionCall,
  validateSlateMessageRoute,
  validateWelcomeResponse,
} from './ai/welcome-response.mjs'
import validateGenerationResponse from './ai/generation-response.mjs'
import {
  naturalOperationFallback,
  SLATE_OPERATION_TOOL,
} from 'slateboxjs/operations'
import { userSelectableTemplateSelector } from '../../imports/api/common/template-policy.mjs'

import {
  AIContent,
  Messages,
  ChatIntentions,
  SystemSettings,
  Slates,
  SlateAccess,
  OrganizationSettings,
} from '../../imports/api/common/models'

// Every paid AI path runs inside a counted action (server/metering). When the meter refuses,
// the request is not sent and the person sees why: in the answer (abortMessage) always, and in
// the slate's chat only when they may change that slate. The meter refuses before the handler's
// own access checks run, so the chat row is checked here (refusal-notice.mjs).
function metered(options, handler) {
  return async (args, ...rest) => {
    try {
      return await runAIAction(options, () => handler(args, ...rest))
    } catch (error) {
      if (!(error instanceof Meteor.Error) || !error.reason || !args?.shareId || error.error === 'not-authorized') throw error
      // A meter refusal names its code and whom it refused, so the chat shows that person (only)
      // the pay sheet's action; the answer carries the action itself (refusal-pay.mjs).
      const { row, answer } = refusalAnswer(error, Meteor.userId())
      const post = await mayPostRefusal({ userId: Meteor.userId(), shareId: args.shareId, findSlate, canEditSlate })
      if (post) {
        await Messages.insertAsync({
          author: 'Slatebox AI', timestamp: Date.now(), slateShareId: args.shareId, userId: 'ai', text: error.reason, type: CONSTANTS.messageTypes.chat,
          ...row,
        })
      }
      return answer
    }
  }
}

const method = {}
const pendingSlateOperations = new Map()

async function initUsage({
  aid,
  shareId,
  content,
  engine,
  provider,
  ongoingConversationRider,
  currentLayout,
}) {
  const user = await Meteor.userAsync()
  const useClaude = provider
    ? provider === 'anthropic'
    : engine
      ? engine.includes('claude')
      : true
  let existingConversation = []
  const fullPrompt = []
  let system = null
  {
    aid = aid || `ai_${Random.id()}`
    existingConversation = aid
      ? await AIContent.find(
          { aid, denotesCreditUsed: { $ne: true } },
          {
            fields: { role: 1, system: 1, prompt: 1, fullPrompt: 1 },
            sort: { created: 1 },
          }
        ).fetchAsync()
      : []

    system = existingConversation?.find((e) => e.system)?.system
    if (content) {
      if (!Array.isArray(content)) {
        content = [content]
      }

      console.log('ongoingConversationRider', {
        riderLength: ongoingConversationRider?.length ?? 0,
        layout: !!currentLayout,
      })

      let augmentConversation = ongoingConversationRider ?? ''
      if (currentLayout) {
        augmentConversation = `${augmentConversation} The below JSON array contains the current x, y, width (w), and height (h) for each note or category id in the slate. Pay attention to this layout when producing NEW notes or categories. You do not need to echo any of this back to the user unless they are trying to update existing notes or categories. In that case you can use this layout to correctly position specific notes or categories when responding with isUpdate: true. The array is: ${JSON.stringify(
          currentLayout.map((l) => ({
            id: l.nodeId,
            x: l.x,
            y: l.y,
            w: l.width,
            h: l.height,
          }))
        )}`
      }
      if (augmentConversation?.length) {
        augmentConversation = `\n\n(Note - the above is the actual user message, so respond to ONLY that message. The following are special instructions that were automatically added, and should be used in the response, but do not mention these instructions directly in any of your responses: ${augmentConversation})`
      }
      // insert the latest from the user
      const contentToInsert = content.type
        ? content
        : useClaude
          ? [
              {
                type: 'text',
                text: `${content.join(' ').trim()} ${augmentConversation}`,
              },
            ]
          : content.join(' ').trim()

      const next = {
        aid,
        humanDerived: true,
        userId: user._id,
        orgId: user.orgId,
        slateShareId: shareId,
        created: Date.now(),
        type: CONSTANTS.ai.types.conversation,
        role: CONSTANTS.ai.role.node,
        prompt: {
          role: 'user',
          content: contentToInsert,
        },
      }
      await AIContent.insertAsync(next)
      existingConversation.push(next)
      fullPrompt.push(
        ...existingConversation.filter((e) => e.prompt).map((e) => e.prompt)
      )
    }
  }
  return {
    existingConversation,
    system,
    aid,
    fullPrompt,
    useClaude,
  }
}

function extractRequiredAndOptionalItems(intention) {
  if (intention.gather) {
    const intentionIntro = intention.gather?.message || ''
    const requiredItemsToGather = intention.gather.items
      .filter((ix) => ix.required)
      .map((ix) => `${ix.key}: ${ix.placeholder}`)
      .filter((ix) => ix.trim() !== '')
      .join(', ')
    const optionalItemsToGather = intention.gather.items
      .filter((ix) => !ix.required)
      .map((ix) => `${ix.key}: ${ix.placeholder}`)
      .filter((ix) => ix.trim() !== '')
      .join(', ')
    let fullItemPrompt = `${intentionIntro} `
    if (requiredItemsToGather.length) {
      fullItemPrompt = `You must gather the following intentionItems from the user: ${requiredItemsToGather}`
    }
    if (optionalItemsToGather.length) {
      fullItemPrompt += `; these intentionItems are optional: ${optionalItemsToGather}`
    }
    return fullItemPrompt
  }
  return ''
}

function extractToolAndMessage(resp) {
  const assistantContent = getNormalizedAssistantContent(resp)
  const anyToolUsed = assistantContent.find((c) => c.type === 'tool_use')

  const assistantResponse = assistantContent.find(
    (c) => c.type === 'text'
  )?.text
  // console.log(
  //   'extractToolAndMessage assistantResponse',
  //   typeof resp,
  //   typeof resp.json,
  //   assistantResponse
  // )
  return { anyToolUsed, assistantResponse }
}

async function insertAIChatMessage(shareId, text) {
  if (!text?.trim()) return null
  return Messages.insertAsync({
    author: `Slatebox AI`,
    timestamp: new Date().valueOf(),
    slateShareId: shareId,
    userId: `ai`,
    text: text.trim().slice(0, 1000),
    type: CONSTANTS.messageTypes.chat,
  })
}

async function canUserEditSlate(user, slate) {
  if (!user || !slate) return false
  if (slate.userId === user._id || slate.options?.isPublic) return true
  return Boolean(
    await SlateAccess.findOneAsync({
      slateId: slate._id,
      userId: user._id,
      slateAccessPermissionId: CONSTANTS.slateAccessPermissions.edit.id,
    })
  )
}

async function invokeTool({
  extractedToolAndMessage,
  fullPrompt,
  templates,
  isTemplate,
  aid,
  user,
  shareId,
  system,
  welcomePrompt,
  userMessage,
}) {
  let systemResponse = null
  let slateTemplateId = null

  const toolName = extractedToolAndMessage.anyToolUsed?.name
  if (
    extractedToolAndMessage?.assistantResponse &&
    toolName !== 'applySlateOperations'
  ) {
    const msg = extractedToolAndMessage.assistantResponse
    // insert the latest from the system
    // const systemMessage = {
    //   aid,
    //   humanDerived: false,
    //   userId: user._id,
    //   orgId: user.orgId,
    //   shareId,
    //   created: Date.now(),
    //   type: CONSTANTS.ai.types.conversation,
    //   role: CONSTANTS.ai.role.node,
    //   prompt: {
    //     role: 'assistant',
    //     content: msg,
    //   },
    // }
    // await AIContent.insertAsync(systemMessage)

    // console.log('inserted systemMessage', systemMessage)

    // insert the message as a response to the user
    await insertAIChatMessage(shareId, msg)
  }

  switch (extractedToolAndMessage.anyToolUsed?.name) {
    case 'applySlateOperations': {
      const operationPlan = extractedToolAndMessage.anyToolUsed.input
      if (pendingSlateOperations.size > 1000) {
        const now = Date.now()
        pendingSlateOperations.forEach((pending, id) => {
          if (pending.expiresAt < now) pendingSlateOperations.delete(id)
        })
      }
      const operationRequestId = Random.id()
      pendingSlateOperations.set(operationRequestId, {
        userId: user._id,
        shareId,
        text:
          extractedToolAndMessage.assistantResponse ||
          naturalOperationFallback(operationPlan),
        expiresAt: Date.now() + 5 * 60 * 1000,
      })
      systemResponse = {
        operationPlan,
        operationRequestId,
        text:
          extractedToolAndMessage.assistantResponse ||
          naturalOperationFallback(operationPlan),
      }
      break
    }
    case 'previewTemplate':
    case 'expandTemplates': {
      const isExpandTemplates =
        extractedToolAndMessage.anyToolUsed?.name === 'expandTemplates'
      const userToolResp = isExpandTemplates
        ? templates
            .map((i, cnt) =>
              `(${cnt}) ${
                i.options.name
              } - ${i.options.description.trim()}, (id: ${i.shareId})`.trim()
            )
            .join('; ')
            .trim()
        : `Received templateId of ${extractedToolAndMessage.anyToolUsed.input.templateId}`
      const templateResponse = {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: extractedToolAndMessage.anyToolUsed.id,
            content: userToolResp,
          },
        ],
      }
      fullPrompt.push(templateResponse)

      const nMessage = {
        aid,
        humanDerived: true,
        userId: user._id,
        orgId: user.orgId,
        slateShareId: shareId,
        created: Date.now(),
        type: CONSTANTS.ai.types.conversation,
        role: CONSTANTS.ai.role.node,
        prompt: templateResponse,
      }
      await AIContent.insertAsync(nMessage)

      if (isExpandTemplates) {
        const resp = await req({
          engine: welcomePrompt.engine,
          provider: welcomePrompt.provider,
          fallback: welcomePrompt.fallback,
          allowPlainText: true,
          validateResponse: validateWelcomeResponse,
          maxResponseValidationRetries: 2,
          feature: welcomePrompt.feature,
          system,
          aid,
          shareId,
          prompts: fullPrompt,
          functions: welcomePrompt.functions,
          function_call: welcomePrompt.function_call,
        })

        console.log('got resp after sending templates', {
          aid,
          tool: resp?.json?.content?.find?.((c) => c?.type === 'tool_use')?.name || null,
          bytes: JSON.stringify(resp ?? null).length,
        })

        // insert the latest from the system
        const latestAssistantMessage = {
          aid,
          humanDerived: false,
          userId: user._id,
          orgId: user.orgId,
          slateShareId: shareId,
          created: Date.now(),
          type: CONSTANTS.ai.types.conversation,
          role: CONSTANTS.ai.role.node,
          prompt: {
            role: 'assistant',
            content: resp.abortMessage ?? getNormalizedAssistantContent(resp),
          },
        }
        await AIContent.insertAsync(latestAssistantMessage)

        // reset this
        extractedToolAndMessage = extractToolAndMessage(resp)

        // console.log('extractedToolAndMessage post tool use', {
        //   isExpandTemplates,
        //   extractedToolAndMessage,
        // })

        if (extractedToolAndMessage.assistantResponse) {
          await Messages.insertAsync({
            author: `Slatebox AI`,
            timestamp: new Date().valueOf(),
            slateShareId: shareId,
            userId: `ai`,
            text: extractedToolAndMessage.assistantResponse,
            type: CONSTANTS.messageTypes.chat,
          })
        }
      }

      slateTemplateId =
        extractedToolAndMessage.anyToolUsed?.input?.slateTemplateId
      if (!slateTemplateId) {
        // Wizard entry forces setIntention (no expandTemplates round-trip),
        // so a named template can only survive in prose. Recover it
        // deterministically from the catalog instead of losing the journey.
        slateTemplateId = resolveTemplateFromText(
          templates,
          `${userMessage || ''} ${extractedToolAndMessage.assistantResponse || ''}`
        )
        if (slateTemplateId) {
          console.log(
            'resolved template from request text:',
            slateTemplateId
          )
        }
      }
      if (slateTemplateId) {
        const template = await Slates.findOneAsync(
          userSelectableTemplateSelector({ shareId: slateTemplateId })
        )
        if (!template) {
          console.log(
            'template does not exist will retry call',
            slateTemplateId
          )

          return Meteor.callAsync(CONSTANTS.methods.openai.welcome, {
            slateAid: aid,
            shareId,
            content: [
              {
                type: 'tool_result',
                tool_use_id: extractedToolAndMessage.anyToolUsed.id,
                content: `You provided slateTemplateId of ${slateTemplateId} but that does not exist.`,
              },
            ],
            isTemplate,
          })
        }
      }
    }
    // by design: no break here
    // eslint-disable-next-line no-fallthrough
    case 'setIntention': {
      if (!slateTemplateId) {
        // A bare setIntention (the wizard fast path FORCES this via
        // function_call, so expandTemplates exploration is impossible)
        // arrives here WITHOUT going through the preview/expand block.
        // Recover the template reference here: prefer the model-provided
        // slateTemplateId, else resolve a catalog template named in the
        // request text. Invalid ids degrade to no-template (never to a
        // retry loop).
        slateTemplateId =
          extractedToolAndMessage.anyToolUsed?.input?.slateTemplateId ||
          resolveTemplateFromText(
            templates,
            `${userMessage || ''} ${extractedToolAndMessage.assistantResponse || ''}`
          )
        if (slateTemplateId) {
          const resolved = await Slates.findOneAsync(
            userSelectableTemplateSelector({ shareId: slateTemplateId })
          )
          if (!resolved) {
            console.log(
              'setIntention template id failed catalog validation, dropping:',
              slateTemplateId
            )
            slateTemplateId = null
          } else {
            console.log(
              'setIntention template resolved:',
              slateTemplateId
            )
          }
        }
      }
      let intention = await ChatIntentions.findOneAsync({
        _id: extractedToolAndMessage.anyToolUsed?.input?.intentionId,
      })
      // console.log(
      //   'intentionId is',
      //   extractedToolAndMessage.anyToolUsed?.input?.intentionId,
      //   intention,
      //   slateTemplateId
      // )
      if (
        !intention &&
        extractedToolAndMessage.anyToolUsed?.input?.intentionId
      ) {
        console.log(
          'intention does not exist will retry call',
          extractedToolAndMessage.anyToolUsed?.input?.intentionId
        )

        return Meteor.callAsync(CONSTANTS.methods.openai.welcome, {
          slateAid: aid,
          shareId,
          content: [
            {
              type: 'tool_result',
              tool_use_id: extractedToolAndMessage.anyToolUsed.id,
              content: `You provided an intentionId of ${extractedToolAndMessage.anyToolUsed?.input?.intentionId} but that intention does not exist.`,
            },
          ],
          isTemplate,
        })
      }
      if (intention?.basedOnTemplate && !slateTemplateId) {
        // Template-population intentions carry {{templateName}}-style
        // prompts that can ONLY resolve against a concrete loaded template.
        // With no template in this journey, client assembly would drop
        // every prompt and abort contentless (live finding, journey
        // 106f80017c). Degrade to the default mindmap intention — same
        // 'degrade to no-template, never retry-loop' precedent as invalid
        // template ids — so brainstorm journeys still generate content.
        const fallbackIntention = await ChatIntentions.findOneAsync({
          isDefault: true,
        })
        if (fallbackIntention) {
          console.log(
            'setIntention basedOnTemplate without template, degrading:',
            intention._id,
            '->',
            fallbackIntention._id,
          )
          intention = fallbackIntention
        }
      }
      if (!intention) {
        systemResponse = {
          slateTemplateId,
        }
      } else {
        // the AI is not instructed to produce colorInstructions, just regular instructions - colorInstructions should come from whether or not there is an organizationSetting for this orgId and intentionId
        let overrideBackground = null
        let technicalInstructions = intention?.ai?.decisionTree?.inline
          ?.defaultTechnicalInstructions
          ? intention?.ai?.decisionTree?.inline?.defaultTechnicalInstructions
          : `Use varied fonts (Bangers, Graduate, IBM Plex Mono, Roboto Condensed, Nixie One, Caveat, Courier Prime, Indie Flower, Lemon, Permanent Marker). Given a {{baseColor}} background color, use a sophisticated color palette based on the color wheel principles: Either choose an analogous scheme (3-4 adjacent colors) creating smooth transitions between thoughts, or select a perfect triadic scheme using muted, sophisticated tones (reduce saturation to 60-70%). Each thought's supporting notes should use lighter tints (add 15-20% white) of their parent color. All colors should maintain consistent saturation and brightness levels. Test the full palette together before implementation to ensure visual harmony.`

        // console.log(
        //   'technicalInstructions are',
        //   user.orgId,
        //   intention?.ai?.decisionTree?.inline?.defaultTechnicalInstructions,
        //   technicalInstructions
        // )

        if (user.orgId) {
          let orgPreset = await OrganizationSettings.findOneAsync({
            orgId: user.orgId,
            intentionId: intention._id,
          })

          if (!orgPreset) {
            // fall back to the default
            orgPreset = await OrganizationSettings.findOneAsync({
              orgId: user.orgId,
              intentionId: 'default',
            })
          }

          const techInstructions = []
          const categoryDirectives = []
          const noteDirectives = []
          const fontSizes = []
          if (orgPreset) {
            if (orgPreset.value?.categoryStyles) {
              categoryDirectives.push(
                `use these combinations of colors: (${orgPreset.value.categoryStyles
                  .map(
                    (c) =>
                      `backgroundColor: ${c.backgroundColor}, foregroundColor: ${c.foregroundColor}`
                  )
                  .join('), (')})`
              )
            }
            if (orgPreset.value?.noteStyles) {
              noteDirectives.push(
                `use only the following combinations of colors: (${orgPreset.value.noteStyles
                  .map(
                    (c) =>
                      `backgroundColor: ${c.backgroundColor}, foregroundColor: ${c.foregroundColor}`
                  )
                  .join('), (')})`
              )
            }
            if (orgPreset.value?.categoryFontSize) {
              categoryDirectives.push(
                `set the fontSize to ${orgPreset.value.categoryFontSize}`
              )
              fontSizes.push(orgPreset.value.categoryFontSize)
            }
            if (orgPreset.value?.noteFontSize) {
              noteDirectives.push(
                `set the fontSize to ${orgPreset.value.noteFontSize}`
              )
              fontSizes.push(orgPreset.value.noteFontSize)
            }
            if (orgPreset.value?.categoryFont) {
              categoryDirectives.push(
                `set the fontFamily to ${orgPreset.value.categoryFont}`
              )
            } else {
              categoryDirectives.push(
                `select from the following font families: Bangers, Graduate, IBM Plex Mono, Roboto Condensed, Nixie One, Caveat, Courier Prime, Indie Flower, Lemon, Permanent Marker`
              )
            }
            if (orgPreset.value?.noteFont) {
              noteDirectives.push(
                `set the fontFamily to ${orgPreset.value.noteFont}`
              )
            } else {
              noteDirectives.push(
                `select from the following font families: Bangers, Graduate, IBM Plex Mono, Roboto Condensed, Nixie One, Caveat, Courier Prime, Indie Flower, Lemon, Permanent Marker`
              )
            }
            if (orgPreset.value?.background) {
              overrideBackground = {
                baseColor:
                  orgPreset.value.background?.colorValue ||
                  orgPreset.value.background?.gradientConfig?.baseColorValue,
                gradientLength:
                  orgPreset.value?.background?.gradientConfig
                    ?.gradientColorCount ?? 1,
                radialOrLinear:
                  orgPreset.value?.background?.gradientConfig?.gradientType ??
                  'linear',
              }
            }

            if (fontSizes.length > 0) {
              techInstructions.push(
                `Every note or category must have a minimum fontSize of ${Math.min(
                  ...fontSizes
                )}.`
              )
            }

            if (categoryDirectives.length > 0) {
              techInstructions.push(
                `When producing categories, ${categoryDirectives.join(', ')}.`
              )
            }
            if (noteDirectives.length > 0) {
              techInstructions.push(
                `When producing notes, ${noteDirectives.join(', ')}.`
              )
            }
            technicalInstructions = techInstructions.join(' ').trim()
          }
          console.log('custom tech instructions', {
            background: !!overrideBackground,
            length: technicalInstructions?.length ?? 0,
          })
        }

        systemResponse = {
          intention,
          slateTemplateId,
          instructions:
            extractedToolAndMessage.anyToolUsed?.input?.instructions,
          technicalInstructions,
          background:
            overrideBackground ??
            extractedToolAndMessage.anyToolUsed?.input?.background,
          applyBackground:
            /\b(theme|background|canvas|palette|gradient|recolor|colour|color scheme)\b/i.test(
              userMessage || ''
            ),
          intentionItems:
            extractedToolAndMessage.anyToolUsed.input.intentionItems,
        }
        if (!extractedToolAndMessage.assistantResponse) {
          await Messages.insertAsync({
            author: `Slatebox AI`,
            timestamp: new Date().valueOf(),
            slateShareId: shareId,
            userId: `ai`,
            text: `Got it — I’m building that now. You’ll see the slate take shape as I work.`,
            type: CONSTANTS.messageTypes.chat,
          })
        }
      }
      break
    }
    // no tool used
    default: {
      systemResponse = {
        text: extractedToolAndMessage?.assistantResponse,
      }
      break
    }
  }
  return systemResponse
}

let templates = null
method[CONSTANTS.methods.openai.welcome] = metered({ feature: 'welcome' }, async ({
  slateAid,
  shareId,
  content,
  isTemplate,
  initialPrompt,
  currentSlate,
}) => {
  if (!shareId) {
    console.trace()
    console.log('no shareId sent!', shareId)
    return null
  }

  const user = await Meteor.userAsync()
  // Continuing a welcome conversation follows the same rule as any conversation: the caller's
  // own, or one of a slate the caller may edit.
  if (user) await checkConversationTarget(user, { shareId, aid: slateAid })

  if (!templates || templates.length === 0) {
    // Re-query while empty: welcome calls are rare, and a module-level cache
    // frozen at boot (before seeding) silently disabled the whole template
    // product for the life of the pod.
    templates = await Slates.find(userSelectableTemplateSelector(), {
      fields: {
        _id: 1,
        shareId: 1,
        'options.name': 1,
        'options.description': 1,
      },
    }).fetchAsync()
  }

  if (user) {
    let welcomePrompt = await SystemSettings.findOneAsync({
      _id: 'welcomePrompt',
    })

    // if (!welcomePrompt) {
    welcomePrompt = {
      _id: 'welcomePrompt',
      title: 'Welcome Intention Prompt',
      ...resolveAIFeatureConfig('welcome', Meteor.settings),
      newBody: `You are the Slatebox Welcome Assistant Core Role: You guide users in creating "slates" - AI-powered data visualizations on Slatebox's collaborative platform. Your communication should be fun, engaging, and slightly irreverent, using emojis appropriately. Every slate can be collaborated on in real-time by multiple users. Communication Style: Keep responses conversational and natural, avoiding technical terms like "intention" or "validation"; Focus on understanding what the user wants to create. Use simple, friendly language to guide users toward their goals; Keep initial responses to 10-15 words unless more detail is requested; Initial greeting maximum: 20 words; Use emojis naturally to maintain an upbeat tone. Behind-the-Scenes Technical Requirements: 1. Intention Validation: Only use intentionIds from: {intentionsAvailable}; For templates: {templateIntentionId}; For default cases: {defaultIntentionId}; Never create or guess intentionIds; Ensure all intentionItems are collected before proceeding. 2. Document Handling: When documents are mentioned, respond only with: "👍 You now have [X] documents ready"; Return to previous conversation thread immediately; Use documents to satisfy intentionItem requirements. 3. Instruction Generation: Create detailed instructions from conversation context; Include as sibling parameter to intentionId; Reflect user's specific needs and goals, even if implicit; Never invoke setIntention without instructions. Core Capabilities: Presentations, Infographics, and Data Stories; Mind maps & Diagrams with data visualizations; Group collaborations on Templates ({templateCount} available - Examples: {topAvailableTemplates}). Interaction Flow: 1. Natural Understanding: Listen for user's goals and context; Infer appropriate intention type; Gather required information through natural conversation. 2. Gentle Confirmation: Summarize understanding in user-friendly terms; Seek simple agreement before proceeding; Example: "Sounds like you want to create a visual story about your data. Should we start there? 😊" 3. Template Handling: Use expandTemplates for complete list; Use previewTemplate(slateTemplateId) as needed; Present options conversationally; Collect requirements naturally. 4. Execution: Verify all required items are present; Call setIntention with appropriate parameters; Keep technical details behind the scenes. Priority: Keep conversation flowing naturally; Maintain all technical validations internally; Ensure requirements are met without explicit discussion; Focus on user's creative goals rather than technical process. Once you respond with setIntention, do not ask a question - simply state what approach you've invoked (the user will be able to make follow up questions after the intention loads - but you do not need to give the user any of these details)`,
      oldBody: `You are the Slatebox Welcome Assistant Core Role: You guide users in creating "slates" - AI-powered data visualizations on Slatebox's collaborative platform. Your communication should be fun, engaging, and slightly irreverent, using emojis appropriately. While your job here is to figure out what intention the user wants to use, avoid using the word 'intention' at any time in the conversation - keep things simple and direct about what they want to do - use the concept of "what approach would you like to take" to understand what they want to do. When referencing possible approaches, say what you can do (e.g., 'build a mindmap', 'create a presentation', etc.), but again avoid mentioning the intention by name. Once you have figured out the approach, ensure you provide the background object - the baseColor should be a color that matches the theme of the intention. CRITICAL VALIDATIONS: Idea Validation Before Execution: Before kicking off any intention, present the "idea" (e.g., the proposed slate type, data story, or template) to the user for approval. Do not proceed with setIntention until the user signs off on the idea. The one exception is that when you receive a request with two exclamation points (!!) then immediately call setIntention regardless of whether you have gathered all the information along with a note describing what you're doing. So if the user provides 'puppies!!'' then you would immediately use the {defaaultIntentionId} in the setIntention and do your best to provide instructions and NOT wait for the user's approval. Likewise, 'puppies as a dynamic presentation!!'' would mean immediately calling setIntention with the dynamic-presentation intentionId and create detailed instructions. All requests absent the '!!' suffix should go through the regular process of getting the user's approval. Any desire to build a mind-map or diagram and you will most likely require the expert-collaborator intention. There are a number of intentions, so match the approach as closely as possible to the intention being requested. (For instance, any mention of infographics would go directly to the infographic-architect intention). Sticky-note driven ideas (where you'd want to whiteboard ideas on sticky notes) will always require the {templateIntentionId} template. Intention ID Validation: ONLY use intentionIds from this list: {intentionsAvailable} For templates, ONLY use: {templateIntentionId} For default cases, ONLY use: {defaultIntentionId}. For ALL intention invocations, you must analyze the conversation context and create a detailed 'instructions' parameter that provide fine-tuning guidance for the downstream intention - these instructions must be provided as a sibling parameter to intentionId and should reflect the user's specific needs and goals as revealed through the conversation, even if not explicitly stated. Do you have ALL the intentionItems? If not, never invoke the setIntention function. Never create or guess intentionIds; always ensure they exist. Required Items: Documents (PDFs, images, text) can be used to satisfy any intentionItem requirements. If the user provides initial clear direction, use that to satisfy intentionItems. Only engage in back-and-forth when the user needs help determining requirements. Before calling setIntention, verify ALL required intentionItems are collected. Response Protocol: Keep all responses to 10-20 words unless the user requests more detail. Initial greeting maximum: 25 words. Focus on actionable next steps; avoid unnecessary explanation. Document uploads: When users mention that they have uploaded or removed any documents, ONLY respond with: "👍 You now have [X] documents ready." In this case you do NOT need to know the contents of the document, but just continue the conversation knowing that once you do call setIntention, that process will be able to read these documents. So after you confirm the document upload or removal has happened, simply continue the conversation. Main Capabilities: Presentations and Data Stories Mind maps & Diagrams with data visualizations Group collaborations on pre-made Templates ({templateCount} available - Examples: {topAvailableTemplates}) Interaction Flow: Idea Presentation: Based on the user's input, propose an idea (e.g., a slate type, template, or data story). Present the idea clearly and concisely for user approval. Example: "Here's the idea: a mind map visualizing your project workflow. Sound good? 👍👎" Do not proceed until the user explicitly sees this idea once you have gathered all the intentionItems and approves the idea. They need to give a thumbs up to the actual idea that you create from the conversation. Do NOT proceed to setIntention until you have confirmed this with them. If the user starts with a specific topic that warrants a mind map or diagram, then immediately use {defaultIntentionId}. Only ask for missing required items after the idea is approved. For template exploration: Call expandTemplates for a complete list. Use the tool previewTemplate(slateTemplateId) as needed. Present the selected template as the idea for user approval. Collect required items for templateIntentionId only after the idea is approved. Call setIntention. For other cases: Match user needs to intentionsAvailable. Present the proposed idea for user approval. Collect only missing intentionItems after the idea is approved. Use setIntention with appropriate parameters. Item Collection: Check provided documents/information first. Only ask for truly missing items after the idea is approved. Verify completeness. Execute setIntention. Primary Focus: Efficient collection of intentionItems while maintaining engaging interaction. Ensure the user approves the idea before proceeding with any intention.`,
      body: "You are the Slatebox Welcome Assistant Core Role: You guide users in creating slates - AI-powered data visualizations on Slatebox's collaborative platform. Your communication should be fun, engaging, and slightly irreverent, using emojis appropriately. Note that generating the actual slate (once you call the setIntention tool) can take upwards of 60 seconds, so ensure the user knows. While your job here is to figure out what intention the user wants to use, avoid using the word intention at any time in the conversation - keep things simple and direct about what they want to do - use the concept of what approach would you like to take to understand what they want to do. When referencing possible approaches, say what you can do (e.g., build a mindmap, create a presentation, etc.), but again avoid mentioning the intention by name. Once you have figured out the approach, ensure you provide the background object - the baseColor should be a color that matches the theme of the intention. CRITICAL VALIDATIONS: Remove any requirement that the user must approve an idea before continuing. As soon as an idea is presented and an approach is understood, immediately call setIntention with thorough intentionItems and instructions reflecting what the user has shared. The one caveat is that if the user explicitly asks to have a back and forth or wait for approval, respect that. The one exception is that when you receive a request with two exclamation points (!!) then immediately call setIntention whether you have all information or not, along with a note describing what you're doing. For instance, if the user provides puppies!! then you would immediately use the {defaultIntentionId} in setIntention. Likewise, if the user says puppies as a dynamic presentation!! then call setIntention with the dynamic-presentation intentionId. Any desire to build a mind-map or diagram means you will likely require the expert-collaborator intention. There are a number of intentions, so match the approach as closely as possible. For infographics, use infographic-architect intention. For sticky-note driven whiteboarding, use {templateIntentionId}. Intention ID Validation: ONLY use intentionIds from {intentionsAvailable}. For templates, ONLY use {templateIntentionId}. For default cases, ONLY use {defaultIntentionId}. For ALL setIntention calls, analyze the conversation context and create a detailed instructions parameter with fine-tuning guidance, reflecting the user's specifics. Do you have ALL the intentionItems? If not, never invoke setIntention. Never create or guess intentionIds; always ensure they exist. Required Items: Documents can be used to satisfy any intentionItem. Use user-provided documents to fill intentionItems. Only engage in back-and-forth if the user needs help determining requirements. Once setIntention is called, the process will read the documents. If the user uploads or removes documents, respond only with: 👍 You now have [X] documents ready. Then continue. Response Protocol: Keep responses to 10-20 words unless the user wants more detail. Initial greeting max 25 words. Be concise. Document uploads: Acknowledge with the thumbs up message and doc count. Then continue. Main Capabilities: Presentations, Data Stories, Mind maps, Diagrams, Group collaborations on templates ({templateCount} available, e.g. {topAvailableTemplates}). Interaction Flow: As soon as you identify an approach, present the idea in a fun, succinct way. If the user does not explicitly want a back-and-forth or approval, immediately proceed to setIntention once you have all required intentionItems. For template exploration, call expandTemplates for a list. Then use previewTemplate if needed. Then present the selected template as the idea. If you have enough info, call setIntention with the appropriate intentionId and instructions. Item Collection: Check existing user-provided docs. Collect only missing items. Then setIntention. Primary Focus: Efficiently gather intentionItems while staying engaging. No approval needed unless the user explicitly requests it.",
      functions: [
        SLATE_OPERATION_TOOL,
        {
          name: 'setIntention',
          description: 'This is your response to the last query',
          parameters: {
            type: 'object',
            properties: {
              intentionId: {
                type: 'string',
                description:
                  'This is the intention id of the intention they have chosen.',
              },
              background: {
                type: 'object',
                properties: {
                  baseColor: {
                    type: 'string',
                    description:
                      'What is the hex base color of the background of the slate? Use color psychology to choose color scheme that represents the topic and color theory to choose colors that create an overall appealing look. This will be used as the baseline color to produce n number of similar shaded colors.',
                  },
                  gradientLength: {
                    type: 'number',
                    description:
                      'How deep is the gradient? This is the number of shades of color that will be used to produce the gradient, based on the basecolor.',
                  },
                  radialOrLinear: {
                    type: 'string',
                    description:
                      'Specify either a "gradient" or a "linear" gradient depending on which best matches the theme of the intention.',
                  },
                },
                required: ['baseColor', 'gradientLength', 'radialOrLinear'],
              },
              instructions: {
                type: 'string',
                minLength: 1000,
                description:
                  'These are the fine-tuning instructions for the intention they have chosen. This must be inferred based on the conversation history and the intention they have chosen and not explicitly requested by the user. The instructions are critical to enacting the implementation the user is going for, so provide 150 to 220 words covering structure, content, hierarchy, visual treatment, relationships, and constraints.',
              },
              slateTemplateId: {
                type: 'string',
                description:
                  'Provide the shareId of the template if applicable. Remember to only send back a valid shareId, and ensure you called expandTemplates first if you did not have it in hand.',
              },
              intentionItems: {
                type: 'array',
                description:
                  'This is the list of items that are required for the intention they have chosen.',
                items: {
                  type: 'object',
                  properties: {
                    key: {
                      type: 'string',
                      description: 'This is the key of the gathered item',
                    },
                    value: {
                      type: 'string',
                      description: 'This is the value of the gathered item.',
                    },
                  },
                  required: ['key', 'value'],
                },
              },
            },
            required: [
              'intentionId',
              'background',
              'instructions',
              'intentionItems',
            ],
          },
        },
        {
          name: 'previewTemplate',
          description: 'Preview a specific template',
          parameters: {
            type: 'object',
            properties: {
              slateTemplateId: {
                type: 'string',
                description:
                  'Provide the shareId of the template if applicable. Remember to only send back a valid shareId, and ensure you called expandTemplates first if you did not have it in hand.',
              },
            },
            required: ['slateTemplateId'],
          },
        },
        {
          name: 'expandTemplates',
          description: 'Get all the available templates',
          parameters: {
            type: 'object',
            properties: {
              expand: {
                type: 'boolean',
                description:
                  'Set to true when the user wants to see all the available templates.',
              },
            },
            required: ['expand'],
          },
        },
      ],
      function_call: { type: 'auto' },
    }
    // await SystemSettings.insertAsync(welcomePrompt)
    // }

    const {
      aid,
      existingConversation,
      useClaude,
      fullPrompt,
      system,
    } = await initUsage({
      aid: slateAid,
      shareId,
      content,
      engine: welcomePrompt.engine,
      provider: welcomePrompt.provider,
      ongoingConversationRider: currentSlate?.nodes?.length
        ? `This is an existing slate. Prefer applySlateOperations for direct edits, preserve unrelated content and styling, and never change the theme unless explicitly requested. Current slate state: ${JSON.stringify(
            currentSlate
          )}`
        : '',
    })

    // console.log('init question', aid, content, existingConversation, fullPrompt)


    let resp = null
    if (existingConversation.length > 1) {
      async function continueConversation() {
        // continuing the conversation
        resp = await req({
          engine: welcomePrompt.engine,
          provider: welcomePrompt.provider,
          fallback: welcomePrompt.fallback,
          allowPlainText: true,
          validateResponse: (response) =>
            validateWelcomeResponse(response, {
              userMessage: content?.[0] || initialPrompt || '',
              existingNodeIds:
                currentSlate?.nodes?.map((node) => node.id) || [],
            }),
          maxResponseValidationRetries: 1,
          feature: welcomePrompt.feature,
          system,
          aid,
          shareId,
          prompts: fullPrompt, // content or other convos already here (either via the initUsage fullPrompt push or via that same thing below)
          functions: welcomePrompt.functions,
          function_call: resolveWelcomeFunctionCall(
            content,
            welcomePrompt.function_call
          ),
        })

        const nextMessage = {
          aid,
          humanDerived: false,
          userId: user._id,
          orgId: user.orgId,
          slateShareId: shareId,
          created: Date.now(),
          type: CONSTANTS.ai.types.conversation,
          role: CONSTANTS.ai.role.node,
          prompt: {
            role: 'assistant',
            content: resp.abortMessage ?? getNormalizedAssistantContent(resp),
          },
        }
        fullPrompt.push(nextMessage.prompt)
        await AIContent.insertAsync(nextMessage)

        const extractedToolAndMessage = extractToolAndMessage(resp)

        console.log('anyToolUsed', { aid, tool: extractedToolAndMessage?.anyToolUsed?.name || null })

        return invokeTool({
          extractedToolAndMessage,
          fullPrompt,
          templates,
          isTemplate,
          aid,
          user,
          shareId,
          system,
          welcomePrompt,
          userMessage: content?.[0] || initialPrompt || '',
        })
      }

      return continueConversation()
    }
    // this is the initial message
    const intentions = await ChatIntentions.find(
      {
        $and: [
          {
            $or: [
              { universal: true },
              // { orgId: user?.orgId },
              // { userId: user._id },
            ],
          },
          {
            $or: [{ active: { $exists: false } }, { active: true }],
          },
        ],
      },
      {
        fields: {
          _id: 1,
          name: 1,
          gather: 1,
          details: 1,
          basedOnTemplate: 1,
          isDefault: 1,
        },
      }
    ).fetchAsync()

    let prompt = null
    let welcomeFunctions = null
    const defaultIntentionId = intentions.find((i) => i.isDefault)?._id
    const templateIntentionId = intentions.find((i) => i.basedOnTemplate)?._id // this is the default intentionId for all templates
    const templateName = isTemplate
      ? await Slates.findOneAsync({ _id: isTemplate })?.options?.templateName
      : 'slate'
    if (isTemplate) {
      prompt = `The user is filling out the ${templateName} template. Find out of the user would like to add any additional context to the conversation, and if so, expect the user to provide uploaded documents. Once they have confirmed that they do not need additional documents, or have provided those documents, then please fire the setIntention function with the ${templateIntentionId}.`
    } else {
      // Empty catalog → prune template routing entirely and redirect
      // sticky-note-style requests to the default intention (which
      // generates) instead of a contentless template fill.
      const routing = pruneEmptyTemplateCatalog({
        templateCount: templates.length,
        body: welcomePrompt.body,
        functions: welcomePrompt.functions,
        intentions,
      })
      prompt = routing.body
        .replace(
          '{intentionsAvailable}',
          routing.intentions
            .map((i, cnt) => {
              const fullItemPrompt = extractRequiredAndOptionalItems(i)
              return `(${cnt + 1}) ${i.name} (intentionId: ${
                i._id
              }) - ${i.details.trim()}. ${fullItemPrompt}`
                .trim()
                .replace(/\{\{[a-zA-Z]+\}\}/g, 'template')
            })
            .join('; ')
        )
        .replace(
          '{topAvailableTemplates}',
          templates
            .slice(0, 10)
            .map((i, cnt) =>
              `(${cnt}) ${
                i.options.name
              } - ${i.options.description.trim()}, (id: ${i.shareId})`.trim()
            )
            .join('; ')
        )
        .replace('{defaultIntentionId}', defaultIntentionId)
        .replace('{templateIntentionId}', templateIntentionId)
        .replace('{templateCount}', templates.length)
        .trim()
      welcomeFunctions = routing.functions
    }

    const initMessages = []
    let systemMessage = null
    const initUserMessage =
      content?.[0] ||
      initialPrompt ||
      (isTemplate
        ? `I'd like to build out this ${templateName} template.`
        : `Hi, I'm here to build a new slate.`)

    if (currentSlate?.nodes?.length) {
      prompt = `${prompt}\n\nEXISTING SLATE EDITING: The user already has a slate with the state below. When they ask to add, edit, move, resize, arrange, connect, disconnect, restyle, or delete specific existing-slate content, call applySlateOperations instead of setIntention. Preserve everything the user did not request. Never change the slate background, theme, palette, name, or unrelated nodes unless explicitly requested. Resolve relative placement from the supplied node ids. Existing slate state: ${JSON.stringify(
        currentSlate
      )}`
    }

    if (!content?.[0]) {
      // note that if content[0] exists than this was a user sent request direct via the chat
      await Messages.insertAsync({
        author:
          user?.profile?.name || user?.emails?.[0]?.address?.split('@')[0],
        timestamp: new Date().valueOf(),
        slateShareId: shareId,
        userId: user._id,
        text: initUserMessage,
        type: CONSTANTS.messageTypes.chat,
      })
    }

    if (useClaude) {
      systemMessage = prompt
      initMessages.push({
        role: 'user',
        content: initUserMessage,
      })
    } else {
      initMessages.push(
        {
          role: 'system',
          content: prompt,
        },
        {
          role: 'user',
          content: initUserMessage,
        }
      )
    }

    for (const m of initMessages) {
      const initContent = {
        aid,
        humanDerived: false,
        userId: user._id,
        orgId: user.orgId,
        slateShareId: shareId,
        created: Date.now(),
        type: CONSTANTS.ai.types.conversation,
        role: CONSTANTS.ai.role.node,
        system: systemMessage,
        prompt: m,
      }
      await AIContent.insertAsync(initContent)
    }

    resp = await req({
      prompts: initMessages,
      system: systemMessage,
      engine: welcomePrompt.engine,
      provider: welcomePrompt.provider,
      fallback: welcomePrompt.fallback,
      allowPlainText: true,
      validateResponse: (response) =>
        validateWelcomeResponse(response, {
          userMessage: initUserMessage,
          existingNodeIds: currentSlate?.nodes?.map((node) => node.id) || [],
          requireSetIntention: Boolean(initialPrompt),
        }),
      maxResponseValidationRetries: 2,
      feature: welcomePrompt.feature,
      aid,
      shareId,
      content,
      functions: welcomeFunctions,
      function_call: initialPrompt
        ? { name: 'setIntention' }
        : resolveWelcomeFunctionCall(content, welcomePrompt.function_call),
    })

    const extractedToolAndMessage = extractToolAndMessage(resp)
    console.log('check to see if message is inserted', { aid, tool: extractedToolAndMessage?.anyToolUsed?.name || null })

    const nextMessage = {
      aid,
      humanDerived: false,
      userId: user._id,
      orgId: user.orgId,
      slateShareId: shareId,
      created: Date.now(),
      type: CONSTANTS.ai.types.conversation,
      role: CONSTANTS.ai.role.node,
      prompt: {
        role: 'assistant',
        content: resp.abortMessage ?? getNormalizedAssistantContent(resp),
      },
    }
    fullPrompt.push(nextMessage.prompt)
    await AIContent.insertAsync(nextMessage)

    // in case there was a tool included out of the gate
    const initResult = await invokeTool({
      extractedToolAndMessage,
      fullPrompt,
      templates,
      isTemplate,
      aid,
      user,
      shareId,
      system,
      welcomePrompt,
      userMessage: initUserMessage,
    })

    // console.log('resp is', aid, JSON.stringify(resp, null, 2))
    // console.log('got json msg', resp.json?.content?.[0]?.text)

    return {
      ...initResult,
      slateAid: aid,
    }
  }
  return null
})

method[CONSTANTS.methods.openai.operationCompleted] = async ({
  shareId,
  operationRequestId,
  status = 'success',
}) => {
  const user = await Meteor.userAsync()
  if (!user || !shareId) throw new Meteor.Error('not-authorized')
  const slate = await Slates.findOneAsync({ shareId })
  if (!slate) throw new Meteor.Error('slate-not-found')
  const canEdit = await canUserEditSlate(user, slate)
  if (!canEdit) throw new Meteor.Error('not-authorized')
  const pending = pendingSlateOperations.get(operationRequestId)
  if (
    !pending ||
    pending.userId !== user._id ||
    pending.shareId !== shareId ||
    pending.expiresAt < Date.now()
  ) {
    if (operationRequestId) pendingSlateOperations.delete(operationRequestId)
    throw new Meteor.Error('invalid-operation-completion')
  }
  pendingSlateOperations.delete(operationRequestId)
  if (status === 'error') {
    return insertAIChatMessage(
      shareId,
      `I couldn't finish that change. The rest of your slate was left alone. Try again, or describe the target node another way.`
    )
  }
  return insertAIChatMessage(shareId, pending.text)
}

method[CONSTANTS.methods.openai.routeSlateMessage] = metered({ feature: 'welcome', countsAsDraft: false }, async ({
  shareId,
  userMessage,
  currentSlate,
}) => {
  const user = await Meteor.userAsync()
  const slate = await Slates.findOneAsync({ shareId })
  if (!(await canUserEditSlate(user, slate))) {
    throw new Meteor.Error('not-authorized')
  }
  if (!userMessage?.trim() || !currentSlate?.nodes?.length) {
    return { delegated: true }
  }

  const recentMessages = await Messages.find(
    { slateShareId: shareId, type: CONSTANTS.messageTypes.chat },
    { sort: { timestamp: -1 }, limit: 10 }
  ).fetchAsync()
  const prompts = recentMessages.reverse().map((message) => ({
    role: message.userId === 'ai' ? 'assistant' : 'user',
    content: message.text,
  }))
  const config = resolveAIFeatureConfig('welcome', Meteor.settings)
  const delegateTool = {
    name: 'delegateToConversation',
    description:
      'Use when the user is discussing, asking a question, requesting research or content generation, or is not asking for a concrete edit to existing slate objects.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: { type: 'string' },
      },
      required: ['reason'],
    },
  }
  const response = await req({
    ...config,
    allowPlainText: false,
    system: `Route the latest user message. Call applySlateOperations only for a concrete edit to the existing slate: adding, changing, moving, arranging, connecting, styling, locking, animating, or deleting slate objects. Resolve references to supplied node ids. Preserve all unrequested content and styling. Never turn the user's request into a node. Never change theme, canvas background, or slate metadata unless explicitly requested. For discussion, questions, ideation, research, or richer content generation, call delegateToConversation. Current slate: ${JSON.stringify(
      currentSlate
    )}`,
    prompts,
    functions: [SLATE_OPERATION_TOOL, delegateTool],
    function_call: { type: 'auto' },
    validateResponse: (routeResponse) =>
      validateSlateMessageRoute(routeResponse, {
        userMessage,
        existingNodeIds: currentSlate.nodes.map((node) => node.id),
      }),
    maxResponseValidationRetries: 2,
    feature: `${config.feature || 'welcome'}-route`,
    shareId,
  })
  const extracted = extractToolAndMessage(response)
  if (extracted.anyToolUsed?.name !== 'applySlateOperations') {
    return { delegated: true }
  }
  return invokeTool({
    extractedToolAndMessage: extracted,
    user,
    shareId,
    userMessage,
  })
})

// Who may run a conversation where: a signed-in account (a guest is one), on a slate it may edit
// (a slate not saved yet has no one to protect), continuing only a conversation of its own or
// of that slate.
async function checkConversationTarget(user, opts) {
  if (opts.shareId !== undefined && opts.shareId !== null) {
    check(opts.shareId, String)
    const slate = await findSlate({ shareId: opts.shareId })
    if (slate && !await canEditSlate(user._id, slate)) throw new Meteor.Error('slate-denied', 'You do not have permission to change this slate.')
  }
  if (opts.aid !== undefined && opts.aid !== null) {
    check(opts.aid, String)
    const owner = await AIContent.findOneAsync({ aid: opts.aid }, { fields: { userId: 1, slateShareId: 1 } })
    if (owner && owner.userId !== user._id && !(opts.shareId && owner.slateShareId === opts.shareId)) {
      throw new Meteor.Error('conversation-denied', 'That conversation belongs to another slate.')
    }
  }
  const docs = opts.isConversation?.uploadedDocs
  if (docs !== undefined && docs !== null) {
    const ownFiles = `${storedFileBase()}/`
    if (!Array.isArray(docs) || docs.length > 5 || docs.some(d => typeof d?.url !== 'string' || !d.url.startsWith(ownFiles) || typeof d.docType !== 'string')) {
      throw new Meteor.Error('documents-denied', 'Only files uploaded to Slatebox can be read in a conversation.')
    }
  }
}

method[CONSTANTS.methods.openai.chat] = metered({ feature: 'generation' }, async (opts) => {
  check(opts, Match.ObjectIncluding({ content: Match.Any, maxSize: Match.Maybe(Match.Integer) }))
  const asOfDate = Date.now()
  const user = await Meteor.userAsync()
  if (user && opts.content) {
    if (JSON.stringify(opts.content).length > 200000) throw new Meteor.Error('too-long', 'That request is too long.')
    await checkConversationTarget(user, opts)
    // opts.prompt = [{"role": "user", "content": "Hello!"}]
    // or:
    /*
      [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Who won the world series in 2020?"},
        {"role": "assistant", "content": "The Los Angeles Dodgers won the World Series in 2020."},
        {"role": "user", "content": "Where was it played?"}
      ]
    */

    // console.log('openai chat opts', JSON.stringify(opts, null, 2))

    // Feature selection follows PAYLOAD MODALITY, not intention metadata: only
    // requests that actually carry image content resolve 'vision'. Legacy
    // intention docs carry stale isVision flags (e.g. Template-Population),
    // which used to misroute pure-text fills into vision models.
    const hasImagePayload =
      (opts.isConversation?.uploadedDocs || []).some((d) => d?.isImage) ||
      JSON.stringify(opts.content || '').includes('"base64"')
    const generationConfig = resolveAIFeatureConfig(
      hasImagePayload ? 'vision' : 'generation',
      Meteor.settings,
    )
    const useStrictGenerationValidation =
      opts.isConversation?.id === 'expert-collaborator'

    // A one-off request is always a new conversation, so it always records its own credit: a
    // caller-chosen aid would let every later request reuse the first one's credit.
    if (opts.processImmediately) opts = { ...opts, aid: undefined }
    let { aid, existingConversation, useClaude, fullPrompt } =
      await initUsage({
        ...opts,
        ...(generationConfig || {}),
        ongoingConversationRider: opts.isConversation?.ongoingConversationRider,
      })


    // console.log('going to call? ', opts)
    if (opts.processImmediately) {
      // A one-off request is a credit like any new conversation, under the fresh aid above.
      {
        await AIContent.insertAsync({
          aid,
          humanDerived: true,
          userId: user._id,
          orgId: user.orgId,
          slateShareId: opts.shareId,
          created: Date.now(),
          type: CONSTANTS.ai.types.conversation,
          role: CONSTANTS.ai.role.coordinator,
          state: CONSTANTS.ai.state.complete,
          denotesCreditUsed: true,
          month: new Date().getMonth() + 1,
        })
      }
      // The fast path previously fired req() with no provider/engine/feature,
      // so it hit the keyless default provider and died at the key check
      // (live audit evidence: sub-150ms provider_error bursts). Route it
      // through the generation feature config like every other call.
      const immediateConfig = resolveAIFeatureConfig(
        'generation',
        Meteor.settings,
      )
      const resp = await req({
        ...immediateConfig,
        prompts: [
          {
            role: 'user',
            content: opts.content,
          },
        ],
        maxSize: opts.maxSize ? Math.min(Math.max(opts.maxSize, 1), 4000) : opts.maxSize,
      })
      // console.log('response finished', resp)
      return resp
    }

    switch (opts.type) {
      case CONSTANTS.ai.types.template:
      case CONSTANTS.ai.types.conversation:
      default: {
        let palette = []

        if (
          existingConversation.length === 1 &&
          opts.isConversation?.uploadedDocs
        ) {
          // this is a new conversation with a doc type
          const userPrompt = [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: opts.content[0],
                },
              ],
            },
          ]

          if (useClaude) {
            const shiftedPrompts = []
            for (const doc of opts.isConversation.uploadedDocs) {
              if (doc.docType.includes('text')) {
                // A file stored in this app's database is read from there (fileStore.js).
                const stored = await readStoredFile(doc.url)
                if (stored && !/^text\/plain\b/.test(stored.contentType)) throw new Meteor.Error('documents-denied', 'That file is not text.')
                shiftedPrompts.push({
                  type: 'text',
                  text: (stored ?? (await safeFetch(doc.url, { maxBytes: 2 * 1024 * 1024, contentTypes: ['text/plain'] }))).bytes.toString('utf8'),
                  cache_control: { type: 'ephemeral' },
                })
              } else {
                // Handle images and other document types with base64
                const base64 = await Meteor.callAsync(
                  CONSTANTS.methods.utils.base64StringFromRemoteUrl,
                  {
                    type: doc.docType,
                    url: doc.url,
                  }
                )
                shiftedPrompts.push({
                  type: doc.isImage ? 'image' : 'document',
                  source: {
                    type: 'base64',
                    media_type: doc.docType,
                    data: base64.split(',')[1],
                  },
                  cache_control: { type: 'ephemeral' },
                })
              }
              // console.log('added base64 cached doc', doc.docType)
            }
            userPrompt[0].content.unshift(...shiftedPrompts)
          }

          // override the fullPrompt with the userPrompt
          fullPrompt = userPrompt

          // this is a new conversation, so mark it so the ai usage
          // picks up this entire slate as one credit used.
          await AIContent.insertAsync({
            aid,
            humanDerived: true,
            userId: Meteor?.userId(),
            orgId: Meteor?.user()?.orgId,
            slateShareId: opts.shareId,
            created: Date.now(),
            type: CONSTANTS.ai.types.conversation,
            role: CONSTANTS.ai.role.coordinator,
            state: CONSTANTS.ai.state.complete,
            denotesCreditUsed: true,
            month: new Date().getMonth() + 1,
          })

          if (opts.type === CONSTANTS.ai.types.conversation) {
            palette = await Meteor.callAsync(
              CONSTANTS.methods.colors.buildColorPalette,
              {
                type: 'palette',
              }
            )
          }
        }

        const exactEchoId = opts.content
          .join('')
          .split('[exactEchoId:')?.[1]
          ?.replace(/\]|\./, '')

        const aiOpts = {
          id: aid,
          aid,
          type: opts.type,
          userId: Meteor?.userId(),
          orgId: Meteor?.user()?.orgId,
          shareId: opts.shareId,
          functions: opts.functions,
          defaultShapes: opts.defaultShapes,
          instructions: opts.instructions, // should be the 'handoff' fine-tuned instructions by the welcome assistant, OR the defaulInstructions on the intention
          colorInstructions: opts.colorInstructions,
          prompts: fullPrompt,
          errorCount: 0,
          function_call: opts.function_call,
          mainNodeId: opts.mainNodeId,
          layoutType: opts.layoutType,
          errorChecks: opts.errorChecks,
          rootProperty: opts.rootProperty,
          isNew: existingConversation.length === 0,
          // the server chooses the model; a browser's engine is ignored
          engine: pinnedEngine(generationConfig),
          provider: generationConfig?.provider,
          fallback: generationConfig?.fallback,
          feature: generationConfig?.feature,
          validateResponse:
            generationConfig && useStrictGenerationValidation
              ? validateGenerationResponse
              : undefined,
          maxResponseValidationRetries:
            generationConfig && useStrictGenerationValidation ? 1 : undefined,
          postProcessing: opts.postProcessing,
          skipCategories: opts.skipCategories,
          transparentConnections:
            opts.isConversation?.aiDecision?.transparentConnections,
          isAdhoc: opts.isConversation?.id === 'adhoc',
          exactEchoId,
        }

        // the pipeline runs after this method returns; its request stays open (and counted) until it ends
        keepActionOpen(processConversation(aiOpts)).catch((err) => {
          // A failed pipeline must never take the process down: an unhandled
          // rejection here previously killed the whole container (error-threshold throw).
          // Log the STACK + aid: message-only logging left the 3f04265bdf
          // 'null.id' incident with no throw-site for a full debugging pass.
          console.error(
            'conversation pipeline failed',
            err?.stack || `${err?.message || err}\n(no stack)`,
            'aid:',
            aiOpts.aid
          )
        })

        return {
          aid,
          asOfDate,
          slatePalette: palette,
        }
      }
    }
  }

  return null
})

// A person removes one AI row of their own. The owner is read from the stored row.
method[CONSTANTS.methods.openai.deleteAIContent] = async function deleteAIContent(doc) {
  check(doc, Match.ObjectIncluding({ _id: String }))
  if (!this.userId) return false
  return (await AIContent.removeAsync({ _id: doc._id, userId: this.userId })) > 0
}

// The prompt a slate was first generated from, for a person who may read that slate.
method[CONSTANTS.methods.openai.fetchOriginalPrompt] = async (shareId) => {
  check(shareId, String)
  const user = await Meteor.userAsync()
  if (user && shareId && await canReadSlate(user._id, await findSlate({ shareId }))) {
    const searchOpts = {
      slateShareId: shareId,
      role: CONSTANTS.ai.role.coordinator,
      state: CONSTANTS.ai.state.pending,
    }
    const init = await AIContent.findOneAsync(searchOpts)
    // console.log(
    //   'found init',
    //   typeof init?.fullPrompt[1]?.content,
    //   init?.fullPrompt[1]?.content
    // )
    if (init?.fullPrompt[1]?.content) {
      const clean = init.fullPrompt[1].content.replace(/word "(\w*)"/gi, (m) =>
        m.replace(/"/gi, '')
      )
      const prompt = JSON.parse(clean)
      return prompt.mainPrompt || prompt.problem
    }
  }
  return { empty: true }
}

Meteor.methods(method)
