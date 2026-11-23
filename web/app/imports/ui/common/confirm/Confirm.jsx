/* eslint-disable no-underscore-dangle */
/* eslint-disable react/no-array-index-key */
import Button from '@mui/material/Button'
import { Meteor } from 'meteor/meteor'
import uploadHeaders from '../../../api/client/uploadHeaders'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import React, { Component } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import TextField from '@mui/material/TextField'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import Switch from '@mui/material/Switch'
import Grid from '@mui/material/Grid2'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'

import AISelect from '../../components/ai/AISelect'
import CONSTANTS from '../../../api/common/constants'

let resolve
class Confirm extends Component {
  static create(props = {}) {
    const containerElement = document.createElement('div')
    document.body.appendChild(containerElement)
    // React 18 createRoot replaces the legacy ReactDOM.render. render() is async
    // and returns undefined, but this singleton API must return the mounted
    // instance so callers can invoke confirmService.show(). flushSync forces a
    // synchronous commit so the ref is populated before we return the instance.
    const root = createRoot(containerElement)
    let instance = null
    flushSync(() => {
      root.render(
        <Confirm
          createConfirmProps={props}
          ref={(r) => {
            instance = r
          }}
        />
      )
    })
    return instance
  }

  constructor() {
    super()
    this.state = {
      isOpen: false,
      errorMessage: null,
      showConfirmProps: {},
      selectedThemeId: Meteor.user()?.profile?.aiSettings?.themeId ?? '',
      selectedTemplateId: Meteor.user()?.profile?.aiSettings?.templateId ?? '',
      disableVoiceId:
        Meteor.user()?.profile?.aiSettings?.disableVoiceId ?? false,
      additionalCaptureItems: [],
    }
    this.handleClose = this.handleClose.bind(this)
    this.show = this.show.bind(this)
    this.return = {}
    this.dropZoneRef = React.createRef()
    // this.componentDidUpdate = this.createDropZone.bind(this)
    // this.componentDidMount = this.mounting.bind(this)
  }

  // eslint-disable-next-line class-methods-use-this, react/sort-comp
  prepUpload(txt, isReadOnly, btnDisabled = false) {
    const ele = document.querySelector('#txtimageLink')
    ele.value = txt
    ele.setAttribute('readonly', isReadOnly ? 'true' : 'false')
    document.querySelector('#btncontinue').disabled = btnDisabled
  }

  // eslint-disable-next-line class-methods-use-this, react/sort-comp
  createDropZone() {
    // The uploader loads when a dialog first asks for one, never with the page.
    setTimeout(async () => {
      if (this.dropZoneRef.current || !document.querySelector('#sbDropZone')) return
      const { default: Dropzone } = await import('dropzone')
      if (!this.dropZoneRef.current && document.querySelector('#sbDropZone')) {
        this.dropZoneRef.current = new Dropzone('#sbDropZone', {
          url: '/sbupload/image',
          headers: uploadHeaders(),
          dictDefaultMessage: 'Click to upload...',
          addRemoveLinks: true,
          autoProcessQueue: true,
          // 'png', 'jpeg', 'gif', 'webp'
          acceptedFiles: [
            'image/png',
            'image/jpg',
            'image/gif',
            'image/webp',
            'image/jpeg',
            'application/pdf',
            'text/plain',
          ].join(','),
          renameFile: (file) => {
            const ext = file.name.split('.').pop()
            this.prepUpload('Uploading...', true, true)
            return `${Meteor.userId()}.${ext}`
          },
          complete: (file) => {
            const uploadedUrl = file.xhr.response
            this.prepUpload(uploadedUrl, true)

            const { showConfirmProps, additionalCaptureItems } = this.state
            const { captureItems } = showConfirmProps
            const a = [...captureItems, ...additionalCaptureItems].find(
              (ax) => ax.key === 'imageLink'
            )
            this.handleChange(a, uploadedUrl)

            if (file._removeLink) {
              file._removeLink.innerHTML = 'Remove File'
              file._removeLink.style.color = '#fff'
            }
            return file.previewElement.classList.add('dz-complete')
          },
          removedfile: async (file) => {
            file.previewElement.remove()
            this.prepUpload('', false)
            if (file.xhr?.response) {
              await Meteor.callAsync(CONSTANTS.methods.images.removeImage, {
                url: file.xhr.response,
              })
            }
            return true
          },
        })
      }
    }, 100)
  }

  async handleAction(a) {
    const { selectedThemeId, selectedTemplateId, showConfirmProps } = this.state
    const ret =
      Object.keys(this.return).length > 0
        ? {
            ...this.return,
            val: a.return,
            theme: selectedThemeId
              ? showConfirmProps.themes.find(
                  (t) => t.themeId === selectedThemeId
                )
              : null,
            template: selectedTemplateId
              ? showConfirmProps.templates.find(
                  (t) => t.templateId === selectedTemplateId
                )
              : null,
          }
        : a.return
    let hasErrors = null
    if (a.return === true && a.validate) {
      hasErrors = await a.validate(ret)
    }
    if (hasErrors) {
      this.setState({ errorMessage: hasErrors })
      resolve(false)
    } else {
      this.setState({ isOpen: false, errorMessage: '' })
      resolve(ret)
    }
  }

