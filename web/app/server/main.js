import { Meteor } from 'meteor/meteor';

//global methods
import './methods/users.js';
import './methods/slates.js';
import './methods/themes.js';
import './methods/nounProject.js';
import './methods/collaborators.js';
import './methods/utils.js';
import './methods/stripe.js';
import './methods/organizations.js';
import './methods/slateAccess.js';
import './methods/chatWoot.js';
import './methods/comments.js';
import './methods/messages.js';

//global models
import '/imports/api/common/models.js';

//global publications
import './publications.js';

//specialized publications
import './publications/tags.js';

//startup code
import './startup.js';

//permissions
import './permissions.js';

//stripe hooks
import './stripeHooks.js';

//sbimages
import './sbImages.js';

//manage heartbeats
import './heartbeats/manage.js';