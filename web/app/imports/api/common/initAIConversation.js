/* eslint-disable no-underscore-dangle */
/* eslint-disable no-param-reassign */
/* eslint-disable camelcase */
import { Random } from 'meteor/random'
import { Meteor } from 'meteor/meteor'
import { Slatebox } from 'slateboxjs'
import difference from 'lodash.difference'
import prepAISlate from './prepAISlate'
import CONSTANTS from './constants'
import defaultShapes from '../../ui/components/node/defaultShapes'
import pathAtOrigin from '../../ui/components/node/pathAtOrigin'
import parseTemplateIntoCategories from './parseTemplateIntoCategories'
function getDocType(url) {
  let docType = null
  let isImage = true
  if (url.indexOf('png') > -1) {
    docType = 'image/png'
  } else if (url.indexOf('jpg') > -1 || url.indexOf('jpeg') > -1) {
    docType = 'image/jpeg'
  } else if (url.indexOf('webp') > -1) {
    docType = 'image/webp'
  } else if (url.indexOf('gif') > -1) {
    docType = 'image/gif'
  } else if (url.indexOf('pdf') > -1) {
    docType = 'application/pdf'
    isImage = false
  } else if (url.indexOf('svg') > -1) {
    docType = 'image/svg+xml'
    isImage = false
  } else if (url.indexOf('txt') > -1) {
    docType = 'text/plain'
    isImage = false
  }
  return { docType, isImage }
}

/* 
This function starts an agent conversation on a Slatebox canvas. The welcome flow calls it with the
kind of slate the agent chose (server/methods/ai/generation-kinds.mjs); the note actions call it with
the adhoc kind (adhoc-kind.mjs).

Key Parameters:
- slate: The current Slatebox canvas instance
- intention: The kind of slate, with its decision tree and prompts
- result: The values gathered for it (the agent's intentionItems, or the note action's prompt)
- showWelcome: Boolean to control if welcome message should be shown
- aid: Optional AI conversation ID if continuing an existing conversation
*/

