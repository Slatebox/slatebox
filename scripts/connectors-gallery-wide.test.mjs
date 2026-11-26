// The wide gallery (owner, 2026-11-26: "GitHub, Linear, Notion, Jira, Slack, Sentry, Microsoft, Google,
// Miro, Figma, Canva, Adobe, Replit, Lovable ... all MCP servers are welcome"): every card is the
// vendor's own server at the vendor's own host, signs in the way its vendor's metadata allows (a card
// needing an operator's app names a known provider that serves exactly its address), has its planner
// hint in the prompt registry, and its recipe's tools are grouped right (asks look up, writes change,
// look-arounds only look up). Where a server's tool list could be read (an open tools/list, or the
// vendor's published list), every tool a recipe names is on it.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/connectors-gallery-wide.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GALLERY, canonicalAddress, cardFor, writesAddress } from '../enterprise/common/gallery.mjs'
import { KNOWN_PROVIDERS } from '../enterprise/server/oauth.mjs'
import { checkLookAround, checkRecipe, LOOK_LIMITS, matchIntent, requestValues } from '../enterprise/server/recipes.mjs'
import { classifyTool } from '../enterprise/server/tools.mjs'
import { PROMPT_IDS } from '../web/app/server/ai-control/prompts/index.mjs'

// Each card's vendor, by the registrable domain its server lives under (aliases too). A card for a new
// server is added here on purpose, with its vendor: the gallery lists first-party servers only.
const VENDOR = {
  huggingface: 'huggingface.co', github: 'githubcopilot.com', linear: 'linear.app', deepwiki: 'deepwiki.com', context7: 'context7.com', wolfram: 'wolfram.com',
  firecrawl: 'firecrawl.dev', exa: 'exa.ai', notion: 'notion.com', atlassian: 'atlassian.com', slack: 'slack.com', granola: 'granola.ai', asana: 'asana.com',
  monday: 'monday.com', clickup: 'clickup.com', trello: 'trello.com', airtable: 'airtable.com', zapier: 'zapier.com', hubspot: 'hubspot.com', stripe: 'stripe.com',
  posthog: 'posthog.com', sentry: 'sentry.dev', jina: 'jina.ai', parallel: 'parallel.ai',
  gitlab: 'gitlab.com', vercel: 'vercel.com', netlify: 'netlify.app', supabase: 'supabase.com', neon: 'neon.tech', cloudflare: 'cloudflare.com',
  datadog: ['datadoghq.com', 'datadoghq.eu'], pagerduty: 'pagerduty.com', postman: 'postman.com', replit: 'replit-mcp.com', lovable: 'lovable.dev', v0: 'v0.app',
  figma: 'figma.com', miroboard: 'miro.com', canva: 'canva.com', lucid: 'lucid.app', whimsical: 'whimsical.com', webflow: 'webflow.com', framer: 'framer.com',
  gamma: 'gamma.app', pitch: 'pitch.com', wix: 'wix.com', adobeaem: 'adobeaemcloud.com', adobefirefly: 'adobe.io',
  microsoft365: 'cloud.microsoft', microsoftdirectory: 'cloud.microsoft', gmail: 'googleapis.com', googlecalendar: 'googleapis.com', googledocs: 'googleapis.com',
  googlesheets: 'googleapis.com', googlechat: 'googleapis.com', dropbox: 'dropbox.com', dropboxdash: 'dropbox.com', box: 'box.com', zoom: 'zoom.us', calendly: 'calendly.com',
  todoist: 'todoist.net', coda: 'coda.io', make: 'make.com', salesforce: 'salesforce.com', intercom: 'intercom.com', typeform: 'typeform.com', attio: 'attio.com',
  pipedrive: 'pipedrive.ai', apollo: 'apollo.io', square: 'squareup.com', paypal: 'paypal.com', microsoftlearn: 'microsoft.com', cloudflaredocs: 'cloudflare.com',
}
// The cards whose servers answer with no sign-in.
const OPEN = ['huggingface', 'deepwiki', 'context7', 'wolfram', 'firecrawl', 'exa', 'jina', 'parallel', 'microsoftlearn', 'cloudflaredocs']
// Tool lists read from the servers themselves (an open tools/list, 2026-11-26) or the vendor's published list (Lovable's docs).
const VERIFIED = {
  gmail: ['create_draft', 'list_drafts', 'get_draft', 'get_thread', 'get_message', 'search_threads', 'label_thread', 'unlabel_thread', 'trash_thread', 'list_labels', 'create_label'],
  googlecalendar: ['list_events', 'get_event', 'list_calendars', 'suggest_time', 'create_event', 'update_event', 'delete_event', 'respond_to_event', 'search_events'],
  googledocs: ['read_doc', 'update_doc'],
  googlesheets: ['get_values', 'get_spreadsheet', 'update_spreadsheet', 'update_values', 'update_formulas', 'insert_dimension'],
  googlechat: ['list_messages', 'search_messages', 'search_conversations', 'send_message'],
  microsoftlearn: ['microsoft_docs_search', 'microsoft_code_sample_search', 'microsoft_docs_fetch'],
  cloudflaredocs: ['search_cloudflare_documentation', 'migrate_pages_to_workers_guide'],
  lovable: ['get_me', 'list_workspaces', 'get_workspace', 'list_projects', 'get_project', 'create_project', 'deploy_project', 'remix_project', 'set_project_visibility',
    'set_folder_visibility', 'move_projects_to_folder', 'list_template_projects', 'list_design_systems', 'send_message', 'get_message', 'respond_to_approval', 'list_messages',
    'create_draft', 'list_drafts', 'get_draft', 'rename_draft', 'accept_draft', 'reject_draft'],
}
const hostOf = (url) => new URL(url).hostname
const under = (host, domain) => host === domain || host.endsWith('.' + domain)
const options = (tool) => [].concat(tool || [])

