// Streamy is global, so no import needed
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useSelector } from 'react-redux'
import CONSTANTS from '../../api/common/constants'
import { Collaborators, Collaboration } from '../../api/common/models'

export default function CollaborationUsers({ slate }) {
  const collaborator = useSelector((state) => state.collaborator)

  useTracker(() => {
    if (slate?.shareId) {
      Meteor.subscribe(CONSTANTS.publications.collaborators, [slate?.shareId])
      // wires hearbeat
      if (collaborator?.instanceId) {
        Collaborators.find({ _id: collaborator?.instanceId }).observe({
          added(doc) {
            if (doc.heartbeat === false) {
              Collaborators.update(
                { _id: collaborator?.instanceId },
                { $set: { heartbeat: true } }
              )
            }
          },
          changed: (doc) => {
            if (doc.heartbeat === false) {
              Collaborators.update(
                { _id: collaborator?.instanceId },
                { $set: { heartbeat: true } }
              )
            }
          },
        })
      }
    }
  })

  useTracker(() => {
    if (slate?.shareId) {
      Meteor.subscribe(
        CONSTANTS.publications.collaboration,
        [slate?.shareId],
        [collaborator?.instanceId],
        new Date().valueOf()
      )

      // wires up collaboration
      Collaboration.find().observe({
        added(doc) {
          if (doc.instanceId !== collaborator?.instanceId) {
            // no need for this, as it's excluded in the query
            slate?.collab.invoke(doc)
          }
        },
      })
    }
  })

  return null
}
