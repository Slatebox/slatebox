// The recipes UI (design E): the project's Recipes tab, Add recipe (pick, connect, set up, preview,
// turn on), the run history, webhooks (secret shown once, test, delivery log), standing permissions
// (off by default, exact scope), the switches, and the "Maintained by" panel on a slate. The words
// and rules are pure (enterprise/client/recipes/recipesModel.mjs); the wiring is checked in source.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  COMMON_EVENTS, CRON_PRESETS, RECIPES_OFF_COPY, addRecipeSteps, ago, canPause, canResume, configFields, cronWords, defaultConfig,
  defaultTriggers, deliveryRow, formatDuration, formatTokens, groupCatalog, hookEvents, hookUrlProblem, inboundCurlSample,
  instanceName, interceptPoints, lastRunLine, maintainedSummary, needsConnection, nextRunLine, optionalTriggers, outputsLine,
  permissionRows, previewSummary, recipeErrorWords, recipesAvailability, runRow, runsFor, selectedMaintained, stateChip, triggerWords,
  until, validateConfig, validateCron, writePermissionText,
} from '../enterprise/client/recipes/recipesModel.mjs'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const ent = (path) => read('enterprise/client/' + path)
const NOW = Date.parse('2026-11-27T12:00:00Z')

const architecture = {
  id: 'github-architecture', version: 1, label: 'Living architecture', agentName: 'GitHub architect', integration: 'github', connected: true,
  triggers: [
    { kind: 'vendor', event: 'github.push', debounceMs: 120000, default: true },
    { kind: 'schedule', cron: '0 3 * * *', default: true },
    { kind: 'manual' }, { kind: 'inbound' },
  ],
  configSchema: {
    type: 'object', additionalProperties: false, required: ['repos'],
    properties: {
      repos: { type: 'array', title: 'Repos', items: { type: 'string' }, minItems: 1, maxItems: 10, 'x-slatebox-picker': 'repos' },
      depth: { type: 'integer', minimum: 1, maximum: 4, default: 2 },
      includeTests: { type: 'boolean', title: 'Include test folders' },
      layout: { type: 'string', enum: ['layered', 'tree'], default: 'layered' },
      paths: { type: 'array', items: { type: 'string' }, 'x-slatebox-picker': 'paths' },
    },
  },
  outputs: [
    { role: 'service-map', name: 'Service map', kind: 'diagram' },
    { role: 'modules', name: 'Modules — {repo}', kind: 'diagram', per: 'repo' },
    { role: 'changes', name: 'What changed', kind: 'board', component: 'team-board' },
    { role: 'status', name: 'Status', kind: 'diagram' },
  ],
  writes: [{ kind: 'github.check_run' }, { kind: 'github.pull_request' }, { kind: 'google.write_sheet', offered: false }],
  events: ['architecture.updated', 'architecture.new_dependency'],
  intercepts: ['graph.ready', 'output.ready'],
  cost: { class: 'medium' },
}

test('state chips, and which states Pause and Resume apply to', () => {
  assert.equal(stateChip('active').label, 'On')
  assert.equal(stateChip('blocked_access').label, 'Lost access')
  assert.match(stateChip('failed').help, /3 times/)
  assert.equal(stateChip('weird').label, 'Unknown')
  assert.equal(canPause('active'), true)
  assert.equal(canPause('paused'), false)
  assert.deepEqual(['paused', 'failed', 'blocked_limit', 'needs_sign_in', 'blocked_access', 'draft'].map(canResume), [true, true, true, false, false, false])
})

test('"GitHub architect · runs for Ana": the agent and whose sign-ins it uses, by first name', () => {
  assert.equal(runsFor('GitHub architect', 'Ana Souza'), 'GitHub architect · runs for Ana')
  assert.equal(runsFor('GitHub architect', ''), 'GitHub architect')
})

