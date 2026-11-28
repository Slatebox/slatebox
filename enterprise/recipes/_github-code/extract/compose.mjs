// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// docker-compose*.yml: each service a node; depends_on, links and env values that name another
// service (FOO_HOST=api, DATABASE_URL=postgres://db:5432/x) its connections; the image its kind.
import { parseYaml } from '../yaml.mjs'
import { defaultProtocol, kindOf, protocolOf } from './kinds.mjs'

export const match = (path) => /(?:^|\/)(?:docker-)?compose(?:[.-][\w.-]+)?\.ya?ml$/i.test(path)

function envValues(environment) {
  if (Array.isArray(environment)) return environment.map((e) => `${e ?? ''}`).map((e) => [e.split('=')[0], e.includes('=') ? e.slice(e.indexOf('=') + 1) : ''])
  if (environment && typeof environment === 'object') return Object.entries(environment).map(([k, v]) => [k, `${v ?? ''}`])
  return []
}

/** The other services a value names: a host in a URL, host:port, or the whole value. */
function namedHosts(value, names) {
  const found = new Set()
  const text = `${value}`
  const url = text.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^:/?#,]+)/i)
  if (url && names.has(url[1])) found.add(url[1])
  for (const part of text.split(/[,\s]+/)) {
    const host = part.split(':')[0]
    if (names.has(host)) found.add(host)
  }
  return [...found]
}

export function extract(path, text) {
  const doc = parseYaml(text)
  const services = doc && typeof doc.services === 'object' && doc.services && !Array.isArray(doc.services) ? doc.services : {}
  const names = new Set(Object.keys(services))
  const out = []
  for (const [name, spec] of Object.entries(services)) {
    const s = spec && typeof spec === 'object' ? spec : {}
    const image = typeof s.image === 'string' ? s.image : ''
    const refs = new Map()
    const add = (to, protocol, via) => {
      if (to === name || !names.has(to)) return
      if (!refs.has(to) || (protocol && !refs.get(to).protocol)) refs.set(to, { to, protocol: protocol ?? null, via })
    }
    const deps = Array.isArray(s.depends_on) ? s.depends_on : s.depends_on && typeof s.depends_on === 'object' ? Object.keys(s.depends_on) : []
    for (const dep of deps) add(`${dep}`, null, 'depends_on')
    for (const link of Array.isArray(s.links) ? s.links : []) add(`${link}`.split(':')[0], null, 'links')
    for (const [key, value] of envValues(s.environment)) for (const host of namedHosts(value, names)) add(host, protocolOf(value), `env ${key}`)
    const build = typeof s.build === 'string' ? s.build : typeof s.build?.context === 'string' ? s.build.context : null
    out.push({ name, kind: kindOf(image, name), image: image || null, build: build ? build.replace(/^\.\//, '') : null, refs: [...refs.values()] })
  }
  // A connection with no protocol named takes its target's likely one.
  const byName = new Map(out.map((s) => [s.name, s]))
  for (const svc of out) for (const ref of svc.refs) if (!ref.protocol) ref.protocol = defaultProtocol(byName.get(ref.to).kind, byName.get(ref.to).image ?? '')
  return { services: out.map((s) => ({ ...s, source: 'compose' })) }
}
