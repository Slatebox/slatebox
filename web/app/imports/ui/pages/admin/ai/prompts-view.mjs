// The Prompts tab's pure helpers: the side-by-side diff (lines, then words inside a changed line),
// what to flag in text an agent suggested (spec 6.4: added instructions, links, tool names, AI
// control or token words), the values a text uses that its part of Slatebox does not give, and the
// words for where a prompt's text comes from. No React, no Meteor: tested under node.

export const KIND_LABELS = Object.freeze({
  system: 'Instructions',
  user: 'Request',
  retry: 'Retry',
  envelope: 'Wrapper',
  'tool-description': 'Tool description',
  'mcp-instructions': 'MCP instructions',
  'mcp-prompt': 'MCP prompt',
})

/** Where the served text comes from, in words. live: { version, source } */
export function sourceText(live) {
  if (live?.fallbackFrom) return `Built in (version ${live.fallbackFrom} does not render)`
  if (!live || !live.version) return 'Built in'
  return `Version ${live.version}`
}

// Longest common subsequence over two token lists → [{ kind: same|removed|added, a?, b? }].
function lcs(a, b) {
  const n = a.length
  const m = b.length
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  }
  const out = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'same', a: a[i], b: b[j] }); i += 1; j += 1 } else if (table[i + 1][j] >= table[i][j + 1]) { out.push({ kind: 'removed', a: a[i] }); i += 1 } else { out.push({ kind: 'added', b: b[j] }); j += 1 }
  }
  while (i < n) out.push({ kind: 'removed', a: a[i++] })
  while (j < m) out.push({ kind: 'added', b: b[j++] })
  return out
}

const MAX_WORDS = 4000
const words = (text) => String(text).split(/(\s+)/).filter((part) => part !== '')

/** Word segments of one line against another: { left: [{ text, kind }], right: [{ text, kind }] } */
export function wordDiff(before, after) {
  const a = words(before)
  const b = words(after)
  if (a.length > MAX_WORDS || b.length > MAX_WORDS) {
    return { left: [{ text: String(before), kind: 'removed' }], right: [{ text: String(after), kind: 'added' }] }
  }
  const left = []
  const right = []
  const push = (list, text, kind) => {
    const last = list[list.length - 1]
    if (last && last.kind === kind) last.text += text
    else list.push({ text, kind })
  }
  for (const step of lcs(a, b)) {
    if (step.kind === 'same') { push(left, step.a, 'same'); push(right, step.b, 'same') } else if (step.kind === 'removed') push(left, step.a, 'removed')
    else push(right, step.b, 'added')
  }
  return { left, right }
}

/**
 * Side-by-side rows of two texts: lines matched by LCS; a removed line next to an added one is one
 * changed row with its words compared. → [{ kind: same|changed|removed|added, left, right, leftNo, rightNo }]
 * left / right: [{ text, kind }] segments (null on the side a line is missing from).
 */
export function sideBySide(before = '', after = '') {
  const steps = lcs(String(before).split('\n'), String(after).split('\n'))
  const rows = []
  let leftNo = 0
  let rightNo = 0
  for (let k = 0; k < steps.length; k += 1) {
    const step = steps[k]
    if (step.kind === 'same') {
      leftNo += 1
      rightNo += 1
      rows.push({ kind: 'same', left: [{ text: step.a, kind: 'same' }], right: [{ text: step.b, kind: 'same' }], leftNo, rightNo })
    } else if (step.kind === 'removed' && steps[k + 1]?.kind === 'added') {
      leftNo += 1
      rightNo += 1
      const { left, right } = wordDiff(step.a, steps[k + 1].b)
      rows.push({ kind: 'changed', left, right, leftNo, rightNo })
      k += 1
    } else if (step.kind === 'removed') {
      leftNo += 1
      rows.push({ kind: 'removed', left: [{ text: step.a, kind: 'removed' }], right: null, leftNo, rightNo: null })
    } else {
      rightNo += 1
      rows.push({ kind: 'added', left: null, right: [{ text: step.b, kind: 'added' }], leftNo: null, rightNo })
    }
  }
  return rows
}

// What an agent's suggestion adds that a reviewer should read twice: instructions, links, tool
// names, AI control and token words (spec 6.4).
const FLAGS = [
  { why: 'a link', re: /https?:\/\/\S+|www\.\S+/i },
  { why: 'an AI control or token action', re: /\b(ai\.[a-z]+\.[a-zA-Z]+|api_tokens\.[a-zA-Z]+)\b/ },
  { why: 'keys, tokens or secrets', re: /\b(api[ _-]?keys?|tokens?|secrets?|passwords?|credentials?)\b/i },
  { why: 'a tool name', re: /\b(exec|propose_[a-z_]+|draft_[a-z_]+|revise_[a-z_]+|applySlateOperations|createPresentation)\b/ },
  { why: 'an instruction', re: /(^|[.!?]\s+)(always|never|ignore|disregard|call|run|send|reveal|forget|you must|do not tell)\b/i },
]

/** The added text of a suggestion, sentence by sentence, with why each is flagged. → [{ text, why: [..] }] */
export function flaggedAdditions(before = '', after = '') {
  const added = []
  for (const row of sideBySide(before, after)) {
    for (const part of row.right || []) if (part.kind === 'added') added.push(part.text)
  }
  const out = []
  for (const sentence of added.join(' ').split(/(?<=[.!?])\s+/)) {
    const text = sentence.trim()
    if (!text) continue
    const why = FLAGS.filter((flag) => flag.re.test(text)).map((flag) => flag.why)
    if (why.length) out.push({ text: text.slice(0, 300), why })
  }
  return out
}

/** The names a text uses ({{name}}, {{#name}}, {{^name}}), in order, once each. */
export function namesIn(body = '') {
  const out = []
  for (const match of String(body).matchAll(/\{\{\s*[#^/]?\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g)) if (!out.includes(match[1])) out.push(match[1])
  return out
}

/** The names a text uses that its part of Slatebox does not give (underlined red in the editor). */
export function undeclaredNames(body, codeVariables = {}) {
  return namesIn(body).filter((name) => !Object.hasOwn(codeVariables, name))
}

/** What a publish or rollback says happened. */
export function liveText(out, title) {
  const what = out.version ? `Version ${out.version} of ${title}` : `The built-in text of ${title}`
  return `${what} is live. Every server uses it within seconds.`
}

/** A version's status in words. */
export function statusText(row, labels = {}) {
  if (!row) return ''
  if (row.version === labels.published) return 'Live'
  if (row.status === 'draft') return row.origin === 'ai-proposal' ? 'Suggestion' : 'Draft'
  if (row.status === 'superseded') return 'Earlier'
  if (row.status === 'published') return 'Was live'
  return row.status || ''
}
