// Writes the documents generated from the action registry:
//   web/app/server/actions/generated/openapi.json   what /api/v1/openapi.json serves
//   web/app/server/actions/generated/contract.json  every HTTP action with its route and schemas
//   and, to both web/app/server/actions/generated/ and packages/slatebox-mcp/generated/:
//   slatebox.d.ts    the typed `slatebox` client an exec script calls
//   client.json      the runtime manifest both exec runners build that client from
//   exec-tool.json   the exec and describe tool definitions every MCP server serves
//   guest-client.js  the guest prelude that defines the client inside a script
// Run after changing an action: node scripts/generate-action-contract.mjs
// scripts/action-registry.test.mjs fails while any of these files is out of date.
import { mkdir, writeFile } from 'node:fs/promises'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'
import { buildOpenApi } from '../web/app/server/actions/openapi.mjs'
import { buildContract } from '../web/app/server/actions/contract.mjs'
import { renderClientFiles } from '../web/app/server/actions/client-render.mjs'

const registry = createAppRegistry()
const app = new URL('../web/app/server/actions/generated/', import.meta.url)
const pkg = new URL('../packages/slatebox-mcp/generated/', import.meta.url)
await mkdir(app, { recursive: true })
await mkdir(pkg, { recursive: true })
const write = (dir, name, text) => writeFile(new URL(name, dir), text)
await write(app, 'openapi.json', JSON.stringify(buildOpenApi(registry), null, 2) + '\n')
await write(app, 'contract.json', JSON.stringify(buildContract(registry), null, 2) + '\n')
const files = renderClientFiles(registry)
for (const [name, text] of Object.entries(files)) {
  await write(app, name, text)
  await write(pkg, name, text)
}
console.log('Wrote openapi.json, contract.json and', Object.keys(files).join(', '), 'to', app.pathname, 'and', pkg.pathname)
