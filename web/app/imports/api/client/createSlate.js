/* eslint-disable new-cap */
import { Meteor } from 'meteor/meteor'
import { Slatebox } from 'slateboxjs'
import saveSlateLite from './saveSlate'
import { Organizations, OrganizationSettings } from '../common/models'
import CONSTANTS from '../common/constants'
import { createAINodes } from '../common/ai'
import defaultShapes from '../../ui/components/node/defaultShapes'

async function createSlate(
  slateBase,
  events,
  isNew,
  isGuest,
  createWithTheme,
  currentAIContext
) {
  let publicDefault = false
  let newSlate = slateBase
  async function ensureDeps() {
    return new Promise(async (resolve) => {
      if (
        (Meteor.user() &&
          Meteor.user().orgId &&
          (await Organizations.findOneAsync())) ||
        (Meteor.user() && !Meteor.user().orgId) ||
        isGuest
      ) {
        resolve(true)
      } else {
        setTimeout(async () => {
          resolve(await ensureDeps())
        }, 500)
      }
    })
  }

  await ensureDeps()

  let defaultPreset = null

  if (Meteor.user() && Meteor.user().orgId) {
    // Fetch the default preset setting via specific query method
    try {
      // Fetch settings matching type and intentionId 'default'
      const matchingSettings = await Meteor.callAsync(
        CONSTANTS.methods.organizationSettings.getByQuery,
        {
          type: 'preset',
          intentionId: 'default',
        }
      )

      // Get the first match (should be unique for default preset)
      defaultPreset = matchingSettings?.[0] || null
    } catch (error) {
      console.error('Error fetching default organization preset:', error)
      defaultPreset = null // Ensure it's null on error
    }

    // New slates are private for everyone.
  }

  // Default background colors and style
  let bgColors = ['#ffffff', '#f0f0f0', '#e1e1e1', '#d2d2d2', '#c3c3c3']
  let containerStyle = {
    width: 'auto',
    height: 'auto',
    backgroundColor: bgColors[0],
    backgroundImage: null,
    backgroundSize: 'cover',
    backgroundEffect: null,
    prevBackgroundColor: 'transparent',
    backgroundColorAsGradient: false,
    backgroundGradientType: 'radial',
    backgroundGradientColors: bgColors,
    backgroundGradientStrategy: 'shades',
  }

  if (!createWithTheme) {
    // Apply default preset background if available
    if (defaultPreset?.value?.background) {
      const presetBg = defaultPreset.value.background
      containerStyle = {
        ...containerStyle,
        backgroundColor: presetBg.colorValue || containerStyle.backgroundColor,
        backgroundImage:
          presetBg.backgroundImage || containerStyle.backgroundImage,
        backgroundSize:
          presetBg.backgroundSize || containerStyle.backgroundSize,
        backgroundEffect:
          presetBg.backgroundEffect || containerStyle.backgroundEffect,
        backgroundColorAsGradient:
          presetBg.backgroundColorAsGradient != null
            ? presetBg.backgroundColorAsGradient
            : containerStyle.backgroundColorAsGradient,
        backgroundGradientType:
          presetBg.gradientConfig?.gradientType ||
          containerStyle.backgroundGradientType,
        // backgroundGradientColors: // Handled below
        //   presetBg.gradientConfig?.gradientColors ||
        //   containerStyle.backgroundGradientColors,
        backgroundGradientStrategy:
          presetBg.gradientConfig?.gradientStrategy ||
          containerStyle.backgroundGradientStrategy,
      }

      if (presetBg.activeType === 'gradient' && presetBg.gradientConfig) {
        // --- MODIFIED GRADIENT LOGIC --- START ---
        if (
          Array.isArray(presetBg.gradientConfig.gradientColors) &&
          presetBg.gradientConfig.gradientColors.length > 0
        ) {
          // Use pre-calculated colors
          bgColors = presetBg.gradientConfig.gradientColors
          containerStyle.backgroundColor =
            presetBg.gradientConfig.baseColorValue ||
            containerStyle.backgroundColor
          containerStyle.backgroundGradientColors = bgColors
          containerStyle.backgroundColorAsGradient = true // Ensure gradient is active
        } else {
          // Fallback to solid base color if pre-calculated colors are missing
          console.warn(
            'createSlate: Default preset uses gradient, but pre-calculated gradientColors are missing. Using solid base color.'
          )
          bgColors = [
            presetBg.gradientConfig.baseColorValue ||
              containerStyle.backgroundColor,
          ] // Use only base color
          containerStyle.backgroundColor = bgColors[0]
          containerStyle.backgroundColorAsGradient = false
          containerStyle.backgroundGradientColors = [] // Clear gradient colors
        }
        // --- MODIFIED GRADIENT LOGIC --- END ---
      } else if (presetBg.activeType === 'color' && presetBg.colorValue) {
        // Handle single color background
        bgColors = [presetBg.colorValue] // Use only the single color
        containerStyle.backgroundColor = presetBg.colorValue
        containerStyle.backgroundColorAsGradient = false
        containerStyle.backgroundGradientColors = []
      }
    } else if (currentAIContext?.aid) {
      // Fallback for AI context if no preset (kept original logic)
      bgColors = (
        await Meteor.callAsync(CONSTANTS.methods.themes.buildColorPalette, {
          type: 'shades',
        })
      ).slice(0, 5)
      containerStyle = {
        ...containerStyle,
        backgroundColor: bgColors[0],
        backgroundGradientColors: bgColors,
      }
    }
  }

  const opts = {
    id: newSlate.options?.id, // important so that the collab init works correctly
    name: newSlate.options?.name || currentAIContext?.prompt || 'New Slate',
    description: newSlate.options?.description || '',
    defaultLineColor: currentAIContext?.aid
      ? Slatebox.utils.whiteOrBlack(bgColors[0])
      : '#333',
    viewPort: {
      allowDrag: true,
      useInertiaScrolling: true,
      showGrid: false,
      snapToObjects: true,
    },
    // debugMode: true,
    showMultiSelect:
      newSlate.options?.showMultiSelect != null
        ? newSlate.options?.showMultiSelect
        : true,
    showUndoRedo:
      newSlate.options?.showUndoRedo != null
        ? newSlate.options?.showUndoRedo
        : true,
    showbirdsEye:
      newSlate.options?.showbirdsEye != null
        ? newSlate.options?.showbirdsEye
        : true,
    showZoom:
      newSlate.options?.showZoom != null ? newSlate.options?.showZoom : true,
    isSharing: true,
    imageFolder: '/images/',
    container: 'slateCanvas',
    // The app draws the bar over a selection itself (stylebar/StyleBar.jsx) from the engine's
    // onSelectionFrame; the engine draws no pill of its own.
    contextToolbar: 'host',
    isEmbedded: currentAIContext?.isEmbedded,
    enabled: true,
    containerStyle, // Use the calculated containerStyle
    allowCollaboration: true,
    huddleType: newSlate.options?.huddleType ?? 'audio',
    mindMapMode: createWithTheme?.mindMapMode || true,
    autoResizeNodesBasedOnText:
      createWithTheme?.autoResizeNodesBasedOnText || false,
  }
  if (isNew) {
    opts.isPublic = publicDefault
    opts.isPrivate = !publicDefault
    opts.isUnlisted = false
  }
  if (currentAIContext?.aid) {
    opts.layoutType = {
      val: 'dot',
      overlap: 'scalexy',
      rankdir: 'TB',
    }
    opts.createdViaAI = true
  }

  const slate = await new Slatebox.slate(opts, events).init()

  slate.shareId = newSlate.shareId

  if (isNew) {
    if (currentAIContext?.aid) {
      const nodesToCreate = [{ id: 'main_idea', depth: 0, multiplier: 1 }]
      await createAINodes(
        nodesToCreate,
        currentAIContext,
        0,
        slate,
        Slatebox.utils.whiteOrBlack(bgColors[0]), // Use calculated bgColor
        [defaultShapes.find((vx) => vx.key === 'star').path]
      )
    } else {
      // --- Keep original height logic ---
      const height = opts.autoResizeNodesBasedOnText
        ? createWithTheme.styles.parent.height
        : 100
      let nodeHeight = height
      // --- Removed original width logic ---
      // const width = opts.autoResizeNodesBasedOnText
      //   ? createWithTheme.styles.parent.width
      //   : 175
      // let nodeWidth = width

      // this is a new slate -- create a first node
      const gid = Slatebox.utils.guid(8)

      // Initialize node dimensions with defaults or theme-based sizes - Height only now
      // let nodeWidth = width // Removed
      // let nodeHeight = height // Kept

      // --- Start Default Node Style Logic ---
      let initialNodeStyle = {
        backgroundColor: '#699bc3',
        opacity: 1,
        borderOpacity: 0,
        fontFamily: createWithTheme?.styles?.parent?.fontFamily || 'Manrope',
        foregroundColor: 'rgba(255, 255, 255, 0.87)',
        lineColor: '#000',
        lineWidth: 5,
        vectorPath: 'roundedrectangle',
        fontSize: createWithTheme?.styles?.parent?.fontSize
          ? `${createWithTheme.styles.parent.fontSize}pt`
          : '14pt', // Add a default base fontSize with units
      }

      if (!createWithTheme) {
        // Check if default preset has styles and apply the first one
        const firstCategoryStyle = defaultPreset?.value?.categoryStyles?.[0]
        const presetValues = defaultPreset?.value // Keep for font access

        if (firstCategoryStyle) {
          // --- Use explicit HEX colors from the saved preset ---
          const bgColor = firstCategoryStyle.backgroundColor // Should be hex
          const fgColor = firstCategoryStyle.foregroundColor // Should be hex

          initialNodeStyle = {
            ...initialNodeStyle, // Keep defaults unless overridden
            // Apply explicit colors if they exist in the preset
            ...(bgColor && { backgroundColor: bgColor }),
            ...(fgColor && { foregroundColor: fgColor }),

            // Apply font/size if they exist
            ...(presetValues?.categoryFont && {
              fontFamily: presetValues.categoryFont,
            }),
            ...(presetValues?.categoryFontSize && {
              fontSize: `${presetValues.categoryFontSize}pt`, // Ensure units
            }),

            // If foreground wasn't in preset, calculate it based on background
            ...(!fgColor &&
              bgColor && {
                foregroundColor: Slatebox.utils.whiteOrBlack(bgColor),
              }),
          }
        } else if (
          presetValues?.categoryFont ||
          presetValues?.categoryFontSize
        ) {
          // Apply font/size even if no colors defined
          initialNodeStyle = {
            ...initialNodeStyle,
            ...(presetValues.categoryFont && {
              fontFamily: presetValues.categoryFont,
            }),
            ...(presetValues.categoryFontSize && {
              fontSize: `${presetValues.categoryFontSize}pt`, // Ensure units
            }),
          }
        }
      }

      const textForWidthCalc = 'Welcome!'
      const calculatedDimensions = Slatebox.utils.getTextWidth(
        textForWidthCalc,
        `${initialNodeStyle.fontSize} ${initialNodeStyle.fontFamily}`
      )
      // Add some horizontal padding (e.g., 20px each side)
      const nodeWidth = calculatedDimensions.width + 40
      nodeHeight = calculatedDimensions.height + 40

      const defaultNodeOpts = {
        id: gid,
        name: gid,
        text: textForWidthCalc, // Use the same text used for calculation
        xPos: 10000,
        yPos: 10000,
        height: nodeHeight, // Use potentially updated height
        width: nodeWidth, // Use calculated width + padding
        ...initialNodeStyle, // Spread the determined style
      }
      // Removed Object.assign as it's redundant now
      const node = new Slatebox.node(defaultNodeOpts)
      slate.nodes.add(node)
    }

    // if there is no theme, save the slate - theme based slates will be saved once it is applied
    if (!createWithTheme) {
      await saveSlateLite({
        slate,
        userId: newSlate.userId, // Ensure correct user ID context
        orgId: newSlate.orgId, // Ensure correct org ID context
        pkg: {},
      })
    }
    newSlate = JSON.parse(slate.exportJSON())
  }

  // A workshop's notes and cards that traded places are as the server recorded each trade, with the
  // board: the engine keeps to the stored slate for those notes until the room has been told.
  const loaded = newSlate.creative
    ? { ...newSlate, options: { ...newSlate.options, collabTrades: { through: newSlate.creative.revision ?? 0, trades: newSlate.creative.trades ?? {} } } }
    : newSlate
  await slate.loadJSON(JSON.stringify(loaded))

  // if (currentAIContext?.aid && !currentAIContext?.isConversation) {
  //   // set initial layout
  //   const packageLayout = slate.nodes.packageLayout()
  //   const recalculate = await Meteor.callAsync(
  //     CONSTANTS.methods.layouts.calculate,
  //     {
  //       layoutType: {
  //         val: 'dot',
  //       },
  //       packageLayout,
  //     }
  //   )
  //   slate.nodes.applyLayout({ ...recalculate, skipCenter: true })
  // }

  return slate // Return the client-side slate object
}

export default createSlate // Export as default again
