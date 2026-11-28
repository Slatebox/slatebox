// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The sample monorepo the GitHub recipes are tested against (catalog G1 acceptance 1): pnpm
// workspaces with three packages (api, worker, ledger), a docker-compose with api + worker +
// postgres + redis, an OpenAPI file and CODEOWNERS. Kept as a module (not files on disk) so the
// app never builds it and every file under enterprise/ carries its license line.

export const REPO = 'acme/platform'
export const BASE_SHA = '1111111111111111111111111111111111111111'

export const FILES = Object.freeze({
  'package.json': JSON.stringify({ name: 'acme-platform', private: true, scripts: { build: 'pnpm -r build' } }, null, 2),
  'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
  'tsconfig.json': '{\n  // shared settings\n  "compilerOptions": { "baseUrl": ".", "paths": { "@shared/*": ["packages/ledger/src/*"] } },\n}\n',
  '.github/CODEOWNERS': '# owners\n*                 @acme/platform\n/packages/ledger/ @acme/payments\n',
  'README.md': '# Acme platform\n',
  'docker-compose.yml': `services:
  api:
    build: ./packages/api
    ports: ["8080:8080"]
    environment:
      - DATABASE_URL=postgres://app:secret@postgres:5432/acme
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis
  worker:
    build: ./packages/worker
    environment:
      DATABASE_URL: postgres://app:secret@postgres:5432/acme
      QUEUE_HOST: redis
    depends_on: [postgres, redis]
  postgres:
    image: postgres:16
  redis:
    image: redis:7-alpine
`,
  'openapi.yaml': `openapi: 3.0.3
info:
  title: Acme API
  version: 1.0.0
paths:
  /invoices:
    get:
      tags: [invoices]
      summary: List invoices
    post:
      tags: [invoices]
      summary: Create an invoice
  /invoices/{id}:
    get:
      tags: [invoices]
      summary: Read one invoice
  /health:
    get:
      tags: [health]
`,
  'packages/api/package.json': JSON.stringify({ name: '@acme/api', version: '1.0.0', dependencies: { express: '^5.0.0' } }),
  'packages/api/src/index.ts': `import express from 'express'
import { invoices } from './routes/invoices'
// import { nothing } from '../../worker'  (a comment is not an import)
const app = express()
app.use(invoices)
app.get('/health', (_req, res) => res.send('ok'))
app.listen(8080)
`,
  'packages/api/src/routes/invoices.ts': `import { Router } from 'express'
export const invoices = Router()
invoices.get('/invoices', async (_req, res) => res.json([]))
`,
  'packages/api/src/index.test.ts': "import { invoices } from './routes/invoices'\n",
  'packages/worker/package.json': JSON.stringify({ name: '@acme/worker', version: '1.0.0', dependencies: { '@acme/ledger': 'workspace:*', bullmq: '^5.0.0' } }),
  'packages/worker/src/index.ts': `import { Worker } from 'bullmq'
import { postEntry } from '@acme/ledger'
new Worker('ledger', async (job) => postEntry(job.data))
`,
  'packages/ledger/package.json': JSON.stringify({ name: '@acme/ledger', version: '1.0.0', main: 'src/index.ts', dependencies: { pg: '^8.0.0' } }),
  'packages/ledger/src/index.ts': "export { listEntries, postEntry } from './entries'\n",
  'packages/ledger/src/entries.ts': `import pg from 'pg'
const pool = new pg.Pool()
export const listEntries = () => pool.query('select * from entries')
export const postEntry = (e) => pool.query('insert into entries values ($1)', [e])
`,
})

/** The repository's files with some changed (null deletes a file). */
export function withChanges(changes, base = FILES) {
  const out = new Map(Object.entries(base))
  for (const [path, text] of Object.entries(changes)) {
    if (text === null) out.delete(path)
    else out.set(path, text)
  }
  return out
}

// The push of acceptance 2: api's invoices route starts reading the ledger (import ... from
// '../../../ledger/src'): exactly one new module edge, api -> ledger.
export const PUSH_NEW_EDGE = Object.freeze({
  'packages/api/src/routes/invoices.ts': `import { Router } from 'express'
import { listEntries } from '../../../ledger/src'
export const invoices = Router()
invoices.get('/invoices', async (_req, res) => res.json(await listEntries()))
`,
})

// The pull request of G2 acceptance 1: a new refunds package (it posts ledger entries; the ledger
// gains refundEntry), imported by api (2 imports), and POST /refunds in the OpenAPI file.
export const PR_REFUNDS = Object.freeze({
  'packages/ledger/src/entries.ts': `import pg from 'pg'
const pool = new pg.Pool()
export const listEntries = () => pool.query('select * from entries')
export const postEntry = (e) => pool.query('insert into entries values ($1)', [e])
export const refundEntry = (id) => postEntry({ refund: id })
`,
  'packages/refunds/package.json': JSON.stringify({ name: '@acme/refunds', version: '0.1.0', dependencies: { '@acme/ledger': 'workspace:*' } }),
  'packages/refunds/src/index.ts': "import { postEntry } from '@acme/ledger'\nexport const refund = (id) => postEntry({ refund: id })\n",
  'packages/api/src/routes/refunds.ts': "import { Router } from 'express'\nimport { refund } from '@acme/refunds'\nexport const refunds = Router()\nrefunds.post('/refunds', (req, res) => res.json(refund(req.body.id)))\n",
  'packages/api/src/index.ts': `import express from 'express'
import { invoices } from './routes/invoices'
import { refunds } from './routes/refunds'
import { refund } from '@acme/refunds'
const app = express()
app.use(invoices)
app.use(refunds)
app.get('/health', (_req, res) => res.send('ok'))
void refund
app.listen(8080)
`,
  'openapi.yaml': `openapi: 3.0.3
info:
  title: Acme API
  version: 1.0.0
paths:
  /invoices:
    get:
      tags: [invoices]
      summary: List invoices
    post:
      tags: [invoices]
      summary: Create an invoice
  /invoices/{id}:
    get:
      tags: [invoices]
      summary: Read one invoice
  /refunds:
    post:
      tags: [refunds]
      summary: Refund an invoice
  /health:
    get:
      tags: [health]
`,
})
