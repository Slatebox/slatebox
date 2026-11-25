/* eslint-disable new-cap */
import { Meteor } from 'meteor/meteor'
import { Slatebox } from 'slateboxjs'
import saveSlateLite from './saveSlate'
import { Organizations, OrganizationSettings } from '../common/models'
import CONSTANTS from '../common/constants'
import { createAINodes } from '../common/ai'
import defaultShapes from '../../ui/components/node/defaultShapes'
import { presetNoteStyle } from '../../ui/common/noteStyle.mjs'
import { DEFAULT_PRESET_QUERY, defaultPreset as teamStyle } from '../common/brandSettings.mjs'
import { loadSlateFaces } from '../../ui/components/presentations/slateFaces.mjs'
import { backgroundColors, presetContainerStyle } from '../common/slateBackground.mjs'

async function createSlate(
  slateBase,
  events,
  isNew,
  isGuest,
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
  const fonts = {}

  if (Meteor.user() && Meteor.user().orgId) {
    // The team's one slate style: the brand kit's default preset (the newest one not removed).
    try {
      const matchingSettings = await Meteor.callAsync(
        CONSTANTS.methods.organizationSettings.getByQuery,
        { ...DEFAULT_PRESET_QUERY }
      )
      defaultPreset = teamStyle(matchingSettings)
    } catch (error) {
      console.error('Error fetching default organization preset:', error)
      defaultPreset = null // Ensure it's null on error
    }

    // A preset names its note font by a typography setting's name: find that font's family (the
    // name itself is used when it can't be found).
    if (defaultPreset?.value?.categoryFont) {
      try {
        const typography = await Meteor.callAsync(
          CONSTANTS.methods.organizationSettings.getByQuery,
          { type: 'typography' }
        )
        ;(typography ?? []).forEach((setting) => {
          if (setting?.value?.name && setting.value.value) fonts[setting.value.name] = setting.value.value
        })
      } catch {
        // The preset's font name stands.
      }
    }

    // New slates are private for everyone.
  }

  // The slate's background: the team's style (the brand kit's default preset), else white, the
  // background nobody chose (in dark mode the canvas shows it as the dark canvas, ui/common/canvasTheme.mjs;
  // it is saved as white). A stored slate's own containerStyle replaces it when the slate is loaded; one
  // stored without any stays on this, and its card on My slates is drawn on the same (slateBackground.mjs).
  let containerStyle = presetContainerStyle(defaultPreset?.value)
  let bgColors = backgroundColors(containerStyle)

  if (!defaultPreset?.value?.background && currentAIContext?.aid) {
    // Fallback for AI context if no preset (kept original logic)
    bgColors = (
      await Meteor.callAsync(CONSTANTS.methods.colors.buildColorPalette, {
        type: 'shades',
      })
    ).slice(0, 5)
    containerStyle = {
      ...containerStyle,
      backgroundColor: bgColors[0],
      backgroundGradientColors: bgColors,
    }
  }

  const opts = {
    id: newSlate.options?.id, // important so that the collab init works correctly
    name: newSlate.options?.name || currentAIContext?.prompt || 'Untitled slate',
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
    mindMapMode: true,
    autoResizeNodesBasedOnText: false,
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
  // How a new note looks on this slate (the welcome's note, a double-click, the tool dock): the
  // organisation's default preset, or the default note.
  slate.noteStyle = presetNoteStyle(defaultPreset?.value, fonts)

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
    }
    // A plain new slate starts empty: the canvas shows its welcome (ui/components/SlateWelcome.jsx)
    // until the first note or board, so every slate is not one more lone note.
    await saveSlateLite({
      slate,
      userId: newSlate.userId, // Ensure correct user ID context
      orgId: newSlate.orgId, // Ensure correct org ID context
      pkg: {},
    })
    newSlate = JSON.parse(slate.exportJSON())
  }

  // A workshop's notes and cards that traded places are as the server recorded each trade, with the
  // board: the engine keeps to the stored slate for those notes until the room has been told.
  const loaded = newSlate.creative
    ? { ...newSlate, options: { ...newSlate.options, collabTrades: { through: newSlate.creative.revision ?? 0, trades: newSlate.creative.trades ?? {} } } }
    : newSlate
  // Every note drawn in its own face from the start, as Present draws it (slateFaces.mjs): the
  // engine wraps and fits a note's words with the face it has when the note is drawn.
  await loadSlateFaces(loaded)
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