test('every card is its vendor\'s own server, at the vendor\'s own host (aliases too)', () => {
  assert.deepEqual(GALLERY.map((c) => c.id).filter((id) => !VENDOR[id]), [], 'each card names its vendor here')
  for (const card of GALLERY) {
    const domains = [].concat(VENDOR[card.id])
    for (const url of [card.url, ...(card.aliases || [])]) {
      assert.equal(new URL(url).protocol, 'https:', `${card.id}: ${url}`)
      assert.ok(domains.some((d) => under(hostOf(url), d)), `${card.id}: ${url} is not under ${domains.join(' or ')}`)
      assert.equal(cardFor(url).id, card.id, `${url} is ${card.id}'s`)
    }
  }
  // The owner's list, each with a card (Microsoft and Google through their own remote servers).
  for (const id of ['github', 'linear', 'notion', 'atlassian', 'slack', 'sentry', 'microsoft365', 'gmail', 'googlecalendar', 'miroboard', 'figma', 'canva', 'adobeaem', 'replit', 'lovable'])
    assert.ok(GALLERY.some((c) => c.id === id), id)
  // Excalidraw stays retired; tldraw (a canvas of its own) is not listed.
  assert.equal(cardFor('https://mcp.excalidraw.com/mcp'), null)
  assert.ok(!GALLERY.some((c) => /tldraw/.test(c.url)))
})

test('sign-in is consistent: open cards need none; a card needing an operator\'s app names a known provider that serves exactly its server', () => {
  for (const card of GALLERY) {
    if (OPEN.includes(card.id)) {
      assert.equal(card.signIn, undefined, card.id)
      assert.equal(card.needsApp, undefined, card.id)
      continue
    }
    assert.equal(card.signIn, 'oauth', card.id)
    if (!card.needsApp) continue
    const provider = KNOWN_PROVIDERS[card.needsApp]
    assert.ok(provider, `${card.id}: ${card.needsApp} is a known provider`)
    assert.ok(provider.resources.includes(new URL(card.url).origin), `${card.id}: ${card.needsApp}'s sign-in is sent to ${new URL(card.url).origin}`)
  }
  // Signing in before the first tool call is only for Google's servers (they answer initialize openly).
  assert.deepEqual(GALLERY.filter((c) => c.signInFirst).map((c) => c.needsApp).filter((p) => p !== 'google'), [])
  assert.ok(GALLERY.filter((c) => c.needsApp === 'google').every((c) => c.signInFirst), 'every Google card signs in first')
  // Microsoft through its own remote servers, one operator app for both cards
  assert.deepEqual(GALLERY.filter((c) => c.needsApp === 'microsoft').map((c) => c.id), ['microsoft365', 'microsoftdirectory'])
})

test('every card has its planner hint in the prompt registry, editable in /admin/ai', () => {
  assert.deepEqual(GALLERY.filter((c) => !PROMPT_IDS.includes('connectors.recipe.' + c.id)).map((c) => c.id), [])
})

test('recipes: asks only look up, known changes are changes, look-arounds only look up, and the tools word puts money, code and SQL behind a switch', () => {
  for (const card of GALLERY) {
    const recipe = checkRecipe(card.recipe)
    assert.equal(recipe.intents.length, (card.recipe.intents || []).length, `${card.id}: every ask survives the check`)
    assert.equal((recipe.writes || []).length, (card.recipe.writes || []).length, `${card.id}: every write survives the check`)
    const kind = (name) => classifyTool({ name }, recipe.tools?.[name] || null)
    for (const intent of recipe.intents)
      for (const step of intent.steps) for (const name of options(step.tool)) assert.equal(kind(name), 'lookup', `${card.id} ${intent.key}: ${name} looks up`)
    for (const write of recipe.writes || []) for (const name of options(write.tool)) assert.notEqual(kind(name), 'lookup', `${card.id} ${write.key}: ${name} is a change`)
    if (card.recipe.lookAround) {
      assert.ok(recipe.lookAround, `${card.id}: its look-around survives the check`)
      assert.ok(recipe.lookAround.steps.length <= LOOK_LIMITS.steps, card.id)
      for (const step of recipe.lookAround.steps) {
        assert.ok(step.args && typeof step.args === 'object', `${card.id}: fixed arguments only`)
        for (const name of options(step.tool)) assert.equal(kind(name), 'lookup', `${card.id} look-around: ${name} looks up`)
      }
    }
  }
  const destructive = (id, name) => assert.equal(checkRecipe(cardFor(GALLERY.find((c) => c.id === id).url).recipe).tools[name], 'destructive', `${id}: ${name}`)
  for (const [id, name] of [['supabase', 'execute_sql'], ['supabase', 'apply_migration'], ['neon', 'run_sql'], ['cloudflare', 'execute'], ['square', 'make_api_request'],
    ['paypal', 'create_refund'], ['stripe', 'create_refund'], ['lovable', 'deploy_project'], ['vercel', 'buy_domain'], ['microsoft365', 'delete_entity']]) destructive(id, name)
})

