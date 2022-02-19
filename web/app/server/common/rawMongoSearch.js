async function rawMongoSearch(collection, query, op, sort, skip, limit) {
  if (op === "count") {
    const res = await collection.rawCollection().count(query);
    return res;
  } else {
    return await collection.rawCollection().find(query)
      .sort({ [sort]: -1 })
      .skip(skip || 0)
      .limit(limit || Number.MAX_SAFE_INTEGER)
      .toArray();
  }
  // return new Promise((resolve, reject) => {
  //   if (op === "count") {
  //     console.log("rc is ", collection.rawCollection().find);
  //     collection.rawCollection().find(
  //       query,
  //       (err, cursor) => {
  //         if (err) {
  //           console.error("count failed", err);
  //           reject(err);
  //         } else {
  //           cursor
  //             .count()
  //             .then(
  //             (res) => {
  //               resolve(res);
  //             },
  //             () => {
  //               reject()
  //             }
  //           )
  //         }
  //       });
  //   } else {
  //     console.log('raw query', query, sort);
  //     sort = sort || "lastSaved";
  //     collection.rawCollection().find(
  //       query,
  //       (err, cursor) => {
  //         if (err) {
  //           console.error("toArray failed", err);
  //           reject(err)
  //         } else {
  //           cursor
  //             .sort({ [sort]: -1 })
  //             .skip(skip || 0)
  //             .limit(limit || Number.MAX_SAFE_INTEGER)
  //             .toArray()
  //             .then(
  //             (res) => {
  //               resolve(res)
  //             },
  //             () => {
  //               reject()
  //             }
  //           )
  //         }
  //       }
  //     );
  //   }
  // });
}

export default rawMongoSearch;