// The pick-rate eval (scripts/agent-pick-eval.mjs): its catalog and prompts cover the intents,
// the stub and a fake provider run without the network, the answer parser tolerates prose, and
// no key reaches a report.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  COMPETITORS, INTENTS, PROMPTS, SLATEBOX, buildCatalog, formatReport, parsePick, providerPicker, renderCatalog, runEval,
  scrub, settingsProviders, slateboxServer, stubPicker, SYSTEM_PROMPT,
} from './agent-pick-eval.mjs'

const execTool = JSON.parse(readFileSync(new URL('../web/app/server/actions/generated/exec-tool.json', import.meta.url), 'utf8'))
const slatebox = slateboxServer(execTool)

test('the catalog: about 25 other servers, Slatebox with every listed tool, and about 40 prompts over every intent', () => {
  assert.ok(COMPETITORS.length >= 25, String(COMPETITORS.length))
  assert.ok(!COMPETITORS.some((s) => s.server === SLATEBOX))
  assert.equal(new Set(COMPETITORS.map((s) => s.server)).size, COMPETITORS.length)
  assert.equal(slatebox.tools.length, 2 + execTool.typed.length)
  assert.match(slatebox.description, /visual intelligence/)
  assert.ok(PROMPTS.length >= 38 && PROMPTS.length <= 45, String(PROMPTS.length))
  for (const intent of INTENTS) assert.ok(PROMPTS.filter((p) => p.intent === intent).length >= 3, intent)
  assert.ok(PROMPTS.every((p) => INTENTS.includes(p.intent)))
  // prompts never name a product: the eval asks what a person asks
  for (const p of PROMPTS) assert.doesNotMatch(p.text, /slatebox|miro|figjam|lucid|excalidraw|draw\.io/i, p.text)
})