  handleClose(e) {
    this.setState({ isOpen: false, errorMessage: '' })
    resolve(false)
  }

  async handleChange(a, val) {
    const { showConfirmProps, additionalCaptureItems, disableVoiceId } =
      this.state
    const { actionItems, captureItems } = showConfirmProps
    const gather = [...captureItems, ...additionalCaptureItems].find(
      (g) => g.key === a.key
    )

    // check if any have a size too large and add that to the errors

    // assign all the values from the form on the return object:
    Object.assign(this.return, {
      [a.key]: a.size ? val.substring(0, a.size) : val,
      [`${a.key}_unchecked`]: val,
      val: true,
    })

    const possibleValue =
      a.type === 'select'
        ? gather.possibleValues.find((v) => v.val === val)
        : null
    if (possibleValue?.supplemental) {
      Object.assign(this.return, {
        [`${a.key}_supplemental`]: possibleValue.supplemental,
        val: true,
      })
    }
    if (!possibleValue) {
      Object.assign(this.return, {
        dedicated: true,
      })
    }
    if (possibleValue?.postProcessing) {
      Object.assign(this.return, {
        postProcessing: possibleValue.postProcessing,
      })
    }
    if (possibleValue?.additionalParams) {
      Object.assign(this.return, {
        additionalParams: possibleValue.additionalParams,
      })
    }
    if (possibleValue?.sentenceBatchSize) {
      Object.assign(this.return, {
        sentenceBatchSize: possibleValue.sentenceBatchSize,
      })
    }
    if (possibleValue?.voiceId) {
      Object.assign(this.return, {
        voiceId: possibleValue.voiceId,
      })
    }
    if (disableVoiceId) {
      Object.assign(this.return, {
        disableVoiceId,
      })
    }
    if (possibleValue?.defaultShapes) {
      Object.assign(this.return, {
        defaultShapes: possibleValue.defaultShapes,
      })
    }
    if (possibleValue?.layoutType) {
      Object.assign(this.return, {
        layoutType: possibleValue.layoutType,
      })
    }
    if (a.additionalPrompts && val && val.trim() !== '') {
      Object.assign(this.return, {
        additionalPrompts: a.additionalPrompts,
        additionalPromptKey: a.key,
      })
    }

    // console.log('defaultThemeId?', possibleValue?.defaultThemeId)
    if (possibleValue?.defaultThemeId) {
      this.setThemeForAIConversation(possibleValue.defaultThemeId)
    }

    if (possibleValue?.additionalCaptureItems) {
      this.setState({
        additionalCaptureItems: possibleValue.additionalCaptureItems,
      })
    }

    const anyInvalid = await actionItems
      .find((ax) => ax.validate)
      ?.validate(this.return)

    this.setState({ errorMessage: anyInvalid })
  }

  async setThemeForAIConversation(themeId) {
    this.setState({ selectedThemeId: themeId })
  }

  async setTemplateForAIConversation(type, val) {
    this.setState({ selectedTemplateId: val })
  }

  async setDisableVoiceId(checked) {
    this.setState({ disableVoiceId: checked })
    if (checked) {
      this.return.voiceId = null
    }
  }

  show(props = {}) {
    // eslint-disable-next-line react/destructuring-assignment, react/prop-types
    const showConfirmProps = { ...this.props.createConfirmProps, ...props }
    this.setState({ additionalCaptureItems: [] })
    this.return = {}
    showConfirmProps?.captureItems?.forEach((k) => {
      this.return[k.key] = ''
    })
    this.setState({ isOpen: true, showConfirmProps })
    this.createDropZone()
    return new Promise((res) => {
      resolve = res
      this.dropZoneRef.current = null
    })
  }

