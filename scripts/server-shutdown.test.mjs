import { strict as assert } from 'node:assert'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { exitOnTerminate } from '../web/app/server/shutdown.mjs'

// 2026-11-25 (v2.0.0 ship): the image runs `node main.js` as PID 1, which ignores an unhandled SIGTERM.
// The old pod served on for the 30 s grace period after the rollout, then SIGKILL dropped the
// post-deploy browser check's connection mid-spec (app-concept-map: the reopened canvas never drew).

const fakeProcess = () => Object.assign(new EventEmitter(), { exits: [], exit(code) { this.exits.push(code) } })

test('SIGTERM closes the listener and exits 0 once calls in flight have had their drain time', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const proc = fakeProcess()
  let closed = 0
  exitOnTerminate({ proc, server: { close() { closed++ } }, drainMs: 1000, log() {} })
  proc.emit('SIGTERM')
  assert.equal(closed, 1)
  assert.deepEqual(proc.exits, [])
  t.mock.timers.tick(999)
  assert.deepEqual(proc.exits, [])
  t.mock.timers.tick(1)
  assert.deepEqual(proc.exits, [0])
})

test('a second signal changes nothing; SIGINT stops the same way', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const proc = fakeProcess()
  let closed = 0
  exitOnTerminate({ proc, server: { close() { closed++; throw new Error('not running') } }, drainMs: 10, log() {} })
  proc.emit('SIGINT')
  proc.emit('SIGTERM')
  t.mock.timers.tick(10)
  assert.equal(closed, 1)
  assert.deepEqual(proc.exits, [0])
})

test('a real server process exits 0 on SIGTERM (handled, not killed by the signal)', async () => {
  const module = new URL('../web/app/server/shutdown.mjs', import.meta.url).href
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { createServer } from 'node:http'
    import { exitOnTerminate } from ${JSON.stringify(module)}
    const server = createServer((q, s) => s.end('ok')).listen(0, () => console.log('ready'))
    exitOnTerminate({ server, drainMs: 50, log() {} })
  `], { stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise(resolve => child.stdout.once('data', resolve))
  const started = Date.now()
  child.kill('SIGTERM')
  const [code, signal] = await new Promise(resolve => child.once('exit', (c, s) => resolve([c, s])))
  assert.equal(signal, null)
  assert.equal(code, 0)
  assert.ok(Date.now() - started < 3000)
})

test('the Meteor server installs the handler on its own HTTP server', () => {
  const main = readFileSync(fileURLToPath(new URL('../web/app/server/main.js', import.meta.url)), 'utf8')
  assert.match(main, /import \{ exitOnTerminate \} from '\.\/shutdown\.mjs'/)
  assert.match(main, /exitOnTerminate\(\{ server: WebApp\.httpServer, drainMs: Meteor\.isProduction \? 1000 : 0 \}\)/)
})
