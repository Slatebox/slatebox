// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Protocol buffers: each rpc of each service is an endpoint (RPC Service.Method).
import { lineAt } from './paths.mjs'

export const match = (path) => path.endsWith('.proto')

export function extract(path, text) {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
  const endpoints = []
  for (const s of source.matchAll(/\bservice\s+(\w+)\s*\{/g)) {
    let depth = 1
    let end = s.index + s[0].length
    while (end < source.length && depth > 0) {
      if (source[end] === '{') depth += 1
      else if (source[end] === '}') depth -= 1
      end += 1
    }
    const body = source.slice(s.index + s[0].length, end)
    for (const r of body.matchAll(/\brpc\s+(\w+)\s*\(/g))
      endpoints.push({ method: 'RPC', path: `${s[1]}.${r[1]}`, group: s[1], file: path, line: lineAt(text, s.index + s[0].length + r.index), source: 'proto' })
  }
  return endpoints.length ? { endpoints } : {}
}
