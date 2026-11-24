// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Slatebox's own AI is the translation layer, in two steps that never share powers:
//   1. plan:      the model reads the request, the packed slate context and the server's tools
//                 (clamped, framed as the server's words) and picks at most 3 lookup calls. It can
//                 name only tools the person allowed; arguments are checked against the schema.
//   1b. changes: only when the person's own words ask for a change elsewhere (tools.mjs
//                 asksForChange), the change planner (writePlanPrompt) proposes at most a few calls
//                 of the agent's allowed change tools, checked the same way. None is made here: each
//                 becomes an action card a person approves (outside.mjs).
//   2. translate: a quarantined model with no outside tools and no slate tools reads the
//                 quarantined results (framed as data) and answers one schema-checked layout:
//                 groups of notes and lines. The server turns that into canvas operations; the
//                 whole answer to one ask is one suggestion (one frame, Keep all / Discard all,
//                 one Undo) people keep or discard on the slate.
// Diagram elements in Excalidraw's format are drawn by a fixed recipe, with no model at all
// (excalidraw.mjs), and a gallery agent's known asks by its recipe (recipes.mjs).
// The model never writes canvas operations itself, never sees ids (refs n1 ... stand for notes)
// and never chooses where content lands outside this slate.
import { randomBytes } from 'node:crypto'
import { inertJson, inertText, plainText, toolsEnvelope } from './tools.mjs'
import { contextEnvelope } from './context.mjs'
import { resultsEnvelope, resultsSummary, safeLink } from './results.mjs'

export const PLAN_LIMITS = Object.freeze({ calls: 3, writes: 3, rounds: 2, groups: 6, notesPerGroup: 12, linesPerGroup: 24, noteChars: 400, labelChars: 60, sayChars: 240 })
export const SHAPES = ['rectangle', 'roundedrectangle', 'ellipse', 'diamond']
const NOTE = Object.freeze({ width: 200, wideWidth: 360, height: 90, gap: 40, columns: 3, groupGap: 120 })

export class TranslateProblem extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// ---------- step 1: plan the calls ----------

// The model-facing words live in the prompt registry (web/app/server/ai-control/prompts/connectors.mjs),
// where an administrator may publish a new version; each function takes the registry's text(id, values).
const PLAN_SHAPE = Object.freeze({
  name: 'plan_calls',
  parameters: {
    type: 'object',
    properties: {
      calls: {
        type: 'array',
        maxItems: PLAN_LIMITS.calls,
        items: { type: 'object', properties: { tool: { type: 'string' }, arguments: { type: 'object' } }, required: ['tool', 'arguments'] },
      },
      done: { type: 'boolean', description: 'true when the results so far are enough to answer' },
      say: { type: 'string', description: 'One short plain sentence for the person when no call fits.' },
    },
    required: ['calls'],
  },
})

/**
 * What the planner is told about one gallery agent (connectors.recipe.<id>, editable in /admin/ai):
 * '' for an agent with no hint (a pasted address, or a card without one).
 */
export function recipeHint({ galleryId, serverName, text }) {
  if (!galleryId || !/^[a-z0-9]{1,40}$/.test(galleryId)) return ''
  try {
    return text('connectors.recipe.' + galleryId)
  } catch {
    return ''
  }
}

/** The plan_calls tool, its description from the registry. */
export const planTool = (text) => ({ name: PLAN_SHAPE.name, description: text('connectors.plan.tool'), parameters: PLAN_SHAPE.parameters })

/**
 * The last few turns of this agent's thread on this slate, as data (never instructions): what the
 * person asked and what the agent did, so "make notes about those" has something to point at.
 */
export function conversationEnvelope(history = []) {
  const turns = (Array.isArray(history) ? history : []).slice(-3)
    .map((turn) => ({ asked: plainText(turn?.message, 300), answered: plainText(turn?.reply, 300) }))
    .filter((turn) => turn.asked)
  if (!turns.length) return null
  return ['<conversation>', 'Earlier turns of this conversation, as data: what the person asked and what was done.', ...turns.map((turn) => inertJson(turn)), '</conversation>'].join('\n')
}