test('times read plainly, both ways', () => {
  assert.equal(ago(NOW - 10e3, NOW), 'just now')
  assert.equal(ago(NOW - 2 * 60e3, NOW), '2 min ago')
  assert.equal(ago(NOW - 3 * 3600e3, NOW), '3 h ago')
  assert.equal(ago(NOW - 30 * 3600e3, NOW), 'yesterday')
  assert.equal(ago(NOW - 5 * 86400e3, NOW), '5 days ago')
  assert.equal(ago('nonsense', NOW), '')
  assert.equal(until(NOW + 5 * 60e3, NOW), 'in 5 min')
  assert.equal(until(NOW + 30e3, NOW), 'any moment')
  assert.equal(until(NOW + 30 * 3600e3, NOW), 'tomorrow')
})

test('an instance card’s last and next run lines', () => {
  assert.equal(lastRunLine(null, NOW), 'No runs yet')
  assert.equal(lastRunLine({ at: NOW - 2 * 60e3, outcome: 'done', ops: 3 }, NOW), '2 min ago · 3 notes changed')
  assert.equal(lastRunLine({ at: NOW - 2 * 60e3, outcome: 'done', ops: 1 }, NOW), '2 min ago · 1 note changed')
  assert.equal(lastRunLine({ at: NOW - 2 * 60e3, outcome: 'done', ops: 0 }, NOW), '2 min ago · nothing changed')
  assert.equal(lastRunLine({ at: NOW - 60 * 60e3, outcome: 'failed' }, NOW), '1 h ago · failed')
  assert.equal(nextRunLine({ state: 'active', nextDueAt: NOW + 5 * 60e3 }, NOW), 'Next run in 5 min')
  assert.equal(nextRunLine({ state: 'active', triggers: [{ kind: 'vendor', event: 'github.push' }] }, NOW), 'Runs on every push')
  assert.equal(nextRunLine({ state: 'active', triggers: [{ kind: 'manual' }] }, NOW), 'Runs when someone clicks Run now')
  assert.equal(nextRunLine({ state: 'active', triggers: [{ kind: 'inbound' }] }, NOW), 'Runs when a webhook calls it')
  assert.equal(nextRunLine({ state: 'paused' }, NOW), stateChip('paused').help)
})

test('schedules: presets read as words; custom ones are five valid parts, at most every 15 minutes', () => {
  assert.equal(cronWords('0 18 * * 1-5'), 'Every weekday at 18:00')
  assert.equal(cronWords('30 7 * * 1'), 'Every Monday at 07:30')
  assert.equal(cronWords('5 4 * * *'), 'On the schedule 5 4 * * *')
  for (const p of CRON_PRESETS) assert.equal(validateCron(p.cron).ok, true, p.id)
  assert.equal(validateCron('0 3 * *').ok, false)
  assert.equal(validateCron('61 3 * * *').ok, false)
  assert.equal(validateCron('0 25 * * *').ok, false)
  assert.equal(validateCron('0 3 * * 8').ok, false)
  assert.equal(validateCron('* * * * *').ok, false)
  assert.equal(validateCron('*/5 * * * *').ok, false)
  assert.equal(validateCron('*/5 9 * * *').ok, false, 'every 5 minutes inside one hour is still too often')
  assert.equal(validateCron('0,10 * * * *').ok, false)
  assert.equal(validateCron('0,15,30,45 * * * *').ok, true)
  assert.equal(validateCron('*/20 8-18 * * 1-5').ok, true)
  assert.match(validateCron('*/5 * * * *').error, /every 15 minutes/)
})

test('triggers read as words', () => {
  assert.equal(triggerWords({ kind: 'vendor', event: 'github.push' }), 'On every push')
  assert.equal(triggerWords({ kind: 'schedule', cron: '0 3 * * *' }), 'Every day at 03:00')
  assert.equal(triggerWords({ kind: 'manual' }), 'When someone clicks Run now')
  assert.equal(triggerWords({ kind: 'inbound' }), 'When a webhook calls it')
})

