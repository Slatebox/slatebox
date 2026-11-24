// The YAML the installer reads and writes: answers files, install records,
// compose files and Kubernetes manifests. It is a strict subset (block maps
// and lists, flow maps and lists, plain and quoted scalars, comments), so the
// package needs no dependency. Anything outside the subset is refused with
// its line number rather than guessed at. JSON is accepted as is.

class YamlError extends Error {
  constructor(message, line) {
    super(`YAML line ${line}: ${message}`)
    this.line = line
  }
}

// ---------------------------------------------------------------- reading

function stripComment(text) {
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (quote === '"' && c === '\\') { i++; continue }
      if (c === quote) {
        if (quote === "'" && text[i + 1] === "'") { i++; continue }
        quote = null
      }
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s,[{:]/.test(text[i - 1])) quote = c
    } else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i)
    }
  }
  return text
}

function scalar(raw, line) {
  const text = raw.trim()
  if (text === '' || text === '~' || text === 'null' || text === 'Null' || text === 'NULL') return null
  if (text === 'true' || text === 'True' || text === 'TRUE') return true
  if (text === 'false' || text === 'False' || text === 'FALSE') return false
  if (/^[-+]?(0|[1-9][0-9]*)$/.test(text)) return Number(text)
  if (/^[-+]?(0|[1-9][0-9]*)?\.[0-9]+([eE][-+]?[0-9]+)?$/.test(text) || /^[-+]?(0|[1-9][0-9]*)[eE][-+]?[0-9]+$/.test(text)) return Number(text)
  if (text.startsWith('"')) {
    try { return JSON.parse(text) } catch { throw new YamlError(`bad double-quoted string ${text}`, line) }
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) throw new YamlError(`unterminated single-quoted string ${text}`, line)
    const inner = text.slice(1, -1)
    if (/(^|[^'])'([^']|$)/.test(inner.replace(/''/g, ''))) throw new YamlError(`bad single-quoted string ${text}`, line)
    return inner.replace(/''/g, "'")
  }
  if (/^[|>]/.test(text)) throw new YamlError('block scalars (| and >) are not supported; use a quoted string', line)
  if (/^[&*!%@`]/.test(text)) throw new YamlError(`anchors, aliases, tags and reserved characters are not supported (${text})`, line)
  return text
}

// Flow collections: { a: b, c: [1, 2] } and [a, "b"].
function flow(text, line) {
  let i = 0
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++ }
  const fail = message => { throw new YamlError(message, line) }
  function quoted() {
    const q = text[i]
    let j = i + 1
    while (j < text.length) {
      if (q === '"' && text[j] === '\\') { j += 2; continue }
      if (text[j] === q) {
        if (q === "'" && text[j + 1] === "'") { j += 2; continue }
        break
      }
      j++
    }
    if (j >= text.length) fail('unterminated string')
    const raw = text.slice(i, j + 1)
    i = j + 1
    return scalar(raw, line)
  }
  function plain(stops) {
    const start = i
    while (i < text.length && !stops.includes(text[i])) {
      if (text[i] === ':' && stops.includes(':') && (i + 1 >= text.length || /[\s,}\]]/.test(text[i + 1]))) break
      i++
    }
    return text.slice(start, i)
  }
  function value(stops) {
    ws()
    if (text[i] === '{') return map()
    if (text[i] === '[') return list()
    if (text[i] === '"' || text[i] === "'") return quoted()
    return scalar(plain(stops), line)
  }
  function map() {
    i++
    const out = {}
    ws()
    if (text[i] === '}') { i++; return out }
    for (;;) {
      ws()
      const key = text[i] === '"' || text[i] === "'" ? String(quoted()) : plain([':', ',', '}']).trim()
      ws()
      if (text[i] !== ':') fail(`expected ":" after ${key} in a flow map`)
      i++
      out[key] = value([',', '}'])
      ws()
      if (text[i] === ',') { i++; continue }
      if (text[i] === '}') { i++; return out }
      fail('unterminated flow map')
    }
  }
  function list() {
    i++
    const out = []
    ws()
    if (text[i] === ']') { i++; return out }
    for (;;) {
      out.push(value([',', ']']))
      ws()
      if (text[i] === ',') { i++; continue }
      if (text[i] === ']') { i++; return out }
      fail('unterminated flow list')
    }
  }
  const result = value([])
  ws()
  if (i < text.length) fail(`unexpected text after a flow value: ${text.slice(i)}`)
  return result
}

function inlineValue(text, line) {
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) return flow(t, line)
  return scalar(t, line)
}

// "key: value" (the colon must be followed by a space or the end).
function splitKey(text, line) {
  let key, rest
  if (text.startsWith('"') || text.startsWith("'")) {
    const q = text[0]
    let j = 1
    while (j < text.length && text[j] !== q) j += q === '"' && text[j] === '\\' ? 2 : 1
    key = String(scalar(text.slice(0, j + 1), line))
    rest = text.slice(j + 1)
    if (!rest.startsWith(':')) return null
    rest = rest.slice(1)
  } else {
    const match = /^([^\s:#{}[\],][^:]*?|[^\s:#{}[\],]):(\s|$)/.exec(text)
    if (!match) return null
    key = match[1].trim()
    rest = text.slice(match[0].length - match[2].length)
  }
  if (rest && !/^\s/.test(rest)) return null
  return { key, rest: rest.trim() }
}

export function parse(source) {
  const text = String(source).replace(/^﻿/, '')
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed) } catch { /* flow YAML on one line: handled below */ }
  }
  const lines = []
  text.split(/\r?\n/).forEach((raw, index) => {
    if (/^\t/.test(raw)) throw new YamlError('tabs are not allowed for indentation', index + 1)
    const content = stripComment(raw).replace(/\s+$/, '')
    if (!content.trim() || content.trim() === '---') return
    lines.push({ indent: content.length - content.trimStart().length, text: content.trim(), line: index + 1 })
  })
  if (!lines.length) return null
  let pos = 0

  function block(indent) {
    const first = lines[pos]
    if (first.text === '-' || first.text.startsWith('- ')) return sequence(indent)
    return mapping(indent)
  }

  function nested(parentIndent, line) {
    const next = lines[pos]
    if (!next) return null
    if (next.indent > parentIndent) return block(next.indent)
    if (next.indent === parentIndent && (next.text === '-' || next.text.startsWith('- '))) return sequence(parentIndent)
    return null
  }

  function mapping(indent) {
    const out = {}
    while (pos < lines.length) {
      const entry = lines[pos]
      if (entry.indent < indent) break
      if (entry.indent > indent) throw new YamlError('unexpected indentation', entry.line)
      if (entry.text === '-' || entry.text.startsWith('- ')) break
      const kv = splitKey(entry.text, entry.line)
      if (!kv) throw new YamlError(`expected "key: value", found ${entry.text}`, entry.line)
      if (Object.hasOwn(out, kv.key)) throw new YamlError(`duplicate key ${kv.key}`, entry.line)
      pos++
      out[kv.key] = kv.rest === '' ? nested(indent, entry.line) : inlineValue(kv.rest, entry.line)
    }
    return out
  }

  function sequence(indent) {
    const out = []
    while (pos < lines.length) {
      const entry = lines[pos]
      if (entry.indent < indent) break
      if (entry.indent > indent) throw new YamlError('unexpected indentation', entry.line)
      if (!(entry.text === '-' || entry.text.startsWith('- '))) break
      const rest = entry.text === '-' ? '' : entry.text.slice(2).trim()
      const itemIndent = indent + 2 + (entry.text.slice(2).length - entry.text.slice(2).trimStart().length)
      if (rest === '') {
        pos++
        out.push(nested(indent, entry.line))
      } else if (!rest.startsWith('{') && !rest.startsWith('[') && splitKey(rest, entry.line)) {
        // "- key: value" opens a map whose further keys sit at the item's indent.
        lines[pos] = { indent: itemIndent, text: rest, line: entry.line }
        out.push(mapping(itemIndent))
      } else {
        pos++
        out.push(inlineValue(rest, entry.line))
      }
    }
    return out
  }

  const result = block(lines[0].indent)
  if (pos < lines.length) throw new YamlError('unexpected indentation', lines[pos].line)
  return result
}

// ---------------------------------------------------------------- writing

const PLAIN = /^[A-Za-z0-9_./][A-Za-z0-9_./:@+=,() -]*$/
const RESERVED = /^(~|null|true|false|yes|no|on|off|y|n)$/i

function needsQuotes(value) {
  if (value === '') return true
  if (!PLAIN.test(value)) return true
  if (RESERVED.test(value)) return true
  if (/^[-+]?(\.[0-9]|[0-9])/.test(value) && !Number.isNaN(Number(value.replace(/_/g, '')))) return true
  if (/^[-+]?[0-9]/.test(value) && /^[-+]?[0-9.eE+-]+$/.test(value)) return true
  if (/^0[0-9]/.test(value)) return true
  if (/: |:$| #|\s$/.test(value)) return true
  return false
}

function scalarText(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('cannot write a non-finite number')
    return String(value)
  }
  const text = String(value)
  return needsQuotes(text) ? JSON.stringify(text) : text
}

function keyText(key) {
  return /^[A-Za-z0-9_./-]+$/.test(key) && !RESERVED.test(key) && !/^[0-9]/.test(key) ? key : JSON.stringify(key)
}

const isObject = value => value && typeof value === 'object' && !Array.isArray(value)
const isEmpty = value => (Array.isArray(value) && !value.length) || (isObject(value) && !Object.keys(value).length)

function write(value, indent) {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    return value.map(item => {
      if (isObject(item) && !isEmpty(item)) {
        const body = write(item, indent + 2)
        return `${pad}- ${body.slice(indent + 2)}`
      }
      if (Array.isArray(item) && item.length) return `${pad}-\n${write(item, indent + 2)}`
      return `${pad}- ${isEmpty(item) ? (Array.isArray(item) ? '[]' : '{}') : scalarText(item)}`
    }).join('\n')
  }
  return Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => {
    if (isEmpty(item)) return `${pad}${keyText(key)}: ${Array.isArray(item) ? '[]' : '{}'}`
    if (isObject(item)) return `${pad}${keyText(key)}:\n${write(item, indent + 2)}`
    if (Array.isArray(item)) return `${pad}${keyText(key)}:\n${write(item, indent)}`
    return `${pad}${keyText(key)}: ${scalarText(item)}`
  }).join('\n')
}

export function stringify(value) {
  if (!isObject(value) && !Array.isArray(value)) return `${scalarText(value)}\n`
  if (isEmpty(value)) return Array.isArray(value) ? '[]\n' : '{}\n'
  return `${write(value, 0)}\n`
}

export function stringifyAll(documents) {
  return documents.map(stringify).join('---\n')
}
