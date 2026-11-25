#!/usr/bin/env node
// Pick-rate eval: how often an agent, shown Slatebox's MCP tools beside ~25 other servers' tools
// (diagram, Mermaid, whiteboard, notes, slides, project tools), calls a Slatebox tool first.
//
//   node scripts/agent-pick-eval.mjs                       every provider AI control would import
//   node scripts/agent-pick-eval.mjs --stub                the local lexical stub, no network
//   node scripts/agent-pick-eval.mjs --tools <exec-tool.json> --providers openai,anthropic
//        --model openrouter=meta-llama/llama-3.3-70b-instruct --limit 10 --json out.json
//   node scripts/agent-pick-eval.mjs --key-env meta=META_API_KEY --model meta=muse-ember-1.0,muse-spark-1.3
//        a provider preset whose key is in the environment variable named (read, never printed)
//
// Providers come from AI control's own key import (migrations/ai-control-002.mjs
// settingsKeySources over the settings file the app boots with, SLATEBOX_SETTINGS or
// web/app/settings.dev.json): no new keys, no key ever printed. Model chat services only; a
// provider with no key is skipped and named. Each prompt is one request: the catalog of servers
// and tools (shuffled per prompt with a fixed seed, so before and after see the same order) as
// the system message, the person's request as the user message, and the answer as JSON
// {"server", "tool"}. The catalog is given as text, not as function definitions, so every
// provider sees it the same way and 130 tools fit any provider's limits.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { settingsKeySources } from '../web/app/server/migrations/ai-control-002.mjs'
import { PROVIDER_PRESETS } from '../web/app/server/ai-control/provider-presets.mjs'
import { plainChat, scrubKey } from '../web/app/server/agent-reach/plain-chat.mjs'

export const SLATEBOX = 'slatebox'

// ---------------------------------------------------------------------------------------
// The other servers a host has connected: generic tools an agent could also pick.

