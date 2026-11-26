// The deterministic layer of the free-form smart-component eval (CI-safe: no network, no keys, no model). The
// owner's report (2026-11-25): "unable to build a smart component? ... we need tests to ensure that these can be
// built out". The builder's real server path (nativeCanvas.preview → workshops.draft → req) runs under plain node
// with recorded and known-bad model answers (recorded.mjs) in place of the model, and every free-form prompt
// (prompts.mjs) is checked to take the builder path and to come out as a valid smart component.
//
// What must hold, whatever the model answers: the person gets a board of lanes that passes validateWorkshop, is drawn
// as notes, and can be saved to the library: the agent's draft when it is a board (as sent, or once its unambiguous
// slips are repaired, or after one retry told what was wrong), else a starter named after the words; or, for a
// refusal they can act on (the draft lock, the meter), one plain sentence. Never an "Operation N" list.
//
//   node --test scripts/evals/smart-components/smart-components.test.mjs
// The live layer (live.mjs) runs the same prompts against the configured model.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import 'slateboxjs/workshops/behaviour'
import { rulebook, validateWorkshop, workshopToSlate } from 'slateboxjs/workshops/model'
import '../../../web/app/imports/api/common/library.mjs'
import { builderBrief, builderDescription, builderTitle, componentQuality, componentStarter, placeholderLabel } from '../../../web/app/imports/api/common/builder-freeform.mjs'
import { previewAsksForCards, previewHeading, previewSaidLine } from '../../../web/app/imports/api/common/conversation-preview.mjs'
import { textToolCall } from '../../../web/app/server/methods/ai/text-tool-call.mjs'
import { normalizeProviderResponse } from '../../../web/app/server/methods/ai/provider.mjs'
import { authorTool, laneDraftCheck, normalizeLaneDraft, parseLaneDraft } from '../../../web/app/server/methods/workshop-lane-draft.mjs'
import { previewProblems, qualityProblems } from './checks.mjs'
import { PROMPTS } from './prompts.mjs'
import { GOOD, RECORDED } from './recorded.mjs'
import { completion, startReplay } from './replay.mjs'

const byId = Object.fromEntries(PROMPTS.map((p) => [p.id, p.prompt]))
const OWNER = byId['owner-printable-pieces']
const builderSlate = { library: { mode: 'build' }, nodes: [], options: {} }
let replay
before(async () => { replay = await startReplay() })
after(() => replay?.close())

