#!/usr/bin/env node
// After the real team-address run: does anything of it remain in Slatebox's Cloudflare account?
// Lists (read-only) the tunnels named sbx-<claim id> and the DNS records for the e2e names, and
// prints counts only. With --delete it removes what it found and still exits 1: anything left is
// a bug in the release path, not something to tidy quietly.
//
//   node cloudflare-leftovers.mjs <claim-id|-> <name> [<name> ...] [--delete]
//
// The Cloudflare token is read from the private file and is never printed, logged or passed on
// a command line.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const remove = args.includes('--delete')
const [claimId, ...names] = args.filter(arg => arg !== '--delete')
if (!claimId || !names.length || names.some(name => !/^e2e-[a-z0-9-]{1,28}$/.test(name))) {
  process.stderr.write('Usage: node cloudflare-leftovers.mjs <claim-id|-> e2e-<name> [e2e-<name> ...] [--delete]  (only e2e- names)\n')
  process.exit(2)
}
const file = process.env.SLATEBOX_CF_CLAIMS_FILE || join(homedir(), '.config/slatebox-private/cloudflare/slatebox-team-claims.json')
const config = JSON.parse(readFileSync(file, 'utf8'))
const token = config.token || config.apiToken
const account = config.accountId
const zone = config.zoneId || 'af42159048b8ac1f5da03f164096f34a'
if (!token || !account) { process.stderr.write(`${file} has no token or accountId field.\n`); process.exit(2) }

async function cf(method, path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
  const body = await response.json().catch(() => ({}))
  if (!body.success) throw new Error(`${method} ${path.replace(/\?.*/, '')}: HTTP ${response.status} ${(body.errors || []).map(e => `${e.code} ${e.message}`).join('; ')}`)
  return body.result
}

const found = []
if (claimId !== '-') {
  const tunnels = await cf('GET', `/accounts/${account}/cfd_tunnel?is_deleted=false&name=${encodeURIComponent(`sbx-${claimId}`)}`)
  for (const tunnel of tunnels) found.push({ kind: 'tunnel', id: tunnel.id, label: tunnel.name })
}
for (const name of names) {
  const records = await cf('GET', `/zones/${zone}/dns_records?name=${encodeURIComponent(`${name}.slatebox.team`)}`)
  for (const record of records) found.push({ kind: 'dns', id: record.id, label: `${record.type} ${record.name}` })
}
process.stdout.write(`leftover tunnels: ${found.filter(item => item.kind === 'tunnel').length}, leftover DNS records: ${found.filter(item => item.kind === 'dns').length}\n`)
for (const item of found) process.stdout.write(`  BUG: left behind ${item.kind} ${item.label}\n`)
if (remove) {
  for (const item of found) {
    if (item.kind === 'dns') await cf('DELETE', `/zones/${zone}/dns_records/${item.id}`)
    else {
      await cf('DELETE', `/accounts/${account}/cfd_tunnel/${item.id}/connections`).catch(() => {})
      await cf('DELETE', `/accounts/${account}/cfd_tunnel/${item.id}`)
    }
    process.stdout.write(`  deleted ${item.kind} ${item.label}\n`)
  }
}
process.exit(found.length ? 1 : 0)
