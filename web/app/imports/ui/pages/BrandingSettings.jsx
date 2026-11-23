/* eslint-disable no-underscore-dangle */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useSetAtom } from 'jotai'
import Container from '@mui/material/Container'
import Grid from '@mui/material/Grid2'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import PropTypes from 'prop-types'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import Tooltip from '@mui/material/Tooltip'
import ListItemText from '@mui/material/ListItemText'
import { globalMessage } from '../jotai/atoms'
import confirmService from '../common/confirm'
import BrandingGuidelines from '../components/teams/BrandingGuidelines'
import BrandPreviewSlate from '../components/BrandPreviewSlate'
import ColorPresetEditor from '../components/teams/ColorPresetEditor'
import { ChatIntentions, OrganizationSettings } from '../../api/common/models'
import CONSTANTS from '../../api/common/constants'
import { useTheme } from '@mui/material/styles'

// --- Helper Function ---
// Renamed and returns an array of detail strings
const getPresetDetails = (presetValue) => {
  if (!presetValue) return [] // Return empty array if no value

  const details = []
  const {
    background,
    categoryStyles,
    noteStyles,
    categoryFont,
    noteFont,
    categoryFontSize,
    noteFontSize,
    aiDirectiveId,
  } = presetValue

  // Add background description
  if (background) {
    const { activeType, colorKey, gradientConfig } = background
    if (activeType === 'color' && colorKey) {
      details.push('Background: Single Color')
    } else if (activeType === 'gradient' && gradientConfig) {
      const { gradientType, gradientColorCount } = gradientConfig
      const type = gradientType === 'radial' ? 'Radial' : 'Linear'
      const count = gradientColorCount || '?'
      details.push(`Background: ${type} Gradient (${count} colors)`)
    }
  }

  // Add category color count and font/size info
  if (categoryStyles && categoryStyles.length > 0) {
    const styleCount = categoryStyles.length // Could be more than 1 pair later
    let catDetail = `Categories: ${styleCount} style${
      styleCount !== 1 ? 's' : ''
    }`
    if (categoryFont) catDetail += `, Font: ${categoryFont}`
    if (categoryFontSize) catDetail += ` (${categoryFontSize}px)`
    details.push(catDetail)
  } else if (categoryFont || categoryFontSize) {
    // Show font/size even if no styles
    let catDetail = 'Categories:'
    if (categoryFont) catDetail += ` Font: ${categoryFont}`
    if (categoryFontSize) catDetail += ` (${categoryFontSize}px)`
    details.push(catDetail)
  }

  // Add note color count and font/size info
  if (noteStyles && noteStyles.length > 0) {
    const styleCount = noteStyles.length
    let noteDetail = `Notes: ${styleCount} style${styleCount !== 1 ? 's' : ''}`
    if (noteFont) noteDetail += `, Font: ${noteFont}`
    if (noteFontSize) noteDetail += ` (${noteFontSize}px)`
    details.push(noteDetail)
  } else if (noteFont || noteFontSize) {
    // Show font/size even if no styles
    let noteDetail = 'Notes:'
    if (noteFont) noteDetail += ` Font: ${noteFont}`
    if (noteFontSize) noteDetail += ` (${noteFontSize}px)`
    details.push(noteDetail)
  }

  // Add AI directive info if present
  if (aiDirectiveId) {
    details.push('AI Directive: Selected')
  }

  return details // Return array of descriptive strings
}

// --- Helper TabPanel Component (can be reused or defined inline) ---
function SimpleTabPanel(props) {
  // Explicitly list props to avoid prop spreading warning
  const { children = null, value, index, id, labelledby } = props
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={id} // Use passed id
      aria-labelledby={labelledby} // Use passed labelledby
    >
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  )
}
SimpleTabPanel.propTypes = {
  children: PropTypes.node,
  index: PropTypes.number.isRequired,
  value: PropTypes.number.isRequired,
  id: PropTypes.string.isRequired,
  labelledby: PropTypes.string.isRequired,
}

