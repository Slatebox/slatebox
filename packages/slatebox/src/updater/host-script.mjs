// updater.sh: the host side of self-hosted updates, written next to backup.sh and run every five
// minutes by launchd, a systemd timer or cron (schedule.mjs). Plain sh, no Node on the host.
//
// The usual run is one `docker exec` (the container says "nothing to do"). When there is
// something to do, it starts a short-lived container from the image that is running now (already
// trusted, pinned by its ID) with the Docker socket, and that container runs the installer's own
// upgrade path (run.mjs): it fetches and checks the signed release itself, backs up, swaps, checks
// health and rolls back on failure.
import { shq } from '../runner.mjs'

export const UPDATER_SCRIPT = 'updater.sh'
export const UPDATES_DIR = 'updates'
export const LOCK_DIR = 'updates/lock'
export const PENDING_REPORT = 'updates/pending-report.json'
export const UPDATES_LOG = 'updates/updates.log'
export const SLATEBOX_BIN = '/opt/slatebox/bin/slatebox'
export const UPDATER_BIN = '/opt/slatebox/bin/slatebox-updater'
// A lock older than this belongs to a run that died (a lease in the app ends after 2 hours too).
export const STALE_LOCK_MINUTES = 180

/**
 * @param {object} options
 *   name, dir           the install and its folder (the same path on the host and in the updater container)
 *   docker              the docker program, by full path (schedulers run with a short PATH)
 *   backups             the backups folder when it is outside dir (mounted too), else null
 *   hostNetwork         Linux: the updater shares the host's network, so the install's own address answers
 *   outsideUrl          macOS (Docker Desktop, OrbStack, Colima): how the updater reaches the published port
 *   feedUrl             another signed feed (tests, mirrors); null for GitHub's
 *   scheduler           launchd, systemd or cron: reported with each heartbeat
 */
export function updaterScript({ name, dir, docker = 'docker', backups = null, hostNetwork = true, outsideUrl = null, feedUrl = null, scheduler = 'cron', protocol = 1 }) {
  const d = shq(docker)
  const mounts = [`-v /var/run/docker.sock:/var/run/docker.sock`, `-v "$dir:$dir"`, ...(backups ? [`-v ${shq(backups)}:${shq(backups)}`] : [])]
  const network = hostNetwork ? '--network host' : '--add-host host.docker.internal:host-gateway'
  const extra = [...(backups ? [`--backups ${shq(backups)}`] : []), ...(outsideUrl ? [`--outside-url ${shq(outsideUrl)}`] : []), ...(feedUrl ? [`--feed-url ${shq(feedUrl)}`] : [])]
  return `#!/bin/sh
# Written by the slatebox installer: automatic updates for the Slatebox "${name}".
# Run every five minutes by ${scheduler}; safe to run by hand. It changes nothing unless Admin › Updates
# (or \`slatebox updates apply\`) says so, and then only to a release signed by Slatebox, pulled by digest.
# Turn it off with: npx slatebox updates disable${name === 'slatebox' ? '' : ` --name ${name}`}
set -u
umask 077
docker=${d}
name=${shq(name)}
dir=${shq(dir)}
mkdir -p "$dir/${UPDATES_DIR}"
log="$dir/${UPDATES_LOG}"
lock="$dir/${LOCK_DIR}"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# One run at a time, and never beside \`slatebox upgrade\` (it takes the same lock).
if ! mkdir "$lock" 2>/dev/null; then
  if [ -n "$(find "$lock" -maxdepth 0 -mmin +${STALE_LOCK_MINUTES} 2>/dev/null)" ]; then
    rm -rf "$lock"
    mkdir "$lock" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rm -rf "$lock"' EXIT
trap 'exit 1' INT TERM

# Slatebox is not running (stopped, or being changed by hand): nothing to do now.
"$docker" exec "$name" ${SLATEBOX_BIN} updates heartbeat --updater ${protocol} --scheduler ${shq(scheduler)}${feedUrl ? ` --feed-url ${shq(feedUrl)}` : ''} >/dev/null 2>>"$log" || exit 0

# A run that could not reach Slatebox at the end left its outcome here: deliver it now.
if [ -f "$dir/${PENDING_REPORT}" ]; then
  if "$docker" exec -i "$name" ${SLATEBOX_BIN} updates report --pending < "$dir/${PENDING_REPORT}" >/dev/null 2>>"$log"; then
    rm -f "$dir/${PENDING_REPORT}"
  fi
fi

decision=$("$docker" exec "$name" ${SLATEBOX_BIN} updates policy --json 2>>"$log") || exit 0
case "$decision" in
  *'"action":"apply"'*|*'"action":"rollback"'*) ;;
  *) exit 0 ;;
esac
image=$("$docker" inspect --format '{{.Image}}' "$name") || exit 1
echo "$(now) starting: $decision" >> "$log"
"$docker" run --rm --user 0:0 --name "$name-updater" ${network} \\
  ${mounts.join(' \\\n  ')} \\
  -e SLATEBOX_UPDATE_DECISION="$decision" \\
  --entrypoint ${UPDATER_BIN} "$image" \\
  --name "$name" --dir "$dir"${extra.length ? ` ${extra.join(' ')}` : ''} >> "$log" 2>&1
code=$?
echo "$(now) finished with exit code $code" >> "$log"
# Keep the log short: the last 2000 lines.
tail -n 2000 "$log" > "$log.tmp" 2>/dev/null && mv "$log.tmp" "$log"
exit $code
`
}
