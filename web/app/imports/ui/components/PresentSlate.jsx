/* eslint-disable one-var */
/* eslint-disable no-nested-ternary */
/* eslint-disable react/no-array-index-key */
/* eslint-disable consistent-return */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-restricted-syntax */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Meteor } from 'meteor/meteor'
import TextField from '@mui/material/TextField'
import { useAtom, useAtomValue } from 'jotai'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import SvgIcon from '@mui/material/SvgIcon'
import Grid from '@mui/material/Grid2'
import PublishIcon from '@mui/icons-material/Publish'
import SettingsIcon from '@mui/icons-material/Settings'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import PaletteIcon from '@mui/icons-material/Palette'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import Chip from '@mui/material/Chip'
import Popover from '@mui/material/Popover'
import CircularProgress from '@mui/material/CircularProgress'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import SendIcon from '@mui/icons-material/Send'
import Tooltip from '@mui/material/Tooltip'
import PublishStatus from './library/PublishStatus'
import HistoryIcon from '@mui/icons-material/History'
import DeleteIcon from '@mui/icons-material/Delete'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import FormGroup from '@mui/material/FormGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import cloneDeep from 'lodash.clonedeep'
import CodeIcon from '@mui/icons-material/Code'
import CloseIcon from '@mui/icons-material/Close' // Add this import at the top with other imports
import { Slatebox } from 'slateboxjs'
import BasePresent from './presentations/BasePresent'
import { currentPresentation, slateBackgroundColorAtom } from '../jotai/atoms'
import CONSTANTS from '../../api/common/constants'
import calculateViewpointMetrics from './presentations/calculateViewpointMetrics'
import { presentationEmbed } from './presentations/presentationEmbed.mjs'
import { presentationShareUrl, presentationShareLinks } from './presentations/presentationShare.mjs'
import buildFallbackPresentation, { reconcileViewpoints } from './presentations/buildFallbackPresentation.mjs'
import { workshopScenes, workshopScenesKey } from './presentations/workshopScenes.mjs'
import prepareSlateSurface from './presentations/prepareSlateSurface'
import {
  extractPresentationLayout,
  findPresentationViewpointElements,
  withPresentationTimeout,
} from './presentations/presentationRuntime.mjs'
import { completeDeck, isTrivialLayout, planFailureReason } from './presentations/presentationPlan.mjs'
import { planArrival } from './presentations/presentationSteps.mjs'
import { carryImages, composeDeck, deckRecord, pictureSlots, remixDirection } from './presentations/presentationCompose.mjs'
import { hasStyleOriginal, ownNotesOf, revertToOriginal, revertedPresentation, wearStyle } from './presentations/presentationBake.mjs'
import { layoutOfNodes } from '../../api/common/slate-layout-core.mjs'
import StyleSheet from './presentations/StyleSheet'
import PayNotice from './PayNotice'

// How long the presenter waits for the AI's plan before it keeps the automatic one.
// The server stops at 17 s (PLAN_TIME_LIMIT_MS), and finds the deck's pictures in what is left
// of 19 s (DECK_TIME_LIMIT_MS); this is that and the way back.
const PLAN_TIMEOUT_MS = 20_000
const PLANNING = 'Planning with Slatebox…'
const noPlan = (why) => `Slatebox's plan is unavailable: ${why}${/[.!?]$/.test(why) ? '' : '.'} Showing an automatic grouping of the slate.`
// What the presenter says when the planner answered without a plan: an empty slate is just said.
const noticeFor = (result) => (result.trivial ? null : result.empty ? result.reason : noPlan(planFailureReason(result)))
// A saved deck played over the slate as it is now: notes that are gone are left out, notes added
// since it was made are shown (see completeDeck).
const playDeck = (viewpoints, layout, scenes) => completeDeck(reconcileViewpoints(viewpoints, layout, scenes), layout)
// A deck with its look (an art direction and a style) is composed from the slate as it is now:
// its steps are the viewpoints played, its look what the live canvas draws. → { viewpoints, look }
// or null for a deck without a look.
function styledDeck(saved, layout) {
  // A style the slate wears: its deck is the camera over the slate's own notes and art.
  if (isBakedDeck(saved?.deck)) return { viewpoints: saved.deck.steps, look: { deck: saved.deck, direction: saved.direction, style: saved.style || saved.deck.style } }
  if (!saved?.direction?.steps || !layout) return null
  try {
    const deck = composeDeck(layout, saved.direction, { style: saved.style || saved.direction.style })
    return { viewpoints: deck.steps, look: { direction: saved.direction, style: deck.style } }
  } catch (error) {
    console.error('The styled deck could not be composed:', error)
    return null
  }
}
// A copy of the slate for the live canvas the presenter plays on (never saved back).
function slateCopy(slate) {
  try {
    return slate?.exportJSON?.() ?? null
  } catch {
    return null
  }
}

