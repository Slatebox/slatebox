/* eslint-disable no-underscore-dangle */
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Meteor } from 'meteor/meteor'
import uploadHeaders from '../../../api/client/uploadHeaders'
import { Random } from 'meteor/random'
import { useTracker } from 'meteor/react-meteor-data'
import Grid from '@mui/material/Grid2'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Box from '@mui/material/Box'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Alert from '@mui/material/Alert'
import InfoIcon from '@mui/icons-material/Info'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import CloseIcon from '@mui/icons-material/Close'
import { Dropzone } from 'dropzone'
import PropTypes from 'prop-types'
import CONSTANTS from '../../../api/common/constants'
import { OrganizationSettings } from '../../../api/common/models'
import '../../common/react-colorful.css'
import 'dropzone/dist/dropzone.css'
import Popover from '@mui/material/Popover'

// Add a constant for HTML elements to choose from
const HTML_ELEMENTS = [
  { value: '', label: 'None (Custom Style)' },
  { value: 'h1', label: 'Heading 1 (H1)' },
  { value: 'h2', label: 'Heading 2 (H2)' },
  { value: 'h3', label: 'Heading 3 (H3)' },
  { value: 'h4', label: 'Heading 4 (H4)' },
  { value: 'h5', label: 'Heading 5 (H5)' },
  { value: 'h6', label: 'Heading 6 (H6)' },
  { value: 'p', label: 'Paragraph (P)' },
  { value: 'span', label: 'Span' },
  { value: 'div', label: 'Div' },
  { value: 'li', label: 'List Item (LI)' },
  { value: 'a', label: 'Link (A)' },
  { value: 'blockquote', label: 'Blockquote' },
  { value: 'code', label: 'Code' },
  { value: 'pre', label: 'Preformatted Text (PRE)' },
]

