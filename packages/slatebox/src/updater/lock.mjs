// One change at a time: updater.sh, the updater container and `slatebox upgrade` take the same lock,
// a folder next to the install (mkdir is atomic on every filesystem the host may have), with an
// owner file that says who holds it ("updater ..." or "upgrade ..."). A lock older than
// STALE_LOCK_MINUTES belongs to a run that died and is taken over; so is an updater's lock older
// than DEAD_LOCK_MINUTES when no updater container runs (the computer or Docker restarted under it).
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { shq } from '../runner.mjs'
import { DEAD_LOCK_MINUTES, LOCK_DIR, STALE_LOCK_MINUTES } from './host-script.mjs'
import { EXIT, InstallError } from '../errors.mjs'

const held = (host, lock, owner) => new InstallError(EXIT.PRECONDITION, /^upgrade/.test(owner || '')
  ? `Another slatebox upgrade of "${host.name}" is running on ${host.where} now (${lock}). Wait for it to finish, then try again.`
  : `An automatic update of "${host.name}" is running on ${host.where} now (${lock}). Wait a few minutes for it to finish, then try again.`, { lock })

const ownerLine = () => `upgrade ${new Date().toISOString()}\n`

async function updaterRuns(host) {
  return (await host.docker(['inspect', '--format', '{{.Id}}', `${host.name}-updater`])).code === 0
}

async function takeLocal(host, lock, now = Date.now()) {
  mkdirSync(join(lock, '..'), { recursive: true, mode: 0o700 })
  const take = () => { mkdirSync(lock); writeFileSync(join(lock, 'owner'), ownerLine()); return { taken: true } }
  try {
    return take()
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const owner = existsSync(join(lock, 'owner')) ? readFileSync(join(lock, 'owner'), 'utf8') : ''
    const age = existsSync(lock) ? now - statSync(lock).mtimeMs : 0
    const dead = /^updater/.test(owner) && age > DEAD_LOCK_MINUTES * 60_000 && !(await updaterRuns(host))
    if (age > STALE_LOCK_MINUTES * 60_000 || dead) {
      rmSync(lock, { recursive: true, force: true })
      return take()
    }
    return { taken: false, owner }
  }
}

/** Take the lock on a host (targets/hosts.mjs), run fn, give it back. */
export async function withUpdateLock(host, fn) {
  const lock = join(host.dir, LOCK_DIR)
  if (host.kind === 'local') {
    const got = await takeLocal(host, lock)
    if (!got.taken) throw held(host, lock, got.owner)
    try { return await fn() } finally { rmSync(lock, { recursive: true, force: true }) }
  }
  const l = shq(lock)
  const updater = shq(`${host.name}-updater`)
  const take = `mkdir -p ${shq(join(host.dir, 'updates'))} && { ` +
    `if mkdir ${l} 2>/dev/null; then echo ${shq(ownerLine().trim())} > ${l}/owner; echo taken; ` +
    `elif [ -n "$(find ${l} -maxdepth 0 -mmin +${STALE_LOCK_MINUTES} 2>/dev/null)" ] || { grep -q '^updater' ${l}/owner 2>/dev/null && [ -n "$(find ${l} -maxdepth 0 -mmin +${DEAD_LOCK_MINUTES} 2>/dev/null)" ] && ! docker inspect --format '{{.Id}}' ${updater} >/dev/null 2>&1; }; then ` +
    `rm -rf ${l} && mkdir ${l} && echo ${shq(ownerLine().trim())} > ${l}/owner && echo taken; ` +
    `else echo "held $(head -c 40 ${l}/owner 2>/dev/null)"; fi; }`
  const result = await host.sh(take)
  // A server without the folder yet (or an old fake) answers nothing: only a clear "held" stops the upgrade.
  const said = String(result.stdout)
  if (said.includes('held')) throw held(host, lock, said.slice(said.indexOf('held') + 5))
  try {
    return await fn()
  } finally {
    await host.sh(`rm -rf ${l}`)
  }
}
