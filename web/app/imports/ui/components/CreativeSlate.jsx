import React, { useRef, useState } from 'react'
import { CreativeStates } from '../../api/client/creativeSlateStates'
import { Meteor } from 'meteor/meteor'
import createAnonymousUser from '../../api/client/createAnonymousUser'
import { useTracker } from 'meteor/react-meteor-data'
import { ListeningRoomBoard } from 'slateboxjs/workshops'
import { Box, Button, Typography } from '@mui/material'
import { creativeSlates } from '../../api/common/creativeSlates.mjs'

import SceneConversation from './SceneConversation'
import MoonGallerySlate from './MoonGallerySlate'
import DarkroomSlate from './DarkroomSlate'
import OfflineHandoffSlate from './OfflineHandoffSlate'

// The boards that fill the page themselves. A workshop is drawn on the slate's own canvas (Canvas.jsx).
const boards = new Map([
  ['listening-room', ListeningRoomBoard],
  ['moon-gallery', MoonGallerySlate],
  ['focus-darkroom', DarkroomSlate],
  ['offline-handoff', OfflineHandoffSlate],
])

export default function CreativeSlate({ shareId, readOnly = false, guestAdmitted = false, onExitPresentation }) {
  const { state, ready } = useTracker(() => {
    const subscription = Meteor.subscribe('creativeSlates.state', shareId)
    return { state: CreativeStates.findOne(shareId), ready: subscription.ready() }
  }, [shareId])
  const pending = useRef(false)
  const joining = useRef(false)
  const [startingGuest, setStartingGuest] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [scenePreview,setScenePreview] = useState(null)
  const [selectedPrint,setSelectedPrint] = useState(null)
  const [undo, setUndo] = useState(null)
  const model = state?.model
  const config = creativeSlates.get(model?.kind)
  const Board = boards.get(model?.kind)
  const editable = Boolean(state?.canEdit && !readOnly)

  async function joinToEdit() {
    if (joining.current || readOnly || !guestAdmitted || !state?.canJoin || Meteor.userId() || Meteor.loggingIn()) return
    joining.current = true
    setStartingGuest(true)
    setError('')
    try {
      // The subscription reruns as this guest and all writes still check the current grant.
      await createAnonymousUser({ creativeEditLink: shareId })
    } catch {
      setError('Could not join this slate. Reopen the link to check your access.')
    } finally {
      joining.current = false
      setStartingGuest(false)
    }
  }

  async function save(next, revision = state?.revision, undoing = false) {
    if (!editable || pending.current) return false
    pending.current = true
    setSaving(true)
    setError('')
    try {
      const committedRevision = await Meteor.callAsync('creativeSlates.save', shareId, revision, next)
      setUndo(undoing ? null : { shareId, revision: committedRevision, previous: model })
      return true
    } catch (err) {
      setError(err.reason || 'Could not save this change.')
      return false
    } finally { pending.current = false; setSaving(false) }
  }

  if (!Board) return <Typography role="status" sx={{ p: 3 }}>{ready ? 'This slate is unavailable.' : 'Opening your slate…'}</Typography>
  const currentPreview = editable && !onExitPresentation && scenePreview?.shareId===shareId ? scenePreview : null
  return <Box component="section" aria-label={config.title} data-creative-revision={state.revision}
    sx={{ width:'100%', maxWidth:1200, mx:'auto', p:{xs:1.5,md:4} }}>
    {state.canJoin && guestAdmitted && !readOnly && <Box sx={{ mb: 2 }}>
      <Button variant="contained" disabled={startingGuest} onClick={joinToEdit}>
        {startingGuest ? 'Joining…' : 'Join to edit'}
      </Button>
      <Typography variant="body2" sx={{ mt: 0.5 }}>Join as a guest to save changes to this shared slate.</Typography>
    </Box>}
    {!editable && !state.canJoin && !readOnly && <Typography variant="body2" sx={{ mb: 1 }}>View only</Typography>}
    <Board onEditPrint={field=>setSelectedPrint({shareId,field})}
      value={currentPreview && currentPreview.revision===state.revision ? currentPreview.model : model} readOnly={!editable || saving || Boolean(currentPreview)} revision={state.revision} onChange={(next, baseRevision) => save(next, baseRevision)} onExitPresentation={onExitPresentation} />
    {editable && !onExitPresentation && <SceneConversation key={shareId + ':' + (selectedPrint?.shareId===shareId ? selectedPrint.field : '')}
      model={model} config={config} revision={state.revision} saving={saving} preview={currentPreview}
      setPreview={proposal=>setScenePreview(proposal ? {...proposal,shareId} : null)}
      selected={selectedPrint?.shareId===shareId ? selectedPrint.field : null} onClear={()=>setSelectedPrint(null)} save={save}/>}
    {editable && undo?.shareId === shareId && undo.revision === state.revision &&
      <Button size="small" disabled={saving} onClick={() => save(undo.previous, undo.revision, true)}>
        Undo last change
      </Button>}
    {saving && <Typography variant="body2" role="status">Saving…</Typography>}
    {error && <Typography color="error" role="alert">{error}</Typography>}
    {readOnly && <Typography variant="body2" sx={{ mt: 1 }}>{config.describe(model)}</Typography>}
  </Box>
}
