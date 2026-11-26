// One change at a time: updater.sh, the updater container and `slatebox upgrade` take the same lock,
// a folder next to the install (mkdir is atomic on every filesystem the host may have). A lock
// older than STALE_LOCK_MINUTES belongs to a run that died and is taken over.
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { shq } from '../runner.mjs'
import { LOCK_DIR, STALE_LOCK_MINUTES } from './host-script.mjs'
import { EXIT, InstallError } from '../errors.mjs'

const held = (host, lock) => new InstallError(EXIT.PRECONDITION, `An automatic update of "${host.name}" is running on ${host.where} now (${lock}). Wait a few minutes for it to finish, then try again.`, { lock })

function takeLocal(lock, now = Date.now()) {
  mkdirSync(join(lock, '..'), { recursive: true, mode: 0o700 })
  try {
    mkdirSync(lock)
    return true
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (existsSync(lock) && now - statSync(lock).mtimeMs > STALE_LOCK_MINUTES * 60_000) {
      rmSync(lock, { recursive: true, force: true })
      mkdirSync(lock)
      return true
    }
    return false
  }
}

/** Take the lock on a host (targets/hosts.mjs), run fn, give it back. */
export async function withUpdateLock(host, fn) {
  const lock = join(host.dir, LOCK_DIR)
  if (host.kind === 'local') {
    if (!takeLocal(lock)) throw held(host, lock)
    try { return await fn() } finally { rmSync(lock, { recursive: true, force: true }) }
  }
  const take = `mkdir -p ${shq(join(host.dir, 'updates'))} && { mkdir ${shq(lock)} 2>/dev/null && echo taken || { [ -n "$(find ${shq(lock)} -maxdepth 0 -mmin +${STALE_LOCK_MINUTES} 2>/dev/null)" ] && rm -rf ${shq(lock)} && mkdir ${shq(lock)} && echo taken; } || echo held; }`
  const result = await host.sh(take)
  // A server without the folder yet (or an old fake) answers nothing: only a clear "held" stops the upgrade.
  if (String(result.stdout).includes('held')) throw held(host, lock)
  try {
    return await fn()
  } finally {
    await host.sh(`rm -rf ${shq(lock)}`)
  }
}
