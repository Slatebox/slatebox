/* eslint-disable react/no-array-index-key */
/* eslint-disable no-underscore-dangle */
import React, { useState, useCallback, useMemo } from 'react'
import PropTypes from 'prop-types'
import Grid from '@mui/material/Grid2'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Paper from '@mui/material/Paper'
import Alert from '@mui/material/Alert'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
// Local imports last
import PaletteColorPicker from './PaletteColorPicker'
import GradientConfigurator from './GradientConfigurator'

// --- Font Size Options (Generated) ---
const FONT_SIZES = []
for (let size = 10; size <= 700; size += 2) {
  FONT_SIZES.push(size)
}

// --- Helper TabPanel Component ---
function TabPanel(props) {
  // Explicitly list props to avoid spreading
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

TabPanel.propTypes = {
  children: PropTypes.node,
  index: PropTypes.number.isRequired,
  value: PropTypes.number.isRequired,
  id: PropTypes.string.isRequired, // Add id propType
  labelledby: PropTypes.string.isRequired, // Add labelledby propType
}

// --- Helper function to create a map from color ID to hex value ---
const createIdToHexMap = (paletteColors) => {
  const map = new Map()
  if (paletteColors) {
    paletteColors.forEach((p) => map.set(p._id, p.value))
  }
  return map
}

// Helper function to create a map from color ID to NAME value
const createIdToNameMap = (paletteColors) => {
  const map = new Map()
  if (paletteColors) {
    paletteColors.forEach((p) => map.set(p._id, p.displayName || '(Unnamed)'))
  }
  return map
}

// Helper function to create a map from hex value to color ID
const createHexToIdMap = (paletteColors) => {
  const map = new Map()
  if (paletteColors) {
    paletteColors.forEach((p) => map.set(p.value, p._id)) // Map hex value to ID
  }
  return map
}

export default function ColorPresetEditor({
  presetData,
  onPresetChange,
  paletteColors,
  fontStyles = [],
  isSaving = false,
  onPresentationTabSelect = null,
}) {
  // State for managing the active tab
  const [activePresetTab, setActivePresetTab] = useState(0)

  // --- NEW STATE for pending category/note style selections --- START ---
  const [selectedCategoryBgKey, setSelectedCategoryBgKey] = useState(null)
  const [selectedCategoryFgKey, setSelectedCategoryFgKey] = useState(null)
  const [selectedNoteBgKey, setSelectedNoteBgKey] = useState(null) // Add for notes later
  const [selectedNoteFgKey, setSelectedNoteFgKey] = useState(null) // Add for notes later
  // --- NEW STATE for pending category/note style selections --- END ---

  // Handler for changing tabs
  const handleTabChange = (event, newValue) => {
    setActivePresetTab(newValue)
    // --- Add check for presentation tab --- START ---
    const PRESENTATION_TAB_INDEX = 3
    if (newValue === PRESENTATION_TAB_INDEX && onPresentationTabSelect) {
      onPresentationTabSelect()
    }
    // --- Add check for presentation tab --- END ---
  }

  // --- Configuration Handlers ---

  // Handles selecting a single color for BACKGROUND
  const handleSingleColorSelect = useCallback(
    (key) => {
      onPresetChange({
        ...presetData,
        background: {
          ...presetData.background,
          activeType: 'color',
          colorKey: key,
          gradientConfig: null,
        },
      })
    },
    [presetData, onPresetChange]
  )

  // Handles changes in gradient configuration for BACKGROUND
  const handleGradientConfigChange = useCallback(
    (config) => {
      onPresetChange({
        ...presetData,
        background: {
          ...presetData.background,
          activeType: 'gradient',
          gradientConfig: config,
          colorKey: null,
        },
      })
    },
    [presetData, onPresetChange]
  )

  // --- Font/Size Handlers Modified --- START ---
  const handleCategoryFontChange = useCallback(
    (fontValue) => {
      // Pass only the changed value up
      onPresetChange({ categoryFont: fontValue || null }) // Send null if deselected
    },
    [onPresetChange] // Remove presetData dependency
  )

  const handleNoteFontChange = useCallback(
    (fontValue) => {
      onPresetChange({ noteFont: fontValue || null })
    },
    [onPresetChange]
  )

  const handleCategoryFontSizeChange = useCallback(
    (size) => {
      onPresetChange({ categoryFontSize: size || null }) // size is already number or null
    },
    [onPresetChange]
  )

  const handleNoteFontSizeChange = useCallback(
    (size) => {
      onPresetChange({ noteFontSize: size || null })
    },
    [onPresetChange]
  )

  // --- NEW: ID to Hex Map ---
  const idToHexMap = useMemo(
    () => createIdToHexMap(paletteColors),
    [paletteColors]
  )

  // --- NEW: Hex to ID Map ---
  const hexToIdMap = useMemo(
    () => createHexToIdMap(paletteColors), // Use the new helper
    [paletteColors]
  )

  // --- NEW: ID to Name Map ---
  const idToNameMap = useMemo(
    () => createIdToNameMap(paletteColors),
    [paletteColors]
  )

  // --- Update Handlers for Presentation Colors (to handle Keys) ---
  const handlePresentationKeyChange = useCallback(
    (keyName, selectedHex) => {
      onPresetChange({
        ...presetData,
        [keyName]: selectedHex || null, // Store the selected hex or null
      })
    },
    [presetData, onPresetChange]
  )

  // --- Render Logic ---

  const renderBackgroundColorConfig = () => {
    const activeType = presetData.background?.activeType || 'color'
    let singleColorSelectedKey = null // This should be an ID

    if (
      presetData.background?.activeType === 'color' &&
      presetData.background?.colorValue
    ) {
      singleColorSelectedKey =
        hexToIdMap.get(presetData.background.colorValue) || null
    } else if (
      presetData.background?.activeType === 'color' &&
      presetData.background?.colorKey
    ) {
      singleColorSelectedKey = presetData.background.colorKey
    }

    return (
      <Box mb={2}>
        <Box mb={1.5}>
          <Typography variant="body2" gutterBottom sx={{ mb: 2 }}>
            Define the slate background as either a single color or a gradient
            of color shades based on the base color.
          </Typography>
          <ToggleButtonGroup
            value={activeType}
            exclusive
            disabled={isSaving}
            onChange={(event, newType) => {
              if (isSaving || !newType || newType === activeType) return

              onPresetChange({
                ...presetData,
                background: {
                  ...(presetData.background || {}),
                  activeType: newType,
                  colorKey: presetData.background?.colorKey,
                  gradientConfig: presetData.background?.gradientConfig,
                },
              })
            }}
            size="small"
            color="primary"
            sx={{
              '& .MuiToggleButton-root.Mui-selected': {
                backgroundColor: '#B76C0D',
                color: '#ffffff',
                '&:hover': {
                  backgroundColor: '#A05F0B',
                },
              },
              '&.Mui-disabled': {
                opacity: 0.7,
              },
            }}
          >
            <ToggleButton value="color">Single Color</ToggleButton>
            <ToggleButton value="gradient">Gradient</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Grid container spacing={1.5}>
          {activeType === 'color' && (
            <Grid size={12}>
              <Paper elevation={1} sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
                  Single Color
                </Typography>
                <PaletteColorPicker
                  colors={paletteColors}
                  selectedKeys={
                    singleColorSelectedKey ? [singleColorSelectedKey] : []
                  }
                  onChange={(newKeys) => {
                    handleSingleColorSelect(newKeys[0] || null)
                  }}
                  dense
                  selectionMode="single"
                  disabled={isSaving}
                />
              </Paper>
            </Grid>
          )}

          {activeType === 'gradient' && (
            <Grid size={12}>
              <Paper elevation={1} sx={{ p: 1.5 }}>
                <GradientConfigurator
                  colors={paletteColors}
                  value={presetData.background?.gradientConfig || {}}
                  onChange={handleGradientConfigChange}
                  disabled={isSaving}
                />
              </Paper>
            </Grid>
          )}
        </Grid>
      </Box>
    )
  }

  // --- MODIFIED renderArrayColorConfig --- START ---
  const renderArrayColorConfig = (
    title,
    stylesKey, // e.g., 'categoryStyles'
    fontStateKey, // e.g., 'categoryFont'
    fontChangeHandler,
    fontSizeStateKey, // e.g., 'categoryFontSize'
    fontSizeChangeHandler,
    selectedBgKey, // e.g., selectedCategoryBgKey
    setSelectedBgKey, // e.g., setSelectedCategoryBgKey
    selectedFgKey, // e.g., selectedCategoryFgKey
    setSelectedFgKey // e.g., setSelectedCategoryFgKey
  ) => {
    const currentStyles = Array.isArray(presetData[stylesKey])
      ? presetData[stylesKey]
      : []
    const currentFont = presetData[fontStateKey] || ''
    const currentFontSize = presetData[fontSizeStateKey] || ''

    // --- NEW: Handler to Add Style Pair --- START ---
    const handleAddStylePair = () => {
      if (!selectedBgKey || !selectedFgKey) return // Should be disabled, but double-check

      const newStylePair = {
        backgroundColorKey: selectedBgKey,
        foregroundColorKey: selectedFgKey,
      }

      const updatedStyles = [...currentStyles, newStylePair]

      onPresetChange({
        ...presetData,
        [stylesKey]: updatedStyles,
      })

      // Reset selection
      setSelectedBgKey(null)
      setSelectedFgKey(null)
    }
    // --- NEW: Handler to Add Style Pair --- END ---

    // --- NEW: Handler to Remove Style Pair --- START ---
    const handleRemoveStylePair = (indexToRemove) => {
      const updatedStyles = currentStyles.filter(
        (_, index) => index !== indexToRemove
      )

      onPresetChange({
        ...presetData,
        [stylesKey]: updatedStyles,
      })
    }

    const isDuplicate = useMemo(() => {
      if (!selectedBgKey || !selectedFgKey) return false
      return currentStyles.some(
        (style) =>
          style.backgroundColorKey === selectedBgKey &&
          style.foregroundColorKey === selectedFgKey
      )
    }, [currentStyles, selectedBgKey, selectedFgKey])

    const typeName = stylesKey.includes('category') ? 'Category' : 'Note' // Infer type

    return (
      <Box mb={1}>
        <Grid container spacing={2}>
          <Grid size={6}>
            <Grid container spacing={1.5}>
              <Grid size={12}>
                <Typography variant="subtitle2" gutterBottom sx={{ mb: 0.5 }}>
                  Background
                </Typography>
                <Paper variant="outlined" sx={{ p: 1 }}>
                  <PaletteColorPicker
                    colors={paletteColors}
                    selectedKeys={selectedBgKey ? [selectedBgKey] : []}
                    onChange={(newKeys) => setSelectedBgKey(newKeys[0] || null)}
                    selectionMode="single"
                    dense
                  />
                </Paper>
              </Grid>
              <Grid size={12}>
                <Typography variant="subtitle2" gutterBottom sx={{ mb: 0.5 }}>
                  Foreground
                </Typography>
                <Paper variant="outlined" sx={{ p: 1 }}>
                  <PaletteColorPicker
                    colors={paletteColors}
                    selectedKeys={selectedFgKey ? [selectedFgKey] : []}
                    onChange={(newKeys) => setSelectedFgKey(newKeys[0] || null)}
                    selectionMode="single"
                    dense
                  />
                </Paper>
              </Grid>
              <Grid size={12} sx={{ mt: 1 }}>
                {isDuplicate && (
                  <Alert severity="error" variant="outlined" sx={{ mb: 1 }}>
                    This color pair already exists.
                  </Alert>
                )}
                <Button
                  variant="contained"
                  startIcon={<AddCircleOutlineIcon />}
                  onClick={handleAddStylePair}
                  disabled={
                    !selectedBgKey || !selectedFgKey || isDuplicate || isSaving
                  }
                  size="small"
                >
                  Add {typeName} Style Pair
                </Button>
              </Grid>
            </Grid>
          </Grid>
          <Grid size={6}>
            <Grid container spacing={1.5}>
              <Grid size={6}>
                {fontStyles && fontStyles.length > 0 ? (
                  <ToggleButtonGroup
                    value={currentFont}
                    exclusive
                    onChange={(event, newFontValue) => {
                      fontChangeHandler(newFontValue || null)
                    }}
                    aria-label={`${stylesKey}-font-selection`}
                    disabled={isSaving}
                    size="small"
                    sx={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 0.5,
                    }}
                  >
                    {fontStyles.map((font) => (
                      <ToggleButton
                        key={font.name}
                        value={font.value || font.name}
                        aria-label={font.name}
                        sx={{
                          fontFamily: font.value || font.name,
                          textTransform: 'none',
                          border: '1px solid rgba(0, 0, 0, 0.12)',
                          lineHeight: 1.2,
                          p: '2px 8px',
                          marginLeft: '0 !important',
                          '&.MuiToggleButtonGroup-grouped:not(:first-of-type)':
                            {
                              borderLeft: '1px solid rgba(0, 0, 0, 0.12)',
                              marginLeft: 0,
                            },
                          '&.Mui-selected': {
                            color: '#ffffff',
                            backgroundColor: '#B76C0D',
                            '&:hover': {
                              backgroundColor: '#A05F0B',
                            },
                          },
                        }}
                      >
                        {font.name}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                ) : (
                  <Typography variant="caption" color="textSecondary">
                    No font styles defined in Organization Settings.
                  </Typography>
                )}
              </Grid>
              <Grid size={6}>
                <FormControl fullWidth size="small">
                  <InputLabel id={`${stylesKey}-fontsize-select-label`}>
                    Font Size
                  </InputLabel>
                  <Select
                    labelId={`${stylesKey}-fontsize-select-label`}
                    id={`${stylesKey}-fontsize-select`}
                    value={currentFontSize}
                    label="Font Size"
                    onChange={(e) =>
                      fontSizeChangeHandler(Number(e.target.value) || null)
                    }
                    MenuProps={{ PaperProps: { sx: { maxHeight: 300 } } }}
                  >
                    <MenuItem value="">
                      <em>Default</em>
                    </MenuItem>
                    {FONT_SIZES.map((size) => (
                      <MenuItem key={size} value={size}>
                        {`${size}pt`}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={12} sx={{ mt: 2 }}>
                <Box
                  sx={{
                    border: '1px solid rgba(255, 255, 255, 0.23)',
                    borderRadius: 1,
                    p: 1.5,
                  }}
                >
                  <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
                    Defined Style Pairs ({currentStyles.length})
                  </Typography>
                  {currentStyles.length > 0 ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {currentStyles.map((style, index) => {
                        const bgColor =
                          idToHexMap.get(style.backgroundColorKey) || '#ccc'
                        const fgColor =
                          idToHexMap.get(style.foregroundColorKey) || '#000'
                        const isCategory = typeName === 'Category'

                        // --- Get color names for tooltip ---
                        const bgName =
                          idToNameMap.get(style.backgroundColorKey) ||
                          '(Unknown)'
                        const fgName =
                          idToNameMap.get(style.foregroundColorKey) ||
                          '(Unknown)'
                        const tooltipTitle = `BG: ${bgName}, FG: ${fgName}`
                        // --- End get color names ---

                        return (
                          <Tooltip title={tooltipTitle} key={index} arrow>
                            <Box sx={{ position: 'relative' }}>
                              <Paper
                                variant="outlined"
                                sx={{
                                  width: 65,
                                  height: 40,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  backgroundColor: bgColor,
                                  color: fgColor,
                                  fontSize: '1rem',
                                  fontWeight: 'medium',
                                  fontFamily: isCategory
                                    ? presetData?.categoryFont
                                    : presetData?.noteFont,
                                  overflow: 'hidden',
                                  cursor: 'default',
                                }}
                              >
                                <Typography
                                  variant="body2"
                                  sx={{ color: fgColor }}
                                >
                                  {isCategory
                                    ? presetData?.categoryFont
                                    : presetData?.noteFont}
                                </Typography>
                              </Paper>
                              <IconButton
                                size="small"
                                onClick={() => handleRemoveStylePair(index)}
                                sx={{
                                  position: 'absolute',
                                  top: -8,
                                  right: -8,
                                  backgroundColor: 'background.paper',
                                  border: '1px solid rgba(0, 0, 0, 0.1)',
                                  '&:hover': { backgroundColor: 'grey.200' },
                                  p: 0.1,
                                }}
                                aria-label={`Remove ${typeName} style pair ${
                                  index + 1
                                }`}
                                disabled={isSaving}
                              >
                                <RemoveCircleOutlineIcon
                                  sx={{ fontSize: 16 }}
                                />
                              </IconButton>
                            </Box>
                          </Tooltip>
                        )
                      })}
                    </Box>
                  ) : (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 1 }}
                    >
                      No {typeName.toLowerCase()} style pairs defined yet.
                      Select background and foreground colors, then click
                      &quot;Add&quot;.
                    </Typography>
                  )}
                </Box>
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </Box>
    )
  }

  // --- Update Render function for Presentation Tab ---
  const renderPresentationConfig = () => {
    // Get the *hex values* currently stored in presetData
    const currentBgHex = presetData?.presentationMenuBgColorKey || null
    const currentControlsHex = presetData?.presentationControlsColorKey || null

    // Find the corresponding color *IDs* using the hexToIdMap
    const bgKeyId = currentBgHex ? hexToIdMap.get(currentBgHex) : null
    const controlsKeyId = currentControlsHex
      ? hexToIdMap.get(currentControlsHex)
      : null

    return (
      <Paper elevation={1} sx={{ p: 1.5, mb: 1.5 }}>
        <Typography variant="subtitle1" gutterBottom>
          Presentation Mode Appearance
        </Typography>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            mb: 2,
            fontStyle: 'italic',
            opacity: 0.8,
          }}
        >
          Select predefined palette colors for the menu bar shown in
          Presentation Mode.
        </Typography>

        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
            Menu Background Color
          </Typography>
          <PaletteColorPicker
            colors={paletteColors}
            selectedKeys={bgKeyId ? [bgKeyId] : []} // Pass the found ID
            onChange={(newKeys) => {
              // onChange provides the ID, use idToHexMap to get the hex value for saving
              const selectedHex = newKeys[0] ? idToHexMap.get(newKeys[0]) : null
              handlePresentationKeyChange(
                'presentationMenuBgColorKey',
                selectedHex // Pass the hex value to save
              )
            }}
            dense
            selectionMode="single"
            disabled={isSaving}
          />
        </Box>

        <Box>
          <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
            Controls Color (Text & Icons)
          </Typography>
          <PaletteColorPicker
            colors={paletteColors}
            selectedKeys={controlsKeyId ? [controlsKeyId] : []} // Pass the found ID
            onChange={(newKeys) => {
              // onChange provides the ID, use idToHexMap to get the hex value for saving
              const selectedHex = newKeys[0] ? idToHexMap.get(newKeys[0]) : null
              handlePresentationKeyChange(
                'presentationControlsColorKey',
                selectedHex // Pass the hex value to save
              )
            }}
            dense
            selectionMode="single"
            disabled={isSaving}
          />
        </Box>
      </Paper>
    )
  }

  if (!paletteColors || paletteColors.length === 0) {
    return (
      <Alert severity="info">
        Please define some colors in the &apos;Color Palette&apos; tab first to
        create presets.
      </Alert>
    )
  }

  return (
    <Box
      sx={{
        opacity: isSaving ? 0.7 : 1,
        pointerEvents: isSaving ? 'none' : 'auto',
        transition: 'opacity 0.2s',
      }}
    >
      {/* Tab Navigation */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 0 }}>
        <Tabs
          value={activePresetTab}
          onChange={handleTabChange}
          aria-label="Preset Color Sections"
          variant="fullWidth"
          sx={{
            '& .MuiTabs-indicator': {
              height: '3px',
            },
            '& .MuiTab-root.Mui-selected': {
              fontWeight: 'bold',
            },
          }}
        >
          <Tab
            label="Background"
            id="preset-tab-0"
            aria-controls="preset-tabpanel-0"
          />
          <Tab
            label="Categories"
            id="preset-tab-1"
            aria-controls="preset-tabpanel-1"
          />
          <Tab
            label="Notes"
            id="preset-tab-2"
            aria-controls="preset-tabpanel-2"
          />
          <Tab
            label="Presentation"
            id="preset-tab-3"
            aria-controls="preset-tabpanel-3"
          />
        </Tabs>
      </Box>

      {/* Tab Content Panels - Pass required props */}
      <TabPanel
        value={activePresetTab}
        index={0}
        id="preset-tabpanel-0"
        labelledby="preset-tab-0"
      >
        {renderBackgroundColorConfig()}
      </TabPanel>
      <TabPanel
        value={activePresetTab}
        index={1}
        id="preset-tabpanel-1"
        labelledby="preset-tab-1"
      >
        {renderArrayColorConfig(
          'Category Styles',
          'categoryStyles',
          'categoryFont',
          handleCategoryFontChange,
          'categoryFontSize',
          handleCategoryFontSizeChange,
          selectedCategoryBgKey,
          setSelectedCategoryBgKey,
          selectedCategoryFgKey,
          setSelectedCategoryFgKey
        )}
      </TabPanel>
      <TabPanel
        value={activePresetTab}
        index={2}
        id="preset-tabpanel-2"
        labelledby="preset-tab-2"
      >
        {renderArrayColorConfig(
          'Note Styles',
          'noteStyles',
          'noteFont',
          handleNoteFontChange,
          'noteFontSize',
          handleNoteFontSizeChange,
          selectedNoteBgKey,
          setSelectedNoteBgKey,
          selectedNoteFgKey,
          setSelectedNoteFgKey
        )}
      </TabPanel>
      <TabPanel
        value={activePresetTab}
        index={3}
        id="preset-tabpanel-3"
        labelledby="preset-tab-3"
      >
        {renderPresentationConfig()}
      </TabPanel>
    </Box>
  )
}

