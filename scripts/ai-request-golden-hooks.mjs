// Module hooks for scripts/ai-request-golden.mjs: load a Meteor server file (workshops.js,
// canvas-conversation.js) under plain node with every Meteor-bound import replaced by a stub, so
// the request it sends to req() can be recorded. Pure .mjs modules and the engine stay real: the
// prompts and tool schemas they hold are what the golden pins.
//
// A stubbed import gets the names its importer asks for (read from the importer's import line);
// their values come from globalThis.__aiGoldenStubs[key] at evaluation time, where key is
// `meteor/<pkg>` or the file's path under web/app without its extension.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

let appRoot = null
let targets = []
// Real .mjs modules that reach Meteor, the database or the whole action registry: stubbed too.
const STUBBED_MJS = [
  'server/metering/context.mjs', 'server/metering/refusal-pay.mjs', 'server/actions/index.mjs', 'server/actions/client-render.mjs',
  'server/exec/conversation.mjs', 'server/workshop-move-log.mjs', 'server/methods/ai/exec-chat.mjs',
]

export async function initialize(data) {
  appRoot = data.appRoot.replace(/\/+$/, '') + '/'
  targets = data.targets.map((t) => appRoot + t)
}

function namesImported(parentURL, specifier) {
  let source = ''
  try { source = readFileSync(fileURLToPath(parentURL), 'utf8') } catch { return { def: false, names: [] } }
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const names = new Set()
  let def = false
  const re = new RegExp(`import\\s+([^'"\`;]*?)\\s+from\\s+['"]${escaped}['"]`, 'g')
  for (const match of source.matchAll(re)) {
    const clause = match[1]
    const braces = /\{([^}]*)\}/.exec(clause)
    if (braces) {
      for (const part of braces[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim()
        if (name) names.add(name)
      }
    }
    const head = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim()
    if (head && !head.startsWith('*')) def = true
    if (head.startsWith('*')) def = true
  }
  return { def, names: [...names] }
}

const stubURL = (key, parentURL, specifier) => {
  const { def, names } = namesImported(parentURL, specifier)
  return `ai-golden-stub:${encodeURIComponent(key)}?names=${encodeURIComponent(names.join(','))}&def=${def ? 1 : 0}`
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('meteor/')) return { url: stubURL(specifier, context.parentURL, specifier), shortCircuit: true }
  if (appRoot && (specifier.startsWith('.') || specifier.startsWith('/')) && context.parentURL?.startsWith('file:')) {
    const base = new URL(specifier, context.parentURL)
    let path = fileURLToPath(base)
    if (!/\.(m?js|cjs|json)$/.test(path)) {
      for (const ext of ['.js', '.mjs', '/index.js']) if (existsSync(path + ext)) { path += ext; break }
    }
    // packages under the app (node_modules) load as they are
    if (path.startsWith(appRoot) && !path.slice(appRoot.length).startsWith('node_modules/')) {
      const rel = path.slice(appRoot.length)
      const isTarget = targets.includes(path)
      const stub = !isTarget && (/\.js$/.test(rel) || STUBBED_MJS.includes(rel))
      if (stub) return { url: stubURL(rel.replace(/\.(m?js)$/, ''), context.parentURL, specifier), shortCircuit: true }
      return { url: pathToFileURL(path).href, shortCircuit: true, ...(isTarget && { format: 'module' }) }
    }
  }
  return next(specifier, context)
}

export async function load(url, context, next) {
  if (url.startsWith('ai-golden-stub:')) {
    const parsed = new URL(url)
    const key = decodeURIComponent(parsed.pathname)
    const names = (parsed.searchParams.get('names') || '').split(',').filter(Boolean)
    const lines = [`const s = globalThis.__aiGoldenStub(${JSON.stringify(key)})`]
    for (const name of names) lines.push(`export const ${name} = s[${JSON.stringify(name)}]`)
    if (parsed.searchParams.get('def') === '1') lines.push('export default (s.default ?? s)')
    return { format: 'module', source: lines.join('\n'), shortCircuit: true }
  }
  if (url.startsWith('file:') && targets.includes(fileURLToPath(url))) {
    return { format: 'module', source: readFileSync(fileURLToPath(url), 'utf8'), shortCircuit: true }
  }
  return next(url, context)
}
