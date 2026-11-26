// Slatebox LLC's side of license keys: signs Slatebox Cloud's own key (--kind cloud), or an on-prem
// key (what Cloud's license issuer still makes; no self-hosted install needs or reads one now). MIT. The private key never enters this repository; pass
// its file. Prints the key on one line. Every key names the host names it covers (--host, at least
// one): one on-prem license covers one install.
//
//   node scripts/license-sign.mjs --key <private key .pem> --kid slatebox-2026-11 \
//     --licensee "Example Co" --id lic_example_1 --host slatebox.example.com [--host ...] \
//     [--kind on-prem|cloud] [--from 2026-12-01] [--days 365]
//   node scripts/license-sign.mjs --keygen <dir> --kid <new key id>   a new key pair: add the printed
//     public half to LICENSE_KEYS in web/app/server/enterprise-license.mjs; keep the private half secret.
//   node scripts/license-sign.mjs --check <license key or file>      what a key says, checked against LICENSE_KEYS
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { signLicense, verifyLicense } from '../web/app/server/enterprise-license.mjs'

const { values } = parseArgs({
  options: {
    key: { type: 'string' }, kid: { type: 'string' }, licensee: { type: 'string' }, id: { type: 'string' },
    from: { type: 'string' }, days: { type: 'string', default: '365' }, host: { type: 'string', multiple: true },
    keygen: { type: 'string' }, check: { type: 'string' }, kind: { type: 'string', default: 'on-prem' },
  },
})
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)

if (values.keygen) {
  if (!values.kid) throw new Error('--kid names the new key')
  mkdirSync(values.keygen, { recursive: true, mode: 0o700 })
  const file = join(values.keygen, `${values.kid}.private.pem`)
  if (existsSync(file)) throw new Error(`${file} exists`)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  console.log(`private key: ${file} (keep it secret)`)
  console.log(`LICENSE_KEYS entry: '${values.kid}': '${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}',`)
} else if (values.check) {
  const text = existsSync(values.check) ? readFileSync(values.check, 'utf8').trim() : values.check
  console.log(JSON.stringify(verifyLicense(text, { host: values.host?.[0] || '' }), null, 2))
} else {
  if (!values.key || !values.kid || !values.licensee || !values.id) throw new Error('--key, --kid, --licensee and --id are needed')
  if (!values.host?.length) throw new Error('--host is needed: a key covers the installs it names, one on-prem license per install')
  if (values.kind !== 'on-prem' && values.kind !== 'cloud') throw new Error('--kind is on-prem or cloud')
  const from = values.from ? Date.parse(values.from + 'T00:00:00Z') : Date.now()
  const days = Number(values.days)
  if (!Number.isFinite(from) || !Number.isInteger(days) || days < 1) throw new Error('--from is YYYY-MM-DD and --days a whole number')
  const payload = { id: values.id, licensee: values.licensee, issuedAt: iso(from), expiresAt: iso(from + (days - 1) * 86_400_000), kind: values.kind, hosts: values.host.map((name) => name.toLowerCase()) }
  console.log(await signLicense(payload, { kid: values.kid, privateKey: readFileSync(values.key, 'utf8') }))
}
