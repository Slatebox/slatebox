/* eslint-disable no-await-in-loop */
/* eslint-disable no-new */
/* eslint-disable no-restricted-syntax */
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { check, Match } from 'meteor/check'
import { runAIAction, chargeFixed } from '../metering/context.mjs'
import { FIXED_PRICES } from '../metering/prices.mjs'
import { aiProviders } from '../config/index.cjs'
import { auxCredential } from './ai/ai-settings'
import { guardedFetch, resolveRequestConnection } from './ai/ai-settings'
import { generateImages } from './ai/image-connection.mjs'

import fetch from 'node-fetch'
import CONSTANTS from '../../imports/api/common/constants'
import { uploadS3Object } from '../common/s3Utils'

const method = {}

async function uploadImage(imgBuffer, userId) {
  const now = new Date()
  const folder = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`
  return uploadS3Object({
    body: imgBuffer,
    key: `${folder}/ai_${userId}_${Random.id()}.png`,
    contentType: 'image/png',
  })
}

// The connection chosen for generating images (the person's, their team's or the operator's), or
// null for the built-in image service. A model that cannot make images says so.
async function imagesFromChoice(user, opts) {
  const chosen = await resolveRequestConnection({ feature: 'image-generation', userId: user._id })
  // turned off by an administrator (AI control): their message, nothing is sent
  if (chosen?.disabled) return [{ error: true, message: chosen.message || 'Making pictures is turned off by your administrator.' }]
  if (chosen?.gap || chosen?.error) return [{ error: true, message: chosen.gap?.message || chosen.error }]
  if (!chosen?.connection) return null
  const viaConnection = () => imagesFromConnection(chosen, opts, user._id)
  // the person's own connection costs Slatebox nothing; the operator's is counted like any generated image
  return chosen.own ? viaConnection() : runAIAction({ feature: 'image-generation', kind: 'imageGeneration' }, async () => {
    await chargeFixed({ ref: `image_${Random.id()}`, kind: 'imageGeneration', costMicros: FIXED_PRICES.imageGeneration, model: chosen.connection.model })
    return viaConnection()
  })
}

async function imagesFromConnection(chosen, opts, userId) {
  try {
    const buffers = await generateImages(chosen.connection, { prompt: opts.prompts.join('\n'), width: side(opts.width), height: side(opts.height) }, { fetch: guardedFetch(chosen.rules) })
    return Promise.all(buffers.map((buffer) => uploadImage(buffer, userId)))
  } catch (error) {
    return [{ error: true, message: `${chosen.connection.model || chosen.connection.name}: ${error.message}` }]
  }
}

const side = (value) => (Number.isInteger(value) && value >= 256 && value <= 1024 ? Math.round(value / 64) * 64 : 512)

// A generated image is counted at a fixed price for a signed-in person, with a fixed engine
// and bounded sizes and prompt.
method[CONSTANTS.methods.stabilityai.generate] = async (opts) => {
  check(opts, Match.ObjectIncluding({ prompts: [String], width: Match.Maybe(Number), height: Match.Maybe(Number) }))
  return generateImagesFor(await Meteor.userAsync(), opts)
}

// Generated images for a signed-in person (this method, a deck's pictures), each counted.
export async function generateImagesFor(user, opts) {
  if (opts.prompts.length < 1 || opts.prompts.length > 2 || opts.prompts.some((p) => p.length > 2000)) {
    throw new Meteor.Error('invalid-prompt', 'Describe the image in one short prompt.')
  }
  if (user && !user.isAnonymous) {
    // a connection chosen for generating images answers here; without one, the built-in service below
    const chosen = await imagesFromChoice(user, opts)
    if (chosen) return chosen
    return runAIAction({ feature: 'image-generation', kind: 'imageGeneration' }, async () => {
    // A generated image has a fixed price, charged when the request is sent.
    await chargeFixed({ ref: `image_${Random.id()}`, kind: 'imageGeneration', costMicros: FIXED_PRICES.imageGeneration, model: 'stability' })
    const body = {
      height: side(opts.height),
      width: side(opts.width),
    }
    body.text_prompts = opts.prompts.map((p) => ({
      text: p,
      weight: 1,
    }))
    // a Stability key an administrator connected in AI control (sealed, read for each picture) wins
    // over the settings file's
    const fromApp = await auxCredential('stability')
    const imgOpts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${fromApp?.apiKey || Meteor.settings.stabilityai?.apiKey}`,
      },
      redirect: 'error',
    }
    imgOpts.body = JSON.stringify(body)

    // console.log('going to get engines', {
    //   method: 'GET',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     Authorization: `${Meteor.settings.stabilityai.apiKey}`,
    //   },
    // })

    // const engines = await (
    //   await fetch(`https://api.stability.ai/v1/engines/list`, {
    //     method: 'GET',
    //     headers: {
    //       'content-type': 'application/json',
    //       accept: 'application/json',
    //       authorization: `${Meteor.settings.stabilityai.apiKey}`,
    //     },
    //   })
    // ).json()

    // console.log('engines are ', JSON.stringify(engines))

    // stable-diffusion-512-v2-1
    // console.log('calling stability ai for image', imgOpts)
    const response = await (
      await fetch(
        Meteor.settings.stabilityai?.endpoint || aiProviders.stabilityai.endpoint,
        imgOpts
      )
    ).json()

    /*
    {
      "artifacts": [
        {
          "base64": ""
        }
      ]
    }
    */

    // response
    // [
    //   [
    //     {
    //       "base64": "...very long string...",
    //       "finishReason": "SUCCESS",
    //       "seed": 1050625087
    //     },
    //     {
    //       "base64": "...very long string...",
    //       "finishReason": "CONTENT_FILTERED",
    //       "seed": 1229191277
    //     }
    //   ]
    // ]

    // The response carries the images as base64: only its outcome is logged.
    console.log('stability answered', { images: response?.artifacts?.length ?? 0, message: response?.message ?? null })

    // {"id":"6b3714e101b593bae7a694937fde7690","message":"Invalid prompts detected","name":"invalid_prompts"}

    if (response.message) {
      return [{ error: true, message: response.message }]
    }
    // console.log('genned images', imgOpts.body, response?.artifacts?.length)
    const images = []
    for (const img of response.artifacts || []) {
      // console.log('converting b64', img.base64)
      // const imgBuffer = await sharp(Buffer.from(img.base64, 'base64'))
      //   .png()
      //   .toBuffer()
      //   .catch((err) => console.log('err is', err))

      const imgBuffer = Buffer.from(img.base64, 'base64')
      // console.log('uploading buffer', imgBuffer)
      const slateImageUrl = await uploadImage(imgBuffer, user._id)
      images.push(slateImageUrl)
    }

    console.log('returning images', images.length)
    return images
    })
  }
  throw new Meteor.Error('ai-denied', 'Sign in to use AI.')
}

Meteor.methods(method)
