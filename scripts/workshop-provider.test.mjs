import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { localWorkshopRequest } from '../web/app/server/methods/ai/workshop-provider.mjs'
import { normalizeProviderResponse } from '../web/app/server/methods/ai/provider.mjs'

// A resolved OpenAI-compatible connection (connections.mjs), as req.js hands it over.
const connection = (overrides = {}) => ({ endpoint: 'http://ollama:11434/v1/chat/completions', model: 'local-model', toolChoice: 'auto', ...overrides })
const workshopTool = { name: 'draft_workshop', description: 'Design a workshop', parameters: { type: 'object' } }
const request = { system: 'Design a workshop.', prompts: [{ role: 'user', content: 'Choose a sound.' }],
  functions: [workshopTool], functionCall: { name: workshopTool.name } }

test('uses standard tool schema and optional authorization only on the selected endpoint', () => {
  const config = connection()
  const req = localWorkshopRequest(config, request)
  assert.equal(req.headers.Authorization, undefined)
  const body = JSON.parse(req.body)
  assert.deepEqual(body, { model: 'local-model', messages: [{ role: 'system', content: request.system }, ...request.prompts],
    tools: [{ type: 'function', function: workshopTool }], tool_choice: 'auto', stream: false })
  const secured = connection({ apiKey: 'fixture-only', toolChoice: 'named' })
  const named = localWorkshopRequest(secured, request)
  assert.equal(named.headers.Authorization, 'Bearer fixture-only')
  assert.deepEqual(JSON.parse(named.body).tool_choice, { type: 'function', function: { name: workshopTool.name } })
})

test('posted tool arguments and token usage survive a local proxy; redirects cannot forward the brief', async t => {
  const seen = []
  const args = { title: 'Soundcheck' }
  const server = createServer(async (req, res) => {
    seen.push(req.url)
    if (req.url.startsWith('/redirect/')) {
      res.writeHead(307, { location: '/unconfigured' }).end()
      return
    }
    let raw = ''
    for await (const part of req) raw += part
    const { tools } = JSON.parse(raw)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Here is the draft.', tool_calls: [
      { type: 'function', function: { name: tools[0].function.name, arguments: JSON.stringify(args) } }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 3 } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const endpoint = 'http://127.0.0.1:' + server.address().port
  const config = connection({ endpoint: endpoint + '/v1/chat/completions' })
  const response = await fetch(config.endpoint, localWorkshopRequest(config, request))
  const { toolCall, usage } = normalizeProviderResponse({ provider: 'selfhost-workshop', response: await response.json() })
  assert.deepEqual(toolCall.arguments, args)
  assert.equal(toolCall.name, 'draft_workshop')
  assert.equal(usage.totalTokens, 13)
  const redirect = connection({ endpoint: endpoint + '/redirect/v1/chat/completions' })
  await assert.rejects(fetch(redirect.endpoint, localWorkshopRequest(redirect, request)))
  assert.deepEqual(seen, ['/v1/chat/completions', '/redirect/v1/chat/completions'])
})
