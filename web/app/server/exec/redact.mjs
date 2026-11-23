// What a run's record keeps of its code. An input field an action marks writeOnly (an AI
// connection's apiKey) is a secret: the action stores it encrypted and never returns it, so the
// run's record must not keep it either. A typed MCP tool's call is an exec script of one call
// whose code carries its arguments as JSON (agent-surface.mjs typedExecArgs); that JSON is
// parsed and its secret fields replaced. In any other script a secret field written as a plain
// string literal (apiKey: "sk-...") is replaced too. codeSha256 is always taken of the code that
// ran, so a confirmation still matches; only the stored text is redacted.
import { resolveRef } from '../actions/schema.mjs'

export const REDACTED = '[redacted]'

// `return await slatebox.<method>(JSON.parse("<json>"));` exactly as typedExecArgs writes it.
const TYPED_CALL = /^return await slatebox\.([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+)\(JSON\.parse\(("(?:[^"\\]|\\.)*")\)\);$/

const BRANCHES = ['oneOf', 'anyOf', 'allOf']

// Every writeOnly field name a schema declares, at any depth.
function collectSecretNames(schema, components, names, seen = new Set()) {
  const s = resolveRef(schema, components)
  if (!s || typeof s !== 'object' || seen.has(s)) return names
  seen.add(s)
  for (const [name, field] of Object.entries(s.properties || {})) {
    if (resolveRef(field, components)?.writeOnly) names.add(name)
    collectSecretNames(field, components, names, seen)
  }
  if (s.items) collectSecretNames(s.items, components, names, seen)
  for (const branch of BRANCHES) for (const part of s[branch] || []) collectSecretNames(part, components, names, seen)
  return names
}

// A copy of value with every writeOnly field the schema declares replaced.
function redactValue(schema, value, components) {
  const s = resolveRef(schema, components)
  if (!s || typeof s !== 'object' || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return s.items ? value.map((item) => redactValue(s.items, item, components)) : value
  let out = value
  const parts = [s, ...BRANCHES.flatMap((branch) => s[branch] || [])]
  for (const part of parts) {
    const p = resolveRef(part, components)
    for (const [name, field] of Object.entries(p?.properties || {})) {
      if (!Object.hasOwn(out, name)) continue
      const f = resolveRef(field, components)
      const next = f?.writeOnly ? (typeof out[name] === 'string' && out[name] === '' ? '' : REDACTED) : redactValue(f, out[name], components)
      if (next !== out[name]) out = { ...out, [name]: next }
    }
  }
  return out
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The redactor for one registry: (code) -> the code as the run's record keeps it.
 * Methods are named as the client names them (the action id, such as ai.update).
 */
export function createCodeRedactor(registry) {
  const components = registry.components || {}
  const schemas = new Map()
  const names = new Set()
  for (const action of registry.list()) {
    const found = collectSecretNames(action.input, components, new Set())
    if (!found.size) continue
    schemas.set(action.id, action.input)
    found.forEach((name) => names.add(name))
  }
  // name: "..." / 'name': '...' / "name": `...` in a hand-written script.
  const literal = names.size
    ? new RegExp(`((?:^|[^A-Za-z0-9_$])(["'\`]?)(?:${[...names].map(escapeRegExp).join('|')})\\2\\s*:\\s*)(["'\`])(?:(?!\\3)[^\\\\]|\\\\.)+\\3`, 'g')
    : null

  return function redactCode(code) {
    if (!literal || typeof code !== 'string') return code
    const typed = TYPED_CALL.exec(code)
    if (typed && schemas.has(typed[1])) {
      try {
        const input = JSON.parse(JSON.parse(typed[2]))
        const redacted = redactValue(schemas.get(typed[1]), input, components)
        if (redacted !== input)
          return `return await slatebox.${typed[1]}(JSON.parse(${JSON.stringify(JSON.stringify(redacted))}));`
        return code
      } catch {
        // Not the typed shape after all: the literal pass below still applies.
      }
    }
    return code.replace(literal, (_, lead, _quote, open) => `${lead}${open}${REDACTED}${open}`)
  }
}
