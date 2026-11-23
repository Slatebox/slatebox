import { Meteor } from 'meteor/meteor'
import AuthManager from '../../imports/api/common/AuthManager'
import CONSTANTS from '../../imports/api/common/constants'
import { Slates, SlateAccess, Comments, Messages } from '../../imports/api/common/models'

// A team admin who removes a member also removes the slates that member owns in the team (the
// browser used to delete them through the collection). Called before the account is removed,
// by the same people Meteor.users' remove rule lets remove it.
Meteor.methods({
  async 'organizations.removeMemberSlates'(memberId) {
    if (!this.userId || typeof memberId !== 'string' || memberId === this.userId)
      throw new Meteor.Error('unavailable', 'Choose a member of your team.')
    const admin = await Meteor.users.findOneAsync(this.userId, { fields: { orgId: 1 } })
    const member = await Meteor.users.findOneAsync(memberId, { fields: { orgId: 1 } })
    if (!admin?.orgId || member?.orgId !== admin.orgId ||
        !await AuthManager.userHasClaim(this.userId, [CONSTANTS.claims.canRemoveUsers._id]))
      throw new Meteor.Error('unavailable', 'Choose a member of your team.')
    const owned = await Slates.find({ userId: memberId, orgId: admin.orgId }, { fields: { _id: 1 } }).fetchAsync()
    const ids = owned.map(slate => slate._id)
    await SlateAccess.removeAsync({ slateId: { $in: ids } })
    await Comments.removeAsync({ slateId: { $in: ids } })
    await Messages.removeAsync({ slateId: { $in: ids } })
    await Slates.removeAsync({ _id: { $in: ids } })
    return ids.length
  },
})
