// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The first place a value breaks a JSON Schema (the subset recipe schemas use: type, properties,
// required, additionalProperties, items, enum, pattern, min/max length, items and value), as a JSON
// pointer and a plain reason, so a developer's 400 says exactly where.

const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v)
const esc = (key) => String(key).replace(/~/g, '~0').replace(/\//g, '~1')

/** → null when the value fits, else { pointer, message }. */
export function schemaProblem(schema, value, pointer = '') {
  if (!schema || typeof schema !== 'object') return null
  const at = pointer || '/'
  const types = [].concat(schema.type || [])
  const k = kind(value)
  if (types.length && !types.some((t) => t === k || (t === 'number' && k === 'integer'))) return { pointer: at, message: `must be ${types.join(' or ')}` }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) return { pointer: at, message: `must be one of ${schema.enum.join(', ')}` }
  if (k === 'string') {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return { pointer: at, message: `must be at most ${schema.maxLength} characters` }
    if (schema.minLength !== undefined && value.length < schema.minLength) return { pointer: at, message: `must be at least ${schema.minLength} characters` }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return { pointer: at, message: 'is not in the expected form' }
  }
  if (k === 'integer' || k === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return { pointer: at, message: `must be at least ${schema.minimum}` }
    if (schema.maximum !== undefined && value > schema.maximum) return { pointer: at, message: `must be at most ${schema.maximum}` }
  }
  if (k === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) return { pointer: at, message: `must hold at least ${schema.minItems}` }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return { pointer: at, message: `must hold at most ${schema.maxItems}` }
    if (schema.items) for (let i = 0; i < value.length; i++) {
      const p = schemaProblem(schema.items, value[i], `${pointer}/${i}`)
      if (p) return p
    }
  }
  if (k === 'object') {
    for (const key of schema.required || []) if (value[key] === undefined) return { pointer: `${pointer}/${esc(key)}`, message: 'is required' }
    for (const [key, item] of Object.entries(value)) {
      const spec = schema.properties?.[key]
      if (spec) {
        const p = schemaProblem(spec, item, `${pointer}/${esc(key)}`)
        if (p) return p
      } else if (schema.additionalProperties === false) return { pointer: `${pointer}/${esc(key)}`, message: 'is not a known field' }
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        const p = schemaProblem(schema.additionalProperties, item, `${pointer}/${esc(key)}`)
        if (p) return p
      }
    }
  }
  return null
}
