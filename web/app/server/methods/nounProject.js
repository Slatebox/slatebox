/* eslint-disable no-underscore-dangle */
/* eslint-disable no-inner-declarations */
// methods
import { Random } from 'meteor/random'
import { Meteor } from 'meteor/meteor'
import { HTTP } from 'meteor/http'
import _ from 'underscore'
import SVGO from 'svgo'
import oauthSignature from 'oauth-signature'
import probe from 'probe-image-size'
import { SVGPathData } from 'svg-pathdata'
import {
  NounProjectResultsMetaData,
  NounProjectResults,
} from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'

const method = {}

method[CONSTANTS.methods.nounProject.get] = async (opts) => {
  const LIMIT = opts.limit || 25
  const NO_CACHE = true
  const PAID_NOUNPROJECT_ACCOUNT = true
  const MAX_OPTIMIZED_PATH_LENGTH = 35000

  if (Meteor.user()) {
    const svgo = new SVGO() // by default loads all optimizations
    let existent = null
    let raw = []
    let localIds = []
    let localResults = []

    if (!NO_CACHE) {
      NounProjectResultsMetaData.findOne({ _id: opts.query })
      raw = NounProjectResults.find({
        'tags.slug': opts.query.toLowerCase(),
      }).fetch()
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
      NounProjectResultsMetaData.insert(existent)
    }

    const priorAttempt = NO_CACHE
      ? false
      : _.find(
          existent.attempts,
          (a) => a.page === opts.page && a.limit === LIMIT
        )
    const currentPageExceedsData = NO_CACHE
      ? false
      : _.filter(
          existent.attempts,
          (a) =>
            opts.page >= a.page && a.limit === LIMIT && a.hasMoreData === false
        )
    if (priorAttempt || currentPageExceedsData.length > 0) {
      // || _emptyFutureAttempts.length > 0

      localResults.hasMoreData = priorAttempt ? priorAttempt.hasMoreData : false

      const l = LIMIT
      const p = opts.page - 1
      localResults.data = localResults.data.slice(p * l, p * l + l)
      return localResults
    }

    function getPaths(cb) {
      const url = `http://api.thenounproject.com/icons/${
        opts.query
      }?limit_to_public_domain=${PAID_NOUNPROJECT_ACCOUNT ? 0 : 1}`

      const timestamp = parseInt(new Date().valueOf() / 1000, 10)
      const nonce = Random.id()
      const bulkOp = NO_CACHE
        ? null
        : NounProjectResults.rawCollection().initializeUnorderedBulkOp()

      // working oauth header:
      // OAuth oauth_consumer_key="1cc0ae21b6964d71b9eb8108fa39f3e9"
      // ,oauth_nonce="74f61171a6894ef4a5698e37d0ff01a6"
      // ,oauth_signature_method="HMAC-SHA1"
      // ,oauth_timestamp="1498838739"
      // ,oauth_version="1.0"
      // ,oauth_signature="Al7TJOPQSoPcYvjyPCUMhBB6bIs%3D"

      const sigParams = {
        oauth_consumer_key: Meteor.settings.nounProject.key,
        oauth_timestamp: timestamp,
        oauth_nonce: nonce,
        oauth_signature_method: 'HMAC-SHA1',
        oauth_version: '1.0',
        page: opts.page,
        limit: LIMIT,
        limit_to_public_domain: PAID_NOUNPROJECT_ACCOUNT ? 0 : 1,
      }

      const signature = oauthSignature.generate(
        'GET',
        url,
        sigParams,
        Meteor.settings.nounProject.secret
      )

      const auth = `OAuth oauth_version="1.0", oauth_consumer_key="${Meteor.settings.nounProject.key}", oauth_nonce="${nonce}", oauth_signature_method="HMAC-SHA1", oauth_timestamp="${timestamp}", oauth_signature="${signature}"`
      let results = []
      try {
        const uOpts = {
          params: { page: opts.page, limit: LIMIT },
          headers: { Authorization: auth },
        }
        results = HTTP.get(url, uOpts).data.icons
      } catch (err) {
        console.error('Error searching noun project ', { err })
      }

      // save off the metadata for analysis
      const hasMoreData = LIMIT === results.length

      if (!NO_CACHE) {
        NounProjectResultsMetaData.update(
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

      let att = 0
      let all = []
      const errs = []

      function potentiallyFinalize() {
        if (att === results.length) {
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
                  cb(null, { data: all, hasMoreData })
                }
              })
            } else {
              cb(null, { data: [], hasMoreData: false })
            }
          } else {
            cb(null, { data: all, hasMoreData })
          }
        }
      }

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
          return consolidated.join('')
        }

        function cont(r) {
          const rr = r
          HTTP.get(r.icon_url, async (err, data) => {
            att += 1
            if (err) {
              errs.push(err)
              potentiallyFinalize()
            } else {
              try {
                const res = await svgo.optimize(data.content)
                const initPath = consolidatePaths(res.data)
                if (initPath.length > 0) {
                  const initAnalysis = new SVGPathData(initPath)
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

                  const reoptimize = await svgo.optimize(
                    `<svg xmlns="http://www.w3.org/2000/svg"><path d='${scaledPath}'/></svg>`
                  )
                  rr.optimizedPath = consolidatePaths(reoptimize.data).trim()

                  const obbox = initAnalysis.getBounds(r.optimizedPath)

                  if (r.optimizedPath.length < MAX_OPTIMIZED_PATH_LENGTH) {
                    all.push({
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
                  bulkOp.insert(rr)
                }
                potentiallyFinalize()
              } catch (err) {
                console.error('Unable to parse path', err)
                potentiallyFinalize()
              }
            }
          })
        }

        results.forEach((r) => {
          if (NO_CACHE || localIds.indexOf(r.id) === -1) {
            if (opts.includeSizes) {
              probe(r.icon_url).then((result) => {
                cont(r, result.width, result.height)
              })
            } else {
              cont(r)
            }
          } else {
            att += 1
            potentiallyFinalize()
          }
        })
      } else {
        cb(null, { data: [], hasMoreData: false })
      }
    }
    return Meteor.wrapAsync(getPaths)()
  }
  return false
}

Meteor.methods(method)
