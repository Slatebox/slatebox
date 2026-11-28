// The GitHub recipes' code reading: one test per source (YAML, globs, the tarball reader, compose,
// Kubernetes, Helm, Terraform, serverless, JS/TS, Python, Go, Java/Kotlin, Rust, Ruby, OpenAPI,
// GraphQL, proto, routes in code, CODEOWNERS, cycles), the model built from them, and the scan's
// promise: paths and names only, never a file's body.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-github-extract.test.mjs
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { test } from 'node:test'
import { parseYaml, parseYamlAll } from '../enterprise/recipes/_github-code/yaml.mjs'
import { matchGlob } from '../enterprise/recipes/_github-code/glob.mjs'
import { readTarball, writeTarball } from '../enterprise/server/recipes/vendors/github/tar.mjs'
import { buildModel, diffModels, scanFiles, wantedPath } from '../enterprise/recipes/_github-code/model.mjs'
import { patchContext, readContext } from '../enterprise/recipes/_github-code/context.mjs'
import * as compose from '../enterprise/recipes/_github-code/extract/compose.mjs'
import * as k8s from '../enterprise/recipes/_github-code/extract/k8s.mjs'
import * as helm from '../enterprise/recipes/_github-code/extract/helm.mjs'
import * as terraform from '../enterprise/recipes/_github-code/extract/terraform.mjs'
import * as serverless from '../enterprise/recipes/_github-code/extract/serverless.mjs'
import * as graphql from '../enterprise/recipes/_github-code/extract/graphql.mjs'
import * as proto from '../enterprise/recipes/_github-code/extract/proto.mjs'
import * as routes from '../enterprise/recipes/_github-code/extract/routes.mjs'
import { ownersOf, parseCodeowners } from '../enterprise/recipes/_github-code/extract/codeowners.mjs'
import { findCycles, hotspots } from '../enterprise/recipes/_github-code/extract/cycles.mjs'
import { FILES, REPO } from '../enterprise/recipes/_github-code/fixtures/acme-monorepo.mjs'

const model = (files, config) => {
  const { facts, context } = scanFiles(new Map(Object.entries(files)), config)
  return buildModel({ repo: 'o/r', facts, context, config })
}
const modEdges = (m) => m.moduleEdges.map((e) => `${e.from.split(':').pop()}->${e.to.split(':').pop()}`).sort()

test('YAML: mappings, sequences, "- key:" items, flow values, block scalars, documents, comments', () => {
  const { docs } = parseYamlAll('a: 1 # one\nb:\n  - x\n  - name: y\n    port: 80\nc: [p, "q, r"]\nd: {e: f}\ns: |\n  one\n  two\n---\nkind: Service\n')
  assert.deepEqual(docs[0], { a: 1, b: ['x', { name: 'y', port: 80 }], c: ['p', 'q, r'], d: { e: 'f' }, s: 'one\ntwo' })
  assert.deepEqual(docs[1], { kind: 'Service' })
  assert.deepEqual(parseYaml("url: 'http://x#y'\nempty:\nt: yes"), { url: 'http://x#y', empty: null, t: true })
})

test('globs: *, **, {a,b}, anchored and folder patterns', () => {
  assert.ok(matchGlob('**/node_modules/**', 'a/node_modules/b/c.js'))
  assert.ok(matchGlob('*.md', 'docs/a.md'), 'no slash: any depth')
  assert.ok(matchGlob('/packages/ledger/', 'packages/ledger/src/x.ts'))
  assert.ok(!matchGlob('/packages/ledger/', 'other/packages/ledger/x.ts'))
  assert.ok(matchGlob('src/*.{ts,js}', 'src/a.js') && !matchGlob('src/*.{ts,js}', 'src/a/b.js'))
})

test('the tarball reader keeps only wanted paths, drops GitHub\'s top folder and skips files over the cap', async () => {
  const files = new Map([['a/b.ts', 'x'], ['big.txt', 'y'.repeat(2000)], ['deep/' + 'n'.repeat(120) + '/c.ts', 'z']])
  const out = await readTarball(gzipSync(writeTarball(files, { top: 'acme-api-abc1234/' })), { want: (p) => !p.endsWith('.md'), maxFileBytes: 1000 })
  assert.deepEqual([...out.files.keys()].sort(), ['a/b.ts', 'deep/' + 'n'.repeat(120) + '/c.ts'])
  assert.deepEqual(out.skipped, [{ path: 'big.txt', size: 2000 }])
})

