/* eslint-disable no-underscore-dangle */
/* eslint-disable no-bitwise */
// methods.js
import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import {
  SystemSettings,
  VideoHelpGuides,
  VideoHelpGuideLikes,
} from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'

const method = {}

// {
//   type: "", "public", "org", "solo"
//   userId: "",
//   orgId: "",
//   created: "",
//   name: "",
//   icons: []
// }

method[CONSTANTS.methods.videoHelpGuides.get] = async ({
  path,
  identifier,
}) => {
  const user = await Meteor.userAsync()
  if (user) {
    const videoMetaData = await SystemSettings.findOneAsync({
      type: CONSTANTS.systemSettings.videoMetaData,
      path,
    })
    const vq = path ? { path } : { identifier }

    const allGuides = await VideoHelpGuides.find(vq).fetchAsync()
    return { ...videoMetaData, guides: allGuides }
  }
  return null
}

// A like is the signed-in person's own.
method[CONSTANTS.methods.videoHelpGuideLikes.post] = async function postLike({ videoId, isLike } = {}) {
  check(videoId, String)
  check(isLike, Match.Maybe(Boolean))
  const { userId } = this
  if (userId) {
    let videoLikeData
    if (isLike == null) {
      videoLikeData = await VideoHelpGuideLikes.removeAsync({ userId, videoId })
    } else {
      videoLikeData = await VideoHelpGuideLikes.upsertAsync(
        { userId, videoId },
        { userId, videoId, isLike }
      )
    }
  }
  return null
}

method[CONSTANTS.methods.videoHelpGuideLikes.get] = async function getLikes() {
  const { userId } = this
  if (userId) {
    const videoLikeData = await VideoHelpGuideLikes.find({
      userId,
    }).fetchAsync()
    return videoLikeData
  }
  return null
}

Meteor.methods(method)