test('a new instance starts with the manifest’s default triggers and Run now; webhooks come later', () => {
  assert.deepEqual(defaultTriggers(architecture, 'Europe/Berlin'), [
    { kind: 'vendor', event: 'github.push', debounceMs: 120000 },
    { kind: 'schedule', cron: '0 3 * * *', tz: 'Europe/Berlin' },
    { kind: 'manual' },
  ])
  assert.deepEqual(defaultTriggers({ triggers: [{ kind: 'inbound' }] }), [{ kind: 'manual' }])
  assert.deepEqual(optionalTriggers(architecture).map((t) => t.label), ['On every push', 'Every day at 03:00'])
})

test('the catalog groups by integration, GitHub first and webhook recipes last', () => {
  const groups = groupCatalog([
    { id: 'webhook-render', label: 'Draw from a webhook', integration: null },
    { id: 'slack-digest', label: 'Weekly digest', integration: 'slack' },
    architecture,
    { id: 'github-pr-impact', label: 'Pull request impact', integration: 'github' },
  ])
  assert.deepEqual(groups.map((g) => g.label), ['GitHub', 'Slack', 'Webhooks and schedules'])
  assert.deepEqual(groups[0].recipes.map((r) => r.id), ['github-architecture', 'github-pr-impact'])
  assert.deepEqual(groupCatalog(null), [])
})

test('what a recipe makes, in plain words (the status slate is not listed)', () => {
  assert.equal(outputsLine(architecture), 'Makes: Service map, Modules for each repo, What changed (board)')
})

test('the add dialog skips Connect when the integration is connected', () => {
  assert.deepEqual(addRecipeSteps(architecture).map((s) => s.id), ['pick', 'configure', 'preview'])
  assert.deepEqual(addRecipeSteps({ ...architecture, connected: false }).map((s) => s.id), ['pick', 'connect', 'configure', 'preview'])
  assert.deepEqual(addRecipeSteps({ integration: null }).map((s) => s.id), ['pick', 'configure', 'preview'])
  assert.equal(needsConnection({ integration: 'slack' }), true)
  assert.equal(needsConnection({ integration: null }), false)
})

test('the settings form comes from configSchema, with pickers', () => {
  const fields = configFields(architecture.configSchema)
  assert.deepEqual(fields.map((f) => [f.key, f.kind]), [['repos', 'repos'], ['depth', 'number'], ['includeTests', 'boolean'], ['layout', 'select'], ['paths', 'paths']])
  assert.equal(fields[0].label, 'Repos')
  assert.equal(fields[0].required, true)
  assert.equal(fields[0].multiple, true)
  assert.equal(fields[1].label, 'Depth')
  assert.deepEqual(defaultConfig(architecture.configSchema), { repos: [], depth: 2, includeTests: false, layout: 'layered', paths: [] })
  assert.deepEqual(configFields(null), [])
})

test('settings are checked against the schema before the preview (the server checks again)', () => {
  const schema = architecture.configSchema
  assert.deepEqual(validateConfig(schema, { repos: ['acme/api'], depth: 2 }), { ok: true, errors: {} })
  assert.equal(validateConfig(schema, { repos: [] }).errors.repos, 'Fill this in.')
  assert.equal(validateConfig(schema, { repos: ['a'], depth: 9 }).errors.depth, 'At most 4.')
  assert.equal(validateConfig(schema, { repos: ['a'], depth: 1.5 }).errors.depth, 'Enter a number.')
  assert.equal(validateConfig(schema, { repos: ['a'], layout: 'circle' }).errors.layout, 'Choose one of the options.')
  assert.equal(validateConfig(schema, { repos: ['a'], extra: 1 }).errors.extra, 'This recipe has no such setting.')
  assert.equal(validateConfig(schema, { repos: Array.from({ length: 11 }, (_, i) => `r${i}`) }).errors.repos, 'Choose at most 10.')
  const cron = { type: 'object', properties: { at: { type: 'string', 'x-slatebox-picker': 'cron' } } }
  assert.match(validateConfig(cron, { at: '* * * * *' }).errors.at, /15 minutes/)
})

