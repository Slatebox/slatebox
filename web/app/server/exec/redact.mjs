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

// ---------- text that may carry a key: provider error bodies, logged URLs (spec 6.2) ----------
// A provider's error body is untrusted: it may echo the key or the headers it was sent. Before an
// error is stored (lastCheck, aiAudit) or returned (Test connection, a test run), every URL loses
// its query string (a provider whose key goes in the query would otherwise log it), every value
// that looks like a key is replaced, and the text is cut to 500 characters.
const URL_QUERY = /(\bhttps?:\/\/[^\s"'<>?#]+)\?[^\s"'<>#]*/gi
// [pattern, replacement]: a scheme or a field name before the value is kept, the value is not
const KEY_VALUES = [
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, REDACTED],
  [/\b(Bearer|Token|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  [/\b((?:api[_-]?key|key|token|secret|password|authorization|x-api-key)["']?\s*[:=]\s*["']?)[^\s"'&,;}]{6,}/gi, `$1${REDACTED}`],
  // a long run of base64 or hex (a slash ends a run, so a model path such as Qwen/Qwen3-… stays)
  [/\b[A-Za-z0-9+_-]{32,}={0,2}(?![A-Za-z0-9+_=-])/g, REDACTED],
]

/** A URL without its query string or fragment (or the text unchanged when it is no URL). */
export function stripQuery(url) {
  if (typeof url !== 'string') return url
  return url.replace(URL_QUERY, '$1').replace(/#.*$/, '')
}

/**
 * Text fit to store or show: no query strings, no key-like values (and none of the given keys,
 * wherever they appear), at most max characters.
 */
export function redactText(text, { keys = [], max = 500 } = {}) {
  let out = String(text ?? '')
  for (const key of keys) if (typeof key === 'string' && key.length >= 4) out = out.split(key).join(REDACTED)
  out = out.replace(URL_QUERY, '$1')
  for (const [rule, replacement] of KEY_VALUES) out = out.replace(rule, replacement)
  return out.length > max ? out.slice(0, max) : out
}
