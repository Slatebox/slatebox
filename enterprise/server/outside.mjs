// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Action cards: an invited agent's changes outside Slatebox (owner, 2026-11-24: "linear should be
// read and write ... every mcp that we connect to should be this way").
//   - A change the person asked for ("file the retry bug") is planned like a lookup (translate.mjs
//     writePlanPrompt) but never made during the ask. It lands on the slate as one more note in the
//     agent's answer (the same frame), a card that says what would
//     happen, where, and with what: "Create Linear issue: Retry fails on 502 · Team: ENG".
//   - Approve on that card (the canvas draws Approve and Decline on it; the app hears Keep of that
//     note alone) approves it: the change is made then, as its inviter, after its tool is checked
//     again against the hash they consented to; the card then says it was done, with the link the
//     server gave. Decline declines it. Keep all never approves a card.
//   - Only the inviter approves (the same rule as asking), unless they let the slate's editors
//     approve too. A token approves only for an agent its inviter lets act without asking.
//   - "Act without asking" (per agent on an integration, and per slate; off by default; only the
//     inviter turns it on, the inviter or the slate's owner turns it off; audited) makes the
//     change during the ask; the card says it was done. A destructive change always waits.
//   - Undo of the answer leaves a done card: nothing made outside Slatebox can be undone from here,
//     and the undo says so.
// Everything shown on a card is built here from the tool's typed arguments (the planner's words
// from the person's request and slate notes) and Slatebox's own words; a server's answer adds only
// a checked https link, or a short plain reason when it failed.
import { plainText } from './tools.mjs'
import { safeLink } from './results.mjs'

// unclear: the call was sent but no answer came back (a timeout, a dropped connection, a restart
// while it ran), so it may have been made: never tried again by a plain Keep.
export const CARD_STATES = Object.freeze(['waiting', 'running', 'done', 'failed', 'unclear', 'declined'])
export const APPROVERS = Object.freeze(['inviter', 'editors'])
// A card shows every argument its change sends, in full (title, body, where, the item, and each
// other value): a change whose arguments do not fit on a card is not proposed at all.
// runningMs: how long a change may run before its card is counted unclear (a lease).
// keepDays: waiting cards; recordDays: done and declined ones, the slate's record of what was done.
export const CARD_LIMITS = Object.freeze({ title: 200, body: 700, value: 160, target: 200, reason: 200, payload: 1000, text: 1400, perAsk: 3, keepDays: 7, recordDays: 365, runningMs: 5 * 60 * 1000 })

const WRITE_FIRST = new Set(['create', 'add', 'update', 'edit', 'set', 'save', 'post', 'send', 'open', 'comment', 'reply', 'assign', 'label', 'move', 'rename', 'upload', 'publish', 'submit', 'start', 'run', 'invite', 'push', 'merge', 'close', 'delete', 'remove', 'archive', 'mark', 'write', 'make', 'new', 'file', 'reopen', 'resolve', 'complete', 'link', 'attach', 'tag', 'pin', 'schedule', 'cancel', 'transfer', 'fork'])
const words = (name) => String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const cap = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text)

/**
 * What a card calls its change: the recipe's label ("Create Linear issue"), else the tool's own
 * name with the agent's name after its verb ("create_issue" on Linear: "Create Linear issue").
 */
export function cardLabel({ tool, title = '', system, label = null }) {
  if (label) return plainText(label, 60)
  const parts = words(title || tool)
  const name = plainText(system, 32)
  if (!parts.length) return `Change in ${name}`
  if (WRITE_FIRST.has(parts[0])) return plainText(`${cap(parts[0])} ${name}${parts.length > 1 ? ' ' + parts.slice(1).join(' ') : ''}`, 60)
  return plainText(`${name}: ${parts.join(' ')}`, 60)
}

