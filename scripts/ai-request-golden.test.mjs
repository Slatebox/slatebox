// The board and canvas call sites send req() exactly what they sent before the surface catalogue,
// apart from the request feature that now names their own surface: lane chat and map chat send
// lane-chat and map-chat, board drafting keeps workshop, the canvas conversation sends canvas and
// the Slatebox agent sends agent. The goldens were captured from d8105c12 with
// `node scripts/ai-request-golden.mjs <that tree>/web/app`. Every one of those features still
// reaches the conversation choice, and every meter feature is unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { choiceFeatureFor } from '../web/app/server/methods/ai/connections.mjs'

const here = (path) => new URL(path, import.meta.url)
const golden = JSON.parse(readFileSync(here('./fixtures/ai-request/call-sites.golden.json'), 'utf8'))
const FEATURE = {
  laneChat: 'lane-chat', mapChat: 'map-chat', 'draft:lanes': 'workshop', 'draft:map': 'workshop', 'draft:release-plan': 'workshop',
  'draft:revision': 'workshop', canvas: 'canvas', agent: 'agent',
}

test('the four call sites send the same request as before, with their own request feature', () => {
  // its own process: the module hooks that stub Meteor are registered once per process
  const now = JSON.parse(execFileSync(process.execPath, ['--no-deprecation', here('./ai-request-golden.mjs').pathname], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }))
  assert.deepEqual(Object.keys(now), Object.keys(FEATURE))
  for (const [site, feature] of Object.entries(FEATURE)) {
    assert.equal(golden[site].request.feature, 'workshop', `${site} sent workshop before`)
    assert.equal(now[site].request.feature, feature, site)
    assert.deepEqual({ ...now[site].request, feature: 'workshop' }, golden[site].request, `${site}: only the feature changed`)
    assert.deepEqual(now[site].retries, golden[site].retries, `${site}: the same retry prompts`)
    assert.equal(choiceFeatureFor(feature), choiceFeatureFor('workshop'), `${site} reaches the same choice`)
  }
})

test('the meter features stay as they were: canvas and agent meter as workshop, board chat as lane-chat and map-chat', () => {
  const read = (path) => readFileSync(here(`../web/app/${path}`), 'utf8')
  assert.match(read('server/agents/meteor.js'), /runAIAction\(\{ feature: 'workshop', userId \}, \(\) => fn\(\{ useAI: true, model: modelFor\(null, 'agent'\) \}\)\)/)
  const canvas = read('server/methods/canvas-conversation.js')
  assert.match(canvas, /runAIAction\(\{ feature: 'workshop' \}, turn\)/)
  assert.match(canvas, /export function modelFor\(shareId, feature = 'canvas'\)/)
  const workshops = read('server/methods/workshops.js')
  assert.match(workshops, /runAIAction\(\{ feature: map \? 'map-chat' : 'lane-chat' \}/)
  assert.match(workshops, /runAIAction\(\{ feature: 'workshop' \}, \(\) => draftWorkshop/)
})
