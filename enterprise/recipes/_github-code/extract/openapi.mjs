// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// OpenAPI 3 and Swagger 2 (YAML or JSON): every path × method an endpoint, grouped by its first
// tag (else the path's first part), with the line its path is written on.
import { parseYaml } from '../yaml.mjs'

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']

export const match = (path) => /\.(ya?ml|json)$/i.test(path) && /(openapi|swagger|api)/i.test(path)

export function extract(path, text) {
  if (!/["']?(openapi|swagger)["']?\s*:/.test(text.slice(0, 4000))) return {}
  let doc = null
  if (path.endsWith('.json')) {
    try {
      doc = JSON.parse(text)
    } catch {
      return {}
    }
  } else doc = parseYaml(text)
  if (!doc || typeof doc.paths !== 'object' || !doc.paths) return {}
  const lines = text.split('\n')
  const lineOf = (route) => {
    const k = lines.findIndex((l) => l.trim().replace(/^["']|["']?\s*:\s*\{?$/g, '') === route || l.trim().startsWith(`${route}:`) || l.includes(`"${route}"`))
    return k >= 0 ? k + 1 : null
  }
  const endpoints = []
  for (const [route, item] of Object.entries(doc.paths)) {
    if (!item || typeof item !== 'object') continue
    for (const method of METHODS) {
      const op = item[method]
      if (!op || typeof op !== 'object') continue
      const tag = Array.isArray(op.tags) && op.tags.length ? `${op.tags[0]}` : route.split('/').filter(Boolean)[0] || 'root'
      endpoints.push({ method: method.toUpperCase(), path: route, group: tag, file: path, line: lineOf(route), source: 'openapi', summary: typeof op.summary === 'string' ? op.summary.slice(0, 120) : null })
    }
  }
  return { endpoints, api: { title: `${doc.info?.title ?? ''}`.slice(0, 120) || null } }
}
