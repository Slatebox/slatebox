/* eslint-disable no-underscore-dangle */
/* eslint-disable no-inner-declarations */
// methods
import { Random } from 'meteor/random'
import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import fetch from 'node-fetch'
import _ from 'underscore'
import uniqBy from 'lodash.uniqby'
import { optimize } from 'svgo'
import OAuth from 'oauth'
import probe from 'probe-image-size'
import { SVGPathData } from 'svg-pathdata'
import {
  NounProjectResultsMetaData,
  NounProjectResults,
  IconPacks,
} from '../../imports/api/common/models'
import rawMongoSearch from '../common/rawMongoSearch'
import CONSTANTS from '../../imports/api/common/constants'
import { auxCredential } from './ai/ai-settings'

const method = {}

async function getResults(url, oauth) {
  return new Promise((resolve, reject) => {
    oauth.get(url, null, null, (err, data, res) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

// Icon search for a signed-in account: bounded query and page sizes, rate limited per connection,
// and only the icon packs the person may see.
method[CONSTANTS.methods.nounProject.get] = async (input) => {
  check(input, Match.ObjectIncluding({ query: String, limit: Match.Maybe(Match.Integer), page: Match.Maybe(Match.Integer), disableIconPackSearch: Match.Maybe(Boolean) }))
  if (!input.query.trim() || input.query.length > 100) return { data: [], hasMoreData: false }
  const opts = { ...input, limit: Math.min(Math.max(input.limit || 25, 1), 50), page: Math.min(Math.max(input.page || 1, 1), 5) }
  const GLOBAL_LIMIT = 100
  const LIMIT = opts.limit
  const NO_CACHE = true
  const PAID_NOUNPROJECT_ACCOUNT = true
  const MAX_OPTIMIZED_PATH_LENGTH = 35000
  const user = await Meteor.userAsync()
  if (user) {
    let existent = null
    let raw = []
    let localIds = []
    let localResults = []

    if (!NO_CACHE) {
      existent = await NounProjectResultsMetaData.findOneAsync({
        _id: opts.query,
      })
      raw = await NounProjectResults.find({
        'tags.slug': opts.query.toLowerCase(),
      }).fetchAsync()
      localIds = _.map(raw, (r) => r._id)
      localResults = {
        data: _.map(raw, (r) => ({ title: r.term, path: r.optimizedPath })),
        hasMoreData: false,
      }
    }

    if (!existent && !NO_CACHE) {
      existent = {
        _id: opts.query,
        timestamp: new Date().valueOf(),
        attempts: [],
      }
      await NounProjectResultsMetaData.insertAsync(existent)
    }

    const priorAttempt = NO_CACHE
      ? false
      : _.find(
          existent.attempts,
          (a) => a.page === opts.page && a.limit === LIMIT
        )

    console.log(
      'checking limit',
      opts.page * opts.limit > GLOBAL_LIMIT,
      opts.page,
      opts.limit,
      GLOBAL_LIMIT
    )
    const currentPageExceedsData = NO_CACHE
      ? opts.page * opts.limit > GLOBAL_LIMIT
        ? true
        : false
      : _.filter(
          existent.attempts,
          (a) =>
            opts.page >= a.page && a.limit === LIMIT && a.hasMoreData === false
        ).length > 0
    if (priorAttempt || currentPageExceedsData) {
      if (!NO_CACHE) {
        // || _emptyFutureAttempts.length > 0
        localResults.hasMoreData = priorAttempt
          ? priorAttempt.hasMoreData
          : false

        const l = LIMIT
        const p = opts.page - 1
        localResults.data = localResults.data.slice(p * l, p * l + l)
        return localResults
      } else {
        return { data: [], hasMoreData: false }
      }
    }

    // always add iconPackIcons unless explicit
    const iconPackIcons = []
    if (!opts.disableIconPackSearch) {
      // collection, query, op, sort, skip, limit
      const getIconPacks = await rawMongoSearch(
        IconPacks,
        {
          $and: [
            { $text: { $search: opts.query } },
            { $or: [
              { visibility: 'public' },
              { orgId: 'aws' },
              { visibility: 'private', userId: user._id },
              ...(user.orgId ? [{ visibility: 'org', orgId: user.orgId }] : []),
            ] },
          ],
        },
        'toArray',
        'name'
      )
      console.log('queried for iconpacks', { packs: getIconPacks.length, page: opts.page, limit: opts.limit })
      getIconPacks.forEach((ip) => {
        ip.icons.forEach((i) => {
          // console.log(
          //   'checking for match',
          //   i.name,
          //   opts.query,
          //   i.name.toLowerCase().match(opts.query.toLowerCase())
          // )
          if (i.name.toLowerCase().includes(opts.query.toLowerCase())) {
            // console.log('matched icon name', i.name, opts.query, i)
            iconPackIcons.push({
              ...i,
              title: i.name,
            })
          }
        })
      })
    }

    // async function getPaths(cb) {
    const url = `https://api.thenounproject.com/v2/icon?query=${
      encodeURIComponent(opts.query)
    }&limit_to_public_domain=${PAID_NOUNPROJECT_ACCOUNT ? 0 : 1}&page=${
      opts.page
    }&limit=${LIMIT}&include_svg=1`

    const timestamp = parseInt(new Date().valueOf() / 1000, 10)
    const nonce = Random.id()
    const bulkOp = NO_CACHE
      ? null
      : NounProjectResults.rawCollection().initializeUnorderedBulkOp()

    // an icon key an administrator connected in AI control (key:secret, sealed, read for each search)
    // wins over the settings file's
    const fromApp = await auxCredential('nounproject')
    const [appKey, appSecret] = fromApp ? fromApp.apiKey.split(':') : []
    const oauth = new OAuth.OAuth(
      'https://api.thenounproject.com',
      'https://api.thenounproject.com',
      appKey || Meteor.settings.nounProject?.key,
      appSecret || Meteor.settings.nounProject?.secret,
      '1.0',
      null,
      'HMAC-SHA1'
    )
    let results = []
    try {
      // console.log('querying for nounproject results', url)
      results = await getResults(url, oauth)
      results = JSON.parse(results).icons
    } catch (err) {
      console.error('Error searching noun project ', { err })
    }

    // save off the metadata for analysis
    const hasMoreData = LIMIT === results.length

    if (!NO_CACHE) {
      await NounProjectResultsMetaData.updateAsync(
        { _id: opts.query },
        {
          $push: {
            attempts: {
              limit: LIMIT,
              page: opts.page,
              count: results.length,
              hasMoreData,
              ids: _.map(results, (r) => r.id),
            },
          },
        }
      )
    }

    let all = []
    const errs = []

    if (results.length > 0) {
      // now we should loop through the results and extract just the SVG icons

      function consolidatePaths(data) {
        const ssvg = data.split('<path')
        const consolidated = []
        ssvg.forEach((sp) => {
          if (sp.indexOf('d=') > -1) {
            // inside a <path, split for the d=
            const root = sp.replace('d="', '')
            // if the <path d= ends with a z, then use it, otherwise use the "\"/>" to terminate
            const strw =
              root.indexOf('z') > -1
                ? `${root.split('z"')[0]}z`.trim()
                : root.split('"/>')[0].trim()
            // some paths start with attrs at the start (in front of the d=), this ensures that every path starts with
            const ssp =
              strw.indexOf(' M') > -1 ? `M${strw.split(/ M(.+)/)[1]}` : strw
            consolidated.push(ssp)
          }
        })
        // fix for hanging "/></svg> or prefixed fill-rule="evenodd"
        const returnPaths = consolidated
          .join('')
          .replace(/"\/><\/svg>/g, '')
          .replace(/fill-rule="evenodd"/, '')
          .trim()
        return returnPaths
      }

      for (const r of results) {
        if (NO_CACHE || localIds.indexOf(r.id) === -1) {
          const rr = r
          try {
            const data = await fetch(r.icon_url)
            const svgContent = await data.text()
            try {
              const res = optimize(svgContent, {
                multipass: true,
                plugins: [
                  'preset-default',
                  { name: 'mergePaths', params: { force: true } },
                ],
              })
              const initPath = consolidatePaths(res.data)
              if (initPath.length > 0) {
                let initAnalysis = null
                try {
                  initAnalysis = new SVGPathData(initPath)
                } catch (err) {
                  console.error('Unable to parse path', { length: initPath.length }, err.message)
                }
                const rbbox = initAnalysis.getBounds()
                const width = rbbox.maxX - rbbox.minX
                const height = rbbox.maxY - rbbox.minY
                const scale = 100 / Math.max(width, height)

                // move to 0,0
                const movedPath = initAnalysis
                  .translate(rbbox.minX * -1, rbbox.minY * -1)
                  .encode()

                // scale to fit box of 100 x 100
                const scaledPath = new SVGPathData(movedPath)
                  .scale(scale)
                  .encode()

                const reoptimize = optimize(
                  `<svg xmlns="http://www.w3.org/2000/svg"><path d='${scaledPath}'/></svg>`,
                  {
                    multipass: true,
                    plugins: [
                      'preset-default',
                      { name: 'mergePaths', params: { force: true } },
                    ],
                  }
                )
                rr.optimizedPath = consolidatePaths(reoptimize.data).trim()

                const obbox = initAnalysis.getBounds(r.optimizedPath)

                if (r.optimizedPath.length < MAX_OPTIMIZED_PATH_LENGTH) {
                  all.push({
                    id: r.id,
                    title: r.term,
                    path: r.optimizedPath,
                    width: obbox.maxX - obbox.minX,
                    height: obbox.maxY - obbox.minY,
                  })
                }

                if (rr.id) {
                  rr._id = rr.id
                  delete rr.id
                } else {
                  rr._id = Random.id()
                }
                if (!NO_CACHE) {
                  await bulkOp.insertAsync(rr)
                }
              }
            } catch (err) {
              console.error('Unable to parse path', err)
            }
          } catch (err) {
            errs.push(err)
          }
        }
      }

      console.log('all done', { results: all.length })

      if (!NO_CACHE) {
        const hasOp =
          bulkOp &&
          bulkOp.s &&
          bulkOp.s.currentBatch &&
          bulkOp.s.currentBatch.operations &&
          bulkOp.s.currentBatch.operations.length > 0

        if (hasOp) {
          bulkOp.execute((errx) => {
            if (errx) {
              console.error('error batch inserting into mongo', errx)
            } else {
              const l = LIMIT
              const p = opts.page - 1
              const extra = localResults.data.slice(
                p * l,
                p * l + l - all.length
              )
              all = all.concat(extra)
              all = uniqBy(all.concat(iconPackIcons), (i) => i.id)
              return { data: all, hasMoreData }
            }
          })
        } else {
          return { data: [], hasMoreData: false }
        }
      } else {
        all = uniqBy(all.concat(iconPackIcons), (i) => i.id)
        console.log('sending results', { results: all.length, hasMoreData })
        return { data: all, hasMoreData }
      }
    } else {
      return { data: iconPackIcons, hasMoreData: false }
    }
  }
  return false
}

DDPRateLimiter.addRule({ type: 'method', name: CONSTANTS.methods.nounProject.get, connectionId: () => true }, 30, 60000)

Meteor.methods(method)
