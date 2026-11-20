import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../../../imports/api/common/constants'

export default async function getNounPaths(
  nouns,
  limit = 3,
  disableIconPackSearch = true
) {
  return new Promise((resolve, reject) => {
    const all = []
    let finished = 0
    nouns.forEach((nn) => {
      Meteor.call(
        CONSTANTS.methods.nounProject.get,
        {
          limit,
          query: nn,
          page: 1,
          disableIconPackSearch,
        },
        (err, res) => {
          finished += 1
          console.log('got np res', { nouns: nouns.length, finished, results: res?.data?.length ?? 0, error: err?.message || null })
          if (res) {
            all.push(...res.data.map((d) => d.path))
            console.log('added to all', { paths: all.length })
          }
          if (finished === nouns.length) {
            resolve(all)
          }
        }
      )
    })
  })
}