/** What a person is shown must be words: one or two sentences, no checker list, no JSON, no stack. */
function plainWords(text) {
  assert.equal(typeof text, 'string')
  assert.ok(text.length > 0 && text.length <= 300, text)
  assert.doesNotMatch(text, /\bOperations? \d|\{|\[|at .+\.m?js|undefined|null/, text)
}

/** A preview from the builder path is a smart component: a valid board of lanes, drawn as notes, its rules said. */
function isComponent(preview, prompt) {
  assert.equal(preview.mode, 'play')
  assert.equal(preview.format, 'lanes')
  const workshop = validateWorkshop(preview.canvas.workshop)
  assert.ok(workshop.lanes.length >= 2 && workshop.lanes.length <= 5)
  assert.ok(workshop.cards.length >= 1)
  assert.ok(!workshop.kind && !workshop.experience && !workshop.lanes.some((lane) => lane.station), 'a board of plain lanes')
  // Drawn: every lane and card is a note on the slate the canvas renders.
  const slate = workshopToSlate(workshop, { native: true })
  const ids = slate.nodes.map((node) => node.options?.id ?? node.id)
  for (const card of workshop.cards) assert.ok(ids.some((id) => String(id).endsWith(card.id)), `card ${card.id} is drawn`)
  assert.ok(slate.nodes.length >= workshop.lanes.length + workshop.cards.length)
  // Its rules are the rulebook's own sentences.
  assert.deepEqual(preview.rules, rulebook().lines(workshop))
  plainWords(preview.said.replace(/“[^”]*”/g, '“…”'))
  assert.match(preview.said, /from your description/)
  if (prompt) assert.ok(builderBrief(prompt).length <= 1200)
  return workshop
}

test('every free-form prompt in the eval set takes the builder path on a builder slate, with a brief the draft accepts', () => {
  assert.ok(PROMPTS.length >= 40, 'forty or more prompts')
  assert.equal(new Set(PROMPTS.map((p) => p.id)).size, PROMPTS.length)
  for (const { id, prompt } of PROMPTS) {
    assert.equal(builderDescription(builderSlate, prompt), true, id)
    const brief = builderBrief(prompt)
    assert.ok(brief.length >= 10 && brief.length <= 1200, id)
    assert.ok(builderTitle(prompt).length <= 80, id)
  }
  for (const tag of ['owner', 'vague', 'odd', 'non-english', 'rambling', 'limits', 'printable', 'snap']) assert.ok(PROMPTS.some((p) => p.tags.includes(tag)), tag)
})

test('every prompt makes a valid smart component with no agent at all: the starter named after the words', async () => {
  for (const { id, prompt } of PROMPTS) {
    const { preview, error, sent } = await replay.turn(prompt, [], { noAI: true })
    assert.ifError(error)
    assert.equal(sent.length, 0, id)
    assert.equal(preview.provider, 'direct', id)
    const workshop = isComponent(preview, prompt)
    assert.deepEqual(workshop, validateWorkshop(componentStarter(prompt, { now: new Date(workshop.behaviour.rules[0].set.at) })), id)
    assert.match(preview.said, /^Started “/, id)
    // Built from the words, it passes the same quality gate a draft must: named pieces, no repeats, behavior.
    assert.deepEqual(componentQuality(workshop, { message: prompt }), [], id)
    assert.doesNotMatch(JSON.stringify(workshop.cards), /"Piece [A-D]"/, id)
  }
})

test('every prompt keeps a good draft from the agent as it was drafted', async () => {
  for (const { id, prompt } of PROMPTS) {
    const { preview, error, sent } = await replay.turn(prompt, [{ args: GOOD }])
    assert.ifError(error)
    assert.equal(sent.length, 1, id)
    assert.equal(preview.provider, 'ai', id)
    assert.equal(isComponent(preview, prompt).title, GOOD.title, id)
    // The request carries the person's words framed as a component, and the lanes tool.
    assert.equal(sent[0].messages.at(-1).content, builderBrief(prompt), id)
    assert.equal(sent[0].tools[0].function.name, 'draft_workshop')
    // The component's own instructions (with worked examples) and the tool's rules (behavior as data).
    assert.match(sent[0].messages[0].content, /^Build a reusable smart component from the person's description/)
    assert.deepEqual(sent[0].tools[0].function.parameters.properties.rules.items.properties.kind.enum, ['one-step', 'path', 'archive'])
  }
})

for (const item of RECORDED) {
  test(`recorded answer "${item.id}" → ${item.expect.outcome}`, async () => {
    const prompt = byId[item.prompt]
    assert.ok(prompt, 'a prompt from the eval set')
    const { preview, error, sent, left } = await replay.turn(prompt, item.answers, { as: item.as, noAI: item.noAI, locked: item.locked, off: item.off, refuse: item.refuse })
    assert.equal(sent.length, item.expect.requests, 'model requests')
    assert.equal(left, Math.max(0, item.answers.length - item.expect.requests), 'answers never asked for')
    if (item.expect.outcome === 'error') {
      assert.ok(error, 'refused')
      assert.equal(preview, undefined)
      assert.equal(error.reason, item.expect.said)
      plainWords(error.reason)
      return
    }
    assert.ifError(error)
    const workshop = isComponent(preview, prompt)
    assert.equal(preview.provider, item.expect.outcome === 'drafted' ? 'ai' : 'direct')
    assert.match(preview.said, item.expect.outcome === 'drafted' ? /^Drafted “/ : /^Started “/)
    // The live eval's own check agrees: a drafted board passes it, a starter is named as the fallback it is.
    const checked = previewProblems(preview, prompt)
    if (item.expect.outcome === 'drafted') assert.deepEqual(checked.problems, [])
    else assert.ok(checked.problems.some((p) => /fell back to the starter/.test(p)))
    // Whatever was answered, what the person gets passes the quality gate (a draft, or the starter from the words).
    assert.deepEqual(qualityProblems(preview, prompt), [])
    if (item.expect.cards) assert.deepEqual(workshop.cards.map((card) => card.id), item.expect.cards)
    if (item.expect.ruleKinds) assert.deepEqual(workshop.behaviour.rules.map((rule) => rule.kind), item.expect.ruleKinds)
    if (item.expect.outcome === 'starter') assert.equal(/sign in and the agent drafts/.test(preview.said), Boolean(item.expect.guest))
    if (item.expect.title) assert.equal(workshop.title, item.expect.title)
    if (item.expect.lanes) assert.deepEqual(workshop.lanes.map((lane) => lane.label), item.expect.lanes)
    if (item.expect.rules) assert.deepEqual(preview.rules, item.expect.rules)
    if (item.expect.capacities) assert.deepEqual(workshop.lanes.filter((lane) => lane.capacity).map((lane) => lane.capacity), item.expect.capacities)
    if (item.expect.retry) {
      const asked = sent[1].messages.at(-1)
      assert.equal(asked.role, 'user')
      assert.match(asked.content, item.expect.retry)
      assert.match(asked.content, /Return a complete draft_workshop tool call\./)
      // what was wrong, in words: each problem one plain sentence (a draft can have more than one)
      for (const sentence of asked.content.split('Return a complete')[0].replace('draft_workshop', 'the tool').split(/(?<=\.) (?=[A-Z])/)) plainWords(sentence)
    }
  })
}

test('the recorded set covers the known-bad shapes: invalid counts, missing fields, wrong types, wrong tools, text calls', () => {
  assert.ok(RECORDED.length >= 30)
  for (const id of ['counts-as-text', 'capacity-zero', 'capacity-fraction', 'capacity-below-cards', 'missing-label', 'empty-arguments', 'wrong-types-twice', 'lists-double-encoded', 'wrong-tool', 'muse-text-call', 'prose-twice'])
    assert.ok(RECORDED.some((item) => item.id === id), id)
  for (const outcome of ['drafted', 'starter', 'error']) assert.ok(RECORDED.some((item) => item.expect.outcome === outcome), outcome)
})

test('a tool call written as text is read as that call only when it is complete, names an offered tool and has nothing else in it', () => {
  const tools = [authorTool]
  const text = (inner, name = 'draft_workshop') => `<atem:function_calls>\n<atem:invoke name="${name}">\n${inner}\n</atem:invoke>\n</atem:function_calls>`
  const p = (name, value) => `<atem:parameter name="${name}">${value}</atem:parameter>`
  assert.deepEqual(textToolCall(text(p('version', '1') + p('title', 'Kit') + p('lanes', '[{"id":"a","label":"A"}]')), tools).arguments, { version: 1, title: 'Kit', lanes: [{ id: 'a', label: 'A' }] })
  // A string parameter stays text, even when it looks like JSON.
  assert.equal(textToolCall(text(p('title', '2024')), tools).arguments.title, '2024')
  // Not complete, not offered, repeated or with other words inside: no call.
  assert.equal(textToolCall(text(p('title', 'Kit')).replace('</atem:invoke>', ''), tools), null)
  assert.equal(textToolCall(text(p('title', 'Kit'), 'drop_tables'), tools), null)
  assert.equal(textToolCall(text(p('title', 'A') + p('title', 'B')), tools), null)
  assert.equal(textToolCall(text('Here you go: ' + p('title', 'Kit')), tools), null)
  assert.equal(textToolCall(text(p('title', 'Kit')), []), null)
  assert.equal(textToolCall('Plain words.', tools), null)
  // Through the provider's normalization: only when the answer has no tool_calls of its own.
  const asText = completion({ text: text(p('version', '1') + p('title', 'Kit')) })
  assert.equal(normalizeProviderResponse({ provider: 'connection', response: asText, textTools: tools }).toolCall.name, 'draft_workshop')
  assert.equal(normalizeProviderResponse({ provider: 'connection', response: asText }).toolCall, null, 'no caller opted in, no call read')
  const real = completion({ args: { title: 'Real' }, text: text(p('title', 'Text')) })
  assert.equal(normalizeProviderResponse({ provider: 'connection', response: real, textTools: tools }).toolCall.arguments.title, 'Real')
})

test('a draft\'s repairs touch only unambiguous slips; anything else is refused by the board and asked again', () => {
  assert.deepEqual(normalizeLaneDraft({ version: '1', lanes: '[{"id":"a","label":"A","capacity":"3"},{"id":"b","label":"B","capacity":null}]', cards: [{ id: 'c', label: 'C', laneId: 'a', allowedLaneIds: null }], signals: null }),
    { version: 1, lanes: [{ id: 'a', label: 'A', capacity: 3 }, { id: 'b', label: 'B' }], cards: [{ id: 'c', label: 'C', laneId: 'a' }] })
  // Not whole numbers, not ids, not labels: left as they are, for validateWorkshop to refuse.
  for (const capacity of ['three', '2.5', 0, -1]) assert.throws(() => parseLaneDraft({ ...GOOD, lanes: [GOOD.lanes[0], { ...GOOD.lanes[1], capacity }, GOOD.lanes[2]] }), /capacity/i, String(capacity))
  assert.throws(() => parseLaneDraft({ ...GOOD, cards: [{ ...GOOD.cards[0], laneId: 'Piece Tray' }] }), /slugs/)
  assert.equal(laneDraftCheck({ name: 'draft_workshop', arguments: GOOD }), null)
  const refused = laneDraftCheck({ name: 'draft_workshop', arguments: { ...GOOD, lanes: GOOD.lanes.slice(0, 1) } })
  assert.equal(refused.code, 'invalidWorkshopDraft')
  assert.match(refused.retryPrompt, /^The last draft could not be used: A workshop needs 2 to 5 lanes\. Return a complete draft_workshop tool call\./)
})

test('the owner\'s words end to end: a builder slate gets a smart component, never the twenty "Operation N" lines', async () => {
  for (const answers of [[{ args: GOOD }], [{ text: '<atem:function_calls>\n<atem:invoke name="draft_workshop">\n<atem:parameter name="version">1</atem:parameter>\n<atem:parameter name="title">Kit</atem:parameter>\n<atem:parameter name="lanes">[{"id":"a","label":"A"},{"id":"b","label":"B"}]</atem:parameter>\n<atem:parameter name="cards">[{"id":"c","label":"C","laneId":"a"}]</atem:parameter>\n</atem:invoke>\n</atem:function_calls>' }], [{ args: '{}' }, { text: 'no' }], []]) {
    const { preview, error } = await replay.turn(OWNER, answers)
    assert.ifError(error)
    isComponent(preview, OWNER)
    assert.doesNotMatch(JSON.stringify(preview), /Operation \d+ count/)
  }
})

test('the preview says what was made once: no doubled full stop, and no "add your cards" for a board that brings its pieces', async () => {
  const { preview } = await replay.turn(OWNER, [{ args: GOOD }])
  // The heading names the agent (never "AI") and what was made: a smart component.
  assert.equal(previewHeading(preview), 'Agent preview · Smart component · Snap-together printable kit')
  const line = previewSaidLine(preview)
  assert.equal(line, preview.said)
  assert.doesNotMatch(line, /\.\.$/)
  assert.equal(previewAsksForCards(preview), false)
  // A starter is a preview made here; a board of lanes with no cards asks for them; a sentence without a stop gets one.
  const { preview: guest } = await replay.turn(OWNER, [], { as: 'guest' })
  assert.equal(previewHeading(guest), 'Preview · Smart component · Snappable congruent pieces to compose new printable materials')
  assert.equal(previewAsksForCards({ format: 'lanes', canvas: { workshop: { cards: [] } } }), true)
  assert.equal(previewSaidLine({ said: 'Added a retro' }), 'Keep this to add a retro.')
  assert.equal(previewHeading({ provider: 'ai', format: 'lanes', mode: 'play' }), 'Agent preview · Workshop')
  assert.equal(previewHeading({ provider: 'direct', format: 'map', mode: 'play', links: 1 }), 'Preview · Interactive route · 1 connection')
})

test('the quality gate: a card that is only a phrase the board says and a number or letter is a placeholder; a board needs behavior', () => {
  const known = new Set(['snappable', 'congruent', 'piece', 'laptop'])
  for (const label of ['Snappable congruent piece 1', 'Piece A', 'Card 3', 'Laptop B', '7', 'item #2', 'Task-4']) assert.equal(placeholderLabel(label, known), true, label)
  for (const label of ['Square 1x1', 'Bar 1x2', 'Read 20 minutes', 'MacBook Air 13', 'Title banner', 'One half', 'Corner L shape piece']) assert.equal(placeholderLabel(label, known), false, label)
  const workshop = validateWorkshop(GOOD)
  assert.deepEqual(componentQuality(workshop, { message: OWNER }), [])
  const plain = validateWorkshop({ ...GOOD, lanes: GOOD.lanes.map(({ capacity, ...lane }) => lane), cards: GOOD.cards.map(({ allowedLaneIds, ...card }) => card) })
  assert.deepEqual(componentQuality(plain), ['Give the board at least one rule: a lane capacity, allowedLaneIds on a card, or a rule such as one-step.'])
  const twice = validateWorkshop({ ...GOOD, cards: [...GOOD.cards, { id: 'again', label: 'Bar 1X2', laneId: 'piece-tray' }] })
  assert.deepEqual(componentQuality(twice), ['Give each card its own name: “Bar 1x2” appears more than once.'])
  // The owner's prompt, drafted once with one phrase on every card: named by the phrase, not the piece.
  const echo = validateWorkshop({ ...GOOD, cards: ['Title', 'Instruction', 'Question', 'Diagram', 'Picture'].map((name, i) => ({ id: 'c' + i, label: name + ' square tile 2x2', laneId: 'piece-tray' })) })
  assert.deepEqual(componentQuality(echo), ['Name each card for what makes it different: 5 of 5 cards end in the same words, “square tile 2x2”.'])
  for (const problem of [...componentQuality(plain), ...componentQuality(twice), ...componentQuality(echo)]) plainWords(problem)
})

test('reading a call written as text is opt-in: a drafting format that does not opt in (a map) asks again instead', async () => {
  const call = '<atem:function_calls>\n<atem:invoke name="draft_concept_map">\n<atem:parameter name="title">Hike</atem:parameter>\n</atem:invoke>\n</atem:function_calls>'
  const { sent, error } = await replay.draft('Plan a day hike from the car park to the summit', 'map', [{ text: call }, { text: call }])
  assert.equal(sent.length, 2, 'the text was not read as a call: the map draft asked again')
  assert.ok(error, 'and, never answered with a call, refused')
  assert.match(sent[1].messages.at(-1).content, /Call the requested tool\./)
})
