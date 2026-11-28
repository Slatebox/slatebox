/* eslint-disable no-inner-declarations */
/* eslint-disable no-undef */
import { Meteor } from 'meteor/meteor'
import { DDP } from 'meteor/ddp-client'
import Cookies from 'js-cookie'
import { Collaboration } from '../common/models'
import CONSTANTS from '../common/constants'
import promisify from './promisify'
import utils from '../common/utils'

let saveSoon = null
let streamer = null

const saveSlate = async (opts) => {
  // attaching defaults to all
  const uopts = opts
  if (!uopts.pkg) {
    uopts.pkg = {}
  }
  // if (!streamer) {
  //   streamer = new Meteor.Streamer('mousePos', {
  //     ddpConnection: DDP.connect(utils.ddpHost()),
  //   })
  // }
  uopts.pkg.userId = Meteor.userId()
  let userName = ''
  if (!Meteor.user() || (Meteor.user() && Meteor.user().isAnonymous)) {
    userName = 'Guest'
  } else if (
    Meteor.user().profile &&
    Meteor.user().profile.firstName &&
    Meteor.user().profile.firstName !== ''
  ) {
    userName = `${Meteor.user().profile.firstName} ${
      Meteor.user().profile.lastName
    }`.replace(/undefined/gi, '')
  } else {
    // eslint-disable-next-line prefer-destructuring
    userName = Meteor.user().emails[0].address.split('@')[0]
  }
  uopts.pkg.userName = userName
  uopts.pkg.slateId = uopts.slate.shareId
  uopts.pkg.instanceId = uopts.instanceId

  switch (uopts.pkg.type) {
    default: {
      const slate = JSON.parse(uopts.slate.exportJSON())
      slate.shareId ||= uopts.slate.shareId
      // console.log('saving slate', JSON.stringify(slate, null, 2))
      // The server builds the search fields when it saves (server/slate-search-fields.mjs).
      // TODO: don't overwrite the slate userId created and those that modify it
      if (uopts.userId) {
        slate.userId = uopts.userId
      } else if (!slate.userId) {
        // console.log('assigning slate userId to logged in user')
        // slate.userId = Meteor.userId()
      }

      // if this is an AI interactive slate and the user touches a node to position it,
      // inhibit the AI from rerunning a layout on the node
      // if (uopts.pkg.type === 'onNodesMove') {
      //   uopts.pkg.data.nodeOptions.forEach((n) => {
      //     const nodeMoving = slate.nodes.find((nx) => nx.options.id === n.id)
      //     nodeMoving.options.humanTouch = true
      //   })
      // }

      if (uopts.orgId) {
        slate.orgId = uopts.orgId
      } else if (Meteor.user()?.orgId) {
        slate.orgId = Meteor.user().orgId
      }
      let guestCollaboratorId = null
      if (Cookies.get(CONSTANTS.guestCollaboratorCookieId)) {
        guestCollaboratorId = Cookies.get(CONSTANTS.guestCollaboratorCookieId)
      }

      async function save() {
        try {
          await Meteor.callAsync(
            CONSTANTS.methods.slates.update,
            // projectId: a new slate's first save only, made from a project (createSlate.js)
            { slate, guestCollaboratorId, ...(uopts.projectId && { projectId: uopts.projectId }) }
          )
          // uopts.pkg.dated = results
          // Collaboration.insert(uopts.pkg)
        } catch (error) {
          console.error('error saving slate!', error)
        }
      }

      if (opts.saveImmediately) {
        save()
      } else {
        // queue this up so it is smartly saving instead of too often
        clearTimeout(saveSoon)
        saveSoon = window.setTimeout(async () => {
          save()
        }, 1)
      }
      break
    }
  }
}

export default saveSlate
