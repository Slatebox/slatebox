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

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// What an action card is called in a sentence: "Linear issue" for "Create Linear issue", else "Linear change".
function cardName(card, name) {
  const label = typeof card?.label === 'string' ? card.label.trim() : ''
  const system = typeof card?.system === 'string' && card.system.trim() ? card.system.trim() : name
  const at = label.indexOf(system)
  return at > 0 && /^\S+ $/.test(label.slice(0, at)) ? label.slice(at) : `${system} change`
}

/** What an invited agent's turn in Ask Slatebox says about what it did (connectors.call's answer). */
export function agentChatReply(name, result = {}) {
  const said = typeof result.say === 'string' ? result.say.trim() : ''
  const waiting = Array.isArray(result.actions) ? result.actions.length : 0
  const saved = Number(result.saved) || 0
  // Action cards (changes outside Slatebox) still to decide: each is approved or declined on its own card.
  const cards = (Array.isArray(result.cards) ? result.cards : []).filter((card) => ['waiting', 'failed', 'unclear'].includes(card?.state))
  const notes = Math.max(0, (Number(result.added?.notes) || 0) - (waiting || saved ? cards.length : 0))
  const lines = Number(result.added?.lines) || 0
  const what = [notes && plural(notes, 'note', 'notes'), lines && plural(lines, 'line', 'lines')].filter(Boolean).join(' and ')
  const parts = []
  if (said) parts.push(/[.!?]$/.test(said) ? said : said + '.')
  // The same ask while its answer waits: that answer is the answer, said once.
  if (result.repeated) return parts.join(' ') || 'That answer is still on the slate, waiting.'
  const decide = cards.length === 1 ? `Approve or decline the ${cardName(cards[0], name)} card` : `Approve or decline each of the ${cards.length} ${name} cards`
  if (waiting && cards.length) {
    // Keep all never approves a card: its other notes are kept as usual, each card is approved alone.
    if (what) parts.push(`Added ${what} as one suggestion: Keep all suggestions or Discard all on its frame, or point at a note to keep it alone.`)
    parts.push(`${decide} on the slate.`)
  } else if (waiting) parts.push(what
    ? `Added ${what} as one suggestion: Keep all or Discard all on its frame, or point at a note to keep it alone.`
    : `${waiting === 1 ? 'One suggestion is' : `${waiting} suggestions are`} on the slate: Keep all or Discard all on its frame.`)
  if (saved && (what || !cards.length)) parts.push(what ? `Added ${what} to the slate.` : `Added ${saved === 1 ? 'one change' : `${saved} changes`} to the slate.`)
  // Saved directly (no suggestion to keep): its cards are decided on the agent's chip.
  if (saved && !waiting && cards.length) parts.push(`${decide} in Agents under the canvas (${name}).`)
  if (!waiting && !saved && !said) parts.push(`${name} had nothing to suggest for that.`)
  for (const line of Array.isArray(result.left) ? result.left : []) if (typeof line === 'string' && line.trim()) parts.push(line.trim())
  return parts.join(' ')
}

