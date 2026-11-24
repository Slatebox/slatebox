/* eslint-disable react/jsx-no-bind */
/* eslint-disable react/jsx-no-useless-fragment */
import React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import PauseIcon from '@mui/icons-material/Pause'
import { useMediaQuery, useTheme, Typography } from '@mui/material'
import Grid from '@mui/material/Grid2'
import IconButton from '@mui/material/IconButton'
import {
  createSlateWithAIContent,
  isCanvasAICustomActionsOpen,
  currentSlate,
  isAIActivelySpeaking,
  currentSlateAudioUrl,
  aiSettingsModalOpen,
} from '../../jotai/atoms'

import { Meteor } from 'meteor/meteor'
import Pulse from '../../common/Pulse'

export default function CanvasAIIntentions({ templates }) {
  const [currentAIContext, setAIContext] = useAtom(createSlateWithAIContent)
  const theme = useTheme()
  const mdmq = useMediaQuery(theme.breakpoints.up('md'))
  const lgmq = useMediaQuery(theme.breakpoints.up('lg'))
  const xlmq = useMediaQuery(theme.breakpoints.up('xl'))
  const slate = useAtomValue(currentSlate)
  const isSlateSpeaking = useAtomValue(isAIActivelySpeaking)
  const setSlateAudioURL = useSetAtom(currentSlateAudioUrl)
  const setCustomAIOpen = useSetAtom(isCanvasAICustomActionsOpen)
  const setAISettingsOpen = useSetAtom(aiSettingsModalOpen)

  const toggleAIActive = async () => {
    await Meteor.callAsync('slates.updateSettings', {
      shareId: slate.shareId,
      aiConversation: { active: !currentAIContext?.isConversation?.active, dormant: false },
    })
    setAIContext({
      ...currentAIContext,
      isConversation: {
        ...currentAIContext.isConversation,
        active: !currentAIContext?.isConversation?.active,
        dormant: false,
      },
    })
  }
  const stopAI = async () => {
    if (isSlateSpeaking) {
      setSlateAudioURL(null)
    } else {
      await Meteor.callAsync('slates.updateSettings', {
        shareId: slate.shareId,
        aiConversation: { active: false, dormant: true },
      })
      setAIContext({
        ...currentAIContext,
        isConversation: {
          ...currentAIContext.isConversation,
          active: false,
          dormant: true,
        },
      })
    }
  }

  const handleAIClick = async () => {
    //   if (slate?.options?.basedOnTemplate) {
    //     // Find the template-specific conversation
    //     const templateConversation = chatIntentions.find(
    //       (i) => i.templatesOnly === true
    //     )
    //     if (templateConversation) {
    //       await startAIConversation(templateConversation)
    //     } else {
    //       setAISettingsOpen(true) // Fallback to old behavior if conversation not found
    //     }
    //   } else {
    setCustomAIOpen({
      open: !slate?.options?.basedOnTemplate,
      autoOpenAIConversation: !!slate?.options?.basedOnTemplate,
      templates,
    })
    // }
  }

  return (
    <>
      {currentAIContext?.aid &&
      currentAIContext?.isConversation &&
      !currentAIContext?.isConversation.dormant ? (
        <Grid container alignItems="center" justifyContent="center">
          <Grid>
            {currentAIContext?.isConversation?.active === true ? (
              <img src="/images/sb_ai_loader.svg" alt="AI In Motion" />
            ) : (
              <img
                src="/images/sb_ai_inactive.png"
                style={{
                  width: '20px',
                  height: '20px',
                  marginTop: '10px',
                  marginRight: '10px',
                }}
                alt="AI Custom"
              />
            )}
          </Grid>
          <Grid>
            <IconButton
              size="small"
              edge="start"
              color="inherit"
              onClick={toggleAIActive}
              aria-label="close"
            >
              {currentAIContext?.isConversation?.active === true ? (
                <></>
              ) : (
                // <PauseIcon />
                <PlayArrowIcon />
              )}
            </IconButton>
          </Grid>
          <Grid>
            <IconButton
              size="small"
              edge="start"
              color="inherit"
              onClick={(e) => stopAI(true)}
              aria-label="close"
              style={isSlateSpeaking ? { color: 'red' } : {}}
            >
              {isSlateSpeaking ? (
                <Pulse duration={200}>
                  <StopIcon />
                </Pulse>
              ) : (
                <StopIcon />
              )}
            </IconButton>
          </Grid>
          <Grid
            style={{
              marginTop: '-12px',
              textAlign: 'center',
            }}
            size={12}
          >
            {!slate?.options?.ai?.isConversation?.intentionInitialData
              ?.isAdhoc && (
              <Typography variant="caption">
                {slate?.options?.ai?.isConversation?.intentionInitialData
                  ?.persona
                  ? slate?.options?.ai?.isConversation?.intentionInitialData?.persona.replace(
                      /-/,
                      ' '
                    )
                  : Object.values(
                      slate?.options?.ai?.isConversation
                        ?.intentionInitialData || {}
                    )?.[0]?.substring(0, 12)}
              </Typography>
            )}
          </Grid>
        </Grid>
      ) : (
        <IconButton
          edge="start"
          color="inherit"
          onClick={handleAIClick}
          aria-label="close"
        >
          <img src="/images/sb_ai_button.png" alt="AI Custom" />
        </IconButton>
      )}
    </>
  )
}
