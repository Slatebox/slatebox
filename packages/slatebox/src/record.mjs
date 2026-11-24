// The install record: the resolved answers of a successful install (secret
// references stay references), plus what the installer needs for upgrades.
// On this computer it lives in ~/.slatebox/installs/<name>/install.yaml; an
// SSH install keeps the same file on the server, and Kubernetes keeps it in a
// ConfigMap. Every target also keeps a copy here, so `slatebox status` and
// `upgrade` know where each install is.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse, stringify } from './yaml.mjs'

export function slateboxHome(env = process.env, flag) {
  return flag || env.SLATEBOX_INSTALL_HOME || join(env.HOME || homedir(), '.slatebox')
}

export const installDir = (home, name) => join(home, 'installs', name)
export const recordPath = (home, name) => join(installDir(home, name), 'install.yaml')

export function readRecord(home, name) {
  const path = recordPath(home, name)
  if (!existsSync(path)) return null
  return parse(readFileSync(path, 'utf8'))
}

export function recordText(record) {
  return `# The slatebox installer's record of the install "${record.name}". It holds no secrets.\n${stringify(record)}`
}

/** Write atomically, readable only by this user (it names where the secrets are). */
export function writeRecord(home, record) {
  const dir = installDir(home, record.name)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = recordPath(home, record.name)
  writeFileSync(`${path}.tmp`, recordText(record), { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
  chmodSync(path, 0o600)
  return path
}

export function listRecords(home) {
  const dir = join(home, 'installs')
  if (!existsSync(dir)) return []
  return readdirSync(dir).sort().map(name => {
    try { return readRecord(home, name) } catch { return { name, state: 'unreadable' } }
  }).filter(Boolean)
}
