/* eslint-disable new-cap */
/* eslint-disable no-underscore-dangle */
import React, { useEffect, useRef, useState, useMemo } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore'
import NavigateNextIcon from '@mui/icons-material/NavigateNext'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import { Slatebox } from 'slateboxjs'

// --- Constants for Preview Layout ---
const CATEGORY_Y = 5500
const NOTE_Y = 5620
const BASE_X = 5500
const CATEGORY_WIDTH = 150
const CATEGORY_HEIGHT = 50
const NOTE_WIDTH = 130
const NOTE_HEIGHT = 80
const NODE_SPACING = 50 // Horizontal space between example nodes
const MAX_EXAMPLES = 5 // Max number of category/note examples to show

// --- Default Font Sizes (if not in preset) ---
const DEFAULT_CATEGORY_FONT_SIZE = 14
const DEFAULT_NOTE_FONT_SIZE = 14

// --- Default Styles --- START ---
const DEFAULT_GRADIENT_CONFIG = {
  // baseColorKey: null, // Key not needed for default white
  baseColorValue: '#ffffff', // Default white
  gradientColorCount: 10,
  gradientType: 'radial',
  gradientStrategy: 'shades',
}

const DEFAULT_BACKGROUND_STYLE = {
  activeType: 'gradient',
  gradientConfig: DEFAULT_GRADIENT_CONFIG,
}

// --- Helper function to create ID-to-Hex map --- START --- (Ensure it's defined)
const createIdToHexMap = (paletteColors) => {
  const map = new Map()
  if (paletteColors) {
    paletteColors.forEach((p) => map.set(p._id, p.value))
  }
  return map
}
// --- Helper function to create ID-to-Hex map --- END ---