ColorPresetEditor.propTypes = {
  presetData: PropTypes.shape({
    _id: PropTypes.string,
    name: PropTypes.string,
    description: PropTypes.string,
    background: PropTypes.shape({
      activeType: PropTypes.oneOf(['color', 'gradient']),
      colorKey: PropTypes.string,
      colorValue: PropTypes.string,
      gradientConfig: PropTypes.shape({
        // More specific, even if empty for now
        // Define expected keys if known, e.g.:
        // baseColorKey: PropTypes.string,
        // baseColorValue: PropTypes.string,
        // gradientColorCount: PropTypes.number,
        // gradientType: PropTypes.string,
        // gradientStrategy: PropTypes.string,
        // gradientColors: PropTypes.arrayOf(PropTypes.string),
      }),
    }),
    categoryStyles: PropTypes.arrayOf(
      PropTypes.shape({
        backgroundColorKey: PropTypes.string,
        foregroundColorKey: PropTypes.string,
      })
    ),
    noteStyles: PropTypes.arrayOf(
      PropTypes.shape({
        backgroundColorKey: PropTypes.string,
        foregroundColorKey: PropTypes.string,
      })
    ),
    categoryFont: PropTypes.string,
    categoryFontSize: PropTypes.number,
    noteFont: PropTypes.string,
    noteFontSize: PropTypes.number,
    aiDirectiveId: PropTypes.string,
    presentationMenuBgColorKey: PropTypes.string,
    presentationControlsColorKey: PropTypes.string,
    presentationTitleColorKey: PropTypes.string,
    presentationTextColorKey: PropTypes.string,
    presentationBgColorKey: PropTypes.string,
  }).isRequired,
  onPresetChange: PropTypes.func.isRequired,
  paletteColors: PropTypes.arrayOf(
    PropTypes.shape({
      _id: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
    })
  ).isRequired,
  fontStyles: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      value: PropTypes.string,
    })
  ),
  isSaving: PropTypes.bool,
  onPresentationTabSelect: PropTypes.func,
}
