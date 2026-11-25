import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  installMeter, runAIAction, currentAIAction, aiRequestGate, chargeProviderCall, chargeFixed, pinnedEngine,
  UNMETERED_MESSAGE, CEILING_MESSAGE,
} from '../web/app/server/metering/context.mjs'
import { route, DEFAULT_METERING } from '../web/app/server/metering/policy.mjs'
import { aiCostMicros, actionCeilingMicros } from '../web/app/server/metering/prices.mjs'

const app = new URL('../web/app/', import.meta.url).pathname
const source = path => readFileSync(join(app, path), 'utf8')

// A fake meter shaped like server/metering/meteor.js: begin resolves the route with
// the real policy, record prices with the real table.
function fakeMeter({ person = { id: 'p1', anonymous: false, emailVerified: true }, usage = {} } = {}) {
  const events = [], finished = []
  const meter = {
    enabled: () => true,
    async begin(opts) {
      const decision = route({
        kind: opts.kind || 'ai', person, teamId: null, keys: {}, wallets: {},
        usage: { aiActionsToday: 0, aiMicrosMonth: 0, freeMicrosToday: 0, voiceMinutesMonth: 0, videoMinutesMonth: 0, ...usage },
        global: { monthFreeMicros: 0, todayFreeMicros: 0 }, estimateMicros: opts.estimateMicros ?? 5000,
        settings: DEFAULT_METERING, now: Date.UTC(2026, 10, 19),
      })
      if (!decision.ok) throw Object.assign(new Error(decision.message), { error: decision.code })
      return { actionId: 'a' + events.length, feature: opts.feature, route: decision.route, payer: decision.payer,
        spentMicros: 0, ceilingMicros: actionCeilingMicros(opts.feature), countsAsDraft: opts.countsAsDraft !== false }
    },
    async record(action, entry) {
      if (events.some(e => e.ref === entry.ref)) return { costMicros: 0, duplicate: true }
      const costMicros = entry.costMicros ?? aiCostMicros(entry).costMicros
      events.push({ ...entry, costMicros, actionId: action.actionId, route: action.route })
      return { costMicros }
    },
    async finish(action, { ok }) { finished.push({ actionId: action.actionId, ok, draft: ok && action.countsAsDraft && action.route === 'free' }) },
  }
  return { meter, events, finished }
}

test('with metering on and no action, req returns the unmetered abort before any provider call', () => {
  installMeter(fakeMeter().meter)
  const gate = aiRequestGate()
  assert.equal(gate.abort, true)
  assert.equal(gate.abortMessage, UNMETERED_MESSAGE)
  assert.equal(UNMETERED_MESSAGE, 'This AI request is not counted, so it was not sent.')
  installMeter(null)
  assert.equal(aiRequestGate(), null, 'metering off (self-host default) sends as before')
  // req.js consults the gate before it resolves a key or builds a request
  const reqSource = source('server/methods/ai/req.js')
  const body = reqSource.slice(reqSource.indexOf('async function requestFromProvider'))
  const gateAt = body.indexOf('aiRequestGate()')
  assert.ok(gateAt > 0, 'req.js calls aiRequestGate')
  // (the key is opened with the route, resolveRequestConnection: the backend's key store, never the settings file)
  for (const marker of ['resolveRequestConnection(', 'fetch(endpoint', 'sdkChatRequest(']) {
    assert.ok(body.indexOf(marker) > gateAt, marker + ' comes after the gate')
  }
  assert.match(body, /status: 'unmetered'/)
})

test('every AI entry point calls runAIAction', () => {
  const entries = [
    ['server/methods/workshops.js', "'workshops.draft'"],
    ['server/methods/workshops.js', 'function workshopChatTurn'],
    ['server/methods/openai.js', 'method[CONSTANTS.methods.openai.welcome]'],
    ['server/methods/openai.js', 'method[CONSTANTS.methods.openai.chat]'],
    ['server/methods/openai.js', 'method[CONSTANTS.methods.openai.routeSlateMessage]'],
    ['server/methods/presentations.js', 'method[CONSTANTS.methods.presentations.analyze]'],
    ['server/methods/stabilityai.js', 'method[CONSTANTS.methods.stabilityai.generate]'],
    ['server/methods/images.js', 'method[CONSTANTS.methods.images.search]'],
    // exec: the in-app conversation's AI path (the model writes exec code); every model call of the turn
    ['server/methods/canvas-conversation.js', 'const result = useAI ?'],
  ]
  for (const [file, marker] of entries) {
    const text = source(file)
    const at = text.indexOf(marker)
    assert.ok(at >= 0, `${file} has ${marker}`)
    assert.match(text.slice(at, at + 900), /runAIAction\(|metered\(/, `${marker} in ${file} runs inside runAIAction`)
  }
})

test('the set of files that call req is known, and each is reached only through a metered entry point', () => {
  const files = []
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(m?js|cjs)$/.test(name) && /import req from '\.\.?\/(ai\/)?req'/.test(readFileSync(full, 'utf8'))) files.push(full.slice(app.length))
    }
  }
  walk(join(app, 'server'))
  assert.deepEqual(files.sort(), [
    // reached through openai.chat (fire-and-forget chain inherits the action)
    'server/methods/ai/processConversation.js',
    // no callers today; req fails closed if they are ever wired up unmetered
    'server/methods/ai/processScratch.js',
    'server/methods/ai/processTemplateAugment.js',
    // the in-app conversation on exec: its AI turn runs inside runAIAction
    'server/methods/canvas-conversation.js',
    'server/methods/openai.js',
    'server/methods/presentations.js',
    'server/methods/workshops.js',
  ])
  // nativeCanvas.preview reaches AI only through workshops.draft
  assert.doesNotMatch(source('server/methods/native-conversation.js'), /import req/)
  assert.match(source('server/methods/native-conversation.js'), /workshops\.draft/)
})

