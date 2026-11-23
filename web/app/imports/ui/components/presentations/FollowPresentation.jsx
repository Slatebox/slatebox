import React, { useEffect, useRef, useState } from 'react'
import Typography from '@mui/material/Typography'
import { useSetAtom } from 'jotai'
import BasePresent from './BasePresent'
import prepareSlateSurface from './prepareSlateSurface'
import { reconcileViewpoints } from './buildFallbackPresentation.mjs'
import { workshopScenes } from './workshopScenes.mjs'
import { currentPresentation } from '../../jotai/atoms'

/**
 * Following a live presentation: the presenter's sequence (`deck`), played over this person's own
 * drawing of the same slate, at the viewpoint the presenter is on (`step`; -1 is the whole slate).
 * The follower does not steer: no controls, keys or swipes.
 */
export default function FollowPresentation({ slate, deck, step, workshop }) {
  const containerRef = useRef(null)
  const setPresentation = useSetAtom(currentPresentation)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    // The lanes the presenter's deck frames are drawn before this drawing is taken.
    const lanes = [...new Set(deck.viewpoints.flatMap(point => point.nodeIds).filter(id => id.startsWith('lane-')))]
    prepareSlateSurface(slate, { drawn: lanes }).then(surface => {
      const scenes = workshopScenes(workshop)
      if (!active) return
      if (surface.backgroundImage && containerRef.current) {
        containerRef.current.style.backgroundImage = `url(${surface.backgroundImage})`
        containerRef.current.style.backgroundSize = 'cover'
      }
      setPresentation(previous => ({
        ...previous,
        isAnalyzing: false, isPlaying: false, currentView: -1,
        autoplayOnPublish: false, isEmbedded: false, playOnHover: false, isFeatured: false, showNarrative: true,
        slateSVG: surface.svg, orientData: surface.orient, presentationData: surface.layout,
        presentationName: deck.name,
        // The deck as the presenter plays it; cards that moved since are framed where they are now.
        viewpoints: reconcileViewpoints(deck.viewpoints, surface.layout, scenes, { keep: true }),
      }))
    }, () => { if (active) setFailed(true) })
    return () => {
      active = false
      setPresentation(previous => ({ ...previous, slateSVG: null, orientData: null, presentationData: null, viewpoints: [], currentView: -1 }))
    }
  }, [slate, deck])

  if (failed) return <Typography role="alert" sx={{ p: 3 }}>This slate could not be drawn for the presentation. Leave and follow again.</Typography>
  return <BasePresent containerRef={containerRef} viewIndex={step} showControls={false} isEditable />
}
