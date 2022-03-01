async function rawMongoSearch(collection, query, op, sort, skip, limit) {
  if (op === 'count') {
    const res = await collection.rawCollection().count(query)
    return res
  }
  return collection
    .rawCollection()
    .find(query)
    .sort({ [sort]: -1 })
    .skip(skip || 0)
    .limit(limit || Number.MAX_SAFE_INTEGER)
    .toArray()
}

export default rawMongoSearch
