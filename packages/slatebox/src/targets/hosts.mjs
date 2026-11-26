// A Docker host: this computer, or a Linux server reached over SSH. The
// install flow (docker.mjs) is the same for both; only these primitives differ.
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync, chmodSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { EXIT, InstallError } from '../errors.mjs'
import { shq } from '../runner.mjs'

// What `slatebox restore-on-start` (run by the image's init before the app) loads: written whole, then renamed.
export const RESTORE_ON_START = '/data/restore-on-start.gz'
const STAGE_RESTORE = `umask 077; cat > ${RESTORE_ON_START}.part && mv ${RESTORE_ON_START}.part ${RESTORE_ON_START}`

function bindable(port, address) {
  return new Promise(resolve => {
    const server = createServer()
    server.once('error', error => resolve(['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(error.code) ? 'n/a' : false))
    server.listen({ port, host: address, exclusive: true }, () => server.close(() => resolve(true)))
  })
}

/**
 * Is a TCP port free on this computer? Bind it on every interface, as Docker
 * would, and on the loopback addresses too: on macOS a dev server on
 * 127.0.0.1 or ::1 does not stop a bind on 0.0.0.0, yet it answers
 * http://localhost:<port> first.
 */
export async function portFree(port) {
  for (const address of ['0.0.0.0', '127.0.0.1', '::1']) {
    if ((await bindable(port, address)) === false) return false
  }
  return true
}

/** The absolute path of a program on PATH, or null (cron runs with a short PATH, so scripts name it in full). */
export function which(name, path = process.env.PATH || '') {
  for (const dir of path.split(':').filter(Boolean)) {
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      if (statSync(candidate).isFile()) return candidate
    } catch { /* not here */ }
  }
  return null
}

// The files an install writes into its folder; deleting data removes these and nothing else.
export const MARKER = '.slatebox-install'
export const INSTALL_FILES = ['slatebox.env', 'secrets.env', 'secrets.kept.env', 'backup.sh', 'backup.log', 'install.yaml', MARKER]
const BACKUP_FILES = ['slatebox-*.gz', 'pre-upgrade-*.gz', '*.gz.part']

export async function firstFreePort(from = 7070, tries = 100) {
  for (let port = from; port < from + tries; port++) if (await portFree(port)) return port
  return null
}

export function localHost(ctx, { dir, name }) {
  const docker = (args, options) => ctx.run('docker', args, options)
  return {
    kind: 'local',
    where: 'this computer',
    dir,
    name,
    // Is a port free on this computer? (tests stand in for the real bind with ctx.portFree)
    portFree: port => (ctx.portFree ?? portFree)(port),
    docker,
    async readFile(path) {
      return existsSync(path) ? readFileSync(path, 'utf8') : null
    },
    async writeFile(path, content, mode = 0o600) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      writeFileSync(`${path}.tmp`, content, { mode })
      chmodSync(`${path}.tmp`, mode)
      renameSync(`${path}.tmp`, path)
    },
    async readMarker() {
      const path = join(dir, MARKER)
      return existsSync(path) ? readFileSync(path, 'utf8').trim() : null
    },
    async removeInstall({ backups }) {
      for (const file of INSTALL_FILES) rmSync(join(dir, file), { force: true })
      if (backups && existsSync(backups)) {
        const { readdirSync } = await import('node:fs')
        for (const file of readdirSync(backups)) if (/^(slatebox-|pre-upgrade-).*\.gz(\.part)?$/.test(file)) rmSync(join(backups, file), { force: true })
        try { rmdirSync(backups) } catch { /* not empty: someone else's files */ }
      }
      try { rmdirSync(dir) } catch { /* not empty */ }
    },
    loadArchive: file => docker(['load', '-i', file], { timeout: 60 * 60_000 }),
    /** A complete backup into a file on this host (the image writes nothing until the archive checks out). */
    async backupToFile(container, path) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      const result = await docker(['exec', container, '/opt/slatebox/bin/slatebox', 'backup'], { outputFile: path, timeout: 60 * 60_000 })
      if (result.code !== 0) rmSync(path, { force: true })
      return result
    },
    restoreFromFile: (container, path) => docker(['exec', '-i', container, '/opt/slatebox/bin/slatebox', 'restore'], { inputFile: path, timeout: 60 * 60_000 }),
    restoreFromLocal(container, path) { return this.restoreFromFile(container, path) },
    /** Leave a backup in the data volume for the image to load when it next starts, before its app (no container may run on it). */
    stageRestore: (volume, image, path) => docker(['run', '--rm', '-i', '--network', 'none', '--volume', `${volume}:/data`, '--entrypoint', '/bin/sh', image, '-c', STAGE_RESTORE], { inputFile: path, timeout: 60 * 60_000 }),
    sh: (script, options) => ctx.run('sh', ['-s'], { input: script, ...options }),
  }
}

