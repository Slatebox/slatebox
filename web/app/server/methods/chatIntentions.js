/* eslint-disable no-underscore-dangle */
/* eslint-disable no-bitwise */
// methods.js
import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import AuthManager from '../../imports/api/common/AuthManager'
import { Random } from 'meteor/random'
import { unsafeKeyPath } from '../common/document-keys.mjs'
import { ChatIntentions } from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'
import { aiControlStore } from '../ai-control/index.mjs'
import { changedFields } from '../ai-control/admin.mjs'

const method = {}

// Personas carry prompts and tools every AI run of theirs uses, so each save and delete is kept in
// the AI control audit trail (the fields that changed, before and after). A lost row is logged;
// the person's save still stands.
async function recordIntention(action, user, id, before, after) {
  try {
    const diff = changedFields(before, after)
    await aiControlStore.record({
      action, actor: { userId: user._id, principal: 'person', via: 'ddp' }, target: { kind: 'intention', id },
      before: diff.before, after: diff.after,
    })
  } catch (error) {
    console.warn(`chatIntentions: could not record ${action} in the audit trail: ${error.message}`)
  }
}

// The fields a persona carries (see the seeded ones in server/bootstrap/all.js).
// The flags that make a persona everyone's default are a master user's to set.
const PERSONA_FIELDS = ['name', 'identifier', 'title', 'details', 'description', 'slateName', 'gather', 'ai',
  'basedOnTemplate', 'order', 'icon', 'color']
const MASTER_FIELDS = ['isDefault', 'isAdhoc', 'active']

// A person saves an intention of their own, or (a team admin) one of their team; saving another's
// makes a copy. Only a master user makes a universal intention, which every account's AI runs.
method[CONSTANTS.methods.chatIntentions.save] = async (intention) => {
  check(intention, Match.ObjectIncluding({ _id: Match.Maybe(String) }))
  const user = await Meteor.userAsync()
  if (user) {
    if (JSON.stringify(intention).length > 512 * 1024) throw new Meteor.Error('too-large', 'That persona is too large.')
    const unsafe = unsafeKeyPath(intention)
    if (unsafe) throw new Meteor.Error('invalid-persona', `A persona cannot have the field ${unsafe}.`)
    const isUserMaster = user.isMasterUser === true
    // Only a persona's own fields are stored; who owns it and who sees it are the server's.
    const saveIntention = {}
    for (const field of [...PERSONA_FIELDS, ...(isUserMaster ? MASTER_FIELDS : [])]) {
      if (intention[field] !== undefined) saveIntention[field] = intention[field]
    }
    if (isUserMaster && intention.universal === true) saveIntention.universal = true
    else if (user.orgId) saveIntention.orgId = user.orgId
    saveIntention.userId = user._id
    if (intention._id) {
      const existing = await ChatIntentions.findOneAsync({ _id: intention._id })
      const mayChange = existing && (isUserMaster || (!existing.universal && !existing.system && (existing.userId === user._id ||
        (user.orgId && existing.orgId === user.orgId && await AuthManager.userHasClaim(user._id, [CONSTANTS.claims.admin._id])))))
      // A persona someone else owns is saved as the person's own copy.
      if (mayChange) {
        if (existing.userId !== user._id) saveIntention.userId = existing.userId
        await ChatIntentions.updateAsync({ _id: intention._id }, { $set: saveIntention })
        await recordIntention('chatIntentions.save', user, intention._id, existing, { ...existing, ...saveIntention })
        return intention._id
      }
    }
    saveIntention._id = Random.id()
    await ChatIntentions.insertAsync(saveIntention)
    await recordIntention('chatIntentions.save', user, saveIntention._id, null, saveIntention)
    return saveIntention._id
  }
  return null
}

method[CONSTANTS.methods.chatIntentions.delete] = async (id) => {
  const user = await Meteor.userAsync()
  if (user && user.orgId) {
    const intention = await ChatIntentions.findOneAsync({
      _id: id,
      orgId: user.orgId,
    })
    if (intention) {
      await ChatIntentions.removeAsync({
        _id: id,
        orgId: user.orgId,
      })
      await recordIntention('chatIntentions.delete', user, id, intention, null)
      return intention.name
    }
  }
  return null
}

Meteor.methods(method)