test('changes outside Slatebox: exact words and scope, off by default, unverified kinds left out', () => {
  const rows = permissionRows(architecture, { repos: ['acme/api', 'acme/web'] }, [])
  assert.deepEqual(rows.map((r) => r.kind), ['github.check_run', 'github.pull_request'])
  assert.ok(rows.every((r) => r.granted === false))
  assert.equal(rows[0].text, 'Add a check to pushes in acme/api and acme/web')
  assert.equal(rows[1].text, 'Open pull requests in acme/api and acme/web on branches named slatebox/…, changing only docs/architecture/*.mmd')
  assert.deepEqual(rows[1].scope, { repos: ['acme/api', 'acme/web'], paths: ['docs/architecture/*.mmd'] })
  const granted = permissionRows(architecture, { repos: ['acme/api'] }, [{ _id: 'g1', kind: 'github.check_run' }, { _id: 'g2', kind: 'github.pull_request', revokedAt: new Date() }])
  assert.deepEqual(granted.map((r) => [r.granted, r.grantId]), [[true, 'g1'], [false, null]])
  assert.equal(writePermissionText('slack.post', { channels: ['eng', '#launch'] }), 'Post to #eng and #launch')
  assert.equal(writePermissionText('github.pr_comment', {}), 'Comment on pull requests in the chosen repos, one comment kept up to date')
})

test('webhooks: the common events then the recipe’s own; intercept points; https public addresses only', () => {
  const events = hookEvents(architecture).map((e) => e.id)
  assert.deepEqual(events.slice(0, COMMON_EVENTS.length), COMMON_EVENTS.map((e) => e.id))
  assert.deepEqual(events.slice(COMMON_EVENTS.length), ['architecture.updated', 'architecture.new_dependency'])
  for (const id of ['run.finished', 'diagram.changed', 'approval.needed', 'writeback.done', 'recipe.paused']) assert.ok(events.includes(id), id)
  assert.deepEqual(interceptPoints(architecture).map((p) => p.id), ['graph.ready', 'output.ready', 'writeback.proposed'])
  assert.deepEqual(interceptPoints({ intercepts: [] }), [])
  assert.equal(hookUrlProblem('https://hooks.acme.com/slatebox'), null)
  assert.match(hookUrlProblem('http://hooks.acme.com'), /https/)
  assert.match(hookUrlProblem('https://localhost:3000'), /internet/)
  assert.match(hookUrlProblem('https://10.0.0.4/x'), /internet/)
  assert.match(hookUrlProblem('https://192.168.1.2/x'), /internet/)
  assert.match(hookUrlProblem('https://172.20.0.1/x'), /internet/)
  assert.match(hookUrlProblem('not a url'), /full address/)
})

test('the inbound curl sample signs the body like Slatebox does and never holds the secret', () => {
  const sample = inboundCurlSample('https://app.slatebox.com/hooks/recipes/h1', { nodes: [] })
  assert.match(sample, /curl -X POST 'https:\/\/app\.slatebox\.com\/hooks\/recipes\/h1'/)
  assert.match(sample, /Slatebox-Signature: t=\$T,v1=\$SIG/)
  assert.match(sample, /Slatebox-Delivery: /)
  assert.match(sample, /printf '%s\.%s' "\$T" "\$BODY" \| openssl dgst -sha256 -hmac "\$SLATEBOX_HOOK_SECRET"/)
  assert.match(sample, /"data":\{"nodes":\[\]\}/)
  assert.doesNotMatch(sample, /whsec|sk_|secret_[a-z0-9]{8}/i)
})