// --- Debounce Utility ---
function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const context = this
    const later = () => {
      timeout = null
      func.apply(context, args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}
// --- End Debounce Utility ---

// Dynamic preview component defined outside the render function
function DynamicPreview({ elementType = 'div', fontFamily, children }) {
  // Default to div if no element type is specified
  const ElementTag = elementType || 'div'

  return React.createElement(
    ElementTag,
    {
      style: {
        fontFamily,
        margin: '8px 0 0 0',
        padding: 0,
      },
    },
    children
  )
}

// PropTypes for DynamicPreview
DynamicPreview.propTypes = {
  elementType: PropTypes.string,
  fontFamily: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
}

// Helper function to load Google Fonts dynamically
const loadGoogleFont = (fontFamily) => {
  // Skip if no font or system fonts
  if (
    !fontFamily ||
    [
      'Arial',
      'Helvetica',
      'Times New Roman',
      'Courier New',
      'Verdana',
      'Georgia',
    ].includes(fontFamily)
  ) {
    return
  }

  try {
    const { fonts } = CONSTANTS
    // Convert font name to Google Fonts format (lowercase with hyphens)
    const formattedFont = fonts.find((f) => f.val === fontFamily)?.name

    console.log('formattedFont', formattedFont)

    // Check if already loaded to avoid duplicates
    if (document.querySelector(`link[href*="${formattedFont}"]`)) {
      console.log(`Font already loaded: ${fontFamily}`)
      return
    }

    // Create a link element for the Google Font
    const linkElement = document.createElement('link')
    linkElement.rel = 'stylesheet'

    // Use the proper Google Fonts URL format with encoding
    linkElement.href = `https://fonts.googleapis.com/css2?family=${formattedFont}:wght@400;700&display=swap`

    // Add to document head
    document.head.appendChild(linkElement)
    console.log(`Loaded font: ${fontFamily}`)
  } catch (error) {
    console.error(`Error loading font ${fontFamily}:`, error)
  }
}

function initDropzone(element, logoType, callbacks) {
  const { setErrorMessage, saveLogoToSettings } = callbacks

  return new Dropzone(element, {
    url: '/sbupload/image',
    headers: uploadHeaders(),
    dictDefaultMessage: `Drag and drop ${logoType.displayName} here or click to upload...`,
    maxFiles: 1,
    dictMaxFilesExceeded: 'You can upload a max of 1 logos per type.',
    addRemoveLinks: true,
    autoProcessQueue: true,
    acceptedFiles: [
      'image/png',
      'image/jpg',
      'image/gif',
      'image/webp',
      'image/jpeg',
      'image/svg+xml',
    ].join(','),
    renameFile: (file) => {
      console.log('fileName', file.name)
      // const ext = file.name.split('.').pop()
      // return `logo_${logoType.key}_${Meteor.userId()}.${ext}`
    },
    init() {
      this.on('addedfile', () => {
        setErrorMessage('')
      })

      // this.on('removedfile', async (removedFile) => {
      //   if (removedFile.xhr?.response) {
      //     try {
      //       const fileName = removedFile.xhr.response.split('/').pop()
      //       await Meteor.callAsync(CONSTANTS.methods.images.removeImage, {
      //         fileName,
      //       })
      //     } catch (error) {
      //       console.error('Error removing logo image:', error)
      //     }
      //   }
      // })
    },
    complete(file) {
      const dz = this
      if (file.accepted) {
        setErrorMessage('')
        const uploadedUrl = file.xhr.response

        // Save the logo setting
        saveLogoToSettings(logoType.key, file.name, uploadedUrl)

        // Remove the completed file preview from Dropzone UI immediately after saving
        dz.removeFile(file)

        return true // Indicate success
      }

      // If we reach here, the file was not accepted
      setErrorMessage(
        `File type ${
          file.type || 'unknown'
        } is not supported. Please use PNG, JPG, GIF, WEBP, or SVG files.`
      )
      dz.removeFile(file) // Remove the rejected file preview
      return false // Indicate failure
    },
  })
}

// Define the main component BEFORE defining propTypes
export default function BrandingGuidelines({ setMessage }) {
  const [mainTab, setMainTab] = useState(0)
  const [settings, setSettings] = useState({})

  const { settings: settingsData } = useTracker(() => {
    const subscription = Meteor.subscribe(
      CONSTANTS.publications.organizationSettings
    )
    const isReady = subscription.ready()
    let fetchedSettings = {}
    if (isReady) {
      fetchedSettings = OrganizationSettings.find({
        orgId: Meteor.user()?.orgId,
        deleted: { $ne: true },
      }).fetch()

      const settingsMap = {}
      fetchedSettings.forEach((setting) => {
        settingsMap[setting._id] = setting
      })
      return { settings: settingsMap }
    }
    return { settings: {} }
  }, [])

  useEffect(() => {
    setSettings(settingsData)
  }, [settingsData])

  const handleMainTabChange = (event, newValue) => {
    setMainTab(newValue)
  }

  const saveOrUpdateSetting = useCallback(async (settingData) => {
    const objectToSend = {
      ...settingData,
      orgId: Meteor.user()?.orgId || 'default',
    }

    if (!objectToSend._id) {
      objectToSend._id = Random.id()
    }

    try {
      await Meteor.callAsync(
        CONSTANTS.methods.organizationSettings.save,
        objectToSend
      )
      // Update local state: remove if deleted, otherwise update/add
      setSettings((prev) => {
        const newState = { ...prev }
        if (objectToSend.deleted) {
          delete newState[objectToSend._id] // Remove from map
        } else {
          // Ensure the object exists before spreading
          newState[objectToSend._id] = {
            ...(prev[objectToSend._id] || {}), // Use empty object if new
            ...objectToSend,
          }
        }
        return newState
      })
    } catch (error) {
      console.error('Error saving/updating setting:', error)
    }
  }, [])

  // Debounced function specifically for saving to backend
  const debouncedBackendSave = useCallback(
    debounce(async (settingData) => {
      const objectToSend = {
        ...settingData,
        orgId: Meteor.user()?.orgId,
      }

      if (!objectToSend._id) {
        // This shouldn't happen if called from updateColorProperty, but good practice
        objectToSend._id = Random.id()
      }

      try {
        console.log('Debounced save executing for:', objectToSend._id)
        await Meteor.callAsync(
          CONSTANTS.methods.organizationSettings.save,
          objectToSend
        )
        // NOTE: No setSettings call here! UI update happens immediately.
      } catch (error) {
        console.error('Error in debounced backend save:', error)
        // Optionally: Add user feedback about the save failure
      }
    }, 500), // 500ms delay
    [] // No dependencies needed as it calls Meteor method directly
  )

  const renderLogoSettings = () => {
    const [errorMessage, setErrorMessage] = useState('')
    const dropZoneRefs = useRef({})
    const dropZoneInitialized = useRef({})

    const logoSettings = Object.values(settings).filter(
      (setting) => setting?.type === 'logo' && !setting.deleted
    )

    const getUploadedLogosByType = (logoType) =>
      logoSettings.filter((logo) => logo.value?.logoType === logoType)

    const handleLogoRemoval = async (logoId) => {
      const logoToRemove = settings[logoId]
      if (logoToRemove && logoToRemove.value?.logoType) {
        const logoTypeKey = logoToRemove.value.logoType
        const logoUrl = logoToRemove.value?.url
        const logoName = logoToRemove.value?.name // Use the stored name

        // --- 1. Call the NEW remove method --- START ---
        try {
          // Call the new remove method
          const removeResult = await Meteor.callAsync(
            CONSTANTS.methods.organizationSettings.remove,
            logoId
          )

          if (!removeResult?.success) {
            // Removal failed on the server, show error and stop
            console.error(
              'Server failed to remove setting:',
              removeResult?.message
            )
            setMessage({
              visible: true,
              text:
                removeResult?.message ||
                'Failed to remove logo setting on server.',
              severity: 'error',
              autoHide: 5000,
            })
            return // Stop execution
          }

          // If server removal was successful, update local state immediately
          setSettings((prev) => {
            const newState = { ...prev }
            delete newState[logoId]
            return newState
          })
        } catch (error) {
          // Catch errors from the Meteor call itself
          console.error('Error calling organizationSettings.remove:', error)
          setMessage({
            visible: true,
            text:
              error.reason || 'Error communicating with server to remove logo.',
            severity: 'error',
            autoHide: 5000,
          })
          return // Stop execution
        }
        // --- 1. Call the NEW remove method --- END ---

        // 2. Remove the actual image file from storage
        if (logoUrl) {
          try {
            await Meteor.callAsync(CONSTANTS.methods.images.removeImage, {
              url: logoUrl,
            })
            setMessage({
              visible: true,
              text: 'Logo removed successfully.',
              severity: 'success',
              autoHide: 3000,
            })
          } catch (error) {
            console.error('Error removing logo image file:', error)
            setMessage({
              visible: true,
              text: 'Logo setting removed, but failed to delete the image file.',
              severity: 'warning',
              autoHide: 5000,
            })
          }
        } else {
          console.warn(
            'Could not determine filename to remove for logo setting:',
            logoId
          )
          setMessage({
            visible: true,
            text: 'Logo setting removed, but could not determine the image filename to delete.',
            severity: 'warning',
            autoHide: 5000,
          })
        }

        // 3. Remove the file preview from the correct Dropzone instance
        const dropzoneInstance = dropZoneRefs.current[logoTypeKey]
        if (dropzoneInstance) {
          // Find the file in the Dropzone instance. Match based on the stored name.
          const fileToRemove = dropzoneInstance.files.find(
            (f) => f.name === logoName
          )
          if (fileToRemove) {
            try {
              console.log(
                `Removing file preview from Dropzone (${logoTypeKey}):`,
                fileToRemove.name
              )
              dropzoneInstance.removeFile(fileToRemove)
            } catch (dzError) {
              console.error('Error removing file from Dropzone UI:', dzError)
            }
          } else {
            console.warn(
              `Could not find file ${logoName} in Dropzone instance ${logoTypeKey} to remove its preview.`
            )
          }
        } else {
          console.warn(`Could not find Dropzone instance for ${logoTypeKey}`)
        }
      } else {
        console.error(
          'handleLogoRemoval called with invalid logoId or missing logoType:',
          logoId
        )
      }
    }

    const saveLogoToSettings = (logoTypeKey, fileName, uploadedUrl) => {
      // Find existing logo of the same type
      const existingLogoSetting = Object.values(settings).find(
        (setting) =>
          setting.type === 'logo' && setting.value?.logoType === logoTypeKey
      )

      const settingData = {
        _id: existingLogoSetting?._id, // Use existing ID if found
        type: 'logo',
        value: {
          logoType: logoTypeKey,
          name: fileName,
          url: uploadedUrl,
        },
        // orgId will be added by saveOrUpdateSetting
      }

      console.log(
        'Saving/Updating logo:',
        settingData._id ? 'Updating' : 'Creating new',
        settingData
      )
      saveOrUpdateSetting(settingData)
    }

    useEffect(() => {
      const logoTypesConfig = [
        { key: 'primaryLogo', displayName: 'Primary Logo (Horizontal)' },
        { key: 'squareLogo', displayName: 'Square Logo' },
      ]

      logoTypesConfig.forEach((logoType) => {
        const dropzoneId = `dropzone-${logoType.key}`
        const element = document.getElementById(dropzoneId)

        if (element && !dropZoneInitialized.current[logoType.key]) {
          dropZoneRefs.current[logoType.key] = initDropzone(
            `#${dropzoneId}`,
            logoType,
            {
              setErrorMessage,
              saveLogoToSettings,
            }
          )
          dropZoneInitialized.current[logoType.key] = true
        }
      })

      return () => {
        Object.values(dropZoneRefs.current).forEach((dropzone) => {
          if (dropzone?.destroy) {
            dropzone.destroy()
          }
        })
        dropZoneInitialized.current = {}
      }
    }, [mainTab])

    return (
      <Grid container spacing={3}>
        {errorMessage && (
          <Grid size={12}>
            <Alert severity="error">{errorMessage}</Alert>
          </Grid>
        )}
        <Grid size={12}>
          <Alert severity="info" sx={{ width: 'fit-content' }}>
            Supported logo file types: PNG, JPG, GIF, WEBP, and SVG
          </Alert>
        </Grid>
        {[
          { key: 'primaryLogo', displayName: 'Primary Logo (Horizontal)' },
          { key: 'squareLogo', displayName: 'Square Logo' },
        ].map((logoType) => (
          <Grid size={6} key={logoType.key}>
            <Typography variant="h6" gutterBottom>
              {logoType.displayName}
            </Typography>

            <Grid container spacing={2}>
              <Grid size={12}>
                <Box
                  id={`dropzone-${logoType.key}`}
                  className="dropzone"
                  sx={{
                    cursor: 'pointer',
                    border: '1px dashed',
                    bgcolor: 'background.paper',
                    borderColor: 'divider',
                    p: 2,
                    mb: 2,
                    minHeight: '100px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                />
              </Grid>

              {getUploadedLogosByType(logoType.key).map((logo) => (
                <Grid size={6} key={logo._id}>
                  <Box
                    sx={{
                      p: 2,
                      border: '1px solid #eee',
                      borderRadius: 1,
                      position: 'relative',
                    }}
                  >
                    <IconButton
                      size="small"
                      onClick={() => handleLogoRemoval(logo._id)}
                      sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        color: 'error.main',
                        background: 'rgba(0, 0, 0, 0.6)',
                        '&:hover': {
                          background: 'rgba(0, 0, 0, 0.8)',
                        },
                      }}
                    >
                      <DeleteIcon />
                    </IconButton>

                    <Box
                      sx={{
                        width: '100%',
                        textAlign: 'center',
                        p: 2,
                      }}
                    >
                      <img
                        src={logo.value?.url}
                        alt={logo.value?.fileName}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '150px',
                          objectFit: 'contain',
                        }}
                      />
                    </Box>

                    <Typography
                      variant="body2"
                      sx={{ mt: 1, textAlign: 'center' }}
                    >
                      {logo.value?.fileName}
                    </Typography>
                  </Box>
                </Grid>
              ))}
            </Grid>

            <Box sx={{ my: 3 }} />
          </Grid>
        ))}
      </Grid>
    )
  }

  const renderColorPalette = () => {
    const newColorRef = React.useRef(null)
    const [newColorScrollId, setNewColorScrollId] = useState(null)

    // --- State for Hex Input Popover ---
    const [anchorEl, setAnchorEl] = useState(null)
    const [editingColorId, setEditingColorId] = useState(null)
    const [currentHexInput, setCurrentHexInput] = useState('')
    // --- End State ---

    const colors = Object.values(settings)
      .filter((setting) => setting?.type === 'color' && !setting.deleted)
      .map((setting) => ({
        _id: setting._id,
        name: setting.value?.name || 'Unnamed Color',
        value: setting.value?.value || '#CCCCCC',
        createdAt: setting.createdAt || new Date(0),
      }))
      .sort((a, b) => a.createdAt - b.createdAt)

    useEffect(() => {
      if (newColorRef.current && newColorScrollId) {
        newColorRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        })
        setNewColorScrollId(null)
      }
    }, [newColorScrollId])

    const addNewColor = () => {
      const newSetting = {
        type: 'color',
        value: {
          name: 'New Color',
          value: '#F1F1F1',
        },
      }
      saveOrUpdateSetting(newSetting)
    }

    const removeColor = (colorId) => {
      // --- Check if color is used in any preset ---
      let isUsed = false
      const usedInPresets = [] // Use const as it's only pushed to

      Object.values(settings).forEach((setting) => {
        if (setting && setting.type === 'preset' && setting.value) {
          const presetValue = setting.value
          const presetName = setting.intentionId || 'Unknown Preset' // Get a name for the message

          // Check background single color
          if (presetValue.background?.colorKey === colorId) {
            isUsed = true
            if (!usedInPresets.includes(presetName))
              usedInPresets.push(presetName)
          }

          // Check gradient base color
          if (
            presetValue.background?.gradientConfig?.baseColorKey === colorId
          ) {
            isUsed = true
            if (!usedInPresets.includes(presetName))
              usedInPresets.push(presetName)
          }

          // Check category colors array
          if (presetValue.categoryColors?.includes(colorId)) {
            isUsed = true
            if (!usedInPresets.includes(presetName))
              usedInPresets.push(presetName)
          }

          // Check note colors array
          if (presetValue.noteColors?.includes(colorId)) {
            isUsed = true
            if (!usedInPresets.includes(presetName))
              usedInPresets.push(presetName)
          }
        }
      })

      if (isUsed) {
        // Color is used, show message and do not delete
        setMessage({
          visible: true,
          text: `Cannot delete color. It is currently used in the following preset(s): ${usedInPresets.join(
            ', '
          )}`,
          severity: 'warning',
          autoHide: 10000, // Show for 10 seconds
        })
        return // Stop execution
      }

      // --- Proceed with soft delete ---
      saveOrUpdateSetting({ _id: colorId, deleted: true })
    }

    const updateColorProperty = (colorId, property, value) => {
      // --- Immediate UI Update ---
      setSettings((prevSettings) => {
        const currentSetting = prevSettings[colorId]
        if (!currentSetting) return prevSettings // Should not happen

        // Create the updated setting object for local state
        const updatedSetting = {
          ...currentSetting,
          value: {
            ...currentSetting.value,
            [property]: value,
          },
        }

        // Return the new state object with the specific setting updated
        return {
          ...prevSettings,
          [colorId]: updatedSetting,
        }
      })
      // --- End Immediate UI Update ---

      // --- Debounced Backend Save ---
      // We need to pass the potentially updated setting object to the backend.
      // It's slightly inefficient to read it back from state, but safest.
      // Alternatively, construct the object here again, but ensure consistency.
      const updatedSettingForBackend = {
        _id: colorId,
        type: 'color',
        // Construct the value object based on the change
        // This assumes we only update one property at a time via this function
        value: {
          ...(settings[colorId]?.value || {}), // Get latest base value
          [property]: value, // Apply the specific change
        },
      }

      if (settings[colorId]) {
        // Only save if the setting exists
        debouncedBackendSave(updatedSettingForBackend)
      }
      // --- End Debounced Backend Save ---
    }

    // --- Handlers for Hex Input Popover ---
    const handleHexClick = (event, colorId, currentValue) => {
      setAnchorEl(event.currentTarget)
      setEditingColorId(colorId)
      setCurrentHexInput(currentValue || '#CCCCCC') // Use current value or default
    }

    const handlePopoverClose = () => {
      setAnchorEl(null)
      setEditingColorId(null)
      setCurrentHexInput('')
    }

    const handleHexUpdate = () => {
      // Validate hex code (simple regex)
      const hexRegex = /^#[0-9A-F]{6}$/i
      if (hexRegex.test(currentHexInput)) {
        updateColorProperty(editingColorId, 'value', currentHexInput)
        handlePopoverClose() // Close popover on successful update
      } else {
        // Optional: Add feedback for invalid input, e.g., shake animation or error state
        console.warn('Invalid hex code entered:', currentHexInput)
        // Keep the popover open for correction
      }
    }

    const handleHexInputKeyDown = (event) => {
      if (event.key === 'Enter') {
        handleHexUpdate()
      }
    }
    // --- End Handlers ---

    return (
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="h6" gutterBottom>
            Color Palette
          </Typography>
          <Button
            variant="contained"
            color="secondary"
            onClick={addNewColor}
            sx={{ mb: 2 }}
            startIcon={<AddIcon />}
          >
            Add Color
          </Button>
          <Grid container spacing={2}>
            {colors.map((color) => (
              <Grid
                size={2}
                key={color._id}
                ref={newColorScrollId === color._id ? newColorRef : null}
              >
                <Box sx={{ p: 2, border: '1px solid #eee', borderRadius: 1 }}>
                  <TextField
                    fullWidth
                    label="Color Name"
                    value={color.name}
                    onChange={(e) =>
                      updateColorProperty(color._id, 'name', e.target.value)
                    }
                    sx={{ mb: 2 }}
                    InputProps={{
                      endAdornment: (
                        <IconButton
                          size="small"
                          onClick={() => removeColor(color._id)}
                          sx={{ color: 'error.main' }}
                        >
                          <DeleteIcon />
                        </IconButton>
                      ),
                    }}
                  />
                  <FormControl variant="standard" fullWidth>
                    <Box
                      sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}
                    >
                      <InputLabel
                        htmlFor={`color-picker-${color._id}`}
                        shrink
                        sx={{
                          color: '#fff',
                          position: 'relative',
                          transform: 'none',
                        }}
                      >
                        Color
                      </InputLabel>
                      <Typography
                        variant="caption"
                        sx={{
                          ml: 1,
                          color: '#aaa',
                          cursor: 'pointer', // Make it clickable
                          '&:hover': {
                            color: '#fff', // Optional: highlight on hover
                          },
                        }}
                        onClick={(event) =>
                          handleHexClick(
                            event,
                            color._id,
                            color.value || '#CCCCCC'
                          )
                        }
                      >
                        ({color.value || '#CCCCCC'})
                      </Typography>
                    </Box>
                    <input
                      type="color"
                      id={`color-picker-${color._id}`}
                      value={color.value || '#CCCCCC'}
                      onChange={(e) =>
                        updateColorProperty(color._id, 'value', e.target.value)
                      }
                      style={{
                        border: '1px solid #555',
                        background: 'none',
                        width: '100%',
                        height: '35px',
                        cursor: 'pointer',
                      }}
                    />
                  </FormControl>
                </Box>
              </Grid>
            ))}
          </Grid>
        </Grid>
        {/* --- Popover for Hex Input --- */}
        <Popover
          open={Boolean(anchorEl)}
          anchorEl={anchorEl}
          onClose={handlePopoverClose}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'left',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'left',
          }}
        >
          <Box
            sx={{
              p: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              maxWidth: '160px',
            }}
          >
            <TextField
              variant="standard"
              size="small"
              value={currentHexInput}
              onChange={(e) => setCurrentHexInput(e.target.value)}
              onKeyDown={handleHexInputKeyDown}
              autoFocus
              sx={{ input: { fontFamily: 'monospace' }, mr: 1 }} // Add margin-right
            />
            <IconButton
              onClick={handlePopoverClose}
              size="small"
              sx={{ p: 0.2 }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
            {/* Optional: Add an explicit update button if needed
            <Button size="small" onClick={handleHexUpdate} sx={{ ml: 1 }}>Update</Button> 
            */}
          </Box>
        </Popover>
        {/* --- End Popover --- */}
      </Grid>
    )
  }

  const renderTypography = () => {
    const newTypographyRef = React.useRef(null)
    const [newTypographyScrollId, setNewTypographyScrollId] = useState(null)
    const { fonts } = CONSTANTS

    // Get typography settings, map, and sort
    const allFonts = Object.values(settings)
      .filter((setting) => setting?.type === 'typography' && !setting.deleted)
      .map((setting) => ({
        _id: setting._id,
        name: setting.value?.name || 'Unnamed Font',
        value: setting.value?.value || 'Roboto', // Default font family
        htmlElement: setting.value?.htmlElement || '', // Add HTML element field
        createdAt: setting.createdAt || new Date(0), // Use createdAt for sorting
      }))
      .sort((a, b) => a.createdAt - b.createdAt) // Sort by creation date

    // Effect to load Google Fonts whenever allFonts changes
    useEffect(() => {
      // Load all fonts in use
      allFonts.forEach((font) => {
        if (font.value) {
          loadGoogleFont(font.value)
        }
      })
    }, [allFonts])

    useEffect(() => {
      if (newTypographyRef.current && newTypographyScrollId) {
        newTypographyRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        })
        setNewTypographyScrollId(null)
      }
    }, [newTypographyScrollId])

    const addNewFont = () => {
      const newSetting = {
        type: 'typography',
        value: {
          name: 'New Font Style',
          value: 'Roboto',
          htmlElement: '', // Initialize with no HTML element
        },
      }
      saveOrUpdateSetting(newSetting)
    }

    const removeTypography = (fontId) => {
      saveOrUpdateSetting({ _id: fontId, deleted: true })
    }

    const updateTypographyProperty = (fontId, property, value) => {
      const currentSetting = settings[fontId]
      if (currentSetting) {
        // If updating the font value, load the Google Font
        if (property === 'value' && value) {
          loadGoogleFont(value)
        }

        saveOrUpdateSetting({
          _id: fontId,
          type: 'typography',
          value: {
            ...currentSetting.value,
            [property]: value,
          },
        })
      }
    }

    return (
      <Grid container spacing={3}>
        <Grid size={12}>
          <Typography variant="h6" gutterBottom>
            Typography
          </Typography>
          <Typography variant="body2" paragraph>
            Define font styles for your brand. You can optionally associate each
            style with a specific HTML element.
          </Typography>
          <Button
            variant="contained"
            color="secondary"
            onClick={addNewFont}
            sx={{ mb: 2 }}
            startIcon={<AddIcon />}
          >
            Add Font Style
          </Button>
          <Grid container spacing={2}>
            {allFonts.map((font) => (
              <Grid
                size={3}
                key={font._id}
                ref={
                  newTypographyScrollId === font._id ? newTypographyRef : null
                }
              >
                <Box
                  sx={{
                    p: 2,
                    border: '1px solid #eee',
                    borderRadius: 1,
                    mb: 3,
                  }}
                >
                  <TextField
                    fullWidth
                    label="Font Style Name"
                    value={font.name || ''}
                    onChange={(e) =>
                      updateTypographyProperty(font._id, 'name', e.target.value)
                    }
                    sx={{ mb: 2 }}
                    InputProps={{
                      endAdornment: (
                        <IconButton
                          size="small"
                          onClick={() => removeTypography(font._id)}
                          sx={{ color: 'error.main' }}
                        >
                          <DeleteIcon />
                        </IconButton>
                      ),
                    }}
                  />

                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel id={`font-family-label-${font._id}`}>
                      Font Family
                    </InputLabel>
                    <Select
                      labelId={`font-family-label-${font._id}`}
                      value={font.value || 'Roboto'}
                      label="Font Family"
                      onChange={(e) => {
                        updateTypographyProperty(
                          font._id,
                          'value',
                          e.target.value
                        )
                      }}
                    >
                      {fonts.map((fontOption) => (
                        <MenuItem key={fontOption.val} value={fontOption.val}>
                          {fontOption.val}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* Add HTML Element selector */}
                  <FormControl fullWidth>
                    <InputLabel id={`html-element-label-${font._id}`}>
                      HTML Element (Optional)
                    </InputLabel>
                    <Select
                      labelId={`html-element-label-${font._id}`}
                      value={font.htmlElement || ''}
                      label="HTML Element (Optional)"
                      onChange={(e) => {
                        updateTypographyProperty(
                          font._id,
                          'htmlElement',
                          e.target.value
                        )
                      }}
                    >
                      {HTML_ELEMENTS.map((element) => (
                        <MenuItem key={element.value} value={element.value}>
                          {element.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* Enhanced preview using the selected HTML element */}
                  {font.value && (
                    <Box mt={2} pt={2} borderTop="1px solid #eee">
                      <Typography variant="caption" sx={{ opacity: 0.7 }}>
                        Preview:
                      </Typography>
                      <Box>
                        <DynamicPreview
                          elementType={font.htmlElement}
                          fontFamily={
                            fonts.find((f) => f.val === font.value)?.name
                          }
                        >
                          {font.name || 'Sample Text'}
                        </DynamicPreview>
                      </Box>
                    </Box>
                  )}
                </Box>
              </Grid>
            ))}
          </Grid>
        </Grid>
      </Grid>
    )
  }

  const mainTabs = [
    { label: 'Logo Settings', content: renderLogoSettings() },
    { label: 'Color Palette', content: renderColorPalette() },
    { label: 'Typography', content: renderTypography() },
  ]

  return (
    <Box>
      <Tabs
        value={mainTab}
        onChange={handleMainTabChange}
        variant="scrollable"
        scrollButtons="auto"
      >
        {mainTabs.map((tab, index) => (
          <Tab
            key={tab.label}
            label={tab.label}
            id={`branding-tab-${index}`}
            aria-controls={`branding-tabpanel-${index}`}
          />
        ))}
      </Tabs>
      {mainTabs.map((tab, index) => (
        <Box
          key={tab.label}
          role="tabpanel"
          hidden={mainTab !== index}
          id={`branding-tabpanel-${index}`}
          aria-labelledby={`branding-tab-${index}`}
          sx={{ mt: 3 }}
        >
          {mainTab === index && tab.content}
        </Box>
      ))}
    </Box>
  )
}

BrandingGuidelines.propTypes = {
  setMessage: PropTypes.func.isRequired,
}