  render() {
    const {
      isOpen,
      showConfirmProps,
      errorMessage,
      selectedThemeId,
      selectedTemplateId,
      disableVoiceId,
      additionalCaptureItems,
    } = this.state
    const {
      theme,
      message,
      title,
      captureItems = [],
      allowThemeSelect = false,
      allowTemplateSelect = false,
      allowVoiceSwitch = false,
      showImageDropZone = false,
      themes = [],
      templates = [],
      footerMessage = null,
      actionItems = [
        { key: 'yes', label: 'Yes', return: true },
        { key: 'no', label: 'No', return: false },
      ],
    } = showConfirmProps

    return (
      <div>
        {theme && (
          <ThemeProvider theme={theme}>
            <Dialog
              onClose={this.handleClose}
              aria-labelledby="customized-dialog-title"
              open={isOpen}
              fullWidth
              maxWidth="sm"
            >
              <DialogTitle style={{ color: theme?.palette?.secondary?.main }}>
                {title}
              </DialogTitle>
              {errorMessage && (
                <DialogContent
                  style={{ minHeight: '70px', backgroundColor: '#fff' }}
                  dividers
                >
                  <Typography variant="body2" style={{ color: 'red' }}>
                    {errorMessage}
                  </Typography>
                </DialogContent>
              )}
              <DialogContent dividers>
                <Typography
                  gutterBottom
                  dangerouslySetInnerHTML={{ __html: message }}
                />
                {[...captureItems, ...additionalCaptureItems].map((a) => (
                  <Box p={1} key={a.key}>
                    {a.type === 'textfield' && (
                      <TextField
                        fullWidth
                        sx={a.visible === false ? { display: 'none' } : {}}
                        variant="outlined"
                        placeholder={a.placeholder}
                        id={`txt${a.key}`}
                        key={a.key}
                        onChange={(e) => {
                          this.handleChange(a, e.target.value)
                        }}
                      />
                    )}
                    {a.type === 'textarea' && (
                      <TextField
                        fullWidth
                        variant="outlined"
                        placeholder={a.placeholder}
                        multiline
                        minRows={4}
                        id={`txt${a.key}`}
                        key={a.key}
                        onChange={(e) => {
                          this.handleChange(a, e.target.value)
                        }}
                      />
                    )}
                    {a.type === 'select' && (
                      <FormControl sx={{ width: '100%' }}>
                        <InputLabel
                          sx={{
                            color: '#ccc',
                            padding: '10px',
                            marginTop: '-13px',
                          }}
                        >
                          {a.placeholder}
                        </InputLabel>
                        <Select
                          fullWidth
                          minRows={4}
                          id={`txt${a.key}`}
                          value={this.return[a.key] || a.defaultValue}
                          onChange={(e) => {
                            this.handleChange(a, e.target.value)
                          }}
                        >
                          {a.possibleValues?.map((v) => [
                            <MenuItem key={v.val} value={v.val}>
                              <Grid container>
                                <Grid size={12}>
                                  <Typography variant="h6" color="secondary">
                                    {v.text}
                                  </Typography>
                                </Grid>
                                <Grid size={12}>
                                  <Typography variant="caption">
                                    {v.teaser}
                                  </Typography>
                                </Grid>
                              </Grid>
                            </MenuItem>,
                          ])}
                        </Select>
                      </FormControl>
                    )}
                  </Box>
                ))}
                {showImageDropZone && (
                  <Box
                    p={1}
                    id="sbDropZone"
                    className="dropzone"
                    style={{ cursor: 'pointer' }}
                  />
                )}
                {allowThemeSelect && (
                  <Box p={1}>
                    <AISelect
                      aiProp="themeId"
                      aiPropDescription="Create with theme?"
                      onChange={(d) => this.setThemeForAIConversation(d)}
                      currentValue={selectedThemeId}
                      availableThemes={themes}
                      styleVariant="standard"
                    />
                  </Box>
                )}
                {allowTemplateSelect && (
                  <Box p={1}>
                    <AISelect
                      aiProp="templateId"
                      aiPropDescription="Select a template"
                      onChange={(d) =>
                        this.setTemplateForAIConversation('templateId', d)
                      }
                      currentValue={selectedTemplateId}
                      availableThemes={templates}
                      styleVariant="standard"
                    />
                  </Box>
                )}
                {allowVoiceSwitch && (
                  <Box p={1}>
                    <Grid
                      container
                      spacing={1}
                      justifyContent="flex-end"
                      alignItems="center"
                      alignContent="center"
                    >
                      <Grid size={4} style={{ color: '#ccc' }}>
                        Disable Voice?
                      </Grid>
                      <Grid size={8}>
                        <Tooltip
                          title="If enabled, the AI will speak to you in addition to texting via chat."
                          placement="top"
                          aria-label="aiSpeaking"
                        >
                          <Switch
                            checked={disableVoiceId}
                            onChange={(e) =>
                              this.setDisableVoiceId(e.target.checked)
                            }
                          />
                        </Tooltip>
                      </Grid>
                    </Grid>
                  </Box>
                )}
              </DialogContent>
              {footerMessage && (
                <DialogContent style={{ minHeight: '80px' }} dividers>
                  <Typography variant="body2">{footerMessage}</Typography>
                </DialogContent>
              )}
              <DialogActions>
                {actionItems?.map((a) => (
                  <Button
                    key={a.key}
                    id={`btn${a.key}`}
                    variant="outlined"
                    color="secondary"
                    onClick={() => {
                      this.handleAction(a)
                    }}
                  >
                    {a.label}
                  </Button>
                ))}
              </DialogActions>
            </Dialog>
          </ThemeProvider>
        )}
      </div>
    )
  }
}

Confirm.defaultProps = {
  createConfirmProps: null,
}

export default Confirm
