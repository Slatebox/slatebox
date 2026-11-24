import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  isUserSelectableTemplate,
  userSelectableTemplateSelector,
} from '../imports/api/common/template-policy.mjs'
import parseTemplateIntoCategories from '../imports/api/common/parseTemplateIntoCategories.js'
import proCon from '../server/bootstrap/proConTemplate.json' with { type: 'json' }
import { resolveTemplateFromText } from '../server/methods/ai/welcome-template-routing.mjs'

// The template product is only as alive as its catalog. These pins keep the
// seeded Pro/Con template (a) visible to the welcome assistant's catalog
// selector, (b) structurally parseable into template categories, (c) free of
// unresolved placeholders, and (d) internally consistent (association refs).

assert.ok(
  isUserSelectableTemplate(proCon),
  'seed must satisfy userSelectableTemplateSelector (isTemplate + templateApproved)'
)

const cats = parseTemplateIntoCategories({ nodes: proCon.nodes })
assert.deepEqual(
  Object.keys(cats).sort(),
  ['Advantages', 'Costs', 'Disadvantages', 'Evaluation Criteria'].sort(),
  'seed must carry the four Pro/Con sections as category nodes'
)

assert.ok(proCon.options.templatePrompt?.length > 200, 'templatePrompt must be substantive')
assert.ok(!proCon.options.templatePrompt.includes('{{'), 'no unresolved placeholders')

const ids = new Set(proCon.nodes.map((n) => n.options.id))
const assocs = proCon.nodes.flatMap((n) => n.relationships?.associations || [])
assert.equal(assocs.length, 4, 'four section connectors')
assocs.forEach((a) =>
  assert.ok(ids.has(a.childId) && ids.has(a.parentId), `dangling association ${a.id}`)
)

// bootstrap must seed it exactly once per env
const bootstrap = await readFile(
  new URL('../server/bootstrap/all.js', import.meta.url),
  'utf8'
)
assert.match(
  bootstrap,
  /findOneAsync\(\{ shareId: proConTemplate\.shareId \}\)[\s\S]{0,120}insertAsync\(proConTemplate\)/,
  'pro/con template must be seeded via a guarded, idempotent bootstrap insert'
)

// the template journey must LOAD the template before the kickoff reads it
const chatSource = await readFile(
  new URL('../imports/ui/components/ai/SlateAIRunner.jsx', import.meta.url),
  'utf8'
)
assert.match(
  chatSource,
  /await loadTemplateIntoSlate\(resp\.slateTemplateId\)/,
  'template load must be awaited before the populate kick (no read-before-load race)'
)
assert.match(
  chatSource,
  /await slate\.loadJSON\(JSON\.stringify\(getSlate\.slateBase\)\)/,
  'loadJSON completion must gate the kickoff'
)

// ---- forced-setIntention recovery: named template must resolve ----
const catalog = [
  { shareId: 'tplprocon001', options: { name: proCon.options.name } },
]
assert.equal(
  resolveTemplateFromText(
    catalog,
    'Use the Pro/Con Analysis template for Postgres vs MySQL!!'
  ),
  'tplprocon001',
  'a template named in the request must resolve even when the model cannot call expandTemplates first'
)
assert.equal(
  resolveTemplateFromText(catalog, 'mind map about our Q3 OKRs'),
  null,
  'no match without a literal catalog name in the text'
)
assert.equal(resolveTemplateFromText([], 'Pro/Con Analysis'), null)

const openaiSource = await readFile(
  new URL('../server/methods/openai.js', import.meta.url),
  'utf8'
)
assert.match(
  openaiSource,
  /resolveTemplateFromText\(\s*templates,\s*`\$\{userMessage/,
  'welcome must run the deterministic resolver when the model omits slateTemplateId'
)

console.log('pro/con template seed contract checks passed')