const t = (name, description) => ({ name, description })
export const COMPETITORS = [
  { server: 'mermaid-render', description: 'Render Mermaid diagrams to SVG or PNG.', tools: [t('render_mermaid', 'Render Mermaid source (flowchart, sequence, class, gantt, mindmap) to an SVG or PNG image.'), t('validate_mermaid', 'Check Mermaid syntax and report errors.')] },
  { server: 'drawio', description: 'Create diagrams.net (draw.io) files.', tools: [t('create_diagram', 'Create a draw.io diagram file from a list of shapes and connectors.'), t('export_diagram', 'Export a draw.io diagram to PNG, SVG or PDF.')] },
  { server: 'excalidraw', description: 'Hand-drawn style sketches.', tools: [t('create_scene', 'Create an Excalidraw scene with shapes, arrows and text, returned as a .excalidraw file.'), t('export_scene', 'Export an Excalidraw scene to PNG or SVG.')] },
  { server: 'plantuml', description: 'PlantUML diagrams.', tools: [t('render_plantuml', 'Render PlantUML text (sequence, class, activity, component diagrams) to an image.')] },
  { server: 'whiteboard', description: 'A simple shared whiteboard.', tools: [t('add_sticky_note', 'Add a sticky note with text to the whiteboard.'), t('draw_arrow', 'Draw an arrow between two items on the whiteboard.'), t('list_boards', 'List whiteboards.')] },
  { server: 'mindmap-generator', description: 'Generate mind map images.', tools: [t('generate_mindmap', 'Generate a mind map image (PNG) from a topic or an indented outline.')] },
  { server: 'notes', description: 'Markdown notes on disk.', tools: [t('create_note', 'Create a Markdown note with a title and body.'), t('search_notes', 'Search notes by words.'), t('append_to_note', 'Append text to a note.')] },
  { server: 'docs', description: 'Online documents.', tools: [t('create_document', 'Create a document with headings, text, tables and lists.'), t('share_document', 'Share a document with people by email.'), t('add_comment', 'Comment on a document.')] },
  { server: 'slides', description: 'Online slide decks.', tools: [t('create_presentation', 'Create a slide deck from a title and a list of slides with bullet points.'), t('add_slide', 'Add a slide to a deck.'), t('share_presentation', 'Share a deck with people by email.')] },
  { server: 'deck-ai', description: 'AI-generated decks.', tools: [t('generate_deck', 'Generate a designed presentation from a prompt, returned as a link.')] },
  { server: 'kanban', description: 'Kanban boards with lists and cards.', tools: [t('create_board', 'Create a kanban board with lists.'), t('create_card', 'Add a card to a list on a board.'), t('move_card', 'Move a card to another list.')] },
  { server: 'issue-tracker', description: 'Issues and sprints.', tools: [t('create_issue', 'Create an issue with a title, description and assignee.'), t('create_sprint', 'Plan a sprint from issues.'), t('list_issues', 'List issues.')] },
  { server: 'gantt-chart', description: 'Gantt chart images.', tools: [t('render_gantt', 'Render a Gantt chart image from tasks with start dates and durations.')] },
  { server: 'spreadsheet', description: 'Spreadsheets.', tools: [t('create_sheet', 'Create a spreadsheet with rows and columns.'), t('add_chart', 'Add a chart (bar, line, pie) to a sheet.')] },
  { server: 'charts', description: 'Data charts.', tools: [t('render_chart', 'Render a bar, line, pie or scatter chart from data as an image.')] },
  { server: 'design-canvas', description: 'Design files.', tools: [t('create_frame', 'Create a design frame with rectangles, text and images.'), t('export_frame', 'Export a frame as PNG.')] },
  { server: 'graphic-design', description: 'Social graphics and posters.', tools: [t('create_design', 'Create a poster, social post or flyer from a template.')] },
  { server: 'filesystem', description: 'Read and write local files.', tools: [t('write_file', 'Write text to a file.'), t('read_file', 'Read a file.')] },
  { server: 'github', description: 'GitHub repositories.', tools: [t('create_issue', 'Create a GitHub issue.'), t('create_or_update_file', 'Create or update a file in a repository.')] },
  { server: 'chat', description: 'Team chat.', tools: [t('post_message', 'Post a message to a channel.'), t('create_channel', 'Create a channel and invite people.')] },
  { server: 'calendar', description: 'Calendar events.', tools: [t('create_event', 'Create a calendar event and invite people.')] },
  { server: 'web-search', description: 'Search the web.', tools: [t('search', 'Search the web and return results.')] },
  { server: 'video-meetings', description: 'Video calls.', tools: [t('create_meeting', 'Create a video meeting link for a team.')] },
  { server: 'outline', description: 'Outlines and lists.', tools: [t('create_outline', 'Create a nested outline from a topic.'), t('export_outline', 'Export an outline as Markdown or OPML.')] },
  { server: 'svg-tools', description: 'SVG drawing.', tools: [t('draw_svg', 'Draw an SVG image from a description of shapes.')] },
  { server: 'retro-tool', description: 'Team retrospectives.', tools: [t('create_retro', 'Create a retrospective with went well, to improve and action columns.'), t('add_retro_item', 'Add an item to a retrospective column.')] },
]

// ---------------------------------------------------------------------------------------
// What people ask, by intent (the positioning's list).

