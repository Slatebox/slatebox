// A reviewer's refinement of a library item: the local grammar that answers without AI (and so
// costs nothing), and the check every proposal passes before it is shown or kept, whether it came
// from that grammar or from the AI (refine-ai.mjs). Pure.
import { CATEGORY_LABELS, INTEGRATION_CATEGORIES, INTEGRATION_CATEGORY_LABELS, LIBRARY_CATEGORIES, categoryLabel, categoryLockSentence, libraryError, readMeta } from '../../imports/api/common/library-model.mjs'

const unquote = (text) => text.trim().replace(/^["'“‘](.*)["'”’]$/s, '$1').replace(/[.!]+$/, '').trim()
// An integration's categories are the agent gallery's (Work, Business, Research, Web and facts).
const categoriesOf = (kind) => (kind === 'integration' ? INTEGRATION_CATEGORIES : LIBRARY_CATEGORIES)
const categoryNamed = (word, kind) => {
  const plain = String(word || '').trim().toLowerCase().replace(/[.!"'“”]+/g, '')
  const labels = kind === 'integration' ? INTEGRATION_CATEGORY_LABELS : CATEGORY_LABELS
  return categoriesOf(kind).find((id) => id === plain || labels[id].toLowerCase() === plain) || null
}

/**
 * The local grammar: "rename it to X", "call it X", "title: X", "put it in Decide", "category: Plan",
 * "summary: …", "one line: …". → a proposal `{ reply, meta }`, or null when the message is not one of these.
 */
export function localRefinement(message, { kind = 'component' } = {}) {
  if (typeof message !== 'string') return null
  const text = message.trim()
  if (!text || text.length > 400) return null
  let match = /^(?:please\s+)?(?:rename\s+(?:it|this)\s+(?:to|as)|call\s+(?:it|this)|name\s+(?:it|this)|title\s*:)\s*(.+)$/i.exec(text)
  if (match) {
    const title = unquote(match[1])
    return title ? { reply: `Rename it to "${title}".`, meta: { title } } : null
  }
  match = /^(?:please\s+)?(?:put|move|file)\s+(?:it|this)\s+(?:in|into|under)\s+(?:the\s+)?(.+?)(?:\s+category)?[.!]?$/i.exec(text) ||
    /^category\s*:\s*(.+)$/i.exec(text)
  if (match) {
    const category = categoryNamed(match[1], kind)
    if (!category) {
      // A label with a comma in it ("Docs, chat and meetings") is set apart with semicolons.
      const labels = categoriesOf(kind).map(categoryLabel)
      return { reply: `The categories are ${labels.join(labels.some((label) => label.includes(',')) ? '; ' : ', ')}.` }
    }
    return { reply: `Put it in ${categoryLabel(category)}.`, meta: { category } }
  }
  match = /^(?:summary|one line|line)\s*:\s*(.+)$/is.exec(text)
  if (match) {
    const summary = unquote(match[1])
    return summary ? { reply: 'Use this one-line summary.', meta: { summary } } : null
  }
  return null
}

/**
 * Check a proposal against an item: the metadata limits and the category lock. Edits are checked by
 * the caller on the review board (they need the board). → `{ reply, meta, edits, check, diff: { meta } }`
 * with only the fields that change; throws a 409 or 400 with the sentence to show.
 */
export function checkProposal(item, proposal) {
  if (!proposal || typeof proposal !== 'object') throw libraryError(502, 'refine_failed', 'The proposal could not be read. Ask again.')
  const reply = typeof proposal.reply === 'string' ? proposal.reply.slice(0, 2000) : ''
  const meta = proposal.meta && typeof proposal.meta === 'object' ? readMeta(proposal.meta, { kind: item.kind, partial: true }) : {}
  if (meta.category && item.categoryLocked && meta.category !== item.category) throw libraryError(409, 'category_locked', categoryLockSentence(item.category))
  const diff = {}
  for (const [field, value] of Object.entries(meta)) {
    const before = item[field]
    if (JSON.stringify(before ?? null) !== JSON.stringify(value)) diff[field] = [before ?? null, value]
    else delete meta[field]
  }
  const edits = Array.isArray(proposal.edits) && proposal.edits.length ? proposal.edits : []
  if (edits.length && item.kind !== 'component') throw libraryError(400, 'invalid_request', 'Only a smart component takes board edits here. Edit the slate on its canvas.')
  const check = Array.isArray(proposal.check) ? proposal.check.filter((line) => typeof line === 'string').map((line) => line.slice(0, 300)).slice(0, 12) : []
  return { reply, meta, edits, check, diff: { meta: diff } }
}