const FIELD_DEFAULTS = Object.freeze({
  title: ['title', 'name', 'subject', 'summary', 'heading'],
  body: ['body', 'description', 'text', 'content', 'message', 'comment', 'markdown'],
  target: ['team', 'teamId', 'project', 'projectId', 'channel', 'state', 'stateId', 'status', 'head', 'base', 'board', 'list', 'space', 'database'],
  item: ['issue_number', 'issueNumber', 'issueId', 'issue', 'pullNumber', 'pull_number', 'number', 'identifier', 'id'],
})
// One line: every run of white space (new lines included) is one space.
const oneLine = (text) => plainText(String(text ?? '').replace(/\s+/g, ' '), Infinity)
// A value as a card shows it, in full: text, a number, true/false, a list of those, or compact JSON.
const fullValue = (value) => {
  if (typeof value === 'string') return oneLine(value)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return ''
  if (Array.isArray(value) && value.every((v) => ['string', 'number', 'boolean'].includes(typeof v))) return value.map((v) => oneLine(v)).join(', ')
  try {
    return oneLine(JSON.stringify(value))
  } catch {
    return '?'
  }
}
const label = (key) => cap(String(key).replace(/Id$/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())

// The whole card preview, and whether every argument fits on it in full.
function previewParts(args = {}, fields = {}) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  const used = new Set()
  let fits = true
  const take = (key, max) => {
    used.add(key)
    const text = fullValue(a[key])
    if (text.length > max) fits = false
    return text.slice(0, max)
  }
  const first = (kind, max) => {
    for (const key of [...(fields[kind] || []), ...FIELD_DEFAULTS[kind]]) {
      if (used.has(key) || !Object.hasOwn(a, key)) continue
      const value = fullValue(a[key])
      if (value && ['string', 'number'].includes(typeof a[key])) return { key, value: take(key, max) }
    }
    return null
  }
  const title = first('title', CARD_LIMITS.title)
  const body = first('body', CARD_LIMITS.body)
  const item = first('item', 60)
  const where = []
  if (typeof a.owner === 'string' && typeof a.repo === 'string' && fullValue(a.owner) && fullValue(a.repo)) where.push(`${take('owner', 60)}/${take('repo', 100)}`)
  for (const key of [...(fields.target || []), ...FIELD_DEFAULTS.target]) {
    if (used.has(key) || key === 'owner' || key === 'repo' || !Object.hasOwn(a, key)) continue
    const value = fullValue(a[key])
    if (value && ['string', 'number'].includes(typeof a[key])) where.push(`${label(key)}: ${take(key, 80)}`)
  }
  // Every other argument it sends, by name: nothing is sent that the card does not show.
  const more = []
  for (const key of Object.keys(a).sort()) {
    if (used.has(key)) continue
    const value = take(key, CARD_LIMITS.value)
    if (value) more.push(`${label(key)}: ${value}`)
  }
  const target = where.join(' · ')
  if (target.length > CARD_LIMITS.target) fits = false
  const preview = {
    ...(title && { title: title.value }),
    ...(body && body.value !== title?.value && { body: body.value }),
    ...(item && { item: /^\d+$/.test(item.value) ? '#' + item.value : item.value }),
    ...(target && { target: target.slice(0, CARD_LIMITS.target) }),
    ...(more.length && { more }),
  }
  const size = [preview.title, preview.body, preview.item, preview.target, ...(preview.more || [])].filter(Boolean).reduce((sum, part) => sum + part.length + 1, 0)
  if (size > CARD_LIMITS.payload) fits = false
  return { preview, fits }
}

/**
 * What a card shows of a change: its title, its body, where it goes (owner/repo, team, project,
 * status), the item it changes (#42, ENG-12) and every other argument it sends (more), each in
 * full. fields: the recipe's names for each.
 */
export const previewOf = (args = {}, fields = {}) => previewParts(args, fields).preview

/** Whether every argument of a change fits on its card in full (one that does not is never proposed). */
export const fitsOnCard = (args = {}, fields = {}) => previewParts(args, fields).fits

/**
 * The words on a card's note, for its state, one line per part (plainText folds new lines away, so
 * each part is cleaned on its own). options: { inviter (first name of who approves), approvers }.
 */
export function cardText(card, options) {
  const p = card.preview || {}
  const what = [card.label, p.item].filter(Boolean).join(' ') + (p.title ? `: ${p.title}` : '')
  const parts = []
  if (card.state === 'done') {
    parts.push(`Done · ${what}`, p.target, card.result?.link, card.actedWithoutAsking ? `${card.system} did this without asking.` : `Approved by ${card.decidedBy || 'someone'}.`)
  } else if (card.state === 'running') parts.push(`Sending · ${what}`, p.target)
  else if (card.state === 'failed') parts.push(`Couldn't do · ${what}`, card.error || 'The server refused it.', 'Approve to try again, Decline to drop it.')
  else if (card.state === 'unclear')
    parts.push(`Not sure it was made · ${what}`, p.target, card.error || `${card.system} did not answer.`, `It may already be in ${card.system}: look there first. Try again anyway only if it is not there; Decline to drop this card.`)
  else {
    // Everything the change sends, in full: what is approved is what is sent.
    parts.push(what, p.target, p.body, ...(p.more || []))
    if (card.destructive) parts.push('This deletes, closes or merges something; Slatebox cannot undo it.')
    parts.push(options?.approvers === 'editors' ? 'Approve or Decline it here.' : `Waiting for ${options?.inviter || 'its inviter'} to approve: Approve or Decline it here.`)
  }
  return parts.filter(Boolean).map((part) => plainText(part, CARD_LIMITS.body + 20)).join('\n').slice(0, CARD_LIMITS.text)
}

