/* eslint-disable prefer-destructuring */
import { Meteor } from 'meteor/meteor'
// import fs from 'fs'
// import path from 'path'
// import jsonFix from 'json-fixer'
// import { jsonrepair } from 'jsonrepair'

const utils = {
  isUrl(str) {
    const urlRegex =
      '^(?!mailto:)(?:(?:http|https|ftp)://)(?:\\S+(?::\\S*)?@)?(?:(?:(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])(?:\\.(?:1?\\d{1,2}|2[0-4]\\d|25[0-5])){2}(?:\\.(?:[0-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))|(?:(?:[a-z\\u00a1-\\uffff0-9]+-?)*[a-z\\u00a1-\\uffff0-9]+)(?:\\.(?:[a-z\\u00a1-\\uffff0-9]+-?)*[a-z\\u00a1-\\uffff0-9]+)*(?:\\.(?:[a-z\\u00a1-\\uffff]{2,})))|localhost)(?::\\d{2,5})?(?:(/|\\?|#)[^\\s]*)?$'
    const url = new RegExp(urlRegex, 'i')
    return str.length < 2083 && url.test(str)
  },
  ipFromConnection(connection) {
    let ip
    if (connection.httpHeaders && connection.httpHeaders['x-forwarded-for']) {
      ip = connection.httpHeaders['x-forwarded-for']
        .split(/[ ,]/)
        .filter((a) => a.trim())[0]
    } else {
      ip = connection.clientAddress
    }
    // ip = _._property((ip || '').match(/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/), '0');
    return ip
  },
  randomInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1))
  },
  async pause(millis) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve()
      }, millis)
    })
  },
  extractIdFromWebsocketUrl(url) {
    return url
      ? url.split('/sockjs/')[1].replace('/websocket', '').replace(/\//gi, '-')
      : null
  },
  ddpHost() {
    if (Meteor.settings.public.env === 'prod') {
      return 'slatebox-prod-service'
    }
    if (Meteor.settings.public.env === 'test') {
      return 'slatebox-test-service'
    }
    if (Meteor.settings.public.env === 'stage') {
      return 'slatebox-stage-service'
    }
    if (Meteor.settings.public.env === 'dev') {
      return 'localhost:3000'
    }
  },
  safeForUrls(str) {
    return str
      .trim()
      .replace(/ /gi, '-')
      .replace(/'/gi, '')
      .replace(/\&/gi, '')
      .replace(/--/gi, '-')
      .toLowerCase()
  },
  // getApplicationRoot() {
  //   const meteorRoot = fs.realpathSync(`${process.cwd()}/../`)
  //   let applicationRoot = fs.realpathSync(`${meteorRoot}/../`)
  //   if (
  //     path.basename(fs.realpathSync(`${meteorRoot}/../../../`)) === '.meteor'
  //   ) {
  //     applicationRoot = fs.realpathSync(`${meteorRoot}'/../../../../`)
  //   }
  //   return applicationRoot
  // },
  isJSON(item) {
    let i = item
    i = typeof i !== 'string' ? JSON.stringify(i) : i
    try {
      i = JSON.parse(i)
    } catch (e) {
      return false
    }

    if (typeof i === 'object' && i !== null) {
      return true
    }
    return false
  },
  // attemptJsonExtract(jsonString) {
  //   let json = {}
  //   if (isJSON(jsonString)) {
  //     return JSON.parse(jsonString)
  //   }
  //   try {
  //     const { data, changed } = jsonFix(jsonString)
  //     json = data
  //   } catch (err) {
  //     try {
  //       json = JSON.parse(jsonrepair(jsonString))
  //     } catch (err2) {
  //       try {
  //         const data = Meteor.call(CONSTANTS.methods.openai.chat, {
  //           processImmediately: true,
  //           content: `Please repair this JSON string. Provide only the repaired JSON in your response. Do not include any output except the JSON. Here is the JSON string to repair: ${jsonString}`,
  //         })
  //         console.log('repaired JSON', data.content)
  //         json = JSON.parse(data.content)
  //       } catch (err3) {
  //         // console.log("json itself", JSON.parse(content).choices[0]);
  //         throw new Error(
  //           `JSON Repair unable to create json: ${jsonString}, produced: ${JSON.stringify(
  //             json
  //           )} err: ${err3}`
  //         )
  //       }
  //     }
  //   }
  //   // console.log('json parsed successfully', typeof json, json)
  //   return json
  // },
}

export default utils
