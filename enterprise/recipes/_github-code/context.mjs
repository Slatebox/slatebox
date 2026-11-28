// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The files that say how a repository is put together, read once per scan: JS workspaces
// (package.json workspaces, pnpm-workspace.yaml) and their package names, tsconfig paths, go.mod
// modules, Cargo workspace members, Python package roots and CODEOWNERS. A change to any of them
// makes the next run a full scan (contextPath).
import { matchGlob } from './glob.mjs'
import { parseYaml } from './yaml.mjs'
import { parseCodeowners, match as isCodeowners } from './extract/codeowners.mjs'
import { dirname, joinPath } from './extract/paths.mjs'

/** Whether a path is one of the files context reads. */
export const contextPath = (path) =>
  /(?:^|\/)(package\.json|pnpm-workspace\.ya?ml|tsconfig(?:\.[\w-]+)?\.json|jsconfig\.json|go\.mod|Cargo\.toml|pyproject\.toml|setup\.cfg)$/.test(path) || isCodeowners(path)

function json(text) {
  try {
    return JSON.parse(text)
  } catch {
    // tsconfig allows comments and trailing commas
    try {
      return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'])\/\/[^\n]*/g, '$1').replace(/,(\s*[}\]])/g, '$1'))
    } catch {
      return null
    }
  }
}

const tomlString = (text, section, key) => {
  const at = text.search(new RegExp(`^\\[${section.replace(/\./g, '\\.')}\\]\\s*$`, 'm'))
  if (at < 0) return null
  const rest = text.slice(at).split('\n').slice(1)
  for (const line of rest) {
    if (/^\s*\[/.test(line)) break
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`))
    if (m) return m[1]
  }
  return null
}
const tomlList = (text, section, key) => {
  const at = text.search(new RegExp(`^\\[${section.replace(/\./g, '\\.')}\\]\\s*$`, 'm'))
  if (at < 0) return []
  const m = text.slice(at).match(new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'))
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : []
}

/** files: Map<path, text> of context files. → context */
export function readContext(files) {
  const context = { packages: [], tsPaths: {}, tsBase: '', goModules: [], crates: [], pythonRoots: [], codeowners: [], workspaceGlobs: [] }
  const get = (path) => files.get(path) ?? null
  // JS workspaces: the globs, then each package.json under them.
  const root = json(get('package.json') || '') || {}
  const globs = Array.isArray(root.workspaces) ? root.workspaces : Array.isArray(root.workspaces?.packages) ? root.workspaces.packages : []
  const pnpm = get('pnpm-workspace.yaml') ?? get('pnpm-workspace.yml')
  if (pnpm) for (const g of parseYaml(pnpm)?.packages || []) globs.push(`${g}`)
  context.workspaceGlobs = globs.filter((g) => !`${g}`.startsWith('!'))
  for (const [path, text] of files) {
    if (!path.endsWith('package.json') || path === 'package.json') continue
    const dir = dirname(path)
    if (!context.workspaceGlobs.some((g) => matchGlob(`/${g.replace(/\/$/, '')}`, dir) && dir.split('/').length === `${g}`.replace(/\/$/, '').split('/').length)) continue
    const pkg = json(text)
    if (pkg?.name) context.packages.push({ name: `${pkg.name}`, dir })
  }
  context.packages.sort((a, b) => (a.dir < b.dir ? -1 : 1))
  // tsconfig paths at the root.
  const ts = json(get('tsconfig.json') || get('jsconfig.json') || '') || {}
  if (ts.compilerOptions?.paths && typeof ts.compilerOptions.paths === 'object') {
    context.tsPaths = Object.fromEntries(Object.entries(ts.compilerOptions.paths).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.map(String)]))
    context.tsBase = `${ts.compilerOptions.baseUrl ?? '.'}`.replace(/^\.\/?/, '')
  }
  for (const [path, text] of files) {
    if (path.endsWith('go.mod')) {
      const module = text.match(/^\s*module\s+(\S+)/m)?.[1]
      if (module) context.goModules.push({ module, dir: dirname(path) })
    }
    if (path.endsWith('Cargo.toml')) {
      const name = tomlString(text, 'package', 'name')
      if (name) context.crates.push({ name, dir: dirname(path) })
    }
    if (path.endsWith('pyproject.toml') || path.endsWith('setup.cfg')) {
      const dirOption = text.match(/^\s*package_dir\s*=\s*\n?\s*=\s*(\S+)/m)
      const where = [...tomlList(text, 'tool.setuptools.packages.find', 'where'), ...(dirOption ? [dirOption[1]] : [])]
      for (const w of where) context.pythonRoots.push(joinPath(dirname(path), w))
    }
    if (isCodeowners(path) && !context.codeowners.length) context.codeowners = parseCodeowners(text)
  }
  // A Cargo workspace's members: only crates under the workspace globs (or every crate when there is none).
  const cargo = get('Cargo.toml')
  const members = cargo ? tomlList(cargo, 'workspace', 'members') : []
  if (members.length) context.crates = context.crates.filter((c) => members.some((m) => matchGlob(`/${m}`, c.dir)))
  context.goModules.sort((a, b) => b.module.length - a.module.length)
  return context
}

/**
 * The context with some context files changed (text null: removed), without reading every file
 * again. → the new context, or null when the change needs a full scan (the root package.json,
 * pnpm-workspace.yaml, the root Cargo.toml or a Python package root changed).
 */
export function patchContext(context, changes) {
  const next = structuredClone(context)
  for (const { path, text } of changes) {
    if (['package.json', 'pnpm-workspace.yaml', 'pnpm-workspace.yml', 'Cargo.toml'].includes(path) || /(?:^|\/)(pyproject\.toml|setup\.cfg)$/.test(path)) return null
    const dir = dirname(path)
    if (path.endsWith('package.json')) {
      next.packages = next.packages.filter((p) => p.dir !== dir)
      const inWorkspace = next.workspaceGlobs.some((g) => matchGlob(`/${g.replace(/\/$/, '')}`, dir) && dir.split('/').length === `${g}`.replace(/\/$/, '').split('/').length)
      const pkg = text === null ? null : json(text)
      if (inWorkspace && pkg?.name) next.packages.push({ name: `${pkg.name}`, dir })
      next.packages.sort((a, b) => (a.dir < b.dir ? -1 : 1))
    } else if (/(?:^|\/)(tsconfig(?:\.[\w-]+)?|jsconfig)\.json$/.test(path)) {
      if (dir !== '') continue
      return null
    } else if (path.endsWith('go.mod')) {
      next.goModules = next.goModules.filter((m) => m.dir !== dir)
      const module = text?.match(/^\s*module\s+(\S+)/m)?.[1]
      if (module) next.goModules.push({ module, dir })
      next.goModules.sort((a, b) => b.module.length - a.module.length)
    } else if (path.endsWith('Cargo.toml')) {
      next.crates = next.crates.filter((c) => c.dir !== dir)
      const name = text ? tomlString(text, 'package', 'name') : null
      if (name) next.crates.push({ name, dir })
    } else if (isCodeowners(path)) {
      next.codeowners = text === null ? [] : parseCodeowners(text)
    }
  }
  return next
}
