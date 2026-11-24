// The owner's decision path (test.slatebox.com, 2026-11-23): lanes The question → Option A / Option B → Decide, a card
// "asdf" in Decide, selected; Ask Slatebox "move backt o question" failed with "muse-ember-1.0 (this server's AI) did
// not answer with a tool call ... may not support tool calls". Root cause: the model DID call the tool, correctly, every
// time (a moveToken to "question"); the board refuses that move (no path leads back from Decide), the map chat's check
// turned the proposal down twice, and req.js named every turned-down answer of a request with tools as a model that
// cannot call tools. Now: a refused move is offered as "Move anyway" (owner: "dropping the card where it shouldn't go
// should be possible with a confirmation ... standard in the smart components"), and a model that called the tool is
// never said to be unable to.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { validateWorkshop, workshopCandidate } from 'slateboxjs/workshops/model'
import { catalogPreset } from 'slateboxjs/catalog'
import { mapChangeTool, prepareMapReply } from '../web/app/server/methods/map-chat.mjs'
import { prepareLaneReply } from '../web/app/server/methods/lane-chat.mjs'
import { normalizeProviderResponse } from '../web/app/server/methods/ai/provider.mjs'
import { chosenShapeAbort } from '../web/app/server/methods/ai/shape-abort.mjs'
import { playWorkshopChanges, readWorkshopChanges } from '../web/app/server/methods/workshop-play.mjs'
import { replaceWorkshop } from '../web/app/server/methods/workshop-replace.mjs'

const require = createRequire(import.meta.url)
const { sdkChatRequest } = require('../web/app/server/methods/ai/sdk-chat.cjs')

const decision = () => validateWorkshop({ ...catalogPreset('decision-path'), cards: [{ id: 'token', label: 'asdf', laneId: 'decide' }] })
const sentence = "The question can't be reached from Decide."

// What muse-ember-1.0 answered (recorded 2026-11-23 against https://api.meta.ai/v1 with the app's own request: three
// of three answers were this tool call; the key and ids are not recorded).
const recorded = {
  id: 'chatcmpl-recorded', object: 'chat.completion', created: 1795000000, model: 'muse-ember-1.0',
  choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: 'Moving the selected token back to The question.',
    tool_calls: [{ id: 'call_recorded', type: 'function', function: { name: 'propose_map_edits',
      arguments: JSON.stringify({ reply: 'Moved the selected token from Decide back to The question.', edits: [{ type: 'moveToken', id: 'token', to: 'question' }] }) } }] } }],
  usage: { prompt_tokens: 1200, completion_tokens: 60, total_tokens: 1260 },
}

test('the adapter: the map tool goes to the endpoint with tool_choice auto, and the recorded tool call comes back as one', async () => {
  let sent = null
  const fetcher = async (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body) }
    return new Response(JSON.stringify(recorded), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const body = { model: 'muse-ember-1.0', system: 'Help the editor author a playable map.', tool_choice: 'auto', max_tokens: 4000,
    messages: [{ role: 'user', content: JSON.stringify({ currentMap: decision(), selection: { kind: 'card', id: 'token' }, message: 'move backt o question' }) }] }
  const response = await sdkChatRequest({ provider: 'connection', endpoint: 'https://api.meta.ai/v1/chat/completions', apiKey: 'not-a-key', body, functions: [mapChangeTool], fetcher })
  assert.equal(sent.url, 'https://api.meta.ai/v1/chat/completions')
  assert.equal(sent.body.tool_choice, 'auto')
  assert.deepEqual(sent.body.tools.map(item => [item.type, item.function.name]), [['function', 'propose_map_edits']])
  const { toolCall } = normalizeProviderResponse({ provider: 'connection', response })
  assert.equal(toolCall.name, 'propose_map_edits')
  assert.deepEqual(toolCall.arguments.edits, [{ type: 'moveToken', id: 'token', to: 'question' }])
})

test('the recorded proposal is a "Move anyway" offer with the rule, not a refusal the model is blamed for', () => {
  const board = decision()
  assert.equal(workshopCandidate(board, 'token', 'question'), null, 'the board refuses the move: no path leads back from Decide')
  const args = JSON.parse(recorded.choices[0].message.tool_calls[0].function.arguments)
  const proposal = prepareMapReply(args, board)
  assert.deepEqual(proposal.override, { cardId: 'token', laneId: 'question', card: 'asdf', lane: 'The question', sentence })
  assert.equal(proposal.reply, '“asdf” can’t move to “The question” by this board’s rules. ' + sentence + ' Move it anyway?')
  assert.equal(proposal.workshop.cards[0].laneId, 'question')
  assert.equal(proposal.workshop.cards[0].override.from, 'decide')
  // A move among several edits is not offered alone: refused as before, with the board's sentence.
  assert.throws(() => prepareMapReply({ ...args, edits: [...args.edits, { type: 'title', text: 'Our choice' }] }, board), /Move is unavailable/)
})