export default function BrandingSettings() {
  const [selectedIntentionId, setSelectedIntentionId] = useState('default')
  const [isSaving, setIsSaving] = useState(false)
  const setMessage = useSetAtom(globalMessage)
  const saveDebounceTimerRef = useRef(null)
  const theme = useTheme()

  // Restore state for top-level tabs
  const [mainTabValue, setMainTabValue] = useState(0)
  const handleMainTabChange = (event, newValue) => {
    setMainTabValue(newValue)
  }

  // Refs to hold the latest tracker data
  const orgSettingsRef = useRef({})
  const intentionsRef = useRef([])
  const fontStylesRef = useRef([])

  // State to trigger updates when tracker data actually changes
  const [trackerDataVersion, setTrackerDataVersion] = useState(0)

  // useTracker: Fetches data, updates refs, and increments version on change
  const ready = useTracker(() => {
    const orgId = Meteor.user()?.orgId
    if (!orgId) {
      // Ensure refs are reset if user logs out or loses orgId
      let changed = false
      if (Object.keys(orgSettingsRef.current).length > 0) {
        orgSettingsRef.current = {}
        changed = true
      }
      if (intentionsRef.current.length > 0) {
        intentionsRef.current = []
        changed = true
      }
      if (fontStylesRef.current.length > 0) {
        fontStylesRef.current = []
        changed = true
      }
      if (changed) {
        setTrackerDataVersion((v) => v + 1)
      }
      return true // Ready, but with no data
    }

    const subs = [
      Meteor.subscribe(CONSTANTS.publications.chatIntentions),
      Meteor.subscribe(CONSTANTS.publications.organizationSettings),
    ]
    const isReady = subs.every((sub) => sub.ready())

    if (isReady) {
      // Fetch intentions
      const fetchedIntentions = ChatIntentions.find({
        $or: [{ orgId }, { universal: true }],
      }).fetch()
      fetchedIntentions.sort((a, b) => a.name.localeCompare(b.name))

      // Fetch settings and derive font styles and AI directives
      const fetchedSettingsMap = {}
      const fetchedFontStyles = []
      const allSettings = OrganizationSettings.find({ orgId }).fetch()

      allSettings.forEach((setting) => {
        fetchedSettingsMap[setting._id] = setting

        // Process typography settings
        if (
          setting.type === 'typography' &&
          !setting.deleted &&
          setting.value
        ) {
          fetchedFontStyles.push({
            name: setting.value.name || 'Unnamed Font Style',
            value: setting.value.value || 'Roboto',
          })
        }
      })

      fetchedFontStyles.sort((a, b) => a.name.localeCompare(b.name))

      // Compare with previous data (simple stringify comparison for this example)
      // Note: A deep comparison function would be more robust
      const currentSettingsStr = JSON.stringify(orgSettingsRef.current)
      const fetchedSettingsStr = JSON.stringify(fetchedSettingsMap)
      const currentIntentionsStr = JSON.stringify(intentionsRef.current)
      const fetchedIntentionsStr = JSON.stringify(fetchedIntentions)
      const currentFontStylesStr = JSON.stringify(fontStylesRef.current)
      const fetchedFontStylesStr = JSON.stringify(fetchedFontStyles)

      let dataChanged = false
      if (fetchedSettingsStr !== currentSettingsStr) {
        orgSettingsRef.current = fetchedSettingsMap
        dataChanged = true
      }
      if (fetchedIntentionsStr !== currentIntentionsStr) {
        intentionsRef.current = fetchedIntentions
        dataChanged = true
      }
      if (fetchedFontStylesStr !== currentFontStylesStr) {
        fontStylesRef.current = fetchedFontStyles
        dataChanged = true
      }

      // If any data changed, increment the version number to trigger re-renders/re-calculations
      if (dataChanged) {
        setTrackerDataVersion((v) => v + 1)
      }
    }

    return isReady
  }, []) // Empty dependency array, tracker handles reactivity

  // Read current data from refs for rendering
  const currentOrgSettings = orgSettingsRef.current
  const currentIntentions = intentionsRef.current
  const currentFontStyles = fontStylesRef.current

  // Derived state calculations now depend on the version number
  const paletteColors = useMemo(() => {
    if (!currentOrgSettings || Object.keys(currentOrgSettings).length === 0) {
      return []
    }
    return Object.values(currentOrgSettings)
      .filter(
        (setting) =>
          setting &&
          setting.type === 'color' &&
          !setting.deleted &&
          setting.value
      )
      .map((setting) => ({
        _id: setting._id,
        displayName: setting.value?.name || 'Unnamed Color',
        value: setting.value?.value || '#F1F1F1',
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [trackerDataVersion]) // Depend on version

  // Derived state calculations now depend on the version number
  // Keep this fontStyles useMemo as it's used by the UI (e.g., ColorPresetEditor)
  const fontStyles = useMemo(
    () => currentFontStyles, // Use the ref's current value
    [trackerDataVersion]
  )

  const currentPresetData = useMemo(() => {
    if (!currentOrgSettings || !selectedIntentionId) return {}

    const presetSetting = Object.values(currentOrgSettings).find(
      (setting) =>
        setting?.type === 'preset' &&
        setting?.intentionId === selectedIntentionId
    )

    const loadedValue = presetSetting?.value || {}
    const processedValue = JSON.parse(JSON.stringify(loadedValue)) // Deep clone

    if (paletteColors && paletteColors.length > 0) {
      const hexToIdMap = new Map(paletteColors.map((p) => [p.value, p._id]))

      // --- Transform categoryStyles (old format) OR categoryStyles (new format) to KEY format --- START ---
      if (Array.isArray(processedValue.categoryStyles)) {
        // Already new format, just map hex values (if present) to keys
        processedValue.categoryStyles = processedValue.categoryStyles.map(
          (style) => ({
            backgroundColorKey:
              hexToIdMap.get(style.backgroundColor) ||
              style.backgroundColorKey ||
              null,
            foregroundColorKey:
              hexToIdMap.get(style.foregroundColor) ||
              style.foregroundColorKey ||
              null,
          })
        )
      } else {
        processedValue.categoryStyles = [] // Ensure it's an array if neither exists
      }
      // --- Transform categoryStyles --- END ---

      // --- Transform noteStyles (old format) OR noteStyles (new format) to KEY format --- START ---
      if (Array.isArray(processedValue.noteStyles)) {
        // New format
        processedValue.noteStyles = processedValue.noteStyles.map((style) => ({
          backgroundColorKey:
            hexToIdMap.get(style.backgroundColor) ||
            style.backgroundColorKey ||
            null,
          foregroundColorKey:
            hexToIdMap.get(style.foregroundColor) ||
            style.foregroundColorKey ||
            null,
        }))
      } else {
        processedValue.noteStyles = []
      }
      // --- Transform noteStyles --- END ---

      // Process background color
      // Ensure colorKey exists before setting based on colorValue
      if (processedValue.background) {
        if (processedValue.background.colorValue) {
          const id = hexToIdMap.get(processedValue.background.colorValue)
          processedValue.background.colorKey = id || null // Restore ID or set null if hex not found
          // delete processedValue.background.colorValue; // Optionally remove
        } else {
          processedValue.background.colorKey = null // No colorValue means no colorKey
        }
      }

      // Process background gradient base color
      if (processedValue.background?.gradientConfig) {
        if (processedValue.background.gradientConfig.baseColorValue) {
          const id = hexToIdMap.get(
            processedValue.background.gradientConfig.baseColorValue
          )
          processedValue.background.gradientConfig.baseColorKey = id || null // Restore ID or set null
          // Keep existing gradientColors array during load if present
          processedValue.background.gradientConfig.gradientColors =
            processedValue.background.gradientConfig.gradientColors || []
        } else {
          processedValue.background.gradientConfig.baseColorKey = null // No baseColorValue means no baseColorKey
        }
      }
    }
    // --- Transform loaded HEX values back to IDs --- END ---

    // return presetSetting ? { ...(presetSetting.value || {}) } : {}
    return processedValue // Return the processed object with IDs
  }, [trackerDataVersion, selectedIntentionId, paletteColors]) // Add paletteColors dependency

  // --- NEW State for UI Editing ---
  // Holds the preset data as it's being modified in the editor
  const [editingPresetData, setEditingPresetData] = useState(currentPresetData)

  // Effect to sync editing state when the selected preset changes or tracker data updates
  useEffect(() => {
    // Reset editing state to match the current saved/loaded state
    setEditingPresetData(currentPresetData)
    // Clear any pending save from the *previous* preset when switching
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current)
      saveDebounceTimerRef.current = null
      setIsSaving(false) // Ensure saving indicator is off if a save was pending
    }
  }, [currentPresetData]) // Depend only on the derived currentPresetData

  const handleIntentionChange = (event) => {
    setSelectedIntentionId(event.target.value)
    // Note: The useEffect above will handle updating editingPresetData
  }

  // --- NEW Update Handler for the Editor --- START ---
  // This function is passed to ColorPresetEditor as onPresetChange
  const handlePresetEditorChange = useCallback((partialUpdate) => {
    // Use functional update form to merge changes reliably
    setEditingPresetData((currentData) => ({
      ...currentData,
      ...partialUpdate,
    }))
    // Debounced save effect will handle the actual save
  }, []) // No dependencies needed as it only calls a setter
  // --- NEW Update Handler for the Editor --- END ---

  // Function to perform the actual save operation
  const performSave = useCallback(
    async (dataToSave) => {
      /* console.log(
        '[performSave] Data received:',
        JSON.parse(JSON.stringify(dataToSave))
      ) */
      // --- Remove logging BEFORE transform --- START ---
      /* console.log(
        '[performSave] Fonts BEFORE transform (shorthands?):',
        dataToSave.categoryFont,
        dataToSave.noteFont
      ) */
      // --- Remove logging BEFORE transform --- END ---

      const userId = Meteor.userId()
      const userOrgId = Meteor.user()?.orgId
      if (!userId || !userOrgId || !selectedIntentionId) {
        console.error('Save aborted: Missing user/org/intention ID.')
        return
      }

      setIsSaving(true)
      saveDebounceTimerRef.current = null

      const transformedData = JSON.parse(JSON.stringify(dataToSave))
      const idToHexMap = new Map(paletteColors.map((p) => [p._id, p.value]))
      const fallbackColor = '#CCCCCC'

      // --- Transform categoryStyles (keys) to HEX for saving --- START ---
      if (Array.isArray(transformedData.categoryStyles)) {
        transformedData.categoryStyles = transformedData.categoryStyles.map(
          (style) => ({
            backgroundColor:
              idToHexMap.get(style.backgroundColorKey) || fallbackColor,
            foregroundColor: idToHexMap.get(style.foregroundColorKey) || null, // Save null if no key or not found
          })
        )
        // Optionally remove styles with fallback BG? Depends on requirements.
        // transformedData.categoryStyles = transformedData.categoryStyles.filter(s => s.backgroundColor !== fallbackColor);
      }
      // --- Transform categoryStyles --- END ---

      // --- Transform noteStyles (keys) to HEX for saving --- START ---
      if (Array.isArray(transformedData.noteStyles)) {
        transformedData.noteStyles = transformedData.noteStyles.map(
          (style) => ({
            backgroundColor:
              idToHexMap.get(style.backgroundColorKey) || fallbackColor,
            foregroundColor: idToHexMap.get(style.foregroundColorKey) || null,
          })
        )
      }
      // --- Transform noteStyles --- END ---

      // Transform background keys
      if (transformedData.background) {
        // Handle single background color
        if (
          transformedData.background.activeType === 'color' &&
          transformedData.background.colorKey
        ) {
          const hex = idToHexMap.get(transformedData.background.colorKey)
          if (hex) {
            transformedData.background.colorValue = hex // Store hex in new field
          } else {
            console.warn(
              `Color key ${transformedData.background.colorKey} not found for background.`
            )
            transformedData.background.colorValue = fallbackColor
          }
          // Ensure gradient config is nulled for single color
          transformedData.background.gradientConfig = null
        }
        // Handle gradient background
        else if (
          transformedData.background.activeType === 'gradient' &&
          transformedData.background.gradientConfig
        ) {
          // Ensure colorValue is nulled for gradient
          transformedData.background.colorValue = null

          // Transform baseColorKey to baseColorValue
          const baseKey = transformedData.background.gradientConfig.baseColorKey
          if (baseKey) {
            const hex = idToHexMap.get(baseKey)
            if (hex) {
              transformedData.background.gradientConfig.baseColorValue = hex // Store hex
            } else {
              console.warn(`Base color key ${baseKey} not found for gradient.`)
              transformedData.background.gradientConfig.baseColorValue =
                fallbackColor // Use fallback
            }
          } else if (
            !transformedData.background.gradientConfig.baseColorValue
          ) {
            // Base key is missing AND baseColorValue is not already set, so use fallback
            transformedData.background.gradientConfig.baseColorValue =
              fallbackColor
          }

          // Keep the gradientColors array as generated by the editor
          transformedData.background.gradientConfig.gradientColors =
            transformedData.background.gradientConfig.gradientColors || []
        } else {
          // Handle cases where activeType might be gradient but config is missing
          console.warn('Gradient background selected but config is missing.')
          // Optionally revert to a default or single color
        }
      }

      // --- Transform font shorthand names to capitalized names for saving --- START ---
      if (transformedData.categoryFont) {
        transformedData.categoryFont =
          CONSTANTS.fonts.find(
            (font) => font.val === transformedData.categoryFont
          )?.name || transformedData.categoryFont
      }
      if (transformedData.noteFont) {
        transformedData.noteFont =
          CONSTANTS.fonts.find((font) => font.val === transformedData.noteFont)
            ?.name || transformedData.noteFont
      }
      // --- Remove logging AFTER transform --- START ---
      /* console.log(
        '[performSave] Fonts AFTER transform (capitalized?):',
        transformedData.categoryFont,
        transformedData.noteFont
      ) */
      // --- Remove logging AFTER transform --- END ---

      try {
        const latestOrgSettings = orgSettingsRef.current
        const existingPreset = Object.values(latestOrgSettings).find(
          (setting) =>
            setting.type === 'preset' &&
            setting.intentionId === selectedIntentionId
        )

        await Meteor.callAsync(CONSTANTS.methods.organizationSettings.save, {
          _id: existingPreset?._id,
          type: 'preset',
          intentionId: selectedIntentionId,
          value: transformedData, // Should have capitalized fonts now
          orgId: userOrgId,
        })

        // Use latest intentions from ref for the message
        const latestIntentions = intentionsRef.current
        const intentionName = latestIntentions.find(
          (i) => i._id === selectedIntentionId
        )?.name
        setMessage({
          visible: true,
          text: `Preset for '${
            selectedIntentionId === 'default'
              ? 'Default'
              : intentionName || selectedIntentionId
          }' saved.`,
          severity: 'success',
          autoHide: 5000,
        })
      } catch (error) {
        console.error('Error saving preset (debounced):', error)
        setMessage({
          visible: true,
          text: 'Error saving preset. Please try again.',
          severity: 'error',
          autoHide: 10000,
        })
      } finally {
        setIsSaving(false)
      }
    },
    // Add fontStyles to dependency array
    [selectedIntentionId, setMessage, paletteColors, fontStyles]
  )

  // Memoize the stringified versions to avoid constant re-stringification
  const stringifiedEditing = useMemo(
    () => JSON.stringify(editingPresetData),
    [editingPresetData]
  )

  const stringifiedCurrent = useMemo(
    () => JSON.stringify(currentPresetData),
    [currentPresetData]
  )

  // Effect to trigger the debounced save when editing state changes
  useEffect(() => {
    // Only attempt save if the editing data differs from the current saved state
    if (stringifiedEditing !== stringifiedCurrent) {
      // Clear any previous timer
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current)
      }

      // Set a new timer
      saveDebounceTimerRef.current = setTimeout(() => {
        performSave(editingPresetData)
      }, 100) // 100 ms debounce delay
    }

    // Cleanup function to clear the timer if component unmounts or dependencies change
    return () => {
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current)
        saveDebounceTimerRef.current = null
      }
    }
  }, [stringifiedEditing, stringifiedCurrent, editingPresetData]) // Remove performSave from deps

  const [presentationModeEnabled, setPresentationModeEnabled] = useState(false)

  const handlePresentationModeChange = (event) => {
    // Check if event and event.target exist before accessing checked
    const isChecked = event && event.target ? event.target.checked : false
    setPresentationModeEnabled(isChecked)
  }

  // --- Add function to force presentation mode ON --- START ---
  const forceEnablePresentationMode = useCallback(() => {
    // Only enable if it's not already enabled
    if (!presentationModeEnabled) {
      setPresentationModeEnabled(true)
      // Optionally trigger any side-effects handlePresentationModeChange might have,
      // but setting state directly is usually sufficient.
      // handlePresentationModeChange({ target: { checked: true } }); // Example if handler needed
    }
  }, [presentationModeEnabled]) // Depend on presentationModeEnabled
  // --- Add function to force presentation mode ON --- END ---

  // --- Find Square Logo URL ---
  const squareLogoSetting = useMemo(() => {
    const settingsMap = orgSettingsRef.current
    if (!settingsMap || Object.keys(settingsMap).length === 0) {
      return null
    }
    // Find based on the actual setting key structure
    const found = Object.values(settingsMap).find(
      (setting) =>
        setting?.type === 'logo' && setting?.value?.logoType === 'squareLogo'
    )
    return found
  }, [trackerDataVersion]) // Depend on tracker version

  const squareLogoUrl = useMemo(() => {
    const url = squareLogoSetting?.value?.url || null
    return url
  }, [squareLogoSetting])

  // --- Add Delete Preset Handler --- START ---
  const handleDeletePreset = useCallback(
    async (intentionIdToDelete) => {
      const userOrgId = Meteor.user()?.orgId
      if (!userOrgId) {
        setMessage({
          visible: true,
          text: 'Cannot delete preset: User or organization not found.',
          severity: 'error',
          autoHide: 5000,
        })
        return
      }

      // Find the intention name *before* deleting for the confirmation/success message
      const intentionName =
        intentionsRef.current.find((i) => i._id === intentionIdToDelete)
          ?.name || intentionIdToDelete

      // Determine display name for confirmation
      const displayName =
        intentionIdToDelete === 'default' ? 'Default Preset' : intentionName

      // --- Use confirmService --- START ---
      const confirmed = await confirmService.show({
        theme,
        title: `Clear ${displayName} Configuration?`,
        message: `Are you sure you want to clear the saved configuration for the ${displayName}? This cannot be undone.`,
      })

      if (!confirmed) {
        return
      }
      // --- Use confirmService --- END ---

      try {
        await Meteor.callAsync(
          CONSTANTS.methods.organizationSettings.deletePreset,
          {
            // Send only intentionId as backend gets orgId from user
            intentionId: intentionIdToDelete,
          }
        )

        setMessage({
          visible: true,
          text: `Configuration for '${displayName}' cleared successfully.`,
          severity: 'success',
          autoHide: 5000,
        })

        // If the deleted preset was the currently selected one, reset to default
        if (selectedIntentionId === intentionIdToDelete) {
          setSelectedIntentionId('default')
        }
        // No need to manually update state, useTracker will handle it
      } catch (error) {
        console.error('Error clearing preset configuration:', error)
        setMessage({
          visible: true,
          text: `Error clearing configuration: ${
            error.reason || error.message
          }`,
          severity: 'error',
          autoHide: 10000,
        })
      }
    },
    [setMessage, selectedIntentionId, theme] // Add theme dependency
  )
  // --- Add Delete Preset Handler --- END ---

  return (
    <Container maxWidth="xl">
      {/* Main Header */}
      <Typography
        component="h1"
        variant="h4"
        sx={{ my: 3, textAlign: 'center' }}
      >
        Brand Kit
      </Typography>
      {/* Top Level Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs
          value={mainTabValue}
          onChange={handleMainTabChange}
          aria-label="Branding Sections"
          centered // Center the tabs
          sx={{
            // Add styling for orange indicator/text
            '& .MuiTabs-indicator': {
              height: '3px',
            },
            '& .MuiTab-root.Mui-selected': {
              fontWeight: 'bold',
            },
          }}
        >
          <Tab
            label="Branding"
            id="main-tab-0"
            aria-controls="main-tabpanel-0"
          />
          <Tab
            label="Slate Presets & Preview"
            id="main-tab-1"
            aria-controls="main-tabpanel-1"
          />
        </Tabs>
      </Box>
      {/* Branding Tab Content */}
      <SimpleTabPanel
        value={mainTabValue}
        index={0}
        id="main-tabpanel-0"
        labelledby="main-tab-0"
      >
        <BrandingGuidelines setMessage={setMessage} />
      </SimpleTabPanel>
      {/* Slate Presets & Preview Tab Content */}
      <SimpleTabPanel
        value={mainTabValue}
        index={1}
        id="main-tabpanel-1"
        labelledby="main-tab-1"
      >
        <Grid container spacing={4} alignItems="flex-start">
          {/* Presets Column */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="h5" sx={{ mb: 1 }}>
              Slate Presets
            </Typography>
            <Typography variant="body2" sx={{ mb: 4, opacity: 0.8 }}>
              Define the visual style for different types of slates. The
              &apos;Default Preset&apos; applies to all slates unless a more
              specific preset is configured.
            </Typography>
            <FormControl fullWidth sx={{ mb: 3 }}>
              <InputLabel id="intention-select-label" color="secondary">
                Select Preset to Edit
              </InputLabel>
              <Select
                labelId="intention-select-label"
                id="intention-select"
                value={selectedIntentionId}
                color="secondary"
                label="Select Preset to Edit"
                onChange={handleIntentionChange}
                disabled={!ready}
                renderValue={(selectedValue) => {
                  let displayName
                  // --- Updated renderValue logic --- START ---
                  if (selectedValue === 'default') {
                    displayName = <em>Default Preset</em>
                  } else {
                    const intention = currentIntentions.find(
                      (i) => i._id === selectedValue
                    )
                    displayName = intention
                      ? intention.name
                      : `Preset ${selectedValue}` // Fallback if intention not found
                  }

                  // Check if a preset setting exists for the selected value
                  const presetSetting = Object.values(
                    currentOrgSettings || {}
                  ).find(
                    (setting) =>
                      setting?.type === 'preset' &&
                      setting?.intentionId === selectedValue
                  )
                  const showClearButton = !!presetSetting

                  return (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%', // Ensure Box takes full width
                      }}
                    >
                      {/* Display Name */}
                      <Typography component="span" sx={{ flexGrow: 1, mr: 1 }}>
                        {displayName}
                      </Typography>

                      {/* Conditional Clear Button */}
                      {showClearButton && (
                        <Tooltip title="Clear Preset Configuration">
                          {/* marginRight is negative to counteract IconButton padding */}
                          <IconButton
                            aria-label="clear preset configuration"
                            onMouseDown={(event) => {
                              // Stop propagation to parent Select
                              event.stopPropagation()
                              // Prevent default button action (like focus changes)
                              event.preventDefault()

                              // Now call the handler which contains the confirmation
                              handleDeletePreset(selectedValue)
                            }}
                            size="medium" // Use medium size for button
                            edge="end" // Align to the end
                            sx={{ mr: -1 }} // Adjust margin if needed
                          >
                            {/* --- Use medium size for icon --- START --- */}
                            <CloseIcon
                              fontSize="medium"
                              sx={{ color: 'error.main' }}
                            />
                            {/* --- Use medium size for icon --- END --- */}
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  )
                  // --- Updated renderValue logic --- END ---
                }}
              >
                <MenuItem value="default">
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="body1">
                      <em>Default Preset</em>
                    </Typography>
                    {(() => {
                      const defaultPresetSetting = Object.values(
                        currentOrgSettings || {}
                      ).find(
                        (setting) =>
                          setting?.type === 'preset' &&
                          // Explicitly check for 'default' intentionId
                          setting?.intentionId === 'default'
                      )
                      const defaultDetails = defaultPresetSetting
                        ? getPresetDetails(defaultPresetSetting.value)
                        : []
                      if (defaultDetails.length > 0) {
                        return defaultDetails.map((detail) => (
                          <Typography
                            key={detail}
                            variant="caption"
                            sx={{ fontStyle: 'italic', opacity: 0.8 }}
                          >
                            {detail}
                          </Typography>
                        ))
                      }
                      return (
                        <Typography
                          variant="caption"
                          sx={{ fontStyle: 'italic', opacity: 0.6 }}
                        >
                          (Not Saved)
                        </Typography>
                      )
                    })()}
                  </Box>
                </MenuItem>

                {/* Use currentIntentions from ref */}
                {currentIntentions.map((intention) => {
                  // Use currentOrgSettings from ref
                  const presetSetting = Object.values(
                    currentOrgSettings || {}
                  ).find(
                    (setting) =>
                      setting?.type === 'preset' &&
                      setting?.intentionId === intention._id
                  )
                  const details = presetSetting
                    ? getPresetDetails(presetSetting.value)
                    : []
                  // ... rest of intention MenuItem rendering ...
                  // --- Modify MenuItem for Delete Button --- START ---
                  return (
                    <MenuItem key={intention._id} value={intention._id}>
                      {/* Use ListItemText to handle primary/secondary text */}
                      <ListItemText
                        primary={intention.name}
                        secondary={
                          details.length > 0 ? (
                            <Box
                              component="span"
                              sx={{ display: 'flex', flexDirection: 'column' }}
                            >
                              {details.map((detail) => (
                                <Typography
                                  key={`${intention._id}-${detail}`}
                                  component="span" // Use span for inline display if needed
                                  variant="caption"
                                  sx={{ fontStyle: 'italic', opacity: 0.8 }}
                                >
                                  {detail}
                                </Typography>
                              ))}
                            </Box>
                          ) : null // Don't render secondary if no details
                        }
                        secondaryTypographyProps={{ component: 'div' }} // Ensure secondary text renders correctly
                        sx={{ mr: 4 }} // Add margin to prevent text overlap with icon
                      />
                      {/* --- Remove Delete Button --- START ---
                      <ListItemSecondaryAction>
                        <IconButton
                          edge="end"
                          aria-label="delete"
                          onClick={(event) => {
                            event.stopPropagation() // Prevent menu item selection
                            event.preventDefault() // Prevent default action
                            handleDeletePreset(intention._id)
                          }}
                          size="small" // Make icon slightly smaller
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </ListItemSecondaryAction>
                       --- Remove Delete Button --- END --- */}
                    </MenuItem>
                  )
                  // --- Modify MenuItem for Delete Button --- END ---
                })}
              </Select>
            </FormControl>
            {ready ? (
              <ColorPresetEditor
                presetData={editingPresetData}
                onPresetChange={handlePresetEditorChange}
                paletteColors={paletteColors}
                fontStyles={fontStyles}
                isSaving={isSaving}
                onPresentationTabSelect={forceEnablePresentationMode}
              />
            ) : (
              <Typography>Loading Presets...</Typography>
            )}
          </Grid>

          {/* Preview Column */}
          <Grid size={{ xs: 12, md: 6 }}>
            {/* Header with Checkbox */}
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              mb={2}
            >
              <Typography variant="h6" sx={{ textAlign: 'center' }}>
                Live Preview
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    color="primary"
                    checked={presentationModeEnabled}
                    onChange={handlePresentationModeChange}
                    size="small"
                    sx={{
                      color: 'primary.main',
                      ml: 1, // Add margin left for spacing
                    }}
                  />
                }
                label="Presentation Mode"
                sx={{ ml: 1 }} // Style label color
              />
            </Box>

            {/* Pass presentation mode state, but NOT colors directly */}
            <BrandPreviewSlate
              previewId="brand-kit-preview"
              presetData={editingPresetData} // Colors now come from here
              paletteColors={paletteColors}
              presentationModeEnabled={presentationModeEnabled}
              squareLogoUrl={squareLogoUrl}
            />

            {/* Add Informational Note Below Preview */}
            <Typography
              color="text.secondary"
              variant="body2"
              sx={{
                mt: 1, // Margin top for spacing
                textAlign: 'center',
                fontStyle: 'italic',
              }}
            >
              Note: Preview shows visual style only; not interactive. Actual
              slates will reflect the preset style.
            </Typography>
          </Grid>
        </Grid>
      </SimpleTabPanel>
    </Container>
  )
}
