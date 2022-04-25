/* eslint-disable no-new */
/* eslint-disable camelcase */
// methods.js
import { Meteor } from 'meteor/meteor'
import sharp from 'sharp'
import { google } from 'googleapis'
import fetch from 'node-fetch'
import streamingS3 from 'streaming-s3'
import { Readable } from 'stream'
import CONSTANTS from '../../imports/api/common/constants'
import { Slates } from '../../imports/api/common/models'

const method = {}

function createGoogleOauthClient() {
  const { client_secret, client_id, redirect_uris } =
    Meteor.settings.googleDocs.web
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0])
}

method[CONSTANTS.methods.googleDocs.createAuthUrl] = async () => {
  if (Meteor.user()) {
    const SCOPES = ['https://www.googleapis.com/auth/drive.file']
    const oAuth2Client = createGoogleOauthClient()
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'online',
      scope: SCOPES,
    })
    return authUrl
  }
  return null
}

method[CONSTANTS.methods.googleDocs.getToken] = async (code) => {
  if (Meteor.user()) {
    const oAuth2Client = createGoogleOauthClient()
    try {
      const token = await oAuth2Client.getToken(code)
      console.log('got token', token)
      return token
    } catch (err) {
      console.error('Error retrieving access token', err)
      return null
    }
  }
  return null
}

async function uploadImage(imgBuffer, slateId) {
  return new Promise((resolve, reject) => {
    const slateStream = Readable.from([imgBuffer])
    console.log('slateStream', slateStream)
    new streamingS3(
      slateStream,
      {
        accessKeyId: Meteor.settings.aws.accessKey,
        secretAccessKey: Meteor.settings.aws.secretKey,
      },
      {
        Bucket: Meteor.settings.aws.imageBucket,
        Key: `${slateId}.png`,
        ContentType: 'image/png',
      },
      (e) => {
        if (e) {
          reject(e)
        }
        resolve(
          `https://${Meteor.settings.aws.imageBucket}.s3.amazonaws.com/${slateId}.png`
        )
      }
    )
  })
}

method[CONSTANTS.methods.googleDocs.export] = async (
  token,
  slateId,
  pngBase64
) => {
  if (Meteor.user()) {
    try {
      const embed64 = pngBase64.replace('data:image/png;base64,', '').trim()
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

      Slates.update(
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

method[CONSTANTS.methods.googleDocs.createFolder] = async (token) => {
  const createFolderOptions = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mimeType: 'application/vnd.google-apps.folder',
      name: 'Slatebox',
    }),
  }

  const response = await fetch(
    'https://www.googleapis.com/drive/v3/files',
    createFolderOptions
  )
  const json = await response.json()
  return json
}

Meteor.methods(method)
