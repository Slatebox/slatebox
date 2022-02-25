// Streamy is global, so no import needed
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useSelector } from 'react-redux'
import { CONSTANTS } from '../../api/common/constants'
import { Collaborators, Collaboration } from '../../api/common/models'

export default function CollaborationUsers(props) {
  const collaborator = useSelector((state) => state.collaborator)

  useTracker(() => {
    if (props.slate?.shareId) {
      Meteor.subscribe(CONSTANTS.publications.collaborators, [
        props.slate?.shareId,
      ])
      // console.log("got collaborators ", Collaborators.find().count());

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
            // console.log("resetting to true ", doc.heartbeat);
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
    if (props.slate?.shareId) {
      Meteor.subscribe(
        CONSTANTS.publications.collaboration,
        [props.slate?.shareId],
        [collaborator?.instanceId],
        new Date().valueOf()
      )

      // wires up collaboration
      // console.log("subscribing to collaboration ", collaborator?.instanceId, props.slate?.shareId);
      Collaboration.find().observe({
        added(doc) {
          // console.log("got collab doc ", doc.instanceId, collaborator?.instanceId, doc);
          // $(".lastSaved").livestamp(new Date());
          // console.log("comparing instance ids", doc.instanceId, collaborator?.instanceId);
          if (doc.instanceId !== collaborator?.instanceId) {
            // no need for this, as it's excluded in the query
            props.slate?.collab.invoke(doc)
          }
        },
      })
    }
  })

  return null
}
