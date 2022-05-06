import { Meteor } from 'meteor/meteor'

// global methods
import './methods/users'
import './methods/slates'
import './methods/themes'
import './methods/nounProject'
import './methods/collaborators'
import './methods/utils'
import './methods/organizations'
import './methods/slateAccess'
import './methods/chatWoot'
import './methods/comments'
import './methods/messages'
import './methods/stripe'
import './methods/googleDocs'
import './methods/twilio'

// stripe hooks
import './stripeHooks'

// global models
import '../imports/api/common/models'

// global publications
import './publications'

// startup code
import './startup'

// permissions
import './permissions'

// sbimages
import './sbImages'

// manage heartbeats
import './heartbeats/manage'
