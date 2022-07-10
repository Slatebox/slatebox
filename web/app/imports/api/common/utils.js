/* eslint-disable prefer-destructuring */
const utils = {
  ipFromConnection(connection) {
    let ip
    if (connection.httpHeaders && connection.httpHeaders['x-forwarded-for']) {
      ip = connection.httpHeaders['x-forwarded-for']
        .split(/[ ,]/)
        .filter((a) => a.trim())[0]
    } else {
      ip = connection.clientAddress
    }
    // ip = _._property((ip || '').match(/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/), '0');
    return ip
  },
  async pause(millis) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve()
      }, millis)
    })
  },
  extractIdFromWebsocketUrl(url) {
    return url
      .split('/sockjs/')[1]
      .replace('/websocket', '')
      .replace(/\//gi, '-')
  },
}

export default utils
