import { Meteor } from 'meteor/meteor';
import { Collaboration } from '../common/models.js'
import { CONSTANTS } from '../common/constants.js';
import { promisify } from './promisify.js';
import createEdgeNGrams from '../common/createEdgeNGrams';
import Cookies from 'js-cookie';

//Streamy uses legacy atmosphere with no export, so no import needed

let saveSoon = null;

const saveSlate = async (opts) => {

  //attaching defaults to all
  if (!opts.pkg) { opts.pkg = {}; }
  opts.pkg.userId = Meteor.userId();
  let userName = "";
  if (!Meteor.user() || (Meteor.user() && Meteor.user().isAnonymous)) {
    userName = "Guest";
  } else if (Meteor.user().profile && Meteor.user().profile.firstName && Meteor.user().profile.firstName !== "") {
    userName = `${Meteor.user().profile.firstName} ${Meteor.user().profile.lastName}`.replace(/undefined/gi, "");
  } else {
    userName = Meteor.user().emails[0].address.split('@')[0];
  }
  opts.pkg.userName = userName;
  opts.pkg.slateId = opts.slate.shareId;
  opts.pkg.instanceId = opts.instanceId;

  switch (opts.pkg.type) {
		case "onMouseMoved": {
			//wire up mouse positions
      // Send a message to all connected sessions (Client & server)
			Streamy.broadcast(opts.pkg.slateId, { type: 'mousemove', data: opts.pkg });
			break;
		}
		default: {
      const slate = JSON.parse(opts.slate.exportJSON());
      if (["onSlateDescriptionChanged", "onSlateNameChanged"].includes(opts.pkg.type)) {
        slate.options.searchName = createEdgeNGrams(slate.options.name);
        slate.options.searchDescription = createEdgeNGrams(slate.options.description);
      }
      slate.options.searchText = createEdgeNGrams(slate.nodes.map(n => n.options.text).join(" "));
      if (opts.userId) { 
        slate.userId = opts.userId; 
      } else if (!slate.userId) {
        slate.userId = Meteor.userId();
      }
      if (opts.orgId) { 
        slate.orgId = opts.orgId; 
      } else if (Meteor.user().orgId) { 
        slate.orgId = Meteor.user().orgId;
      }
      let guestCollaboratorId = null;
      if (Cookies.get(CONSTANTS.guestCollaboratorCookieId)) {
        guestCollaboratorId = Cookies.get(CONSTANTS.guestCollaboratorCookieId);
      }
      // queue this up so it is smartly saving instead of too often
      clearTimeout(saveSoon);
      saveSoon = window.setTimeout(async () => {
        try {
          let results = await promisify(Meteor.call, CONSTANTS.methods.slates.update, { slate: slate, guestCollaboratorId });
          //Session.set("lastCollaborationDate", results);
  
          // auto save theme as well if need be
          if (slate.options.eligibleForThemeCompilation) {
            await promisify(Meteor.call, CONSTANTS.methods.themes.parseSlateIntoTheme, { slateId: slate.options.id });
          }
  
          opts.pkg.dated = results;
          Collaboration.insert(opts.pkg);
          //console.log("inserted collab pkg ", opts.pkg);
        } catch (error) {
          console.log("error saving slate!", error);
        }
      }, 1);      
      break;
		}
  }
};

export { saveSlate };