test('the run history rows', () => {
  const row = runRow({
    _id: 'r1', state: 'done', mode: 'run', trigger: { kind: 'vendor', event: 'github.push' }, startedAt: NOW - 120e3, durationMs: 72000,
    stats: { tokensIn: 9000, tokensOut: 3300, added: 4, updated: 2, removed: 0, keptByPerson: 1 },
    changes: [{ slateId: 's1', outcome: 'saved' }, { slateId: 's1', outcome: 'saved' }, { slateId: 's2', outcome: 'suggested' }],
    writes: [{ kind: 'github.check_run', target: { repo: 'acme/api' }, state: 'card' }],
    log: [{ at: NOW - 100e3, level: 'info', code: 'fetch', msg: 'Read 12 files' }],
  }, NOW)
  assert.equal(row.when, '2 min ago')
  assert.equal(row.trigger, 'On every push')
  assert.equal(row.state, 'Done')
  assert.equal(row.duration, '1m 12s')
  assert.equal(row.tokens, '12k')
  assert.equal(row.changes, '4 added, 2 updated')
  assert.equal(row.kept, '1 note kept as people left them')
  assert.deepEqual(row.slates, ['s1', 's2'])
  assert.deepEqual(row.writes, [{ text: 'github.check_run · acme/api', state: 'waiting for approval' }])
  assert.equal(row.undoable, true)
  assert.equal(row.log[0].when, '1 min ago')
  const skipped = runRow({ state: 'skipped', skippedReason: 'paused', trigger: { kind: 'schedule' } }, NOW)
  assert.equal(skipped.state, 'Skipped: paused')
  assert.equal(skipped.trigger, 'Schedule')
  assert.equal(skipped.undoable, false)
  assert.equal(skipped.changes, 'No changes')
  const failed = runRow({ state: 'failed', error: { name: 'VendorError', status: 502, code: 'bad_gateway' } }, NOW)
  assert.equal(failed.error, 'VendorError · bad_gateway · 502')
})

test('numbers in tables', () => {
  assert.equal(formatDuration(450), '450 ms')
  assert.equal(formatDuration(9000), '9 s')
  assert.equal(formatDuration(600000), '10m 00s')
  assert.equal(formatDuration(undefined), '')
  assert.equal(formatTokens(0), '0')
  assert.equal(formatTokens(950), '950')
  assert.equal(formatTokens(1500), '1.5k')
  assert.equal(formatTokens(32000), '32k')
  assert.equal(formatTokens(2_400_000), '2.4M')
})

test('the delivery log rows', () => {
  assert.deepEqual(deliveryRow({ _id: 'e1', event: 'run.finished', attempt: 2, state: 'pending', responseCode: 503, durationMs: 120, nextAt: NOW - 60e3 }, NOW),
    { id: 'e1', event: 'run.finished', attempt: 2, state: 'Waiting to retry', code: 503, duration: '120 ms', when: '1 min ago' })
})

test('the slate panel: maintained notes per recipe, and the selected ones a recipe keeps', () => {
  const on = [
    { instanceId: 'i1', agentName: 'GitHub architect', ownerName: 'Ana Souza', noteIds: ['ga_1', 'ga_2', 'ga_3'] },
    { instanceId: 'i2', agentName: 'Decision log', ownerName: 'Bo', noteIds: [] },
  ]
  assert.deepEqual(maintainedSummary(on).map((s) => s.line), ['Maintained by GitHub architect · runs for Ana: 3 notes'])
  assert.deepEqual(selectedMaintained(on, ['ga_2', 'mine_1']), [{ instanceId: 'i1', agentName: 'GitHub architect', noteIds: ['ga_2'], line: 'Kept up to date by GitHub architect' }])
  assert.deepEqual(selectedMaintained(on, ['mine_1']), [])
  assert.deepEqual(maintainedSummary(null), [])
})