test('req.js: only a model that never called a tool is said to be unable to; a turned-down call is named with its reason', () => {
  const shape = { abort: true, shape: true }
  const feature = 'conversation and edits'
  const never = chosenShapeAbort({ result: shape, label: 'muse-ember-1.0 (this server\'s AI)', feature, tools: true, calledTool: false })
  assert.equal(never.capability, 'tools')
  assert.match(never.abortMessage, /did not answer with a tool call, which conversation and edits needs/)
  const called = chosenShapeAbort({ result: shape, label: 'muse-ember-1.0 (this server\'s AI)', feature, tools: true, calledTool: true, rejection: { code: 'invalid-map-turn', reason: 'Use the name or ID of one station on this map.' } })
  assert.equal(called.capability, undefined)
  assert.equal(called.abortMessage, 'muse-ember-1.0 (this server\'s AI) proposed a change that could not be used: Use the name or ID of one station on this map.')
  assert.equal(chosenShapeAbort({ result: { abort: true }, label: 'x', feature, tools: true, calledTool: false }), null, 'not a shape abort')
  assert.equal(chosenShapeAbort({ result: shape, label: 'x', feature, tools: false, calledTool: false }), null, 'no tools asked for')
})

test('lane chat: the AI\'s "Move CARD to LANE" that a rule refuses is offered as Move anyway, alone', () => {
  const board = validateWorkshop({ version: 1, title: 'Now, next, later', lanes: [{ id: 'now', label: 'Now' }, { id: 'next', label: 'Next', capacity: 1 }],
    cards: [{ id: 'a', label: 'Alpha', laneId: 'now' }, { id: 'b', label: 'Beta', laneId: 'next' }] })
  const made = prepareLaneReply({ reply: 'Moved Alpha to Next.', commands: ['Move Alpha to Next'] }, board, null)
  assert.equal(made.override.sentence, 'It already holds 1 of 1 card.')
  assert.match(made.reply, /Move it anyway\?$/)
  assert.throws(() => prepareLaneReply({ reply: 'x', commands: ['Move Alpha to Next', 'Rename board to X'] }, board, null), /Move it anyway\?/)
})

test('the server: a confirmed drop is played as an override, marked by the server\'s name for the person; a hard limit is not', () => {
  const board = decision()
  assert.deepEqual(readWorkshopChanges([{ cardId: 'token', laneId: 'question', override: true }]), [{ cardId: 'token', laneId: 'question', override: true }])
  assert.throws(() => readWorkshopChanges([{ cardId: 'token', laneId: 'question', override: 'yes' }]))
  const refused = playWorkshopChanges(board, [{ cardId: 'token', laneId: 'question' }])
  assert.deepEqual(refused.refused, { reason: sentence, laneId: 'question', overridable: true })
  const played = playWorkshopChanges(board, [{ cardId: 'token', laneId: 'question', override: true }], undefined, undefined, { by: 'Tim', at: '2026-11-23T12:00:00.000Z' })
  assert.deepEqual(played.workshop.cards[0], { id: 'token', label: 'asdf', laneId: 'question', override: { by: 'Tim', at: '2026-11-23T12:00:00.000Z', sentence, from: 'decide' } })
  // Dragged back by hand, the map's own path rule asks again (Undo is the recorded board, below and in the next test).
  const back = playWorkshopChanges(played.workshop, [{ cardId: 'token', laneId: 'decide' }])
  assert.equal(back.refused?.overridable, true)
  // The Undo the play recorded (creative-slates.js recordedUndo: the board it replaced) puts it back in one step.
  const undone = replaceWorkshop(played.workshop, board, { undo: { by: 'tim', revision: 5, workshop: board }, revision: 5, current: 5, userId: 'tim', actor: { by: 'Tim' } })
  assert.deepEqual(undone.workshop.cards[0], { id: 'token', label: 'asdf', laneId: 'decide' })
  // A hard limit (a startup experience's cards) is refused even with override.
  const pipelineLike = validateWorkshop({ version: 1, title: 'Release', kind: 'release-plan', lanes: [{ id: 'friday', label: 'Friday', capacity: 2 }, { id: 'backlog', label: 'Backlog' }],
    cards: [{ id: 'x', label: 'X', laneId: 'backlog', points: 3 }] })
  const hard = playWorkshopChanges(pipelineLike, [{ cardId: 'x', laneId: 'friday', override: true }], undefined, undefined, { by: 'Tim' })
  assert.ok(hard.refused)
  assert.equal(hard.refused.overridable, undefined)
})

test('a kept chat proposal (a whole save) is stamped by the server: the saver, now, the stored rule; a page cannot forge it', () => {
  const stored = decision()
  const page = { ...stored, cards: [{ ...stored.cards[0], laneId: 'question', override: { by: 'Mallory', at: '2020-01-01T00:00:00.000Z', sentence: 'made up', from: 'decide' } }] }
  const kept = replaceWorkshop(stored, page, { revision: 4, current: 4, userId: 'tim', actor: { by: 'Tim' } })
  assert.ok(kept.workshop, JSON.stringify(kept.refused))
  const mark = kept.workshop.cards[0].override
  assert.equal(mark.by, 'Tim')
  assert.equal(mark.sentence, sentence)
  assert.notEqual(mark.at, '2020-01-01T00:00:00.000Z')
  // The recorded Undo of that save puts the board back (one step).
  const undone = replaceWorkshop(kept.workshop, stored, { undo: { by: 'tim', revision: 5, workshop: stored }, revision: 5, current: 5, userId: 'tim', actor: { by: 'Tim' } })
  assert.equal(undone.undone, true)
  assert.deepEqual(undone.workshop.cards[0], { id: 'token', label: 'asdf', laneId: 'decide' })
})
