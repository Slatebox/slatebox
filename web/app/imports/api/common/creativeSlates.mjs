import { nativeSlateFromBrief, readCreationBrief } from './native-diagram-brief.mjs'
import { createBudgetWorkshop, listeningRoom, normalizeListeningRoom } from 'slateboxjs/workshops/model'

import { incidentTimeline, maxIncidentFragmentLength, readIncidentFragment } from './incident-timeline.mjs'
import signInOutage from './sign-in-outage.mjs'
import { maxNativeNotesFragmentLength, readNativeNotesFragment } from './native-notes-fragment.mjs'
import customerFile from './customer-file.mjs'
import riverExhibition from './river-exhibition.mjs'
import { portableWorkshopSlate } from './portableWorkshopSlate.mjs'
import { moonGallerySlate } from './moonGallerySlate.mjs'
import { darkroomSlate } from './darkroomSlate.mjs'
import { offlineHandoffSlate } from './offlineHandoffSlate.mjs'

const listening = {
  kind: 'listening-room',
  title: 'Listening room',
  labels: [{ field: 'leftLabel', caption: 'Left recording', maxLength: 80 }, { field: 'rightLabel', caption: 'Right recording', maxLength: 80 }],
  initial(query) {
    const value = query.get('mix')
    const mix = value?.trim() && Number(value)
    return normalizeListeningRoom({ ...listeningRoom, mix: Number.isFinite(mix) && mix >= 0 && mix <= 1 ? mix : listeningRoom.mix })
  },
  normalize: normalizeListeningRoom,
  describe(model) {
    const right = Math.round(100 * model.mix)
    return model.leftLabel + ' ' + (100 - right) + '% · ' + model.rightLabel + ' ' + right + '%'
  },
}

export const nativeSlateStarters = new Map([
  ['diagram', {source:{options:{name:'Diagram'}}, maxLength:16000, readFragment(hash) {
    const {brief,source,play} = readCreationBrief(hash)
    if (play) throw new Error('Open this brief as an interactive slate.')
    if (source === 'pilot-budget') {
      const model = portableWorkshopSlate.normalize({ kind: 'workshop', version: 1, workshop: createBudgetWorkshop() })
      return {
        options: { name: model.workshop.title, description: portableWorkshopSlate.describe(model), creationBrief: brief, briefSource: source },
        nodes: [], creative: { model, revision: 0 },
      }
    }
    return nativeSlateFromBrief(brief, source)
  }}],
  ['sign-in-outage', { source: signInOutage, readFragment: fragment => readNativeNotesFragment(signInOutage, fragment), maxLength: maxNativeNotesFragmentLength }],
  ['customer-file', { source: customerFile }],
  ['river-exhibition', { source: riverExhibition }],
  ['incident-timeline', { source: incidentTimeline, readFragment: readIncidentFragment, maxLength: maxIncidentFragmentLength }],
])

export const creativeSlates = new Map([listening, moonGallerySlate, darkroomSlate, offlineHandoffSlate, portableWorkshopSlate].map(config => [config.kind, config]))

// The first darkroom package stored authored prints and their return path without a kind.
export function readCreativeState(state) {
  if (!state?.model || Object.hasOwn(state.model, 'kind')) return state
  try {
    const model = darkroomSlate.normalize(state.model)
    return model?.kind === darkroomSlate.kind ? { ...state, model } : state
  } catch { return state }
}