/** What a turn says when an agent's ask failed: plain words and what to do next (never a bare error). → { text, next } */
export function agentErrorReply(name, error = {}) {
  const code = error?.error || error?.code || ''
  const reason = typeof (error?.reason ?? error?.message) === 'string' ? String(error.reason ?? error.message).trim() : ''
  // Inviting and asking agents is free; the agent work is metered: the meter's refusal (it carries
  // its pay action; over DDP the registry nests it: details.details.pay) is said in its own words,
  // with the pay sheet next.
  if (error?.details?.pay || error?.details?.details?.pay) return { text: reason || `Asking ${name} needs more agent credits.`, next: 'pay' }
  switch (code) {
    case 'needs_sign_in': return { text: `${name} needs you to sign in again before it can look anything up.`, next: 'signIn' }
    case 'tools_changed': return { text: `${name}'s tools changed since you invited it. Invite it again from + Invite agent to look at them, then ask again.`, next: null }
    case 'agents_paused': return { text: `Agents are paused on this slate. Resume agents in Agents under the canvas, then ask ${name} again.`, next: 'chip' }
    case 'busy': return { text: `${name} is still working on your last ask. Wait for it to finish, then ask again.`, next: null }
    case 'not_found': return { text: `${name} is not on this slate any more. Invite it again with + Invite agent.`, next: null }
    case 'inviter_only': return { text: reason || `Only the person who invited ${name} can ask it.`, next: null }
    case 'no_tools': return { text: reason || `${name} has nothing it may look up. Invite it again to choose what it may use.`, next: null }
    case 'ai_unavailable': return { text: `Slatebox couldn't plan the lookups for ${name} just now${reason ? `: ${reason.replace(/[.\s]+$/, '')}` : ''}. Try again in a minute.`, next: 'retry' }
    default: {
      const said = reason && !/^(internal server error|undefined|\[object)/i.test(reason) ? reason.replace(/[.\s]+$/, '') : ''
      return { text: said ? `${name} couldn't do that: ${said}. Try asking in other words.` : `${name} couldn't do that. Try asking in other words.`, next: 'retry' }
    }
  }
}

// Words that need an outside agent's data, by gallery card: Slatebox's own AI cannot read them.
// Only words that mean that service's records: "the issues with this plan" or "a branch of the tree"
// are everyday words, and "issues" counts only as someone's issues or a repository's.
const NEEDS = {
  github: /\b(commits?|pull requests?|PRs|repos|repositor(?:y|ies)|github)\b|\b(my|our|open|assigned)\s+(?:open\s+)?issues\b|\bissues\s+(?:assigned|on github|in (?:the |our |my )?repo)/i,
  linear: /\b(linear|(?:current|this|next|last) cycle|my tickets|tickets assigned)\b/i,
  huggingface: /\b(hugging ?face|datasets?|models? on hugging)\b/i,
}
const ASKS_FOR_DATA = /\b(my|our|latest|recent|open|assigned|pending|waiting|what are|what is|what's|which|list|show me|find)\b/i
const DRAWS = /^\s*(draw|sketch|diagram|map out|make a (diagram|flow|chart|mind ?map)|add a (diagram|flow))/i

/**
 * An invited agent the message plainly needs (Slatebox cannot read GitHub), when it names none:
 * "what are my latest commits?" with GitHub on the slate → that agent. Null when nothing fits.
 * agents: askable entries with galleryId (or a name that says which).
 */
export function agentHint(message, agents = []) {
  const text = String(message || '')
  if (!text.trim() || /(^|[\s(])@\w/.test(text) || DRAWS.test(text) || !ASKS_FOR_DATA.test(text)) return null
  for (const agent of Array.isArray(agents) ? agents : []) {
    if (!agent?.canAsk) continue
    const id = agent.galleryId || Object.keys(NEEDS).find((key) => fold(agent.name || '').includes(key)) || null
    if (id && NEEDS[id]?.test(text)) return agent
  }
  return null
}

// An agent's name and colour as a saved Ask Slatebox turn keeps them (this device's history).
export function agentOfTurn(agent) {
  if (!agent || typeof agent.name !== 'string' || !agent.name.trim()) return null
  const color = typeof agent.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(agent.color) ? agent.color : '#6d28d9'
  return { name: agent.name.trim().slice(0, 40), color }
}

/**
 * Who a message in Ask Slatebox goes to (owner, 2026-11-24: after "@GitHub", the conversation stays
 * with GitHub until the person clears it or names someone else):
 *   to         'slatebox' or an agentId the page already chose (a button: "Ask @GitHub", "Try again")
 *   replyingTo the agentId the conversation is with, or null
 * → { kind: 'agent', agent, request, replyingTo } | { kind: 'hint', agent, replyingTo } | { kind: 'slatebox', replyingTo }
 *   (replyingTo: who the conversation is with after this message)
 */
export function routeMessage(message, { agents = [], replyingTo = null, to = null } = {}) {
  const text = String(message || '')
  const toSlatebox = to === 'slatebox' || /(^|[\s(])@slatebox\b/i.test(text)
  const askable = (agent) => agent?.canAsk === true
  if (to && to !== 'slatebox') {
    const agent = agents.find((a) => a.agentId === to)
    if (agent) return { kind: 'agent', agent, request: mentionedAgent(text, [agent])?.request ?? text.trim(), replyingTo: askable(agent) ? agent.agentId : replyingTo }
  }
  if (toSlatebox) return { kind: 'slatebox', replyingTo: null }
  const mention = mentionedAgent(text, agents)
  if (mention) return { kind: 'agent', agent: mention.agent, request: mention.request, replyingTo: askable(mention.agent) ? mention.agent.agentId : replyingTo }
  const current = replyingTo ? agents.find((a) => a.agentId === replyingTo && askable(a)) : null
  if (current) return { kind: 'agent', agent: current, request: text.trim().slice(0, 1000), replyingTo: current.agentId }
  const hinted = agentHint(text, agents)
  if (hinted) return { kind: 'hint', agent: hinted, replyingTo: null }
  return { kind: 'slatebox', replyingTo: null }
}
