// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Routes written in code, found by pattern: Express, Fastify and Koa (app.get('/x', ...)), Next.js
// (app/**/route.ts exports and pages/api/**), Flask and FastAPI decorators, Rails config/routes.rb
// (resources and verbs), Go net/http, chi and gin. Each with its file and line.
import { lineAt } from './paths.mjs'

const VERB = '(get|post|put|patch|delete|head|options|all)'

export const match = (path) =>
  /\.(?:[cm]?[jt]sx?|py|go)$/.test(path) || /(?:^|\/)config\/routes\.rb$/.test(path)

const restOf = (name, path, line, file) => [
  ['GET', `/${name}`], ['POST', `/${name}`], ['GET', `/${name}/:id`], ['PATCH', `/${name}/:id`], ['DELETE', `/${name}/:id`],
].map(([method, route]) => ({ method, path: route, group: name, file, line, source: 'rails', path0: path }))

function nextRoute(path) {
  // app/invoices/[id]/route.ts -> /invoices/[id]; pages/api/users/index.ts -> /api/users
  const app = path.match(/(?:^|\/)app\/(.*)\/route\.[cm]?[jt]sx?$/)
  if (app) return `/${app[1].split('/').filter((p) => !/^\(.*\)$/.test(p)).join('/')}`
  const pages = path.match(/(?:^|\/)pages\/(api\/.*)\.[cm]?[jt]sx?$/)
  if (pages) return `/${pages[1].replace(/\/index$/, '')}`
  return null
}

export function extract(path, text) {
  const endpoints = []
  const push = (method, route, index, source) => {
    const group = route.split('/').filter((p) => p && !p.startsWith(':') && !p.startsWith('{') && !p.startsWith('['))[0] || 'root'
    endpoints.push({ method: method.toUpperCase(), path: route, group, file: path, line: lineAt(text, index), source })
  }
  if (/\.(?:[cm]?[jt]sx?)$/.test(path)) {
    // The names a router or server is kept under: app, router, server, fastify, and any name
    // assigned from express(), Router(), fastify(), new Koa() or new Router().
    const names = new Set(['app', 'router', 'server', 'fastify', 'routes'])
    for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+)?(?:express\s*\(|(?:express\.)?Router\s*\(|fastify\s*\(|Fastify\s*\(|Koa\s*\(|KoaRouter\s*\()/g)) names.add(m[1])
    const owners = [...names].map((n) => n.replace(/\$/g, '\\$')).join('|')
    for (const m of text.matchAll(new RegExp(`\\b(?:${owners})\\.${VERB}\\(\\s*['"\`](/[^'"\`]*)['"\`]`, 'g')))
      push(m[1] === 'all' ? 'ANY' : m[1], m[2], m.index, 'express')
    const route = nextRoute(path)
    if (route) {
      const exported = [...text.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)]
      if (exported.length) for (const m of exported) push(m[1], route, m.index, 'next')
      else if (route.startsWith('/api/') && /export\s+default/.test(text)) push('ANY', route, text.search(/export\s+default/), 'next')
    }
  } else if (path.endsWith('.py')) {
    for (const m of text.matchAll(/@\w+\.route\(\s*['"](\/[^'"]*)['"](?:[^)]*methods\s*=\s*\[([^\]]*)\])?/g)) {
      const methods = m[2] ? [...m[2].matchAll(/['"](\w+)['"]/g)].map((x) => x[1]) : ['GET']
      for (const method of methods) push(method, m[1], m.index, 'flask')
    }
    for (const m of text.matchAll(new RegExp(`@\\w+\\.${VERB}\\(\\s*['"](/[^'"]*)['"]`, 'g'))) push(m[1], m[2], m.index, 'fastapi')
  } else if (path.endsWith('.go')) {
    for (const m of text.matchAll(/\b(?:http|mux)\.HandleFunc\(\s*"(\/[^"]*)"/g)) push('ANY', m[1].replace(/^(GET|POST|PUT|PATCH|DELETE) /, ''), m.index, 'net/http')
    for (const m of text.matchAll(/\b\w+\.(Get|Post|Put|Patch|Delete|GET|POST|PUT|PATCH|DELETE)\(\s*"(\/[^"]*)"/g)) push(m[1], m[2], m.index, 'chi/gin')
  } else if (path.endsWith('routes.rb')) {
    for (const m of text.matchAll(/^\s*resources?\s+:(\w+)/gm)) endpoints.push(...restOf(m[1], path, lineAt(text, m.index), path).map(({ path0, ...e }) => e))
    for (const m of text.matchAll(/^\s*(get|post|put|patch|delete)\s+['"](\/?[^'"]+)['"]/gm)) push(m[1], m[2].startsWith('/') ? m[2] : `/${m[2]}`, m.index, 'rails')
  }
  return endpoints.length ? { endpoints } : {}
}
