// The prompt template language: `{{name}}` puts a variable in, `{{#flag}}...{{/flag}}` keeps its
// text only when the flag is set, `{{^flag}}...{{/flag}}` only when it is not. Nothing else: no
// loops, no expressions, no helpers, so a prompt an administrator edits cannot run anything.
// Text that is not one of those tags (JSON braces, `{{ "a": 1 }}`) is left as it is.
//
// Every variable a version uses is declared, with what it is and where it comes from:
//   { type: 'string' | 'integer' | 'number' | 'boolean', required?, source: 'server' | 'user' |
//     'slate' | 'outside', untrusted?, maxLength?, wrap?: 'none' | 'data' }
// A value is checked against its declaration when the prompt is rendered. Text longer than
// maxLength is cut to it. wrap 'data' encloses the value in <data name="x">...</data> and breaks
// any `</data` inside it, so text from a person, a slate or an outside service reads as data, not
// as instructions; 'none' (the default, and what every prompt moved out of code keeps) puts the
// value in as it is, so the rendered text stays byte-identical to the code it came from.
// Pure: no Meteor, no dependency.

export class PromptVarsError extends Error {
  constructor(message, problems = []) {
    super(message)
    this.name = 'PromptVarsError'
    this.problems = problems
  }
}

export class TemplateError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TemplateError'
  }
}

export const VARIABLE_TYPES = Object.freeze(['string', 'integer', 'number', 'boolean'])
export const VARIABLE_SOURCES = Object.freeze(['server', 'user', 'slate', 'outside'])
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const TAG = /\{\{\s*([#^/]?)\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g

/** Parses a body into text, variable and section nodes. Throws TemplateError on an unclosed or crossed section. */
export function parseTemplate(body) {
  if (typeof body !== 'string') throw new TemplateError('A prompt body is text.')
  const root = { children: [] }
  const stack = [root]
  let at = 0
  for (const match of body.matchAll(TAG)) {
    const [whole, sigil, name] = match
    if (match.index > at) stack.at(-1).children.push({ kind: 'text', text: body.slice(at, match.index) })
    at = match.index + whole.length
    if (sigil === '#' || sigil === '^') {
      const node = { kind: 'section', name, inverted: sigil === '^', children: [] }
      stack.at(-1).children.push(node)
      stack.push(node)
    } else if (sigil === '/') {
      const open = stack.at(-1)
      if (stack.length === 1 || open.name !== name) throw new TemplateError(`{{/${name}}} closes a section that is not open.`)
      stack.pop()
    } else {
      stack.at(-1).children.push({ kind: 'var', name })
    }
  }
  if (stack.length > 1) throw new TemplateError(`{{#${stack.at(-1).name}}} is never closed.`)
  if (at < body.length) root.children.push({ kind: 'text', text: body.slice(at) })
  return root.children
}

/** The variable and section names a body uses (for lint and publish checks). */
export function templateNames(body) {
  const vars = new Set()
  const sections = new Set()
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.kind === 'var') vars.add(node.name)
      else if (node.kind === 'section') {
        sections.add(node.name)
        walk(node.children)
      }
    }
  }
  walk(parseTemplate(body))
  return { vars: [...vars], sections: [...sections], all: [...new Set([...vars, ...sections])] }
}

/** Checks a variables declaration. → a list of problems (empty when it is fine). */
export function checkVariables(variables) {
  const problems = []
  if (variables == null) return problems
  if (typeof variables !== 'object' || Array.isArray(variables)) return ['variables is an object of name: declaration.']
  for (const [name, decl] of Object.entries(variables)) {
    if (!NAME.test(name)) problems.push(`${name} is not a variable name (letters, digits and _).`)
    if (!decl || typeof decl !== 'object') {
      problems.push(`${name} needs a declaration.`)
      continue
    }
    if (!VARIABLE_TYPES.includes(decl.type)) problems.push(`${name}: type is ${VARIABLE_TYPES.join(', ')}.`)
    if (decl.source !== undefined && !VARIABLE_SOURCES.includes(decl.source)) problems.push(`${name}: source is ${VARIABLE_SOURCES.join(', ')}.`)
    if (decl.maxLength !== undefined && !(Number.isInteger(decl.maxLength) && decl.maxLength > 0)) problems.push(`${name}: maxLength is a whole number above 0.`)
    if (decl.wrap !== undefined && !['none', 'data'].includes(decl.wrap)) problems.push(`${name}: wrap is none or data.`)
  }
  return problems
}

const truthy = (value) => value === true || (typeof value === 'number' && value !== 0 && !Number.isNaN(value)) || (typeof value === 'string' && value.length > 0)

function checkValue(name, decl, value, problems) {
  if (value === undefined || value === null) {
    if (decl.required) problems.push(`${name} is required.`)
    return undefined
  }
  switch (decl.type) {
    case 'string':
      if (typeof value !== 'string') problems.push(`${name} is text.`)
      break
    case 'integer':
      if (!Number.isInteger(value)) problems.push(`${name} is a whole number.`)
      break
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) problems.push(`${name} is a number.`)
      break
    case 'boolean':
      if (typeof value !== 'boolean') problems.push(`${name} is true or false.`)
      break
    default:
  }
  return value
}

