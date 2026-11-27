// Method and login timing (web/app/server/metrics): one compact line per 5-minute window with the
// calls, p50, p95 and errors of each method and publication, names and durations only. Off by default.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  MAX_NAMES, SAMPLES_PER_NAME, WINDOW_MS, createMethodTiming, percentile, sampleRateOf, timingSettings,
} from '../web/app/server/metrics/method-timing.mjs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

function clock(start = Date.UTC(2026, 10, 27, 1, 0, 0)) {
  let t = start
  return { now: () => t, advance: ms => { t += ms } }
}

test('nearest-rank percentiles', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1)
  assert.equal(percentile(values, 50), 50)
  assert.equal(percentile(values, 95), 95)
  assert.equal(percentile([7], 95), 7)
  assert.equal(percentile([], 50), 0)
})

test('one line per window: [calls, p50, p95, errors] per name, busiest first, publications as sub:', () => {
  const lines = []
  const c = clock()
  const timing = createMethodTiming({ now: c.now, log: line => lines.push(line) })
  for (let ms = 1; ms <= 20; ms++) timing.record('method', 'login', ms)
  timing.record('method', 'slates.update', 30)
  timing.record('method', 'slates.update', 50, true)
  timing.record('publication', 'joinedSlates.rows', 12)
  c.advance(WINDOW_MS)
  const summary = timing.flush()
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^\[method-timing\] \{.*\}$/)
  assert.doesNotMatch(lines[0], /\n/)
  assert.deepEqual(JSON.parse(lines[0].slice('[method-timing] '.length)), summary)
  assert.equal(summary.at, '2026-11-27T01:00:00.000Z')
  assert.equal(summary.s, 300)
  assert.deepEqual(Object.keys(summary.m), ['login', 'slates.update', 'sub:joinedSlates.rows'])
  assert.deepEqual(summary.m.login, [20, 10, 19, 0])
  assert.deepEqual(summary.m['slates.update'], [2, 30, 50, 1])
  assert.deepEqual(summary.m['sub:joinedSlates.rows'], [1, 12, 12, 0])
})

test('a window with no calls writes nothing, and each window starts empty', () => {
  const lines = []
  const timing = createMethodTiming({ log: line => lines.push(line) })
  assert.equal(timing.flush(), null)
  timing.record('method', 'login', 5)
  timing.flush()
  assert.equal(timing.flush(), null)
  assert.equal(lines.length, 1)
})

test('only names and durations reach the line: odd names fold into other, names are capped', () => {
  const timing = createMethodTiming({ log: () => {} })
  timing.record('method', 'user@example.com {"password":"x"}', 3)
  timing.record('method', 'login', -1)
  timing.record('method', 'login', Number.NaN)
  for (let i = 0; i < MAX_NAMES + 10; i++) timing.record('method', `m${i}`, 1)
  const { m } = timing.summary()
  assert.ok(!JSON.stringify(m).includes('example.com'))
  assert.equal(m.login, undefined, 'negative and non-numeric durations are dropped')
  assert.equal(Object.keys(m).length, MAX_NAMES)
  // 'other' takes one of the slots: the odd name plus the 11 names past the cap
  assert.deepEqual(m.other, [12, 1, 3, 0])
})

test('sampling keeps only that share of calls, and the reservoir bounds memory per name', () => {
  let n = 0
  const alternate = () => (n++ % 2 ? 0.9 : 0.1)
  const sampled = createMethodTiming({ sampleRate: 0.5, random: alternate, log: () => {} })
  for (let i = 0; i < 10; i++) sampled.record('method', 'login', 4)
  const line = sampled.summary()
  assert.equal(line.rate, 0.5)
  assert.equal(line.m.login[0], 5)

  const busy = createMethodTiming({ log: () => {} })
  for (let i = 0; i < SAMPLES_PER_NAME * 3; i++) busy.record('method', 'slates.update', i % 100)
  const [calls, p50, p95] = busy.summary().m['slates.update']
  assert.equal(calls, SAMPLES_PER_NAME * 3)
  assert.ok(p50 >= 35 && p50 <= 65, `p50 ${p50}`)
  assert.ok(p95 >= 85, `p95 ${p95}`)
})

test('off unless settings.metrics.methodTiming is true; a bad sampleRate means every call', () => {
  assert.deepEqual(timingSettings(undefined), { on: false, sampleRate: 1 })
  assert.deepEqual(timingSettings({}), { on: false, sampleRate: 1 })
  assert.deepEqual(timingSettings({ metrics: { methodTiming: 'yes' } }), { on: false, sampleRate: 1 })
  assert.deepEqual(timingSettings({ metrics: { methodTiming: true, sampleRate: 0.25 } }), { on: true, sampleRate: 0.25 })
  assert.equal(sampleRateOf(2), 1)
  assert.equal(sampleRateOf('x'), 1)
  assert.equal(sampleRateOf(0), 0)
})

test('the server wires it first, from Meteor instrumentation, and switches emission off when off', () => {
  const main = read('web/app/server/main.js')
  assert.ok(main.indexOf("import './metrics/meteor'") < main.indexOf("import './methods/users'"))
  assert.match(read('web/app/.meteor/packages'), /^instrumentation@/m)
  const wiring = read('web/app/server/metrics/meteor.js')
  assert.match(wiring, /if \(!on\) \{\n\s+Instrumentation\.configure\(\{ enabled: false \}\)/)
  for (const event of ['method.end', 'method.error', 'publication.ready', 'publication.error'])
    assert.ok(wiring.includes(`Instrumentation.on('${event}'`), event)
  assert.match(wiring, /captureMethodArgs: false, captureMethodResult: false, captureClientAddress: false/)
})

test('settings.example.json documents it, off; the self-hosted image does not turn it on', () => {
  const example = JSON.parse(read('web/app/settings.example.json'))
  assert.equal(example.metrics.methodTiming, false)
  assert.match(example.metrics['//'], /methodTiming/)
  assert.doesNotMatch(read('self-host/rootfs/opt/slatebox/lib/configure.mjs'), /methodTiming/)
  assert.doesNotMatch(read('self-host/init.mjs'), /methodTiming/)
})

test('a method called from inside another method or publication is call:<name>, apart from the client calls', () => {
  const c = clock()
  const timing = createMethodTiming({ now: c.now, log: () => {} })
  timing.record('method', 'workshops.account', 40)
  timing.record('call', 'workshops.account', 2)
  timing.record('call', 'workshops.account', 3, true)
  const summary = timing.summary()
  assert.deepEqual(summary.m['workshops.account'], [1, 40, 40, 0])
  assert.deepEqual(summary.m['call:workshops.account'], [2, 2, 3, 1])
})

test('the Meteor wiring marks a nested call by the caller\'s invocation at method.start', () => {
  const wiring = read('web/app/server/metrics/meteor.js')
  assert.match(wiring, /Instrumentation\.on\('method\.start'/)
  assert.match(wiring, /DDP\._CurrentMethodInvocation\.get\(\)/)
  assert.match(wiring, /DDP\._CurrentPublicationInvocation\.get\(\)/)
  assert.match(wiring, /'call' : 'method'/)
})
