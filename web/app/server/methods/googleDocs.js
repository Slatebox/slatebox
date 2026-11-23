/* eslint-disable no-new */
/* eslint-disable camelcase */
// methods.js
import { Meteor, Assets } from 'meteor/meteor'
import { check } from 'meteor/check'
import { requireEditableSlate } from '../common/slate-access'
import sharp from 'sharp'
import { isRasterImage } from '../common/upload-kinds.mjs'
import { google } from 'googleapis'
import fetch from 'node-fetch'
import CONSTANTS from '../../imports/api/common/constants'
import { APILinks, Slates } from '../../imports/api/common/models'
import { publicTemplateSelector } from '../../imports/api/common/template-policy.mjs'
import { uploadImage, uploadS3Object } from '../common/s3Utils'

const method = {}

function createGoogleOauthClient() {
  const { client_secret, client_id, redirect_uris } = Meteor.settings.googleDocs?.web || {}
  if (!client_id || !client_secret || !redirect_uris?.[0]) return null
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0])
}

method[CONSTANTS.methods.googleDocs.createAuthUrl] = async () => {
  const user = await Meteor.userAsync()
  if (user) {
    const SCOPES = ['https://www.googleapis.com/auth/drive.file']
    const oAuth2Client = createGoogleOauthClient()
    if (!oAuth2Client) return null
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'online',
      scope: SCOPES,
    })
    return authUrl
  }
  return null
}

method[CONSTANTS.methods.googleDocs.getToken] = async (code) => {
  const user = await Meteor.userAsync()
  if (user) {
    const oAuth2Client = createGoogleOauthClient()
    if (!oAuth2Client) return null
    try {
      const token = await oAuth2Client.getToken(code)
      return token
    } catch (err) {
      console.error('Error retrieving access token', err)
      return null
    }
  }
  return null
}

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

let frameImage = null
let frameImageMetaData = null
let frameBuffer = null
method[CONSTANTS.methods.utils.getCloudLink] = async (
  slateId,
  imgData,
  isSvg,
  addFrame,
  updateAPILink
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
      let imgBufferWithFrame = ''
      const getSlate = addFrame && await Slates.findOneAsync(publicTemplateSelector({ 'options.id': slateId }), {
        fields: { 'options.isTemplate': 1, 'options.containerStyle': 1 },
      })
      if (addFrame && !getSlate) return null
      if (isSvg) {
        imgBuffer = imgData
      } else {
        // Never an SVG in PNG's clothing: sharp would draw it here, with no time limit.
        if (!isRasterImage(Buffer.from(imgData.replace('data:image/png;base64,', '').trim(), 'base64'))) {
          throw new Meteor.Error('invalid-image', 'That preview is not a PNG image.')
        }
        imgBuffer = await sharp(
          Buffer.from(
            imgData.replace('data:image/png;base64,', '').trim(),
            'base64'
          )
        )
          .toBuffer()
          .catch((err) => console.log('err is', err))

        if (addFrame) {
          if (!frameImage) {
            const getFrameBuffer = Buffer.from(
              await Assets.getBinaryAsync('sb_frame.png')
            )
            frameImage = await sharp(getFrameBuffer)
            frameImageMetaData = await frameImage.metadata()
            frameBuffer = await frameImage.toBuffer()
          }

          imgBufferWithFrame = await sharp({
            create: {
              width: frameImageMetaData.width,
              height: frameImageMetaData.height,
              channels: 3,
              background:
                getSlate?.options?.containerStyle?.backgroundColor || '#f3f3f3',
            },
          })
            .png()
            .composite([
              {
                input: await sharp(
                  Buffer.from(
                    imgData.replace('data:image/png;base64,', '').trim(),
                    'base64'
                  )
                )
                  .resize({
                    width: frameImageMetaData.width,
                    height: frameImageMetaData.height,
                    fit: sharp.fit.inside,
                  })
                  .toBuffer(),
              },
              {
                input: frameBuffer,
              },
            ])
            .toBuffer()
            .catch((err) => console.log('err is', err))
        }
      }

      // upload image to s3 for google docs access
      // An SVG is stored to be downloaded, never shown as a page on the bucket's domain.
      const slateImageUrl = isSvg
        ? await uploadS3Object({ body: Buffer.from(imgBuffer, 'utf8'), key: `${slateId}_${Date.now()}.svg`, contentType: 'image/svg+xml', contentDisposition: 'attachment' })
        : await uploadImage(imgBuffer, slateId, false, getSlate?.options?.isTemplate)
      let slateImageWithFrameUrl = null
      const slateUpdate = {
        'options.staticImage': slateImageUrl,
        'options.staticImageTimestamp': Date.now(),
      }
      if (imgBufferWithFrame !== '') {
        slateImageWithFrameUrl = await uploadImage(
          imgBufferWithFrame,
          slateId,
          isSvg,
          getSlate?.options?.isTemplate
        )
      }
      if (slateImageWithFrameUrl) slateUpdate['options.staticFrameImage'] = slateImageWithFrameUrl

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

      return { slateImageUrl, slateImageWithFrameUrl }
    } catch (err) {
      console.log('Err is ', err.message)
      return Meteor.Error(err)
    }
  }
  return null
}

method[CONSTANTS.methods.googleDocs.export] = async (
  token,
  slateId,
  pngBase64
) => {
  check(slateId, String)
  check(pngBase64, String)
  const user = await Meteor.userAsync()
  if (user) {
    await requireEditableSlate(user._id, { slateId })
    try {
      const embed64 = pngBase64.replace('data:image/png;base64,', '').trim()
      if (!isRasterImage(Buffer.from(embed64, 'base64'))) throw new Meteor.Error('invalid-image', 'That export is not a PNG image.')
      // create the png to include in the google doc
      const imgBuffer = await sharp(Buffer.from(embed64, 'base64'))
        .toBuffer()
        .catch((err) => console.log('err is', err))

      // upload image to s3 for google docs access
      const slateUrl = await uploadImage(imgBuffer, slateId)
      const createUrl = `https://docs.googleapis.com/v1/documents`

      const createOptions = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.tokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Slatebox',
        }),
      }

      const createResult = await (await fetch(createUrl, createOptions)).json()
      const updateUrl = `https://docs.googleapis.com/v1/documents/${createResult.documentId}:batchUpdate`

      const updateOptions = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.tokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              insertInlineImage: {
                location: { index: 1 },
                uri: slateUrl,
              },
            },
          ],
        }),
      }

      const updateResult = await await (
        await fetch(updateUrl, updateOptions)
      ).json()

      await Slates.updateAsync(
        { 'options.id': slateId },
        {
          $set: {
            'options.lastSavedGoogleDocUrl': `https://docs.google.com/document/d/${updateResult.documentId}/edit`,
          },
        }
      )

      return updateResult
    } catch (err) {
      return Meteor.Error(err)
    }
  }
  return null
}

Meteor.methods(method)
