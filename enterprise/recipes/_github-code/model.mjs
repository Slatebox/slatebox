// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// A repository as an architecture model, with no model call: which paths to read (wantedPath),
// what each file says (extractFacts: imports, services, endpoints; paths and names only, never
// the code), and the model built from every file's facts (buildModel): modules and their import
// edges, services and their connections, the API surface, owners, cycles and hotspots. Facts
// are kept between runs (the ledger), so a push re-reads only the files it changed.
//
// Keys (the outside keys a recipe's note ids come from):
//   svc:<repo>:<compose|k8s|tf|helm|serverless>:<name>   mod:<repo>:<path>   api:<repo>:<METHOD> <path>
//   ext:<repo>:<package>
import { matchAny } from './glob.mjs'
import { contextPath, readContext } from './context.mjs'
import { moduleOwner } from './extract/codeowners.mjs'
import { findCycles, hotspots } from './extract/cycles.mjs'
import { dirname } from './extract/paths.mjs'
import * as js from './extract/js.mjs'
import * as python from './extract/python.mjs'
import * as go from './extract/go.mjs'
import * as java from './extract/java.mjs'
import * as rust from './extract/rust.mjs'
import * as ruby from './extract/ruby.mjs'
import * as compose from './extract/compose.mjs'
import * as k8s from './extract/k8s.mjs'
import * as helm from './extract/helm.mjs'
import * as terraform from './extract/terraform.mjs'
import * as serverless from './extract/serverless.mjs'
import * as openapi from './extract/openapi.mjs'
import * as graphql from './extract/graphql.mjs'
import * as proto from './extract/proto.mjs'
import * as routes from './extract/routes.mjs'

export const LANGUAGES = { js, python, go, java, rust, ruby }
const FILE_EXTRACTORS = [js, python, go, java, rust, ruby, compose, k8s, helm, terraform, serverless, openapi, graphql, proto, routes]

export const DEFAULT_EXCLUDES = Object.freeze([
  '**/node_modules/**', '**/vendor/**', '**/dist/**', '**/build/**', '**/out/**', '**/.next/**', '**/coverage/**', '**/target/**',
  '**/test/**', '**/tests/**', '**/__tests__/**', '**/spec/**', '**/__mocks__/**', '**/fixtures/**', '**/testdata/**',
  '**/*.test.*', '**/*.spec.*', '**/*_test.go', '**/*_test.py', '**/test_*.py',
  '**/generated/**', '**/gen/**', '**/*.generated.*', '**/*.pb.go', '**/*.min.js', '**/*.d.ts',
])

export const MODEL_LIMITS = Object.freeze({ modules: 60, drillNotes: 80, drillFiles: 8, externals: 10, fileBytes: 1024 * 1024 })

/** Whether a scan reads this path: a context file, or a file some extractor reads and the config does not exclude. */
export function wantedPath(path, config = {}) {
  if (contextPath(path)) return !/(?:^|\/)node_modules\//.test(path)
  if (matchAny([...DEFAULT_EXCLUDES, ...(config.exclude || [])], path)) return false
  if (config.include?.length && !matchAny(config.include, path)) return false
  return FILE_EXTRACTORS.some((x) => x.match(path))
}

/** What one file says. → facts (JSON, paths and names only). */
export function extractFacts(path, text) {
  const facts = {}
  for (const x of FILE_EXTRACTORS) {
    if (!x.match(path)) continue
    let got
    try {
      got = x.extract(path, text) || {}
    } catch {
      got = {}
    }
    for (const [key, value] of Object.entries(got)) {
      if (Array.isArray(value)) facts[key] = [...(facts[key] || []), ...value]
      else if (value && typeof value === 'object') facts[key] = { ...(facts[key] || {}), ...value }
      else if (facts[key] === undefined) facts[key] = value
    }
  }
  return facts
}

/**
 * Every wanted file of a repository read once (a tarball's files). → { facts, context }
 * facts: { [path]: facts } for every non-context wanted path; context: readContext of the context files.
 */
