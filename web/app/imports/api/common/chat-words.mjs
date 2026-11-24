// What Ask Slatebox says when something is kept, in sentences a person would say: "Added a retro:
// Went well, Change and Try, up to three cards each." rather than a log line ("Added Retro · Went
// well holds 3. Change holds 3."). Pure, so the words are tested (scripts/first-minute.test.mjs).

const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const numberWord = (n) => NUMBERS[n] ?? String(n)
const plural = (n, word) => `${n === 1 ? word : `${word}s`}`
// A route or drawing with more steps than this is counted, not listed.
const LISTED = 5

/** "A", "A and B", "A, B and C". */
export function listWords(items) {
  const words = items.filter(Boolean)
  if (words.length < 2) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

const stop = (text) => (/[.!?…]$/.test(text) ? text : `${text}.`)

/**
 * A server's "Added a launch plan · Product → Engineering · launch day 14" as a sentence:
 * "Added a launch plan: Product → Engineering, launch day 14." Anything already a sentence stays.
 */
export function asSentence(said) {
  const parts = String(said ?? '').split(' · ').map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return ''
  const [head, ...rest] = parts
  return stop(rest.length ? `${head}: ${rest.join(', ')}` : head)
}

// "Retro" → "a retro", "Pros and cons" → "pros and cons", "Impact × effort" → "an impact × effort".
function named(title) {
  const name = /^[A-Z][a-z]/.test(title) && !/ \/ /.test(title) ? title.toLowerCase() : title
  if (/^pros\b/i.test(name)) return name
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`
}

// A rule line about a lane's limit: "Went well holds 3."
const LIMIT = /^(.+?) holds (\d+)\.$/
const plainRule = (line) => line.replace(/^No rules:\s*/, '').replace(/^./, (c) => c.toUpperCase())

/** What the board's rule lines add to its lanes: "up to three cards each", or the lines as they are, in the board's order. */
function laneWords(labels, rules = [], capacities = []) {
  const limits = new Map(capacities.map(({ label, capacity }) => [label, capacity]))
  // A limit from `capacities` first, then the rules (a lane's limit said once).
  const lines = [...limits].map(([label, cap]) => `${label} holds ${cap}.`)
  rules.forEach((line) => {
    const m = LIMIT.exec(line)
    if (m && labels.includes(m[1]) && limits.has(m[1])) return
    if (m && labels.includes(m[1])) limits.set(m[1], Number(m[2]))
    lines.push(m ? line : plainRule(line))
  })
  const caps = [...limits.values()]
  // Every lane holds the same: said once, with the lanes ("up to three cards each").
  const same = caps.length === labels.length && caps.length > 0 && caps.every((cap) => cap === caps[0])
  if (same) return { inline: `, up to ${numberWord(caps[0])} ${plural(caps[0], 'card')} each`, after: lines.filter((line) => !LIMIT.test(line)) }
  return { inline: '', after: lines }
}

function route(labels) {
  if (labels.length > LISTED) return ` with ${labels.length} steps, from ${labels[0]} to ${labels.at(-1)}`
  return labels.length ? `: ${labels.join(' → ')}` : ''
}

function componentReply(draft, labels, addSay) {
  const what = addSay ? addSay.replace(/^Add\s+/i, '') : named(draft.title ?? 'board')
  if (draft.format !== 'lanes') return stop(`Added ${what}${route(labels)}`)
  const { inline, after } = laneWords(labels, draft.rules, draft.capacities)
  return [stop(`Added ${what}${labels.length ? `: ${listWords(labels)}${inline}` : ''}`), ...after].join(' ')
}

function workshopReply(draft, labels) {
  const limits = (draft.capacities ?? []).map(({ label, capacity }) => `${label} holds up to ${capacity} ${plural(capacity, 'card')}`)
  return [stop(`Added a board${labels.length ? `: ${listWords(labels)}` : ''}`), ...(limits.length ? [stop(listWords(limits))] : [])].join(' ')
}

function drawingReply(draft, labels) {
  const links = draft.links ?? 0
  const drew = labels.length > LISTED ? `${labels.length} notes` : labels.join(' → ')
  return stop(`Drew ${drew}${links ? `, with ${links} ${plural(links, 'connection')}` : ''}`)
}

/**
 * The reply kept in the conversation for a preview that was kept. `addSay` is the library entry's
 * own add message ("Add a retro"), when the catalogue is to hand: it names the board as people say it.
 */
export function keptReply(draft, { addSay = null } = {}) {
  const labels = draft.labels ?? []
  if (draft.component) return componentReply(draft, labels, addSay)
  if (draft.said) return asSentence(draft.said)
  if (draft.format === 'lanes') return workshopReply(draft, labels)
  if (draft.mode === 'play') return stop(`Added a playable route${route(labels)}`)
  return drawingReply(draft, labels)
}

// What a drawing request that brought no change says (canvasConversation.preview): why, and what to
// try, never a bare "try again". reason: no_change (its program changed nothing here), failed (with
// the runner's words), else no_answer.
export function chatUnavailableWords(error) {
  if (error?.reason === 'no_change') return 'Slatebox found nothing to change on this slate for that. Say what to add or change, for example "add three notes about the launch".'
  if (error?.reason === 'failed' && error.message) return `Slatebox couldn't make that change: ${String(error.message).replace(/[.\s]+$/, '')}. Try saying it another way.`
  return 'Slatebox couldn\'t turn that into a change on this slate. If it needs something from outside Slatebox, such as commits, issues or docs, ask an invited agent with @ and its name.'
}
