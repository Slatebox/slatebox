/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-inner-declarations */
// methods.js
import { Meteor } from 'meteor/meteor'
import fetch from 'node-fetch'
import CONSTANTS from '../../imports/api/common/constants'
import { Slates } from '../../imports/api/common/models'

const method = {}

method[CONSTANTS.methods.daily.createRoom] = async (shareId) => {
  if (Meteor.user()) {
    try {
      const opts = {
        method: 'POST',
        body: JSON.stringify({
          name: shareId,
          privacy: 'public',
          properties: {
            start_audio_off: true,
            start_video_off: true,
          },
        }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Meteor.settings.daily.apiKey}`,
        },
      }
      console.log('calling daily room', opts)
      const response = await fetch('https://api.daily.co/v1/rooms', opts)
      console.log('got response', response)

      const data = await response.json()
      if (data.error && data.info.indexOf('already exists') === -1) {
        throw new Meteor.Error(data)
      }
      return true

      /*
        {
          "id": "987b5eb5-d116-4a4e-8e2c-14fcb5710966",
          "name": shareId,
          "api_created": true,
          "privacy":"private",
          "url":"https://slatebox.daily.co/getting-started-webinar",
          "created_at":"2019-01-26T09:01:22.000Z",
          "config":{
            "start_audio_off": true,
            "start_video_off": true
          }
        }
      */
    } catch (error) {
      // let other errors bubble up
      console.error(error)
      throw new Meteor.Error(error)
    }
  }
  return false
}

Meteor.methods(method)
