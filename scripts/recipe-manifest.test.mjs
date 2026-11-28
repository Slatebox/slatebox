// A recipe's manifest (enterprise/common/recipes/manifest.mjs): defineRecipe refuses a mistake at
// import time with a sentence, so a recipe that would misbehave never boots.
import test from 'node:test'
import assert from 'node:assert/strict'
import { defineRecipe, validateManifest, defaultTriggers, publicManifest, ManifestError } from '../enterprise/common/recipes/manifest.mjs'
import { eventsFor, eventSchema, envelope, COMMON_EVENT_NAMES } from '../enterprise/common/recipes/events.mjs'
import { CATALOG } from '../enterprise/common/recipes/catalog.mjs'
import { lastRunLine, runsFor } from '../enterprise/common/recipes/words.mjs'
import { manifest as fixture } from './fixtures/recipes/test-graph.mjs'

const base = () => ({
  id: 'living-map', version: 1, label: 'Living map', agentName: 'Mapper', integration: null,
  triggers: [{ kind: 'schedule', cron: '0 3 * * *', default: true }, { kind: 'manual' }],
  configSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputs: [{ role: 'map', name: 'Map', kind: 'diagram' }],
  cost: { class: 'low', tokensPerRun: [0, 1000], vendorCallsPerRun: [0, 0] }, idPrefix: 'lm',
})

test('a good manifest is frozen, with defaults filled in', () => {
  const m = defineRecipe(base())
  assert.ok(Object.isFrozen(m) && Object.isFrozen(m.outputs[0]))
  assert.deepEqual(m.writes, [])
  assert.equal(m.inputSchema, null)
  assert.deepEqual(defaultTriggers(m, 'Europe/Berlin'), [{ kind: 'schedule', cron: '0 3 * * *', tz: 'Europe/Berlin' }])
  assert.equal(publicManifest(fixture).writes[0].kind, 'github.pr_comment')
  assert.equal(typeof publicManifest(fixture).writes[0].describe, 'undefined', 'functions stay on the server')
})

test('each mistake is refused with a sentence', () => {
  const cases = [
    [{ id: 'X' }, /id is/],
    [{ label: 'Living Map Of Things' }, /sentence case/],
    [{ label: 'AI map' }, /agent/],
    [{ integration: 'jira' }, /integration/],
    [{ triggers: [{ kind: 'vendor', event: 'github.push' }] }, /no integration/],
    [{ triggers: [{ kind: 'schedule', cron: '*/5 * * * *' }] }, /every 15 minutes/],
    [{ triggers: [{ kind: 'schedule', cron: 'nope' }] }, /five-field/],
    [{ triggers: [{ kind: 'inbound' }] }, /inputSchema/],
    [{ configSchema: { type: 'object', properties: {} } }, /refuses undeclared/],
    [{ outputs: [{ role: 'status', name: 'S', kind: 'diagram' }] }, /status slate/],
    [{ outputs: [{ role: 'b', name: 'B', kind: 'board' }] }, /component/],
    [{ writes: [{ kind: 'github.merge' }] }, /writes\[0\]\.kind/],
    [{ integration: 'slack', writes: [{ kind: 'github.pr_comment', describe: () => '', scopeSchema: { type: 'object', properties: {}, additionalProperties: false } }] }, /another integration/],
    [{ events: ['run.finished'] }, /common event/],
    [{ intercepts: ['before.save'] }, /intercept/],
    [{ cost: { class: 'huge', tokensPerRun: [0, 1], vendorCallsPerRun: [0, 1] } }, /cost/],
    [{ idPrefix: 'TOOLONG' }, /idPrefix/],
  ]
  for (const [patch, message] of cases) {
    const wrong = validateManifest({ ...base(), ...patch })
    assert.match(String(wrong), message, JSON.stringify(patch))
    assert.throws(() => defineRecipe({ ...base(), ...patch }), ManifestError)
  }
})

test('events: the common ones and the recipe\'s own, each with its data schema; the envelope', () => {
  assert.ok(eventsFor(fixture).includes('graph.drawn'))
  assert.ok(eventsFor(null).every((e) => COMMON_EVENT_NAMES.includes(e)))
  assert.equal(eventSchema('graph.drawn', null), null)
  const body = envelope({ id: 'evt_1', type: 'run.finished', at: Date.UTC(2026, 10, 27), instance: { _id: 'i1', projectId: 'p1', recipeId: 'r', name: 'R' }, run: { _id: 'run1', trigger: { kind: 'schedule' } }, data: { state: 'done' } })
  assert.deepEqual(Object.keys(body), ['id', 'type', 'at', 'project', 'instance', 'run', 'data'])
  assert.equal(body.run.trigger.kind, 'schedule')
})

test('the built-in catalog is all valid manifests with distinct ids and prefixes', () => {
  assert.equal(new Set(CATALOG.map((m) => m.id)).size, CATALOG.length)
  assert.equal(new Set(CATALOG.map((m) => m.idPrefix)).size, CATALOG.length)
  for (const m of CATALOG) assert.equal(validateManifest(m), null, m.id)
})

test('words: runs for, and the last run line', () => {
  assert.equal(runsFor('GitHub architect', 'Ana'), 'GitHub architect · runs for Ana')
  assert.equal(lastRunLine({ at: Date.UTC(2026, 0, 1, 12, 0), changed: 3 }, Date.UTC(2026, 0, 1, 12, 2)), '2 min ago · 3 notes changed')
  assert.equal(lastRunLine(null), 'Not run yet')
})