export function scanFiles(files, config = {}) {
  const contextFiles = new Map()
  const facts = {}
  for (const [path, text] of files) {
    if (!wantedPath(path, config)) continue
    if (contextPath(path)) contextFiles.set(path, text)
    if (!contextPath(path) || FILE_EXTRACTORS.some((x) => x.match(path))) {
      const f = extractFacts(path, text)
      if (Object.keys(f).length || Object.values(LANGUAGES).some((l) => l.match(path))) facts[path] = f
    }
  }
  return { facts, context: readContext(contextFiles) }
}

function moduleOf(path, context, depth) {
  const pkg = [...(context.packages || []), ...(context.crates || [])]
    .filter((p) => p.dir && (path === p.dir || path.startsWith(`${p.dir}/`)))
    .sort((a, b) => b.dir.length - a.dir.length)[0]
  if (pkg) return { path: pkg.dir, name: pkg.name }
  const dirs = dirname(path).split('/').filter(Boolean)
  if (!dirs.length) return { path: '', name: '(root)' }
  const kept = dirs.slice(0, depth)
  return { path: kept.join('/'), name: kept.slice(-1)[0] }
}

const sortBy = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0)

/**
 * The architecture model. input: { repo, sha, facts, context, config: { groupingDepth, showExternal, colorByOwner } }
 */
