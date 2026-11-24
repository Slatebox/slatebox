// Custom shapes from a description (the `shape` AI feature). Pure: the model request, the meter,
// the cache and ids come in as deps, so this runs and is tested without Meteor, and the
// presentation styles can call the same generateShapes. A shape is one SVG path (compound
// sub-paths allowed for parts and holes) and a fill rule, checked by slateboxjs/shapes; the
// model's answer is only ever data, never markup. Nothing here names a model or provider.
import { createHash } from 'node:crypto'
import { prepareShape } from 'slateboxjs/shapes'
import { codePromptText, promptText } from '../ai-control/prompts/index.mjs'

export const SHAPE_FEATURE = 'shape'
export const MAX_DESCRIBE = 200
export const MAX_COUNT = 4
export const DEFAULT_COUNT = 3
// A drawing is cached, and its candidates can be applied, for as long as it is kept (the
// ShapeGenerations TTL index): a cached answer never hands out a candidate that expired.
export const GENERATION_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const CANDIDATE_TTL_MS = GENERATION_TTL_MS
// Drawings per person per hour, on every surface (canvas, chat, exec, MCP, HTTP).
export const DRAWINGS_PER_HOUR = 20
export const RATE_LIMITED_MESSAGE = 'That is a lot of shapes for one hour. Try again a little later.'
export const UNAVAILABLE_MESSAGE = 'Could not draw that shape. Try describing it more simply.'

// The one tool the model answers with. Its description is a prompt (tool.propose_shapes,
// server/ai-control/prompts/shape.mjs): shapeTool() sends the published one, SHAPE_TOOL holds the built-in.
export const SHAPE_TOOL = Object.freeze({
  name: 'propose_shapes',
  description: codePromptText('tool.propose_shapes'),
  parameters: {
    type: 'object',
    properties: {
      shapes: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_COUNT,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'A short name for the shape, two or three words.' },
            d: { type: 'string', description: 'The SVG path data: absolute commands only, every part closed with Z.' },
            fillRule: { type: 'string', enum: ['nonzero', 'evenodd'], description: 'evenodd when the shape has holes.' },
          },
          required: ['name', 'd', 'fillRule'],
        },
      },
    },
    required: ['shapes'],
  },
})

/** The tool as sent: its description is the published one (tool.propose_shapes). */
export function shapeTool() {
  return { ...SHAPE_TOOL, description: promptText('tool.propose_shapes') }
}

// The text is a prompt an administrator can edit (shape.system, server/ai-control/prompts/shape.mjs).
// The description is never spliced in here.
export function shapeSystemPrompt(count = DEFAULT_COUNT) {
  return promptText('shape.system', { count })
}

export function shapeUserPrompt(describe) {
  return { role: 'user', content: [{ type: 'text', text: promptText('shape.user', { describe }) }] }
}

export function cleanDescribe(describe) {
  if (typeof describe !== 'string') return null
  const clean = describe.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean && clean.length <= MAX_DESCRIBE ? clean : null
}

// The shapes a response carries, from any of the forms a model answers in: a tool call's input
// (an object or a JSON string); a connection on toolChoice auto (a provider that refuses a forced call) that
// answers in text instead: bare JSON, JSON in a ``` fence, JSON after a sentence, or its tool
// call written out as text ({"name": "propose_shapes", "parameters": {...}}). Only the first
// usable list counts; nothing in the text is ever run or rendered.
const WRAPPERS = ['parameters', 'arguments', 'input', 'tool_input', 'function', 'tool_calls', 'content', 'text', 'json']
const MAX_TEXT = 200_000
const MAX_TRIES = 40

// Every JSON object or array in a text, outermost first (strings and escapes respected).
function jsonValuesIn(text) {
  const values = []
  const source = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text
  const whole = source.trim()
  try {
    values.push(JSON.parse(whole))
    return values
  } catch {
    // not one JSON value: look inside it
  }
  let tries = 0
  for (let i = 0; i < source.length && tries < MAX_TRIES; i++) {
    const open = source[i]
    if (open !== '{' && open !== '[') continue
    tries++
    let depth = 0
    let inString = false
    for (let j = i; j < source.length; j++) {
      const ch = source[j]
      if (inString) {
        if (ch === '\\') j++
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') {
        depth--
        if (depth === 0) {
          try {
            values.push(JSON.parse(source.slice(i, j + 1)))
            i = j
          } catch {
            // balanced but not JSON: try the next opening
          }
          break
        }
      }
    }
  }
  return values
}

const looksLikeShape = (value) => value && typeof value === 'object' && !Array.isArray(value) && (typeof value.d === 'string' || typeof value.path === 'string')

function shapesIn(value, depth = 0) {
  if (value == null || depth > 6) return null
  if (typeof value === 'string') {
    for (const parsed of jsonValuesIn(value)) {
      const found = shapesIn(parsed, depth + 1)
      if (found) return found
    }
    return null
  }
  if (Array.isArray(value)) {
    if (value.length && value.some(looksLikeShape)) return value
    for (const item of value) {
      const found = shapesIn(item, depth + 1)
      if (found) return found
    }
    return null
  }
  if (typeof value !== 'object') return null
  if (Array.isArray(value.shapes)) return value.shapes
  if (typeof value.shapes === 'string') {
    const found = shapesIn(value.shapes, depth + 1)
    if (found) return found
  }
  for (const key of WRAPPERS) {
    const found = shapesIn(value[key], depth + 1)
    if (found) return found
  }
  return looksLikeShape(value) ? [value] : null
}