/**
 * A server over SSH, with the system ssh (so ~/.ssh/config, ProxyJump, agents
 * and hardware keys work). One multiplexed connection; every step is a small
 * script on standard input, never left on the server.
 */
export function sshHost(ctx, ssh, { name, home }) {
  const controlDir = join(home, 'cm')
  const multiplex = controlDir.length < 50
  if (multiplex) mkdirSync(controlDir, { recursive: true, mode: 0o700 })
  const base = [
    '-o', 'BatchMode=yes',
    ...(multiplex ? ['-o', 'ControlMaster=auto', '-o', `ControlPath=${join(controlDir, '%C')}`, '-o', 'ControlPersist=120'] : []),
    '-p', String(ssh.port),
    ...(ssh.identity ? ['-i', ssh.identity.replace(/^~(?=\/)/, ctx.env.HOME || '')] : []),
    ...ssh.options.flatMap(option => ['-o', option]),
    ssh.user ? `${ssh.user}@${ssh.host}` : ssh.host,
  ]
  const host = {
    kind: 'ssh',
    where: `${ssh.user ? `${ssh.user}@` : ''}${ssh.host}`,
    dir: ssh.dir,
    name,
    sudo: '',
    remote: (command, options) => ctx.run('ssh', [...base, command], options),
    docker: (args, options) => host.remote(`${host.sudo}docker ${args.map(shq).join(' ')}`, options),
    // The directory is root's (mode 0700): docker reads the env files in it under sudo, never as the login user.
    /** The file's text; null only when it does not exist. Any other failure is an error, never "no file". */
    async readFile(path) {
      const script = `if [ -e ${shq(path)} ]; then cat ${shq(path)}; else exit 3; fi`
      const result = await host.remote(`${host.sudo}sh -c ${shq(script)}`)
      if (result.code === 0) return result.stdout
      if (result.code === 3) return null
      throw new InstallError(EXIT.PRECONDITION, `Could not read ${path} on ${host.where}: ${result.stderr.trim().split('\n').pop() || `exit ${result.code}`}. Nothing was changed.`)
    },
    async writeFile(path, content, mode = 0o600) {
      const octal = mode.toString(8)
      const script = `umask 077; mkdir -p ${shq(dirname(path))} && cat > ${shq(`${path}.tmp`)} && chmod ${octal} ${shq(`${path}.tmp`)} && mv ${shq(`${path}.tmp`)} ${shq(path)}`
      const result = await host.remote(`${host.sudo}sh -c ${shq(script)}`, { input: content })
      if (result.code !== 0) throw new Error(`Could not write ${path} on ${host.where}: ${result.stderr.trim()}`)
    },
    async readMarker() {
      const result = await host.remote(`${host.sudo}cat ${shq(join(ssh.dir, MARKER))}`)
      return result.code === 0 ? result.stdout.trim() : null
    },
    async removeInstall({ backups }) {
      const files = INSTALL_FILES.map(file => shq(join(ssh.dir, file))).join(' ')
      const old = backups ? BACKUP_FILES.map(glob => `${shq(backups)}/${glob}`).join(' ') : ''
      const script = `rm -f ${files}${backups ? `; rm -f ${old}; rmdir ${shq(backups)} 2>/dev/null` : ''}; rmdir ${shq(ssh.dir)} 2>/dev/null; true`
      const result = await host.remote(`${host.sudo}sh -c ${shq(script)}`)
      if (result.code !== 0) throw new Error(`Could not remove the install files on ${host.where}: ${result.stderr.trim()}`)
    },
    loadArchive: file => host.remote(`${host.sudo}docker load`, { inputFile: file, timeout: 60 * 60_000 }),
    async backupToFile(container, path) {
      const script = `umask 077; mkdir -p ${shq(dirname(path))} && if docker exec ${shq(container)} /opt/slatebox/bin/slatebox backup > ${shq(`${path}.part`)}; then mv ${shq(`${path}.part`)} ${shq(path)}; else rm -f ${shq(`${path}.part`)}; exit 1; fi`
      return host.remote(`${host.sudo}sh -c ${shq(script)}`, { timeout: 60 * 60_000 })
    },
    restoreFromFile: (container, path) => host.remote(`${host.sudo}sh -c ${shq(`docker exec -i ${shq(container)} /opt/slatebox/bin/slatebox restore < ${shq(path)}`)}`, { timeout: 60 * 60_000 }),
    stageRestore: (volume, image, path) => host.remote(`${host.sudo}sh -c ${shq(`docker run --rm -i --network none --volume ${shq(`${volume}:/data`)} --entrypoint /bin/sh ${shq(image)} -c ${shq(STAGE_RESTORE)} < ${shq(path)}`)}`, { timeout: 60 * 60_000 }),
    restoreFromLocal: (container, file) => host.remote(`${host.sudo}docker exec -i ${shq(container)} /opt/slatebox/bin/slatebox restore`, { inputFile: file, timeout: 60 * 60_000 }),
    sh: (script, options) => host.remote(`${host.sudo}sh -s`, { input: script, ...options }),
    close: () => (multiplex ? ctx.run('ssh', ['-O', 'exit', ...base], { timeout: 10_000 }) : null),
  }
  return host
}

