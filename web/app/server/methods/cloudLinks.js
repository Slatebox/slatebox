/* eslint-disable no-new */
// A slate's picture in the app's image store (a cloud link): utils.getCloudLink. Google Drive and
// Docs are the Google integration's (enterprise/server/google), not here.
import { Meteor } from 'meteor/meteor'
import { check } from 'meteor/check'
import { requireEditableSlate } from '../common/slate-access'
import sharp from 'sharp'
import { isRasterImage } from '../common/upload-kinds.mjs'
import CONSTANTS from '../../imports/api/common/constants'
import { APILinks, Slates } from '../../imports/api/common/models'
import { storeFile, storeImage } from '../common/fileStore'
import { audit } from '../audit/recorder.mjs'

const method = {}

// async function deletePriorObjects(bucket, prefix) {
//   AWS.config.update({
//     accessKeyId: Meteor.settings.aws.accessKey,
//     secretAccessKey: Meteor.settings.aws.secretKey,
//   })

//   const s3 = new AWS.S3()

//   const listParams = {
//     Bucket: bucket,
//     Prefix: prefix,
//   }

//   const listedObjects = await s3.listObjectsV2(listParams).promise()

//   if (listedObjects.Contents.length === 0) return

//   const deleteParams = {
//     Bucket: bucket,
//     Delete: { Objects: [] },
//   }

//   listedObjects.Contents.forEach(({ Key }) => {
//     deleteParams.Delete.Objects.push({ Key })
//   })

//   await s3.deleteObjects(deleteParams).promise()

//   if (listedObjects.IsTruncated) await deletePriorObjects(bucket, prefix)
// }

// async function uploadImage(imgBuffer, slateId, isSvg, isTemplate) {
//   await deletePriorObjects(Meteor.settings.aws.imageBucket, slateId)

//   return new Promise((resolve, reject) => {
//     console.log('google image buffer', typeof imgBuffer, imgBuffer)
//     const slateStream = Readable.from([imgBuffer])
//     const fileId = isTemplate ? new Date().valueOf() : new Date().valueOf() // always adding timestamp to help with cache busting
//     const file = isSvg ? `${slateId}_${fileId}.svg` : `${slateId}_${fileId}.png`
//     const contentType = isSvg ? 'image/svg+xml' : 'image/png'

//     new streamingS3(
//       slateStream,
//       {
//         accessKeyId: Meteor.settings.aws.accessKey,
//         secretAccessKey: Meteor.settings.aws.secretKey,
//       },
//       {
//         Bucket: Meteor.settings.aws.imageBucket,
//         Key: file,
//         ContentType: contentType,
//       },
//       (e) => {
//         if (e) {
//           reject(e)
//         }
//         resolve(`${Meteor.settings.aws.cloudUrl}/${file}`)
//       }
//     )
//   })
// }

method[CONSTANTS.methods.utils.getCloudLink] = async (
  slateId,
  imgData,
  isSvg,
  _retiredFrame, // the template gallery's framed preview (retired)
  updateAPILink,
  forShare = false
) => {
  check(slateId, String)
  check(imgData, String)
  const user = await Meteor.userAsync()
  if (user) {
    // Only someone who may edit the slate sets its preview images.
    await requireEditableSlate(user._id, { slateId })
    if (imgData.length > 30 * 1024 * 1024) throw new Meteor.Error('too-large', 'That image is too large.')
    try {
      let imgBuffer = ''
      if (isSvg) {
        imgBuffer = imgData
      } else {
        // Never an SVG in PNG's clothing: sharp would draw it here, with no time limit.
        if (!isRasterImage(Buffer.from(imgData.replace('data:image/png;base64,', '').trim(), 'base64'))) {
          throw new Meteor.Error('invalid-image', 'That preview is not a PNG image.')
        }
        const picture = sharp(
          Buffer.from(
            imgData.replace('data:image/png;base64,', '').trim(),
            'base64'
          )
        )
        // A share card's picture (a public slate's link): small enough for every crawler (some stop at 5 MB).
        if (forShare === true) picture.resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
        imgBuffer = await picture
          .toBuffer()
          .catch((err) => console.log('err is', err))

      }

      // An SVG is stored to be downloaded, never shown as a page on the bucket's domain.
      const slateImageUrl = isSvg
        ? await storeFile({ body: Buffer.from(imgBuffer, 'utf8'), key: `${slateId}_${Date.now()}.svg`, contentType: 'image/svg+xml', contentDisposition: 'attachment' })
        : await storeImage(imgBuffer, slateId, false)
      const slateUpdate = {
        'options.staticImage': slateImageUrl,
        'options.staticImageTimestamp': Date.now(),
      }

      // save static images to slate
      await Slates.updateAsync(
        { 'options.id': slateId },
        {
          $set: slateUpdate,
        }
      )

      if (updateAPILink) {
        const shareSlate = await Slates.findOneAsync(
          { 'options.id': slateId },
          { shareId: 1 }
        )
        // console.log('got shareSlate', slateId, shareSlate)
        if (shareSlate) {
          // console.log('udpating apilinks', slateImageUrl)
          await APILinks.updateAsync(
            { slateShareId: shareSlate.shareId },
            { $set: { imageUrl: slateImageUrl } },
            { multi: true }
          )
        }
      }

      // A picture a person chose to put at a public address (Export › cloud link); never a share card.
      if (forShare !== true && !updateAPILink) {
        const linked = await Slates.findOneAsync({ 'options.id': slateId }, { fields: { shareId: 1, orgId: 1, 'options.name': 1 } })
        if (linked?.shareId) {
          await audit.record({ action: 'sharing.cloudLink', target: { type: 'slate', id: linked.shareId, name: linked.options?.name }, slateId: linked.shareId, ...(linked.orgId && { orgId: linked.orgId }), details: { format: isSvg ? 'SVG' : 'PNG' } })
        }
      }

      return { slateImageUrl }
    } catch (err) {
      console.log('Err is ', err.message)
      if (err instanceof Meteor.Error) throw err
      throw new Meteor.Error('cloud-link-failed', 'The cloud link could not be made. Try again.')
    }
  }
  return null
}

Meteor.methods(method)
