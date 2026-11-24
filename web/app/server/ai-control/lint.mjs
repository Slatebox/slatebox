// Lint for prompt text an administrator (or an agent's suggestion) writes (spec 6.4). Prompt text is
// trusted once published, so what reaches a model is checked before it can be:
// blocking (a publish is refused, whoever asks):
//   - a body that does not parse, or is over 32 KB;
//   - {{name}} the built-in version does not declare (the code supplies only those values), and a
//     declared required variable missing from the body;
//   - all-caps placeholder tokens (AGENTS.md: they leak into what people see and what models read);
//   - a leftover single-brace {name} placeholder;
//   - text that looks like a key or a credential;
//   - a tool description over its budget (1000 characters);
//   - words that ask a model to reveal tokens or keys, or to call AI control or token actions.
// warnings (shown, not blocking):
//   - a declared variable the body no longer uses;
//   - an untrusted value outside a data block (wrap none), the exposure every prompt moved from code
//     still has until it is switched to wrap 'data'.
// Pure: no Meteor.
import { parseTemplate, templateNames } from './render.mjs'

export const MAX_BODY = 32 * 1024
export const TOOL_DESCRIPTION_MAX = 1000
// all-caps words that are names, not placeholders
export const CAPS_ALLOWED = Object.freeze(['JSON', 'SVG', 'API', 'URL', 'HTTP', 'HTTPS', 'MCP', 'CSV', 'PDF', 'PNG', 'HTML', 'CSS', 'AI', 'ID', 'IDS', 'UTC', 'MIT', 'USD'])
const CAPS = /\b[A-Z]{3,}(?: [A-Z]{3,})+\b/g
const SINGLE_BRACE = /(^|[^{])\{([A-Za-z_][A-Za-z0-9_]*)\}(?!\})/g
const SECRETS = [
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sbx|slb)_[A-Za-z0-9]{24,}/,
]
const EXFILTRATION = [
  /\b(reveal|print|show|send|repeat|leak|output)\b[^.\n]{0,60}\b(api[ _-]?keys?|tokens?|secrets?|passwords?|credentials?|system prompt)\b/i,
  /\b(ai\.(control|providers|connections|models|bindings|prompts|agents|audit)\.|api_tokens\.)/i,
]

/**
 * prompt: { id, kind, body, variables }; codeVariables: the built-in version's declaration (what
 * the call site supplies). → { blocking: [sentence], warnings: [sentence] }
 */
export function lintPrompt({ kind, body, variables = {} } = {}, { codeVariables = null } = {}) {
  const blocking = []
  const warnings = []
  if (typeof body !== 'string' || !body.trim()) return { blocking: ['The text is empty.'], warnings }
  if (body.length > MAX_BODY) blocking.push(`The text is ${body.length} characters; at most ${MAX_BODY}.`)
  let names = null
  try {
    parseTemplate(body)
    names = templateNames(body)
  } catch (error) {
    blocking.push(error.message)
  }
  const declared = variables || {}
  const supplied = codeVariables || declared
  if (names) {
    for (const name of names.all) {
      if (!supplied[name]) blocking.push(`{{${name}}} is not a value this part of Slatebox gives. It can use: ${Object.keys(supplied).map((n) => `{{${n}}}`).join(', ') || 'none'}.`)
      else if (!declared[name]) blocking.push(`{{${name}}} is not declared.`)
    }
    for (const [name, decl] of Object.entries(declared)) {
      if (names.all.includes(name)) continue
      if (decl?.required) blocking.push(`{{${name}}} is required but the text does not use it.`)
      else warnings.push(`{{${name}}} is declared but the text does not use it.`)
    }
  }
  if (codeVariables) {
    for (const [name, decl] of Object.entries(declared)) {
      const code = codeVariables[name]
      if (!code) continue
      if (decl?.type !== code.type) blocking.push(`{{${name}}} is ${code.type}, as the code gives it.`)
      if (decl?.required && !code.required) blocking.push(`{{${name}}} cannot be required: the code does not always give it.`)
    }
  }
  const caps = [...body.replace(/\{\{[^}]*\}\}/g, ' ').matchAll(CAPS)].map((m) => m[0]).filter((run) => run.split(' ').some((word) => !CAPS_ALLOWED.includes(word)))
  if (caps.length) blocking.push(`All-caps placeholder words leak into what people and models read: ${[...new Set(caps)].slice(0, 3).map((c) => `"${c}"`).join(', ')}. Write them in lowercase prose.`)
  const braces = [...body.matchAll(SINGLE_BRACE)].map((m) => `{${m[2]}}`)
  if (braces.length) blocking.push(`${[...new Set(braces)].slice(0, 3).join(', ')} is a single-brace placeholder; values go in as {{name}}.`)
  if (SECRETS.some((re) => re.test(body))) blocking.push('The text holds something that looks like a key or a credential. Prompts are not a place for secrets.')
  if (EXFILTRATION.some((re) => re.test(body))) blocking.push('The text asks for keys, tokens or the instructions themselves, or names AI control or token actions. A prompt never grants that.')
  if (kind === 'tool-description' && body.length > TOOL_DESCRIPTION_MAX) blocking.push(`A tool description is at most ${TOOL_DESCRIPTION_MAX} characters; this one is ${body.length}.`)
  for (const [name, decl] of Object.entries(declared)) {
    if (decl?.untrusted && decl.wrap !== 'data' && names?.all.includes(name)) warnings.push(`{{${name}}} is text from a person, a slate or an outside service, put in as it is. Wrapping it as data (wrap: data) keeps it from reading as instructions.`)
  }
  return { blocking: [...new Set(blocking)], warnings: [...new Set(warnings)] }
}