test('image search the model asks for inside a conversation is charged to the running action', () => {
  const images = source('server/methods/images.js')
  const at = images.indexOf('export async function searchGoogleImages')
  assert.match(images.slice(at, at + 1200), /chargeFixed\(/)
  assert.doesNotMatch(images, /settings\.public\.googleImageSearch/)
})

test('retries and fallbacks are each charged, once per audit row', async () => {
  const { meter, events } = fakeMeter()
  installMeter(meter)
  await runAIAction({ feature: 'generation', estimateMicros: 30000 }, async () => {
    for (const ref of ['audit-1', 'audit-2', 'audit-3', 'audit-3']) {
      await chargeProviderCall({ ref, model: 'Qwen/Qwen3-235B-A22B-Instruct-2507', usage: { inputTokens: 10000, outputTokens: 2000 } })
    }
  })
  assert.deepEqual(events.map(e => e.ref), ['audit-1', 'audit-2', 'audit-3'])
  assert.ok(events.every(e => e.costMicros > 0))
  installMeter(null)
})

test('the per-action ceiling stops a chain', async () => {
  const { meter } = fakeMeter()
  installMeter(meter)
  const results = []
  await runAIAction({ feature: 'workshop', estimateMicros: 5000 }, async () => {
    for (let i = 0; i < 6; i++) {
      results.push(await chargeProviderCall({ ref: 'r' + i, model: 'unknown/dear-model', usage: { inputTokens: 5000, outputTokens: 1000 } }))
    }
  })
  const stopped = results.findIndex(r => r.stop)
  assert.ok(stopped >= 0 && stopped < 5, 'the chain stops before six dear calls')
  assert.equal(results[stopped].abortMessage, CEILING_MESSAGE)
  assert.equal(CEILING_MESSAGE, 'This request grew too large. Try a shorter brief.')
  assert.match(source('server/methods/ai/req.js'), /chargeProviderCall\(/)
  installMeter(null)
})

test('welcome, presentation and image generation are counted as drafts on the free route', async () => {
  const { meter, finished, events } = fakeMeter()
  installMeter(meter)
  for (const feature of ['welcome', 'presentation', 'image-generation']) {
    await runAIAction({ feature }, async () => {
      if (feature === 'image-generation') await chargeFixed({ ref: 'img-1', kind: 'ai', costMicros: 30000, model: 'stability' })
    })
  }
  assert.deepEqual(finished.map(f => f.draft), [true, true, true])
  assert.equal(events.find(e => e.ref === 'img-1').costMicros, 30000)
  // routing a message counts dollars but not a draft
  await runAIAction({ feature: 'welcome', countsAsDraft: false }, async () => {})
  assert.equal(finished.at(-1).draft, false)
  installMeter(null)
})

test('a nested call inherits the running action instead of charging twice', async () => {
  const { meter, finished } = fakeMeter()
  installMeter(meter)
  await runAIAction({ feature: 'workshop' }, async outer => {
    await runAIAction({ feature: 'workshop' }, async inner => assert.equal(inner, outer))
    assert.equal(currentAIAction(), outer)
  })
  assert.equal(finished.length, 1)
  assert.equal(currentAIAction(), null)
  installMeter(null)
})

test('a fire-and-forget chain started inside an action is still charged to it', async () => {
  const { meter, events } = fakeMeter()
  installMeter(meter)
  let later
  await runAIAction({ feature: 'generation' }, async () => {
    later = new Promise(resolve => setTimeout(async () => {
      resolve(await chargeProviderCall({ ref: 'late', model: 'Qwen/Qwen3-235B-A22B-Instruct-2507', usage: { inputTokens: 100, outputTokens: 100 } }))
    }, 5))
  })
  await later
  assert.equal(events.find(e => e.ref === 'late').actionId, 'a0')
  installMeter(null)
})

test('anonymous accounts are refused in the legacy chat', async () => {
  installMeter(fakeMeter({ person: { id: 'g', anonymous: true } }).meter)
  await assert.rejects(runAIAction({ feature: 'generation' }, async () => 'ran'), { message: 'Sign in to use AI.' })
  installMeter(null)
  const openai = source('server/methods/openai.js')
  assert.doesNotMatch(openai, /isMasterUser/)
  assert.doesNotMatch(openai, /getAIUsage/)
})

test('the client engine is ignored on every route: the server uses the feature default', () => {
  const config = { engine: 'Qwen/Qwen3-235B-A22B-Instruct-2507' }
  assert.equal(pinnedEngine(config, 'anthropic/claude-sonnet-4-6'), config.engine)
  assert.equal(pinnedEngine(config, undefined), config.engine)
  const openai = source('server/methods/openai.js')
  assert.doesNotMatch(openai, /generationConfig\?\.engine \|\| opts\.engine/)
})