export function readCandidates(response) {
  const json = response?.json
  const content = Array.isArray(json?.content) ? json.content : []
  // a real tool call first, then whatever else the answer holds
  const toolUse = content.find((part) => part?.type === 'tool_use')
  const shapes = shapesIn(toolUse?.input) || shapesIn(json) || shapesIn(response?.message?.content) || []
  return shapes
    .filter((shape) => shape && typeof shape === 'object')
    .map((shape) => (typeof shape.d !== 'string' && typeof shape.path === 'string' ? { ...shape, d: shape.path } : shape))
    .map((shape) => (shape.fillRule == null && typeof shape.fill_rule === 'string' ? { ...shape, fillRule: shape.fill_rule } : shape))
    .slice(0, MAX_COUNT * 2)
}

const nearlySame = (a, b) =>
  a.d === b.d ||
  (Math.abs(a.aspect - b.aspect) < 0.02 &&
    a.textBox && b.textBox &&
    ['x', 'y', 'w', 'h'].every((k) => Math.abs(a.textBox[k] - b.textBox[k]) < 0.02) &&
    Math.abs(a.d.length - b.d.length) < a.d.length * 0.02)

// Validate, normalise and drop near duplicates. → { shapes, problems: [code] }
export function acceptCandidates(raw, kept = []) {
  const shapes = [...kept]
  const problems = []
  for (const candidate of raw) {
    const prepared = prepareShape({ name: candidate.name, d: candidate.d, fillRule: candidate.fillRule ?? 'nonzero' })
    if (!prepared.ok) {
      problems.push(prepared.code)
      continue
    }
    if (shapes.some((shape) => nearlySame(shape, prepared.shape))) {
      problems.push('duplicate')
      continue
    }
    shapes.push(prepared.shape)
  }
  return { shapes: shapes.slice(kept.length), problems }
}

export function cacheKey({ describe, count, model, scope }) {
  return createHash('sha256').update(JSON.stringify([describe.toLowerCase(), count, model || '', scope || ''])).digest('hex')
}

export class ShapeProblem extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

/**
 * Draw shapes for a description.
 * deps: {
 *   request({ system, prompts, functions, function_call }) -> req() response   (the model call)
 *   request(options, principal)  the model call; run(fn, principal) runs fn inside the metered
 *   AI action (runAIAction feature 'shape'); cache?: { get(key), put(doc) } (ShapeGenerations);
 *   model?: string | (principal) => string, the model that will serve (cache key only)
 *   newId(), now()
 * }
 * → { requestId, candidates: [{ candidateId, name, d, fillRule, aspect, textBox }], cached, charged }
 */
export async function generateShapes({ principal, describe, count = DEFAULT_COUNT, fresh = false }, deps) {
  if (!principal?.userId || principal.isAnonymous) throw new ShapeProblem('sign_in', 'Sign in to draw shapes with AI.', 401)
  const text = cleanDescribe(describe)
  if (!text) throw new ShapeProblem('invalid_request', `Describe the shape in 1 to ${MAX_DESCRIBE} characters.`)
  const wanted = Math.max(1, Math.min(MAX_COUNT, Number.isInteger(count) ? count : DEFAULT_COUNT))
  const scope = principal.teamId ? `team:${principal.teamId}` : `user:${principal.userId}`
  const model = typeof deps.model === 'function' ? await deps.model(principal) : deps.model ?? null
  const key = cacheKey({ describe: text, count: wanted, model, scope })
  const now = deps.now ? deps.now() : new Date()

  if (!fresh && deps.cache) {
    const hit = await deps.cache.get(key)
    if (hit?.candidates?.length) {
      return { requestId: hit._id, candidates: hit.candidates, cached: true, charged: false }
    }
  }
  // Only a new drawing counts toward the hourly limit (a cached answer is free).
  if (deps.allowDrawing && !(await deps.allowDrawing(principal))) throw new ShapeProblem('rate_limited', RATE_LIMITED_MESSAGE, 429)

  const shapes = await deps.run(async () => {
    const ask = async (missing, problems) => {
      const prompts = [shapeUserPrompt(text)]
      if (problems) {
        prompts.push({
          role: 'user',
          content: [{ type: 'text', text: promptText('shape.retry', { problems: [...new Set(problems)].join(', '), missing }) }],
        })
      }
      const response = await deps.request({
        system: shapeSystemPrompt(missing),
        prompts,
        functions: [shapeTool()],
        function_call: { name: SHAPE_TOOL.name },
      }, principal)
      if (response?.abort) throw new ShapeProblem('shape_unavailable', response.abortMessage || UNAVAILABLE_MESSAGE, 422)
      return readCandidates(response)
    }
    const first = acceptCandidates(await ask(wanted))
    let kept = first.shapes.slice(0, wanted)
    if (kept.length < wanted) {
      // One retry for the missing ones, naming what was wrong.
      const missing = wanted - kept.length
      const second = acceptCandidates(await ask(missing, first.problems.length ? first.problems : ['too_few']), kept)
      kept = [...kept, ...second.shapes].slice(0, wanted)
    }
    if (!kept.length) throw new ShapeProblem('shape_unavailable', UNAVAILABLE_MESSAGE, 422)
    return kept
  }, principal)

  const requestId = deps.newId()
  const candidates = shapes.map((shape) => ({ candidateId: deps.newId(), ...shape }))
  if (deps.cache) {
    await deps.cache.put({
      _id: requestId,
      key,
      userId: principal.userId,
      teamId: principal.teamId ?? null,
      describe: text,
      count: wanted,
      model,
      candidates,
      createdAt: now,
    })
  }
  return { requestId, candidates, cached: false, charged: true }
}
