// The Slack, Google and generic recipes as the runtime and the catalog read them: every manifest
// valid (design B.2), ids and note prefixes unique, the copy sentence case, "agent" not "AI", US
// spelling; every module { manifest, run }; and the import rule (design B.7): recipe code imports
// only enterprise/common, the MIT Mermaid code, its own folder and the shared recipe folders
// (_shared, _slack-ledger), never the server, Mongo, Meteor or the network.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-slack-google-manifests.test.mjs
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateManifest } from '../enterprise/common/recipes/manifest.mjs'
import { RECIPE_MODULES, VENDOR_FACTORIES } from '../enterprise/server/recipes/index.mjs'
import { CATALOG } from '../enterprise/common/recipes/catalog.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const recipes = join(root, 'enterprise/recipes')
const IDS = ['slack-decision-log', 'slack-timeline', 'slack-concepts', 'slack-digest', 'google-sheet-board', 'google-design-doc', 'webhook-render', 'project-index']
const SLACK_GOOGLE_RECIPES = RECIPE_MODULES.filter((m) => IDS.includes(m.manifest.id))
const SLACK_GOOGLE_MANIFESTS = CATALOG.filter((m) => IDS.includes(m.id))
const MINE = ['_shared', '_slack-ledger', 'slack-decision-log', 'slack-timeline', 'slack-digest', 'slack-concepts', 'google-sheet-board', 'google-design-doc', 'webhook-render', 'project-index']
const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : path.endsWith('.mjs') ? [path] : []
})

test('every manifest is valid, its id and note prefix unique; the modules are { manifest, run }', () => {
  assert.equal(SLACK_GOOGLE_RECIPES.length, 8)
  const ids = new Set()
  const prefixes = new Set()
  for (const recipe of SLACK_GOOGLE_RECIPES) {
    const m = recipe.manifest
    assert.equal(validateManifest(m), null, m.id)
    assert.equal(typeof recipe.run, 'function')
    assert.ok(Object.isFrozen(m))
    assert.ok(!ids.has(m.id) && !prefixes.has(m.idPrefix), m.id)
    ids.add(m.id)
    prefixes.add(m.idPrefix)
  }
  assert.deepEqual(SLACK_GOOGLE_MANIFESTS.map((m) => m.id), IDS, 'in the catalog the UI reads')
  assert.deepEqual(SLACK_GOOGLE_RECIPES.map((r) => r.manifest.id), IDS, 'registered with the runtime')
  assert.deepEqual(VENDOR_FACTORIES.map((f) => f.name).filter((n) => /slack|google/i.test(n)), ['slackVendorFactory', 'googleVendorFactory'])
  assert.deepEqual(VENDOR_FACTORIES.flatMap((f) => f.routes?.() || []).filter((r) => r.vendor === 'google'), [{ method: 'POST', path: '/integrations/google/watch', raw: true, vendor: 'google' }])
  assert.deepEqual([...prefixes].sort(), ['gd', 'gs', 'sc', 'sd', 'st', 'sw', 'xi', 'xw'], 'the prefixes design D assigns')
  // Writes outside Slatebox: only the digest's post and the sheet's write-back, each with a plain description.
  const writes = SLACK_GOOGLE_RECIPES.flatMap((r) => r.manifest.writes.map((w) => [r.manifest.id, w.kind, w.describe({ channels: ['C0LEADERS1'], fileId: 'x', columns: ['C'] })]))
  assert.deepEqual(writes, [
    ['slack-digest', 'slack.post', 'Post the weekly digest in <#C0LEADERS1>, once a week, as you'],
    ['google-sheet-board', 'google.write_sheet', 'Change only column C of the sheet you picked, when a card moves on the board'],
  ])
  // Schedules are never more often than every 15 minutes, except the project index's hourly.
  for (const r of SLACK_GOOGLE_RECIPES) for (const t of r.manifest.triggers) if (t.kind === 'schedule') assert.ok(!/^\*|^\*\/([1-9]|1[0-4])\s/.test(t.cron), `${r.manifest.id} ${t.cron}`)
})

test('copy: sentence case, "agent" not "AI", US spelling, in every manifest string and every recipe file', () => {
  const strings = []
  const walk = (value) => {
    if (typeof value === 'string') strings.push(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  for (const m of SLACK_GOOGLE_MANIFESTS) walk({ label: m.label, agentName: m.agentName, outputs: m.outputs, config: m.configSchema })
  for (const text of strings) assert.ok(!/\bAI\b/.test(text), text)
  for (const m of SLACK_GOOGLE_MANIFESTS) for (const text of [m.label, m.agentName, ...m.outputs.map((o) => o.name)]) assert.match(text, /^[A-Z{]/, text)
  const british = /\b(colour|behaviour|organis(e|ed|ing|ation)|favourite|centre|licence|catalogue|analys(e|ed|ing)|cancell(ed|ing)|modell(ed|ing)|programme)\b/i
  for (const dir of MINE) for (const path of files(join(recipes, dir))) {
    const source = readFileSync(path, 'utf8')
    assert.ok(!british.test(source), `${relative(root, path)}: ${source.match(british)?.[0]}`)
    for (const m of source.matchAll(/'([^'\n]{12,})'/g)) assert.ok(!/\bAI\b/.test(m[1]), `${relative(root, path)}: ${m[1]}`)
  }
})

test('the import rule: recipe code reaches only enterprise/common, the Mermaid code, its own folder and the shared recipe folders', () => {
  for (const dir of MINE) for (const path of files(join(recipes, dir))) {
    const source = readFileSync(path, 'utf8')
    for (const m of source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      const spec = m[1]
      const ok = spec === 'node:crypto'
        || spec.startsWith('/imports/api/common/mermaid/')
        || spec.startsWith('../../common/recipes/')
        || /^\.\/[\w./-]+$/.test(spec)
        || /^\.\.\/(_shared|_slack-ledger)\/[\w.-]+\.mjs$/.test(spec)
        || (dir.startsWith('_') && /^\.\.\/\.\.\/common\/recipes\//.test(spec))
      assert.ok(ok, `${relative(root, path)} imports ${spec}`)
    }
    assert.ok(!/\bfetch\(|Meteor\.|rawCollection|process\.env/.test(source.replace(/\/\/.*$/gm, '')), `${relative(root, path)} reaches the network, Mongo or the environment`)
  }
})