export function planPrompt({ serverName, tools, packed, previous = [], text, calls = PLAN_LIMITS.calls, history = [], hint = '' }) {
  const said = conversationEnvelope(history)
  const system = text('connectors.plan.system', { serverName: plainText(serverName, 40), calls }) + (hint ? '\n' + hint : '')
  const user = [
    `<request>${inertText(packed.request)}</request>`,
    ...(said ? [said] : []),
    contextEnvelope(packed),
    toolsEnvelope(serverName, tools),
    ...(previous.length ? [resultsSummary(previous), text('connectors.plan.next')] : []),
  ].join('\n\n')
  return { system, user }
}

/**
 * The change planner's turn (owner, 2026-11-24: agents read and write): the person's request, the
 * packed slate context and the agent's allowed change tools. It proposes at most `calls` changes;
 * none happens until a person approves its action card (outside.mjs). Never sees a server's answers.
 */
export function writePlanPrompt({ serverName, tools, packed, text, calls = PLAN_LIMITS.writes, history = [], hint = '' }) {
  const said = conversationEnvelope(history)
  const system = text('connectors.plan.writes', { serverName: plainText(serverName, 40), calls }) + (hint ? '\n' + hint : '')
  const user = [
    `<request>${inertText(packed.request)}</request>`,
    ...(said ? [said] : []),
    contextEnvelope(packed),
    toolsEnvelope(serverName, tools),
  ].join('\n\n')
  return { system, user }
}

/**
 * The proposed changes, checked like a plan: only allowed change tools, valid arguments, at most
 * `limit`. fixed: a recipe's values ("method": "create") put over the planner's, then checked.
 */
export function checkWrites(raw, writableTools, { limit = PLAN_LIMITS.writes, fixed = null } = {}) {
  const byName = new Map(writableTools.map((tool) => [tool.name, tool]))
  const calls = []
  for (const call of Array.isArray(raw?.calls) ? raw.calls : []) {
    if (calls.length >= Math.min(limit, PLAN_LIMITS.writes)) break
    const tool = byName.get(call?.tool)
    if (!tool) continue
    const args = { ...(call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments) ? call.arguments : {}), ...(fixed ? fitArgs(tool.inputSchema, fixed) : {}) }
    if (checkArguments(tool.inputSchema, args)) continue
    calls.push({ tool: tool.name, args })
  }
  return { calls, say: plainText(raw?.say || '', PLAN_LIMITS.sayChars) }
}

// A small, strict check of arguments against a tool's input schema: an object, required keys
// present, declared primitive types respected, no key the schema does not declare when it says so.
export function checkArguments(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object'
  const properties = schema?.properties || {}
  for (const key of schema?.required || []) if (args[key] === undefined) return `missing ${key}`
  for (const [key, value] of Object.entries(args)) {
    const spec = properties[key]
    if (!spec) {
      if (schema?.additionalProperties === false) return `unknown argument ${key}`
      continue
    }
    const types = [].concat(spec.type || [])
    if (!types.length) continue
    const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value
    const ok = types.some((t) => t === kind || (t === 'number' && kind === 'integer'))
    if (!ok) return `${key} must be ${types.join(' or ')}`
  }
  if (JSON.stringify(args).length > 60000) return 'arguments are too large'
  return null
}

/** Arguments with only the keys the tool's schema declares (when it declares any): a recipe passes both spellings. */
export function fitArgs(schema, args) {
  const declared = schema?.properties && typeof schema.properties === 'object' ? Object.keys(schema.properties) : []
  if (!declared.length) return { ...args }
  return Object.fromEntries(Object.entries(args).filter(([key]) => declared.includes(key)))
}

/**
 * The model's plan, checked: only allowed tools, valid arguments, at most `limit` calls, and each
 * tool at most once per ask (`used`: the tools earlier rounds already called).
 */
export function checkPlan(raw, allowedTools, { limit = PLAN_LIMITS.calls, used = new Set() } = {}) {
  const byName = new Map(allowedTools.map((tool) => [tool.name, tool]))
  const calls = []
  const taken = new Set(used)
  for (const call of Array.isArray(raw?.calls) ? raw.calls : []) {
    if (calls.length >= Math.min(limit, PLAN_LIMITS.calls)) break
    const tool = byName.get(call?.tool)
    if (!tool || taken.has(tool.name)) continue
    const problem = checkArguments(tool.inputSchema, call.arguments ?? {})
    if (problem) continue
    taken.add(tool.name)
    calls.push({ tool: tool.name, args: call.arguments ?? {} })
  }
  return { calls, done: raw?.done === true, say: plainText(raw?.say || '', PLAN_LIMITS.sayChars) }
}

