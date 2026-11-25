// "Manage AI scenarios" is gone: its editor, its save and delete methods and its publication. The kinds
// of slate the welcome flow makes, and the note actions' adhoc kind, are code
// (server/methods/ai/generation-kinds.mjs, imports/api/common/adhoc-kind.mjs). The chatIntentions
// documents stay in the database, unread.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultGenerationKind,
  fillWelcomePrompt,
  gatherSentence,
  generationKind,
  generationKinds,
  templateGenerationKind,
} from '../web/app/server/methods/ai/generation-kinds.mjs'
import { pruneEmptyTemplateCatalog } from '../web/app/server/methods/ai/welcome-template-routing.mjs'
import { adhocKind } from '../web/app/imports/api/common/adhoc-kind.mjs'

const app = fileURLToPath(new URL('../web/app/', import.meta.url))
const read = (path) => readFileSync(join(app, path), 'utf8')
const sources = (dir) => readdirSync(join(app, dir)).flatMap((name) => {
  const path = join(dir, name)
  if (statSync(join(app, path)).isDirectory()) return sources(path)
  return /\.(m?js|jsx)$/.test(name) ? [path] : []
})

test('the scenarios editor, its menu item, its methods and its publication are gone', () => {
  for (const gone of ['server/methods/chatIntentions.js', 'imports/ui/components/ai/CreatePersona.jsx', 'imports/ui/components/ai/CreatePersonaLazy.jsx',
    'imports/ui/components/ai/CanvasAIIntentionsDialog.jsx', 'imports/ui/components/ai/CanvasAIIntentions.jsx',
    'imports/ui/components/ConversationWelcomeDialogue.jsx', 'imports/ui/components/ai/emptyAIConversation.js']) {
    assert.equal(existsSync(join(app, gone)), false, gone + ' still exists')
  }
  const constants = read('imports/api/common/constants.js')
  for (const name of ["'chatIntentions.save'", "'chatIntentions.delete'", "chatIntentions: 'chatIntentions'", "'users.getConversationWelcome'"]) {
    assert.ok(!constants.includes(name), name + ' is still a constant')
  }
  assert.doesNotMatch(read('server/publications.js'), /chatIntentions/i)
  assert.doesNotMatch(read('server/main.js'), /chatIntentions/)
  assert.doesNotMatch(read('server/methods/users.js'), /getConversationWelcome/)
  assert.doesNotMatch(read('imports/ui/jotai/atoms.js'), /isPersonaOpen/)
  for (const file of sources('imports/ui')) {
    assert.doesNotMatch(read(file), /Manage AI scenarios|CreatePersona|isPersonaOpen/, file)
  }
})