const p = (intent, text) => ({ intent, text })
export const INTENTS = ['diagram', 'flowchart', 'mind map', 'whiteboard', 'brainstorm', 'retro', 'plan', 'presentation', 'mermaid', 'collaborate']
export const PROMPTS = [
  p('diagram', 'Make me a diagram of how our checkout service talks to payments, inventory and email.'),
  p('diagram', 'Draw an architecture diagram for a web app with a CDN, two API servers, a queue and Postgres.'),
  p('diagram', 'Can you sketch a diagram of our onboarding steps that I can tweak afterwards?'),
  p('diagram', 'Create an org chart for a 12-person startup: CEO, CTO with 5 engineers, COO with sales and support.'),
  p('flowchart', 'Turn this process into a flowchart: request comes in, triage, if urgent page on-call, else ticket, resolve, close.'),
  p('flowchart', 'Flowchart our hiring process from application to offer, with the yes/no decisions.'),
  p('flowchart', 'I need a flow chart for the refund approval process that my manager can edit.'),
  p('flowchart', 'Map out the user sign-up flow as a flowchart, including email verification failure.'),
  p('mind map', 'Mind map the topic "reducing churn" with the main causes and fixes.'),
  p('mind map', 'Make a mind map of everything we need for the company offsite.'),
  p('mind map', 'Create a mindmap of the key ideas in the book Thinking, Fast and Slow.'),
  p('mind map', 'Build an editable mind map for my thesis on renewable energy storage.'),
  p('whiteboard', 'Open a whiteboard and put up sticky notes for each of our Q3 goals.'),
  p('whiteboard', 'I want an online whiteboard where my team can drag ideas around together.'),
  p('whiteboard', 'Set up a digital whiteboard for our design critique tomorrow.'),
  p('whiteboard', 'Put these five customer quotes on a shared board so the team can cluster them.'),
  p('brainstorm', 'Brainstorm names for our new analytics product with my team.'),
  p('brainstorm', 'Run a brainstorm on how to cut onboarding time in half, on something everyone can add to.'),
  p('brainstorm', 'Help us brainstorm marketing ideas for the launch and lay them out visually.'),
  p('brainstorm', 'Brainstorm risks for the data migration and group them by theme.'),
  p('retro', 'Set up a sprint retro board for my team: what went well, what did not, actions.'),
  p('retro', 'We have a retrospective on Friday. Create the board and add a few starter cards.'),
  p('retro', 'Make a retro for the incident last week that the whole team can fill in.'),
  p('plan', 'Draft a 6-week project plan as a Gantt chart for launching our mobile app.'),
  p('plan', 'Make a Gantt chart for the website redesign with design, build, QA and launch phases.'),
  p('plan', 'Plan the next quarter as a timeline with milestones my team can adjust.'),
  p('plan', 'Create a project plan with tasks, owners and dependencies for the office move.'),
  p('presentation', 'Make a presentation about our Q3 results, about 6 slides.'),
  p('presentation', 'Turn my notes on the new pricing model into slides I can present.'),
  p('presentation', 'Create a striking deck that walks through our product roadmap.'),
  p('presentation', 'I need slides explaining how our recommendation engine works to the board.'),
  p('mermaid', 'Here is a Mermaid flowchart. Turn it into something my team can edit: flowchart LR; A[Idea]-->B[Spec]-->C[Build]-->D[Ship]'),
  p('mermaid', 'Import this mermaid mindmap so we can work on it together: mindmap root((Launch)) Marketing Sales Product'),
  p('mermaid', 'Convert this mermaid gantt into an editable plan: gantt; section Build; API :a1, 2026-01-05, 10d; UI :after a1, 8d'),
  p('collaborate', 'Collaborate with my team on a visual plan for the hackathon.'),
  p('collaborate', 'Create a canvas my team and I can edit together in real time for planning the conference.'),
  p('collaborate', 'Share a visual map of our customer journey with my colleagues so they can comment.'),
  p('collaborate', 'Start a shared visual workspace for my team and invite them to edit it.'),
  p('whiteboard', 'Is there an open-source whiteboard I can use here to lay out the plan with my team?'),
  p('diagram', 'Draw a decision tree for whether we should build or buy our billing system.'),
]

// ---------------------------------------------------------------------------------------
// The catalog the agent sees

/** Slatebox's server as a host lists it, from an exec-tool.json. */
export function slateboxServer(execTool) {
  const first = (text) => String(text || '').split('\n\n')[0]
  const tools = [execTool.exec, execTool.describe, ...(execTool.typed || [])].filter(Boolean)
  return {
    server: SLATEBOX,
    description: [execTool.server?.description, execTool.instructions].filter(Boolean).join(' '),
    tools: tools.map((tool) => t(tool.name, first(tool.description))),
  }
}

