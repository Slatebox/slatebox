// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Action cards: an invited agent's changes outside Slatebox (owner, 2026-11-24: "linear should be
// read and write ... every mcp that we connect to should be this way").
//   - A change the person asked for ("file the retry bug") is planned like a lookup (translate.mjs
//     writePlanPrompt) but never made during the ask. It lands on the slate as one more note in the
//     agent's answer (the same frame, the same Keep all / Discard all), a card that says what would
//     happen, where, and with what: "Create Linear issue: Retry fails on 502 · Team: ENG".
//   - Keeping that card on its own approves it: the change is made then, as its inviter, after its
//     tool is checked again against the hash they consented to; the card then says it was done,
//     with the link the server gave. Discarding declines it. Keep all never approves a card.
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

export const CARD_STATES = Object.freeze(['waiting', 'running', 'done', 'failed', 'declined'])
export const APPROVERS = Object.freeze(['inviter', 'editors'])
export const CARD_LIMITS = Object.freeze({ title: 120, body: 160, target: 80, reason: 200, text: 400, perAsk: 3, keepDays: 7 })

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
const shown = (value, max) => (typeof value === 'string' ? plainText(value, max) : typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'boolean' ? String(value) : '')
const label = (key) => cap(String(key).replace(/Id$/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())

/**
 * What a card shows of a change: its title, a short body, where it goes (owner/repo, team,
 * project, status) and the item it changes (#42, ENG-12). fields: the recipe's names for each.
 */
export function previewOf(args = {}, fields = {}) {
  const a = args && typeof args === 'object' ? args : {}
  const first = (kind, max) => {
    for (const key of [...(fields[kind] || []), ...FIELD_DEFAULTS[kind]]) {
      const value = shown(a[key], max)
      if (value) return { key, value }
    }
    return null
  }
  const title = first('title', CARD_LIMITS.title)
  const body = first('body', CARD_LIMITS.body)
  const item = first('item', 40)
  const where = []
  if (shown(a.owner, 40) && shown(a.repo, 60)) where.push(`${shown(a.owner, 40)}/${shown(a.repo, 60)}`)
  for (const key of [...(fields.target || []), ...FIELD_DEFAULTS.target]) {
    if (key === 'owner' || key === 'repo' || where.length >= 3) continue
    const value = shown(a[key], 40)
    if (value && !where.some((w) => w.endsWith(value))) where.push(`${label(key)}: ${value}`)
  }
  return {
    ...(title && { title: title.value }),
    ...(body && body.value !== title?.value && { body: body.value }),
    ...(item && { item: /^\d+$/.test(item.value) ? '#' + item.value : item.value }),
    ...(where.length && { target: plainText(where.join(' · '), CARD_LIMITS.target) }),
  }
}

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
  else if (card.state === 'failed') parts.push(`Couldn't do · ${what}`, card.error || 'The server refused it.', 'Keep to try again, Discard to drop it.')
  else {
    parts.push(what, p.target, p.body)
    if (card.destructive) parts.push('This deletes, closes or merges something; Slatebox cannot undo it.')
    parts.push(options?.approvers === 'editors' ? 'Keep approves, Discard declines.' : `Waiting for ${options?.inviter || 'its inviter'} to approve: Keep approves, Discard declines.`)
  }
  return parts.filter(Boolean).map((part) => plainText(part, 200)).join('\n').slice(0, CARD_LIMITS.text)
}

const LINK_KEYS = ['url', 'html_url', 'htmlUrl', 'webUrl', 'web_url', 'link', 'permalink', 'href']

/** The link to what a change made, from the server's answer: a checked https link, or null. */
export function linkOf(raw) {
  const tryLink = (value) => (typeof value === 'string' ? safeLink(value) : null)
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

/** What anyone who can read the slate sees of a card (no account ids, no raw arguments beyond its preview). */
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

/** Whether an agent acts without asking on this slate: the slate's choice for it, else its integration's. */
export function actsWithoutAsking(connection, integration) {
  if (connection?.acting === 'on') return true
  if (connection?.acting === 'off') return false
  return integration?.actWithoutAsking === true
}
