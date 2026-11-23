/* eslint-disable default-case */
/* eslint-disable no-underscore-dangle */
/* eslint-disable react/forbid-prop-types */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import uniq from 'lodash.uniq'
import { useTracker } from 'meteor/react-meteor-data'
import PropTypes from 'prop-types'
import { useDaily } from '@daily-co/daily-react'
import { Slatebox } from 'slateboxjs'
import {
  createSlateWithAIContent,
  globalMessage,
  allowance,
  isCanvasAICustomActionsOpen,
  huddleEnabled,
  currentSlateAudioUrl,
  outstandingAIRequests,
} from '../../jotai/atoms'
import {
  updateAINode,
  createAINodes,
  createAISticky,
  createAIConversationNode,
} from '../../../api/common/ai'
import executeSlateOperations from '../../../api/client/executeSlateOperations'

import defaultShapes from '../node/defaultShapes'
import { AIContent } from '../../../api/common/models'
import CONSTANTS from '../../../api/common/constants'

export default function AIContentListener({
  slate,
  collaboratorInstanceId = null,
  aiContext = null,
  onAIContextChange = null,
}) {
  const [atomAIContext, setAtomAIContext] = useAtom(createSlateWithAIContent)
  const currentAIContext = aiContext?.aid ? aiContext : atomAIContext
  const setCurrentAIContext = React.useCallback(
    (nextContext) => {
      setAtomAIContext(nextContext)
      onAIContextChange?.(nextContext)
    },
    [onAIContextChange, setAtomAIContext]
  )
  const setHuddleEnabled = useSetAtom(huddleEnabled)
  const callObject = useDaily()
  const { themes, templates } = useAtomValue(isCanvasAICustomActionsOpen)
  const setSlateAudioURL = useSetAtom(currentSlateAudioUrl)
  // console.log('ailistener context', currentAIContext)
  const setAllowance = useSetAtom(allowance)
  const [message, setGlobalMessage] = useAtom(globalMessage)
  const setOutstandingAIRequests = useSetAtom(outstandingAIRequests)

  // pin the slate to a ref so it is available in the observe below
  // const slateRef = React.useRef(slate)

  let layoutSettled = null
  async function runLayout(useQuandrants, isComplete, type) {
    // The engine's own layouts, the ones an agent's arrange_nodes uses: a
    // generated slate is a connected tree, so it is laid out as one; a slate
    // whose layout is off only has its overlaps removed. The live applier
    // saves the move and sends it to everyone on the slate.
    const layout = slate?.options?.layoutType?.val === 'none' ? 'tidy' : 'tree'
    try {
      await executeSlateOperations({
        slate,
        plan: {
          message: 'Laid out the slate.',
          operations: [{ kind: 'arrange_nodes', target: { all: true }, layout }],
        },
      })
      clearTimeout(window.fitAIContentLayout)
      window.fitAIContentLayout = setTimeout(() => {
        slate.controller.scaleToFitAndCenter()
      }, 600)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Unable to lay out the AI slate', error.message)
    }

    if (currentAIContext?.isConversation) {
      // update asOfDAte
      const lastUpdate = Date.now()
      slate.collab.exe({
        type: 'onSlateAISet',
        data: {
          asOfDate: lastUpdate,
        },
      })

      setCurrentAIContext({
        ...currentAIContext,
        asOfDate: lastUpdate,
      })

      // slate?.controller.scaleToFitAndCenter()
    }
    if (isComplete) {
      clearTimeout(layoutSettled)
      layoutSettled = setTimeout(async () => {
        await AIContent.insertAsync({
          _id: `${currentAIContext?.aid}_layout_settled`,
          type,
          aid: currentAIContext?.aid,
          slateShareId: slate.shareId,
          layoutSettled: true,
        })
      }, 5000)
    }
  }

  async function redoLayout(useQuandrants, isImmediate, isComplete, type) {
    clearTimeout(window.resizeAILayout)
    if (isImmediate) {
      runLayout(useQuandrants, isComplete, type)
    } else {
      window.resizeAILayout = setTimeout(async () => {
        runLayout(useQuandrants, isComplete, type)
      }, 1500)
    }
  }

  useTracker(() => {
    Meteor.subscribe(
      CONSTANTS.publications.aiContent,
      currentAIContext?.aid,
      currentAIContext?.isConversation
    )
  }, [currentAIContext?.aid])

  // hook for listening to AIContent
  useTracker(() => {
    const aiListener = AIContent.find({
      created: { $gte: currentAIContext.asOfDate },
    }).observe({
      async added(doc) {
        setOutstandingAIRequests(false)
        // console.log('got ai doc ', doc)
        switch (doc.role) {
          case CONSTANTS.ai.role.coordinator: {
            if (doc.state === CONSTANTS.ai.state.pending) {
              // console.log('pending found', doc)
              switch (doc.type) {
                case CONSTANTS.ai.types.template:
                default: {
                  const projectNode = slate?.nodes?.allNodes.find((n) =>
                    n.options.text.match(/project name/gi)
                  )
                  // console.log('got projectNode', projectNode)
                  if (projectNode) {
                    // set the project name
                    slate?.collab.exe({
                      type: 'onSlateNameChanged',
                      data: { name: `${doc.userPrompt.substring(0, 100)}...` },
                    })
                    const textPkg = {
                      type: 'onNodeTextChanged',
                      data: {
                        id: projectNode.options.id,
                        instanceId: 'ai_system',
                        text: doc.userPrompt,
                        fontColor: '#000',
                      },
                    }
                    // console.log('sending project name', textPkg)
                    slate?.collab.exe(textPkg)
                  }
                  break
                }
              }
            } else if (doc.state === CONSTANTS.ai.state.complete) {
              setCurrentAIContext({ ...currentAIContext, aid: null })
              aiListener.stop()
              setAllowance(await Meteor.callAsync(CONSTANTS.methods.meter.summary).catch(() => null))

              // console.log('final layout')
            } else if (doc.state === CONSTANTS.ai.state.failed) {
              setCurrentAIContext({ ...currentAIContext, aid: null })
              aiListener.stop()
              setGlobalMessage({
                visible: true,
                text: `I'm sorry! The AI Unicorn has done all it can on this one.`,
                severity: 'error',
                autoHide: 60000,
              })
            }
            if (doc.type === CONSTANTS.ai.types.scratch) {
              redoLayout(false, false, true, doc.type)
            }
            break
          }
          case CONSTANTS.ai.role.attribute: {
            if (doc.ideaPlan) {
              // build out the ideaPlan (an array of ideas nested deep)
              const nodesToCreate = doc.ideaPlan.map((i) => {
                const gs = i.replace(/sub_idea_/gi, '')
                let gid = gs.substring(0, gs.lastIndexOf('.'))
                gid = gid === '' ? gs : gid // top level sub ideas should stay in their own lane

                const d = [...i.matchAll(/\.|sub/gi)].length
                let m = 0.8
                if (d > 0) {
                  m = 0.7
                } else if (d > 1) {
                  m = 0.5
                }
                return {
                  id: i,
                  depth: d,
                  multiplier: m,
                  groupId: gid,
                }
              })
              const uq = uniq(nodesToCreate.map((n) => n.groupId)).length
              // console.log(
              //   'creating all nodes',
              //   nodesToCreate,
              //   slate.options.containerStyle.backgroundColor,
              //   Slatebox.utils.whiteOrBlack(
              //     slate.options.containerStyle.backgroundColor
              //   )
              // )

              const availableVects =
                doc.nouns?.length > 0
                  ? doc.nouns
                  : [defaultShapes.find((vx) => vx.key === 'star').path]

              createAINodes(
                nodesToCreate,
                currentAIContext,
                1,
                slate,
                Slatebox.utils.whiteOrBlack(
                  slate?.options.containerStyle.backgroundColor
                ),
                availableVects
              )
              if (currentAIContext.themeId) {
                const slateTheme = await Meteor.callAsync(
                  CONSTANTS.methods.themes.getThemes,
                  { themeId: currentAIContext.themeId }
                )
                if (slateTheme) {
                  slate?.applyTheme(slateTheme)
                }
              }

              redoLayout(uq >= 3)
            }
            break
          }
          case CONSTANTS.ai.role.node:
          default: {
            switch (doc.type) {
              case CONSTANTS.ai.types.template: {
                // console.log('make sticky', doc, currentAIContext)
                await createAISticky(
                  doc,
                  slate,
                  currentAIContext,
                  collaboratorInstanceId
                )
                break
              }
              case CONSTANTS.ai.types.conversation: {
                //
                if (doc.abort) {
                  // need to shut down the AI context
                  // and the microphone if it is on
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
                } else if (doc.deleted && doc.nodeId) {
                  // let's set the node's opacity and give the user heads up that this
                  // is going to be going away
                  const delPkg = {
                    type: 'onNodeDeleted',
                    data: {
                      id: doc.nodeId,
                    },
                  }
                  slate.collab.exe(delPkg)

                  // actually delete the aicontent now
                  await Meteor.callAsync(
                    CONSTANTS.methods.openai.deleteAIContent,
                    doc
                  )
                  redoLayout()
                } else if (doc.nodeId && doc.description?.trim() !== '') {
                  doc.id = doc.nodeId
                  delete doc.nodeId
                  const nodeToCreate = {
                    id: doc.nodeId,
                    ...doc,
                  }
                  await createAIConversationNode(
                    nodeToCreate,
                    currentAIContext,
                    slate,
                    Slatebox.utils.whiteOrBlack(
                      slate?.options.containerStyle.backgroundColor
                    ),
                    doc.mainNodeId,
                    doc.isParent ?? false,
                    themes,
                    templates,
                    collaboratorInstanceId
                  )
                  if (
                    !currentAIContext.isConversation?.intentionInitialData
                      ?.isAdhoc
                  ) {
                    redoLayout()
                  }
                }
                break
              }
              case CONSTANTS.ai.types.scratch:
              default: {
                if (doc.nodeId === 'main_idea') {
                  if (doc.title && doc.description) {
                    const pkgs = [
                      {
                        type: 'onSlateNameChanged',
                        data: { name: doc.title },
                      },
                      {
                        type: 'onSlateDescriptionChanged',
                        data: { description: doc.description },
                      },
                    ]

                    pkgs.forEach((p) => {
                      slate?.collab.exe(p)
                    })
                  }

                  // go and create a background image
                  // `main_idea_img`
                  // if (doc.imageSearch || doc.description) {
                  //   setTimeout(() => {
                  //     Meteor.call(
                  //       CONSTANTS.methods.stabilityai.generate,
                  //       {
                  //         prompts: [doc.imageSearch || doc.description],
                  //         slateShareId: slate.shareId,
                  //       },
                  //       (err, res) => {
                  //         // console.log('got images ', err, res)
                  //         if (err) {
                  //           console.log('unable to create image for node', err)
                  //         } else {
                  //           // remove the text
                  //           const textPkg = {
                  //             type: 'onNodeTextChanged',
                  //             data: {
                  //               id: `main_idea_img`,
                  //               instanceId: collaboratorInstanceId,
                  //               text: '',
                  //             },
                  //           }
                  //           slate?.collab.exe(textPkg)

                  //           slate?.collab.exe({
                  //             type: 'onNodeImageChanged',
                  //             data: {
                  //               id: `main_idea_img`,
                  //               instanceId: collaboratorInstanceId,
                  //               img: res[0],
                  //               w: 768,
                  //               h: 768,
                  //             },
                  //           })
                  //         }
                  //       }
                  //     )
                  //   }, 10000)
                  // }
                }
                await updateAINode(doc, slate, collaboratorInstanceId)
                redoLayout(slate.options.useLayoutQuandrants)
              }
            }
          }
        }
      },
    })
  }, [slate, currentAIContext.asOfDate])

  return null
}

AIContentListener.propTypes = {
  slate: PropTypes.object.isRequired,
  aiContext: PropTypes.object,
  onAIContextChange: PropTypes.func,
  collaboratorInstanceId: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),
}
