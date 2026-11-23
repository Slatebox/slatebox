/* eslint-disable no-unused-vars */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-underscore-dangle */
import React, { useRef, useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useAtom, useSetAtom } from 'jotai'
import { useNavigate } from 'react-router-dom'
import { useTracker } from 'meteor/react-meteor-data'
import AppBar from '@mui/material/AppBar'
import Button from '@mui/material/Button'
import { createJSONEditor } from 'vanilla-jsoneditor'
import 'vanilla-jsoneditor/themes/jse-theme-dark.css'
import Grid from '@mui/material/Grid2'
import AddIcon from '@mui/icons-material/Add'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import Container from '@mui/material/Container'
import Box from '@mui/material/Box'
import Slide from '@mui/material/Slide'
import Dialog from '@mui/material/Dialog'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'

import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import { Tooltip } from '@mui/material'
import CONSTANTS from '../../../api/common/constants'
import { ChatIntentions } from '../../../api/common/models'
import { globalMessage, isPersonaOpen } from '../../jotai/atoms'
import emptyAIConversation from './emptyAIConversation'
import confirmService from '../../common/confirm'

const styles = {
  heroContent: {
    padding: (theme) => theme.spacing(8, 0, 6),
  },
  cardHeader: {
    backgroundColor: (theme) => theme.palette.primary.main,
    color: (theme) => theme.palette.secondary.main,
  },
  cardPricing: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'baseline',
    marginBottom: (theme) => theme.spacing(2),
  },
  appBar: {
    position: 'relative',
  },
  title: {
    marginLeft: (theme) => theme.spacing(2),
    flex: 1,
    color: '#fff',
  },
  focused: {
    color: (theme) => theme.palette.secondary.main,
  },
  paymentSpacing: {
    padding: '10px',
  },
}

const Transition = React.forwardRef((props, ref) => (
  // eslint-disable-next-line react/jsx-props-no-spreading
  <Slide direction="up" ref={ref} {...props} />
))

