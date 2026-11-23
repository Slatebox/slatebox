/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import CONSTANTS from '../../imports/api/common/constants'
import { OrganizationSettings } from '../../imports/api/common/models'

const method = {}

method[CONSTANTS.methods.organizationSettings.save] = async function save(
  settingObject
) {
  check(settingObject, {
    _id: Match.Optional(String),
    type: Match.Optional(String),
    value: Match.Optional(Match.Any),
    orgId: String,
    uploadedAt: Match.Optional(Number),
    deleted: Match.Optional(Boolean),
    intentionId: Match.Optional(String),
  })

  if (!this.userId) {
    throw new Meteor.Error('not-authorized')
  }

  const user = await Meteor.users.findOneAsync({ _id: this.userId })
  if (!user || !user.orgId) {
    throw new Meteor.Error(
      'not-authorized',
      'User does not belong to an organization'
    )
  }

  // Make sure the user's orgId matches the requested orgId
  if (user.orgId !== settingObject.orgId) {
    throw new Meteor.Error(
      'not-authorized',
      'Cannot modify settings for another organization'
    )
  }

  const now = new Date()
  if (settingObject._id) {
    // Check if this is an existing setting
    // A setting is found and changed only inside the person's own team.
    const existingSetting = await OrganizationSettings.findOneAsync({
      _id: settingObject._id,
      orgId: user.orgId,
    })

    if (existingSetting) {
      // Update existing setting
      await OrganizationSettings.updateAsync({ _id: settingObject._id, orgId: user.orgId }, {
        $set: {
          ...(settingObject.type && { type: settingObject.type }),
          ...(settingObject.value && { value: settingObject.value }),
          ...(settingObject.deleted !== undefined && {
            deleted: settingObject.deleted,
          }),
          ...(settingObject.intentionId && {
            intentionId: settingObject.intentionId,
          }),
          updatedAt: now,
        },
      })
    } else {
      // This is a new setting with a client-generated ID
      // Only throw an error if we're trying to update or delete a non-existent setting
      if (settingObject.deleted) {
        throw new Meteor.Error('not-found', 'Setting not found')
      }

      // An id another team uses is not this team's to take.
      if (await OrganizationSettings.findOneAsync({ _id: settingObject._id }, { fields: { _id: 1 } })) {
        throw new Meteor.Error('not-authorized', 'Cannot modify settings for another organization')
      }

      // Otherwise, treat it as an insert with the provided _id
      await OrganizationSettings.insertAsync({
        ...settingObject,
        createdAt: now,
        updatedAt: now,
      })
    }
  } else {
    // Insert new setting with a server-generated ID
    const insertId = await OrganizationSettings.insertAsync({
      ...settingObject,
      createdAt: now,
      updatedAt: now,
    })
    return insertId
  }

  return settingObject._id
}

method[CONSTANTS.methods.organizationSettings.get] = async function get(
  settingId
) {
  check(settingId, String)

  if (!this.userId) {
    throw new Meteor.Error('not-authorized')
  }

  const user = await Meteor.users.findOneAsync({ _id: this.userId })
  if (!user || !user.orgId) {
    throw new Meteor.Error(
      'not-authorized',
      'User does not belong to an organization'
    )
  }

  const setting = await OrganizationSettings.findOneAsync({
    _id: settingId,
    orgId: user.orgId,
  })
  return setting
}

method[CONSTANTS.methods.organizationSettings.getByQuery] =
  async function getByQuery(args) {
    check(args, {
      type: Match.Optional(String),
      intentionId: Match.Optional(String),
    })

    if (!this.userId) {
      throw new Meteor.Error('not-authorized')
    }

    const user = await Meteor.users.findOneAsync({ _id: this.userId })
    if (!user || !user.orgId) {
      throw new Meteor.Error(
        'not-authorized',
        'User does not belong to an organization'
      )
    }

    // Build the query object
    const query = {
      orgId: user.orgId,
      deleted: { $ne: true }, // Typically exclude deleted settings
    }
    if (args.type) {
      query.type = args.type
    }
    if (args.intentionId) {
      query.intentionId = args.intentionId
    }

    // Fetch and return matching settings
    const settings = await OrganizationSettings.find(query).fetchAsync()
    return settings
  }

method[CONSTANTS.methods.organizationSettings.getAll] =
  async function getAll() {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized')
    }

    const user = await Meteor.users.findOneAsync({ _id: this.userId })
    if (!user || !user.orgId) {
      throw new Meteor.Error(
        'not-authorized',
        'User does not belong to an organization'
      )
    }

    return OrganizationSettings.find({ orgId: user.orgId }).fetchAsync()
  }

method[CONSTANTS.methods.organizationSettings.deletePreset] =
  async function deleteOrgPreset(data) {
    // Check only for intentionId now
    check(data, {
      intentionId: String,
    })

    // Use object destructuring for userId
    const { userId } = this
    if (!userId) {
      throw new Meteor.Error('not-authorized', 'User must be logged in.')
    }

    // Fetch user to get orgId
    const user = await Meteor.users.findOneAsync(
      { _id: userId },
      { fields: { orgId: 1 } }
    )
    if (!user || !user.orgId) {
      throw new Meteor.Error(
        'not-authorized',
        'User does not belong to an organization'
      )
    }
    const { orgId } = user // Destructure orgId from user
    const { intentionId } = data // Destructure intentionId from data

    // Find the specific preset setting to delete (now async)
    const settingToDelete = await OrganizationSettings.findOneAsync({
      orgId, // Use user's orgId
      intentionId,
      type: 'preset', // Ensure we only target presets
    })

    if (!settingToDelete) {
      console.warn(
        `Preset delete requested but setting not found for org ${orgId}, intention ${intentionId}`
      )
      // Return nothing as per void expectation
      return
    }

    // Perform the deletion (now async)
    const result = await OrganizationSettings.removeAsync({
      _id: settingToDelete._id,
      orgId, // Use user's orgId
    })

    if (result !== 1) {
      // This might indicate a race condition or other issue
      throw new Meteor.Error(
        'delete-failed',
        'Failed to delete the preset setting (removeAsync result was not 1).'
      )
    }

    console.log(
      `Preset deleted: Org ${orgId}, Intention ${intentionId}, Setting ID ${settingToDelete._id}`
    )
  }

Meteor.methods(method)
