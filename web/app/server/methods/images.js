/* eslint-disable arrow-body-style */
// methods
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
// import fs from 'fs' // Removed unused import
// import { SVGPathData } from 'svg-pathdata' // Removed unused import
// import { optimize } from 'svgo' // Removed unused import
// import dbscan from '@cdxoo/dbscan' // Removed unused import
import fetch from 'node-fetch'
import CONSTANTS from '../../imports/api/common/constants'
import { check, Match } from 'meteor/check'
import { deleteStoredFile, storeImage } from '../common/fileStore'
import { uploadKeyOf } from '../sbImages'
import extractImagePalette from '../common/imagePalette.mjs'
import { renderSvgToPng } from '../common/render-svg.mjs'
import { searchImagesForNote, PictureSearchRefused } from './note-image-search.mjs'
import { chargeFixed, runAIAction } from '../metering/context.mjs'
import { FIXED_PRICES } from '../metering/prices.mjs'
import { auxCredential } from './ai/ai-settings'
import { redactText } from '../exec/redact.mjs'

const method = {}

// Server-only Google image search, for the image panel and for images the AI asks for.
// Each query is counted against the AI dollar allowance of the running action (it costs
// $0.005 past Google's free 100 a day). The keys are private settings, never sent to a browser.
// Google closes this API on 2027-01-01: the replacement is a follow-up.
export async function searchGoogleImages(opts) {
  const query = String(opts?.query ?? '').slice(0, 200)
  // Extra Google parameters from server code only (a licence filter: rights=a|b|c).
  const filter = typeof opts?.filter === 'string' && /^(&[a-zA-Z]+=[a-zA-Z0-9_|-]{1,60}){0,4}$/.test(opts.filter) ? opts.filter.replace(/\|/g, '%7C') : ''
  const limit = Math.min(Math.max(Number(opts?.limit) || 10, 1), 10)
  const page = Math.min(Math.max(Number(opts?.page) || 0, 0), 9)
  // The keys live on the server only: a picture search key an administrator connected in AI control
  // (sealed, read for each search, so a rotated key works at once), else the settings file's. No
  // browser ever receives them.
  const fromApp = query ? await auxCredential('google-cse') : null
  const keys = fromApp ? { apiKey: fromApp.apiKey, engineKey: fromApp.model } : Meteor.settings.googleImageSearch
  if (query && (!keys?.apiKey || !keys?.engineKey)) throw new Meteor.Error('not-configured', 'Picture search is not set up on this server.')
  if (query) await chargeFixed({ ref: `search_${Random.id()}`, kind: 'imageSearch', costMicros: FIXED_PRICES.imageSearch, model: 'google-cse' })
  if (query) {
    const url = `https://customsearch.googleapis.com/customsearch/v1?cx=${
      encodeURIComponent(keys.engineKey)
    }&num=${limit}&safe=ACTIVE&searchType=image&key=${
      encodeURIComponent(keys.apiKey)
    }&start=${page * limit}&q=${encodeURIComponent(query)}${filter}`

    try {
      const imgSearchResult = await (
        await fetch(url, {
          // Ensure this referer is whitelisted in your Google Cloud Console
          headers: { Referer: 'https://slatebox.com' },
          // the key is in the URL: it never follows a redirect elsewhere
          redirect: 'error',
        })
      ).json()

      if (imgSearchResult.error) {
        console.error(
          'Unable to search for images ',
          imgSearchResult.error.message
        )
        throw new Meteor.Error(
          'Unable to search for images: ',
          imgSearchResult.error.message
        )
      }
      return imgSearchResult
    } catch (err) {
      // a fetch error names the URL, and the URL carries the key: logged and returned without it
      const said = redactText(err.message, { keys: [keys.apiKey] })
      console.error('Unable to search for images', said)
      throw new Meteor.Error('Unable to search for images: ', said)
    }
  }
  return null
}

method[CONSTANTS.methods.images.getColors] = async ({ imgUrl, imgType } = {}) => {
  check(imgUrl, String)
  check(imgType, String)
  const user = await Meteor.userAsync()
  if (user && imgType.startsWith('image')) {
    // Declare iType with let once, allowing reassignment.
    let iType = imgType.replace('image/', '')
    if (iType === 'jpg') {
      iType = 'jpeg' // Reassignment is now valid
    }

    // console.log('imgUrl', imgUrl)
    const base64 = await Meteor.callAsync(
      CONSTANTS.methods.utils.base64StringFromRemoteUrl,
      { type: iType, url: imgUrl }
    )
    // console.log('base64', base64)
    return extractImagePalette(base64, 10)
  }
  return null
}

