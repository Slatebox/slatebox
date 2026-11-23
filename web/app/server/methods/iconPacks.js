/* eslint-disable no-underscore-dangle */
/* eslint-disable no-bitwise */
// methods.js
import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import { Random } from 'meteor/random'
import uniqBy from 'lodash.uniqby'
import { IconPacks } from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'

const method = {}

// The icon packs a person may see: public ones, the shared AWS set, their own private ones and
// their team's.
const visiblePacks = (user) => ({
  $or: [
    { visibility: 'public' },
    { orgId: 'aws' },
    { visibility: 'private', userId: user._id },
    ...(user.orgId ? [{ visibility: 'org', orgId: user.orgId }] : []),
  ],
})

// {
//   type: "", "public", "org", "solo"
//   userId: "",
//   orgId: "",
//   created: "",
//   name: "",
//   icons: []
// }

method[CONSTANTS.methods.iconPacks.get] = async (opts) => {
  const user = await Meteor.userAsync()
  if (user) {
    if (!opts.iconPackId) {
      const query = {
        $or: [
          {
            $and: [
              {
                userId: Meteor.userId(),
              },
              {
                visibility: 'private',
              },
            ],
          },
          {
            $and: [
              {
                visibility: 'public',
              },
            ],
          },
        ],
      }
      if (user?.orgId) {
        query.$or.push({
          $and: [
            {
              orgId: user.orgId,
            },
            {
              visibility: 'org',
            },
          ],
        })
      }
      return IconPacks.find(query, {
        fields: { created: 1, name: 1, orgId: 1, userId: 1 },
      }).fetchAsync()
    }
    check(opts.iconPackId, String)
    return IconPacks.findOneAsync({ $and: [{ _id: opts.iconPackId }, visiblePacks(user)] })
  }
  return null
}

// A person makes a pack (private, or for their team) or adds icons to a pack they made.
method[CONSTANTS.methods.iconPacks.update] = async (iconPack) => {
  check(iconPack, Match.ObjectIncluding({ _id: Match.Maybe(String), icons: [Object], name: Match.Maybe(String), visibility: Match.Maybe(String) }))
  const user = await Meteor.userAsync()
  if (user) {
    if (JSON.stringify(iconPack.icons).length > 5 * 1024 * 1024) throw new Meteor.Error('too-large', 'That icon pack is too large.')
    if (!iconPack._id) {
      // Every account sees a public pack, so only a master user publishes one.
      const visibility = (iconPack.visibility === 'public' && user.isMasterUser === true) || (iconPack.visibility === 'org' && user.orgId) ? iconPack.visibility : 'private'
      await IconPacks.insertAsync({
        _id: Random.id(),
        name: String(iconPack.name ?? '').slice(0, 120),
        visibility,
        icons: iconPack.icons,
        userId: user._id,
        orgId: user.orgId,
        created: Date.now(),
      })
    } else {
      const curPack = await IconPacks.findOneAsync({ _id: iconPack._id, userId: user._id })
      if (!curPack) throw new Meteor.Error('icon-pack-denied', 'You can only add icons to your own packs.')
      const allIcons = uniqBy(
        [...curPack.icons, ...iconPack.icons],
        (i) => i.id
      )
      // console.log(
      //   'adding new icons',
      //   curPack.icons.length,
      //   iconPack.icons.length,
      //   allIcons.length,
      //   allIcons.map((m) => m.id)
      // )
      await IconPacks.upsertAsync(
        { _id: iconPack._id },
        {
          $set: {
            modified: Date.now(),
            icons: allIcons,
          },
        }
      )
    }

    return true
  }
  return null
}

method[CONSTANTS.methods.iconPacks.removeIcon] = async (iconPackId, iconId) => {
  const user = await Meteor.userAsync()
  if (user) {
    const res = await IconPacks.updateAsync(
      { _id: iconPackId, userId: Meteor.userId() },
      { $pull: { icons: { id: iconId } } }
    )
    return res
  }
  return null
}

method[CONSTANTS.methods.iconPacks.delete] = async (iconPackId) => {
  const user = await Meteor.userAsync()
  if (user) {
    return IconPacks.removeAsync({ _id: iconPackId, userId: Meteor.userId() })
  }
  return null
}

Meteor.methods(method)
