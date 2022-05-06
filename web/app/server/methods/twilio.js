/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-inner-declarations */
// methods.js
import { Meteor } from 'meteor/meteor'
import Twilio from 'twilio'
import CONSTANTS from '../../imports/api/common/constants'

const method = {}

// create the twilioClient
const twilioClient = new Twilio(
  Meteor.settings.twilio.sid,
  Meteor.settings.twilio.secret,
  { accountSid: Meteor.settings.twilio.accountSid }
)

method[CONSTANTS.methods.twilio.provisionSlateRoom] = async (shareId) => {
  if (Meteor.user()) {
    try {
      // see if the room exists already. If it doesn't, this will throw
      // error 20404.
      await twilioClient.video.rooms(shareId).fetch()
      console.log('room already exists')
      return true
    } catch (error) {
      // the room was not found, so create it
      if (error.code === 20404) {
        await twilioClient.video.rooms.create({
          uniqueName: shareId,
          type: 'go',
        })
        console.log('room created')
        return true
      }
      // let other errors bubble up
      throw new Meteor.Error(error)
    }
  }
  return false
}

method[CONSTANTS.methods.twilio.generateAccessToken] = async (userOpts) => {
  // console.log("calling chatwoot identity", Meteor.userId());
  if (Meteor.userId() && Meteor.settings.chatWoot.userIdentityValidationToken) {
    const planType = Meteor.user().orgId
      ? Organizations.findOne(Meteor.user().orgId).planType
      : Meteor.user().planType || 'free'

    let currentParticipants = await twilioClient.video
      .rooms(userOpts.room)
      .participants.list({ status: 'connected' })

    // const invalidParticipants = []
    // const pids = currentParticipants.map((p) => p.identity)
    // // reconcile the twilio participants with the valid list of collaborators -- remove any that are no longer present
    // console.log('reconciling', pids, userOpts.validCollaborators)
    // for (const p of pids) {
    //   if (!userOpts.validCollaborators.includes(p)) {
    //     const part = currentParticipants.find((px) => px.identity === p)
    //     try {
    //       const rem = await twilioClient.video
    //         .rooms(userOpts.room)
    //         .participants(part.sid)
    //         .update({ status: 'disconnected' })
    //       console.log('remove ', rem)
    //       invalidParticipants.push(p)
    //     } catch (err) {
    //       console.log('Unable to remove participant', err.message, p)
    //     }
    //   }
    // }
    // console.log('kicked out ', invalidParticipants)
    // if (invalidParticipants.length > 0) {
    //   currentParticipants = currentParticipants.filter((p) =>
    //     invalidParticipants.includes(p.identity)
    //   )
    // }

    // only 2 users allowed in a video chat with the free version
    if (planType === 'free' && currentParticipants.length >= 2) {
      return new Meteor.Error(
        `Your plan only allows up to 2 members in a video chat. Current collaborators are ${currentParticipants
          .map((p) => p.identity)
          .join(', ')}`
      )
    }

    // create an access token
    const token = new Twilio.jwt.AccessToken(
      Meteor.settings.twilio.accountSid,
      Meteor.settings.twilio.sid,
      Meteor.settings.twilio.secret,
      { identity: userOpts.identity }
    )
    // create a video grant for this specific room
    const videoGrant = new Twilio.jwt.AccessToken.VideoGrant({
      ...userOpts,
    })

    // add the video grant
    token.addGrant(videoGrant)
    // serialize the token and return it
    console.log('genned token', token.toJwt())
    return token.toJwt()
  }
  return null
}

Meteor.methods(method)