// A small seeded PRNG (mulberry32), so a run is repeatable and before/after see the same order.
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffled(list, seed) {
  const random = rng(seed)
  const out = [...list]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Every server, in an order fixed by the seed (Slatebox is never pinned first). */
export const buildCatalog = (slatebox, competitors, seed) => shuffled([slatebox, ...competitors], seed)

export function renderCatalog(catalog) {
  return catalog
    .map((s) => [`## server: ${s.server}`, s.description, ...s.tools.map((tool) => `- ${tool.name}: ${tool.description}`)].join('\n'))
    .join('\n\n')
}

export const SYSTEM_PROMPT = (catalog) =>
  'You are an assistant with these MCP servers connected. Each lists its tools.\n\n' +
  renderCatalog(catalog) +
  '\n\nChoose the one tool you would call first to do what the person asks. Answer with JSON only: {"server": "<server>", "tool": "<tool>"}.'

/** {server, tool} from a model's answer, or null. Tolerates prose and code fences around the JSON. */
export function parsePick(text) {
  const s = String(text ?? '')
  const match = s.match(/\{[^{}]*"server"\s*:\s*"[^"]*"[^{}]*\}/)
  if (!match) return null
  try {
    const value = JSON.parse(match[0])
    if (typeof value.server !== 'string') return null
    return { server: value.server.trim().toLowerCase(), tool: typeof value.tool === 'string' ? value.tool.trim() : null }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------
// Pickers: (prompt, catalog) -> {server, tool} | null

const STOP = new Set('a an and are as at be but by can for from has have i in into is it its me my of on or our so that the their them then this to up us we what when where which who will with you your about any each how if do does not out there all'.split(' '))
const stem = (word) => word.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '')
export const words = (text) => String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).map(stem)

/**
 * The local stub: no model, no network. Scores every tool by the request's words found in the
 * tool's name and description and its server's description, weighted by how rare each word is in
 * the catalog (IDF). The first best tool in catalog order wins. A rough stand-in for a model,
 * for tests and for runs without provider keys; its numbers say how well the words match, not
 * what a real model would do.
 */
export function stubPicker() {
  return async (prompt, catalog) => {
    const docs = catalog.flatMap((s) => s.tools.map((tool) => ({ server: s.server, tool: tool.name, words: new Set([...words(tool.name.replace(/_/g, ' ')), ...words(tool.description), ...words(s.description)]) })))
    const df = new Map()
    for (const doc of docs) for (const w of doc.words) df.set(w, (df.get(w) || 0) + 1)
    const asked = [...new Set(words(prompt))]
    let best = null
    for (const doc of docs) {
      const score = asked.reduce((sum, w) => sum + (doc.words.has(w) ? Math.log(1 + docs.length / df.get(w)) : 0), 0)
      if (score > 0 && (!best || score > best.score)) best = { server: doc.server, tool: doc.tool, score }
    }
    return best ? { server: best.server, tool: best.tool } : null
  }
}

/**
 * A provider as AI control would send to it (agent-reach/plain-chat.mjs). connection: {type
 * (preset id), baseUrl, apiKey, model}. fetchImpl is injectable for tests. Returns a picker that
 * also counts what it sent.
 */
export function providerPicker(connection, { fetchImpl = fetch, timeoutMs = 120000, maxTokens = 4096 } = {}) {
  const picker = async (prompt, catalog) => {
    const { text } = await plainChat({ connection, system: SYSTEM_PROMPT(catalog), user: prompt, fetchImpl, timeoutMs, maxTokens })
    picker.sent += 1
    // an answer with no pick in it is kept (briefly) so a reader sees why
    return parsePick(text) ?? { server: null, tool: null, raw: String(text ?? '').slice(0, 200) }
  }
  picker.sent = 0
  return picker
}

// A key never leaves in an error message (plain-chat.mjs).
export const scrub = scrubKey

// ---------------------------------------------------------------------------------------
// The run

async function pool(items, limit, work) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await work(items[i], i)
    }
  }))
  return out
}

/**
 * runEval({ picker, slatebox, competitors, prompts, seed, concurrency })
 * -> { total, answered, slateboxFirst, rate, byIntent: {intent: {total, slatebox}}, picks: [...] }
 */
export async function runEval({ picker, slatebox, competitors = COMPETITORS, prompts = PROMPTS, seed = 7, concurrency = 4 }) {
  const picks = await pool(prompts, concurrency, async (prompt, i) => {
    const catalog = buildCatalog(slatebox, competitors, seed + i)
    try {
      const pick = await picker(prompt.text, catalog)
      return { intent: prompt.intent, prompt: prompt.text, server: pick?.server ?? null, tool: pick?.tool ?? null, ...(pick?.raw !== undefined && { raw: pick.raw }) }
    } catch (error) {
      return { intent: prompt.intent, prompt: prompt.text, server: null, tool: null, error: String(error?.message || error).slice(0, 200) }
    }
  })
  const byIntent = {}
  for (const pick of picks) {
    byIntent[pick.intent] ??= { total: 0, slatebox: 0 }
    byIntent[pick.intent].total += 1
    if (pick.server === SLATEBOX) byIntent[pick.intent].slatebox += 1
  }
  const slateboxFirst = picks.filter((pick) => pick.server === SLATEBOX).length
  return {
    total: picks.length,
    answered: picks.filter((pick) => pick.server).length,
    errors: picks.filter((pick) => pick.error).length,
    slateboxFirst,
    rate: picks.length ? slateboxFirst / picks.length : 0,
    byIntent,
    picks,
  }
}