export default async function initAIConversation({
  slate,
  intention,
  result,
  showWelcome,
  aid,
  uploadedFiles,
  probe = null,
}) {
  const aiPrompts = []
  let droppedPrompts = 0
  let templateCategories = []
  // Extract all form values that aren't empty or the special 'val' key
  const keysWithValues = Object.keys(result ?? {}).filter(
    (r) => result[r] && result[r] !== '' && r !== 'val'
  )

  /* 
  Decision Tree Logic:
  - Each intention can have multiple "personas" in its decision tree
  - If there's only one persona, use it
  - If multiple, find the one whose useWhenValuesPopulated array matches all provided form values
  */
  const decisionTreeKeys = Object.keys(intention.ai.decisionTree)
  const promptToUse =
    decisionTreeKeys.length === 1
      ? decisionTreeKeys[0]
      : decisionTreeKeys.find(
          (p) =>
            difference(
              keysWithValues,
              intention.ai.decisionTree[p].useWhenValuesPopulated
            ).length === 0
        )

  const aiDecision = intention.ai.decisionTree[promptToUse]

  // Add any additional prompts specified in the form
  if (result.additionalPrompts) {
    aiDecision.prompts = [...aiDecision.prompts, ...result.additionalPrompts]
  }

  // template slates need to have the {templatePrompt} and {templateName} injected
  // and put the categoryCount and categories into the templatePrompt.
  // The {categoryCount} categories for the ideas are {categories}.
  if (slate?.options?.basedOnTemplate) {
    templateCategories = parseTemplateIntoCategories(slate)
    const categories = Object.keys(templateCategories)
    /*
    .map(
      (k) =>
        `${k} - use #${parseCategories[k].color} for its backgroundColor property.`
    )
      */
    const templatePrompt = `This template has ${
      categories.length
    } categories which are: ${categories.join(
      ', '
    )}. Follow these instructions to populate this template: ${
      slate.options.templatePrompt
    }.`
    if (aiDecision.prompts?.[0]) {
      // Two prompt-assembly fixes from a live run:
      // 1) The v1-era template-fill text explicitly permitted the model
      //    to "be proactive in asking which categories we should fill out
      //    first" — and the model took the permission: kickoff round-trip
      //    returned a question, zero notes, nothing to apply.
      // 2) A model that skims reads the END of a long stitched prompt
      //    hardest, so the imperative goes last: create notes NOW in this
      //    first reply, no planning chatter, no questions.
      const FILL_NOW =
        ' Respond NOW by calling the respond function with sticky notes covering EVERY category listed above. Do not ask which categories to fill out first, do not describe a plan, and do not wait for confirmation — create the notes in this first reply.'
      // Citation-rule guard (iter26 live finding): the legacy text only
      // requires '(page X)' citations WHEN source material is supplied,
      // but the model applied it unconditionally and fabricated page
      // references with no sources uploaded. Keep the rule for real
      // uploads; explicitly disarm it when there are none.
      const NO_SOURCES =
        (uploadedFiles || []).length === 0
          ? ' No source documents have been uploaded in this conversation, so the page-citation rule does not apply: skip citations entirely and never invent (page X) references.'
          : ''
      aiDecision.prompts[0] = aiDecision.prompts[0]
        .replace(/{{templatePrompt}}/gi, templatePrompt + FILL_NOW + NO_SOURCES)
        .replace(/{{templateName}}/gi, slate.options.templateName)
        .replace(
          /As we continue[^.]*be proactive in asking[^.]*\.\s*/gi,
          ' '
        )
        // the legacy text also made note-creation CONDITIONAL on the user
        // asking ("as many as the user asks… may ask… right away") — the
        // kickoff IS that ask, so state it instead of conditioning on it
        .replace(
          /Create as many sticky notes per category as the user asks\.\s*/gi,
          'Create 4-7 notes for EVERY category listed. '
        )
        .replace(
          /The user may ask for notes to be created right away[^.]*\.\s*/gi,
          ' '
        )
    }
  }

  /* 
  Process each prompt:
  - Replace any {{key}} placeholders with actual form values
  - Keys in placeholders must match form field keys
  */
  aiDecision.prompts.forEach((i) => {
    let workingPrompt = i
    if (workingPrompt.includes(`{{`)) {
      keysWithValues.forEach((key) => {
        if (workingPrompt.includes(`{{${key}}}`) && result[key]) {
          const repl = new RegExp(`{{${key}}}`, 'gi')
          workingPrompt = workingPrompt.replace(repl, result[key])
        }
      })
      // always stitch in the instructions handed off by the welcome assistant
      const useInstructions =
        result.instructions || aiDecision.defaultInstructions
      const useTechnicalInstructions =
        result.technicalInstructions || aiDecision.defaultTechnicalInstructions
      workingPrompt =
        useInstructions && workingPrompt.includes('{{instructions}}')
          ? workingPrompt.replace('{{instructions}}', useInstructions)
          : workingPrompt
      workingPrompt =
        useTechnicalInstructions &&
        workingPrompt.includes('{{technicalInstructions}}')
          ? workingPrompt.replace(
              '{{technicalInstructions}}',
              useTechnicalInstructions
            )
          : workingPrompt
      if (workingPrompt.includes('{{baseColor}}')) {
        workingPrompt = workingPrompt.replace('{{baseColor}}', result.baseColor)
      }
      // only include prompts if the prompt has no {{}} left; a dropped prompt
      // used to silently shrink the kickoff payload until the model received
      // a contentless request (template-400 / empty-notes class). Now: warn +
      // count, and abort loudly below when nothing survives.
      if (!workingPrompt.includes('{{')) {
        aiPrompts.push(workingPrompt)
      } else {
        droppedPrompts += 1
        console.warn(
          'AI prompt dropped (unresolved placeholders):',
          workingPrompt.match(/{{[^}]*}}/g)
        )
      }
    } else {
      aiPrompts.push(i)
    }
  })

  if (!aiPrompts.length) {
    // Self-diagnostic: the leftover placeholder names are the difference
    // between "template never loaded" and "assembly broke after load".
    const leftover = (aiDecision.prompts || [])
      .flatMap((p) => p.match(/{{[^}]*}}/g) || [])
      .slice(0, 6)
      .join(' ')
    // eslint-disable-next-line no-console
    console.warn(
      '[kickAbort]',
      JSON.stringify({
        basedOnTemplate: slate?.options?.basedOnTemplate || null,
        nodeCount: slate?.nodes?.allNodes?.length ?? null,
        cats: Object.keys(templateCategories || {}).length,
        leftover,
      })
    )
    return {
      abort: true,
      abortMessage: `I'm missing the template content this assistant needs to start${
        droppedPrompts
          ? ` (${droppedPrompts} instruction set${
              droppedPrompts > 1 ? 's' : ''
            } had unresolved placeholders${leftover ? `: ${leftover}` : ''})`
          : ''
      }${probe ? ` [dbg ${probe}]` : ''}. Try a plain mindmap, or pick a template that ships with content.`,
    }
  }

  /* 
  Get primary value from form:
  - Looks for form fields marked as isPrimary
  - Joins multiple primary values with ' - '
  - Used for slate name and center node text
  */
  const primaryVal = (intention.gather?.items || [])
    .filter((ix) => ix.isPrimary)
    .map((k) => k.key)
    .map((key) => result[key])
    .join(' - ')
    .trim()

  // set the slate name
  if (!intention.isAdhoc) {
    let collabs = []
    if (intention.slateName) {
      collabs.push({
        type: 'onSlateNameChanged',
        data: {
          name: intention.slateName.replace(
            '{{items}}',
            `${primaryVal.substring(0, 10)}...`
          ),
        },
      })
    }
    collabs = [
      ...collabs,
      {
        type: 'onSlateSnapToObjectsChanged',
        data: {
          snapToObjects: false,
        },
      },
      {
        type: 'onSlateLayoutTypeChanged',
        data: {
          layoutType: result?.layoutType ||
            aiDecision.layoutType || { val: 'neato' },
        },
      },
    ]

    if (aiDecision.removeExistingNodes) {
      slate?.nodes.allNodes?.forEach((node) => {
        collabs.push({
          type: 'onNodeDeleted',
          data: {
            id: node.options.id,
          },
        })
      })
    } else {
      collabs.push({
        type: 'onSlateAutoResizeNodesBasedOnTextChanged',
        data: {
          autoResizeNodesBasedOnText: true,
        },
      })
    }

    slate?.collab.exe(collabs)
  }

  const nodeText = Slatebox.utils.createMultiLineText(primaryVal, 3).trim()

  let singleNode = slate?.nodes.allNodes?.[0]
  let entireAIContext = null
  if (!aid && slate) {
    if (!aiDecision.isVision) {
      switch (intention.gather.onComplete) {
        case 'populateCenterNode': {
          // if node is deleted? need to create
          if (!singleNode) {
            const id = Random.id()
            const rect = defaultShapes.find((vx) => vx.key === 'rect')
            const xPos = 10000
            const yPos = 10000
            const nopts = {
              id,
              name: id,
              text: nodeText,
              image: '',
              xPos,
              yPos,
              width: 200,
              height: 70,
              vectorPath: pathAtOrigin(
                Slatebox.utils._transformPath(rect.path, `T${xPos},${yPos} s1,1`)
              ),
              shapeHint: rect.hint,
              backgroundColor: '#fff',
              fontFamily: 'Roboto Sans',
              fontSize: 34,
              foregroundColor: '#000',
              lineColor: '#333',
              lineWidth: 5,
              filters: {
                vect: 'postItNote',
              },
            }
            singleNode = new Slatebox.node(nopts)
            slate.nodes.add(singleNode)
            slate.collab.exe({
              type: 'onNodeToFront',
              data: {
                id: singleNode.options.id,
              },
            })
          } else if (intention._id !== 'adhoc') {
            const textPkg = {
              type: 'onNodeTextChanged',
              data: {
                id: singleNode.options.id,
                instanceId: 'ai_system',
                text: nodeText,
                fontColor: Slatebox.utils.whiteOrBlack(
                  singleNode.options.backgroundColor
                ),
                fontSize: 34,
              },
            }
            // console.log('sending project name', textPkg)
            slate?.collab.exe(textPkg)
          }
          break
        }
        default: {
          break
        }
      }
    }

    /*
       functions: [
              {
                name: 'respond',
                description: 'This is your response to the last query',
                parameters: {
                  type: 'object',
                  properties: {
                    responses: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          */

    const { functions } = aiDecision
    let { errorChecks } = aiDecision
    if (result.additionalParams) {
      result.additionalParams.forEach((ap) => {
        const addlRequired = ap.required ? [...ap.required] : null
        delete ap.required
        functions[0].parameters.properties = {
          ...functions[0].parameters.properties,
          ...ap,
        }
        // add to the required list if it is marked
        if (addlRequired) {
          functions[0].parameters.required = [
            ...(functions[0].parameters?.required || []),
            ...addlRequired,
          ]
        }
      })
    }

    if (result.additionalErrorChecks) {
      errorChecks = [...(errorChecks || []), ...result.additionalErrorChecks]
    }

    const uploadedDocs = (uploadedFiles || []).map((uf) => {
      const { docType, isImage } = getDocType(uf.url)
      return {
        docType,
        isImage,
        ...uf,
      }
    })

    // keysWithValues.forEach((k) => {
    //   if (result[k]?.includes?.('http') && !k.includes('unchecked')) {
    //     const urls = result[k]
    //       .trim()
    //       .split(',')
    //       .filter((t) => t.trim().length)
    //     urls.forEach((url) => {
    //       const { docType, isImage } = getDocType(url)
    //       uploadedDocs.push({ docType, isImage, url })
    //     })
    //   }
    // })

    const firstImage = uploadedDocs.find((ud) => ud.isImage)
    if (firstImage) {
      try {
        const colors = await Meteor.callAsync(
          CONSTANTS.methods.images.getColors,
          {
            imgType: firstImage.docType,
            imgUrl: firstImage.url,
          }
        )
        aiPrompts[0] = (aiPrompts[0] ?? '').replace(
          '{{imageColors}}',
          `Only use the following ${
            colors.length
          } hex colors when assigning a color to a category or note: ${colors.join(
            ', '
          )}. Choose the hex color that most closely matches the color of the node in this diagram.`
        )
      } catch (err) {
        return {
          abort: true,
          abortMessage: `Unable to retrieve image text, so this AI conversation cannot proceed: ${err.message}`,
        }
      }
    }

    const { aiContext, abort, abortMessage, refusal } = await prepAISlate({
      slate,
      aiSettings: {
        isConversation: {
          id: intention._id,
          active: true,
          dormant: false,
          aiDecision,
          showWelcome,
          uploadedDocs,
        },
        templateCategories,
        functions,
        function_call: aiDecision.function_call,
        mainNodeId: singleNode?.options?.id,
        rootProperty: aiDecision.rootProperty,
        skipCategories: aiDecision.skipCategories ?? false,
        errorChecks,
        layoutType: result.layoutType ?? aiDecision.layoutType,
        transparentConnections:
          result.transparentConnections ?? aiDecision.transparentConnections,
        defaultShapes: result.defaultShapes || aiDecision.defaultShapes,
        postProcessing:
          result.postProcessing ?? aiDecision.defaultPostProcessing,
      },
      prompt: aiPrompts,
      isOnCanvas: true,
    })

    if (abort) {
      return { abort, abortMessage, refusal }
    }

    // remove all unchecked variants from result
    Object.keys(result).forEach((k) => {
      if (k.includes('_unchecked')) {
        delete result[k]
      }
    })

    entireAIContext = {
      ...aiContext,
      isConversation: {
        id: intention._id,
        ongoingConversationRider: aiDecision.ongoingConversationRider,
        sentenceBatchSize:
          result.sentenceBatchSize || aiDecision.sentenceBatchSize,
        voiceId:
          result.voiceId || (result.dedicated ? aiDecision.voiceId : null),
        disableVoiceId: result.disableVoiceId ?? true,
        dormant: false,
        active: true,
        isVision: aiDecision.isVision,
        defaultShapes: result.defaultShapes || aiDecision.defaultShapes,
        intentionInitialData: result,
        uploadedDocs,
        showWelcome,
      },
    }

    slate?.collab.exe({
      type: 'onSlateAISet',
      data: {
        ...entireAIContext,
        openChat: true, // aiDecision?.autoOpenChat,
      },
    })
  }

  return {
    entireAIContext,
    openChat: true, // aiDecision?.autoOpenChat,
  }
}
