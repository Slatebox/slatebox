// "@Slatebox …" in a comment or chat line asks the Slatebox agent. The request is the line
// without the mention; null when the line does not mention it or asks nothing.
const MENTION = /(^|[\s(])@slatebox\b[:,]?/i

export function slateboxRequest(text) {
  if (typeof text !== 'string' || !MENTION.test(text)) return null
  const request = text.replace(MENTION, '$1').replace(/\s+/g, ' ').trim().slice(0, 500)
  return request.length >= 2 ? request : null
}

// "@GitHub …" (or "@github", "@Test Diagrams", "@testdiagrams") in Ask Slatebox asks the agent of
// that name invited onto this slate. Names are matched without case, with or without their spaces;
// the longest name that fits wins ("@Linear Docs" over "@Linear"). @Slatebox is never an agent here.
const fold = (text) => String(text).toLowerCase().replace(/\s+/g, '')
const NAME_END = /^($|[\s:,.!?;)])/

// The first @ in the text that names one of these agents (the longest name there wins).
function firstMatch(text, agents) {
  let best = null
  for (const match of text.matchAll(/(^|[\s(])@/g)) {
    const at = match.index + match[0].length
    const rest = text.slice(at)
    for (const agent of agents) {
      for (const form of new Set([agent.name.trim(), agent.name.replace(/\s+/g, '')])) {
        if (rest.slice(0, form.length).toLowerCase() !== form.toLowerCase() || !NAME_END.test(rest.slice(form.length))) continue
        if (!best || form.length > best.length) best = { agent, start: at - 1, length: form.length }
      }
    }
    if (best) break
  }
  return best
}

/**
 * The agent a message mentions and the request without the mention, or null. The agents this
 * person may ask (canAsk: the ones they invited) are matched first, so someone else's agent with
 * the same or a longer name never takes a message meant for theirs; the others are matched after,
 * only so the answer can say who may ask them.
 * @param {string} text
 * @param {{ name: string, canAsk?: boolean }[]} agents
 * @returns {{ agent: object, request: string } | null}
 */
export function mentionedAgent(text, agents) {
  if (typeof text !== 'string' || !Array.isArray(agents) || !agents.length) return null
  const named = agents.filter((agent) => typeof agent?.name === 'string' && agent.name.trim() && fold(agent.name) !== 'slatebox')
  const best = firstMatch(text, named.filter((agent) => agent.canAsk === true)) || firstMatch(text, named)
  if (!best) return null
  const request = (text.slice(0, best.start) + ' ' + text.slice(best.start + 1 + best.length).replace(/^[:,]/, ''))
    .replace(/\s+/g, ' ').trim().slice(0, 1000)
  return { agent: best.agent, request }
}

/** Whether two agent names are the same for @name (case and spaces ignored). */
export const sameAgentName = (a, b) => fold(a) === fold(b)

/** What an invited agent's turn in Ask Slatebox says about what it did (connectors.call's answer). */
export function agentChatReply(name, result = {}) {
  const said = typeof result.say === 'string' ? result.say.trim() : ''
  const waiting = Array.isArray(result.actions) ? result.actions.length : 0
  const saved = Number(result.saved) || 0
  const parts = []
  if (said) parts.push(/[.!?]$/.test(said) ? said : said + '.')
  if (waiting) parts.push(`${waiting === 1 ? 'One suggestion is' : `${waiting} suggestions are`} on the slate: keep or discard ${waiting === 1 ? 'it' : 'each'} where it sits.`)
  if (saved) parts.push(`Added ${saved === 1 ? 'one change' : `${saved} changes`} to the slate.`)
  if (!waiting && !saved && !said) parts.push(`${name} had nothing to suggest for that.`)
  for (const line of Array.isArray(result.left) ? result.left : []) if (typeof line === 'string' && line.trim()) parts.push(line.trim())
  return parts.join(' ')
}

// An agent's name and colour as a saved Ask Slatebox turn keeps them (this device's history).
export function agentOfTurn(agent) {
  if (!agent || typeof agent.name !== 'string' || !agent.name.trim()) return null
  const color = typeof agent.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(agent.color) ? agent.color : '#6d28d9'
  return { name: agent.name.trim().slice(0, 40), color }
}