test('the first run’s preview in one line', () => {
  assert.equal(previewSummary({ slates: [{ counts: { notes: 30, connectors: 18 } }, { counts: { notes: 12, cards: 6 } }, { counts: {} }], tokens: { in: 9000, out: 3000 } }),
    'Makes 3 slates · 42 notes, 18 connectors, 6 cards · about 12k tokens a run')
  assert.equal(previewSummary({ slates: [] }), 'Makes 0 slates')
})

test('where recipes are off, a server admin sees the switch and everyone else sees nothing', () => {
  const off = { error: 'recipes_off' }
  assert.equal(recipesAvailability({ answer: { recipes: [] } }), 'on')
  assert.equal(recipesAvailability({ error: off, admin: true }), 'off-admin')
  assert.equal(recipesAvailability({ error: off, admin: false }), 'hidden')
  assert.equal(recipesAvailability({ error: { error: 'enterprise_locked' }, admin: true }), 'hidden')
  assert.equal(recipeErrorWords(off), RECIPES_OFF_COPY)
  assert.equal(RECIPES_OFF_COPY, 'An admin turns recipes on in Admin › Recipes.')
  assert.equal(recipeErrorWords({ error: 'zzz', reason: 'No.' }), 'No.')
})

test('an instance’s default name says what it watches', () => {
  assert.equal(instanceName(architecture, { repos: ['acme/api'] }), 'Living architecture · acme/api')
  assert.equal(instanceName(architecture, { repos: ['a', 'b', 'c', 'd'] }), 'Living architecture · a, b +2')
  assert.equal(instanceName({ label: 'Sheet board' }, { files: [{ id: 'f', name: 'Org chart' }] }), 'Sheet board · Org chart')
  assert.equal(instanceName(architecture, {}), 'Living architecture')
})

test('enterprise fills the recipe slots, outside the invited-agents switch', () => {
  const index = ent('index.jsx')
  for (const slot of ['project.recipesTab', 'project.recipes', 'project.addRecipe', 'canvas.recipes', 'admin.recipes', 'team.recipes', 'profile.recipes']) {
    assert.match(index, new RegExp(`api\\.fill\\('${slot.replace('.', '\\.')}'`), slot)
  }
  assert.ok(index.indexOf("api.fill('project.recipes'") < index.indexOf('if (!context?.agentInvite) return'), 'recipes do not depend on invited agents')
  const app = (p) => read('web/app/imports/ui/' + p)
  assert.match(app('pages/Canvas.jsx'), /<EnterpriseSlot name="canvas\.recipes"/)
  assert.match(app('pages/AdminTools.jsx'), /<EnterpriseSlot name="admin\.recipes" \/>/)
  assert.match(app('pages/TeamSettings.jsx'), /<EnterpriseSlot name="team\.recipes" \/>/)
  assert.match(app('pages/Profile.jsx'), /<EnterpriseSlot name="profile\.recipes" \/>/)
})

test('the UI calls the recipes.* actions by id; grant and revoke stay browser-only', () => {
  const api = ent('recipes/recipesApi.js')
  for (const id of ['catalog', 'list', 'get', 'create', 'update', 'preview', 'activate', 'run', 'pause', 'resume', 'delete', 'runs', 'undoRun',
    'notesOn', 'transfer', 'grant', 'revoke', 'hooks.list', 'hooks.add', 'hooks.remove', 'hooks.rotate', 'hooks.test', 'deliveries', 'admin.setEnabled']) {
    assert.match(api, new RegExp(`call\\('recipes\\.${id.replace('.', '\\.')}'`), id)
  }
  assert.match(api, /enterpriseSlots\.lockIfRefused\(error\)/)
})

test('add recipe: four steps, a preview that saves nothing, permissions off by default, Turn on activates', () => {
  const dialog = ent('recipes/AddRecipeDialog.jsx')
  assert.match(dialog, /recipesApi\.preview\(\{ instanceId: made\._id \}\)/)
  assert.match(dialog, /recipesApi\.activate\(\{ instanceId: instance\._id \}\)/)
  assert.match(dialog, /<SnapSlate slate=\{s\.slate\}/)
  assert.match(dialog, /<RecipePermissions /)
  assert.match(dialog, /Install Slatebox on GitHub/)
  assert.match(dialog, />Turn on</)
  const perms = ent('recipes/RecipePermissions.jsx')
  assert.match(perms, /checked=\{row\.granted\}/)
  assert.match(perms, /Off unless you turn them on/)
})