test('the order is seeded: the same seed gives the same catalog, and Slatebox is not always first', () => {
  const a = buildCatalog(slatebox, COMPETITORS, 3).map((s) => s.server)
  assert.deepEqual(buildCatalog(slatebox, COMPETITORS, 3).map((s) => s.server), a)
  assert.equal(a.length, COMPETITORS.length + 1)
  const firsts = new Set(Array.from({ length: 20 }, (_, i) => buildCatalog(slatebox, COMPETITORS, i)[0].server))
  assert.ok(firsts.size > 3)
  const text = SYSTEM_PROMPT(buildCatalog(slatebox, COMPETITORS, 3))
  assert.match(text, /## server: slatebox/)
  assert.match(text, /- import_mermaid: /)
  assert.match(text, /Answer with JSON only/)
  assert.ok(renderCatalog([slatebox]).startsWith('## server: slatebox'))
})

test('parsePick reads the JSON out of prose and fences, and refuses what is not a pick', () => {
  assert.deepEqual(parsePick('{"server": "slatebox", "tool": "create_slate"}'), { server: 'slatebox', tool: 'create_slate' })
  assert.deepEqual(parsePick('Sure!\n```json\n{"server":"Drawio","tool":"create_diagram"}\n```'), { server: 'drawio', tool: 'create_diagram' })
  assert.equal(parsePick('I would use draw.io'), null)
  assert.equal(parsePick('{"tool": "x"}'), null)
  assert.equal(parsePick(null), null)
})

test('the stub picks by words and runs every prompt without the network', async () => {
  const pick = await stubPicker()('Draw a mind map from this Mermaid mindmap', [slatebox, ...COMPETITORS])
  assert.equal(pick.server, SLATEBOX)
  const result = await runEval({ picker: stubPicker(), slatebox, seed: 7 })
  assert.equal(result.total, PROMPTS.length)
  assert.equal(result.errors, 0)
  assert.equal(result.slateboxFirst, result.picks.filter((p) => p.server === SLATEBOX).length)
  assert.equal(Object.values(result.byIntent).reduce((n, row) => n + row.total, 0), PROMPTS.length)
  // repeatable
  assert.deepEqual((await runEval({ picker: stubPicker(), slatebox, seed: 7 })).picks, result.picks)
  assert.match(formatReport('after', result), /^after: Slatebox first in \d+\/40/)
})

test('a failing picker is counted as an error, never as a pick', async () => {
  let n = 0
  const picker = async () => {
    n += 1
    if (n % 2) throw new Error('boom')
    return { server: SLATEBOX, tool: 'get_slate' }
  }
  const result = await runEval({ picker, slatebox, prompts: PROMPTS.slice(0, 6), concurrency: 1 })
  assert.equal(result.errors, 3)
  assert.equal(result.slateboxFirst, 3)
  assert.equal(result.answered, 3)
})

const KEY = 'sk-test-0123456789abcdefSECRET'

test('a provider request: OpenAI-compatible and Anthropic shapes, the catalog as the system message, the key only in its header', async () => {
  const sent = []
  const fake = (reply) => async (url, init) => {
    sent.push({ url, init })
    return { ok: true, status: 200, json: async () => reply }
  }
  const chat = providerPicker({ type: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: KEY, model: 'm' },
    { fetchImpl: fake({ choices: [{ message: { content: '{"server":"slatebox","tool":"import_mermaid"}' } }] }) })
  assert.deepEqual(await chat('mind map please', [slatebox]), { server: 'slatebox', tool: 'import_mermaid' })
  assert.equal(sent[0].url, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(sent[0].init.headers.Authorization, `Bearer ${KEY}`)
  const body = JSON.parse(sent[0].init.body)
  assert.equal(body.messages[0].role, 'system')
  assert.match(body.messages[0].content, /## server: slatebox/)
  assert.equal(body.messages[1].content, 'mind map please')
  assert.ok(!sent[0].init.body.includes(KEY))
  assert.equal(chat.sent, 1)

  const claude = providerPicker({ type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: KEY, model: 'c' },
    { fetchImpl: fake({ content: [{ type: 'text', text: 'Here: {"server": "excalidraw", "tool": "create_scene"}' }] }) })
  assert.deepEqual(await claude('sketch', [slatebox]), { server: 'excalidraw', tool: 'create_scene' })
  assert.equal(sent[1].url, 'https://api.anthropic.com/v1/messages')
  assert.equal(sent[1].init.headers['x-api-key'], KEY)
  assert.match(JSON.parse(sent[1].init.body).system, /## server: slatebox/)

  const silent = providerPicker({ type: 'openrouter', baseUrl: 'https://x.test/v1', apiKey: KEY, model: 'm' },
    { fetchImpl: fake({ choices: [{ message: { content: 'no idea' } }] }) })
  assert.deepEqual(await silent('x', [slatebox]), { server: null, tool: null, raw: 'no idea' })
})

test('a refused request names the status, never the key or a masked echo of it', async () => {
  const refuse = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: `Incorrect API key provided: sk-emo***********DTFr (${KEY})` } }) })
  const picker = providerPicker({ type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: KEY, model: 'm' }, { fetchImpl: refuse })
  const result = await runEval({ picker, slatebox, prompts: PROMPTS.slice(0, 2) })
  assert.equal(result.errors, 2)
  const text = JSON.stringify(result)
  assert.match(text, /HTTP 401/)
  assert.ok(!text.includes(KEY))
  assert.ok(!text.includes('sk-emo'))
  assert.equal(scrub('key sk-abc123xyz and rk_live_ABCDEF', null), 'key [key] and [key]')
})

test('providers come from AI control\'s key import: model services only, a preset\'s suggested model, --model per provider', () => {
  const settings = { openai: { apiKey: 'a-key' }, openrouter: { apiKey: 'o-key' }, stabilityai: { apiKey: 's-key' } }
  const plain = settingsProviders(settings, {})
  assert.deepEqual(plain.map((c) => [c.provider, c.model, c.baseUrl]), [
    ['openai', 'gpt-4o-mini', 'https://api.openai.com/v1'],
    ['openrouter', 'meta-llama/llama-3.3-70b-instruct', 'https://openrouter.ai/api/v1'],
  ])
  const many = settingsProviders(settings, {}, { openrouter: 'meta/muse-ember, google/gemini-3.8-flash' })
  assert.deepEqual(many.filter((c) => c.provider === 'openrouter').map((c) => c.model), ['meta/muse-ember', 'google/gemini-3.8-flash'])
  assert.deepEqual(settingsProviders({}, {}), [])
  // a preset whose key sits in a named environment variable (--key-env meta=NAME)
  const meta = settingsProviders({}, { MUSE: ' m-key ' }, { meta: 'muse-spark-1.3' }, { meta: 'MUSE', nope: 'MUSE' })
  assert.deepEqual(meta.map((c) => [c.provider, c.model, c.baseUrl, c.apiKey]), [['meta', 'muse-spark-1.3', 'https://api.meta.ai/v1', 'm-key']])
  assert.deepEqual(settingsProviders({}, {}, {}, { meta: 'UNSET' }), [])
})
