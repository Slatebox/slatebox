import { PricingTiers } from "./models";

export const utils = {
  ipFromConnection: function (connection) {
    let ip;
    if (connection.httpHeaders && connection.httpHeaders['x-forwarded-for']){
      ip = connection.httpHeaders['x-forwarded-for']
        .split(/[ ,]/)
        .filter(function(a){return a.trim()})[0];
    } else {
      ip = connection.clientAddress;
    }
    console.log("ip found is ", ip, connection.httpHeaders);
    //ip = _._property((ip || '').match(/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/), '0');
    return ip;
  },
  pause: async function(millis) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve();
      }, millis)
    });
  },
  uniqBy: (arr, predicate) => {
    if (!Array.isArray(arr)) { return []; }
    const cb = typeof predicate === 'function' ? predicate : (o) => o[predicate];
    const pickedObjects = arr
      .filter(item => item)
      .reduce((map, item) => {
          const key = cb(item);
          if (!key) { return map; }
          return map.has(key) ? map : map.set(key, item);
      }, new Map())
      .values();
    return [...pickedObjects];
  }
};