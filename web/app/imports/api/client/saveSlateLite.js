/* eslint-disable no-inner-declarations */
/* eslint-disable no-undef */
import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../common/constants'
import promisify from './promisify'
import { saveBaseOf, savePatch } from '../common/slate-save-patch.mjs'

// The slate as a save sends it: what the engine exports, with where its workshop sits.
export function exportForSave(slate) {
  const exportedSlate = JSON.parse(slate.exportJSON())
  exportedSlate.shareId ||= slate.shareId
  if (slate.workshopOrigin) exportedSlate.options.workshopOrigin = slate.workshopOrigin
  return exportedSlate
}

// What this page knows the server holds (slate-save-patch.mjs): set when the slate is drawn from the
// server, and after each save this page makes. Its saves send what changed since.
export function rememberSaveBase(slate, exportedSlate = exportForSave(slate)) {
  slate.saveBase = saveBaseOf(exportedSlate)
}

const saveSlateLite = async ({
  userId,
  orgId,
  slate,
  guestCollaboratorId,
  routeKey,
  hasLocalEdit,
  keepProof,
}) => {
  // A note and a card trading places is shown at once but is real only once the server has
  // taken it (creativeSlates.play saves its board and drawing together). Until then the drawing
  // is not stored with it: closed first or refused, the stored slate never had a half trade.
  const engine = slate.v2 ?? slate
  await engine.whenHeldSettled?.()
  const exportedSlate = exportForSave(slate)
  // if (slate.userId !== userId) {
  //   ;['isPrivate', 'isPublic', 'isUnlisted', 'isUnlisted'].forEach(
  //     (o) => delete exportedSlate.options[o]
  //   )
  // }
  // The server builds the search fields when it saves (server/slate-search-fields.mjs).
  // Don't overwrite the exportedSlate userId created and those that modify it
  // the only time a userId is passed is when the slate is created
  if (userId) {
    exportedSlate.userId = userId
  }

  // if this is an AI interactive exportedSlate and the user touches a node to position it,
  // inhibit the AI from rerunning a layout on the node
  // if (type === 'onNodesMove') {
  //   uopts.pkg.data.nodeOptions.forEach((n) => {
  //     const nodeMoving = exportedSlate.nodes.find((nx) => nx.options.id === n.id)
  //     nodeMoving.options.humanTouch = true
  //   })
  // }

  if (orgId) {
    exportedSlate.orgId = orgId
  } else if (Meteor.user()?.orgId) {
    exportedSlate.orgId = Meteor.user().orgId
  }

  // What this page changed since it last knew what the server held. A page that is behind (its relay
  // dropped) then changes only its own edits. The whole slate still goes too, for a server of the
  // previous release during a deploy.
  const patch = slate.saveBase ? savePatch(slate.saveBase, exportedSlate) : null
  const result = await Meteor.callAsync(CONSTANTS.methods.slates.update, {
    slate: exportedSlate,
    ...(patch && { patch }),
    nativeConversationRevision: slate.nativeConversationRevision ?? 0,
    // The workshop revision this screen draws every note and card trade through (see native-slate-save).
    ...(typeof engine.tradesThrough === 'function' && { tradesThrough: engine.tradesThrough() }),
    guestCollaboratorId,
    ...(routeKey && { routeKey }),
    ...(hasLocalEdit && { hasLocalEdit: true }),
    ...(keepProof && { keepProof }),
  })
  rememberSaveBase(slate, exportedSlate)

  return keepProof ? result : true
}

export default saveSlateLite
