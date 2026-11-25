/* eslint-disable prefer-destructuring */
/* eslint-disable one-var */
/* eslint-disable no-nested-ternary */
/* eslint-disable react/no-array-index-key */
/* eslint-disable consistent-return */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-restricted-syntax */
import React, { useState, useEffect, useRef } from 'react'
import useCanvasTheme from '../common/useCanvasTheme'
import { Meteor } from 'meteor/meteor'
import ReplayIcon from '@mui/icons-material/Replay'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import Link from '@mui/material/Link'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import BasePresent from './presentations/BasePresent'
import CONSTANTS from '../../api/common/constants'
import { currentPresentation, isMobileOrTouchDevice } from '../jotai/atoms'
import { isBakedDeck, playableDeck } from './presentations/presentationBake.mjs'

// A published deck with a look plays on a live canvas: the camera over the slate copy it was
// published with. A worn style is on that slate (deck version 5); an older look plays the slate as
// drawn (the player draws nothing of its own). → { deck, background } or null.
function publishedLook(row) {
  if (!row?.slateJSON || !(isBakedDeck(row.deck) || row.direction?.steps)) return null
  try {
    const deck = playableDeck({ deck: row.deck, viewpoints: row.viewpoints, slateJSON: row.slateJSON })
    const slate = typeof row.slateJSON === 'string' ? JSON.parse(row.slateJSON) : row.slateJSON
    return deck ? { deck, background: slate?.options?.containerStyle?.backgroundColor || null } : null
  } catch {
    return null
  }
}