// Text from a person, a slate or an outside service, enclosed as data: a `</data` inside it cannot
// close the block early.
export function wrapData(name, text) {
  return `<data name="${name}">${String(text).replace(/<\/(data)/gi, '<\\/$1')}</data>`
}

function valueText(decl, value) {
  if (value === undefined || value === null) return ''
  let text = String(value)
  if (decl?.maxLength && text.length > decl.maxLength) text = text.slice(0, decl.maxLength)
  return decl?.wrap === 'data' ? wrapData(decl.name, text) : text
}

/**
 * Renders a body with values. variables: the declaration (null = the values are taken as given,
 * for code text with no declaration yet). Throws PromptVarsError naming every problem: a name the
 * body uses that is not declared, a required value missing, a value of the wrong type.
 */
export function renderTemplate(body, values = {}, variables = null) {
  const nodes = parseTemplate(body)
  const problems = []
  const declared = variables ? Object.fromEntries(Object.entries(variables).map(([name, decl]) => [name, { ...decl, name }])) : null
  if (declared) {
    for (const name of templateNames(body).all) if (!declared[name]) problems.push(`{{${name}}} is not declared.`)
    for (const [name, decl] of Object.entries(declared)) checkValue(name, decl, values?.[name], problems)
  }
  if (problems.length) throw new PromptVarsError(`The prompt cannot be rendered: ${problems.join(' ')}`, problems)
  const out = []
  const walk = (list) => {
    for (const node of list) {
      if (node.kind === 'text') out.push(node.text)
      else if (node.kind === 'var') out.push(valueText(declared?.[node.name], values?.[node.name]))
      else if (truthy(values?.[node.name]) !== node.inverted) walk(node.children)
    }
  }
  walk(nodes)
  return out.join('')
}

/**
 * Renders a resolved prompt (resolve.mjs: { id, version, body, variables }) with values.
 * Throws PromptVarsError; the caller retries once with the prompt's built-in text (spec 2.3).
 */
export function renderPrompt(resolvedPrompt, values = {}) {
  if (!resolvedPrompt || typeof resolvedPrompt.body !== 'string') throw new PromptVarsError('There is no prompt to render.')
  return renderTemplate(resolvedPrompt.body, values, resolvedPrompt.variables || null)
}

/**
 * For moving a prompt out of code: the single-brace placeholders it used ({intentionsAvailable})
 * become template variables ({{intentionsAvailable}}). Only the names given are converted, so JSON
 * examples in the text stay as they are.
 */
export function convertSingleBraces(text, names) {
  let out = text
  for (const name of names) {
    if (!NAME.test(name)) throw new TemplateError(`${name} is not a variable name.`)
    out = out.replace(new RegExp(`(^|[^{])\\{${name}\\}(?!\\})`, 'g'), `$1{{${name}}}`)
  }
  return out
}