// Simple read-only preview slate
export default function BrandPreviewSlate({
  previewId,
  presetData = {
    background: { activeType: 'color' },
    categoryFont: null,
    categoryFontSize: null,
    noteFont: null,
    noteFontSize: null,
    categoryStyles: [],
    noteStyles: [],
    presentationMenuBgColorKey: null,
    presentationControlsColorKey: null,
  },
  paletteColors = [],
  fontStyles = [],
  presentationModeEnabled = false,
  squareLogoUrl = null,
}) {
  const slateRef = useRef(null)
  const containerId = `brand-preview-${previewId}`
  const [slateInstanceReady, setSlateInstanceReady] = useState(false)

  const idToHexMap = useMemo(
    () => createIdToHexMap(paletteColors),
    [paletteColors]
  )

  // Find color VALUES from palette using KEYS from presetData
  const menuBgColor = useMemo(
    () => presetData?.presentationMenuBgColorKey || 'rgba(0, 0, 0, 0.8)', // Default
    [presetData?.presentationMenuBgColorKey] // Depend only on the key value
  )

  const controlsColor = useMemo(
    () => presetData?.presentationControlsColorKey || '#FFFFFF', // Default
    [presetData?.presentationControlsColorKey] // Depend only on the key value
  )

  // --- Effect 1: Initial Slatebox setup (NO NODES ADDED HERE) ---
  useEffect(() => {
    let slateInstance = null
    let isMounted = true

    async function createPreviewCanvas() {
      let initialContainerStyle = {
        /* Basic defaults */
        backgroundColor: '#f8f9fa', // Fallback color
        backgroundImage: '',
        backgroundSize: '',
        backgroundEffect: '',
        backgroundColorAsGradient: false,
        backgroundGradientType: 'linear',
        backgroundGradientColors: [],
        backgroundGradientStrategy: 'shades',
      }

      // --- Determine Effective Background Config (Preset or Default) --- START ---
      const effectiveBgConfig = {
        ...DEFAULT_BACKGROUND_STYLE, // Start with defaults
        ...(presetData?.background || {}), // Merge preset background if exists
        gradientConfig: {
          // Ensure gradientConfig exists and merge
          ...DEFAULT_GRADIENT_CONFIG,
          ...(presetData?.background?.gradientConfig || {}),
        },
      }
      // --- Determine Effective Background Config --- END ---

      // --- Calculate Initial Style based on Effective Config --- START ---
      if (
        effectiveBgConfig.activeType === 'color' &&
        effectiveBgConfig.colorKey &&
        paletteColors?.length > 0
      ) {
        const c = paletteColors.find(
          (pc) => pc._id === effectiveBgConfig.colorKey
        )
        if (c) {
          initialContainerStyle.backgroundColor = c.value
          initialContainerStyle.backgroundColorAsGradient = false // Explicitly false for single color
        }
      } else if (effectiveBgConfig.activeType === 'gradient') {
        const gradConf = effectiveBgConfig.gradientConfig
        let baseHex = gradConf.baseColorValue || '#ffffff'

        // Lookup baseHex if key exists
        if (gradConf.baseColorKey && paletteColors?.length > 0) {
          const baseColor = paletteColors.find(
            (pc) => pc._id === gradConf.baseColorKey
          )
          if (baseColor) baseHex = baseColor.value
        }

        // --- Use PRE-CALCULATED colors if available --- START ---
        if (
          Array.isArray(gradConf.gradientColors) &&
          gradConf.gradientColors.length > 0
        ) {
          initialContainerStyle = {
            ...initialContainerStyle,
            backgroundColor: baseHex,
            backgroundColorAsGradient: true,
            backgroundGradientType: gradConf.gradientType,
            backgroundGradientColors: gradConf.gradientColors,
            backgroundGradientStrategy: gradConf.gradientStrategy,
          }
        } else {
          console.warn(
            'Initial BG: Gradient selected but pre-calculated gradientColors missing. Using solid base color.'
          )
          initialContainerStyle.backgroundColor = baseHex // Fallback to solid base color
          initialContainerStyle.backgroundColorAsGradient = false
        }
        // --- Use PRE-CALCULATED colors if available --- END ---
      }
      // --- Calculate Initial Style --- END ---

      try {
        slateInstance = await new Slatebox.slate(
          {
            container: containerId,
            containerStyle: initialContainerStyle,
            viewPort: {
              useInertiaScrolling: true,
              showGrid: false,
              snapToObjects: false,
            },
            name: 'Brand Preview',
            allowDrag: true,
            showbirdsEye: false,
            showLocks: false,
            showMultiSelect: false,
            showUndoRedo: false,
            showZoom: false,
            showAddNodes: false,
            autoResizeNodesBasedOnText: true,
            allowCollaboration: false,
          },
          {
            onInitCollaboration: async () => null,
            onCanvasClicked: () => {},
          }
        ).init()

        if (isMounted) {
          slateRef.current = slateInstance
          setSlateInstanceReady(true)
        }
      } catch (error) {
        console.error('Error initializing Slatebox preview canvas:', error)
        if (isMounted) setSlateInstanceReady(false)
      }
    }

    createPreviewCanvas()

    // Cleanup: Destroy canvas on unmount
    return () => {
      isMounted = false
      setSlateInstanceReady(false)
      if (slateInstance && typeof slateInstance.destroy === 'function') {
        try {
          slateInstance.destroy()
        } catch (error) {
          console.error('Error destroying slate canvas:', error)
        }
      }
      slateRef.current = null
      const container = document.getElementById(containerId)
      if (container) container.innerHTML = ''
    }
  }, [containerId]) // Re-run only if containerId changes (unlikely)

  // --- Effect 2: Update background style via invoke (Remains the same) ---
  useEffect(() => {
    async function updateBackground() {
      if (!slateRef.current) return

      // Determine effective config (Preset or Default) - Reuse logic
      const effectiveBgConfig = {
        ...DEFAULT_BACKGROUND_STYLE,
        ...(presetData?.background || {}),
        gradientConfig: {
          ...DEFAULT_GRADIENT_CONFIG,
          ...(presetData?.background?.gradientConfig || {}),
        },
      }

      const payload = {
        type: 'onSlateBackgroundColorChanged',
        data: {
          color: '#f8f9fa',
          asGradient: false,
          gradientType: 'linear',
          gradientColors: [],
          gradientStrategy: 'shades',
        },
      }

      // Calculate payload data based on effective config
      if (
        effectiveBgConfig.activeType === 'color' &&
        effectiveBgConfig.colorKey &&
        paletteColors?.length > 0
      ) {
        const c = paletteColors.find(
          (pc) => pc._id === effectiveBgConfig.colorKey
        )
        if (c) {
          payload.data.color = c.value
        } else {
          console.warn('Update BG: Preset colorKey not found, using fallback.')
        }
      } else if (effectiveBgConfig.activeType === 'gradient') {
        const gradConf = effectiveBgConfig.gradientConfig
        // Revert to let, ignore linter for now
        let baseHex = gradConf.baseColorValue || '#ffffff'

        // Lookup baseHex if key exists
        if (gradConf.baseColorKey && paletteColors?.length > 0) {
          const baseColor = paletteColors.find(
            (pc) => pc._id === gradConf.baseColorKey
          )
          if (baseColor) baseHex = baseColor.value
        }

        // --- Use PRE-CALCULATED colors if available --- START ---
        if (
          Array.isArray(gradConf.gradientColors) &&
          gradConf.gradientColors.length > 0
        ) {
          payload.data = {
            ...payload.data,
            color: baseHex,
            asGradient: true,
            gradientType: gradConf.gradientType,
            gradientColors: gradConf.gradientColors,
            gradientStrategy: gradConf.gradientStrategy,
          }
        } else {
          console.warn(
            'Update BG: Gradient selected but pre-calculated gradientColors missing. Using solid base color.'
          )
          payload.data = {
            ...payload.data,
            color: baseHex,
            asGradient: false,
          }
        }
        // --- Use PRE-CALCULATED colors if available --- END ---
      }

      if (slateRef.current) {
        try {
          slateRef.current.collab.invoke(payload)
        } catch (error) {
          console.error('Error invoking bg change:', error)
        }
      }
    }

    updateBackground()
  }, [slateInstanceReady, presetData?.background, paletteColors])

  // --- NEW Effect 3: Manage Example Nodes Surgically --- START ---
  useEffect(() => {
    if (!slateInstanceReady || !slateRef.current) {
      return // Slate not initialized yet
    }
    const slate = slateRef.current
    let payloads = [] // Initialize payloads array

    // --- Helper to generate node options (remains the same) --- START ---
    const getNodeOptions = (type, styleIndex, currentPresetData) => {
      const isCategory = type === 'category'
      const styles = isCategory
        ? currentPresetData?.categoryStyles
        : currentPresetData?.noteStyles
      const currentStyle = styles?.[styleIndex]
      if (!currentStyle) return null // Should not happen if called correctly

      const fontSize =
        (isCategory
          ? currentPresetData?.categoryFontSize
          : currentPresetData?.noteFontSize) ||
        (isCategory ? DEFAULT_CATEGORY_FONT_SIZE : DEFAULT_NOTE_FONT_SIZE)

      // --- FONT LOOKUP --- START ---
      const fontShorthandName =
        (isCategory
          ? currentPresetData?.categoryFont
          : currentPresetData?.noteFont) || 'Roboto'
      const fontObj = fontStyles.find((f) => f.name === fontShorthandName)
      const fontFamilyValue = fontObj ? fontObj.value : fontShorthandName
      // --- FONT LOOKUP --- END ---

      const bgColor =
        idToHexMap.get(currentStyle.backgroundColorKey) ||
        (isCategory ? '#cccccc' : '#eeeeee')
      const fgColor =
        idToHexMap.get(currentStyle.foregroundColorKey) || '#000000'
      const nodeWidth = isCategory ? CATEGORY_WIDTH : NOTE_WIDTH
      const nodeHeight = isCategory ? CATEGORY_HEIGHT : NOTE_HEIGHT

      const commonOpts = {
        id: `${isCategory ? 'cat' : 'note'}-preview-${styleIndex}`,
        text: `${isCategory ? 'Category' : 'Note'} ${styleIndex + 1}`,
        xPos: BASE_X + styleIndex * (nodeWidth + NODE_SPACING),
        yPos: isCategory ? CATEGORY_Y : NOTE_Y,
        width: nodeWidth,
        height: nodeHeight,
        backgroundColor: bgColor,
        foregroundColor: fgColor, // Used for text, border, etc.
        fontSize,
        borderOpacity: 0,
        vectorPath: 'rectangle',
        fontFamily: fontFamilyValue,
        showMenu: false,
      }

      if (isCategory) {
        return {
          ...commonOpts,
          type: 'box',
          borderWidth: 1,
          borderColor: Slatebox.utils.whiteOrBlack(bgColor),
        }
      }
      return {
        ...commonOpts,
        type: 'sticky_note',
      }
    }
    // --- Helper to generate node options (used for additions/updates) --- END ---

    // --- Step 1: Get existing preview node IDs --- START ---
    const existingPreviewNodeIds = slate.nodes.allNodes
      .filter(
        (n) =>
          n.options.id.startsWith('cat-preview-') ||
          n.options.id.startsWith('note-preview-')
      )
      .map((n) => n.options.id)
    // --- Step 1: Get existing preview node IDs --- END ---

    // --- Step 2: Create deletion payloads --- START ---
    const deletionPayloads = existingPreviewNodeIds.map((id) => ({
      type: 'onNodeDeleted',
      data: { id },
    }))
    if (deletionPayloads.length > 0) {
      console.log('[Effect 3] Adding deletion payloads:', deletionPayloads)
    }
    // --- Step 2: Create deletion payloads --- END ---

    // --- Step 3: Create addition payloads based on CURRENT presetData --- START ---
    const additionPayloads = []
    const currentCategoryStyles = presetData?.categoryStyles || []
    currentCategoryStyles.slice(0, MAX_EXAMPLES).forEach((style, i) => {
      const nodeOpts = getNodeOptions('category', i, presetData)
      if (nodeOpts) {
        additionPayloads.push({
          type: 'onNodeAdded',
          data: { nodeOptions: nodeOpts },
        })
      }
    })

    const currentNoteStyles = presetData?.noteStyles || []
    currentNoteStyles.slice(0, MAX_EXAMPLES).forEach((style, i) => {
      const nodeOpts = getNodeOptions('note', i, presetData)
      if (nodeOpts) {
        additionPayloads.push({
          type: 'onNodeAdded',
          data: { nodeOptions: nodeOpts },
        })
      }
    })
    if (additionPayloads.length > 0) {
      console.log('[Effect 3] Adding addition payloads:', additionPayloads)
    }
    // --- Step 3: Create addition payloads based on CURRENT presetData --- END ---

    // --- Step 4: Combine payloads --- START ---
    payloads = [...deletionPayloads, ...additionPayloads]
    // --- Step 4: Combine payloads --- END ---

    if (payloads.length > 0) {
      console.log('[Effect 3] Invoking combined delete/add changes:', payloads)
      try {
        slate.collab.invoke(payloads)
        // Keep centering logic, maybe delay slightly more to ensure nodes are rendered after delete/add
        if (
          slateRef.current?.nodes.allNodes.length > 0 ||
          additionPayloads.length > 0
        ) {
          // Check if nodes exist OR if we just added some
          setTimeout(() => {
            if (slateRef.current?.removeLayoutOverlaps) {
              // Check function exists
              slateRef.current.removeLayoutOverlaps(60)
            }
            setTimeout(() => {
              if (slateRef.current?.controller?.scaleToFitAndCenter) {
                // Check function exists
                console.log(
                  '[Effect 3] Scaling to fit and center after updates...'
                )
                slateRef.current.controller.scaleToFitAndCenter()
              }
            }, 350) // Slightly increased delay
          }, 200) // Slightly increased delay
        }
      } catch (error) {
        console.error(
          '[Effect 3] Error invoking preview node changes:',
          error,
          payloads
        )
      }
    } else {
      console.log('[Effect 3] No preview nodes to delete or add.')
    }
  }, [slateInstanceReady, presetData, idToHexMap, fontStyles]) // Dependencies remain the same
  // --- NEW Effect 3: Manage Example Nodes Surgically --- END ---

  // --- Effect 4: Update Presentation Mode UI ONLY ---
  useEffect(() => {
    if (!slateInstanceReady || !slateRef.current || !paletteColors) {
      // Removed console log and unnecessary return
    }
  }, [slateInstanceReady, slateRef.current, paletteColors])

  // --- JSX Rendering ---
  return (
    <Box
      sx={{
        width: '100%',
        height: '450px',
        border: '1px solid #ccc',
        borderRadius: '4px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {presentationModeEnabled && squareLogoUrl && (
        <Box
          component="img"
          src={squareLogoUrl}
          alt="Square Logo"
          sx={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            height: '60px',
            width: '60px',
            objectFit: 'contain',
            zIndex: 20,
            backgroundColor: 'rgba(255, 255, 255, 0.7)',
            borderRadius: '3px',
          }}
        />
      )}

      <Box
        id={containerId}
        sx={{
          width: '100%',
          height: '100%',
        }}
      />

      {presentationModeEnabled && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              width: '60%',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: menuBgColor,
              color: controlsColor,
              borderTopLeftRadius: '10px',
              borderTopRightRadius: '10px',
              padding: '8px 15px',
              boxShadow: '0px -2px 5px rgba(0,0,0,0.1)',
            }}
          >
            <Typography
              variant="body1"
              sx={{ color: 'inherit', flexShrink: 0, mr: 2 }}
            >
              My Presentation
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box
                sx={{
                  backgroundColor: controlsColor,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 48,
                  height: 48,
                }}
              >
                <IconButton
                  size="small"
                  sx={{
                    color: menuBgColor,
                    padding: 0,
                  }}
                >
                  <PlayArrowIcon fontSize="small" />
                </IconButton>
              </Box>
              <IconButton size="small" sx={{ color: 'inherit' }}>
                <NavigateBeforeIcon />
              </IconButton>
              <IconButton size="small" sx={{ color: 'inherit' }}>
                <NavigateNextIcon />
              </IconButton>
            </Box>

            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
                ml: 2,
              }}
            >
              <Box
                sx={{
                  backgroundColor: controlsColor,
                  color: menuBgColor,
                  borderRadius: '50%',
                  width: 48,
                  height: 48,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                }}
              >
                0/15
              </Box>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}

BrandPreviewSlate.propTypes = {
  previewId: PropTypes.string.isRequired,
  presetData: PropTypes.shape({
    background: PropTypes.shape({
      activeType: PropTypes.oneOf(['color', 'gradient']),
      colorKey: PropTypes.string,
      gradientConfig: PropTypes.shape({
        baseColorKey: PropTypes.string,
        gradientColorCount: PropTypes.number,
        gradientType: PropTypes.string,
        gradientStrategy: PropTypes.string,
      }),
    }),
    categoryFont: PropTypes.string,
    categoryFontSize: PropTypes.number,
    noteFont: PropTypes.string,
    noteFontSize: PropTypes.number,
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
    presentationMenuBgColorKey: PropTypes.string,
    presentationControlsColorKey: PropTypes.string,
  }),
  paletteColors: PropTypes.arrayOf(
    PropTypes.shape({
      _id: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
    })
  ),
  fontStyles: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
    })
  ),
  presentationModeEnabled: PropTypes.bool,
  squareLogoUrl: PropTypes.string,
}
