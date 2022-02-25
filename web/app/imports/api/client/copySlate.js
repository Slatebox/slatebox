import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { CONSTANTS } from '/imports/api/common/constants.js'
import { createAnonymousUser } from '/imports/api/client/createAnonymousUser.js'
import { Slates, Organizations } from '/imports/api/common/models.js'
import cloneDeep from 'lodash.clonedeep'
import { promisify } from './promisify'

const copySlate = async (slate, allowTemplateCopy) => {
  if (!Meteor.user()) {
    await createAnonymousUser()
  }

  const copy = cloneDeep(slate)

  //allowTemplate copies
  if (copy.options.isTemplate && !allowTemplateCopy) {
    copy.options.isTemplate = false
    copy.options.basedOnTemplate = copy.options.id

    if (copy.options.basedOnTemplate === CONSTANTS.defaultThemeId) {
      // based on master theme template
      copy.options.showZoom = false
      copy.options.showUndoRedo = false
      copy.options.showMultiSelect = false
      copy.options.showbirdsEye = false
      copy.options.name = ``
      copy.options.description = ``
      copy.options.eligibleForThemeCompilation = true
    } else if (copy.options.name.toLowerCase().indexOf('copy') === -1) {
      copy.options.name = `${copy.options.name} (Copy)`.trim()
    }

    // need to adjust node behavior when a template is used
    copy.nodes.forEach((node) => {
      if (node.options.disableMenuAsTemplate) {
        // when using as a template, disable the ability to access this node's menu altogether.
        node.options.allowMenu = false
        node.options.showMenu = false
        delete node.options.disableMenuAsTemplate
      }
    })
  }

  copy._id = Random.id()
  copy.options.id = copy._id
  let planType = Meteor.user().orgId
    ? Organizations.findOne()?.planType
    : Meteor.user().planType
  const isPublic = planType === 'free' ? true : false

  Object.assign(copy.options, {
    isPublic: isPublic,
    isCommunity: false,
    isFeatured: false,
  })

  copy.userId = Meteor.userId()
  copy.shareId = await promisify(
    Meteor.call,
    CONSTANTS.methods.slates.generateShareId
  )
  copy.lastSaved = new Date().valueOf()
  copy.created = copy.lastSaved

  if (Meteor.user().orgId) {
    copy.orgId = Meteor.user().orgId
  }
  Slates.insert(copy)

  return copy.shareId
}

export { copySlate }