export function buildModel({ repo, sha = null, facts, context, config = {} }) {
  const warnings = []
  const paths = Object.keys(facts).sort()
  const fileSet = new Set(paths)
  const dirSet = new Set(paths.map(dirname))
  const exists = (p) => fileSet.has(p)
  const javaPackages = new Map()
  for (const p of paths) if (facts[p].package) (javaPackages.get(facts[p].package) || javaPackages.set(facts[p].package, []).get(facts[p].package)).push(p)

  // Files into modules; past the cap, one folder level less.
  const codeFiles = paths.filter((p) => facts[p].lang)
  let depth = Math.max(1, Math.min(4, Number(config.groupingDepth) || 2))
  let assign
  for (;;) {
    assign = new Map(codeFiles.map((p) => [p, moduleOf(p, context, depth)]))
    const count = new Set([...assign.values()].map((m) => m.path)).size
    if (count <= MODEL_LIMITS.modules || depth === 1) break
    depth -= 1
  }
  const modules = new Map()
  for (const [file, m] of assign) {
    const key = `mod:${repo}:${m.path || '(root)'}`
    if (!modules.has(key)) modules.set(key, { key, path: m.path, name: m.name, files: [] })
    modules.get(key).files.push(file)
  }
  if (modules.size > MODEL_LIMITS.modules) {
    const ranked = [...modules.values()].sort((a, b) => b.files.length - a.files.length || (a.key < b.key ? -1 : 1))
    const other = { key: `mod:${repo}:(other)`, path: '(other)', name: 'Other modules', files: [] }
    for (const m of ranked.slice(MODEL_LIMITS.modules - 1)) {
      other.files.push(...m.files)
      modules.delete(m.key)
      for (const f of m.files) assign.set(f, { path: '(other)', name: other.name })
    }
    modules.set(other.key, other)
    warnings.push(`${ranked.length - MODEL_LIMITS.modules + 1} small modules are shown together as Other modules.`)
  }
  const moduleKeyOfPath = (p) => {
    const m = assign.get(p)
    return m ? `mod:${repo}:${m.path || '(root)'}` : null
  }
  const moduleKeyOfDir = (dir) => {
    let best = null
    for (const m of modules.values()) if (m.path && (dir === m.path || dir.startsWith(`${m.path}/`)) && (!best || m.path.length > best.path.length)) best = m
    if (best) return best.key
    const f = codeFiles.find((p) => p.startsWith(`${dir}/`))
    return f ? moduleKeyOfPath(f) : null
  }

  // Import edges, file to file and module to module.
  const weights = new Map()
  const fileEdges = []
  const externals = new Map()
  for (const file of codeFiles) {
    const lang = LANGUAGES[facts[file].lang]
    const from = moduleKeyOfPath(file)
    for (const spec of facts[file].imports || []) {
      let target = null
      try {
        target = lang.resolve(spec, file, { exists, context, dirs: dirSet, packages: javaPackages })
      } catch {
        target = null
      }
      if (!target) continue
      if (target.pkg) {
        externals.set(target.pkg, (externals.get(target.pkg) || 0) + 1)
        continue
      }
      const to = target.path ? moduleKeyOfPath(target.path) : target.dir !== undefined ? moduleKeyOfDir(target.dir) : null
      if (target.path) fileEdges.push({ from: file, to: target.path })
      if (!to || to === from) continue
      const id = `${from}->${to}`
      weights.set(id, (weights.get(id) || 0) + 1)
    }
  }
  const moduleEdges = [...weights].map(([id, weight]) => {
    const [from, to] = id.split('->')
    return { from, to, weight }
  })
  const moduleKeys = [...modules.keys()].sort()
  const cycles = findCycles(moduleKeys, moduleEdges)
  const inCycle = new Set(cycles.flatMap((c) => c))
  const cycleOf = new Map()
  cycles.forEach((c, k) => c.forEach((m) => cycleOf.set(m, k)))
  for (const e of moduleEdges) e.cycle = inCycle.has(e.from) && cycleOf.get(e.from) === cycleOf.get(e.to)
  const owners = context.codeowners || []
  const moduleList = [...modules.values()].map((m) => ({
    key: m.key,
    path: m.path,
    name: m.name,
    files: m.files.sort(),
    owner: owners.length ? moduleOwner(owners, m.files) : null,
    drill: m.files.length > MODEL_LIMITS.drillFiles,
  })).sort(sortBy('key'))

  // Drill-down graphs: inside a module, its files grouped one folder below the module.
  const drills = {}
  for (const m of moduleList.filter((x) => x.drill)) {
    const groupOf = (file) => {
      const rest = file.slice(m.path ? m.path.length + 1 : 0)
      const parts = rest.split('/')
      return parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join('/') : rest
    }
    let groups = new Map()
    for (const f of m.files) (groups.get(groupOf(f)) || groups.set(groupOf(f), []).get(groupOf(f))).push(f)
    if (groups.size > MODEL_LIMITS.drillNotes) {
      groups = new Map()
      for (const f of m.files) {
        const g = groupOf(f).split('/')[0]
        ;(groups.get(g) || groups.set(g, []).get(g)).push(f)
      }
    }
    const groupKey = new Map()
    for (const [g, files] of groups) for (const f of files) groupKey.set(f, `${m.key}/${g}`)
    const w = new Map()
    for (const e of fileEdges) {
      const a = groupKey.get(e.from)
      const b = groupKey.get(e.to)
      if (a && b && a !== b) w.set(`${a}->${b}`, (w.get(`${a}->${b}`) || 0) + 1)
    }
    drills[m.key] = {
      groups: [...groups].map(([g, files]) => ({ key: `${m.key}/${g}`, name: g, files: files.length })).sort(sortBy('key')).slice(0, MODEL_LIMITS.drillNotes),
      edges: [...w].map(([id, weight]) => ({ from: id.split('->')[0], to: id.split('->')[1], weight })).sort(sortBy('from')),
    }
  }

  // Services from every infrastructure source.
  const raw = []
  for (const p of paths) for (const s of facts[p].services || []) raw.push({ ...s, file: p })
  raw.push(...k8s.joinK8s(paths.flatMap((p) => facts[p].k8s || [])).map((s) => ({ ...s, file: null })))
  raw.push(...terraform.joinTerraform(paths.flatMap((p) => facts[p].terraform || [])).map((s) => ({ ...s, file: null })))
  const services = new Map()
  for (const s of raw) {
    const key = `svc:${repo}:${s.source}:${s.name}`
    if (services.has(key)) continue
    const mod = s.build ? moduleKeyOfDir(s.build.replace(/\/$/, '')) : null
    services.set(key, { key, name: s.name, label: s.label || s.name, kind: s.kind, source: s.source, image: s.image ?? null, provider: s.provider ?? null, module: mod, file: s.file, refs: s.refs })
  }
  const serviceEdges = []
  for (const s of services.values())
    for (const r of s.refs || []) {
      const to = `svc:${repo}:${s.source}:${r.to}`
      if (services.has(to)) serviceEdges.push({ from: s.key, to, protocol: r.protocol ?? null })
    }
  for (const p of paths) for (const w of facts[p].warnings || []) warnings.push(w)

  // The API surface.
  const endpoints = new Map()
  for (const p of paths)
    for (const e of facts[p].endpoints || []) {
      const key = `api:${repo}:${e.method} ${e.path}`
      if (endpoints.has(key) && endpoints.get(key).source === 'openapi') continue
      endpoints.set(key, { key, method: e.method, path: e.path, group: e.group || 'root', file: e.file, line: e.line ?? null, source: e.source, module: moduleKeyOfPath(e.file) })
    }

  const topExternals = config.showExternal
    ? [...externals].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MODEL_LIMITS.externals).map(([name, fanIn]) => ({ key: `ext:${repo}:${name}`, name, fanIn }))
    : []
  return {
    repo,
    sha,
    groupingDepth: depth,
    modules: moduleList,
    moduleEdges: moduleEdges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1)),
    externals: topExternals,
    drills,
    services: [...services.values()].map(({ refs, ...s }) => s).sort(sortBy('key')),
    serviceEdges: serviceEdges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1)),
    endpoints: [...endpoints.values()].sort(sortBy('key')),
    cycles,
    hotspots: hotspots(moduleKeys, moduleEdges),
    warnings: [...new Set(warnings)],
    files: paths.length,
  }
}

