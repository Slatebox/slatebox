import React, { useEffect } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useParams } from 'react-router-dom'
import { useTracker } from 'meteor/react-meteor-data'
import PresentSlate from './PresentSlate'
import PresenterFrame from './presentations/PresenterFrame'
import { CreativeStates } from '../../api/client/creativeSlateStates'
import { canManageSlate, currentPresentation, isPresentOpen, slateBackgroundColorAtom } from '../jotai/atoms'
import { presentedBoards } from './presentations/workshopScenes.mjs'

// Present on this screen: the presenter, full screen, for every slate drawn on the canvas. Someone
// who may edit the slate gets its saved (or AI-planned) presentation with the controls to refine,
// edit and publish it; anyone else plays its published presentation.
export default function PresentSlateDialogue({ slate }) {
  const [presentOpen, setPresentOpen] = useAtom(isPresentOpen)
  const background = useAtomValue(slateBackgroundColorAtom)
  const canAuthor = Boolean(useAtomValue(canManageSlate))
  // A styled deck fills the screen: the frame's bar floats over its corner.
  const immersive = Boolean(useAtomValue(currentPresentation)?.deckLook)
  const { id } = useParams()
  // A slate's workshop, as the canvas page has subscribed to it: its lanes open the presentation.
  // On a slate of many boards, every board's lanes do, board by board.
  const workshop = useTracker(() => {
    if (!presentOpen || slate.creativeKind !== 'workshop') return null
    const main = CreativeStates.findOne(id, { fields: { model: 1 } })
    const further = CreativeStates.find({ shareId: id, boardId: { $ne: 'main' } }, { fields: { boardId: 1, model: 1 } }).fetch()
    return presentedBoards(main, further)
  }, [presentOpen, id, slate])
  // The presenter belongs to the slate it was opened on: leaving the slate (Back, another slate)
  // closes it, so it never opens by itself on the next one.
  useEffect(() => () => setPresentOpen(false), [id, slate])

  return <PresenterFrame open={presentOpen} title={slate.options.name} background={background} immersive={immersive}
    onExit={() => setPresentOpen(false)}>
    {presentOpen && <PresentSlate slate={slate} canAuthor={canAuthor} workshop={workshop} />}
  </PresenterFrame>
}
