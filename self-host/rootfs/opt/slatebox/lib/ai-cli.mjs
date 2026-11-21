// docker exec slatebox slatebox ai          the server's AI connections and choices, without keys
// docker exec slatebox slatebox ai check    tests each server connection: reachable, key accepted,
//                                           model listed, answers, calls tools
// People's own connections are tested in the app (Profile, AI) or with the ai-check API command.
import { Plain, fail } from './common.mjs'
import { checkConnections } from './ai-config.mjs'

function serverAI() {
  let settings
  try { settings = JSON.parse(process.env.METEOR_SETTINGS || '{}') } catch { throw new Plain('The app settings could not be read. Is Slatebox still starting?') }
  return settings.ai || {}
}

async function main() {
  const [command] = process.argv.slice(2)
  const ai = serverAI()
  if (!command) {
    const lines = Object.entries(ai.connections || {}).map(([name, c]) =>
      `${name}: ${c.type}${c.baseUrl ? ` at ${c.baseUrl}` : ''}${c.model ? `, model ${c.model}` : ''}${c.apiKey ? ', key set' : ''}`)
    for (const [feature, name] of Object.entries(ai.use || {})) lines.push(`${feature} uses ${name}`)
    lines.push(`People may connect their own AI: ${ai.ownProviders === 'off' ? 'no' : 'yes'}`)
    process.stdout.write(`${lines.join('\n')}\n`)
    return
  }
  if (command !== 'check') throw new Plain('Usage: slatebox ai [check]')
  const lines = await checkConnections(ai)
  process.stdout.write(`${lines.join('\n')}\n`)
  if (lines.some((line) => !/: connected/.test(line))) process.exitCode = 1
}

main().catch(fail)
