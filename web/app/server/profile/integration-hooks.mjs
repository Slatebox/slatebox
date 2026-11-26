// Where personalization meets the tools a person connected (Integrations). That code is enterprise/
// (Slatebox as an MCP client), loaded only where it runs; the profile and the interview (MIT) never
// import it. Enterprise fills this at start (enterprise/server/meteor.js through
// setProfileIntegrations); where it does not run, nothing is connected and the interview asks
// without it.
//
// Names only, on purpose (2026-11-26): a tool's own "use for personalization" switch
// (personalSettings.sources['integration:<ref>'], off until switched on) governs what is READ from
// that tool. The interview reads nothing from a tool; it only names the ones connected, so it can ask
// "what do you track there?". About you says so beside the talk. The person can turn the talk off
// ("Learn from talks with the agent") or disconnect the tool.
//
//   connected(userId) → [{ name, cardId, kind }]
//       the person's own integrations, by name, the gallery card they came from (null for a custom
//       server) and their kind ('mcp', 'native'): never an address, a token, a tool list or anything a
//       tool holds.
//
// Reading a tool (S3, 2026-11-26: About you › "Use <tool> to personalize"), only once the person
// switched that tool on (server/profile/sources-core.mjs checks before asking):
//   sources(userId) → [{ ref, name, kind }]
//       the integrations Slatebox can read to personalize (their gallery card has a look-around),
//       by their card's id (ref) and name.
//   lookAround(userId, ref) → { ref, name, sample: [{ tool, text }] }
//       a few read-only lookups in that integration, each answer quarantined (plain text, capped) by
//       the integrations code. What an outside service said: the caller wraps it as data.

const hooks = { connected: null, sources: null, lookAround: null }

export function setProfileIntegrations(next = {}) {
  for (const key of Object.keys(hooks)) hooks[key] = typeof next[key] === 'function' ? next[key] : null
}

/** The hooks as the core reads them: null when enterprise code is not running here. */
export const profileIntegrations = () => (hooks.connected ? hooks : null)

/**
 * The tools a person connected, by name, card and kind only: [] where enterprise is not running, and
 * [] (logged) when the read fails, so a talk never stops for it. At most `max`.
 */
export async function connectedTools(userId, { max = 20 } = {}) {
  const at = profileIntegrations()
  if (!at || !userId) return []
  try {
    const list = await at.connected(userId)
    return (Array.isArray(list) ? list : []).slice(0, max).map((tool) => ({
      name: typeof tool?.name === 'string' ? tool.name : '',
      cardId: typeof tool?.cardId === 'string' ? tool.cardId : null,
      kind: typeof tool?.kind === 'string' ? tool.kind : null,
    }))
  } catch (error) {
    console.warn('[profile] connected tools could not be read:', error?.message)
    return []
  }
}

/** The tools a person can use to personalize: [] where enterprise is not running or the read fails. */
export async function lookableTools(userId) {
  if (!hooks.sources || !userId) return []
  try {
    const list = await hooks.sources(userId)
    return (Array.isArray(list) ? list : []).slice(0, 40).map((tool) => ({
      ref: typeof tool?.ref === 'string' ? tool.ref : '',
      name: typeof tool?.name === 'string' ? tool.name : '',
      kind: typeof tool?.kind === 'string' ? tool.kind : null,
    })).filter((tool) => tool.ref)
  } catch (error) {
    console.warn('[profile] tools to personalize from could not be read:', error?.message)
    return []
  }
}

/** A look around one tool, as the integrations code answers it (its refusals reach the caller). */
export async function lookAroundTool(userId, ref) {
  if (!hooks.lookAround || !userId) throw Object.assign(new Error('That tool is not connected.'), { code: 'not_found' })
  const look = await hooks.lookAround(userId, ref)
  return {
    name: typeof look?.name === 'string' ? look.name : '',
    sample: (Array.isArray(look?.sample) ? look.sample : []).slice(0, 3).map((entry) => ({
      tool: typeof entry?.tool === 'string' ? entry.tool.slice(0, 64) : '',
      text: typeof entry?.text === 'string' ? entry.text.slice(0, 1200) : '',
    })),
  }
}