function getDominantColor(image) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  canvas.width = 1
  canvas.height = 1
  ctx.drawImage(image, 0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  canvas.remove()
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * The presenter's player for a slate on the canvas: the slate's presentation (its viewpoints,
 * built from the slate's analysis) played over the slate's own SVG. A local sequence plays at
 * once; for someone who may edit the slate (`canAuthor`), the saved deck or the AI's plan then
 * replaces it, with the controls to refine, edit and publish it. Anyone else plays the published
 * deck, or the local sequence. `workshop` is the slate's workshop (or, on a slate of many boards,
 * `[{ id, workshop }]`): its lanes open the sequence.
 * `live` (presenting to everyone): { onDeck(deck), onViewChange(step), onFail(message), resume },
 * where `resume` ({ deck, step }) is the session this presenter already leads.
 */
export default function PresentSlate({ slate, canAuthor = false, workshop = null, live = null }) {
  const authoring = canAuthor && !live
  // Presenting to everyone is led by someone who may edit the slate: their presentation is
  // planned with the AI too, before the session starts (a session already led is resumed as is).
  const livePlanning = Boolean(live && !live.resume)
  // A live session this presenter already leads, as it was when the presenter opened.
  const resume = useRef(live?.resume ?? null).current
  const containerRef = useRef(null)
  const refMethods = useRef(null)
  const [curPresentation, setCurPresentation] = useAtom(currentPresentation)
  const [slateRawSVG, setRawSvg] = useState(null)
  const slateBackground = useAtomValue(slateBackgroundColorAtom)
  const [transform, setTransform] = useState('')
  const [presentationId, setPresentationId] = useState(null)
  const [currentVersion, setCurrentVersion] = useState(null)
  const [
    slateHasChangedSincePresentationWasCreated,
    setSlateHasChangedSincePresentationWasCreated,
  ] = useState(false)
  const [viewpointSettingsAnchorEl, setViewpointSettingsAnchorEl] =
    useState(null)
  const [slatePresentations, setSlatePresentations] = useState([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [refinementAnchorEl, setRefinementAnchorEl] = useState(null)
  // The style sheet: one-click styles and the chat that refines the deck.
  const [styleAnchorEl, setStyleAnchorEl] = useState(null)
  // Whether the slate keeps an original (Revert to original): read once when the style sheet opens
  // and after each change of style there, not on every render (it exports the whole slate).
  const [styleCanRevert, setStyleCanRevert] = useState(false)
  // A styled deck's "More" sheet: versions, settings, publishing and sharing.
  const [moreAnchorEl, setMoreAnchorEl] = useState(null)
  const [settingsAnchorEl, setSettingsAnchorEl] = useState(null)
  const [versionAnchorEl, setVersionAnchorEl] = useState(null)
  const [customPromptValue, setCustomPromptValue] = useState('')
  const [baseUrl, setBaseUrl] = useState(Meteor.settings.public.baseUrl)
  const [publishMessage, setPublishMessage] = useState(null)
  const [showViewpointBorders, setShowViewpointBorders] = useState(false)
  const [activeViewpointSettings, setActiveViewpointSettings] = useState(null)
  const [localNarrative, setLocalNarrative] = useState('')
  const [localDuration, setLocalDuration] = useState(3)
  const [editingViewpointIndex, setEditingViewpointIndex] = useState(null)
  const [scenePosition, setScenePosition] = useState(0)
  const [manualViewpointChanges, setManualViewpointChanges] = useState({})
  const [showFooter, setShowFooter] = useState(false)
  // Add a new state variable for dimming
  // The AI planner is planning the slate; the local plan stays playable meanwhile.
  const [planning, setPlanning] = useState(false)
  // Why the presentation playing is the automatic one and not the AI's plan.
  const [planNotice, setPlanNotice] = useState(null)
  // A plan the meter refused (no Pro, the included amount used up): the pay sheet's action beside
  // the notice, and a count that asks for the plan again once paid.
  const [planRefusal, setPlanRefusal] = useState(null)
  const [planAgain, setPlanAgain] = useState(0)
  const refusalOfPlan = (result) => (result?.pay ? { code: result.code, reason: result.reason, pay: result.pay } : null)
  // Slatebox's plan, arrived while the person is past the start of the local one: theirs to use.
  const [readyPlan, setReadyPlan] = useState(null)
  // Where the person is now, for a plan that arrives later (see planArrival).
  const nowShowing = useRef({ view: -1, viewpoints: [] })
  nowShowing.current = { view: curPresentation.currentView, viewpoints: curPresentation.viewpoints }
  // The slate could not be drawn for presenting: said to everyone, whatever their role.
  const [surfaceFailed, setSurfaceFailed] = useState(false)

  function processViewpoints(vps, preziData, multiplier = 1) {
    const processedViewpoints = vps.map((viewpoint) => {
      const metrics = calculateViewpointMetrics(viewpoint.nodeIds, preziData)

      if (!metrics) return viewpoint

      // Calculate scale (will be used in WITH_EFFECTS and OFF modes)
      const containerRect = containerRef.current.getBoundingClientRect()
      const scaleX = (containerRect.width * multiplier) / metrics.width
      const scaleY = (containerRect.height * multiplier) / metrics.height
      const scale = Math.min(scaleX, scaleY)
      const debugNarrative = viewpoint.narrative

      return {
        ...viewpoint,
        x: metrics.centerX,
        y: metrics.centerY,
        width: metrics.width,
        height: metrics.height,
        scale,
        narrative: debugNarrative,
      }
    })
    return processedViewpoints
  }

  useEffect(() => {
    if (!authoring) return
    async function fetchPresentations() {
      const getPrezis = await Meteor.callAsync(
        CONSTANTS.methods.presentations.get,
        {
          slateShareId: slate?.shareId,
          asPublished: false,
        }
      )
      const sps = getPrezis.presentations
      setSlatePresentations(sps)

      setSlateHasChangedSincePresentationWasCreated(
        getPrezis.slateHasChangedSincePresentationWasCreated
      )
      let workingPresentation = null
      if (currentVersion) {
        workingPresentation = sps.find((s) => s.version === currentVersion)
      } else {
        workingPresentation =
          sps.find((s) => s.isPublished) ?? sps[sps.length - 1]
      }
      setPresentationId(workingPresentation?._id)
      setCurrentVersion(workingPresentation?.version)
      setCurPresentation((prev) => ({
        ...prev,
        showNarrative: workingPresentation?.showNarrative ?? true,
        autoplayOnPublish: workingPresentation?.autoplayOnPublish ?? false,
        isPublic: workingPresentation?.isPublic ?? false,
        isEmbedded: workingPresentation?.isEmbedded ?? false,
        playOnHover: workingPresentation?.playOnHover ?? false,
        presentationMenuBgColorKey: getPrezis?.presentationMenuBgColorKey,
        presentationControlsColorKey: getPrezis?.presentationControlsColorKey,
      }))
      setManualViewpointChanges(
        workingPresentation?.viewpointsManuallyChanged ?? {
          deleted: [],
          updated: [],
        }
      )
    }
    fetchPresentations()
  }, [curPresentation.isAnalyzing, planning, publishMessage, currentVersion])

  // this will init the transform and restart the presentation
  useEffect(() => {
    if (containerRef.current && curPresentation.orientData) {
      // Always calculate and store initial transform to center the slate
      refMethods.current.setInitTransform()
    }
  }, [containerRef.current, curPresentation.orientData])

  // A deck replaces the one being played, from its start (the overview).
  const applyDeck = (deck) => {
    setReadyPlan(null)
    refMethods.current?.handleRestart()
    setCurPresentation((prev) => ({ ...prev, presentationName: deck.name || prev.presentationName, viewpoints: deck.viewpoints, ...(deck.look ? { deckLook: deck.look } : {}) }))
  }
  // Slatebox's plan has arrived. At the start of the local plan it takes its place unseen; past
  // the start the person is never moved: the plan waits for them to use it ("Use it"). A live
  // presenter has not started the session yet, so the deck is theirs at once.
  const arrive = (deck, { live: leading = false } = {}) => {
    if (leading || planArrival(nowShowing.current.view, nowShowing.current.viewpoints) === 'swap') applyDeck(deck)
    else setReadyPlan(deck)
  }

  useEffect(() => {
    let isMounted = true
    const scenes = workshopScenes(workshop)

    const analyzeSvg = async () => {
      let surface
      setSurfaceFailed(false)
      try {
        surface = await prepareSlateSurface(slate, { drawn: scenes.map((scene) => scene.nodeIds[0]) })
      } catch (err) {
        console.error('Failed to draw the slate for presenting:', err)
        if (isMounted) {
          setSurfaceFailed(true)
          live?.onFail('This slate could not be drawn for the presentation. Close the presenter and try again.')
        }
        return
      }
      try {
        if (!isMounted) return
        // save the raw SVG for publishing prior to any manipulation
        setRawSvg(surface.rawSvg)
        if (surface.backgroundImage && containerRef.current) {
          containerRef.current.style.backgroundImage = `url(${surface.backgroundImage})`
          containerRef.current.style.backgroundSize = 'cover'
          containerRef.current.style.backgroundPosition = 'top center'
          // set the background of parent element of containerRef.current to match the dominant color of the image
          const image = new Image()
          image.src = surface.backgroundImage
          image.onload = () => {
            if (containerRef.current) containerRef.current.parentElement.style.background = getDominantColor(image)
            image.remove()
          }
        }
        const preziData = surface.layout

        // Install a complete local presentation before asking for a better one. Presentation
        // rendering must not depend on a provider key or a saved deck, and the local sequence
        // stays playable while the planner works.
        const fallback = buildFallbackPresentation(preziData, slate.options.name, { scenes })
        // The local deck, styled: the slate's kind picks its style, composed at once (no AI). A
        // workshop (its lanes are drawn by the host, not notes) and a slate of one or two notes
        // play over the slate's SVG instead.
        const styledOK = !scenes.length && !isTrivialLayout(preziData)
        const local = styledOK ? deckRecord({ layout: preziData, name: slate.options.name, scenes }) : null
        const localLook = local ? { direction: local.direction, style: local.style } : null
        const styledDeckOf = (saved) => (styledOK ? styledDeck(saved, preziData) : null)
        // A slate of one or two notes is its overview: there is nothing to plan or wait for.
        const trivial = isTrivialLayout(preziData)
        setPlanning((authoring || livePlanning) && !resume && !trivial)
        setReadyPlan(null)
        setPlanNotice(null)
        setPlanRefusal(null)
        setCurPresentation((prev) => ({
          ...prev,
          isAnalyzing: false,
          orientData: surface.orient,
          slateSVG: surface.svg,
          slateJSON: styledOK ? slateCopy(slate) : null,
          presentationData: preziData,
          presentationName: fallback.name,
          deckLook: localLook,
          viewpoints: local ? local.viewpoints : processViewpoints(fallback.viewpoints, preziData),
        }))

        if (resume) {
          // Back in a live session this tab leads: the deck everyone is following, as it is.
          const resumed = styledDeckOf(resume.deck)
          setCurPresentation((prev) => ({
            ...prev,
            presentationName: resume.deck.name || fallback.name,
            deckLook: resumed?.look ?? null,
            viewpoints: resumed?.viewpoints ?? processViewpoints(reconcileViewpoints(resume.deck.viewpoints, preziData, scenes, { keep: true }), preziData),
          }))
          return
        }

        const analyze = () => withPresentationTimeout(Meteor.callAsync(
          CONSTANTS.methods.presentations.analyze,
          {
            slate: {
              shareId: slate?.shareId,
              intentionId:
                slate.options.ai?.isConversation?.intentionInitialData
                  ?.intentionId,
              isTemplate: slate.options.basedOnTemplate,
              name: slate.options.name,
            },
            presentationData: JSON.stringify(preziData),
          }
        ), PLAN_TIMEOUT_MS, 'Slatebox took too long to plan this slate.')

        if (!authoring) {
          // The published deck, as the slate is now; otherwise, presenting to everyone, this
          // person's plan (the AI's), and for anyone else the local sequence.
          const saved = await Meteor.callAsync(CONSTANTS.methods.presentations.get, {
            slateShareId: slate.shareId, asPublished: true, forPlayback: !live,
          }).catch(() => null)
          if (!isMounted) return
          // An automatic deck is the local sequence of the slate as it was; play it as it is now.
          const savedStyled = !saved?.presentation?.automatic ? styledDeckOf(saved?.presentation) : null
          let look = savedStyled?.look ?? localLook
          let deck = savedStyled ? savedStyled.viewpoints : saved?.presentation?.viewpoints && !saved.presentation.automatic
            ? playDeck(saved.presentation.viewpoints, preziData, scenes) : []
          let name = deck.length ? saved.presentation.name || fallback.name : fallback.name
          if (!deck.length && livePlanning) {
            try {
              const result = await analyze()
              if (!isMounted) return
              if (result?.automatic) {
                setPlanNotice(noticeFor(result))
                setPlanRefusal(refusalOfPlan(result))
              } else if (result) {
                const planned = styledDeckOf(result)
                deck = planned?.viewpoints ?? playDeck(result.viewpoints, preziData, scenes)
                look = planned?.look ?? look
                name = result.name || name
              }
            } catch (err) {
              console.error('Failed to plan the live presentation:', err)
              if (isMounted) setPlanNotice(noPlan(planFailureReason(err)))
            }
            if (!isMounted) return
            setPlanning(false)
          }
          const viewpoints = deck.length ? deck : local ? local.viewpoints : fallback.viewpoints
          if (!deck.length) look = localLook
          if (deck.length) {
            // The deck replaces the local sequence (see arrive).
            setCurPresentation((prev) => ({ ...prev, showNarrative: saved?.presentation?.showNarrative ?? true }))
            arrive({ name, viewpoints: look ? viewpoints : processViewpoints(viewpoints, preziData), look }, { live: Boolean(live) })
          }
          // Followers get the deck with its look, and compose it over their own drawing of the slate.
          live?.onDeck({ name, viewpoints: viewpoints.map(({ nodeIds, narrative, duration }) => ({ nodeIds, narrative, duration })), ...(look ? { style: look.style, direction: look.direction } : {}) })
          return
        }

        const result = await analyze()

        if (result && isMounted) {
          if (result.automatic) {
            setPlanNotice(noticeFor(result))
            setPlanRefusal(refusalOfPlan(result))
            // Slatebox's own direction is already playing; the pictures the server found for it
            // come into it (matched by what they picture), from the start if the person is there.
            const pictured = local && result.direction ? carryImages(local.direction, [result.direction]) : null
            if (pictured && JSON.stringify(pictured) !== JSON.stringify(local.direction)) {
              const deck = composeDeck(preziData, pictured, { style: local.style })
              arrive({ name: result.name, viewpoints: deck.steps, look: { direction: pictured, style: deck.style } })
            }
          }
          // A saved deck plays over the slate as it is now. An automatic one is the local
          // sequence, which is already built from the slate as it is now.
          const styled = result.automatic ? null : styledDeckOf(result)
          const playable = styled ? styled.viewpoints : result.automatic ? [] : playDeck(result.viewpoints, preziData, scenes)
          if (playable.length) arrive({ name: result.name, viewpoints: styled ? playable : processViewpoints(playable, preziData), look: styled?.look })

          if (result.version) setCurrentVersion(result.version)
          if (result.presentationId) setPresentationId(result.presentationId)
        }
      } catch (err) {
        console.error('Failed to analyze presentation:', err)
        if (isMounted && (authoring || livePlanning)) setPlanNotice(noPlan(planFailureReason(err)))
      } finally {
        if (isMounted) {
          setPlanning(false)
          setCurPresentation((prev) => ({ ...prev, isAnalyzing: false }))
        }
      }
    }

    analyzeSvg()

    return () => {
      isMounted = false
      setTransform('')
      setPresentationId(null)
      setCurPresentation((prev) => ({
        ...prev,
        isAnalyzing: false,
        isPlaying: false,
        currentView: -1,
        orientData: null,
        slateSVG: null,
        slateJSON: null,
        deckLook: null,
        presentationData: null,
        viewpoints: [],
      }))
    }
  }, [slate, planAgain])

  // The workshop's order and cards can change while the presenter is open (a teammate reorders
  // the lanes, moves a card): the lanes' viewpoints follow. A live presentation keeps the deck
  // everyone following it already has.
  const workshopKey = workshopScenesKey(workshop)
  useEffect(() => {
    if (live || !workshop) return
    const scenes = workshopScenes(workshop)
    setCurPresentation((prev) => {
      if (!prev.presentationData || !prev.viewpoints?.length) return prev
      const viewpoints = reconcileViewpoints(prev.viewpoints, prev.presentationData, scenes)
      return { ...prev, viewpoints: processViewpoints(viewpoints, prev.presentationData) }
    })
  }, [workshopKey])

  const handleUnpublish = async (presentation) => {
    await Meteor.callAsync(CONSTANTS.methods.presentations.unpublish, {
      presentationId: presentation._id,
    })
    setPublishMessage(
      `This presentation is unpublished. Reopening its viewer or embeds will no longer show it. Direct image links, cached views, and saved or remixed copies may remain.`
    )
    // Hide message after 5 seconds
    setTimeout(() => setPublishMessage(null), 5000)
  }

  const handlePublish = async (event) => {
    // Publishing disables this button (the version is published), and a disabled button drops the
    // keyboard to the page: Escape, the arrows and Space would no longer reach the presenter. The
    // presenter's own focusable frame keeps it.
    event?.currentTarget?.parentElement?.closest?.('[tabindex="-1"]')?.focus?.({ preventScroll: true })
    const presentationUrl = await Meteor.callAsync(
      CONSTANTS.methods.presentations.publish,
      {
        slateShareId: slate.shareId,
        version: currentVersion,
        svg: curPresentation.slateSVG,
        rawSVG: slateRawSVG,
        background: slateBackground,
        presentationData: curPresentation.presentationData,
        name: slate.options.name,
        description: slate.options.description,
        orientData: curPresentation.orientData,
        viewpoints: curPresentation.viewpoints,
        // The deck's look: the server checks it and builds the slate copy the published page plays.
        direction: curPresentation.deckLook?.direction,
        style: curPresentation.deckLook?.style,
        // Used only when the saved slate lacks an edit not saved yet; the server keeps only what
        // the player draws.
        slateJSON: curPresentation.slateJSON,
        manualViewpointChanges,
        intentionId:
          slate.options.ai?.isConversation?.intentionInitialData?.intentionId,
      }
    )
    // Show temporary message and copy URL
    try {
      await navigator.clipboard.writeText(presentationUrl)
      setPublishMessage(`Published! URL copied to clipboard: ${presentationUrl}`)
    } catch {
      setPublishMessage(`Published! Anyone with this link can view: ${presentationUrl}`)
    }
    // Hide message after 5 seconds
    setTimeout(() => setPublishMessage(null), 5000)
  }

  const handleRefinementClose = async ({ addMore, addLess, customPrompt, presentationData = null, slateChanged = false }) => {
    setRefinementAnchorEl(null)
    let refinementMessage = customPrompt
    if (addMore) {
      refinementMessage = `Please recreate the viewpoints for this presentation with ${
        curPresentation.viewpoints.length + 2
      } total viewpoints.`
    } else if (addLess) {
      refinementMessage = `Please recreate the viewpoints for this presentation with ${
        curPresentation.viewpoints.length - 2
      } total viewpoints.`
    }
    if (refinementMessage?.length) {
      setCurPresentation((prev) => ({ ...prev, isAnalyzing: true }))
      if (
        manualViewpointChanges.updated.length > 0 ||
        manualViewpointChanges.deleted.length > 0
      ) {
        const updatedRefinment =
          manualViewpointChanges.updated.length > 0
            ? `Ensure the following viewpoints retain the duration and narrative properties: ${manualViewpointChanges.updated
                .map(
                  (change) =>
                    `Any viewpoints with nodeIds "${change.nodeIds.join(
                      ','
                    )}" should retain a ${change.duration} duration and a "${
                      change.narrative
                    }" narrative`
                )
                .join('; ')}. `
            : ''

        const deletedRefinment =
          manualViewpointChanges.deleted.length > 0
            ? ` Any viewpoints with nodeIds "${manualViewpointChanges.deleted
                .map((change) => change.nodeIds.join(','))
                .join('; ')}" should NOT be recreated.`
            : ''

        refinementMessage += ` When recreating the viewpoints, ensure any viewpoints that have been manually changed retain the values as defined by the user. ${updatedRefinment}${deletedRefinment}`
      }
      let result = null
      try {
        result = await Meteor.callAsync(
          CONSTANTS.methods.presentations.analyze,
          {
            slate: {
              shareId: slate.shareId,
              intentionId:
                slate.options.ai?.isConversation?.intentionInitialData
                  ?.intentionId,
              isTemplate: slate.options.basedOnTemplate,
              name: slate.options.name,
              showNarrative: curPresentation.showNarrative,
              autoplayOnPublish: curPresentation.autoplayOnPublish,
            },
            refinementMessage,
            slateChanged,
            // The slate as it is drawn now: the refined plan is checked against it.
            presentationData: JSON.stringify(presentationData || curPresentation.presentationData),
          }
        )
      } catch (err) {
        setPublishMessage(`The presentation could not be refined: ${planFailureReason(err)}`)
        setTimeout(() => setPublishMessage(null), 7000)
      }

      const refined = result && curPresentation.deckLook && styledDeck(result, presentationData || curPresentation.presentationData)
      if (refined) {
        setPlanNotice(null)
        setCurrentVersion(result.version)
        setPresentationId(result.presentationId)
        setCurPresentation((prev) => ({ ...prev, viewpoints: refined.viewpoints, deckLook: refined.look }))
      } else if (result) {
        setPlanNotice(null)
        const processedViewpoints = processViewpoints(
          playDeck(result.viewpoints, presentationData || curPresentation.presentationData, workshopScenes(workshop)),
          presentationData || curPresentation.presentationData,
          0.8
        )
        // const processedViewpoints = result.viewpoints.map((viewpoint) => {
        //   const metrics = calculateViewpointMetrics(
        //     viewpoint.nodeIds,
        //     presentationData
        //   )

        //   if (!metrics) return viewpoint

        //   const containerRect = containerRef.current.getBoundingClientRect()
        //   const scaleX = (containerRect.width * 0.8) / metrics.width
        //   const scaleY = (containerRect.height * 0.8) / metrics.height
        //   const scale = Math.min(scaleX, scaleY)

        //   return {
        //     ...viewpoint,
        //     x: metrics.centerX,
        //     y: metrics.centerY,
        //     scale,
        //   }
        // })

        setCurrentVersion(result.version)
        setPresentationId(result.presentationId)
        setCurPresentation((prev) => ({
          ...prev,
          viewpoints: processedViewpoints,
        }))
      }
      setCurPresentation((prev) => ({ ...prev, isAnalyzing: false }))
    } else {
      setTimeout(() => setPublishMessage(null), 5000)
    }
  }

  useEffect(() => {
    setStyleCanRevert(Boolean(styleAnchorEl) && hasStyleOriginal(slateCopy(slate)))
  }, [styleAnchorEl, curPresentation.slateJSON])

  // Wear a style: the slate itself takes it (its background, its notes' look, the style's title
  // cards, captions and art as real notes), as one step of this person's undo; the deck is the
  // camera over it. Present never draws a look the slate does not have. → the worn { slate, deck }.
  const wearOnSlate = async (direction, styleRef) => {
    const engine = slate?.v2 ?? slate
    const current = slateCopy(slate)
    if (!current || !engine?.ownStep) return null
    // The deck played now is kept with the slate's original the first time it wears a style.
    const look = curPresentation.deckLook
    const presentation = look ? { style: look.style ?? null, direction: look.direction ?? null, deck: look.deck ?? null } : null
    const worn = wearStyle(current, styleRef, { direction, name: slate.options.name, presentation })
    const snapshot = JSON.stringify(worn.slate)
    await engine.ownStep(() => engine.invoker.onSlateReplaced({ type: 'onSlateReplaced', data: { snapshot } }))
    // The room and the save path take the styled slate (as an undo's replacement is sent).
    engine.broadcast?.('onSlateReplaced', { action: 'style', snapshot })
    setCurPresentation((prev) => ({ ...prev, slateJSON: snapshot, deckLook: { deck: worn.deck, direction: worn.direction, style: worn.deck.style }, viewpoints: worn.deck.steps }))
    return worn
  }
  // "Revert to original": the slate exactly as it was before it first wore a style (kept on the
  // slate, so it survives reloads and copies), as one step of this person's undo, and the deck it
  // played then (or the camera over it). Nothing made since is lost (revertToOriginal).
  const handleStyleRevert = async () => {
    const engine = slate?.v2 ?? slate
    const current = slateCopy(slate)
    if (!current || !engine?.ownStep || !hasStyleOriginal(current)) return
    try {
      const { slate: back, presentation } = revertToOriginal(current)
      const snapshot = JSON.stringify(back)
      await engine.ownStep(() => engine.invoker.onSlateReplaced({ type: 'onSlateReplaced', data: { snapshot } }))
      engine.broadcast?.('onSlateReplaced', { action: 'style-revert', snapshot })
      const look = curPresentation.deckLook
      // The deck kept with the original, else the camera over the steps played before the first
      // style, then the saved row's steps, then the styled deck's (its style art is gone now).
      const row = slatePresentations.find((item) => item._id === presentationId)
      const reverted = revertedPresentation(back, presentation, row?.viewpoints, curPresentation.viewpoints, look?.deck?.steps)
      const { deck, style } = reverted
      const direction = reverted.direction || look?.direction || null
      setCurPresentation((prev) => ({ ...prev, slateJSON: snapshot, deckLook: { deck, direction, style: style || deck.style }, viewpoints: deck.steps }))
      if (presentationId) await Meteor.callAsync(CONSTANTS.methods.presentations.update, { presentationId, revert: { deck, direction, style } })
    } catch (err) {
      setPublishMessage(`The original could not be brought back: ${err?.reason || err?.message || 'try again'}`)
      setTimeout(() => setPublishMessage(null), 6000)
    }
  }
  // One click: the slate wears the style ("Wear this style"), the same steps remixed for it, and
  // the deck is saved without the AI. Nothing on the slate is lost, and Revert to original undoes it.
  const handleStylePick = async (id) => {
    const look = curPresentation.deckLook
    const current = slateCopy(slate)
    if (!look?.direction || !current) return
    // The same steps in the new style's beats, read from the slate's own notes (not a worn style's art).
    const { layout } = layoutOfNodes(ownNotesOf(current))
    const direction = remixDirection(look.direction, layout, { id }, { name: slate.options.name })
    let worn = null
    try {
      worn = await wearOnSlate(direction, { id })
    } catch (err) {
      setPublishMessage(`The style could not be worn: ${err?.message || 'try again'}`)
      setTimeout(() => setPublishMessage(null), 6000)
      return
    }
    if (!presentationId || !worn) return
    try {
      await Meteor.callAsync(CONSTANTS.methods.presentations.update, { presentationId, style: { id }, deck: worn.deck, direction: worn.direction })
    } catch (err) {
      setPublishMessage(`The style could not be saved: ${planFailureReason(err)}`)
      setTimeout(() => setPublishMessage(null), 6000)
    }
  }
  // The chat: Slatebox reworks the deck (words, layouts, pictures, style) in its conversation.
  const handleStyleRefine = (ask) => {
    setStyleAnchorEl(null)
    handleRefinementClose({ customPrompt: ask })
  }
  // The deck's found pictures (not the style's drawn art), for the sheet: see them, swap them.
  const deckPictures = pictureSlots(JSON.parse(JSON.stringify(curPresentation.deckLook?.direction || {})))
    .map(({ image }, slot) => ({ slot, url: image.url, why: image.why || '', query: image.query || '', source: image.source || 'search', credit: image.credit || '' }))
    .filter((picture) => picture.url && /^https:/.test(picture.url))
  const [pictureBusy, setPictureBusy] = useState(false)
  const handlePicture = async (slot, action) => {
    if (!presentationId || pictureBusy) return
    setPictureBusy(true)
    try {
      const result = await Meteor.callAsync(CONSTANTS.methods.presentations.update, { presentationId, picture: { slot, action } })
      const look = curPresentation.deckLook
      if (result?.direction && look?.deck) {
        // A worn style takes the new picture onto the slate (one undo step).
        const worn = await wearOnSlate(result.direction, look.style)
        if (worn) await Meteor.callAsync(CONSTANTS.methods.presentations.update, { presentationId, style: look.style, deck: worn.deck, direction: worn.direction })
      } else if (result?.direction && look) {
        const deck = composeDeck(curPresentation.presentationData, result.direction, { style: look.style })
        setCurPresentation((prev) => ({ ...prev, deckLook: { direction: result.direction, style: deck.style }, viewpoints: deck.steps }))
      }
    } catch (err) {
      setPublishMessage(err?.reason || 'The picture could not be changed.')
      setTimeout(() => setPublishMessage(null), 6000)
    } finally {
      setPictureBusy(false)
    }
  }
  const handleRemix = () => {
    const id = curPresentation.deckLook?.style?.id
    handleStyleRefine(`Recompose this deck for the ${id} style: choose layouts, headlines and pictures that suit it, and keep the style ${id}.`)
  }

  const handleRefinementClick = (event) => {
    if (slateHasChangedSincePresentationWasCreated) {
      const newPreziData = extractPresentationLayout(slate, {
        orientData: curPresentation.orientData,
      })
      setCurPresentation((prev) => ({ ...prev, presentationData: newPreziData }))
      handleRefinementClose({
        addMore: false,
        addLess: false,
        presentationData: newPreziData,
        // The server adds the slate's notes as they are now (slateChanged), capped as a plan's are.
        slateChanged: true,
        customPrompt: 'My slate has changed, so please plan fresh viewpoints from its notes as they are now. Ensure that all notes are represented.',
      })
    } else {
      setRefinementAnchorEl(event.currentTarget)
    }
  }

  const handleSettingsClose = () => {
    setActiveViewpointSettings(null)
    setSettingsAnchorEl(null)

    // Reset all nodes to full opacity
    const svgContainer = containerRef.current?.querySelector('svg')
    if (svgContainer) {
      const allElements = svgContainer.querySelectorAll('path, text, g')
      allElements.forEach((element) => {
        if (element.style.opacity !== '0') {
          element.style.opacity = 1
          element.style.animation = ''
        }
      })
    }
  }

  const handleSettingsClick = (event) => {
    setSettingsAnchorEl(event.currentTarget)
  }

  const handleCustomPrompt = () => {
    if (customPromptValue?.length) {
      handleRefinementClose({ customPrompt: customPromptValue })
    } else {
      setPublishMessage(`You need to provide instructions!`)
      setTimeout(() => setPublishMessage(null), 5000)
    }
  }

  const handleVersionSelect = async (version) => {
    setShowViewpointBorders(false)
    // setCurPresentation((prev) => ({ ...prev, isAnalyzing: true }))
    try {
      const result = await Meteor.callAsync(
        CONSTANTS.methods.presentations.load,
        {
          slate: {
            shareId: slate.shareId,
            isTemplate: slate.options.basedOnTemplate,
            name: slate.options.name,
          },
          selectVersion: version,
        }
      )

      if (result) {
        // if (!result.presentationData) {
        //   result.presentationData = buildPresentationData(slate, orientData)
        // }
        const processedViewpoints = processViewpoints(
          result.viewpoints,
          curPresentation.presentationData,
          0.8
        )
        setCurrentVersion(version)
        setPresentationId(result.presentationId)
        setCurPresentation((prev) => ({
          ...prev,
          viewpoints: processedViewpoints,
        }))
      }
    } catch (err) {
      console.error('Failed to load version:', err)
    } finally {
      setCurPresentation((prev) => ({ ...prev, isAnalyzing: false }))
      setDrawerOpen(false)
      refMethods.current.handleRestart()
    }
  }

  const handlePresentationUpdate = async (updateData) => {
    const viewpointsManuallyChanged = await Meteor.callAsync(
      CONSTANTS.methods.presentations.update,
      {
        presentationId,
        ...updateData,
      }
    )
    if (updateData.showNarrative != null) {
      setCurPresentation((prev) => ({
        ...prev,
        showNarrative: updateData.showNarrative,
      }))
    }
    if (updateData.viewpoints) {
      setCurPresentation((prev) => ({
        ...prev,
        viewpoints: updateData.viewpoints,
      }))
      setManualViewpointChanges(viewpointsManuallyChanged)
    }
    if (curPresentation.currentView >= 0) {
      refMethods.current.handleNavigate(null)
    }
  }

  function highlightViewpoint(index, viewpoint) {
    const svgContainer = containerRef.current?.querySelector('svg')
    if (svgContainer) {
      // Update the selector to use the index-specific class
      const currentBorder = svgContainer.querySelector(
        `.border-group-${index} rect.viewpoint-border`
      )
      if (currentBorder) {
        currentBorder.style.transition = 'none'
        currentBorder.style.opacity = '1'
      }

      // Now dim everything else, excluding the border elements
      const allElements = svgContainer.querySelectorAll(
        `path, text, g:not(.border-group-${index})`
      )
      allElements.forEach((element) => {
        element.style.transition = 'opacity 0.3s ease-in-out'
        if (element.style.opacity !== '0') {
          element.style.opacity = '0.1'
          element.style.animation = ''
        }
      })

      // only keep current button at full opacity
      const hoveredButton = svgContainer.querySelector(`.button-group-${index}`)
      if (hoveredButton) {
        hoveredButton.style.opacity = '1'
      }
      // const allButtons = svgContainer.querySelectorAll(
      //   '.viewpoint-button-group'
      // )
      // allButtons.forEach((button) => {
      //   button.style.opacity = '1'
      // })

      // Highlight hovered viewpoint's nodes
      viewpoint.nodeIds.forEach((nodeId) => {
        const elements = findPresentationViewpointElements(svgContainer, nodeId)
        elements.forEach((element) => {
          if (element.style.opacity !== '0') {
            element.style.opacity = 1
            element.style.animation = ''
          }
        })
      })
    }
  }

  const renderViewpointBorders = () => {
    // First remove any existing overlays
    const svgElement = containerRef.current?.querySelector('svg')
    if (!svgElement) return

    const existingBorders = svgElement.querySelectorAll('.viewpoint-overlay')
    existingBorders.forEach((border) => border.remove())

    // If not showing borders, just return after cleanup
    if (!showViewpointBorders) return

    // Set overflow visible on SVG
    svgElement.style.overflow = 'visible'

    // Presentation geometry is relative to the cropped artwork; SVG children use world coordinates.
    const { x: originX, y: originY } = svgElement.viewBox.baseVal

    // Track circle positions to prevent overlap
    const circlePositions = new Map()

    // first lay in the borders so they are underneath the buttons
    curPresentation.viewpoints
      .slice()
      .reverse()
      .forEach((viewpoint, reversedIndex) => {
        const index = curPresentation.viewpoints.length - 1 - reversedIndex
        // Create border group with a more specific class name including the index
        const borderGroup = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'g'
        )
        borderGroup.setAttribute(
          'class',
          `viewpoint-overlay viewpoint-border-group border-group-${index}`
        )

        // Create border rectangle
        const rect = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'rect'
        )
        rect.setAttribute('class', 'viewpoint-border')
        rect.setAttribute('x', originX + viewpoint.x - viewpoint.width / 2)
        rect.setAttribute('y', originY + viewpoint.y - viewpoint.height / 2)
        rect.setAttribute('width', viewpoint.width)
        rect.setAttribute('height', viewpoint.height)
        rect.setAttribute(
          'stroke',
          Slatebox.utils.whiteOrBlack(
            slate?.options?.containerStyle?.backgroundColor
          )
        )

        borderGroup.appendChild(rect)
        svgElement.appendChild(borderGroup)
      })

    // next lay in the buttons so they are on top of the borders
    curPresentation.viewpoints
      .slice()
      .reverse()
      .forEach((viewpoint, reversedIndex) => {
        const index = curPresentation.viewpoints.length - 1 - reversedIndex
        // Create separate group for buttons with higher z-index
        const buttonGroup = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'g'
        )
        buttonGroup.setAttribute(
          'class',
          `viewpoint-overlay viewpoint-button-group button-group-${index}`
        )
        buttonGroup.style.zIndex = 1000 - index

        // Adjust position if overlapping
        let circleX = originX + viewpoint.x - viewpoint.width / 2 - 12
        let circleY = originY + viewpoint.y - viewpoint.height / 2 - 12
        const posKey = `${Math.round(circleX)},${Math.round(circleY)}`

        if (circlePositions.has(posKey)) {
          circleX += 20
          circleY += 20
        }
        circlePositions.set(posKey, index)

        // Create number circle with extra padding for hover effect
        const foreignObject = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'foreignObject'
        )
        foreignObject.setAttribute('x', circleX - 2)
        foreignObject.setAttribute('y', circleY - 2)
        foreignObject.setAttribute('width', '50')
        foreignObject.setAttribute('height', '50')
        foreignObject.style.zIndex = '2' // Higher z-index for circles

        const button = document.createElement('button')
        button.style.cursor = 'pointer'
        button.style.cssText = `
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: none;
          background: white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: Arial;
          font-size: 30px;
          color: #666;
          transition: all 0.2s ease;
          position: relative;
          margin: 2px;
        `
        button.textContent = (index + 1).toString()
        button.setAttribute('aria-label', 'Edit viewpoint ' + (index + 1))
        button.onclick = (e) => {
          e.stopPropagation()
          handleViewpointSettingsClick(viewpoint, index, e)
        }
        button.onmouseover = () => {
          button.style.transform = 'scale(1.2)'
          button.style.backgroundColor = '#f0f0f0'
          highlightViewpoint(index, viewpoint)
        }

        button.onmouseout = () => {
          button.style.transform = 'scale(1)'
          button.style.backgroundColor = 'white'

          // Reset all nodes to full opacity if no popover is open
          if (!activeViewpointSettings) {
            const svgContainer = containerRef.current?.querySelector('svg')
            if (svgContainer) {
              const allElements = svgContainer.querySelectorAll('path, text, g')
              allElements.forEach((element) => {
                if (element.style.opacity !== '0') {
                  element.style.opacity = 1
                  element.style.animation = ''
                }
              })
            }
          }
        }

        foreignObject.appendChild(button)
        buttonGroup.appendChild(foreignObject)
        svgElement.appendChild(buttonGroup)
      })
  }

  // Update useEffect to call renderViewpointBorders when needed
  useEffect(() => {
    renderViewpointBorders()
  }, [
    showViewpointBorders,
    curPresentation.viewpoints,
    curPresentation.transform,
  ])

  const handleSettingsSave = async () => {
    if (editingViewpointIndex !== null) {
      const updatedViewpoints = [...curPresentation.viewpoints]
      updatedViewpoints[editingViewpointIndex] = {
        ...updatedViewpoints[editingViewpointIndex],
        narrative: localNarrative,
        duration: Math.round(localDuration * 1000),
      }
      const [edited] = updatedViewpoints.splice(editingViewpointIndex, 1)
      updatedViewpoints.splice(scenePosition, 0, edited)
      try {
        await handlePresentationUpdate({
          viewpoints: updatedViewpoints,
          updatedViewpoint: edited,
        })
      } catch (error) {
        setPublishMessage(error.reason || 'The viewpoint could not be saved.')
        return
      }
    }
    setActiveViewpointSettings(null)
  }

  const viewpointSettingsPopover = (
    <Popover
      open={Boolean(activeViewpointSettings)}
      anchorEl={viewpointSettingsAnchorEl}
      onClose={() => setActiveViewpointSettings(null)}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'left',
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'left',
      }}
    >
      <Box sx={{ p: 2, width: 300 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Viewpoint {activeViewpointSettings?.index + 1} Settings
        </Typography>

        {activeViewpointSettings?.viewpoint && (
          <Typography
            variant="body2"
            sx={{
              mb: 2,
              color: 'text.secondary',
              fontStyle: 'italic',
            }}
          >
            {activeViewpointSettings.viewpoint.nodeIds
              .map((nodeId) => {
                const node =
                  curPresentation.presentationData?.nodes?.find(
                    (n) => n.nodeId === nodeId
                  ) ||
                  curPresentation.presentationData?.nodes
                    ?.flatMap((n) => n.childrenNodes || [])
                    .find((n) => n.nodeId === nodeId)
                return node?.description || node?.text || ''
              })
              .filter(Boolean)
              .join(' • ')}
          </Typography>
        )}

        {curPresentation.showNarrative && (
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Narrative"
            value={localNarrative}
            onChange={(e) => {
              setLocalNarrative(e.target.value)
            }}
            sx={{ mb: 2 }}
          />
        )}

        <TextField fullWidth select label="Position in presentation" value={scenePosition}
          onChange={event => setScenePosition(Number(event.target.value))} sx={{ mb: 2 }}>
          {curPresentation.viewpoints.map((_, index) =>
            <MenuItem key={index} value={index}>{index + 1}</MenuItem>)}
        </TextField>
        <TextField
          fullWidth
          label="Duration (seconds)"
          value={localDuration}
          onChange={(e) => {
            const { value } = e.target
            if (isNaN(value)) {
              e.target.style.borderColor = 'red'
            } else {
              e.target.style.borderColor = 'green'
              setLocalDuration(value)
            }
          }}
          onBlur={() => {
            if (
              localDuration === '' ||
              localDuration === '.' ||
              isNaN(localDuration)
            ) {
              setLocalDuration(0)
            }
          }}
          sx={{ mb: 2 }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
          <Button
            onClick={() => {
              const deletedViewpoint = cloneDeep(
                curPresentation.viewpoints[editingViewpointIndex]
              )
              // Delete the viewpoint
              const updatedViewpoints = curPresentation.viewpoints.filter(
                (_, idx) => idx !== editingViewpointIndex
              )
              setCurPresentation((prev) => ({
                ...prev,
                viewpoints: updatedViewpoints,
              }))
              handlePresentationUpdate({
                viewpoints: updatedViewpoints,
                deletedViewpoint,
              })
              setActiveViewpointSettings(null)
            }}
            color="error"
            size="small"
            variant="contained"
          >
            Delete
          </Button>
          <Box>
            <Button
              onClick={() => setActiveViewpointSettings(null)}
              color="inherit"
              size="small"
              variant="text"
              sx={{ mr: 1 }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSettingsSave}
              color="secondary"
              size="small"
              variant="text"
            >
              Save
            </Button>
          </Box>
        </Box>
      </Box>
    </Popover>
  )

  const currentPublished = slatePresentations.some((p) => p.isPublished && p.version === currentVersion)
  const audience = currentPublished ? (curPresentation.isPublic ? 'Public' : 'Anyone with the link') : 'Private draft'
  // The public link exists once any version is published (the viewer shows the published one).
  const shareUrl = presentationShareUrl(slatePresentations, { baseUrl, slateShareId: slate?.shareId })
  const shareLinks = presentationShareLinks(shareUrl, slate?.options?.name)
  const handleCopyShareLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setPublishMessage(`Link copied to clipboard: ${shareUrl}`)
    } catch {
      setPublishMessage(`Could not copy automatically. Anyone with this link can view: ${shareUrl}`)
    }
    setTimeout(() => setPublishMessage(null), 5000)
  }

  const settingsPopoverContent = (
    <Box sx={{ p: 2, minWidth: '300px' }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
        }}
      >
        <Typography variant="h6">Presentation Settings</Typography>
        <IconButton
          onClick={handleSettingsClose}
          size="small"
          sx={{
            '&:hover': {
              backgroundColor: 'rgba(0, 0, 0, 0.04)',
            },
          }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      <Typography variant="subtitle2">Audience for version {currentVersion}: {audience}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Publishing lets anyone with the presentation link or an embed view this version.
        Your canvas sharing settings stay the same.
      </Typography>
      <FormGroup>
        <FormControlLabel
          sx={{
            mb: '3px',
          }}
          control={
            <Switch
              checked={curPresentation.isPublic}
              onChange={(e) => {
                setCurPresentation((prev) => ({
                  ...prev,
                  isPublic: e.target.checked,
                }))
                handlePresentationUpdate({ isPublic: e.target.checked })
              }}
            />
          }
          label={
            <Box>
              <Typography>Make presentation public</Typography>
              <Typography variant="caption" color="text.secondary">
                Mark the published version as public. Leave off for an unlisted link.
              </Typography>
            </Box>
          }
        />
        <FormControlLabel
          sx={{ mb: '3px' }}
          control={
            <Switch
              checked={showViewpointBorders}
              onChange={(e) => {
                setShowViewpointBorders(e.target.checked)
              }}
            />
          }
          label={
            <Box>
              <Typography>Show Scene Boundaries</Typography>
              <Typography variant="caption" color="text.secondary">
                View scene boundaries for editing (never shown when published)
              </Typography>
            </Box>
          }
        />
        <FormControlLabel
          sx={{ mb: '3px' }}
          control={
            <Switch
              checked={curPresentation.showNarrative}
              onChange={(e) => {
                setCurPresentation((prev) => ({
                  ...prev,
                  showNarrative: e.target.checked,
                }))
                handlePresentationUpdate({ showNarrative: e.target.checked })
              }}
            />
          }
          label={
            <Box>
              <Typography>Show narratives in scenes</Typography>
              <Typography variant="caption" color="text.secondary">
                Show the flyout narratives during presentations
              </Typography>
            </Box>
          }
        />
        <FormControlLabel
          sx={{ mb: '3px' }}
          control={
            <Switch
              checked={curPresentation.autoplayOnPublish}
              onChange={(e) => {
                setCurPresentation((prev) => ({
                  ...prev,
                  autoplayOnPublish: e.target.checked,
                }))
                handlePresentationUpdate({
                  autoplayOnPublish: e.target.checked,
                })
              }}
            />
          }
          label={
            <Box>
              <Typography>Autoplay on load</Typography>
              <Typography variant="caption" color="text.secondary">
                Immediately starts the presentation on load and hides the
                control menu
              </Typography>
            </Box>
          }
        />
        <FormControlLabel
          control={
            <Switch
              checked={curPresentation.isEmbedded}
              onChange={(e) => {
                setCurPresentation((prev) => ({
                  ...prev,
                  isEmbedded: e.target.checked,
                }))
                handlePresentationUpdate({
                  isEmbedded: e.target.checked,
                })
              }}
              disabled={!curPresentation.autoplayOnPublish}
            />
          }
          label={
            <Box>
              <Typography>Embedded mode</Typography>
              <Typography variant="caption" color="text.secondary">
                Hides the top step (1/10, etc) menu during autoplay
              </Typography>
            </Box>
          }
          sx={{
            opacity: curPresentation.autoplayOnPublish ? 1 : 0.5,
            ml: 3, // Indent to show it's related to autoplay
          }}
        />
        <FormControlLabel
          control={
            <Switch
              disabled={!curPresentation.isEmbedded}
              checked={
                curPresentation.playOnHover && curPresentation.isEmbedded
              }
              onChange={(e) => {
                setCurPresentation((prev) => ({
                  ...prev,
                  playOnHover: e.target.checked,
                }))
                handlePresentationUpdate({
                  playOnHover: e.target.checked,
                })
              }}
            />
          }
          label={
            <Box>
              <Typography>
                Play On Hover{' '}
                <i style={{ fontSize: '0.8rem' }}>(embedded only)</i>
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Play the presentation when hovering, pause when exiting
              </Typography>
            </Box>
          }
          sx={{
            ml: 6, // Indent to show it's related to autoplay
          }}
        />
      </FormGroup>
      {/* The library: anyone who uses Slatebox can open a copy of this presentation once it is reviewed. */}
      {authoring && (
        <Box data-testid="present-library" sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider', display: 'grid', gap: 1 }}>
          <Typography variant="subtitle2">Library</Typography>
          <Typography variant="body2" color="text.secondary">
            Publish this presentation as it is now, for anyone to copy and make their own after a review.
          </Typography>
          <PublishStatus kind="presentation" shareId={slate?.shareId} guest={Boolean(Meteor.user()?.isAnonymous)}
            name={slate?.options?.name} description={slate?.options?.description}
            disabled={!presentationId || planning} disabledReason={!presentationId ? 'Make the presentation first.' : ''} />
        </Box>
      )}
    </Box>
  )

  const handleViewpointSettingsClick = (viewpoint, index, event) => {
    // Initialize local state with current viewpoint values
    setScenePosition(index)
    setLocalNarrative(viewpoint?.narrative ?? '')
    setLocalDuration((viewpoint?.duration ?? 3000) / 1000)
    setEditingViewpointIndex(index)
    setActiveViewpointSettings({ viewpoint, index })
    setViewpointSettingsAnchorEl(event.target)

    // highlightViewpoint(index, viewpoint)
  }

  // Where the AI's plan is: being made, or why there is none. Shown to whoever plans the slate.
  const planStatus = (
    <>
      {planning && (
        // The whole label, never cut: it does not shrink or wrap; a phone shows "Planning…", and the
        // full words name the progress indicator everywhere.
        <Box aria-live="polite" className="sb-presentation-planning" sx={{ display: 'flex', alignItems: 'center', gap: 0.5,
          flexShrink: 0, whiteSpace: 'nowrap', color: curPresentation?.presentationControlsColorKey || 'common.white' }}>
          <CircularProgress size={14} color="inherit" aria-label={PLANNING} />
          <Typography variant="caption" aria-hidden sx={{ display: { xs: 'none', sm: 'inline' }, whiteSpace: 'nowrap' }}>{PLANNING}</Typography>
          <Typography variant="caption" aria-hidden sx={{ display: { xs: 'inline', sm: 'none' }, whiteSpace: 'nowrap' }}>Planning…</Typography>
        </Box>
      )}
      {readyPlan && (
        <Box aria-live="polite" className="sb-presentation-plan-ready" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, whiteSpace: 'nowrap',
          color: curPresentation?.presentationControlsColorKey || 'common.white' }}>
          <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>Slatebox's plan is ready</Typography>
          <Button size="small" variant="outlined" color="inherit" sx={{ minWidth: 0, py: 0, lineHeight: 1.6 }}
            onClick={(event) => {
              // The button goes once used: the presenter keeps the keyboard (Escape, the arrows).
              event.currentTarget.parentElement?.closest('[tabindex="-1"]')?.focus()
              applyDeck(readyPlan)
            }}>
            Use it
          </Button>
        </Box>
      )}
      {planNotice && !planning && curPresentation.deckLook && (
        // A styled deck is already Slatebox's own direction: the reason the AI did not plan it is
        // a chip (its words in the tooltip and in the More sheet), not a warning across the bar.
        <Tooltip title={planNotice}>
          <Chip size="small" label="Directed by Slatebox" aria-label={planNotice} className="sb-presentation-plan-chip"
            onClick={(event) => setMoreAnchorEl(event.currentTarget)}
            sx={{ display: { xs: 'none', sm: 'inline-flex' }, color: curPresentation?.presentationControlsColorKey || 'common.white', bgcolor: 'rgba(255,255,255,.14)', flexShrink: 0 }} />
        </Tooltip>
      )}
      {planNotice && !planning && !curPresentation.deckLook && (
        <Typography variant="caption" aria-live="polite" className="sb-presentation-plan-notice"
          sx={{ maxWidth: { xs: '100%', sm: 360 }, flexBasis: { xs: '100%', sm: 'auto' }, textAlign: 'center', lineHeight: 1.3,
            color: curPresentation?.presentationControlsColorKey || 'common.white' }}>
          {planNotice}
          {planRefusal && <>{' '}<PayNotice plain refusal={planRefusal} from="plan" retry={() => setPlanAgain(n => n + 1)} /></>}
        </Typography>
      )}
    </>
  )

  // The presenter's own tools: refine with Slatebox, the style sheet, and the deck's versions,
  // settings, publishing and sharing. A styled deck keeps its bar small (the deck is full bleed):
  // its versions, settings, publishing and sharing open in a sheet from "More".
  const liveDeck = Boolean(curPresentation.deckLook)
  const refineButton = (
    <>
            <Tooltip
              title={
                slateHasChangedSincePresentationWasCreated
                  ? 'Click to refresh - your slate has changed!'
                  : 'Refine presentation'
              }
            >
              <span>
              <IconButton
                aria-label={slateHasChangedSincePresentationWasCreated ? 'Refresh the presentation: your slate has changed' : 'Refine presentation'}
                onClick={handleRefinementClick}
                disabled={planning}
                sx={{
                  animation: slateHasChangedSincePresentationWasCreated
                    ? 'iconGlowPulse 2s infinite'
                    : 'none',
                  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                  borderRadius: '4px', // Ensure the glow effect is circular
                  color:
                    curPresentation?.presentationControlsColorKey ||
                    'common.white',
                }}
              >
                <AutoFixHighIcon />
              </IconButton>
              </span>
            </Tooltip>
    </>
  )
  const styleButton = (
    <>
            {curPresentation.deckLook?.direction && (
              <Tooltip title="Wear a style" disableTouchListener disableFocusListener>
                <span>
                  <IconButton
                    aria-label="Wear a style"
                    aria-haspopup="dialog"
                    data-present-style-button
                    onClick={(event) => setStyleAnchorEl(event.currentTarget)}
                    disabled={planning}
                    sx={{ color: curPresentation?.presentationControlsColorKey || 'common.white' }}
                  >
                    <PaletteIcon />
                  </IconButton>
                </span>
              </Tooltip>
            )}
    </>
  )
  const deckTools = (
    <>
            <Tooltip title="Presentation Settings">
              <IconButton
                onClick={handleSettingsClick}
                sx={{
                  color:
                    curPresentation?.presentationControlsColorKey ||
                    'common.white',
                }}
              >
                <SettingsIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="View previous versions">
              <Button
                onClick={(event) => {
                  setVersionAnchorEl(event.currentTarget)
                  setDrawerOpen(true)
                }}
                sx={(theme) => ({
                  color:
                    curPresentation?.presentationControlsColorKey ||
                    'common.white',
                  cursor: 'pointer',
                  position: 'relative',
                  border: currentPublished
                    ? `1px solid ${theme.palette.success.light}`
                    : '1px solid',
                })}
                variant="outlined"
                size="small"
                startIcon={<HistoryIcon />}
              >
                Version {currentVersion} of {slatePresentations.length}
              </Button>
            </Tooltip>

            <Tooltip
              title={
                currentPublished
                  ? 'This version is already published'
                  : 'Publish this version for anyone with the link'
              }
            >
              <span>
                {' '}
                {/* Wrapper needed for disabled Tooltip */}
                <Button
                  aria-description="Anyone with the presentation link or an embed can view this version after publication."
                  aria-label="Publish presentation"
                  onClick={handlePublish}
                  disabled={planning || currentPublished || !presentationId}
                  size="small"
                  startIcon={<PublishIcon />}
                  sx={{ color: curPresentation?.presentationControlsColorKey || 'common.white' }}
                >
                  {currentPublished ? audience : (curPresentation.isPublic ? 'Publish as public' : 'Publish to anyone with the link')}
                </Button>
              </span>
            </Tooltip>

            {/* Sharing the published link: on wider screens, where the bar has room. Until a version
                is published there is no public link, so the controls are disabled. */}
            <Box sx={{ display: { xs: 'none', sm: 'contents' } }}>
              {[
                { key: 'copy', label: 'Copy presentation link', bg: '#2196f3', icon: <ContentCopyIcon sx={{ fontSize: 15 }} /> },
                { key: 'facebook', label: 'Share on Facebook', bg: '#3b5998', path: 'M18.77 7.46H14.5v-1.9c0-.9.6-1.1 1-1.1h3V.5h-4.33C10.24.5 9.5 3.44 9.5 5.32v2.15h-3v4h3v12h5v-12h3.85l.42-4z' },
                { key: 'email', label: 'Share by email', bg: '#333', path: 'M22 4H2C.9 4 0 4.9 0 6v12c0 1.1.9 2 2 2h20c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM7.25 14.43l-3.5 2c-.08.05-.17.07-.25.07-.17 0-.34-.1-.43-.25-.14-.24-.06-.55.18-.68l3.5-2c.24-.14.55-.06.68.18.14.24.06.55-.18.68zm4.75.07c-.1 0-.2-.03-.27-.08l-8.5-5.5c-.23-.15-.3-.46-.15-.7.15-.22.46-.3.7-.14L12 13.4l8.23-5.32c.23-.15.54-.08.7.15.14.23.07.54-.16.7l-8.5 5.5c-.08.04-.17.07-.27.07zm8.93 1.75c-.1.16-.26.25-.43.25-.08 0-.17-.02-.25-.07l-3.5-2c-.24-.13-.32-.44-.18-.68s.44-.32.68-.18l3.5 2c.24.13.32.44.18.68z' },
                { key: 'linkedin', label: 'Share on LinkedIn', bg: '#046293', path: 'M6.5 21.5h-5v-13h5v13zM4 6.5C2.5 6.5 1.5 5.3 1.5 4s1-2.4 2.5-2.4c1.6 0 2.5 1 2.6 2.5 0 1.4-1 2.5-2.6 2.5zm11.5 6c-1 0-2 1-2 2v7h-5v-13h5V10s1.6-1.5 4-1.5c3 0 5 2.2 5 6.3v6.7h-5v-7c0-1-1-2-2-2z' },
              ].map(({ key, label, bg, icon, path }, i) => {
                const href = shareLinks?.[key]
                const linkProps = !href || key === 'copy' ? {} : {
                  component: 'a',
                  href,
                  ...(key === 'email' ? {} : { target: '_blank', rel: 'noopener noreferrer' }),
                }
                return (
                  <Tooltip key={key} title={shareLinks ? label : 'Publish to share'}>
                    <span>
                      <IconButton
                        aria-label={label}
                        data-share={key}
                        disabled={!shareLinks}
                        onClick={key === 'copy' ? handleCopyShareLink : undefined}
                        {...linkProps}
                        sx={{
                          width: 25,
                          height: 25,
                          p: '5px',
                          ml: i === 0 ? 1 : 0.5,
                          borderRadius: '4px',
                          color: '#fff',
                          backgroundColor: bg,
                          '&:hover': { backgroundColor: bg, opacity: 0.85 },
                          '&.Mui-disabled': { color: 'rgba(255, 255, 255, 0.7)', backgroundColor: 'rgba(0, 0, 0, 0.26)' },
                        }}
                      >
                        {icon || (
                          <SvgIcon sx={{ fontSize: 15 }}>
                            <path d={path} />
                          </SvgIcon>
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                )
              })}
            </Box>
    </>
  )

  return (
    <>
      {surfaceFailed && (
        <Typography role="alert" sx={{ position: 'absolute', top: '70px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000, bgcolor: 'background.paper', color: 'text.primary', px: 2, py: 1, borderRadius: 1, boxShadow: 2 }}>
          This slate could not be drawn for the presentation. Close the presenter and try again.
        </Typography>
      )}
      {publishMessage && (
        <Box
          sx={{
            position: 'absolute',
            top: '70px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            color: '#000',
            bgcolor: 'background.paper',
            padding: '8px 16px',
            borderRadius: '4px',
            boxShadow: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mt: 2,
          }}
        >
          <Typography variant="body2">{publishMessage}</Typography>
        </Box>
      )}
      <BasePresent
        ref={refMethods}
        // Presenting to everyone starts once its deck is planned (at most PLAN_TIMEOUT_MS): the
        // presenter waits at the start, so the plan never moves them back.
        holdAtStart={livePlanning && planning}
        containerRef={containerRef}
        slateSVG={curPresentation.slateSVG}
        orientData={curPresentation.orientData}
        showNarrative={curPresentation.showNarrative}
        viewpoints={curPresentation.viewpoints}
        presentationName={curPresentation.presentationName}
        presentationData={curPresentation.presentationData}
        presentationMenuBgColorKey={curPresentation.presentationMenuBgColorKey}
        presentationControlsColorKey={
          curPresentation.presentationControlsColorKey
        }
        playOnHover={curPresentation.playOnHover}
        intentionId={
          slate.options.ai?.isConversation?.intentionInitialData?.intentionId
        }
        showControls
        isEmbedded={false}
        isEditable
        onViewChange={live?.onViewChange}
        startAt={resume?.step}
        showFooter={showFooter}
        baseUrl={baseUrl}
        renderCustomControls={authoring ? () => (
          liveDeck ? (
            <>
              {planStatus}
              {refineButton}
              {styleButton}
              <Tooltip title="Publish, share, versions and settings" disableTouchListener disableFocusListener>
                <IconButton
                  aria-label="More presenter options"
                  aria-haspopup="dialog"
                  data-present-more
                  onClick={(event) => setMoreAnchorEl(event.currentTarget)}
                  sx={{ color: curPresentation?.presentationControlsColorKey || 'common.white' }}
                >
                  <MoreHorizIcon />
                </IconButton>
              </Tooltip>
            </>
          ) : (
          <>
            {planStatus}
            {refineButton}
            {styleButton}
            {deckTools}
          </>
          )
        ) : (livePlanning || readyPlan) ? () => planStatus : undefined}
      />

      <Popover
        open={drawerOpen}
        anchorEl={versionAnchorEl}
        onClose={() => {
          setDrawerOpen(false)
          setVersionAnchorEl(null)
        }}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        slotProps={{
          paper: {
            sx: {
              width: 320,
              maxHeight: 400,
              overflow: 'auto',
            },
          },
        }}
      >
        <Box sx={{ p: 2 }}>
          <Typography
            variant="h6"
            sx={{
              position: 'sticky',
              top: 0,
              bgcolor: 'background.paper',
              py: 1,
              zIndex: 1,
            }}
          >
            Version History
          </Typography>
          <List>
            {slatePresentations.map((presentation, index) => (
              <ListItemButton
                key={presentation._id}
                onClick={() =>
                  handleVersionSelect(slatePresentations.length - index)
                }
                selected={currentVersion === slatePresentations.length - index}
              >
                <ListItemText
                  primary={
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                      }}
                    >
                      <span>{`Version ${
                        slatePresentations.length - index
                      }`}</span>
                      {presentation.isPublished && (
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{
                              color: 'success.dark',
                              backgroundColor: 'success.lighter',
                              px: 1,
                              py: 0.5,
                              borderRadius: 1,
                              fontSize: '0.75rem',
                            }}
                          >
                            Published
                          </Typography>
                          <Tooltip title="Copy URL">
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation() // Prevent version selection
                                navigator.clipboard.writeText(presentation.url)
                                setPublishMessage(
                                  `URL copied to clipboard: ${presentation.url}`
                                )
                                setTimeout(() => setPublishMessage(null), 5000)
                              }}
                              sx={{
                                p: 0.5,
                                '&:hover': {
                                  backgroundColor: 'rgba(0, 0, 0, 0.04)',
                                },
                              }}
                            >
                              <ContentCopyIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Copy embed code">
                            <IconButton
                              size="small"
                              aria-label="Copy embed code"
                              onClick={async (e) => {
                                e.stopPropagation()
                                try {
                                  const snippet = presentationEmbed(presentation, slate, baseUrl)
                                  await navigator.clipboard.writeText(snippet)
                                  setPublishMessage('Embed code copied to clipboard')
                                } catch {
                                  setPublishMessage('Could not copy the embed code. Check clipboard access and try again.')
                                }
                                setTimeout(() => setPublishMessage(null), 5000)
                              }}
                              sx={{
                                p: 0.5,
                                '&:hover': {
                                  backgroundColor: 'rgba(0, 0, 0, 0.04)',
                                },
                              }}
                            >
                              <CodeIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Unpublish">
                            <IconButton
                              aria-label="Unpublish presentation"
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleUnpublish(presentation)
                              }}
                              sx={{
                                p: 0.5,
                                '&:hover': {
                                  backgroundColor: 'rgba(0, 0, 0, 0.04)',
                                },
                              }}
                            >
                              <DeleteIcon fontSize="small" color="error" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      )}
                    </Box>
                  }
                  secondary={new Date(presentation.timestamp).toLocaleString()}
                />
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Popover>

      <Popover
        open={Boolean(moreAnchorEl)}
        anchorEl={moreAnchorEl}
        onClose={() => setMoreAnchorEl(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{ paper: { 'aria-label': 'More presenter options', sx: { bgcolor: 'rgba(18,18,24,.94)', color: '#fff', backdropFilter: 'blur(14px)', borderRadius: '18px', p: 1.5, maxWidth: 'min(560px, calc(100vw - 24px))' } } }}
      >
        {planNotice && (
          <Typography variant="caption" component="p" className="sb-presentation-plan-notice" sx={{ opacity: 0.85, mb: 1, mx: 0.5, lineHeight: 1.35 }}>
            {planNotice}
            {planRefusal && <>{' '}<PayNotice plain refusal={planRefusal} from="plan" retry={() => setPlanAgain(n => n + 1)} /></>}
          </Typography>
        )}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          {deckTools}
        </Box>
      </Popover>

      <StyleSheet
        anchorEl={styleAnchorEl}
        onClose={() => setStyleAnchorEl(null)}
        current={curPresentation.deckLook?.deck?.style?.id}
        onPick={handleStylePick}
        onRevert={handleStyleRevert}
        canRevert={styleCanRevert}
        onRefine={handleStyleRefine}
        onRemix={handleRemix}
        busy={planning || Boolean(curPresentation.isAnalyzing) || pictureBusy}
        pictures={deckPictures}
        onPicture={presentationId ? handlePicture : null}
      />

      <Popover
        open={Boolean(refinementAnchorEl)}
        anchorEl={refinementAnchorEl}
        onClose={handleRefinementClose}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
      >
        <Box sx={{ p: 2, pb: 0 }}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 2,
            }}
          >
            <Typography variant="h6">Refine Presentation</Typography>
            <IconButton
              onClick={handleRefinementClose}
              size="small"
              sx={{
                '&:hover': {
                  backgroundColor: 'rgba(0, 0, 0, 0.04)',
                },
              }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Adjust this presentation with AI prompts.
          </Typography>
        </Box>
        <List sx={{ width: 330 }}>
          <ListItemButton
            onClick={() => {
              handleRefinementClose({ addMore: true })
            }}
          >
            <ListItemText primary="Add more steps &rarr;" />
          </ListItemButton>
          <ListItemButton
            onClick={() => {
              handleRefinementClose({ addLess: true })
            }}
          >
            <ListItemText primary="Add fewer steps &rarr;" />
          </ListItemButton>
          <Box sx={{ p: 2 }}>
            <TextField
              fullWidth
              multiline
              rows={4}
              placeholder="Custom instructions &rarr;"
              size="small"
              value={customPromptValue}
              onChange={(e) => setCustomPromptValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                  handleCustomPrompt()
                }
              }}
              sx={{
                width: '300px',
              }}
              slotProps={{
                input: {
                  endAdornment: (
                    <IconButton size="small" onClick={handleCustomPrompt}>
                      <SendIcon fontSize="small" />
                    </IconButton>
                  ),
                },
              }}
            />
          </Box>
        </List>
      </Popover>

      <Popover
        open={Boolean(settingsAnchorEl)}
        anchorEl={settingsAnchorEl}
        onClose={handleSettingsClose}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
      >
        {settingsPopoverContent}
      </Popover>

      {viewpointSettingsPopover}
    </>
  )
}
