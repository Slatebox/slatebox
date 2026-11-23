import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const canvas = await readFile(
  new URL('../imports/ui/pages/Canvas.jsx', import.meta.url),
  'utf8'
)
const chat = await readFile(
  new URL('../imports/ui/components/ai/SlateAIRunner.jsx', import.meta.url),
  'utf8'
)

assert.match(
  canvas,
  /React\.useState\(\s*\(\) =>\s*searchparams\.get\('prompt'\)\s*\)/,
  'Canvas must capture the initial prompt once instead of re-reading it after URL replacement'
)
assert.match(
  canvas,
  /nextSearchParams\.delete\('prompt'\)/,
  'Canvas must remove the consumed prompt from the URL'
)
assert.match(
  canvas,
  /setSearchParams\(nextSearchParams, \{ replace: true \}\)/,
  'prompt consumption must replace history rather than adding a second navigation entry'
)
assert.match(
  canvas,
  /onInitialPromptConsumed=\{consumeInitialPrompt\}/,
  'Chat must receive the one-shot prompt-consumption callback'
)

const initWelcomeIndex = chat.indexOf('async function initWelcome()')
assert.ok(initWelcomeIndex >= 0, 'Chat must retain its welcome initializer')
const consumeIndex = chat.indexOf(
  'onInitialPromptConsumed?.()',
  initWelcomeIndex
)
const requestIndex = chat.indexOf(
  'Meteor.callAsync(CONSTANTS.methods.openai.welcome',
  initWelcomeIndex
)
assert.ok(consumeIndex >= 0, 'Chat must consume URL prompts')
assert.ok(
  requestIndex > consumeIndex,
  'Chat must consume the URL prompt before starting billable welcome generation'
)

console.log('Initial onboarding prompt is consumed exactly once before generation.')
