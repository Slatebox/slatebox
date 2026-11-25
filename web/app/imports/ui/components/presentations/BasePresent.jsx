/* eslint-disable no-nested-ternary */
import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
  useRef,
} from 'react'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import CircularProgress from '@mui/material/CircularProgress'
import ReplayIcon from '@mui/icons-material/Replay'
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore'
import NavigateNextIcon from '@mui/icons-material/NavigateNext'
import { useAtom, useAtomValue } from 'jotai'
import PropTypes from 'prop-types'

import calculateViewpointMetrics from './calculateViewpointMetrics'
import detectDevicePerf from './detectDevicePerf'
import handleAnimations from './handleAnimations'
import {
  findPresentationDimmableElements,
  findPresentationViewpointElements,
  resolvePresentationFrameNodeIds,
} from './presentationRuntime.mjs'
import { cameraTransform, fitFrame, inSvgPixels, unionFrame, wholeSlateFrame } from './presentationFraming.mjs'
import { isOverviewAt, startView, stepOf } from './presentationSteps.mjs'
import { currentPresentation, isMobileOrTouchDevice } from '../../jotai/atoms'
import LiveStage from './LiveStage'
import { playableDeck } from './presentationBake.mjs'
import { STYLES } from './presentationStyles.mjs'

const BasePresent = forwardRef(
  (
    {
      renderCustomControls,
      containerRef,
      showFooter = false,
      showControls = true,
      viewIndex,
      isEditable = false,
      onViewChange,
      startAt,
      holdAtStart = false,
    },
    ref
  ) => {
    const [transform, setTransform] = useState('')
    const [initialTransform, setInitialTransform] = useState('')
    const [isLowPerformance, setIsLowPerformance] = useState(undefined)
    const [svgHasLoaded, setSVGHasLoaded] = useState(false)
    const [baseUrl, setBaseUrl] = useState(Meteor.settings.public.baseUrl)
    const [curPresentation, setCurPresentation] = useAtom(currentPresentation)
    const isMobile = useAtomValue(isMobileOrTouchDevice)
    // A deck with a look plays on a live canvas (LiveStage): the camera over the slate as saved.
    // A worn style is on the slate itself (deck version 5); an older look plays the slate as it is
    // drawn, since the player draws nothing of its own. Without a look, the slate's SVG snapshot.
    const liveRef = useRef(null)
    const look = curPresentation.deckLook
    const liveDeck = useMemo(() => {
      if (!(look?.deck || look?.direction?.steps) || !curPresentation.slateJSON) return null
      try {
        return playableDeck({ deck: look.deck, viewpoints: curPresentation.viewpoints, slateJSON: curPresentation.slateJSON })
      } catch (error) {
        console.error('The deck could not be read:', error)
        return null
      }
    }, [look, curPresentation.slateJSON])
    const isLive = Boolean(liveDeck)
    // The controls' height: the live stage keeps its captions and framing above them.
    const [controlsHeight, setControlsHeight] = useState(0)
    useEffect(() => {
      const bar = controlsRef.current
      if (!isLive || !bar || typeof ResizeObserver === 'undefined') return undefined
      const observer = new ResizeObserver(() => setControlsHeight(bar.getBoundingClientRect().height))
      observer.observe(bar)
      return () => observer.disconnect()
    }, [isLive, showControls])
    // The controls take the worn style's colors (player chrome, not the slate's look).
    const chrome = isLive ? STYLES[liveDeck.style?.id]?.chrome ?? null : null
    const resizeObserver = useRef(null)
    const controlsRef = useRef(null)
    const narrativeRef = useRef(null)
    // What the camera frames now ({ frame, hasNarrative }), or null for the whole slate.
    const framed = useRef(null)
    // The slate's drawing: the SVG in the camera. The presenter's icons are SVGs too, and one may
    // come first in the presenter (measuring notes in an icon's units frames them from 0, 0).
    const slateSvg = () => containerRef.current?.querySelector('.sb-presentation-camera svg')

    // The presenter's size and the room the narrative (over the top) and the controls (along the
    // bottom) take, measured: a framed note is never behind either.
    function room(hasNarrative) {
      const container = containerRef.current.getBoundingClientRect()
      const controls = showControls ? controlsRef.current?.getBoundingClientRect() : null
      const bottom = controls?.height ? Math.max(0, container.bottom - controls.top) : 0
      let top = 0
      if (hasNarrative) {
        const narrativeBox = narrativeRef.current?.getBoundingClientRect()
        top = narrativeBox?.height ? Math.max(0, narrativeBox.bottom - container.top) : 72
      }
      return { width: container.width, height: container.height, top, bottom }
    }
    const transformFor = (frame, hasNarrative) => cameraTransform(frame, fitFrame(frame, room(hasNarrative)))

    // What is drawn, in the slate's units: every note and every part drawn with one (a lane's
    // column, caption and picture are drawn, not notes of the layout), measured in the SVG. The
    // whole slate is framed by this, so nothing drawn is cut off.
    function drawnBox() {
      // Measured on screen and brought into the SVG's own pixels (the layout's and the camera's
      // units), not its user units: its viewBox may start far from 0. The camera is level here
      // (an overview), so a screen box is the drawn box.
      const svg = slateSvg()
      const svgBox = svg?.getBoundingClientRect?.()
      if (!svgBox?.width) return null
      const svgWidth = svg.width?.baseVal?.value || svg.clientWidth
      let box = null
      svg.querySelectorAll('[data-node-id]').forEach((element) => {
        const onScreen = element.getBoundingClientRect?.()
        if (!onScreen || (!onScreen.width && !onScreen.height)) return
        const next = inSvgPixels(onScreen, svgBox, svgWidth)
        box = box ? (({ centerX, centerY, width, height }) => ({ x: centerX - width / 2, y: centerY - height / 2, width, height }))(unionFrame(box, next)) : next
      })
      return box
    }

    function setInitTransform() {
      // The whole slate: every note, in the room the controls leave.
      if (isLive) return
      if (containerRef.current && curPresentation.orientData) {
        const { width, height } = curPresentation.orientData
        const frame = unionFrame(wholeSlateFrame(curPresentation.presentationData), drawnBox()) ||
          { centerX: width / 2, centerY: height / 2, width: Math.max(width, 1), height: Math.max(height, 1), rotation: 0 }
        const initTransform = transformFor(frame, false)
        setInitialTransform(initTransform)
        if (framed.current) setTransform(transformFor(framed.current.frame, framed.current.hasNarrative))
        else setTransform(initTransform)
      }
    }
    const initRef = useRef(setInitTransform)
    initRef.current = setInitTransform

    // Reduced motion: a note is shown, not animated in.
    const plain = isLowPerformance || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const cleanupAnimations = (prevNodeIds) => {
      if (prevNodeIds?.length) {
        handleAnimations(prevNodeIds, false, plain)
      }
    }

    const handleRestart = () => {
      framed.current = null
      setCurPresentation((prev) => ({
        ...prev,
        currentView: -1,
        isPlaying: false,
      }))
      // The live deck's start is its title card.
      if (isLive) {
        liveRef.current?.goTo(0)
        return
      }
      setTransform(initialTransform)

      // Reset all node styles including glow effects
      const svgContainer = slateSvg()
      if (svgContainer) {
        const allElements = svgContainer.querySelectorAll('path, text, g')
        allElements.forEach((element) => {
          if (element.style.opacity !== '0') {
            element.style.opacity = 1
            element.style.animation = ''
            element.style.transition = ''
          }
        })
      }
    }

    // A plan starts on its overview of the whole slate (viewpoint 0, with its narrative); a deck
    // without one starts on the whole slate before its first viewpoint (-1). See presentationSteps.
    const start = startView(curPresentation.viewpoints)
    const restoreAll = () => {
      const svgContainer = slateSvg()
      svgContainer?.querySelectorAll('path, text, g').forEach((element) => {
        if (element.style.opacity !== '0') {
          element.style.opacity = 1
          element.style.animation = ''
          element.style.transition = ''
        }
      })
    }

    const handleNavigate = (direction) => {
      // Held at the start (a live presentation whose deck is still being planned: nobody follows
      // yet, and the planned deck starts there).
      if (holdAtStart) return
      let targetView = curPresentation.currentView
      if (
        direction === 'next' &&
        curPresentation.currentView < curPresentation.viewpoints.length - 1
      ) {
        targetView = curPresentation.currentView + 1
      } else if (direction === 'prev' && curPresentation.currentView > 0) {
        targetView = curPresentation.currentView - 1
      } else if (
        direction === 'next' &&
        targetView === curPresentation.viewpoints.length - 1
      ) {
        setTransform(initialTransform)
        handleRestart()
        return
      }

      goToView(targetView)
    }

    const goToView = (targetView) => {
      const point = curPresentation.viewpoints[targetView]
      if (!point) return
      if (isLive) {
        // The camera flies on the live canvas; the stage lights and reveals the step's notes.
        liveRef.current?.goTo(targetView)
        setCurPresentation((prev) => ({ ...prev, currentView: targetView }))
        return
      }

      // A transition keeps the line that connects it to the previous viewpoint in frame.
      const previousPoint =
        curPresentation.viewpoints[curPresentation.currentView]
      const frameNodeIds = resolvePresentationFrameNodeIds(curPresentation.presentationData, point.nodeIds, previousPoint?.nodeIds)

      // The box the viewpoint's notes cover (rotation included), with its connected transition
      // context, fitted in the room the narrative (above) and the controls (below) leave. The
      // narrative's own height is measured once it shows (see the layout effect below).
      const notesFrame = calculateViewpointMetrics(
        frameNodeIds,
        curPresentation.presentationData
      )
      // An overview (the opening, the close) is the whole slate: everything drawn, columns included.
      const overview = isOverviewAt(targetView, curPresentation.viewpoints)
      const frame = overview && notesFrame ? unionFrame(notesFrame, drawnBox()) : notesFrame
      if (!frame) return
      const hasNarrative = Boolean(curPresentation.showNarrative && point.narrative)
      framed.current = { frame, hasNarrative }
      const nextTransform = transformFor(frame, hasNarrative)
      const svgContainer = slateSvg()
      // An overview shows the whole slate as the start does: nothing is dimmed.
      if (overview) restoreAll()
      else if (svgContainer) {
        // Dim semantic node/relationship owners without fading shared SVG
        // containers or multiplying opacity across their descendants.
        const allElements = findPresentationDimmableElements(svgContainer)
        allElements.forEach((element) => {
          const relAttribute = element.getAttribute('rel')
          if (
            (!relAttribute || !relAttribute.startsWith('nodrag')) &&
            element.style.opacity !== '0'
          ) {
            element.style.transition = 'opacity 0.75s ease-in-out'
            element.style.opacity = '0.1'
            element.style.animation = ''
          }
        })

        // Highlight the current viewpoint's elements
        point.nodeIds.forEach((nodeId) => {
          const elements = findPresentationViewpointElements(
            svgContainer,
            nodeId
          )
          elements.forEach((element) => {
            if (element.style.opacity !== '0') {
              element.style.opacity = 1
              element.style.animation = ''
            }
          })
        })
      }

      setTransform(nextTransform)
      setCurPresentation((prev) => ({ ...prev, currentView: targetView }))

      // Clean up previous animations
      cleanupAnimations(
        curPresentation.viewpoints[curPresentation.currentView]?.nodeIds
      )

      // Add new animations after a brief delay to ensure transform is complete
      setTimeout(() => {
        handleAnimations(
          curPresentation.viewpoints[targetView]?.nodeIds,
          true,
          plain
        )
      }, 200) // Match the transform transition duration
    }

    // Once the viewpoint's narrative is on screen, fit the frame to the room it really leaves.
    useLayoutEffect(() => {
      if (!framed.current || !containerRef.current) return
      const next = transformFor(framed.current.frame, framed.current.hasNarrative)
      setTransform((current) => (current === next ? current : next))
    }, [curPresentation.currentView, curPresentation.viewpoints?.[curPresentation.currentView]?.narrative, curPresentation.showNarrative])

    const startPresentation = () => {
      setCurPresentation((prev) => ({ ...prev, currentView: -1 }))
      if (isLive && curPresentation.viewpoints.length > 0) {
        setCurPresentation((prev) => ({ ...prev, isPlaying: true }))
        setTimeout(() => goToView(0), 50)
        return
      }
      if (curPresentation.viewpoints.length > 0) {
        const point = curPresentation.viewpoints[0]
        setTransform(
          `translate(50%, 50%) scale(${point.scale}) translate(-${point.x}px, -${point.y}px) rotate(${point.rotation}deg)`
        )
        setCurPresentation((prev) => ({ ...prev, isPlaying: true }))

        // Reset all node styles including glow effects
        if (curPresentation.autoplayOnPublish) {
          const svgContainer = slateSvg()
          if (svgContainer) {
            const allElements = svgContainer.querySelectorAll('text')
            allElements.forEach((element) => {
              element.style.opacity = 0
            })
          }
        }
        // Immediately move to the first viewpoint
        setTimeout(() => {
          handleNavigate('next')
        }, 100)
      }
    }

    useImperativeHandle(
      ref,
      () => ({
        setInitTransform,
        handleNavigate,
        startPresentation,
        handleRestart,
      }),
      [curPresentation, initialTransform, containerRef.current]
    )

    // Call the performance detection function when the component mounts
    useEffect(() => {
      // Only run in the browser and when in published mode (to avoid affecting viewers)
      if (!isEditable && isLowPerformance === undefined) {
        setIsLowPerformance(detectDevicePerf(isMobile))
      }
    }, [curPresentation])

    // stop loading once the SVG has loaded (a live deck: once its stage is ready)
    useEffect(() => {
      if (curPresentation.slateSVG && !isLive) {
        setSVGHasLoaded(true)
      }
    }, [curPresentation.slateSVG, isLive])

    // this will init the transform and restart the presentation
    // useEffect(() => {
    //   if (containerRef.current && curPresentation.orientData) {
    //     // Always calculate and store initial transform to center the slate
    //     setInitTransform()
    //   }
    // }, [containerRef.current, curPresentation.orientData])

    // autoplay if set
    useEffect(() => {
      if (
        curPresentation.autoplayOnPublish &&
        !curPresentation.isPlaying &&
        curPresentation.currentView === -1 &&
        !isEditable
      ) {
        startPresentation(true)
      }
    }, [curPresentation])

    // A follower's view is set from outside (the presenter's step; -1 is the whole slate). It
    // uses the same camera and highlight as the controls.
    const controlledView = useRef(null)
    controlledView.current = viewIndex === undefined ? null
      : () => (viewIndex < 0 ? handleRestart() : goToView(viewIndex))
    useEffect(() => {
      if (svgHasLoaded) controlledView.current?.()
    }, [svgHasLoaded, viewIndex])

    // A presenter back in a session it leads opens where everyone is (`startAt`), and reports
    // nothing until it is there.
    const started = useRef(!(startAt >= 0))
    useEffect(() => {
      if (started.current || !svgHasLoaded || !curPresentation.viewpoints?.[startAt]) return
      started.current = true
      goToView(startAt)
    }, [svgHasLoaded, curPresentation.viewpoints])

    // A plan opens on its overview: at the start (and after a restart) the presenter moves to it,
    // narrative and all. A follower is moved by the presenter; a published deck that plays itself
    // starts from the whole slate.
    useEffect(() => {
      if (viewIndex !== undefined || !started.current || !svgHasLoaded) return
      if (curPresentation.currentView !== -1 || start !== 0 || curPresentation.isPlaying) return
      if (curPresentation.autoplayOnPublish && !isEditable) return
      goToView(0)
    }, [svgHasLoaded, curPresentation.currentView, curPresentation.viewpoints, curPresentation.isPlaying])

    // The presenter's own moves, for whoever follows them.
    const reportView = useRef(onViewChange)
    reportView.current = onViewChange
    useEffect(() => {
      if (svgHasLoaded && started.current) reportView.current?.(curPresentation.currentView)
    }, [svgHasLoaded, curPresentation.currentView])

    // A swipe across the presenter moves to the next or previous viewpoint.
    const touch = useRef(null)
    const onTouchStart = (event) => {
      const point = event.touches?.[0]
      touch.current = point ? { x: point.clientX, y: point.clientY } : null
    }
    const onTouchEnd = (event) => {
      const start = touch.current
      const point = event.changedTouches?.[0]
      touch.current = null
      if (!showControls || !start || !point) return
      const dx = point.clientX - start.x
      const dy = point.clientY - start.y
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return
      handleNavigate(dx < 0 ? 'next' : 'prev')
    }

    // Add resize observer to handle container size changes
    useEffect(() => {
      if (
        containerRef.current &&
        curPresentation.orientData &&
        !resizeObserver.current
      ) {
        // Initialize transform when component mounts
        setInitTransform()

        // Watch the presenter and its controls (they wrap on a phone and change with the plan's
        // status): the camera keeps what it frames in the room left.
        resizeObserver.current = new ResizeObserver(() => {
          initRef.current()
          controlledView.current?.()
        })

        resizeObserver.current.observe(containerRef.current)
        if (controlsRef.current) resizeObserver.current.observe(controlsRef.current)

        // Cleanup observer on unmount
        return () => {
          resizeObserver.current.disconnect()
          resizeObserver.current = null
        }
      }
    }, [containerRef, curPresentation.orientData])

    useEffect(() => {
      if (!curPresentation.isPlaying) {
        // If we're not playing, don't set up the timer
        return
      }

      if (!curPresentation.viewpoints[curPresentation.currentView]?.duration) {
        // If there's no duration for the current viewpoint, move to the first one
        setCurPresentation((prev) => ({ ...prev, currentView: 0 }))
        return
      }

      // Set up the timer for auto-progression

      const { duration } = curPresentation.viewpoints[curPresentation.currentView]

      const progressTimer = setTimeout(() => {
        if (
          curPresentation.currentView <
          curPresentation.viewpoints.length - 1
        ) {
          // Move to the next viewpoint
          handleNavigate('next')
        } else if (curPresentation.playOnHover || !showControls) {
          handleRestart()
        } else {
          setCurPresentation((prev) => ({ ...prev, isPlaying: false }))
        }
      }, duration)

      // Clean up the timer when the component unmounts or dependencies change
      return () => {
        clearTimeout(progressTimer)
      }
    }, [curPresentation, initialTransform])

    const handlePlayPause = () => {
      if (curPresentation.isPlaying) {
        // Just stop the auto-progression
        setCurPresentation((prev) => ({ ...prev, isPlaying: false }))
      } else if (
        curPresentation.currentView ===
        curPresentation.viewpoints.length - 1
      ) {
        // If we're at the end, restart, otherwise continue from current position
        startPresentation()
      } else {
        setCurPresentation((prev) => ({ ...prev, isPlaying: true }))
        // setShowNarrative(true)
        // Immediately progress to next viewpoint when resuming
        handleNavigate('next')
      }
    }

    // Clean up animations when component unmounts
    useEffect(
      () => () => {
        const currentNodeIds =
          curPresentation.viewpoints[curPresentation.currentView]?.nodeIds
        if (currentNodeIds?.length) {
          cleanupAnimations(currentNodeIds)
        }
      },
      [
        cleanupAnimations,
        curPresentation.currentView,
        curPresentation.viewpoints,
      ]
    )

    // Add keyboard navigation controls
    useEffect(() => {
      // Only add keyboard listeners if showControls is true
      if (!showControls) return

      const handleKeyDown = (e) => {
        // Skip if focus is on an input element
        if (
          e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable
        ) {
          return
        }

        switch (e.code) {
          case 'ArrowLeft':
          case 'PageUp':
            handleNavigate('prev')
            e.preventDefault()
            break
          case 'ArrowRight':
          case 'PageDown':
            handleNavigate('next')
            e.preventDefault()
            break
          case 'Space':
            handlePlayPause()
            e.preventDefault()
            break
          default:
            break
        }
      }

      // Add the event listener
      window.addEventListener('keydown', handleKeyDown)

      // Clean up the event listener when component unmounts
      return () => {
        window.removeEventListener('keydown', handleKeyDown)
      }
    }, [showControls, curPresentation, initialTransform])

    const styles = `
    .sb-presentation-camera {
      transition: transform 0.75s cubic-bezier(0.4, 0, 0.2, 1);
    }
    @media (prefers-reduced-motion: reduce) {
      .sb-presentation-camera { transition: none; }
      .sb-presentation-camera *, .footer-slide { animation: none !important; transition: none !important; }
    }
    @keyframes glowPulse {
      0% {
        filter: drop-shadow(0 0 3px rgba(255, 215, 0, 0.3));
      }
      50% {
        filter: drop-shadow(0 0 6px rgba(255, 215, 0, 0.8));
      }
      100% {
        filter: drop-shadow(0 0 3px rgba(255, 215, 0, 0.3));
      }
    }

    @keyframes iconGlowPulse {
      0% {
        background-color: rgba(255, 215, 0, 0.3);
      }
      50% {
        background-color: rgba(255, 215, 0, 0.7);
      }
      100% {
        background-color: rgba(255, 215, 0, 0.3);
      }
    }

    .viewpoint-border {
      stroke-dasharray: 5,5;
      stroke-width: 1;
      fill: none;
      pointer-events: none;
    }

    .viewpoint-settings {
      cursor: pointer;
      opacity: 0.7;
      transition: opacity 0.2s;
    }

    .viewpoint-settings:hover {
      opacity: 1;
    }

    .footer-slide {
      transition: transform 0.3s ease-in-out;
      transform: translateY(${showFooter ? '0' : '100%'});
    }
    
    /* Add global SVG optimization styles */
     /* Add hardware acceleration and smoothing for all transformations */
    svg {
      shape-rendering: geometricPrecision !important;
      text-rendering: optimizeLegibility !important;
      image-rendering: optimizeQuality !important;
      transform-origin: 0 0;
      backface-visibility: hidden;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
       -webkit-transform-style: preserve-3d;
      -webkit-backface-visibility: hidden;
      -webkit-perspective: 1000;
      -webkit-transform: translateZ(0);
      transform-style: preserve-3d;
      backface-visibility: hidden;
      perspective: 1000px;
    }
    
    svg path, svg rect, svg circle, svg ellipse, svg line, svg polyline, svg polygon {
      shape-rendering: geometricPrecision !important;
      paint-order: stroke fill markers;
    }
    
    svg text {
      text-rendering: optimizeLegibility !important;
      paint-order: stroke fill;
    }
    
    svg image {
      image-rendering: optimizeQuality !important;
    }
  `

    const narrative = curPresentation.viewpoints?.[curPresentation.currentView]?.narrative || ''
    const { step, total } = stepOf(curPresentation.currentView, curPresentation.viewpoints)

    return (
      <>
        <style>{styles}</style>
        {!isEditable && !curPresentation.isEmbedded && (
          <Box
            sx={{
              position: 'absolute',
              top: 10,
              left: 10,
              width: '50px',
              backgroundColor: 'background.paper',
              borderRadius: '4px',
              opacity: 0.9,
              zIndex: 10,
            }}
          >
            <Tooltip
              title={
                curPresentation.logoUrl ? '' : 'Slatebox - Visualize Everything'
              }
            >
              <a
                href="https://slatebox.com"
                target="_blank"
                alt="Slatebox - unlock your data's story"
                rel="noreferrer"
              >
                <img
                  src={curPresentation.logoUrl || '/images/sb_yellow_boxes.svg'}
                  alt="Slatebox - Visualize Everything"
                  style={{ width: '100%' }}
                />
              </a>
            </Tooltip>
          </Box>
        )}
        {/* Controls and Progress */}
        {showControls && (
          <Box
            ref={controlsRef}
            className="sb-presentation-controls"
            sx={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              margin: '0 auto',
              width: 'fit-content',
              maxWidth: '100%',
              boxSizing: 'border-box',
              zIndex: 10,
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              alignItems: 'center',
              gap: (theme) => theme.spacing(1),
              bgcolor:
                curPresentation?.presentationMenuBgColorKey || (chrome ? 'rgba(0,0,0,0.38)' : 'shell.main'),
              color: curPresentation?.presentationControlsColorKey || (chrome ? chrome.ink : ''),
              ...(chrome && { backdropFilter: 'blur(10px)', '& .MuiIconButton-root': { color: curPresentation?.presentationControlsColorKey || '#fff' } }),
              px: 1,
              pr: 1.5,
              pt: 1,
              pb: 0.5,
              borderTopLeftRadius: '12px',
              borderTopRightRadius: '12px',
              boxShadow: (theme) => theme.shadows[2],
              // A styled deck is full bleed: its controls are one small floating pill.
              ...(chrome && {
                bottom: { xs: 10, sm: 16 }, py: 0.5, pl: 0.75, pr: 0.75, gap: 0.5, flexWrap: 'nowrap', borderRadius: '999px',
                maxWidth: 'calc(100% - 20px)', boxShadow: 'none', '& .MuiIconButton-root': { color: curPresentation?.presentationControlsColorKey || '#fff', p: 1 },
              }),
            }}
          >
            {!svgHasLoaded || curPresentation.isAnalyzing ? (
              <>
                <CircularProgress size={48} />
                <Typography
                  variant="overline"
                  sx={{
                    color:
                      curPresentation?.presentationControlsColorKey ||
                      'common.white',
                  }}
                >
                  Updating...
                </Typography>
              </>
            ) : (
              <>
                {!isMobile && !chrome && (
                  <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
                    <Typography
                      variant="h6"
                      sx={{
                        color:
                          curPresentation?.presentationControlsColorKey ||
                          'common.white',
                      }}
                    >
                      {curPresentation.presentationName}
                    </Typography>
                  </Box>
                )}

                {/* Play/Pause Button */}
                <Tooltip
                  title={
                    !curPresentation.isPlaying
                      ? 'Play presentation'
                      : 'Pause presentation'
                  }
                >
                  <Button
                    onClick={handlePlayPause}
                    variant="contained"
                    sx={{
                      minWidth: 'auto',
                      width: chrome ? 40 : 48,
                      height: chrome ? 40 : 48,
                      borderRadius: '50%',
                      p: 0,
                      bgcolor:
                        curPresentation?.presentationControlsColorKey ||
                        'primary.main',
                      color: curPresentation?.presentationMenuBgColorKey || '',
                      '&:hover': {
                        bgcolor:
                          curPresentation?.presentationControlsColorKey ||
                          'primary.main',
                        opacity: 0.8,
                      },
                    }}
                  >
                    {!curPresentation.isPlaying ? (
                      <PlayArrowIcon />
                    ) : (
                      <PauseIcon />
                    )}
                  </Button>
                </Tooltip>

                {/* Navigation Controls - Only show when not playing */}
                {!curPresentation.isPlaying && (
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    {curPresentation.currentView === 0 ? (
                      <Tooltip title="Restart">
                        <IconButton
                          aria-label="Restart"
                          onClick={handleRestart}
                          sx={{
                            color:
                              curPresentation?.presentationControlsColorKey ||
                              '#fff',
                          }}
                        >
                          <ReplayIcon />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <Tooltip title="Previous">
                        <span>
                          <IconButton
                            aria-label="Previous"
                            onClick={() => handleNavigate('prev')}
                            disabled={curPresentation.currentView === 0}
                            sx={{
                              color:
                                curPresentation?.presentationControlsColorKey ||
                                '#fff',
                            }}
                          >
                            <NavigateBeforeIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}

                    {curPresentation.currentView > 0 &&
                    curPresentation.currentView ===
                      curPresentation.viewpoints.length - 1 ? (
                      <Tooltip title="Restart">
                        <IconButton
                          aria-label="Restart"
                          onClick={handleRestart}
                          sx={{
                            color:
                              curPresentation?.presentationControlsColorKey ||
                              '#fff',
                          }}
                        >
                          <ReplayIcon />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <Tooltip title="Next">
                        <span>
                          <IconButton
                            aria-label="Next"
                            onClick={() => handleNavigate('next')}
                            disabled={
                              curPresentation.currentView ===
                              curPresentation.viewpoints.length - 1
                            }
                            sx={{
                              color:
                                curPresentation?.presentationControlsColorKey ||
                                '#fff',
                            }}
                          >
                            <NavigateNextIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </Box>
                )}

                {renderCustomControls?.()}

                {/* Progress indicator: only when there are steps to take ("0 / 0" reads as broken). */}
                {total > 0 && (
                <Tooltip title="Presentation steps">
                  <Box
                    sx={{
                      width: chrome ? 'auto' : 56,
                      minWidth: chrome ? 52 : undefined,
                      px: chrome ? 1.25 : 0,
                      height: chrome ? 32 : 56,
                      fontSize: chrome ? 13 : undefined,
                      fontWeight: chrome ? 700 : undefined,
                      borderRadius: chrome ? '999px' : '50%',
                      bgcolor:
                        curPresentation?.presentationControlsColorKey ||
                        'common.white',
                      color:
                        curPresentation?.presentationMenuBgColorKey || '#000',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {step} / {total}
                  </Box>
                </Tooltip>
                )}

                {!isEditable && !isMobile && (
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <a
                      href={baseUrl}
                      style={{
                        color:
                          curPresentation?.presentationControlsColorKey ||
                          '#fff',
                      }}
                    >
                      {Meteor.user() ? (
                        <>Your dashboard &rarr;</>
                      ) : (
                        <>Create your own &rarr;</>
                      )}
                    </a>
                  </Box>
                )}
              </>
            )}
          </Box>
        )}

        {/* The live canvas (a styled deck) or the SVG container */}
        <div
          ref={containerRef}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            // A swipe steps the presentation; two fingers still zoom the page.
            touchAction: showControls ? 'pinch-zoom' : undefined,
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          {isLive ? (
            <LiveStage
              ref={liveRef}
              deck={liveDeck}
              slateJSON={curPresentation.slateJSON}
              name={curPresentation.presentationName}
              onReady={() => setSVGHasLoaded(true)}
              bottomInset={showControls ? controlsHeight : 0}
              onTap={() => { if (showControls) handleNavigate('next') }}
            />
          ) : (
          <div
            className="sb-presentation-camera"
            dangerouslySetInnerHTML={{ __html: curPresentation.slateSVG }}
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              transformOrigin: '0 0',
              transform: `${transform}`,
            }}
          />
          )}
        </div>
        {/* What changed, for a screen reader: the step and its narrative (a live deck says its own,
            with the notes it lights). */}
        {/* 1px, in px: MUI reads width: 1 as 100%, which parked a whole screen of hidden box below the stage. */}
        <Box aria-live={isLive ? 'off' : 'polite'} aria-hidden={isLive || undefined} sx={{ position: 'absolute', top: 0, left: 0, width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
          {curPresentation.currentView >= 0 && curPresentation.viewpoints?.length
            ? (total > 0 ? `${step} of ${total}${narrative ? ': ' + narrative : ''}` : narrative) : ''}
        </Box>
        {/* The viewpoint's narrative, over the top of the presenter, on every screen size. */}
        {!isLive && curPresentation.showNarrative && narrative && (
          <Box
            ref={narrativeRef}
            sx={{
              position: 'absolute',
              top: { xs: 8, sm: 12 },
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'min(900px, calc(100% - 24px))',
              boxSizing: 'border-box',
              pointerEvents: 'none',
              bgcolor: 'background.paper',
              opacity: 0.92,
              p: curPresentation.isEmbedded && !isEditable ? '5px' : { xs: 1, sm: 1.5 },
              zIndex: 9,
              borderRadius: 2,
              boxShadow: 3,
            }}
          >
            <Typography
              variant="h4"
              align="center"
              className="sb-presentation-narrative"
              sx={{
                fontWeight: 500,
                color: 'text.primary',
                fontSize: 'clamp(16px, 2vw, 32px)',
              }}
            >
              {narrative}
            </Typography>
          </Box>
        )}
      </>
    )
  }
)

BasePresent.propTypes = {
  onViewChange: PropTypes.func,
  startAt: PropTypes.number,
  holdAtStart: PropTypes.bool,
  refMethods: PropTypes.object,
  renderCustomControls: PropTypes.func,
  containerRef: PropTypes.object.isRequired,
  showFooter: PropTypes.bool,
  showControls: PropTypes.bool,
  viewIndex: PropTypes.number,
  isEditable: PropTypes.bool,
}

export default BasePresent