test('compose: services, kinds from images, connections from depends_on, links and env values (with protocols)', () => {
  const { services } = compose.extract('docker-compose.yml', FILES['docker-compose.yml'])
  const by = Object.fromEntries(services.map((s) => [s.name, s]))
  assert.deepEqual(Object.fromEntries(services.map((s) => [s.name, s.kind])), { api: 'service', worker: 'service', postgres: 'store', redis: 'store' })
  assert.deepEqual(by.api.refs.map((r) => `${r.to}:${r.protocol}`).sort(), ['postgres:sql', 'redis:redis'])
  assert.equal(by.api.build, 'packages/api')
  assert.ok(compose.match('deploy/docker-compose.prod.yaml') && compose.match('compose.yml') && !compose.match('composer.json'))
  assert.equal(compose.extract('compose.yml', 'services:\n  q:\n    image: rabbitmq:3\n').services[0].kind, 'queue')
})

test('Kubernetes: a Service joins its workloads by selector, an Ingress joins its Services, env names Services', () => {
  const a = k8s.extract('k8s/api.yaml', `apiVersion: apps/v1
kind: Deployment
metadata: { name: api, namespace: prod }
spec:
  template:
    metadata: { labels: { app: api } }
    spec:
      containers:
        - name: api
          image: acme/api:1
          env:
            - name: DB_HOST
              value: db.prod.svc.cluster.local
---
apiVersion: v1
kind: Service
metadata: { name: api-svc, namespace: prod }
spec: { selector: { app: api } }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: web, namespace: prod }
spec:
  rules:
    - host: api.acme.com
      http:
        paths:
          - backend: { service: { name: api-svc } }
`)
  const b = k8s.extract('k8s/db.yaml', 'apiVersion: apps/v1\nkind: StatefulSet\nmetadata: {name: postgres, namespace: prod}\nspec:\n  template:\n    metadata: {labels: {app: pg}}\n    spec:\n      containers:\n        - image: postgres:16\n---\napiVersion: v1\nkind: Service\nmetadata: {name: db, namespace: prod}\nspec: {selector: {app: pg}}\n')
  const joined = k8s.joinK8s([...a.k8s, ...b.k8s])
  const by = Object.fromEntries(joined.map((s) => [s.name, s]))
  assert.equal(by.postgres.kind, 'store')
  assert.deepEqual(by.api.refs, [{ to: 'postgres', protocol: 'sql', via: 'env' }])
  assert.deepEqual(by['ingress:web'].refs.map((r) => r.to), ['api'])
  assert.equal(by['ingress:web'].label, 'api.acme.com')
  assert.deepEqual(k8s.extract('charts/x/templates/d.yaml', 'kind: Deployment'), {}, 'helm templates are not read as manifests')
})

test('Helm: the chart and its dependencies, with a plain warning that templates are not rendered', () => {
  const out = helm.extract('charts/api/Chart.yaml', 'apiVersion: v2\nname: api\ndependencies:\n  - name: redis\n    version: 18.x\n')
  assert.deepEqual(out.services.map((s) => [s.label, s.kind]), [['api', 'service'], ['redis', 'store']])
  assert.match(out.warnings[0], /templates in charts\/api\/templates are not rendered/)
})

test('Terraform: typed resources and modules, joined by references across files', () => {
  const one = terraform.extract('main.tf', 'resource "aws_lambda_function" "billing" {\n  environment { variables = { Q = aws_sqs_queue.jobs.url, DB = aws_db_instance.main.address } }\n}\n# resource "aws_s3_bucket" "commented" {}\n')
  const two = terraform.extract('data.tf', 'resource "aws_sqs_queue" "jobs" {\n  name = "jobs"\n}\nresource "aws_db_instance" "main" {}\nresource "aws_iam_role" "r" {}\nmodule "vpc" {\n  source = "terraform-aws-modules/vpc/aws"\n}\n')
  const joined = terraform.joinTerraform([...one.terraform, ...two.terraform])
  assert.deepEqual(joined.map((s) => [s.name, s.kind]).sort(), [['aws_db_instance.main', 'store'], ['aws_lambda_function.billing', 'function'], ['aws_sqs_queue.jobs', 'queue'], ['module.vpc', 'service']])
  assert.deepEqual(joined.find((s) => s.name === 'aws_lambda_function.billing').refs.map((r) => r.to).sort(), ['aws_db_instance.main', 'aws_sqs_queue.jobs'])
})

