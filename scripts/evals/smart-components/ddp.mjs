// A small DDP client for the live eval: method calls and logins over one WebSocket (Node's own), so the eval
// drives a running app the way a page does (one connection per person: a preview is kept on the connection that
// made it). No dependencies.
import { createHash, randomUUID } from 'node:crypto'

export class DDP {
  constructor(origin) {
    this.url = origin.replace(/^http/, 'ws').replace(/\/+$/, '') + '/websocket'
    this.next = 1
    this.pending = new Map()
    this.userId = null
    this.token = null
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url)
      this.ws = ws
      ws.onopen = () => ws.send(JSON.stringify({ msg: 'connect', version: '1', support: ['1'] }))
      ws.onerror = (event) => reject(new Error('DDP connection failed: ' + (event?.message || this.url)))
      ws.onclose = () => { for (const { reject: no } of this.pending.values()) no(new Error('DDP connection closed')); this.pending.clear() }
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (data.msg === 'connected') resolve(this)
        else if (data.msg === 'ping') ws.send(JSON.stringify({ msg: 'pong', ...(data.id && { id: data.id }) }))
        else if (data.msg === 'result') {
          const wait = this.pending.get(data.id)
          if (!wait) return
          this.pending.delete(data.id)
          if (data.error) {
            const error = new Error(data.error.reason || data.error.message || String(data.error.error))
            error.error = data.error.error
            error.reason = data.error.reason
            error.details = data.error.details
            wait.reject(error)
          } else wait.resolve(data.result)
        }
      }
    })
  }

  call(method, ...params) {
    const id = String(this.next++)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ msg: 'method', method, params, id, randomSeed: randomUUID() }))
    })
  }

  async createAccount(email, password, profile = {}) {
    const digest = createHash('sha256').update(password).digest('hex')
    const result = await this.call('createUser', { email, password: { digest, algorithm: 'sha-256' }, profile })
    this.userId = result.id
    this.token = result.token
    return result
  }

  async resume(token) {
    const result = await this.call('login', { resume: token })
    this.userId = result.id
    this.token = result.token
    return result
  }

  close() { try { this.ws?.close() } catch {} }
}