const LINK_KEYS = ['url', 'html_url', 'htmlUrl', 'webUrl', 'web_url', 'link', 'permalink', 'href']

/**
 * The link to what a change made, from the server's answer: a checked https link, or null. A link
 * that the change's own arguments carry (args: a title or body that names a URL, echoed back by the
 * server) is never taken for the link to what was made: those words came from the planner.
 */
export function linkOf(raw, args = null) {
  const sent = args ? JSON.stringify(args) : ''
  const echoed = (url) => {
    if (!sent) return false
    const bare = url.replace(/[/#?]+$/, '')
    return sent.includes(bare) || sent.includes(bare.replace(/^https:\/\//, ''))
  }
  const tryLink = (value) => {
    const link = typeof value === 'string' ? safeLink(value) : null
    return link && !echoed(link.url) && !echoed(value) ? link : null
  }
  const visit = (value, depth) => {
    if (!value || typeof value !== 'object' || depth > 3) return null
    for (const key of LINK_KEYS) {
      const link = tryLink(value[key])
      if (link) return link
    }
    for (const inner of Object.values(value).slice(0, 40)) {
      const link = visit(inner, depth + 1)
      if (link) return link
    }
    return null
  }
  const structured = visit(raw?.structuredContent, 0)
  if (structured) return structured.url
  for (const block of Array.isArray(raw?.content) ? raw.content : []) {
    if (block?.type === 'resource_link') {
      const link = tryLink(block.uri)
      if (link) return link.url
    }
    if (block?.type === 'text' && typeof block.text === 'string') {
      const text = block.text.slice(0, 20000)
      try {
        const parsed = JSON.parse(text)
        const found = visit(parsed, 0)
        if (found) return found.url
      } catch {}
      for (const match of text.matchAll(/https:\/\/[^\s"'<>()\]]+/g)) {
        const link = tryLink(match[0].replace(/[.,;:]+$/, ''))
        if (link) return link.url
      }
    }
  }
  return null
}

/** Why a change failed, in a short plain sentence (the server's text is clamped, never markup). */
export function failureOf(raw) {
  const text = (Array.isArray(raw?.content) ? raw.content : []).filter((b) => b?.type === 'text').map((b) => b.text).join(' ')
  const said = plainText(text, CARD_LIMITS.reason)
  return said ? `The server said: ${said}` : 'The server refused it.'
}

/** What anyone who can read the slate sees of a card: no account ids; its arguments in full (what approving it sends). */
export function publicCard(doc, viewerId = null) {
  return {
    cardId: doc._id,
    connectionId: doc.connectionId,
    agentId: doc.agentId || null,
    actionId: doc.actionId || null,
    nodeId: doc.nodeId || null,
    system: doc.system,
    label: doc.label,
    tool: doc.tool,
    preview: doc.preview || {},
    args: doc.args && typeof doc.args === 'object' ? doc.args : {},
    destructive: Boolean(doc.destructive),
    state: doc.state,
    ...(doc.result?.link && { link: doc.result.link }),
    ...(doc.error && { error: doc.error }),
    decidedBy: doc.decidedBy || null,
    actedWithoutAsking: Boolean(doc.actedWithoutAsking),
    mine: Boolean(viewerId && doc.ownerId === viewerId),
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt || null,
    decidedAt: doc.decidedAt instanceof Date ? doc.decidedAt.toISOString() : doc.decidedAt || null,
  }
}

/**
 * Whether an agent acts without asking on this slate: the slate's choice for it, else its
 * integration's. The integration's choice reaches only slates its inviter owns (slate given): on
 * someone else's slate it acts without asking only when its inviter turned it on there, by name.
 */
export function actsWithoutAsking(connection, integration, slate = null) {
  if (connection?.acting === 'on') return true
  if (connection?.acting === 'off') return false
  if (slate && slate.userId !== connection?.ownerId) return false
  return integration?.actWithoutAsking === true
}

/** A real API token (an app or script the person made), not a conversation, a teammate or an invited agent. */
export const isApiToken = (principal) =>
  principal?.kind === 'agent' && !principal.connector && !principal.builtin && typeof principal.tokenId === 'string' && principal.tokenId.length > 0 && !/^(session|agent|connector):/.test(principal.tokenId)
