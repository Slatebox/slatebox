// The prompt registry: every model-facing text Slatebox's own AI paths send, as a template with
// declared variables (render.mjs), kept in code as version 0 (spec 1.6: "Version 0 is the code").
// A call site asks for its text by id (promptText); the text comes from, highest first:
//   1. the prompt's published version in the database (aiPrompts labels.published),
//   2. version 0, the code text below.
// Without a source (tests, or before index.mjs set one) only version 0 is used.
//
// A published version that does not render (a value of the wrong type, a required one missing)
// is never shown to anyone: the code text is rendered instead and the fallback is reported (spec
// 2.3), once per version on this pod, so a hot path does not flood health; problem(id) says so
// while that version is the one served, so the Prompts tab names the built-in text as served. Version 0 renders the exact bytes the code sent before the prompts moved here
// (scripts/ai-prompts-golden.test.mjs).
//
// Pure: no Meteor, no database. index.mjs (Meteor) plugs in the snapshot as the source.
import { PromptVarsError, TemplateError, checkVariables, renderTemplate, templateNames } from '../render.mjs'
import { surface as surfaceById } from '../catalogue.mjs'

export const PROMPT_ID = /^[a-z0-9][a-z0-9_.-]{0,95}$/
export const PROMPT_SLOT = /^[a-z][a-zA-Z0-9]{0,31}$/
export const KINDS = Object.freeze(['system', 'user', 'retry', 'tool-description', 'mcp-instructions', 'mcp-prompt', 'envelope'])

/**
 * Checks and freezes a surface's prompts. Each row:
 *   { id, surface, kind, slot, title, body, variables?, note? }
 * slot: the name a binding uses for it (prompts: { [slot]: 'id@v' }), unique per surface.
 * Throws at load on a bad row, so a broken built-in prompt never ships.
 */
export function definePrompts(rows) {
  const out = []
  for (const row of rows) {
    if (!PROMPT_ID.test(row.id || '')) throw new Error(`ai-control prompts: bad id ${row.id}`)
    if (!surfaceById(row.surface)) throw new Error(`ai-control prompts: ${row.id} names surface ${row.surface}, which is not in the catalogue`)
    if (!KINDS.includes(row.kind)) throw new Error(`ai-control prompts: ${row.id} has kind ${row.kind}`)
    if (!PROMPT_SLOT.test(row.slot || '')) throw new Error(`ai-control prompts: ${row.id} needs a slot name`)
    if (typeof row.title !== 'string' || !row.title) throw new Error(`ai-control prompts: ${row.id} needs a title`)
    if (typeof row.body !== 'string' || !row.body) throw new Error(`ai-control prompts: ${row.id} needs a body`)
    const variables = row.variables || {}
    const problems = checkVariables(variables)
    if (problems.length) throw new Error(`ai-control prompts: ${row.id}: ${problems.join(' ')}`)
    const used = templateNames(row.body).all
    for (const name of used) if (!variables[name]) throw new Error(`ai-control prompts: ${row.id} uses {{${name}}} without declaring it`)
    for (const name of Object.keys(variables)) if (!used.includes(name)) throw new Error(`ai-control prompts: ${row.id} declares ${name} but never uses it`)
    out.push(Object.freeze({ id: row.id, surface: row.surface, kind: row.kind, slot: row.slot, title: row.title, body: row.body, variables: Object.freeze({ ...variables }), note: row.note ?? null }))
  }
  return Object.freeze(out)
}

/**
 * The registry over every surface's prompts. → {
 *   list, byId, ids(), codeSlots ({ [surface]: { slot: id } }), codePrompts ({ [id]: { body, variables } }),
 *   setSource(fn, { onFallback }), text(id, values), code(id, values), resolved(id), problem(id)
 * }
 * source(id) → { id, version, body, variables, source } | null: the text to use instead of the code
 * (a pinned or published version), or null for the code text.
 */
export function createPromptRegistry(groups) {
  const list = groups.flat()
  const byId = {}
  const slots = {}
  for (const prompt of list) {
    if (byId[prompt.id]) throw new Error(`ai-control prompts: ${prompt.id} is listed twice`)
    byId[prompt.id] = prompt
    slots[prompt.surface] ||= {}
    if (slots[prompt.surface][prompt.slot]) throw new Error(`ai-control prompts: ${prompt.surface} has two prompts in slot ${prompt.slot}`)
    slots[prompt.surface][prompt.slot] = prompt.id
  }
  const codePrompts = Object.freeze(Object.fromEntries(list.map((p) => [p.id, Object.freeze({ body: p.body, variables: p.variables })])))
  let source = null
  let onFallback = null
  // id → { version, message, at }: a published version that did not render on this pod
  const failures = new Map()

  const known = (id) => {
    const prompt = byId[id]
    if (!prompt) throw new Error(`ai-control prompts: there is no prompt ${id}`)
    return prompt
  }

  /** The code text (version 0) rendered with values. */
  const code = (id, values = {}) => {
    const prompt = known(id)
    return renderTemplate(prompt.body, values, prompt.variables)
  }

  /** Which version a call would use now: { id, version, body, variables, source }. */
  const resolved = (id) => {
    const prompt = known(id)
    let found = null
    try {
      found = source ? source(id) : null
    } catch (error) {
      onFallback?.({ id, version: null, error })
    }
    if (found && Number.isInteger(found.version) && found.version > 0 && typeof found.body === 'string') return found
    return { id, version: 0, body: prompt.body, variables: prompt.variables, source: 'code' }
  }

  /**
   * The text a call site sends: the pinned or published version when there is one, else the code
   * text. A published version that does not render falls back to the code text, once, reported.
   */
  const text = (id, values = {}) => {
    const use = resolved(id)
    if (use.version > 0) {
      try {
        return renderTemplate(use.body, values, use.variables ?? null)
      } catch (error) {
        if (!(error instanceof PromptVarsError || error instanceof TemplateError)) throw error
        if (failures.get(id)?.version !== use.version) {
          failures.set(id, { version: use.version, message: error.message, at: new Date() })
          try { onFallback?.({ id, version: use.version, error }) } catch {}
        }
      }
    }
    return code(id, values)
  }

  /**
   * Why a prompt is served from the built-in text although a version is published or pinned: that
   * version did not render here. → { version, message, at } | null (null once another is served)
   */
  const problem = (id) => {
    const failed = failures.get(id)
    if (!failed) return null
    return resolved(id).version === failed.version ? failed : null
  }

  return {
    list,
    byId,
    ids: () => Object.keys(byId),
    codeSlots: Object.freeze(Object.fromEntries(Object.entries(slots).map(([s, v]) => [s, Object.freeze({ ...v })]))),
    codePrompts,
    setSource(fn, options = {}) {
      source = typeof fn === 'function' ? fn : null
      failures.clear()
      onFallback = typeof options.onFallback === 'function' ? options.onFallback : null
    },
    text,
    code,
    resolved,
    problem,
  }
}
