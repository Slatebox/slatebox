import React, { useEffect, useRef, useState } from 'react'
import Typography from '@mui/material/Typography'
import { useSetAtom } from 'jotai'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import BasePresent from './BasePresent'
import prepareSlateSurface from './prepareSlateSurface'
import { reconcileViewpoints } from './buildFallbackPresentation.mjs'
import { workshopScenes } from './workshopScenes.mjs'
import { currentPresentation } from '../../jotai/atoms'
import { isBakedDeck, playableDeck } from './presentationBake.mjs'
import MadeWithSlatebox from '../MadeWithSlatebox'
import { showMadeWith } from '../../../api/common/made-with.mjs'

/**
 * Following a live presentation: the presenter's sequence (`deck`), played over this person's own
 * drawing of the same slate, at the viewpoint the presenter is on (`step`; -1 is the whole slate).
 * The follower does not steer: no controls, keys or swipes.
 */
export default function FollowPresentation({ slate, deck, step, workshop }) {
  const containerRef = useRef(null)
  const setPresentation = useSetAtom(currentPresentation)
  const [failed, setFailed] = useState(false)
  // "Made with Slatebox" (made-with.mjs) for a follower from outside the slate's team; not for its owner or team.
  const viewer = useTracker(() => ({ userId: Meteor.userId(), orgId: Meteor.user()?.orgId ?? null, loading: Boolean(Meteor.userId() && !Meteor.user()) }))
  const madeWith = showMadeWith({
    surface: 'follow', loading: viewer.loading,
    isOwner: Boolean(viewer.userId && viewer.userId === slate?.userId),
    sameTeam: Boolean(viewer.orgId && viewer.orgId === slate?.orgId),
  })
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
      // A deck with a look plays on a live canvas over this person's copy of the slate, as the
      // presenter's does: a worn style is on the slate itself; the player draws nothing of its own.
      const looks = isBakedDeck(deck.deck) || Boolean(deck.direction?.steps)
      let copy = null
      try { copy = looks ? slate.exportJSON?.() : null } catch { copy = null }
      let styled = null
      if (copy) {
        try { styled = playableDeck({ deck: deck.deck, viewpoints: deck.viewpoints, slateJSON: copy }) } catch { styled = null }
      }
      setPresentation(previous => ({
        ...previous,
        isAnalyzing: false, isPlaying: false, currentView: -1,
        autoplayOnPublish: false, isEmbedded: false, playOnHover: false, showNarrative: true,
        slateSVG: surface.svg, orientData: surface.orient, presentationData: surface.layout,
        presentationName: deck.name,
        slateJSON: copy,
        deckLook: styled && copy ? { deck: styled } : null,
        // The deck as the presenter plays it; cards that moved since are framed where they are now.
        viewpoints: styled && copy ? styled.steps : reconcileViewpoints(deck.viewpoints, surface.layout, scenes, { keep: true }),
      }))
    }, () => { if (active) setFailed(true) })
    return () => {
      active = false
      setPresentation(previous => ({ ...previous, slateSVG: null, slateJSON: null, deckLook: null, orientData: null, presentationData: null, viewpoints: [], currentView: -1 }))
    }
  }, [slate, deck])

  if (failed) return <Typography role="alert" sx={{ p: 3 }}>This slate could not be drawn for the presentation. Leave and follow again.</Typography>
  return <>
    <BasePresent containerRef={containerRef} viewIndex={step} showControls={false} isEditable />
    <MadeWithSlatebox surface="follow" show={madeWith} placement="bottom-right" tone="dark" zIndex={11} />
  </>
}
