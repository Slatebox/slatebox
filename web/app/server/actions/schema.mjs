// The subset of JSON Schema the action registry uses. One schema serves three readers:
// the registry (validation), the OpenAPI document and the generated tool contract.
// A property marked 'x-validated-by': 'handler' is documented here and checked by the
// action's own core (the canvas and workshop vocabularies, which live in the engine).

const typeOf = (value) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

const matchesType = (value, type) => {
  const actual = typeOf(value)
  if (type === 'number') return actual === 'number' || actual === 'integer'
  return actual === type
}

const label = (path) => path || 'input'
const describe = (value) => JSON.stringify(value)

// A field is declared only by the schema's own properties. A plain lookup would also find
// Object.prototype members, so `constructor` or `toString` would pass as declared fields.
export const declaredProperty = (schema, key) =>
  schema?.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined

export function resolveRef(schema, components) {
  if (!schema?.$ref) return schema
  const name = schema.$ref.replace('#/components/schemas/', '')
  const target = components?.[name]
  if (!target) throw new Error('Unknown schema reference ' + schema.$ref)
  return resolveRef(target, components)
}

// Returns the first problem as {path, message}, or null when the value is valid.
export function validate(schema, value, components = {}, path = '') {
  if (!schema || schema['x-validated-by'] === 'handler') return null
  const s = resolveRef(schema, components)
  if (s.const !== undefined && value !== s.const)
    return { path, message: `${label(path)} must be ${describe(s.const)}.` }
  if (s.enum && !s.enum.includes(value))
    return {
      path,
      message: `${label(path)} must be one of ${s.enum.map(describe).join(', ')}.`,
    }
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type]
    if (!types.some((type) => matchesType(value, type)))
      return { path, message: `${label(path)} must be ${types.join(' or ')}.` }
  }
  if (typeof value === 'string') {
    if (s.minLength !== undefined && value.length < s.minLength)
      return { path, message: `${label(path)} must have at least ${s.minLength} characters.` }
    if (s.maxLength !== undefined && value.length > s.maxLength)
      return { path, message: `${label(path)} must have at most ${s.maxLength} characters.` }
    if (s.pattern && !new RegExp(s.pattern, 'u').test(value))
      return { path, message: `${label(path)} has characters that are not allowed.` }
  }
  if (typeof value === 'number') {
    if (s.minimum !== undefined && value < s.minimum)
      return { path, message: `${label(path)} must be at least ${s.minimum}.` }
    if (s.maximum !== undefined && value > s.maximum)
      return { path, message: `${label(path)} must be at most ${s.maximum}.` }
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems)
      return { path, message: `${label(path)} must have at least ${s.minItems} items.` }
    if (s.maxItems !== undefined && value.length > s.maxItems)
      return { path, message: `${label(path)} must have at most ${s.maxItems} items.` }
    if (s.uniqueItems && new Set(value.map(describe)).size !== value.length)
      return { path, message: `${label(path)} must not repeat an item.` }
    if (s.items) {
      for (let index = 0; index < value.length; index += 1) {
        const found = validate(s.items, value[index], components, `${path}[${index}]`)
        if (found) return found
      }
    }
  }
  if (typeOf(value) === 'object') {
    for (const key of s.required || []) {
      if (!Object.hasOwn(value, key) || value[key] === undefined)
        return {
          path: path ? `${path}.${key}` : key,
          message: `${path ? `${path}.${key}` : key} is required.`,
        }
    }
    for (const [key, item] of Object.entries(value)) {
      const where = path ? `${path}.${key}` : key
      const declared = declaredProperty(s, key)
      if (declared) {
        if (item === undefined) continue
        const found = validate(declared, item, components, where)
        if (found) return found
      } else if (s.additionalProperties === false) {
        return { path: where, message: `${where} is not a field this request accepts.` }
      } else if (typeof s.additionalProperties === 'object') {
        const found = validate(s.additionalProperties, item, components, where)
        if (found) return found
      }
    }
  }
  if (s.oneOf) {
    const passing = s.oneOf.filter((option) => !validate(option, value, components, path))
    if (passing.length !== 1) {
      const first = s.oneOf
        .map((option) => validate(option, value, components, path))
        .find(Boolean)
      return passing.length
        ? { path, message: `${label(path)} matches more than one accepted form.` }
        : first || { path, message: `${label(path)} is not an accepted form.` }
    }
  }
  return null
}

// A self-contained copy with every $ref replaced, for readers that take one schema
// (MCP inputSchema and outputSchema). Registry-only keys stay: they are 'x-' extensions.
export function inlineRefs(schema, components, seen = new Set()) {
  if (Array.isArray(schema)) return schema.map((item) => inlineRefs(item, components, seen))
  if (!schema || typeof schema !== 'object') return schema
  if (schema.$ref) {
    if (seen.has(schema.$ref)) throw new Error('Recursive schema ' + schema.$ref)
    const next = new Set(seen).add(schema.$ref)
    return inlineRefs(resolveRef(schema, components), components, next)
  }
  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, inlineRefs(value, components, seen)])
  )
}