// ---------- step 2: translate results into a layout ----------

const LAYOUT_SHAPE = Object.freeze({
  name: 'place_suggestions',
  parameters: {
    type: 'object',
    properties: {
      say: { type: 'string', description: 'One short plain sentence: what the suggestions are.' },
      groups: {
        type: 'array',
        maxItems: PLAN_LIMITS.groups,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'What this group is, in a few words.' },
            layout: { type: 'string', enum: ['row', 'column', 'grid', 'flow'] },
            notes: {
              type: 'array',
              maxItems: PLAN_LIMITS.notesPerGroup,
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string', description: 'A short key for this note, used by lines.' },
                  text: { type: 'string' },
                  shape: { type: 'string', enum: SHAPES },
                  link: { type: 'string', description: 'One https link from the results, when the note is about a source.' },
                },
                required: ['key', 'text'],
              },
            },
            lines: {
              type: 'array',
              maxItems: PLAN_LIMITS.linesPerGroup,
              items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
            },
            near: { type: 'string', description: 'A note ref (n1 ...) this group belongs next to, if any.' },
          },
          required: ['label', 'notes'],
        },
      },
    },
    required: ['groups'],
  },
})

/** The place_suggestions tool, its description from the registry. */
export const layoutTool = (text) => ({ name: LAYOUT_SHAPE.name, description: text('connectors.layout.tool'), parameters: LAYOUT_SHAPE.parameters })

export function translatePrompt({ serverName, packed, entries, text, history = [], budget = null }) {
  const said = conversationEnvelope(history)
  const hasNotes = Number.isInteger(budget?.notes)
  const hasLines = Number.isInteger(budget?.lines)
  const limit = hasNotes || hasLines ? '\n' + text('connectors.layout.budget', { notes: budget.notes ?? 0, lines: budget.lines ?? 0, hasNotes, hasLines, hasBoth: hasNotes && hasLines, oneNote: budget.notes === 1, oneLine: budget.lines === 1 }) : ''
  const system = text('connectors.layout.system') + limit
  const user = [`<request>${inertText(packed.request)}</request>`, ...(said ? [said] : []), contextEnvelope(packed), resultsEnvelope(serverName, entries)].join('\n\n')
  return { system, user }
}

const isRef = (value, aliases) => typeof value === 'string' && Object.hasOwn(aliases, value)

/** The model's layout, checked and cleaned. Links must appear in the results. */
export function checkLayout(raw, { aliases = {}, allowedLinks = new Set() } = {}) {
  const groups = []
  for (const group of Array.isArray(raw?.groups) ? raw.groups.slice(0, PLAN_LIMITS.groups) : []) {
    const notes = []
    const keys = new Set()
    for (const note of Array.isArray(group?.notes) ? group.notes.slice(0, PLAN_LIMITS.notesPerGroup) : []) {
      const key = plainText(note?.key, 40)
      const text = plainText(note?.text, PLAN_LIMITS.noteChars)
      if (!key || !text || keys.has(key) || isRef(key, aliases)) continue
      keys.add(key)
      const link = note.link ? safeLink(note.link) : null
      notes.push({
        key,
        text,
        ...(SHAPES.includes(note.shape) && { shape: note.shape }),
        ...(link && allowedLinks.has(link.url) && { link: link.url }),
      })
    }
    if (!notes.length) continue
    const lines = []
    for (const line of Array.isArray(group?.lines) ? group.lines.slice(0, PLAN_LIMITS.linesPerGroup) : []) {
      const ok = (end) => keys.has(end) || isRef(end, aliases)
      if (!ok(line?.from) || !ok(line?.to) || line.from === line.to) continue
      if (!keys.has(line.from) && !keys.has(line.to)) continue
      lines.push({ from: line.from, to: line.to })
    }
    groups.push({
      label: plainText(group.label, PLAN_LIMITS.labelChars) || 'Suggestion',
      layout: ['row', 'column', 'grid', 'flow'].includes(group.layout) ? group.layout : 'grid',
      notes,
      lines,
      ...(isRef(group.near, aliases) && { near: group.near }),
    })
  }
  return { say: plainText(raw?.say || '', PLAN_LIMITS.sayChars), groups }
}

