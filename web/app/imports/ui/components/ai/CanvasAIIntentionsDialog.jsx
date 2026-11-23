/* eslint-disable consistent-return */
/* eslint-disable no-param-reassign */
/* eslint-disable no-underscore-dangle */
/* eslint-disable react/jsx-no-bind */
/* eslint-disable react/jsx-no-useless-fragment */
import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { useTracker } from 'meteor/react-meteor-data'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import { useTheme } from '@mui/material/styles'
import { Slatebox } from 'slateboxjs'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Grid from '@mui/material/Grid2'
import difference from 'lodash.difference'

import initAIConversation from '../../../api/common/initAIConversation'
import confirmService from '../../common/confirm'
import defaultShapes from '../node/defaultShapes'
import {
  ChatIntentions,
  Organizations,
} from '../../../api/common/models'
import CONSTANTS from '../../../api/common/constants'
import {
  createSlateWithAIContent,
  isCanvasAICustomActionsOpen,
  conversationOpen,
  isPersonaOpen,
  globalMessage,
  currentSlate,
} from '../../jotai/atoms'

export default function CanvasAIIntentionsDialog({ slate }) {
  const [currentAIContext, setAIContext] = useAtom(createSlateWithAIContent)
  const [customAIOpen, setCustomAIOpen] = useAtom(isCanvasAICustomActionsOpen)
  const [aiConversationOpen, setAIConversationOpen] = useState(false)
  const [getIsPersonaOpen, setPersonaOpen] = useAtom(isPersonaOpen)
  const setGlobalMessage = useSetAtom(globalMessage)

  const setChatOpen = useSetAtom(conversationOpen)

  const orgName = useTracker(() => {
    const org =
      Meteor.user() && Meteor.user()?.orgId ? Organizations.findOne() : null
    return org && org.name
  })

  const theme = useTheme()

  const chatIntentions = useTracker(() => {
    const templatesOnly = slate?.options?.basedOnTemplate
    Meteor.subscribe(CONSTANTS.publications.chatIntentions)
    const intentions = ChatIntentions.find()
      .fetch()
      .filter((c) => !c.system)
    if (templatesOnly) {
      return intentions
        .filter((i) => i.basedOnTemplate)
        .map((c) =>
          JSON.parse(
            JSON.stringify(c).replace(
              /{{templateName}}/gi,
              slate.options.templateName
            )
          )
        )
    } else {
      return intentions
    }
  })

  const closeAIOptions = () => {
    setCustomAIOpen({
      ...customAIOpen,
      autoOpenAIConversation: false,
      open: false,
    })
  }

  const addNewCustomizedAI = () => {
    setPersonaOpen(!getIsPersonaOpen)
  }

  const resumeAI = async () => {
    await Meteor.callAsync('slates.updateSettings', {
      shareId: slate.shareId,
      aiConversation: { active: true, dormant: false },
    })
    const isConvo = {
      ...currentAIContext.isConversation,
      active: true,
      dormant: false,
    }
    setAIContext({
      ...currentAIContext,
      isConversation: isConvo,
    })
    slate?.collab.exe({
      type: 'onSlateAISet',
      data: {
        isConversation: isConvo,
      },
    })
    closeAIOptions()
  }

  // if there is only one intention and the slate is based on a template, load the specific template based dialogue immediately
  useEffect(() => {
    if (chatIntentions.length === 1 && customAIOpen.autoOpenAIConversation) {
      closeAIOptions()
      startAIConversation(chatIntentions[0])
    }
  }, [chatIntentions])

  async function startAIConversation(intention) {
    setAIConversationOpen(true)
    const result = intention.gather
      ? await confirmService.show({
          theme,
          title: intention.gather.title,
          message: intention.gather.message,
          captureItems: intention.gather.items,
          allowThemeSelect: true,
          allowVoiceSwitch: true,
          showImageDropZone: intention.ai.decisionTree.inline.isVision,
          themes: customAIOpen.themes,
          templates: customAIOpen.templates,
          footerMessage: intention.gather.footerMessage,
          actionItems: [
            { label: 'Cancel', key: 'cancel', return: false },
            {
              label: intention.gather.startButtonText ?? 'Start!',
              key: 'continue',
              return: true,
              validate: async (ret) => {
                const missing = []
                const tooLarge = []
                Object.keys(ret).forEach((key) => {
                  const intent = intention.gather.items.find(
                    (i) => i.key === key
                  )
                  if (!ret?.[key]?.length && intent?.required) {
                    missing.push(intent.placeholder)
                  }
                  if (
                    intent?.size &&
                    ret?.[`${key}_unchecked`]?.length > intent?.size
                  ) {
                    tooLarge.push({
                      ele: key,
                      overage: ret[`${key}_unchecked`].length - intent.size,
                      size: intent.size,
                    })
                  }
                })
                const errors = []
                if (missing.length > 0) {
                  errors.push(
                    `The "${missing.join('", "')}" element(s) are missing.`
                  )
                }
                if (tooLarge.length > 0) {
                  errors.push(
                    `The "${tooLarge
                      .map((t) => t.ele)
                      .join('", "')}" element(s) are ${tooLarge
                      .map((t) => t.overage)
                      .join(
                        ', '
                      )} characters too long. Only the first ${tooLarge
                      .map((t) => t.size)
                      .join(', ')} characters will be taken from each.`
                  )
                }
                return errors.length > 0 ? errors.join(' ') : null
              },
            },
          ],
        })
      : null

    if (!customAIOpen.autoOpenAIConversation) {
      closeAIOptions()
    }

    if (!result || (result.val === false && intention.gather)) {
      // if (result.val === false && intention.gather) {
      //   closeAIOptions()
      // }
      return false
    }

    const { entireAIContext, openChat, abort, abortMessage } =
      await initAIConversation({
        slate,
        intention,
        result: {
          ...result,
          intentionId: intention._id,
        },
        aid: currentAIContext?.aid,
      })
    if (abort) {
      setTimeout(() => {
        setGlobalMessage({
          visible: true,
          title: 'Unable to process conversation',
          text: abortMessage,
          severity: 'error',
          autoHide: 60000,
        })
      }, 300)
    } else {
      setAIContext(entireAIContext)
      setChatOpen(openChat)
    }
    closeAIOptions()
  }

  return (
    <Dialog
      maxWidth="md"
      fullWidth
      onClose={closeAIOptions}
      aria-labelledby="ai-canvas-dialogue"
      open={customAIOpen.open}
      PaperProps={{
        style: {
          opacity: '0.93',
        },
      }}
    >
      <DialogContent style={{ minHeight: '400px' }}>
        <DialogTitle
          id="custom-ai-intentions-dialogue"
          style={{
            paddingTop: '2px',
            paddingLeft: '2px',
            paddingBottom: '50px',
          }}
          onClose={closeAIOptions}
        >
          <Grid
            container
            spacing={2}
            justifyContent="flex-end"
            alignItems="center"
          >
            {currentAIContext?.isConversation?.dormant ? (
              <Grid size={9}>
                <Typography variant="h3" color="secondary">
                  {slate?.options?.name}
                </Typography>
              </Grid>
            ) : (
              <Grid size={9}>
                <Typography variant="h4" color="secondary">
                  {slate?.options?.createdViaAI
                    ? 'This slate was already created with AI'
                    : 'Converse in real-time with AI'}
                </Typography>
                <Typography variant="body2">
                  {slate?.options?.createdViaAI
                    ? ''
                    : 'Create a slate with the Slatebox AI in real-time.'}
                </Typography>
              </Grid>
            )}
            <Grid size={3}>
              {!currentAIContext?.isConversation &&
                !slate?.options?.createdViaAI &&
                Meteor.user()?.orgId && (
                  <Button
                    color="primary"
                    variant="filled"
                    onClick={addNewCustomizedAI}
                    fullWidth
                  >
                    Manage {orgName}&apos;s Conversations &rarr;
                  </Button>
                )}
              {currentAIContext?.isConversation?.dormant && (
                <Button color="secondary" variant="outlined" onClick={resumeAI}>
                  Resume &rarr;
                </Button>
              )}
            </Grid>
          </Grid>
        </DialogTitle>
        {!currentAIContext?.isConversation ? (
          <Grid
            container
            spacing={2}
            justifyContent="flex-end"
            alignContent="flex-end"
            alignItems="flex-end"
          >
            {!slate?.options?.createdViaAI ? (
              <>
                {chatIntentions?.map((intention) => (
                  <>
                    <Grid size={8}>
                      <Typography variant="h6" color="secondary">
                        {intention.title}
                      </Typography>
                      <Typography variant="body2">
                        {intention.details}
                      </Typography>
                    </Grid>
                    <Grid size={4}>
                      <Button
                        size="large"
                        variant="outlined"
                        color="secondary"
                        fullWidth
                        onClick={() => startAIConversation(intention)}
                      >
                        {intention.name} &rarr;
                      </Button>
                    </Grid>
                  </>
                ))}
              </>
            ) : (
              <Grid size={12}>
                <Typography variant="overline">
                  Sorry, you already created this slate with an AI prompt, so it
                  is not eligible to be re-used in an AI conversation. Please
                  create a new slate from scratch, then you will be able to
                  converse in real-time with AI.
                </Typography>
              </Grid>
            )}
          </Grid>
        ) : (
          <Grid
            container
            spacing={2}
            justifyContent="flex-start"
            alignItems="center"
          >
            <Grid size={12}>
              {slate?.options?.ai?.isConversation?.intentionInitialData
                ?.isAdhoc ? (
                <>
                  This slate is an adhoc AI conversation. To set an intentional
                  discussion with the Slatebox AI, you will need to create a new
                  slate.
                </>
              ) : (
                <>
                  You have already set this slate conversation with the below
                  details. You can resume with these details. To change to a
                  different conversation, you will need to create a new slate.
                </>
              )}
            </Grid>
            {Object.keys(
              slate?.options?.ai?.isConversation?.intentionInitialData ?? {}
            )
              .filter(
                (k) =>
                  ![
                    'val',
                    'theme',
                    'template',
                    'postProcessing',
                    'additionalParams',
                    'sentenceBatchSize',
                    'dedicated',
                    'defaultShapes',
                  ].includes(k) &&
                  slate?.options?.ai?.isConversation?.intentionInitialData[k]
              )
              .map((key) => (
                <>
                  <Grid size={2}>{key}</Grid>
                  <Grid size={10}>
                    <TextField
                      fullWidth
                      value={
                        slate?.options?.ai?.isConversation
                          ?.intentionInitialData[key]
                      }
                      disabled
                      variant="outlined"
                      multiline
                      key={key}
                    />
                  </Grid>
                </>
              ))}
          </Grid>
        )}
      </DialogContent>
      <DialogActions>
        <Button autoFocus onClick={closeAIOptions} color="secondary">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
