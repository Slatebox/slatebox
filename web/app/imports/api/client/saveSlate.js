/* eslint-disable no-undef */
import { Meteor } from 'meteor/meteor'
import Cookies from 'js-cookie'
import { Collaboration } from '../common/models'
import CONSTANTS from '../common/constants'
import promisify from './promisify'
import createEdgeNGrams from '../common/createEdgeNGrams'

let saveSoon = null

const saveSlate = async (opts) => {
  // attaching defaults to all
  const uopts = opts
  if (!uopts.pkg) {
    uopts.pkg = {}
  }
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
    case 'onMouseMoved': {
      // wire up mouse positions
      // Send a message to all connected sessions (Client & server)
      Streamy.broadcast(uopts.pkg.slateId, {
        type: 'mousemove',
        data: uopts.pkg,
      })
      break
    }
    default: {
      const slate = JSON.parse(uopts.slate.exportJSON())
      if (
        ['onSlateDescriptionChanged', 'onSlateNameChanged'].includes(
          uopts.pkg.type
        )
      ) {
        slate.options.searchName = createEdgeNGrams(slate.options.name)
        slate.options.searchDescription = createEdgeNGrams(
          slate.options.description
        )
      }
      slate.options.searchText = createEdgeNGrams(
        slate.nodes.map((n) => n.options.text).join(' ')
      )
      if (uopts.userId) {
        slate.userId = uopts.userId
      } else if (!slate.userId) {
        slate.userId = Meteor.userId()
      }
      if (uopts.orgId) {
        slate.orgId = uopts.orgId
      } else if (Meteor.user().orgId) {
        slate.orgId = Meteor.user().orgId
      }
      let guestCollaboratorId = null
      if (Cookies.get(CONSTANTS.guestCollaboratorCookieId)) {
        guestCollaboratorId = Cookies.get(CONSTANTS.guestCollaboratorCookieId)
      }
      // queue this up so it is smartly saving instead of too often
      clearTimeout(saveSoon)
      saveSoon = window.setTimeout(async () => {
        try {
          const results = await promisify(
            Meteor.call,
            CONSTANTS.methods.slates.update,
            { slate, guestCollaboratorId }
          )
          // auto save theme as well if need be
          if (slate.options.eligibleForThemeCompilation) {
            await promisify(
              Meteor.call,
              CONSTANTS.methods.themes.parseSlateIntoTheme,
              { slateId: slate.options.id }
            )
          }

          uopts.pkg.dated = results
          Collaboration.insert(uopts.pkg)
        } catch (error) {
          console.error('error saving slate!', error)
        }
      }, 1)
      break
    }
  }
}

export default saveSlate