test('webhooks: the secret is shown once, test sends, delivery log, rotation keeps the old one 24 h', () => {
  const hooks = ent('recipes/RecipeHooks.jsx')
  assert.match(hooks, /Copy the secret now\. It is not shown again\./)
  assert.match(hooks, /recipesApi\.hooks\.test\(/)
  assert.match(hooks, /recipesApi\.hooks\.rotate\(/)
  assert.match(hooks, /recipesApi\.deliveries\(/)
  assert.match(hooks, /inboundCurlSample\(/)
  assert.match(hooks, /hookUrlProblem\(url\)/)
})

test('runs: live from recipes.runsFor, a log per run, and Undo this run', () => {
  const runs = ent('recipes/RecipeRuns.jsx')
  assert.match(runs, /Meteor\.subscribe\('recipes\.runsFor', instance\._id, limit\)/)
  assert.match(runs, /Undo this run/)
  assert.match(runs, /recipesApi\.undoRun\(\{ runId: run\._id \}\)/)
  assert.match(ent('recipes/ProjectRecipes.jsx'), /Meteor\.subscribe\('recipes\.forProject', projectId\)/)
  assert.match(ent('collections.js'), /new Mongo\.Collection\('recipeInstances'\)/)
  assert.match(ent('collections.js'), /new Mongo\.Collection\('recipeRuns'\)/)
})

test('switches: project pause for managers, the owner’s pause, the team toggle, the install switch', () => {
  assert.match(ent('recipes/ProjectRecipes.jsx'), /atLeast\(role, 'manager'\) && instances\.length > 0 && \([\s\S]{0,200}Pause recipes in this project/)
  assert.match(ent('recipes/ProfileRecipes.jsx'), /Pause all my recipes/)
  assert.match(ent('recipes/TeamRecipes.jsx'), /Allow recipes for this team/)
  assert.match(ent('recipes/RecipesAdmin.jsx'), /recipesApi\.admin\.setEnabled\(\{ enabled/)
  assert.match(ent('recipes/RecipesAdmin.jsx'), /Turn on recipes/)
})

test('the slate panel selects with the engine and never draws over the canvas', () => {
  const panel = ent('recipes/MaintainedNotes.jsx')
  assert.match(panel, /v2\.selectNodes\(nodes, false\)/)
  assert.match(panel, /Make it mine/)
  assert.match(panel, /recipesApi\.makeMine\(\{ shareId, noteIds: entry\.noteIds \}\)/)
  assert.doesNotMatch(panel.replace(/\/\/.*$/gm, ""), /<svg|getBoundingClientRect|overlay/i, "no drawing of its own over the canvas")
})

test('recipe copy says agent not AI, US spelling, sentence case buttons', () => {
  for (const f of ['recipesModel.mjs', 'AddRecipeDialog.jsx', 'ConfigForm.jsx', 'ProjectRecipes.jsx', 'RecipeHooks.jsx', 'RecipeRuns.jsx',
    'RecipePermissions.jsx', 'RecipesAdmin.jsx', 'TeamRecipes.jsx', 'ProfileRecipes.jsx', 'MaintainedNotes.jsx']) {
    const src = ent('recipes/' + f)
    assert.doesNotMatch(src, /\bAI\b/, f)
    assert.doesNotMatch(src, /colour|organis|behaviour|licence|favourite/i, f)
    assert.doesNotMatch(src, />(Run Now|Add A Recipe|Turn On|Send Test|New Secret|Undo This Run|Make It Mine|Select Them)</, f)
  }
})