test('serverless and SAM: functions, their http routes as endpoints, their queues', () => {
  const sls = serverless.extract('serverless.yml', 'service: billing\nfunctions:\n  charge:\n    handler: h.charge\n    events:\n      - http:\n          path: charges\n          method: post\n      - sqs:\n          arn: arn:aws:sqs:us-east-1:1:jobs\n')
  assert.deepEqual(sls.endpoints.map((e) => `${e.method} ${e.path}`), ['POST /charges'])
  assert.deepEqual(sls.services.map((s) => [s.name, s.kind]).sort(), [['fn:charge', 'function'], ['queue:jobs', 'queue']])
  const sam = serverless.extract('template.yaml', 'Resources:\n  Fn:\n    Type: AWS::Serverless::Function\n    Properties:\n      Events:\n        Get:\n          Type: Api\n          Properties: {Path: /items, Method: get}\n')
  assert.deepEqual(sam.endpoints.map((e) => `${e.method} ${e.path}`), ['GET /items'])
})

test('GraphQL, proto and routes in code (Express, Next.js, Flask, FastAPI, Rails, Go) with lines', () => {
  assert.deepEqual(graphql.extract('s.graphql', 'type Query {\n  invoice(id: ID!): Invoice\n  invoices: [Invoice]\n}\ntype Mutation { refund(id: ID!): Boolean }\ntype Invoice { id: ID }\n').endpoints.map((e) => `${e.method} ${e.path}:${e.line}`), ['QUERY invoice:2', 'QUERY invoices:3', 'MUTATION refund:5'])
  assert.deepEqual(proto.extract('a.proto', 'service Billing {\n  rpc Charge (Req) returns (Res);\n  // rpc Old (Req) returns (Res);\n}\n').endpoints.map((e) => e.path), ['Billing.Charge'])
  const at = (path, text) => routes.extract(path, text).endpoints?.map((e) => `${e.method} ${e.path}`) ?? []
  assert.deepEqual(at('src/app/invoices/[id]/route.ts', 'export async function GET() {}\nexport const DELETE = () => {}'), ['GET /invoices/[id]', 'DELETE /invoices/[id]'])
  assert.deepEqual(at('pages/api/users/index.ts', 'export default function h() {}'), ['ANY /api/users'])
  assert.deepEqual(at('app.py', "@app.route('/a', methods=['GET', 'POST'])\ndef a(): pass\n@router.get('/b')\ndef b(): pass\n"), ['GET /a', 'POST /a', 'GET /b'])
  assert.deepEqual(at('config/routes.rb', "resources :invoices\nget '/health'\n").slice(0, 2).concat(at('config/routes.rb', "get '/health'\n")), ['GET /invoices', 'POST /invoices', 'GET /health'])
  assert.deepEqual(at('main.go', 'http.HandleFunc("/ping", h)\nr.Get("/users/{id}", h)\n'), ['ANY /ping', 'GET /users/{id}'])
  assert.deepEqual(at('client.ts', "axios.get('/not-a-route')\nfetch('/x')"), [], 'a client call is not a route')
})

