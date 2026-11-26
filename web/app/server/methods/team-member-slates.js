/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import { check } from 'meteor/check'
import AuthManager from '../../imports/api/common/AuthManager'
import CONSTANTS from '../../imports/api/common/constants'
import { Slates, SlateAccess, Comments, Messages, Permissions } from '../../imports/api/common/models'
import { membersChanged } from './business'
import { removalRefusal } from '../team-guard.mjs'
import { teamPerson } from '../common/team-person'
import { removePersonalData } from '../profile/meteor'

// A team member with canRemoveUsers removes another member: the slates that member owns in the
// team, then the account, in one call. Never the owner, never yourself, and an admin only by an
// admin (server/team-guard.mjs). The browser has no remove rule for accounts.
Meteor.methods({
  'organizations.removeMember': async function removeMember(memberId) {
    check(memberId, String)
    if (!this.userId) throw new Meteor.Error('unavailable', 'Choose a member of your team.')
    const self = await teamPerson(this.userId)
    const caller = self && { ...self, canRemove: await AuthManager.userHasClaim(this.userId, [CONSTANTS.claims.canRemoveUsers._id]) }
    const member = await teamPerson(memberId)
    const refusal = removalRefusal(caller, member)
    if (refusal) throw new Meteor.Error('remove-denied', refusal)
    const { orgId } = caller
    const owned = await Slates.find({ userId: memberId, orgId }, { fields: { _id: 1 } }).fetchAsync()
    const ids = owned.map(slate => slate._id)
    await SlateAccess.removeAsync({ slateId: { $in: ids } })
    await Comments.removeAsync({ slateId: { $in: ids } })
    await Messages.removeAsync({ slateId: { $in: ids } })
    await Slates.removeAsync({ _id: { $in: ids } })
    await Permissions.removeAsync({ userId: memberId, orgId })
    // About you: every fact they kept and their personalization switches
    await removePersonalData(memberId)
    await Meteor.users.removeAsync({ _id: memberId, orgId })
    // a team billed for Slatebox Business pays for one member fewer (prorated)
    membersChanged(orgId)
    return ids.length
  },
})
