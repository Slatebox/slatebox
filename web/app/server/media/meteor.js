// The Meteor side of video lookups: where a poster is stored. With an S3 file store (Slatebox
// Cloud, a self-host with a bucket) it is kept there, under one name per video. Without one it is
// kept in the app's own cached-image collection and served by /sbimages/ (server/sbImages.js), so
// a self-host or a local server still shows posters without reaching the video host.
import { Meteor } from 'meteor/meteor'
import { CachedImages } from '../../imports/api/common/models'
import { uploadS3Object } from '../common/s3Utils'
import { createMediaLookup } from './media-lookup.mjs'

const hasFileStore = () => Boolean(Meteor.settings.aws?.imageBucket && Meteor.settings.aws?.cloudUrl)

async function storePoster({ key, body, contentType }) {
  if (hasFileStore()) return uploadS3Object({ body, key, contentType })
  await CachedImages.upsertAsync({ url: key }, { $set: { url: key, bytes: body, contentType, created: Date.now() } })
  const path = `/sbimages/${encodeURIComponent(key)}`
  const base = String(Meteor.settings.public?.baseUrl || '').replace(/\/+$/, '')
  // An https app names the poster in full (a shared picture of the slate reads it from anywhere);
  // otherwise it is a path on the app itself.
  return base.startsWith('https://') ? `${base}${path}` : path
}

export const mediaLookup = createMediaLookup({ storePoster })
