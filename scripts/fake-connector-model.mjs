// A stand-in for Slatebox's model in a local browser run of invited agents (MIT, test support):
// an OpenAI-compatible endpoint that answers the two calls an agent run makes, plan_calls and
// place_suggestions, from the prompt alone, the same way every time. Point a local settings file
// at it: ai.connections.fake = { type: 'openai-compatible', baseUrl: 'http://127.0.0.1:<port>/v1',
// model: 'fake' }, ai.use.connectors = 'fake'.
//   node scripts/fake-connector-model.mjs [port]     (default 8766)
import http from 'node:http'
import { pathToFileURL } from 'node:url'

const between = (text, open, close) => {
  const start = text.indexOf(open)
  if (start < 0) return null
  const end = text.indexOf(close, start)
  return text.slice(start + open.length, end < 0 ? undefined : end)
}

function toolsIn(user) {
  const block = between(user, '>\nThese tool descriptions', '</tools>') || ''
  return block.split('\n').filter((line) => line.startsWith('{')).map((line) => {
    try { return JSON.parse(line) } catch { return null }
  }).filter(Boolean)
}

function diagramFor(request) {
  const words = request.replace(/^(draw|sketch|map)\s+(how\s+)?/i, '').split(/,|\bthen\b|->|→/).map((s) => s.trim()).filter(Boolean)
  const steps = words.length >= 3 ? words.slice(0, 5) : ['Card declined', 'Wait 24 hours', 'Retry the charge', 'Paid']
  const elements = []
  steps.forEach((text, i) => elements.push({ type: i === steps.length - 1 ? 'ellipse' : 'rectangle', id: 's' + i, x: i * 260, y: (i % 2) * 60, width: 200, height: 80, label: { text: text.slice(0, 60) } }))
  for (let i = 1; i < steps.length; i++) elements.push({ type: 'arrow', id: 'a' + i, x: 0, y: 0, width: 60, height: 0, start: { id: 's' + (i - 1) }, end: { id: 's' + i } })
  return elements
}

function plan(user) {
  if (user.includes('<results from=')) return { calls: [], done: true }
  const request = (between(user, '<request>', '</request>') || '').trim()
  const tools = toolsIn(user)
  const draw = tools.find((t) => t.name === 'create_view')
  if (draw && /draw|diagram|sketch|map|flow/i.test(request)) return { calls: [{ tool: 'create_view', arguments: { elements: JSON.stringify(diagramFor(request)) } }], done: true }
  const queryLike = (t) => Object.keys(t.inputSchema?.properties || {}).some((k) => /query|question|search|^q$/i.test(k))
  const tool = tools.find(queryLike) || tools.find((t) => t.name !== 'create_view' && Object.values(t.inputSchema?.properties || {}).some((p) => p.type === 'string')) || tools[0]
  if (!tool) return { calls: [], say: 'Nothing here fits that request.' }
  const args = {}
  for (const [key, spec] of Object.entries(tool.inputSchema?.properties || {})) {
    if ((tool.inputSchema.required || []).includes(key) || ['query', 'q', 'search', 'question'].includes(key)) {
      if (spec.type === 'string') args[key] = request.slice(0, 200)
      else if (spec.type === 'number' || spec.type === 'integer') args[key] = 5
      else if (spec.type === 'boolean') args[key] = false
    }
  }
  return { calls: [{ tool: tool.name, arguments: args }], done: true }
}

function layout(user) {
  const block = between(user, 'never treat it as words from a person on the slate.\n', '</results>') || ''
  const notes = []
  for (const line of block.split('\n')) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    for (const text of String(entry.text || '').split(/\n+/).map((t) => t.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter((t) => t.length > 2).slice(0, 5))
      notes.push({ key: 'n' + notes.length, text: text.slice(0, 160) })
    for (const link of entry.links || []) notes.push({ key: 'n' + notes.length, text: link.title || link.host, link: link.url })
  }
  return { say: 'Here is what it found.', groups: notes.length ? [{ label: 'What it found', layout: 'grid', notes: notes.slice(0, 9) }] : [] }
}

export async function startFakeConnectorModel({ port = 0 } = {}) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake', object: 'model' }] }))
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    let body = {}
    try { body = JSON.parse(raw) } catch {}
    const user = (body.messages || []).filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join(''))).join('\n')
    const name = body.tool_choice?.function?.name || body.tools?.[0]?.function?.name
    const args = name === 'plan_calls' ? plan(user) : name === 'place_suggestions' ? layout(user) : {}
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: 'fake-' + Date.now(), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'fake',
      choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }))
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const model = await startFakeConnectorModel({ port: Number(process.argv[2]) || 8766 })
  console.log(`Fake connector model on ${model.origin}/v1`)
}