// A person removes a file they uploaded: the exact key, read from the url the upload returned.
method[CONSTANTS.methods.images.removeImage] = async function removeImage(opts) {
  check(opts, { url: String })
  if (!this.userId) return null
  const key = uploadKeyOf(opts.url, this.userId)
  if (!key) return false
  await deleteStoredFile(key)
  return true
}

// Server-only: a PNG of an SVG the server itself drew, stored in the bucket or returned as base64.
export async function svgToPng({
  svg,
  externalizeUrl = true,
  fileName,
  skipTimestamp = false,
  includeWidthHeight = false,
  resizeOptimization = true,
  compressionLevel = 6,
}) {
  {
    try {
      const start = Date.now()
      // If the SVG has a background style, modify the markup.
      // This workaround inserts an explicit <rect> as the first element.
      let fixedSvg = svg

      // Check for a background defined in the style of the root <svg>
      if (svg.includes('background:')) {
        // Remove the background style from the <svg> tag since it won't be rendered
        fixedSvg = svg.replace(/style=['"][^'"]*background:[^'"]*['"]/, '')

        // Insert a <rect> immediately after the opening <svg ...> tag.
        fixedSvg = fixedSvg.replace(
          /<svg([^>]+)>/,
          `<svg$1>
             <rect width="100%" height="100%" fill="rgba(255,255,255,0.6)" rx="10" ry="10" />`
        )
      }

      // Drawn in a child process with a time limit: the SVG may be a caller's (a presentation's
      // board, an AI visual), and drawing one has no cost bound of its own.
      const { png: pngBuffer, width, height } = await renderSvgToPng(fixedSvg, {
        resize: resizeOptimization ? { width: 600, height: 400, fit: 'inside' } : null,
        compressionLevel,
        timeoutMs: 20000,
        maxInputBytes: 25 * 1024 * 1024,
      })

      if (externalizeUrl) {
        const slateImageUrl = await storeImage(
          pngBuffer,
          fileName || new Date().valueOf(),
          false,
          'image/png',
          'png',
          skipTimestamp
        )
        console.log('image uploaded', {
          slateImageUrl,
          duration: Date.now() - start,
        })
        return includeWidthHeight
          ? { url: slateImageUrl, width, height }
          : slateImageUrl
      }
      return pngBuffer.toString('base64')
    } catch (e) {
      console.log('error in svgToPng', e)
      throw new Meteor.Error(
        `Unable to complete creating the visualization - please try again: ${e.message}`
      )
    }
  }
}

// Picture search for a note, from the style bar's More → Picture: the one picture search a
// browser can ask for. The server decides who may search and holds the key; the browser never
// calls Google. Each Google query is counted by the meter like any AI request (searchGoogleImages
// charges it to the running action: included amount (Pro credits), then balance; an own AI key never covers it).
method[CONSTANTS.methods.images.search] = async (opts) => {
  check(opts, Match.ObjectIncluding({ query: String, page: Match.Maybe(Match.Integer) }))
  const user = await Meteor.userAsync()
  // A guest is asked to register before the meter is asked anything.
  if (!user || user.isAnonymous) throw new Meteor.Error('register', 'Register (it takes a second) to search for pictures.')
  return runAIAction({ feature: 'image-search', kind: 'imageSearch' }, () => searchForNote(user, opts))
}

async function searchForNote(user, opts) {
  try {
    return await searchImagesForNote({
      search: ({ query, page, limit }) => searchGoogleImages({ query, page, limit }),
    }, user, opts)
  } catch (err) {
    if (err instanceof PictureSearchRefused) throw new Meteor.Error(err.code, err.message)
    // The meter's own refusals (no Pro, included amount used up, no balance) keep their wording.
    if (err instanceof Meteor.Error && err.error !== 'Unable to search for images: ') throw err
    throw new Meteor.Error('search-failed', 'Pictures could not be searched just now. Try again in a moment.')
  }
}

Meteor.methods(method)
