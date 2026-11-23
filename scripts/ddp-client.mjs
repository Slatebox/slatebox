// A small DDP client for the live access probes: a raw Meteor connection, like any browser or
// script can open, with no help from the app's own client code.
import { createHash, randomBytes } from 'node:crypto'

const open = new Set()
export const closeAll = () => { for (const ws of open) ws.close(); open.clear() }

export const appUrl = () => (process.env.SLATEBOX_APP_URL || '').replace(/\/+$/, '')

export async function connect(base = appUrl()) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/websocket')
  open.add(ws)
  let next = 0
  const pending = new Map()
  const subs = new Map()
  const docs = new Map()
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('error', reject, { once: true })
    ws.addEventListener('message', function first(event) {
      const msg = JSON.parse(event.data)
      if (msg.msg === 'connected') { ws.removeEventListener('message', first); resolve() }
    })
  })
  ws.addEventListener('open', () => ws.send(JSON.stringify({ msg: 'connect', version: '1', support: ['1'] })))
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.msg === 'ping') return ws.send(JSON.stringify({ msg: 'pong', id: msg.id }))
    if (msg.msg === 'result') {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) p.reject(Object.assign(new Error(msg.error.reason || msg.error.message || msg.error.error), { ddp: msg.error }))
      else p.resolve(msg.result)
    }
    if (msg.msg === 'added' || msg.msg === 'changed') {
      const c = docs.get(msg.collection) || new Map()
      docs.set(msg.collection, c)
      c.set(msg.id, { _id: msg.id, ...(c.get(msg.id) || {}), ...(msg.fields || {}) })
    }
    if (msg.msg === 'removed') docs.get(msg.collection)?.delete(msg.id)
    if (msg.msg === 'ready') for (const id of msg.subs) subs.get(id)?.resolve('ready')
    if (msg.msg === 'nosub') subs.get(msg.id)?.resolve(msg.error ? 'error:' + (msg.error.reason || msg.error.error) : 'nosub')
  })
  await opened
  const client = {
    ws,
    docs,
    call(method, ...params) {
      const id = String(++next)
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ msg: 'method', method, params, id }))
        setTimeout(() => { if (pending.delete(id)) reject(new Error('timeout ' + method)) }, 20000).unref()
      })
    },
    // Resolves to 'ready', 'nosub' or 'error:...', after a short settle so added docs arrive.
    subscribe(name, ...params) {
      const id = 's' + ++next
      return new Promise((resolve) => {
        subs.set(id, { resolve: (state) => setTimeout(() => resolve(state), 150) })
        ws.send(JSON.stringify({ msg: 'sub', id, name, params }))
        setTimeout(() => resolve('timeout'), 8000).unref()
      })
    },
    collection: (name) => [...(docs.get(name)?.values() || [])],
    async login(email, password) {
      const result = await client.call('login', { user: { email }, password: digest(password) })
      client.userId = result.id
      client.token = result.token
      return result
    },
    close: () => ws.close(),
  }
  return client
}

export const digest = (password) => ({ digest: createHash('sha256').update(password).digest('hex'), algorithm: 'sha-256' })
export const uniqueEmail = (label) => `${label}-${randomBytes(5).toString('hex')}@probe.invalid`

// A fresh registered account on its own connection.
export async function registeredUser(label = 'member', extra = {}) {
  const client = await connect()
  const email = uniqueEmail(label)
  const password = 'Probe-' + randomBytes(6).toString('hex')
  const result = await client.call('createUser', { email, password: digest(password), profile: { firstName: label, lastName: 'Probe' }, ...extra })
  client.userId = result.id
  client.token = result.token
  client.email = email
  client.password = password
  return client
}

// A guest exactly as the app makes one: createAnonymous, then sign in with the token it returns.
export async function guestUser(opts = {}) {
  const client = await connect()
  const { email, token } = await client.call('users.createAnonymous', opts)
  const result = await client.call('login', { resume: token })
  client.userId = result.id
  client.token = result.token
  client.email = email
  return client
}

export const errorOf = (promise) => promise.then((value) => ({ value }), (error) => ({ error }))
