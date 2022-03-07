import CONSTANTS from '../../imports/api/common/constants'
import {
  Claims,
  CachedImages,
  CachedImageTiming,
  SlateSnapshots,
  Collaboration,
  Slates,
} from '../../imports/api/common/models'
import themeGenerator from './themeGenerator.json'

if (Claims.find({ _id: 'admin' }).count() === 0) {
  Object.keys(CONSTANTS.claims).forEach((c) => {
    Claims.insert(CONSTANTS.claims[c])
  })
}

if (Collaboration.find().count() === 0) {
  Collaboration.rawCollection().createIndex({
    slateId: 1,
    dated: 1,
    instanceId: 1,
  })
}

const tg = Slates.findOne({ isThemeGenerator: true })
if (!tg) {
  Slates.insert(themeGenerator)
}

if (CachedImages.find().count() === 0) {
  CachedImages.rawCollection().createIndex({ url: 1, created: 1 })
  CachedImageTiming.rawCollection().createIndex({
    provider: 1,
    filter: 1,
    lastSearched: 1,
  })
  // CachedImages.rawCollection().createIndex( { created: 1 }, { expireAfterSeconds: 60 * 60 * 24 } );
}

if (SlateSnapshots.find().count() === 0) {
  SlateSnapshots.rawCollection().createIndex({
    slateId: 1,
    userId: 1,
    created: 1,
  })
  SlateSnapshots.rawCollection().createIndex(
    { created: 1 },
    { expireAfterSeconds: 60 * 60 * 24 * 3 }
  ) // 3 rolling days of snapshots for every slate
}
