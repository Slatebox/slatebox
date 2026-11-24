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
export const CAPS_ALLOWED = Object.freeze(['JSON', 'SVG', 'API', 'URL', 'HTTP', 'HTTPS', 'MCP', 'CSV', 'PDF', 'PNG', 'HTML', 'CSS', 'AI', 'ID', 'IDS', 'UTC', 'UTF', 'MIT', 'USD'])
// all-caps words a prompt may use for emphasis: they are instructions, not something to fill in
export const CAPS_EMPHASIS = Object.freeze(['NOT', 'NEVER', 'ALWAYS', 'ONLY', 'MUST', 'SHOULD', 'IMPORTANT', 'CRITICAL', 'REQUIRED', 'WARNING', 'NOTE', 'DO', 'DON', 'NO', 'YES', 'ALL', 'ANY', 'EACH', 'EVERY', 'NONE', 'ONE', 'EXACTLY', 'SHORT', 'BRIEF', 'STOP', 'NOW'])
// an all-caps token: one word, or words joined by _ or - (YOUR_TOPIC, INSERT-TOPIC-HERE)
const CAPS_TOKEN = /(?<![A-Za-z0-9_-])[A-Z][A-Z0-9]*(?:[_-][A-Z0-9]+)*(?![A-Za-z0-9_-])/g
const CAPS_RUN = /(?<![A-Za-z0-9_-])[A-Z][A-Z0-9]*(?:[_-][A-Z0-9]+)*(?: [A-Z][A-Z0-9]*(?:[_-][A-Z0-9]+)*)*(?![A-Za-z0-9_-])/g

/**
 * The all-caps placeholder tokens in a text (AGENTS.md: they leak into what people see and what
 * models read): any all-caps word of three or more letters that is not a name (CAPS_ALLOWED) or an
 * emphasis word (CAPS_EMPHASIS), and any all-caps words joined by _ or - (UTF-8, names and
 * numbers only, is a name). Values ({{name}}) are
 * not text. → [token], each once, in order
 */
export function capsPlaceholders(body) {
  const text = String(body ?? '').replace(/\{\{[^}]*\}\}/g, ' ')
  const found = []
  for (const [token] of text.matchAll(CAPS_TOKEN)) {
    const joined = /[_-]/.test(token)
    const letters = token.replace(/[^A-Z]/g, '').length
    if (!joined && (letters < 3 || CAPS_ALLOWED.includes(token) || CAPS_EMPHASIS.includes(token))) continue
    if (joined && (letters < 2 || token.split(/[_-]/).every((part) => /^[0-9]+$/.test(part) || CAPS_ALLOWED.includes(part)))) continue
    if (!found.includes(token)) found.push(token)
  }
  return found
}
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
  const caps = capsPlaceholders(body)
  if (caps.length) {
    // shown as written: neighbouring capital words together (REPLACE BY SHAPE NAME)
    const runs = [...body.replace(/\{\{[^}]*\}\}/g, ' ').matchAll(CAPS_RUN)].map((m) => m[0]).filter((run) => run.split(' ').some((word) => caps.includes(word)))
    blocking.push(`All-caps placeholder words leak into what people and models read: ${[...new Set(runs.length ? runs : caps)].slice(0, 3).map((c) => `"${c}"`).join(', ')}. Write them in lowercase prose.`)
  }
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
