// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// GraphQL SDL: the fields of Query, Mutation and Subscription (and extend type ...) are endpoints.
import { lineAt } from './paths.mjs'

export const match = (path) => /\.(graphqls?|gql)$/i.test(path)

const ROOTS = { Query: 'QUERY', Mutation: 'MUTATION', Subscription: 'SUBSCRIPTION' }

export function extract(path, text) {
  const source = text.replace(/#[^\n]*/g, (m) => ' '.repeat(m.length)).replace(/"""[\s\S]*?"""/g, (m) => m.replace(/[^\n]/g, ' '))
  const endpoints = []
  for (const m of source.matchAll(/(?:extend\s+)?type\s+(Query|Mutation|Subscription)\b[^{]*\{([^}]*)\}/g)) {
    const bodyStart = m.index + m[0].indexOf('{') + 1
    for (const f of m[2].matchAll(/^\s*(\w+)\s*[(:]/gm)) {
      endpoints.push({ method: ROOTS[m[1]], path: f[1], group: m[1], file: path, line: lineAt(text, bodyStart + f.index + f[0].indexOf(f[1])), source: 'graphql' })
    }
  }
  return endpoints.length ? { endpoints } : {}
}
