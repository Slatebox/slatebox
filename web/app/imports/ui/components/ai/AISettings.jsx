/* eslint-disable no-nested-ternary */
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useAtom, useSetAtom } from 'jotai'
import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import Dialog from '@mui/material/Dialog'
import Grid from '@mui/material/Grid2'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Chip from '@mui/material/Chip'
import { useNavigate } from 'react-router-dom'

import TabPanel from '../../common/TabPanel'
import {
  globalMessage,
  currentAISettings,
  isCanvasAICustomActionsOpen,
} from '../../jotai/atoms'

import promisify from '../../../api/client/promisify'
import urlExists from '../../../api/client/urlExists'
import AISelect from './AISelect'
import CONSTANTS from '../../../api/common/constants'

export default function AISettings({
  isOpen,
  onClose,
  showPrompt,
  title,
  textLabel,
  isOnCanvas,
  saveLabel,
  shareId,
  enteredPrompt,
  onChangePrompt = null,
  userAISettings = null,
}) {
  const history = useNavigate()
  const [message, setGlobalMessage] = useAtom(globalMessage)
  const [defaultAISettings, setCurrentAISettings] = useAtom(currentAISettings)
  const [aiSettings, setLocalAISettings] = React.useState(
    userAISettings || defaultAISettings
  )
  const [aiDescription, setAIDescription] = React.useState('')
  const [alreadyRanPrompt, setOriginalPrompt] = React.useState(null)
  const [promptValid, setPromptValid] = React.useState(enteredPrompt)
  const setCustomAIOpen = useSetAtom(isCanvasAICustomActionsOpen)
  const [tabValue, setTabValue] = React.useState(0)

  const changeTab = (event, newValue) => {
    setTabValue(newValue)
  }

  async function potentiallyEnableMagicLink(url) {
    const valid = await urlExists(url)
    if (valid) {
      setPromptValid(true)
    }
  }

  const updatePreference = async (type, val) => {
    const copy = { ...aiSettings }
    copy[type] = val
    if (type === 'layoutStrategy') {
      if (val !== CONSTANTS.ai.layoutStrategy.url.name) {
        if (!(enteredPrompt || aiDescription)) {
          setPromptValid(false)
        } else if (enteredPrompt === copy.url) {
          setPromptValid(false)
          onChangePrompt('')
        }
      } else {
        potentiallyEnableMagicLink(copy.url)
      }
    }
    setLocalAISettings(copy)

    setCurrentAISettings(copy)
    await Meteor.users.updateAsync(
      { _id: Meteor.userId() },
      {
        $set: {
          'profile.aiSettings': { ...copy },
        },
      }
    )
  }

  if (isOnCanvas && shareId && !alreadyRanPrompt) {
    Meteor.call(
      CONSTANTS.methods.openai.fetchOriginalPrompt,
      shareId,
      (err, prompt) => {
        setOriginalPrompt(prompt)
      }
    )
  }

  useEffect(() => {
    if (aiSettings.layoutStrategy === CONSTANTS.ai.layoutStrategy.url.name) {
      potentiallyEnableMagicLink(aiSettings.url)
    }
  }, [Meteor.user()])

  const savePreference = async (e) => {
    if (aiSettings.layoutStrategy === CONSTANTS.ai.layoutStrategy.url.name) {
      if (!(await urlExists(aiSettings.url))) {
        setGlobalMessage({
          visible: true,
          text: `Sorry, that's not a valid URL: ${aiSettings.url}`,
          severity: 'error',
          autoHide: 10000,
        })
        e.preventDefault()
        return
      }
      setPromptValid(true)
    }

    if (
      aiSettings.layoutStrategy === CONSTANTS.ai.layoutStrategy.template.name &&
      (aiSettings.templateId == null || aiSettings.templateId === '')
    ) {
      setGlobalMessage({
        visible: true,
        text: `You must select a template to autopopulate!`,
        severity: 'error',
        autoHide: 10000,
      })
      e.preventDefault()
      return
    }

    await Meteor.users.updateAsync(
      { _id: Meteor.userId() },
      {
        $set: {
          'profile.aiSettings': { ...aiSettings },
        },
      }
    )
    setCurrentAISettings({ ...aiSettings })

    if (
      showPrompt &&
      aiDescription === '' &&
      (!alreadyRanPrompt || alreadyRanPrompt.empty === true)
    ) {
      setGlobalMessage({
        visible: true,
        isSnackBar: true,
        text: 'You must provide a prompt for the AI!',
        severity: 'error',
        autoHide: 10000,
      })
    } else {
      if (
        promptValid &&
        aiSettings.layoutStrategy === CONSTANTS.ai.layoutStrategy.url.name
      ) {
        onChangePrompt(aiSettings.url)
      } else if (enteredPrompt === aiSettings.url) {
        onChangePrompt('')
      }
      onClose(
        typeof alreadyRanPrompt === 'string' ? alreadyRanPrompt : aiDescription
      )
    }
  }


  const handleStartConversation = async () => {
    onClose()
    const newShareId = await Meteor.callAsync(
      CONSTANTS.methods.slates.generateShareId
    )
    history(`/canvas/${newShareId}`)
    // setTimeout(() => {
    setCustomAIOpen({ open: true })
    // setCustomAIOpen(true)
    // }, 1500)
  }

  const header = title || 'What kind of Slate do you want to create?'
  const txtLabel = textLabel || 'Create a Slate About...'

  let sLabel = saveLabel
  if (isOnCanvas && alreadyRanPrompt && alreadyRanPrompt.empty !== true) {
    sLabel = 'Add More Ideas'
  } else if (isOnCanvas) {
    sLabel = 'Go'
  }

  return (
    <Dialog
      open={isOpen}
      fullWidth
      onClose={(e) => {
        onClose()
      }}
      aria-labelledby="ai-settings"
    >
      <DialogTitle id="ai-settings">
        <Typography color="secondary" variant="h6">
          Let Me Slatebox That For You...
        </Typography>
      </DialogTitle>
      <DialogContent>
        <DialogContentText>{header}</DialogContentText>
        {showPrompt && (alreadyRanPrompt == null || alreadyRanPrompt.empty) && (
          <Box p={1}>
            <TextField
              label={aiDescription !== '' ? '' : txtLabel}
              fullWidth
              multiline
              minRows={isOnCanvas ? 5 : 1}
              value={aiDescription}
              variant="outlined"
              onChange={(e) => {
                setAIDescription(e.target.value)
              }}
              InputLabelProps={{
                style: { color: '#a0a0a0' },
                shrink: false,
              }}
            />
          </Box>
        )}
        {isOnCanvas && alreadyRanPrompt && alreadyRanPrompt.empty !== true && (
          <Typography variant="body2">
            Want to add more ideas? Click the button below! (Additional ideas
            count as another AI Slate/month)
          </Typography>
        )}
        {isOnCanvas && alreadyRanPrompt == null && (
          <Typography color="secondary" variant="h6">
            Loading, one moment!
          </Typography>
        )}
        {!isOnCanvas && (
          <>
            <Tabs
              value={tabValue}
              variant="fullWidth"
              onChange={changeTab}
              indicatorColor="secondary"
              textColor="secondary"
            >
              <Tab label="A One-Off Prompt" />
              <Tab
                label={
                  <Button variant="none" onClick={handleStartConversation}>
                    <Chip color="primary" size="small" label="new!" />
                    Ongoing Conversation &rarr;
                  </Button>
                }
              />
            </Tabs>
            <TabPanel value={tabValue} index={0}>
              <Grid container spacing={2} style={{ marginTop: '20px' }}>
                <Grid
                  size={
                    aiSettings.layoutStrategy ===
                    CONSTANTS.ai.layoutStrategy.url.name
                      ? 12
                      : 6
                  }
                >
                  <AISelect
                    aiProp="layoutStrategy"
                    aiPropDescription="What is the layout?"
                    onChange={(ls) => updatePreference('layoutStrategy', ls)}
                    currentValue={aiSettings.layoutStrategy}
                  />
                </Grid>
                {aiSettings.layoutStrategy ===
                  CONSTANTS.ai.layoutStrategy.url.name && (
                  <Grid size={12}>
                    <TextField
                      fullWidth
                      value={aiSettings.url}
                      onChange={(e) => {
                        updatePreference('url', e.target.value)
                      }}
                      placeholder="What URL would you like to auto-diagram?"
                    />
                  </Grid>
                )}
                <Grid size={6}>
                  <AISelect
                    aiProp="tone"
                    aiPropDescription="What is the writing tone?"
                    onChange={(t) => updatePreference('tone', t)}
                    currentValue={aiSettings.tone}
                  />
                </Grid>
                <Grid size={6}>
                  <AISelect
                    aiProp="levelOfDetail"
                    aiPropDescription="How much detail?"
                    onChange={(d) => updatePreference('levelOfDetail', d)}
                    currentValue={aiSettings.levelOfDetail}
                  />
                </Grid>
                <Grid size={6}>
                  <AISelect
                    aiProp="wordsPerNode"
                    aiPropDescription="Words per node?"
                    onChange={(d) => updatePreference('wordsPerNode', d)}
                    currentValue={aiSettings.wordsPerNode}
                  />
                </Grid>
              </Grid>
            </TabPanel>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={(e) => {
            onClose()
          }}
          color="secondary"
        >
          Cancel
        </Button>
        <Button color="secondary" onClick={savePreference}>
          {sLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

AISettings.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  showPrompt: PropTypes.bool.isRequired,
  title: PropTypes.string.isRequired,
  textLabel: PropTypes.string.isRequired,
  isOnCanvas: PropTypes.bool.isRequired,
  saveLabel: PropTypes.string.isRequired,
  shareId: PropTypes.string.isRequired,
  enteredPrompt: PropTypes.string.isRequired,
  onChangePrompt: PropTypes.func,
  userAISettings: PropTypes.node,
}
