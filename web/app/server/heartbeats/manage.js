import { Collaborators } from '../../imports/api/common/models.js';
import { Meteor } from "meteor/meteor";

//start heartbeat to know who is collaborating
Meteor.startup(function() {
	let responses = [];
	Collaborators.find({}).observe({
		added: function(doc) {
			responses.push(doc._id);
		},
		changed: function(doc) {
      console.log("client set heartbeat back to true", doc.heartbeat);
			responses.push(doc._id);
		}, 
		removed: function(doc) {
			console.log("collaborator has dropped!", doc._id);
		}
	});
  
  /*
  Meteor.setInterval(function() {
		let removeIds = Collaborators.find({ heartbeat: false, _id: { $nin: responses } }).fetch().map(c => { return c._id; });
    console.log("removing collaborators ", removeIds);
		Collaborators.remove({ _id: { $in: removeIds } });
    //this should fire the observer client side, to make sure it gets set back to true
		Collaborators.update({ heartbeat: true, _id: { $in: responses } }, { $set: { heartbeat: false } }, {multi: true});
		responses = [];
	}, 3000);
  */

	//remove all previous Collaborators, they will re-register on restart
	Collaborators.remove({});
});