import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { pruneEmptyTemplateCatalog } from '../server/methods/ai/welcome-template-routing.mjs'

// ---- live-prompt sync: extract the ACTUAL welcome body from openai.js ----
const openaiSource = await readFile(
  new URL('../server/methods/openai.js', import.meta.url),
  'utf8'
)
const bodyMatch = openaiSource.match(
  /body:\s*"((?:[^"\\]|\\.)*)"/
)
assert.ok(
  bodyMatch,
  'welcome body literal must remain extractable (source-shape pin)'
)
const liveBody = JSON.parse(`"${bodyMatch[1]}"`)

// ---- empty-catalog pruning must be TOTAL on the live body ----
const fakeIntentions = [
  { _id: 'expert-col', name: 'Expert Collaboration', isDefault: true },
  { _id: 'sSdfQkbvvF', name: 'Template Population', basedOnTemplate: true },
  { _id: 'adhoc', name: 'AdHoc' },
]
const fakeFunctions = [
  { name: 'setIntention' },
  { name: 'previewTemplate' },
  { name: 'expandTemplates' },
]

const pruned = pruneEmptyTemplateCatalog({
  templateCount: 0,
  body: liveBody,
  functions: fakeFunctions,
  intentions: fakeIntentions,
})

for (const forbidden of [
  'templateIntentionId',
  'expandTemplates',
  'previewTemplate',
  'Template Population',
  'sSdfQkbvvF',
  '{templateCount}',
]) {
  assert.ok(
    !pruned.body.includes(forbidden),
    `pruned prompt still references ${forbidden}`
  )
}
assert.ok(
  pruned.body.includes('{defaultIntentionId}'),
  'sticky-note routing must fall through to the default intention'
)

// ---- simulate the placeholder fill: no template path may survive ----
const assembled = pruned.body
  .replaceAll(
    '{intentionsAvailable}',
    pruned.intentions.map((i) => `${i.name} (intentionId: ${i._id})`).join('; ')
  )
  .replaceAll('{defaultIntentionId}', 'expert-col')
  .replaceAll('{templateIntentionId}', 'sSdfQkbvvF')
  .replaceAll('{templateCount}', '0')
assert.ok(!assembled.includes('sSdfQkbvvF'), 'template intention must be unreachable')
assert.ok(
  !/\btemplate\b/i.test(assembled.replace('Templates are currently unavailable; never mention templates.', '')),
  'the word template must not survive anywhere in an empty-catalog prompt'
)

// ---- tools: template tools dropped, setIntention kept ----
assert.deepEqual(
  pruned.functions.map((f) => f.name),
  ['setIntention'],
  'empty catalog must not advertise template tools'
)

// ---- intentions menu: template intention hidden, others intact ----
assert.deepEqual(
  pruned.intentions.map((i) => i._id).sort(),
  ['adhoc', 'expert-col'],
  'basedOnTemplate intentions must be pruned from the menu'
)

// ---- wiring pins ----
assert.match(
  openaiSource,
  /pruneEmptyTemplateCatalog\(\{\s*templateCount: templates\.length/,
  'welcome must run template routing through the catalog-gated pruner'
)
assert.match(
  openaiSource,
  /if \(!templates \|\| templates\.length === 0\)/,
  'template catalog cache must re-query while empty (no permanent empty freeze)'
)

// ---- non-empty catalog must NOT be pruned (identity) ----
const full = pruneEmptyTemplateCatalog({
  templateCount: 3,
  body: 'Group collaborations on templates (3 available, e.g. Pro/Con). For template exploration, call expandTemplates for a list. Then use previewTemplate if needed. Then present the selected template as the idea. If you have enough info, call setIntention with the appropriate intentionId and instructions.',
  functions: fakeFunctions,
  intentions: fakeIntentions,
})
assert.ok(
  full.body.includes('expandTemplates') &&
    full.functions.length === 3 &&
    full.intentions.length === 3,
  'pruning must be scoped to the EMPTY-catalog call site only (function is pure; caller gates)'
)

console.log('welcome template-routing contract checks passed')

// ---- iter57: template-less template-population degrades, never dead-ends ----
assert.match(
  openaiSource,
  /if \(intention\?\.basedOnTemplate && !slateTemplateId\) \{[\s\S]{0,800}?isDefault: true/,
  'basedOnTemplate intention without a template must degrade to the default mindmap intention',
)
assert.ok(
  openaiSource.includes('replace(/' + '\\{\\{[a-zA-Z]+\\}\\}/g' + ", 'template')"),
  'welcome-visible intention text must not carry raw Jinja placeholder tokens',
)
const bootstrapSource = await readFile(
  new URL('../server/bootstrap/all.js', import.meta.url),
  'utf8',
)
assert.ok(
  bootstrapSource.includes('seed-hygiene') &&
    bootstrapSource.includes('claude-3-5'),
  'startup sweep must repin dead claude-3-5 engine pins on seeded intentions',
)
console.log('iter57 degradation + hygiene contracts passed')
