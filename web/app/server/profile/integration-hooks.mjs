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

const hooks = { connected: null }

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