// ---------- the Excalidraw recipe ----------

const parseElements = (value) => {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.length < 200000) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.elements) ? parsed.elements : null
    } catch {
      return null
    }
  }
  if (value && Array.isArray(value.elements)) return value.elements
  return null
}

/** Excalidraw elements found in a call's structured result or its arguments, or null. */
export function excalidrawElements(entry) {
  for (const source of [entry.result?.structured?.elements, entry.result?.structured, entry.args?.elements]) {
    const elements = parseElements(source)
    if (elements?.some((el) => el && typeof el.type === 'string' && ['rectangle', 'ellipse', 'diamond', 'arrow', 'text'].includes(el.type))) return elements
  }
  return null
}

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

// ---------- layout to canvas operations ----------

const newId = () => 'ag' + randomBytes(8).toString('hex')

function boundsOf(nodes) {
  if (!nodes.length) return null
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const node of nodes) {
    const o = node.options || {}
    left = Math.min(left, num(o.xPos))
    top = Math.min(top, num(o.yPos))
    right = Math.max(right, num(o.xPos) + num(o.width, NOTE.width))
    bottom = Math.max(bottom, num(o.yPos) + num(o.height, NOTE.height))
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function placeNotes(group) {
  if (group.layout === 'free') {
    const minX = Math.min(...group.notes.map((n) => n.at.x))
    const minY = Math.min(...group.notes.map((n) => n.at.y))
    return group.notes.map((n) => ({ ...n, at: { x: n.at.x - minX, y: n.at.y - minY, width: n.at.width, height: n.at.height } }))
  }
  const columns = group.layout === 'row' || group.layout === 'flow' ? group.notes.length : group.layout === 'column' ? 1 : Math.min(NOTE.columns, group.notes.length)
  // Taller notes for longer text (about 24 characters a line at the default size), rows as tall as their tallest note.
  // An action card (wide) is wider and as tall as its words need: it shows everything its change sends.
  const widthOf = (n) => (n.wide ? NOTE.wideWidth : NOTE.width)
  const heightOf = (n) => (n.wide
    ? Math.min(1400, Math.max(NOTE.height, 30 + 26 * String(n.text).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 40)), 0)))
    : Math.min(400, Math.max(NOTE.height, 30 + 28 * Math.ceil(n.text.length / 24))))
  const rows = []
  group.notes.forEach((n, index) => {
    const row = Math.floor(index / columns)
    rows[row] = Math.max(rows[row] || 0, heightOf(n))
  })
  const top = (row) => rows.slice(0, row).reduce((sum, h) => sum + h + NOTE.gap, 0)
  return group.notes.map((n, index) => ({
    ...n,
    at: { x: (index % columns) * (Math.max(...group.notes.map(widthOf)) + NOTE.gap), y: top(Math.floor(index / columns)), width: widthOf(n), height: heightOf(n) },
  }))
}

/**
 * The suggestion for one ask: every group's notes, and lines among them or to notes already on the
 * slate, as ONE slates.applyOperations plan, so the answer is one suggestion (one frame on the
 * slate, Keep all / Discard all, one Undo). Groups are stacked in one block, placed beside the
 * note the first group is near, else in free space inside the asker's view, else to the right of
 * what the asker selected (the whole slate when nothing is).
 * → [{ label, plan: { message, operations }, created: [ids], frame, groups: [{ label, created, frame }] }] (empty when there is nothing)
 */
