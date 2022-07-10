/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import { Collaborators } from '../../imports/api/common/models'

// start heartbeat to know who is collaborating
Meteor.startup(() => {
  let responses = []

  // Collaborators.find({}).observe({
  //   added(doc) {
  //     responses.push(doc._id)
  //   },
  //   changed(doc) {
  //     console.log('client set heartbeat back to true', doc.heartbeat)
  //     responses.push(doc._id)
  //   },
  //   removed(doc) {
  //     console.log('collaborator has dropped!', doc._id, doc.slateId)

  //     // async function reconcileVideoParticipants() {
  //     //   let currentParticipants = await twilioClient.video
  //     //     .rooms(doc.slateId)
  //     //     .participants.list({ status: 'connected' })

  //     //   const validCollaborators = Collaborators.find({ slateId: doc.slateId })
  //     //     .fetch()
  //     //     .map((c) => c._id)

  //     //   const invalidParticipants = []
  //     //   const pids = currentParticipants.map((p) => p.identity)
  //     //   // reconcile the twilio participants with the valid list of collaborators -- remove any that are no longer present
  //     //   console.log('reconciling', pids, validCollaborators)
  //     //   for (const p of pids) {
  //     //     if (!validCollaborators.includes(p)) {
  //     //       const part = currentParticipants.find((px) => px.identity === p)
  //     //       try {
  //     //         const rem = await twilioClient.video
  //     //           .rooms(doc.slateId)
  //     //           .participants(part.sid)
  //     //           .update({ status: 'disconnected' })
  //     //         console.log('remove ', rem)
  //     //         invalidParticipants.push(p)
  //     //       } catch (err) {
  //     //         console.log('Unable to remove participant', err.message, p)
  //     //       }
  //     //     }
  //     //   }
  //     //   console.log('kicked out ', invalidParticipants)
  //     //   if (invalidParticipants.length > 0) {
  //     //     currentParticipants = currentParticipants.filter((p) =>
  //     //       invalidParticipants.includes(p.identity)
  //     //     )
  //     //   }
  //     // }

  //     // reconcileVideoParticipants()
  //   },
  // })

  // Meteor.setInterval(() => {
  //   const removeIds = Collaborators.find({
  //     heartbeat: false,
  //     _id: { $nin: responses },
  //   })
  //     .fetch()
  //     .map((c) => c._id)
  //   Collaborators.remove({ _id: { $in: removeIds } })
  //   // this should fire the observer client side, to make sure it gets set back to true
  //   Collaborators.update(
  //     { heartbeat: true, _id: { $in: responses } },
  //     { $set: { heartbeat: false } },
  //     { multi: true }
  //   )
  //   responses = []
  // }, 3000)

  // remove all previous Collaborators, they will re-register on restart
  Collaborators.remove({})
})