export default function CreatePersona() {
  const theme = useTheme()
  const history = useNavigate()
  const personaRef = useRef()
  const editorRef = useRef()
  const isMURef = useRef()
  const [message, setMessage] = useAtom(globalMessage)
  const [isMU, setIsMU] = React.useState(false)
  const [selectedIntention, setIntention] = React.useState(null)
  const [getIsPersonaOpen, setPersonaOpen] = useAtom(isPersonaOpen)
  const setGlobalMessage = useSetAtom(globalMessage)
  const handleClose = () => {
    setPersonaOpen(false)
  }

  async function handleSave() {
    const updatedIntention = editorRef.current.get()
    if (updatedIntention.text) {
      const saveIntention = JSON.parse(updatedIntention.text)
      const intentionId = await Meteor.callAsync(
        CONSTANTS.methods.chatIntentions.save,
        saveIntention
      )
      setIntention({ ...saveIntention, _id: intentionId })
      setGlobalMessage({
        visible: true,
        text: `Successfully saved the ${saveIntention.name} AI conversation`,
        severity: 'info',
        autoHide: 10000,
      })
    }
  }

  async function handleDelete() {
    const deleteIntention = editorRef.current.get()
    if (deleteIntention.json._id) {
      const onOK = await confirmService.show({
        theme,
        title: 'Delete?',
        message: `Are you sure you would like to delete the ${deleteIntention.json.name} AI conversation?`,
        actionItems: [
          { label: 'Cancel', return: false },
          { label: 'OK', return: true },
        ],
      })
      if (onOK) {
        await Meteor.callAsync(
          CONSTANTS.methods.chatIntentions.delete,
          deleteIntention.json._id
        )
        setGlobalMessage({
          visible: true,
          text: `Successfully deleted the ${deleteIntention.json.name} AI conversation`,
          severity: 'info',
          autoHide: 10000,
        })
      }
    }
  }

  function handleRenderMenu(items, context) {
    const separator = {
      separator: true,
    }

    const saveButton = {
      onClick: handleSave,
      text: 'Save ',
      title: 'Save Conversation',
    }

    const deleteButton = {
      onClick: handleDelete,
      text: ' Del',
      title: 'Delete Conversation',
    }

    const space = {
      space: true,
    }

    if (selectedIntention.universal) {
      return [...items, space, saveButton, space]
    }

    return [
      ...items,
      space,
      saveButton,
      separator,
      selectedIntention.universal ? null : deleteButton,
      space,
    ]
  }

  useEffect(() => {
    if (getIsPersonaOpen) {
      const editor = personaRef.current
      if (editor && selectedIntention) {
        if (editorRef.current?.destroy) {
          editorRef.current.destroy()
        }
        editorRef.current = createJSONEditor({
          target: editor,
          mainMenuBar: false,
          navigationBar: false,
          props: {
            content: { json: selectedIntention },
            onRenderMenu: handleRenderMenu,
            onChange: (
              updatedContent,
              previousContent,
              { contentErrors, patchResult }
            ) => {
              // content is an object { json: JSONValue } | { text: string }
              // console.log('onChange', {
              //   updatedContent,
              //   previousContent,
              //   contentErrors,
              //   patchResult,
              // })
            },
          },
        })
      }
    }
  }, [selectedIntention, getIsPersonaOpen])

  useEffect(() => {
    async function getMU() {
      const gmu = await Meteor.callAsync(CONSTANTS.methods.users.isMasterUser)
      setIsMU(gmu)
    }
    getMU()
  }, [getIsPersonaOpen])

  const chatIntentions = useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.chatIntentions)
    if (isMU) {
      return ChatIntentions.find().fetch()
    }
    return ChatIntentions.find({ orgId: Meteor.user()?.orgId }).fetch()
  }, [isMU])

  const loadIntention = (event, intentionId) => {
    if (!intentionId) {
      setIntention(emptyAIConversation)
    } else {
      setIntention(ChatIntentions.findOne({ _id: intentionId }))
    }
  }

  // const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <Dialog
      fullScreen
      open={getIsPersonaOpen}
      onClose={handleClose}
      TransitionComponent={Transition}
      PaperProps={{
        sx: {
          background: theme.palette.shell.background,
        },
      }}
    >
      <AppBar sx={styles.appBar}>
        <Toolbar>
          <IconButton
            edge="start"
            sx={{ color: '#fff' }}
            onClick={handleClose}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
          <Typography variant="h6" sx={styles.title}>
            Manage Real-Time AI Conversations
          </Typography>
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" component="main">
        <Grid
          container
          spacing={2}
          justifyContent="space-between"
          alignContent="flex-start"
          alignItems="flex-start"
        >
          <Grid size={3}>
            <Typography variant="overline" color="secondary">
              Select the AI conversation to edit...
            </Typography>

            <ToggleButtonGroup
              value={selectedIntention?._id}
              exclusive
              onChange={loadIntention}
              sx={{ flexWrap: 'wrap' }}
              aria-label="slate background"
            >
              {chatIntentions?.map((intention) => (
                <ToggleButton
                  size="small"
                  key={intention.name}
                  value={intention._id}
                  aria-label={intention.name}
                >
                  {intention.name} &rarr;
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Box m={2}>
              <IconButton
                edge="start"
                size="large"
                color="secondary"
                variant=""
                onClick={() => loadIntention(null)}
              >
                <Tooltip title="Create New">
                  <AddIcon />
                </Tooltip>
              </IconButton>
            </Box>
          </Grid>
          <Grid size={9}>
            {!selectedIntention && (
              <Typography variant="h5" sx={{ padding: '20px' }}>
                Editable Conversations Will Show Here
              </Typography>
            )}
            <div
              ref={personaRef}
              className="jse-theme-dark"
              style={{ '--jse-theme-color': '#000', marginTop: '10px' }}
            />
          </Grid>
        </Grid>
      </Container>
    </Dialog>
  )
}