export default function PresentPublishedSlate({ slateShareId, surfaceId = 'presentMain' }) {
  const refMethods = useRef(null)
  const containerRef = useRef(null)
  const [curPresentation, setCurPresentation] = useAtom(currentPresentation)
  const [showFooter, setShowFooter] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  // The published slate's background, as it was published: one nobody chose follows the viewer's
  // mode, as the slate's own canvas does (canvasTheme.mjs). A styled deck keeps its style's backdrop
  // and ink in both modes: no theming.
  const [published, setPublished] = useState(null)
  useCanvasTheme(() => (published && !published.styled ? document.getElementById(surfaceId) : null), () => published?.background, [published, surfaceId])
  const [, baseUrl] = useState(Meteor.settings.public.baseUrl)

  const mobileOrTouch =
    /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ipad|iphone|ipod|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series40|symbian|treo|up\.browser|up\.link|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(
      navigator.userAgent
    ) || 'ontouchend' in document

  useEffect(() => {
    let active = true
    setUnavailable(false)
    async function fetchPresentations() {
      const startTime = Date.now()
      const pinned = await Meteor.callAsync(
        CONSTANTS.methods.presentations.get,
        {
          slateShareId,
          asPublished: true,
        }
      )
      console.log('ms taken to fetch presentation', Date.now() - startTime)
      if (!active) return
      const pinnedPrezi = pinned?.presentation
      // Only a deck (its viewpoints and the drawing or the slate they frame) can be played.
      const styled = publishedLook(pinnedPrezi)
      if (!Array.isArray(pinnedPrezi?.viewpoints) || (!pinnedPrezi.svg && !styled)) { setUnavailable(true); return }
      // set the background color of the Container to match the background color of the slate
      let bg = pinnedPrezi.background || '#19241e'
      if (mobileOrTouch && bg.match(/linear-|radial-/)) {
        const parts = pinnedPrezi.background.split('(')
        if (parts.length > 1) {
          const innerParts = parts[1].split(',')
          if (innerParts.length > 0) {
            const middleIndex = Math.floor(innerParts.length / 2)
            bg = innerParts[middleIndex]
          }
        }
      }
      // A deck on a live canvas sits on its slate's own background (read from the slate).
      document.getElementById(surfaceId).style.background = styled ? styled.background || bg : bg
      setPublished({ background: pinnedPrezi.background, styled: Boolean(styled) })

      console.log(
        'got control controls',
        pinned.presentationMenuBgColorKey,
        pinned.presentationControlsColorKey
      )

      setCurPresentation((prev) => ({
        ...prev,
        isAnalyzing: false,
        slateSVG: pinnedPrezi.svg,
        orientData: pinnedPrezi.orientData,
        presentationData: pinnedPrezi.presentationData,
        presentationName: pinnedPrezi.name,
        slateJSON: styled ? pinnedPrezi.slateJSON : null,
        deckLook: styled ? { deck: styled.deck } : null,
        viewpoints: styled ? styled.deck.steps : pinnedPrezi.viewpoints,
        autoplayOnPublish: pinnedPrezi.autoplayOnPublish ?? false,
        isEmbedded: pinnedPrezi.isEmbedded ?? false,
        showControls: !pinnedPrezi.isEmbedded,
        playOnHover: pinnedPrezi.playOnHover ?? false,
        isPublic: pinnedPrezi.isPublic ?? false,
        // The deck's own setting: a dynamic deck saved without narrative stays without it.
        showNarrative: pinnedPrezi.showNarrative ?? false,
        presentationMenuBgColorKey: pinned.presentationMenuBgColorKey,
        presentationControlsColorKey: pinned.presentationControlsColorKey,
        logoUrl: pinned.logoUrl,
      }))
    }
    fetchPresentations().catch(() => { if (active) setUnavailable(true) })
    return () => { active = false }
  }, [slateShareId, surfaceId])

  // Function to handle mouse enter (hover start)
  const handleMouseEnter = () => {
    if (!curPresentation.playOnHover) {
      setShowFooter(true)
    }

    if (curPresentation.playOnHover) {
      setCurPresentation((prev) => ({
        ...prev,
        isPlaying: true,
        currentView: prev.currentView + 1,
      }))
      // console.log('going next', curPresentation.currentView)
      refMethods.current.handleNavigate('next')
    }
  }

  // Function to handle mouse leave (hover end)
  const handleMouseLeave = () => {
    if (!curPresentation.playOnHover) {
      setShowFooter(false)
    }
    // Apply dimming when mouse leaves and playOnHover is set
    if (curPresentation.playOnHover) {
      // Reset the transform to show the entire SVG
      // refMethods.current.setInitTransform()

      // stop playing
      setCurPresentation((prev) => ({
        ...prev,
        isPlaying: false,
      }))
    }
  }

  if (unavailable) return <Box sx={{ mx: 'auto', mt: '18vh', maxWidth: 480 }}>
    <Typography variant="h4" component="h1">Presentation unavailable</Typography>
    <Typography sx={{ mt: 1 }}>Ask the presenter for a published presentation link.</Typography>
  </Box>

  return (
    <>
      {curPresentation.autoplayOnPublish && (
        <>
          {!curPresentation.isEmbedded && (
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                margin: '0 auto',
                width: 'fit-content',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                gap: (theme) => theme.spacing(2), // Add gap between elements
                backgroundColor: 'white',
                paddingRight: (theme) => theme.spacing(3),
                paddingLeft: (theme) => theme.spacing(3),
                paddingTop: (theme) => theme.spacing(0.5),
                paddingBottom: (theme) => theme.spacing(0.5),
                borderBottomLeftRadius: '12px',
                borderBottomRightRadius: '12px',
                boxShadow: (theme) => theme.shadows[2],
              }}
            >
              <Button
                href="https://app.slatebox.com"
                target="_blank"
                color="secondary"
                variant="outlined"
                rel="noopener noreferrer"
                size="small"
                sx={{
                  color: '#666',
                  fontSize: '0.8rem',
                  minWidth: 'auto',
                  padding: '4px 8px',
                  textTransform: 'none',
                  '&:hover': {
                    color: '#000',
                    backgroundColor: 'rgba(0, 0, 0, 0.04)',
                  },
                }}
              >
                {Meteor.user() ? 'Dashboard →' : 'Create your own →'}
              </Button>
              <Typography
                variant="h6"
                sx={{
                  color: '#000',
                  fontSize: '1.2rem',
                  fontWeight: 500,
                }}
              >
                {curPresentation.currentView + 1} /{' '}
                {curPresentation.viewpoints.length}
              </Typography>
              {curPresentation.currentView ===
                curPresentation.viewpoints.length - 1 && (
                <Tooltip title="Restart">
                  <IconButton
                    sx={{
                      marginLeft: (theme) => theme.spacing(1),
                      height: '13px',
                      width: '13px',
                    }}
                    onClick={() => {
                      refMethods.current.handleRestart()
                    }}
                    color="primary"
                  >
                    <ReplayIcon />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )}
          {/* Existing footer code */}
          <Box
            sx={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              overflow: 'hidden',
              height: '1000px',
              zIndex: 9,
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />
          <Box
            className="footer-slide"
            sx={{
              position: 'absolute',
              bottom: -2,
              left: 0,
              right: 0,
              margin: '0 auto',
              width: 'fit-content',
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              gap: (theme) => theme.spacing(1),
              backgroundColor: 'white',
              paddingRight: (theme) => theme.spacing(2),
              paddingLeft: (theme) => theme.spacing(2),
              paddingTop: (theme) => theme.spacing(0.1),
              paddingBottom: (theme) => theme.spacing(0.1),
              borderTopLeftRadius: '12px',
              borderTopRightRadius: '12px',
              boxShadow: (theme) => theme.shadows[2],
            }}
            onMouseEnter={() => setShowFooter(true)}
            onMouseLeave={() => setShowFooter(false)}
          >
            <Typography variant="caption" sx={{ color: '#000' }}>
              Built with <Link href="https://slatebox.com">Slatebox</Link>
            </Typography>
            {curPresentation.currentView ===
              curPresentation.viewpoints.length - 1 && (
              <Tooltip title="Restart">
                <IconButton
                  sx={{
                    height: '13px',
                    width: '13px',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    refMethods.current.handleRestart()
                  }}
                  color="primary"
                >
                  <ReplayIcon />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </>
      )}
      <BasePresent
        ref={refMethods}
        containerRef={containerRef}
        baseUrl={baseUrl}
        showFooter={showFooter}
        presentationMenuBgColorKey={curPresentation.presentationMenuBgColorKey}
        presentationControlsColorKey={
          curPresentation.presentationControlsColorKey
        }
        showControls={!curPresentation.autoplayOnPublish}
      />
    </>
  )
}
