async function rawMongoSearch(collection, query, op, sort, skip, limit) {
  return new Promise((resolve, reject) => {
    if (op === "count") {
      collection.rawCollection().find(
        query,
        (err, cursor) => {
          if (err) {
            console.error("count failed", err);
            reject(err);
          } else {
            cursor
              .count()
              .then(
              (res) => {
                resolve(res);
              },
              () => {
                reject()
              }
            )
          }
        });
    } else {
      console.log('raw query', query, sort);
      sort = sort || "lastSaved";
      collection.rawCollection().find(
        query,
        (err, cursor) => {
          if (err) {
            console.error("toArray failed", err);
            reject(err)
          } else {
            cursor
              .sort({ [sort]: -1 })
              .skip(skip || 0)
              .limit(limit || Number.MAX_SAFE_INTEGER)
              .toArray()
              .then(
              (res) => {
                resolve(res)
              },
              () => {
                reject()
              }
            )
          }
        }
      );
    }
  });
}

export default rawMongoSearch;