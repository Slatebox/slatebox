// Replay the EXACT stored prompts from the failing test run against live deepinfra.
// Usage: node scripts/replay-real-payload.mjs <prompts.json> [key]
// Key: prefer API_KEY_DEEP_INFRA env var (keeps the key out of shell history).
import { readFileSync } from 'node:fs'
import { buildProviderBody } from '../server/methods/ai/provider.mjs'

const [file, keyArg] = process.argv.slice(2)
if (!file) {
  console.error(
    'usage: node scripts/replay-real-payload.mjs <prompts.json> [key] (key from API_KEY_DEEP_INFRA if omitted)',
  )
  process.exit(1)
}
const key = keyArg || process.env.API_KEY_DEEP_INFRA
if (!key) {
  console.error('no provider key: pass as arg or set API_KEY_DEEP_INFRA')
  process.exit(1)
}
const prompts = JSON.parse(readFileSync(file, 'utf8'))

const variants = {
  'as-stored': {},
  'drop-empty': { dropEmpty: true },
}

for (const [name, opt] of Object.entries(variants)) {
  let p = prompts
  if (opt.dropEmpty) {
    p = prompts.filter((x) => x.content && String(x.content).trim() !== '')
  }
  const body = buildProviderBody({
    provider: 'deepinfra',
    model: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
    prompts: p,
    userId: 'replay',
  })
  console.log(`\n=== ${name}: ${body.messages.length} msgs, sizes: ${body.messages.map((m) => m.content.length).join(',')}`)
  for (const res of [1]) {
    const r = await fetch('https://api.deepinfra.com/v1/openai/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, max_tokens: 8, max_completion_tokens: 8 }),
    })
    const t = await r.text()
    console.log(`  call${res} => ${r.status} ${t.slice(0, 130)}`)
  }
}
