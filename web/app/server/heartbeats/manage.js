import { Meteor } from 'meteor/meteor'
import { Collaborators } from '../../imports/api/common/models'

// start heartbeat to know who is collaborating
Meteor.startup(async () => {
  // remove all previous Collaborators, they will re-register on restart
  await Collaborators.removeAsync({})
})
