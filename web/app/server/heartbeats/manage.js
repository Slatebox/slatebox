/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import { Collaborators } from '../../imports/api/common/models'

// start heartbeat to know who is collaborating
Meteor.startup(() => {
  const responses = []
  Collaborators.find({}).observe({
    added(doc) {
      responses.push(doc._id)
    },
    changed(doc) {
      console.log('client set heartbeat back to true', doc.heartbeat)
      responses.push(doc._id)
    },
    removed(doc) {
      console.log('collaborator has dropped!', doc._id)
    },
  })

  // remove all previous Collaborators, they will re-register on restart
  Collaborators.remove({})
})
