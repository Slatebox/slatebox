//Streamy is global, so no import needed
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { CONSTANTS } from '../../api/common/constants.js';
import { useSelector } from 'react-redux'
import { Collaborators, Collaboration } from '../../api/common/models.js';

export const CollaborationUsers = (props) => {

  let collaborator = useSelector(state => state.collaborator);

  //console.log("subscribing to collabs");

  useTracker(() => {
    if (props.slate?.shareId) {
      Meteor.subscribe(CONSTANTS.publications.collaborators, [props.slate?.shareId]);
      //console.log("got collaborators ", Collaborators.find().count());

      //wires hearbeat
      if (collaborator?.instanceId) {
        Collaborators.find({ _id: collaborator?.instanceId }).observe({
          added: function (doc) {
            if (doc.heartbeat === false) {
              Collaborators.update({ _id: collaborator?.instanceId }, { $set: { heartbeat: true } });
            }
          },
          changed: (doc) => {
            //console.log("resetting to true ", doc.heartbeat);
            if (doc.heartbeat === false) {
              Collaborators.update({ _id: collaborator?.instanceId }, { $set: { heartbeat: true } });
            }
          }
        });
      }
    }
  });

  useTracker(() => {
    if (props.slate?.shareId) {
      Meteor.subscribe(CONSTANTS.publications.collaboration
        , [props.slate?.shareId]
        , [collaborator?.instanceId]
        , new Date().valueOf()
      );

      //wires up collaboration
      //console.log("subscribing to collaboration ", collaborator?.instanceId, props.slate?.shareId);
      Collaboration.find().observe({
        added: function (doc) {
          //console.log("got collab doc ", doc.instanceId, collaborator?.instanceId, doc);
          //$(".lastSaved").livestamp(new Date());
          //console.log("comparing instance ids", doc.instanceId, collaborator?.instanceId);
          if (doc.instanceId !== collaborator?.instanceId) { //no need for this, as it's excluded in the query
            props.slate?.collab.invoke(doc);
            // exist?", doc.data.id); 
            if (doc.data.id) {
              //console.log("gonna update the node state ", props.slate?.nodes.one(doc.data.id));
              //update the node props of any opened drawers
              // setNodeDrawer({
              //   node: props.slate?.nodes.one(doc.data.id),
              //   open: true
              // })
            }
          }
        }
      });
    }
  });
  
  return null;
}      