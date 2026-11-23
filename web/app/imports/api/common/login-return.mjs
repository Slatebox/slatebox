// Where signing in returns a person: to the workshop room they were joining (?room=), to the
// consent page an MCP app sent them to (?oauth=<request id>), or to the pay sheet a &pay= link
// asked for (Login.jsx adds billing/pay/pay-url.mjs loginReturn), otherwise home. A login
// link opens in a new tab, so the place is also remembered (thirty minutes, read once). Only
// these three shapes of address are ever returned; anything else goes home.
const ROOM = /^[a-f0-9]{10}$/
const REQUEST = /^[0-9a-f]{32}$/
const KEY = 'slatebox.workshopLogin'
const LIFETIME_MS = 30 * 60 * 1000

const allowed = (path) =>
  (typeof path === 'string' && (/^\/workshops\?room=[a-f0-9]{10}$/.test(path) || /^\/oauth\/consent\?request=[0-9a-f]{32}$/.test(path) ||
    /^\/profile\?tab=credits&pay=(pro|topup|card|manage)$/.test(path)))

export function loginDestination(query) {
  const room = query.get('room')
  if (ROOM.test(room || '')) return `/workshops?room=${room}`
  const request = query.get('oauth')
  if (REQUEST.test(request || '')) return `/oauth/consent?request=${request}`
  return '/'
}

export function rememberLoginReturn(storage, destination, now) {
  try {
    storage.removeItem(KEY)
    if (allowed(destination)) storage.setItem(KEY, `${destination}|${now}`)
  } catch {
    // Storage blocked (a private window): the person goes home after signing in.
  }
}

export function recalledLoginReturn(storage, now) {
  let saved = ''
  try {
    saved = storage.getItem(KEY) || ''
    storage.removeItem(KEY)
  } catch {
    // Storage blocked: nothing was remembered.
  }
  const cut = saved.lastIndexOf('|')
  const path = saved.slice(0, cut)
  const at = Number(saved.slice(cut + 1))
  // Before this module the key held a bare room id.
  const destination = ROOM.test(path) ? `/workshops?room=${path}` : path
  return allowed(destination) && now - at < LIFETIME_MS ? destination : '/'
}
