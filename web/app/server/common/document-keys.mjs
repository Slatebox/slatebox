// Keys a caller may not put in a method argument, a publication argument or a stored document.
//
// A key that starts with "$" is a Mongo operator: in a selector it turns a lookup by value into a
// search ({ shareId: { $regex: '^a' } }), and in a stored document it is published to browsers
// whose minimongo throws on it ("Key $gt must not start with '$'"), after which their logins and
// method callbacks stop answering. A key that contains "." or a NUL is refused by minimongo the
// same way. No browser can send such a key on purpose, because none could have stored or
// received one.
const MAX_DEPTH = 64

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export const isUnsafeKey = (key) => key.startsWith('$') || key.includes('.') || key.includes('\0')

// The path of the first unsafe key in a value, or null when there is none. Too deep a value is
// refused as well.
export function unsafeKeyPath(value, path = '', depth = 0) {
  if (depth > MAX_DEPTH) return `${path || '(value)'} (nested too deeply)`
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = unsafeKeyPath(value[i], `${path}[${i}]`, depth + 1)
      if (found) return found
    }
    return null
  }
  if (!isPlainObject(value)) return null
  for (const key of Object.keys(value)) {
    const here = path ? `${path}.${key}` : key
    if (isUnsafeKey(key)) return here
    const found = unsafeKeyPath(value[key], here, depth + 1)
    if (found) return found
  }
  return null
}

// A Mongo modifier from a browser ({ $set: { 'options.name': value } }): its operators and dotted
// paths are the modifier's own syntax; only the values it writes are checked.
export function unsafeModifierPath(modifier) {
  if (!isPlainObject(modifier)) return unsafeKeyPath(modifier)
  for (const [operator, fields] of Object.entries(modifier)) {
    if (!operator.startsWith('$')) return unsafeKeyPath(modifier)
    if (!isPlainObject(fields)) continue
    for (const [field, value] of Object.entries(fields)) {
      if (field.includes('\0') || field.split('.').some((part) => part.startsWith('$') && part !== '$' && part !== '$[]')) return `${operator}.${field}`
      const found = unsafeKeyPath(value, `${operator}.${field}`)
      if (found) return found
    }
  }
  return null
}

// Wraps every handler in a Meteor method or publication table so a call whose arguments carry an
// unsafe key is refused before the handler runs. Collection mutators ("/slates/update" and the
// like) take modifiers and are checked by deny rules instead; the dynamic-import method takes
// module file names as keys.
const WRAPPED = Symbol.for('slatebox.argumentGuard')
export function guardHandlers(handlers, { refuse, skip = () => false, log = () => {} }) {
  for (const name of Object.keys(handlers)) {
    const handler = handlers[name]
    if (typeof handler !== 'function' || handler[WRAPPED] || skip(name)) continue
    const guarded = function guardedHandler(...args) {
      const found = unsafeKeyPath(args)
      if (found) {
        log(name, found)
        throw refuse(name, found)
      }
      return handler.apply(this, args)
    }
    guarded[WRAPPED] = true
    handlers[name] = guarded
  }
}

export const skipsArgumentGuard = (name) => name.startsWith('/') || name === '__dynamicImport'