test('where a server\'s own tool list is known, every tool its recipe names is on it', () => {
  for (const [id, tools] of Object.entries(VERIFIED)) {
    const recipe = checkRecipe(GALLERY.find((c) => c.id === id).recipe)
    const steps = [...recipe.intents.flatMap((i) => i.steps), ...(recipe.writes || []), ...(recipe.lookAround?.steps || [])]
    for (const step of steps) assert.ok(options(step.tool).some((name) => tools.includes(name)), `${id}: one of ${options(step.tool).join(', ')} is a tool it lists`)
    for (const name of Object.keys(recipe.tools || {})) assert.ok(tools.includes(name), `${id}: ${name} is a tool it lists`)
  }
})

test('addresses that moved or have regional twins are the same card; the old Atlassian addresses make changes at v2', () => {
  assert.equal(cardFor('https://mcp.atlassian.com/v1/sse').id, 'atlassian')
  assert.equal(writesAddress('https://mcp.atlassian.com/v1/mcp'), 'https://mcp.atlassian.com/v2/mcp')
  assert.equal(writesAddress('https://mcp.atlassian.com/v2/mcp'), null)
  // Datadog's other sites are the same card, and it has no write that could be sent to the wrong site.
  assert.equal(cardFor('https://mcp.datadoghq.eu/api/unstable/mcp-server/mcp').id, 'datadog')
  assert.equal(writesAddress('https://mcp.datadoghq.eu/api/unstable/mcp-server/mcp'), null)
  assert.equal(cardFor('https://mcp.eu.intercom.com/mcp').id, 'intercom')
  assert.equal(writesAddress('https://mcp.eu.intercom.com/mcp'), null)
  // Miro's resource keeps its trailing slash; the stored address is the canonical one.
  assert.equal(canonicalAddress(GALLERY.find((c) => c.id === 'miroboard').url), 'https://mcp.miro.com')
  assert.equal(cardFor('https://mcp.miro.com').id, 'miroboard')
})

test('a look-around is fixed lookups only: no planner, at most a few steps, nothing malformed', () => {
  assert.equal(checkLookAround(null), null)
  assert.equal(checkLookAround({ steps: [] }), null)
  assert.equal(checkLookAround({ steps: [{ tool: 'list_projects', args: 'plan' }] }), null, 'a planner never fills a look-around')
  const checked = checkLookAround({ steps: [{ tool: 'a' }, { tool: ['b', 'c'], args: { limit: 5, q: 'x' } }, { tool: 'bad name!' }, { tool: 'd' }, { tool: 'e' }] })
  assert.deepEqual(checked.steps.map((s) => s.tool), ['a', ['b', 'c']], 'the first three steps only, the malformed one dropped')
  assert.deepEqual(checked.steps[1].args, { limit: 5, q: 'x' })
  assert.deepEqual(checkLookAround({ steps: [{ tool: 'd', args: { nested: { x: 1 }, n: 2 } }] }).steps[0].args, { n: 2 }, 'only plain values pass')
})

test('a card\'s example ask runs one of its known asks (unless it asks for a change), and a broad ask never catches a request for a change', () => {
  // the example asks that are changes, or that only the planner answers well
  const planned = ['cloudflare', 'lovable', 'v0', 'wix']
  for (const card of GALLERY) {
    const recipe = checkRecipe(card.recipe)
    if (!recipe.intents.length || planned.includes(card.id)) continue
    assert.ok(matchIntent(recipe, card.try, requestValues(card.try)), `${card.id}: "${card.try}"`)
  }
  const ask = (id, words) => matchIntent(checkRecipe(GALLERY.find((c) => c.id === id).recipe), words, requestValues(words))?.key || null
  assert.equal(ask('slack', 'What did #launch decide about the pricing page this week?'), 'channel')
  assert.equal(ask('slack', 'Post in #launch that the pricing page ships Friday'), null)
  assert.equal(ask('trello', 'Create a card for the retry bug'), null)
  assert.equal(ask('airtable', 'Add a row for each note'), null)
  assert.equal(ask('hubspot', 'Update the Acme contact to closed won'), null)
  assert.equal(ask('atlassian', 'Show my open tickets'), 'my-issues')
  assert.equal(ask('sentry', 'What are the top new errors since yesterday\'s release?'), 'issues')
})