test('Python, Go, Java, Rust and Ruby imports resolve to modules; the standard libraries are left out', () => {
  const py = model({ 'app/__init__.py': '', 'app/api/views.py': 'import os\nfrom app.billing import charge\nfrom . import util\n', 'app/api/util.py': '', 'app/billing/__init__.py': 'import requests\n' }, { groupingDepth: 2 })
  assert.deepEqual(modEdges(py), ['app/api->app/billing'])
  const go = model({ 'go.mod': 'module example.com/shop\n', 'cmd/server/main.go': 'package main\nimport (\n  "fmt"\n  "example.com/shop/internal/cart"\n  "github.com/x/y"\n)\n', 'internal/cart/cart.go': 'package cart\n' })
  assert.deepEqual(modEdges(go), ['cmd/server->internal/cart'])
  const java = model({ 'src/main/java/com/acme/api/Api.java': 'package com.acme.api;\nimport com.acme.billing.Billing;\nimport java.util.List;\n', 'src/main/java/com/acme/billing/Billing.java': 'package com.acme.billing;\n' })
  assert.deepEqual(modEdges(java), ['src/main/java/com/acme/api->src/main/java/com/acme/billing'])
  assert.deepEqual(java.modules.map((m) => m.name), ['com.acme.api', 'com.acme.billing'])
  const rust = model({ 'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n', 'crates/api/Cargo.toml': '[package]\nname = "api"\n', 'crates/api/src/lib.rs': 'use ledger::Book;\nuse std::io;\nmod routes;\n', 'crates/api/src/routes.rs': 'use crate::lib;\n', 'crates/ledger/Cargo.toml': '[package]\nname = "ledger"\n', 'crates/ledger/src/lib.rs': '' })
  assert.deepEqual(modEdges(rust), ['crates/api->crates/ledger'])
  const rb = model({ 'lib/shop/cart.rb': "require_relative '../billing/charge'\nrequire 'json'\n", 'lib/billing/charge.rb': '' })
  assert.deepEqual(modEdges(rb), ['lib/shop->lib/billing'])
})

test('CODEOWNERS: the last matching rule wins; cycles and hotspots', () => {
  const rules = parseCodeowners('* @acme/all\n/packages/ledger/ @acme/payments @ana\n*.md @acme/docs\n')
  assert.deepEqual(ownersOf(rules, 'packages/ledger/src/a.ts'), ['@acme/payments', '@ana'])
  assert.deepEqual(ownersOf(rules, 'packages/ledger/README.md'), ['@acme/docs'])
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }, { from: 'c', to: 'd' }, { from: 'x', to: 'd' }, { from: 'y', to: 'd' }]
  assert.deepEqual(findCycles(['a', 'b', 'c', 'd', 'x', 'y'], edges), [['a', 'b', 'c']])
  assert.deepEqual(hotspots(['a', 'b', 'c', 'd', 'x', 'y'], edges).fanIn, [{ key: 'd', count: 3 }])
})

test('the scan reads only what it needs; context patches without a full scan; test and generated files are left out', () => {
  assert.ok(wantedPath('packages/api/src/index.ts') && wantedPath('docker-compose.yml') && wantedPath('.github/CODEOWNERS'))
  for (const p of ['packages/api/src/index.test.ts', 'node_modules/x/index.js', 'dist/a.js', 'gen/api.pb.go', 'README.md', 'logo.png']) assert.ok(!wantedPath(p), p)
  assert.ok(!wantedPath('src/legacy/a.ts', { exclude: ['src/legacy/**'] }))
  const ctx = readContext(new Map(Object.entries(FILES).filter(([p]) => /package\.json|pnpm|CODEOWNERS|tsconfig/.test(p))))
  assert.deepEqual(ctx.packages.map((p) => p.name), ['@acme/api', '@acme/ledger', '@acme/worker'])
  const next = patchContext(ctx, [{ path: 'packages/refunds/package.json', text: '{"name":"@acme/refunds"}' }, { path: 'packages/worker/package.json', text: null }])
  assert.deepEqual(next.packages.map((p) => p.name), ['@acme/api', '@acme/ledger', '@acme/refunds'])
  assert.equal(patchContext(ctx, [{ path: 'pnpm-workspace.yaml', text: '' }]), null, 'the workspace itself changed: a full scan')
})

test('the sample monorepo model, and a diff with no change is empty', () => {
  const m = model(FILES)
  assert.equal(m.repo, 'o/r')
  assert.deepEqual(m.modules.map((x) => x.name), ['@acme/api', '@acme/ledger', '@acme/worker'])
  assert.equal(m.services.length, 4)
  assert.equal(m.endpoints.length, 4)
  assert.equal(diffModels(m, model(FILES)).empty, true)
  assert.equal(REPO, 'acme/platform')
})