/** What the server is, before anything is changed on it. One round trip. */
export function remotePreflightScript(ports) {
  return `
set -u
uid=$(id -u)
echo "uid=$uid"
S=""
if [ "$uid" != 0 ]; then
  if sudo -n true 2>/dev/null; then echo "sudo=yes"; S="sudo -n "; else echo "sudo=no"; fi
fi
echo "arch=$(uname -m)"
if [ -r /etc/os-release ]; then . /etc/os-release; echo "os=\${ID:-unknown} \${VERSION_ID:-}"; fi
d=$(command -v docker 2>/dev/null || true)
echo "docker_path=$d"
if [ -n "$d" ]; then
  echo "docker_server=$($S docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
fi
echo "systemd=$([ -d /run/systemd/system ] && echo yes || echo no)"
echo "cron=$([ -d /etc/cron.d ] && echo yes || echo no)"
echo "disk_kb=$(df -Pk / 2>/dev/null | awk 'NR==2{print $4}')"
echo "mem_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null)"
if command -v ss >/dev/null 2>&1; then
  echo "listening=$(ss -ltnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -un | tr '\\n' ' ')"
else
  l=""; for p in ${ports.join(' ')}; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && l="$l $p"; done; echo "listening=$l"
fi
if command -v ufw >/dev/null 2>&1; then echo "ufw=$($S ufw status 2>/dev/null | head -1 | awk '{print $2}')"; fi
if command -v firewall-cmd >/dev/null 2>&1; then echo "firewalld=$($S firewall-cmd --state 2>/dev/null || true)"; fi
echo "addresses=$(hostname -I 2>/dev/null || true)"
`
}

export function parseKeyValues(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return out
}