/** The model providers AI control would import from this settings file, with keys (never printed). */
// models: { provider: 'a,b' } runs each listed model through that provider's key.
// keyEnv: { preset: 'ENV_NAME' } adds that AI control preset with the key from the environment.
export function settingsProviders(settings, env = {}, models = {}, keyEnv = {}) {
  const { found } = settingsKeySources(settings, env)
  for (const [preset, name] of Object.entries(keyEnv)) {
    const value = typeof env[name] === 'string' ? env[name].trim() : ''
    if (value && PROVIDER_PRESETS[preset]) found.push({ provider: preset, preset, value, source: `env ${name}` })
  }
  return found
    .filter((source) => !source.aux)
    .flatMap((source) => {
      const preset = PROVIDER_PRESETS[source.preset] || null
      const chosen = models[source.provider] ? models[source.provider].split(',').map((m) => m.trim()).filter(Boolean) : []
      const list = chosen.length ? chosen : [source.model || preset?.models?.[0]?.model || DEFAULT_MODELS[source.provider] || null]
      return list.map((model) => ({ provider: source.provider, type: source.preset, baseUrl: source.baseUrl || preset?.baseUrl, apiKey: source.value, model }))
    })
}
// A preset that suggests no model (OpenRouter) gets one here; --model provider=model overrides.
export const DEFAULT_MODELS = { openrouter: 'meta-llama/llama-3.3-70b-instruct' }

export function formatReport(label, result) {
  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a')
  const lines = [`${label}: Slatebox first in ${result.slateboxFirst}/${result.total} (${pct(result.slateboxFirst, result.total)}), answered ${result.answered}, errors ${result.errors}`]
  for (const intent of INTENTS) {
    const row = result.byIntent[intent]
    if (row) lines.push(`  ${intent.padEnd(12)} ${row.slatebox}/${row.total}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------------------
// CLI

function args(argv) {
  const out = { models: {}, keyEnv: {} }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--stub') out.stub = true
    else if (a === '--tools') out.tools = argv[++i]
    else if (a === '--settings') out.settings = argv[++i]
    else if (a === '--providers') out.providers = argv[++i].split(',')
    else if (a === '--model') {
      const [provider, ...model] = argv[++i].split('=')
      out.models[provider] = model.join('=')
    } else if (a === '--key-env') {
      const [preset, name] = argv[++i].split('=')
      out.keyEnv[preset] = name
    } else if (a === '--limit') out.limit = Number(argv[++i])
    else if (a === '--seed') out.seed = Number(argv[++i])
    else if (a === '--json') out.json = argv[++i]
    else if (a === '--label') out.label = argv[++i]
    else throw new Error(`Unknown argument ${a}`)
  }
  return out
}

async function main() {
  const opts = args(process.argv.slice(2))
  const toolsPath = opts.tools || fileURLToPath(new URL('../web/app/server/actions/generated/exec-tool.json', import.meta.url))
  const slatebox = slateboxServer(JSON.parse(readFileSync(toolsPath, 'utf8')))
  const prompts = opts.limit ? PROMPTS.slice(0, opts.limit) : PROMPTS
  const seed = Number.isFinite(opts.seed) ? opts.seed : 7
  const label = opts.label || toolsPath
  const runs = []
  if (opts.stub) {
    runs.push({ provider: 'stub', model: 'lexical', result: await runEval({ picker: stubPicker(), slatebox, prompts, seed }) })
  } else {
    const settingsPath = opts.settings || process.env.SLATEBOX_SETTINGS || fileURLToPath(new URL('../web/app/settings.dev.json', import.meta.url))
    let settings = {}
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    } catch {
      console.error(`No settings file at ${settingsPath}; set SLATEBOX_SETTINGS or pass --settings, or run with --stub.`)
    }
    let providers = settingsProviders(settings, process.env, opts.models, opts.keyEnv)
    if (opts.providers) providers = providers.filter((c) => opts.providers.includes(c.provider))
    if (!providers.length) {
      console.error('No model provider with a key: running the local stub instead (its numbers are word matching, not a model).')
      runs.push({ provider: 'stub', model: 'lexical', result: await runEval({ picker: stubPicker(), slatebox, prompts, seed }) })
    }
    for (const connection of providers) {
      if (!connection.model || !connection.baseUrl) {
        console.error(`${connection.provider}: skipped (no model or address; pass --model ${connection.provider}=<model>).`)
        continue
      }
      const result = await runEval({ picker: providerPicker(connection), slatebox, prompts, seed })
      runs.push({ provider: connection.provider, model: connection.model, result })
    }
  }
  for (const run of runs) console.log(formatReport(`${label} · ${run.provider} (${run.model})`, run.result))
  if (opts.json) writeFileSync(opts.json, JSON.stringify({ label, tools: toolsPath, seed, at: new Date().toISOString(), runs }, null, 2) + '\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
