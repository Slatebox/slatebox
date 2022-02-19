/* eslint-disable no-inner-declarations */
// methods.js
import { CONSTANTS } from '../../imports/api/common/constants.js';
import { NounProjectResultsMetaData, NounProjectResults } from '../../imports/api/common/models.js';
import { Random } from 'meteor/random';
import _ from "underscore";
import SVGO from "svgo";
import oauthSignature from "oauth-signature";
import probe from "probe-image-size";
import { HTTP } from 'meteor/http'
import { SVGPathData, SVGPathDataTransformer, SVGPathDataEncoder, SVGPathDataParser } from 'svg-pathdata';

let method = {};

method[CONSTANTS.methods.nounProject.get] = async function (opts) {

  const LIMIT = opts.limit || 25;
  const NO_CACHE = true;
  const PAID_NOUNPROJECT_ACCOUNT = true;
  const MAX_OPTIMIZED_PATH_LENGTH = 35000;

  if (Meteor.user()) {

    const svgo = new SVGO(); //by default loads all optimizations
    let existent = null;
    let raw = [];
    let localIds = [];
    let localResults = [];

    if (!NO_CACHE) {
      NounProjectResultsMetaData.findOne({ _id: opts.query });
      raw = NounProjectResults.find({ "tags.slug": opts.query.toLowerCase() }).fetch();
      localIds = _.map(raw, (r) => { return r._id; });
      localResults = { data: _.map(raw, (r) => { return { title: r.term, path: r.optimizedPath }; }), hasMoreData: false };
    }

    if (!existent && !NO_CACHE) {
      existent = {
        _id: opts.query
        , timestamp: new Date().valueOf()
        , attempts: []
      }
      NounProjectResultsMetaData.insert(existent);
    }

    const _priorAttempt = NO_CACHE ? false : _.find(existent.attempts, (a) => { return a.page === opts.page && a.limit === LIMIT; });
    const _currentPageExceedsData = NO_CACHE ? false : _.filter(existent.attempts, (a) => { return opts.page >= a.page && a.limit === LIMIT && a.hasMoreData === false; });
    if (_priorAttempt || _currentPageExceedsData.length > 0) { // || _emptyFutureAttempts.length > 0

      localResults.hasMoreData = _priorAttempt ? _priorAttempt.hasMoreData : false;
      console.log("returning local mongo results instead of api");
      const l = LIMIT;
      const p = opts.page - 1;
      localResults.data = localResults.data.slice(p * l, (p * l) + l);
      return localResults;

    } else {

      function _getPaths(cb) {

        let url = `http://api.thenounproject.com/icons/${opts.query}?limit_to_public_domain=${PAID_NOUNPROJECT_ACCOUNT ? 0 : 1}`;

        const timestamp = parseInt(new Date().valueOf() / 1000, 10);
        const nonce = Random.id();
        const bulkOp = NO_CACHE ? null : NounProjectResults.rawCollection().initializeUnorderedBulkOp();

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
          limit_to_public_domain: PAID_NOUNPROJECT_ACCOUNT ? 0 : 1
        };

        const signature = oauthSignature.generate(
          "GET"
          , url
          , sigParams,
          Meteor.settings.nounProject.secret);

        const auth = `OAuth oauth_version="1.0", oauth_consumer_key="${Meteor.settings.nounProject.key}", oauth_nonce="${nonce}", oauth_signature_method="HMAC-SHA1", oauth_timestamp="${timestamp}", oauth_signature="${signature}"`;
        let results = [];
        try {
          const _uOpts = { params: { page: opts.page, limit: LIMIT }, headers: { Authorization: auth } };
          console.log("uOpts ", _uOpts);
          results = HTTP.get(url, _uOpts).data.icons; //limit_to_public_domain: 0

        } catch (err) {
          console.log("Error searching noun project ", { err: err });
        }

        //save off the metadata for analysis
        const _hasMoreData = LIMIT === results.length;
        console.log("has more data ?", LIMIT, opts.page, results.length, _hasMoreData);

        if (!NO_CACHE) {
          NounProjectResultsMetaData.update({ _id: opts.query }, {
            $push: {
              attempts: {
                limit: LIMIT
                , page: opts.page
                , count: results.length
                , hasMoreData: _hasMoreData
                , ids: _.map(results, (r) => { return r.id; })
              }
            }
          }
          );
        }

        let _att = 0;
        let _all = [];
        const _errs = [];

        function potentiallyFinalize() {

          if (_att === results.length) {

            if (!NO_CACHE) {

              const _hasOp = bulkOp && bulkOp.s && bulkOp.s.currentBatch
                && bulkOp.s.currentBatch.operations
                && bulkOp.s.currentBatch.operations.length > 0;

              if (_hasOp) {

                bulkOp.execute(function (errx, res) {
                  if (errx) {
                    console.log("error batch inserting into mongo ", errx);
                  } else {
                    console.log("any errors? ", _errs);
                    const l = LIMIT;
                    const p = opts.page - 1;
                    let _extra = localResults.data.slice(p * l, (p * l) + l - _all.length);
                    _all = _all.concat(_extra);
                    cb(null, { data: _all, hasMoreData: _hasMoreData });
                  }
                });

              } else {
                console.log("why no _hasOp? ", bulkOp);
                cb(null, { data: [], hasMoreData: false });
              }

            } else {
              cb(null, { data: _all, hasMoreData: _hasMoreData });
            }
          }
        };

        if (results.length > 0) {
          //now we should loop through the results and extract just the SVG icons

          function consolidatePaths(data) {
            const ssvg = data.split("<path");
            const consolidated = [];
            ssvg.forEach((sp) => {
              if (sp.indexOf("d=") > -1) {
                //inside a <path, split for the d=
                const root = sp.replace("d=\"", "");
                //if the <path d= ends with a z, then use it, otherwise use the "\"/>" to terminate
                const strw = root.indexOf("z") > -1 ? (root.split("z\"")[0] + "z").trim() : root.split("\"/>")[0].trim();
                //some paths start with attrs at the start (in front of the d=), this ensures that every path starts with
                const ssp = strw.indexOf(" M") > -1 ? "M" + strw.split(/ M(.+)/)[1] : strw;
                consolidated.push(ssp);
              }
            });
            return consolidated.join("");
          }

          function _continue(r, width, height) {
            console.log("going to get icon_url", JSON.stringify(r));
            HTTP.get(r.icon_url, async (err, data) => {
              _att++;
              if (err) {
                _errs.push(err);
                potentiallyFinalize();
              } else {
                console.log("got icon ", r.icon_url, data.content);

                // let scaled = utils.centerAndScalePathToFitContainer({
                //   containerSize: 100
                //   , scaleSize: 90
                //   , path: data.content
                // });

                try {
                  //console.log("scaled path to container ", scaled.path);
                  const res = await svgo.optimize(data.content);
                  let initPath = consolidatePaths(res.data);
                  if (initPath.length > 0) {
                    let initAnalysis = new SVGPathData(initPath);
                    const rbbox = initAnalysis.getBounds();
                    let width = (rbbox.maxX - rbbox.minX);
                    let height = (rbbox.maxY - rbbox.minY);
                    let scale = 100 / Math.max(width, height);

                    //move to 0,0
                    let movedPath = initAnalysis.translate(rbbox.minX * -1, rbbox.minY * -1).encode();

                    console.log("moved path ", rbbox.minX * -1, rbbox.minY * -1, movedPath);

                    //scale to fit box of 100 x 100
                    let scaledPath = new SVGPathData(movedPath).scale(scale).encode();

                    console.log("scaled path length ", scale, scaledPath.length);
                    const reoptimize = await svgo.optimize(`<svg xmlns="http://www.w3.org/2000/svg"><path d='${scaledPath}'/></svg>`);
                    r.optimizedPath = consolidatePaths(reoptimize.data).trim();

                    const obbox = initAnalysis.getBounds(r.optimizedPath);
                    console.log("bounded box is now ", obbox);

                    if (r.optimizedPath.length < MAX_OPTIMIZED_PATH_LENGTH) {
                      //r.optimizedPath = `${consolidatePaths(reoptimize.data).replace(/z/gi, " ").trim()}z`; //scaledPath;
                      console.log("final optimized path ", r.optimizedPath.length);
                      _all.push({ title: r.term, path: r.optimizedPath, width: (obbox.maxX - obbox.minX), height: (obbox.maxY - obbox.minY) });
                    }

                    if (r.id) {
                      r._id = r.id;
                      delete r.id;
                    } else {
                      r._id = Random.id();
                    }
                    bulkOp.insert(r);
                  }
                  potentiallyFinalize();
                } catch (err) {
                  console.error("Unable to parse path", err);
                  potentiallyFinalize();
                }
              }
            });
          }

          _.each(results, (r) => {
            if (NO_CACHE || localIds.indexOf(r.id) === -1) {
              console.log("got noun proj result ", r);
              if (opts.includeSizes) {
                console.log("going to get ", opts.includeSizes);
                probe(r.icon_url).then(result => {
                  console.log("result of probe ", result);
                  _continue(r, result.width, result.height);
                });
              } else {
                _continue(r);
              }
            } else {
              _att++;
              potentiallyFinalize();
            }
          });
        } else {
          cb(null, { data: [], hasMoreData: false });
        }
      }

      //try {
      return Meteor.wrapAsync(_getPaths)();
      // } catch (err) {
      //   console.log("unable to return ", JSON.stringify(err));
      // }
    }

  } else {
    return false;
  }
}

Meteor.methods(method);