test('nothing reads the chatIntentions collection, and startup does not seed it', () => {
  assert.doesNotMatch(read('imports/api/common/models.js'), /chatIntentions/i)
  for (const file of [...sources('server'), ...sources('imports')]) {
    assert.doesNotMatch(read(file), /\bChatIntentions\b/, file)
  }
  const openai = read('server/methods/openai.js')
  assert.match(openai, /from '\.\/ai\/generation-kinds\.mjs'/)
  assert.match(openai, /let intention = generationKind\(/)
  assert.match(openai, /const intentions = generationKinds\(\)/)
  const adhoc = read('imports/ui/components/AdHocAINodes.jsx')
  assert.match(adhoc, /import \{ adhocKind \} from '\.\.\/\.\.\/api\/common\/adhoc-kind\.mjs'/)
  assert.match(adhoc, /const intention = adhocKind\(\)/)
  assert.doesNotMatch(read('server/bootstrap/all.js'), /intention|seed-hygiene/i)
})

test('the kinds of slate: unique ids, one default, one template fill, each runnable by the client', () => {
  const kinds = generationKinds()
  assert.ok(kinds.length >= 2)
  assert.equal(new Set(kinds.map((k) => k._id)).size, kinds.length, 'ids are unique')
  assert.equal(kinds.filter((k) => k.isDefault).length, 1, 'exactly one default')
  assert.equal(kinds.filter((k) => k.basedOnTemplate).length, 1, 'exactly one template fill')
  assert.equal(defaultGenerationKind()._id, 'expert-collaborator')
  assert.equal(templateGenerationKind()._id, 'populate-template')
  for (const kind of kinds) {
    assert.match(kind._id, /^[a-z][a-z-]+$/, kind._id)
    assert.ok(kind.name && kind.details.trim(), kind._id + ' has a name and details for the menu')
    assert.ok(kind.gather?.items?.length, kind._id + ' gathers something')
    const tree = Object.keys(kind.ai.decisionTree)
    assert.deepEqual(tree, ['inline'], kind._id)
    const inline = kind.ai.decisionTree.inline
    assert.ok(Array.isArray(inline.prompts) && inline.prompts.length, kind._id + ' has prompts')
    assert.ok(inline.functions.some((f) => f.name === 'respond'), kind._id + ' has a respond function')
    // the model is the server's choice; the data names none, nor any account
    assert.equal(inline.engine, undefined, kind._id)
    assert.equal(kind.userId, undefined, kind._id)
    assert.equal(kind.isAdhoc, undefined, kind._id + ': the adhoc kind is not on the welcome menu')
  }
  assert.equal(generationKind('adhoc'), null)
  assert.equal(generationKind('no-such-kind'), null)
  assert.equal(generationKind(undefined), null)
})

test('a kind handed out is a copy: changing it never changes the next one', () => {
  const first = generationKind('expert-collaborator')
  first.ai.decisionTree.inline.prompts.push('extra')
  first.name = 'changed'
  const second = generationKind('expert-collaborator')
  assert.notEqual(second.name, 'changed')
  assert.ok(!second.ai.decisionTree.inline.prompts.includes('extra'))
  const adhoc = adhocKind()
  adhoc.ai.decisionTree.inline.prompts.push('extra')
  assert.ok(!adhocKind().ai.decisionTree.inline.prompts.includes('extra'))
})

test('the note actions\' adhoc kind is there on any slate, with no subscription', () => {
  const kind = adhocKind()
  assert.equal(kind._id, 'adhoc')
  assert.equal(kind.isAdhoc, true)
  assert.equal(kind.gather.onComplete, 'populateCenterNode')
  const inline = kind.ai.decisionTree.inline
  assert.deepEqual(Object.keys(kind.ai.decisionTree), ['inline'])
  assert.deepEqual(inline.useWhenValuesPopulated, ['discussion'])
  assert.ok(inline.prompts.some((p) => p.includes('{{discussion}}')))
  assert.equal(inline.function_call.name, 'respond')
  assert.ok(inline.functions.find((f) => f.name === 'respond').parameters.properties.notes)
  assert.equal(inline.engine, undefined)
  // the browser never subscribes to look it up
  for (const file of sources('imports/ui')) assert.doesNotMatch(read(file), /subscribe\(\s*['"]chatIntentions/, file)
})

// The welcome body as openai.js sends it (welcomePrompt.body).
const welcomeBody = (() => {
  const source = read('server/methods/openai.js')
  const at = source.indexOf('      body: "You are the Slatebox Welcome Assistant')
  return JSON.parse(source.slice(at + '      body: '.length, source.indexOf('",\n', at) + 1))
})()

for (const [label, templates] of [['no templates', []], ['two templates', [
  { shareId: 'pc1', options: { name: 'Pro/Con', description: ' Weigh a choice. ' } },
  { shareId: 'rt2', options: { name: 'Retro', description: 'Look back.' } },
]]]) {
  test(`the welcome prompt fills every menu token, with ${label}`, () => {
    const routing = pruneEmptyTemplateCatalog({ templateCount: templates.length, body: welcomeBody, functions: [], intentions: generationKinds() })
    const prompt = fillWelcomePrompt({ body: routing.body, kinds: routing.intentions, templates })
    assert.doesNotMatch(prompt, /undefined|null/)
    assert.doesNotMatch(prompt, /\{[a-zA-Z]+\}/, 'a menu token is left unfilled')
    assert.doesNotMatch(prompt, /\{\{[a-zA-Z]+\}\}/)
    assert.match(prompt, /For default cases, ONLY use expert-collaborator\./)
    for (const kind of routing.intentions) assert.ok(prompt.includes(`(intentionId: ${kind._id})`), kind._id)
    if (templates.length) {
      assert.ok(prompt.includes('(intentionId: populate-template)'))
      assert.match(prompt, /For templates, ONLY use populate-template\./)
      assert.ok(prompt.includes('(0) Pro/Con - Weigh a choice., (id: pc1); (1) Retro - Look back., (id: rt2)'))
      assert.match(prompt, /\(2 available, e\.g\. \(0\) Pro\/Con/)
    } else {
      assert.ok(!prompt.includes('populate-template'), 'an empty catalog offers no template fill')
    }
  })
}

test('the menu line for a kind: number, name, id, details, what to gather', () => {
  const kind = { _id: 'k', name: 'Kind', details: ' Makes a {{thing}}. ', gather: { message: 'Hi', items: [{ key: 'idea', required: true, placeholder: 'your idea' }, { key: 'tone', placeholder: 'calm' }] } }
  assert.equal(gatherSentence(kind), 'You must gather the following intentionItems from the user: idea: your idea; these intentionItems are optional: tone: calm')
  assert.equal(fillWelcomePrompt({ body: '[{intentionsAvailable}]', kinds: [kind] }),
    '[(1) Kind (intentionId: k) - Makes a template.. You must gather the following intentionItems from the user: idea: your idea; these intentionItems are optional: tone: calm]')
  assert.equal(gatherSentence({ gather: { message: 'Only this', items: [] } }), 'Only this ')
  assert.equal(gatherSentence({}), '')
})