export function itemsFromLayout({ groups, slate, aliases = {}, selection = [], serverName, view = null, message = '', busy = [] }) {
  if (!groups.length) return []
  const nodes = slate?.nodes || []
  const byId = new Map(nodes.map((node) => [node.options?.id, node]))
  const selected = selection.map((id) => byId.get(id)).filter(Boolean)
  const anchor = boundsOf(selected.length ? selected : nodes) || { x: 80, y: 80, width: 0, height: 0 }
  // Each group laid out on its own, then stacked under the one before it.
  const blocks = []
  let offsetY = 0
  for (const group of groups) {
    const placed = placeNotes(group)
    const size = { width: Math.max(...placed.map((n) => n.at.x + n.at.width)), height: Math.max(...placed.map((n) => n.at.y + n.at.height)) }
    blocks.push({ group, placed, y: offsetY, size })
    offsetY += size.height + NOTE.groupGap
  }
  const block = { width: Math.max(...blocks.map((b) => b.size.width)), height: offsetY - NOTE.groupGap }
  const nearGroup = groups.find((group) => group.near && byId.get(aliases[group.near]))
  const near = nearGroup && byId.get(aliases[nearGroup.near])
  // What is already there, so the answer never lands on a note, nor on an earlier answer still
  // waiting (busy: the boxes of waiting ghosts, { x, y, width, height }).
  const waiting = (Array.isArray(busy) ? busy : []).filter((b) => b && [b.x, b.y, b.width, b.height].every(Number.isFinite)).slice(0, 400)
  const taken = [...nodes.map((node) => boundsOf([node])), ...waiting]
  const spot = !near && view ? freeSpot(view, block, taken) : null
  // No view (or no room in it): right of the notes and of whatever waits, at the anchor's height.
  const waitingRight = waiting.length ? Math.max(...waiting.map((b) => b.x + b.width)) : -Infinity
  const fallbackX = Math.max(anchor.x + anchor.width, waitingRight) + NOTE.groupGap
  const originX = near ? num(near.options.xPos) + num(near.options.width, NOTE.width) + NOTE.groupGap : spot ? spot.x : fallbackX
  const originY = near ? num(near.options.yPos) : spot ? spot.y : anchor.y
  const operations = []
  const lineOps = []
  const created = []
  const shownGroups = []
  for (const { group, placed, y, size } of blocks) {
    const idOf = new Map()
    for (const note of placed) {
      const id = newId()
      idOf.set(note.key, id)
      operations.push({
        kind: 'add_nodes',
        count: 1,
        ids: [id],
        text: note.text,
        x: Math.round(originX + note.at.x),
        y: Math.round(originY + y + note.at.y),
        width: Math.round(Math.min(5000, Math.max(20, note.at.width))),
        height: Math.round(Math.min(5000, Math.max(20, note.at.height))),
        shape: note.shape || 'roundedrectangle',
        ...(note.link && { style: { link: note.link } }),
      })
    }
    const endId = (end) => idOf.get(end) || aliases[end] || null
    for (const line of group.lines || []) {
      const from = endId(line.from)
      const to = endId(line.to)
      if (from && to) lineOps.push({ kind: 'connect_nodes', from: { ids: [from] }, to: { ids: [to] } })
    }
    created.push(...idOf.values())
    shownGroups.push({ label: group.label, created: [...idOf.values()], frame: { x: Math.round(originX), y: Math.round(originY + y), width: Math.round(size.width), height: Math.round(size.height) } })
  }
  const label = plainText(groups.map((group) => group.label).join(', '), PLAN_LIMITS.labelChars) || 'Suggestion'
  return [{
    label,
    plan: { message: (message ? plainText(message, 200) : `${plainText(serverName, 40)}: ${label}`).slice(0, 200), operations: [...operations, ...lineOps] },
    created,
    frame: { x: Math.round(originX), y: Math.round(originY), width: Math.round(block.width), height: Math.round(block.height) },
    groups: shownGroups,
  }]
}

const overlaps = (a, b, gap) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap

/**
 * The first spot inside a view (row by row, from its top left, a margin in) where a box of this
 * size touches nothing taken. A box larger than the view starts at its top left. Null: no room.
 */
export function freeSpot(view, size, taken, { margin = 40, step = 40, gap = 30 } = {}) {
  const minX = view.x + margin
  const minY = view.y + margin
  const maxX = Math.max(minX, view.x + view.width - margin - size.width)
  const maxY = Math.max(minY, view.y + view.height - margin - size.height)
  for (let y = minY; y <= maxY; y += step)
    for (let x = minX; x <= maxX; x += step) {
      const box = { x, y, width: size.width, height: size.height }
      if (!taken.some((other) => other && overlaps(box, other, gap))) return { x: Math.round(x), y: Math.round(y) }
    }
  return null
}

/** Every link that appears in the quarantined results: the only links a note may carry. */
export function linksIn(entries) {
  const out = new Set()
  for (const entry of entries) for (const link of entry.result.links || []) out.add(link.url)
  return out
}
