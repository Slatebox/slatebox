import { ownedSnapshotKey } from './presentationSnapshot.mjs'

export async function featuredPresentationFeed({ presentations, baseUrl, assetBase, intentionId, limit }) {
  // The original feature switch was shown only to master users editing their own decks.
  // Check legacy flags against that role before listing them on the public site.
  const featured = await presentations.aggregate([
    { $match: { intentionId, isPublished: true, isPublic: true, isFeatured: true, playOnHover: true, autoplayOnPublish: true } },
    { $sort: { timestamp: -1, _id: 1 } },
    { $project: { slateShareId: 1, name: 1, background: 1, imageUrl: 1, snapshotGeneration: 1, userId: 1 } },
    { $lookup: {
      from: 'users', localField: 'userId', foreignField: '_id', as: 'editor',
      pipeline: [{ $match: { isMasterUser: true } }, { $project: { _id: 1 } }],
    } },
    { $match: { 'editor.0': { $exists: true } } },
    { $limit: limit },
  ]).toArray()
  return featured.flatMap(deck => {
    if (typeof deck.slateShareId !== 'string' || !/^[\w-]{1,80}$/.test(deck.slateShareId)) return []
    const item = {
      _id: deck._id, slateShareId: deck.slateShareId,
      url: new URL('/present/' + deck.slateShareId, baseUrl).href,
    }
    if (typeof deck.name === 'string') item.name = deck.name
    if (typeof deck.background === 'string' && /^#[\da-f]{3,8}$/i.test(deck.background)) item.background = deck.background
    if (typeof deck.imageUrl === 'string' && ownedSnapshotKey(deck.imageUrl, assetBase, deck._id, deck.snapshotGeneration)) item.imageUrl = deck.imageUrl
    return [item]
  })
}