const edgeId = (e) => `${e.from}->${e.to}`

/**
 * What changed between two models of the same repository: added and removed modules, edges,
 * services, connections and endpoints; renamed modules (the same files, at least 70% of them, under
 * a new key); cycles that are new.
 */
export function diffModels(before, after) {
  const by = (list, id) => new Map((list || []).map((x) => [id(x), x]))
  const key = (x) => x.key
  const delta = { added: {}, removed: {}, renamed: [], newCycles: [] }
  const pairs = { modules: key, services: key, endpoints: key, moduleEdges: edgeId, serviceEdges: edgeId }
  for (const [field, id] of Object.entries(pairs)) {
    const a = by(before?.[field], id)
    const b = by(after?.[field], id)
    delta.added[field] = [...b.keys()].filter((k) => !a.has(k)).sort().map((k) => b.get(k))
    delta.removed[field] = [...a.keys()].filter((k) => !b.has(k)).sort().map((k) => a.get(k))
  }
  // Renames: a removed module and an added one with the same files (relative to each module's folder).
  const rel = (m) => new Set(m.files.map((f) => (m.path ? f.slice(m.path.length + 1) : f)))
  for (const gone of delta.removed.modules) {
    const was = rel(gone)
    let best = null
    for (const born of delta.added.modules) {
      const now = rel(born)
      const shared = [...was].filter((f) => now.has(f)).length
      const overlap = shared / Math.max(was.size, now.size, 1)
      if (overlap >= 0.7 && (!best || overlap > best.overlap)) best = { from: gone.key, to: born.key, overlap: Math.round(overlap * 100) / 100 }
    }
    if (best && !delta.renamed.some((r) => r.to === best.to)) delta.renamed.push(best)
  }
  const seen = new Set((before?.cycles || []).map((c) => c.join('|')))
  delta.newCycles = (after?.cycles || []).filter((c) => !seen.has(c.join('|')))
  delta.empty = Object.values(delta.added).every((l) => !l.length) && Object.values(delta.removed).every((l) => !l.length)
  return delta
}
