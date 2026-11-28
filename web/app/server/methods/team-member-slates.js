/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import { check } from 'meteor/check'
import AuthManager from '../../imports/api/common/AuthManager'
import CONSTANTS from '../../imports/api/common/constants'
import { Slates, SlateAccess, SlateSnapshots, Comments, Messages, Permissions } from '../../imports/api/common/models'
import { membersChanged } from './business'
import { removalRefusal } from '../team-guard.mjs'
import { teamPerson } from '../common/team-person'
import { removePersonalData } from '../profile/meteor'
import { audit } from '../audit/recorder.mjs'
import { personLabel } from '../audit/meteor'
import { removeIntegrationsOfAccount } from '../integrations/meteor'
import { removeAccountRows } from './account-rows'
import { releaseUploadsOfSlates, removeUploadsOfAccount } from '../upload-removal'

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
    const owned = await Slates.find({ userId: memberId, orgId }, { fields: { _id: 1, shareId: 1, 'options.name': 1 } }).fetchAsync()
    const ids = owned.map(slate => slate._id)
    // The activity log keeps who was removed and each slate that went with them (there is no restore).
    const removed = await Meteor.users.findOneAsync({ _id: memberId, orgId }, { fields: { profile: 1, emails: 1, createdAt: 1 } })
    await audit.record({ action: 'member.removed', orgId, target: { type: 'person', id: memberId, name: personLabel(removed) }, details: { count: ids.length } })
    for (const slate of owned) {
      await audit.record({ action: 'slate.deleted', orgId, target: { type: 'slate', id: slate.shareId || slate._id, name: slate.options?.name || 'Untitled slate' }, slateId: slate.shareId || slate._id, details: { reason: 'member removed' } })
    }
    // the member's own integrations and sign-ins (revoked at each vendor first), never a teammate's
    await removeIntegrationsOfAccount(memberId)
    await SlateAccess.removeAsync({ slateId: { $in: ids } })
    await Comments.removeAsync({ slateId: { $in: ids } })
    await Messages.removeAsync({ slateId: { $in: ids } })
    await releaseUploadsOfSlates({ _id: { $in: ids } })
    await Slates.removeAsync({ _id: { $in: ids } })
    await SlateSnapshots.removeAsync({ userId: memberId })
    await Permissions.removeAsync({ userId: memberId, orgId })
    // About you: every fact they kept and their personalization switches
    await removePersonalData(memberId)
    // their tokens, presentations, AI keys and choices and passkeys, as users.delete does
    await removeAccountRows(memberId)
    await Meteor.users.removeAsync({ _id: memberId, orgId })
    // their uploaded files, in the background; one a team slate that stays still shows is kept (upload-removal.js)
    if (removed) await removeUploadsOfAccount(removed)
    // a team billed for Slatebox Business pays for one member fewer (prorated)
    membersChanged(orgId)
    return ids.length
  },
})
