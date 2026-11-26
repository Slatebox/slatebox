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
// Written by the updater just before it sets the running container aside; gone when it finishes.
export const IN_FLIGHT = 'updates/in-flight'
// Written by the updater as it starts (the attempt's id): a docker run that ends 125 after this was
// the updater's own run (Docker lost the connection, or --rm could not remove it), not "never started".
export const STARTED = 'updates/started'
export const UPDATES_LOG = 'updates/updates.log'
// The options this script was written with (no secrets): after an update, the version now running
// rewrites updater.sh from them (slatebox-updater --write-host-script), so fixes to it arrive the same way.
export const HOST_SCRIPT_OPTIONS = 'updates/host-script.json'
export const SLATEBOX_BIN = '/opt/slatebox/bin/slatebox'
export const UPDATER_BIN = '/opt/slatebox/bin/slatebox-updater'
// A lock older than this belongs to a run that died (a lease in the app ends after 2 hours too).
export const STALE_LOCK_MINUTES = 180

// A run of updater.sh that died (the computer restarted, Docker stopped) while its updater
// container ran leaves its lock with no container: after this long that lock is taken over too.
export const DEAD_LOCK_MINUTES = 15
export const DOCKER_SOCKET = '/var/run/docker.sock'
const STAGE_RESTORE = 'umask 077; cat > /data/restore-on-start.gz.part && mv /data/restore-on-start.gz.part /data/restore-on-start.gz'

/**
 * @param {object} options
 *   name, dir           the install and its folder (the same path on the host and in the updater container)
 *   docker              the docker program, by full path (schedulers run with a short PATH)
 *   backups             the backups folder when it is outside dir (mounted too), else null
 *   hostNetwork         Linux: the updater shares the host's network, so the install's own address answers
 *   outsideUrl          macOS (Docker Desktop, OrbStack, Colima): how the updater reaches the published port
 *   feedUrl             another signed feed (tests, mirrors); null for GitHub's
 *   scheduler           launchd, systemd or cron: reported with each heartbeat
 *   socket              the Docker socket on the host (rootless Docker: $XDG_RUNTIME_DIR/docker.sock)
 *   asOwner             Linux: run the updater as the folder's owner (and the socket's group), so the
 *                       files it rewrites stay the owner's; macOS VMs map ownership themselves
 */
export function updaterScript({ name, dir, docker = 'docker', backups = null, hostNetwork = true, outsideUrl = null, feedUrl = null, scheduler = 'cron', protocol = 1, socket = DOCKER_SOCKET, asOwner = hostNetwork }) {
  const d = shq(docker)
  // Linux: --mount, so a socket that is not there stops docker run (-v would make a folder in its
  // place). A Mac's socket is always there inside the Docker VM, and -v is the one form Docker
  // Desktop, OrbStack and Colima all document for it.
  const socketMount = hostNetwork ? `--mount type=bind,source="$socket",target=/var/run/docker.sock` : `-v "$socket:/var/run/docker.sock"`
  const mounts = [socketMount, `-v "$dir:$dir"`, ...(backups ? [`-v ${shq(backups)}:${shq(backups)}`] : [])]
  const network = hostNetwork ? '--network host' : '--add-host host.docker.internal:host-gateway'
  const extra = [...(backups ? [`--backups ${shq(backups)}`] : []), ...(outsideUrl ? [`--outside-url ${shq(outsideUrl)}`] : []), ...(feedUrl ? [`--feed-url ${shq(feedUrl)}`] : [])]
  const pending = `$dir/${PENDING_REPORT}`
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
socket=${shq(socket)}
mkdir -p "$dir/${UPDATES_DIR}"
log="$dir/${UPDATES_LOG}"
lock="$dir/${LOCK_DIR}"
inflight="$dir/${IN_FLIGHT}"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
exists() { "$docker" inspect --format '{{.Id}}' "$1" >/dev/null 2>&1; }

# One run at a time, and never beside \`slatebox upgrade\` (it takes the same lock, as "upgrade").
take_lock() { mkdir "$lock" 2>/dev/null && echo "updater $(now)" > "$lock/owner"; }
if ! take_lock; then
  stale=$(find "$lock" -maxdepth 0 -mmin +${STALE_LOCK_MINUTES} 2>/dev/null)
  # A run of this script that died with the computer or Docker: no updater container is left.
  if [ -z "$stale" ] && grep -q '^updater' "$lock/owner" 2>/dev/null && [ -n "$(find "$lock" -maxdepth 0 -mmin +${DEAD_LOCK_MINUTES} 2>/dev/null)" ] && ! exists "$name-updater"; then
    stale=yes
  fi
  [ -n "$stale" ] || exit 0
  echo "$(now) taking over a lock left by a run that died" >> "$log"
  rm -rf "$lock"
  take_lock || exit 0
fi
trap 'rm -rf "$lock"' EXIT
trap 'exit 1' INT TERM

# An update cut off after it set Slatebox aside (the computer restarted, Docker stopped): put the
# previous container back (with the backup from before the upgrade, when its image loads one as it
# starts) and leave the outcome for Slatebox, so the site never stays down waiting for a person.
if [ -f "$inflight" ] || { ! exists "$name" && exists "$name-previous"; }; then
  field() { sed -n "s/^$1=//p" "$inflight" 2>/dev/null | head -n 1; }
  attempt=$(field attempt | tr -cd 'A-Za-z0-9-')
  kind=$(field kind | tr -cd 'a-z')
  from=$(field from | tr -cd 'A-Za-z0-9.+-')
  backup=$(field backup)
  outcome=failed
  detail='The update was cut off (the server or Docker restarted) before it finished; Slatebox runs as it was left. See Admin › Updates.'
  if exists "$name-previous"; then
    echo "$(now) recovering: an update was cut off; putting the previous container back" >> "$log"
    "$docker" rm --force "$name" >/dev/null 2>&1
    if "$docker" rename "$name-previous" "$name" >> "$log" 2>&1; then
      if [ -n "$backup" ] && [ -f "$backup" ]; then
        previous=$("$docker" inspect --format '{{.Image}}' "$name")
        "$docker" run --rm -i --network none --volume "$name-data:/data" --entrypoint /bin/sh "$previous" -c ${shq(STAGE_RESTORE)} < "$backup" >> "$log" 2>&1 || backup=
      else
        backup=
      fi
      if "$docker" start "$name" >> "$log" 2>&1; then
        detail="The update was cut off (the server or Docker restarted) before it finished, so the version from before it was put back\${backup:+ with its data from before the upgrade}."
        [ "$kind" = rollback ] || outcome=rolled-back
      fi
    fi
    [ "$outcome" != failed ] || [ "$kind" = rollback ] || detail='The update was cut off (the server or Docker restarted) and the previous container could not be started again. Run: npx slatebox upgrade${name === 'slatebox' ? '' : ` --name ${name}`}'
  fi
  if [ -n "$attempt" ]; then
    printf '{"attemptId":"%s","phase":"%s","detail":"%s","kind":"%s","from":"%s"}\\n' "$attempt" "$outcome" "$detail" "\${kind:-apply}" "$from" > "${pending}"
  fi
  rm -f "$inflight"
fi

# Slatebox is not running (stopped, or being changed by hand): nothing to do now.
"$docker" exec "$name" ${SLATEBOX_BIN} updates heartbeat --updater ${protocol} --scheduler ${shq(scheduler)}${feedUrl ? ` --feed-url ${shq(feedUrl)}` : ''} >/dev/null 2>>"$log" || exit 0

# A run that could not reach Slatebox at the end left its outcome here: deliver it now.
if [ -f "${pending}" ]; then
  if "$docker" exec -i "$name" ${SLATEBOX_BIN} updates report --pending < "${pending}" >/dev/null 2>>"$log"; then
    rm -f "${pending}"
  fi
fi

# What the updater needs is checked before Slatebox is asked what to do: asking starts an attempt.
${hostNetwork
    ? `# This computer runs Docker itself, so its socket is here: never a folder where it should be.
if [ ! -S "$socket" ]; then
  echo "$(now) no Docker socket at $socket: run npx slatebox updates enable${name === 'slatebox' ? '' : ` --name ${name}`} again" >> "$log"
  exit 1
fi`
    : '# The socket is the Docker VM\'s own (Docker Desktop, OrbStack, Colima): only Docker sees it, so docker run checks it.'}
image=$("$docker" inspect --format '{{.Image}}' "$name") || exit 1
${asOwner
    ? `# As the folder's owner, in the socket's group: what it rewrites (install.yaml, the settings, the
# backups) stays readable by whoever runs npx slatebox here.
user="$(stat -c %u "$dir"):$(stat -c %g "$dir")"
group=$(stat -c %g "$socket")`
    : 'user=0:0\ngroup=0'}
# An updater from an earlier run still works (this run's docker lost it, or the lock was taken over): leave it be.
if exists "$name-updater"; then exit 0; fi

decision=$("$docker" exec "$name" ${SLATEBOX_BIN} updates policy --json 2>>"$log") || exit 0
case "$decision" in
  *'"action":"apply"'*) kind=apply ;;
  *'"action":"rollback"'*) kind=rollback ;;
  *) exit 0 ;;
esac
attempt=$(printf '%s' "$decision" | sed -n 's/.*"attemptId":"\\([A-Za-z0-9-]*\\)".*/\\1/p')
started="$dir/${STARTED}"
rm -f "$started"
echo "$(now) starting: $decision" >> "$log"
"$docker" run --rm --user "$user" --group-add "$group" --name "$name-updater" ${network} \\
  ${mounts.join(' \\\n  ')} \\
  -e SLATEBOX_UPDATE_DECISION="$decision" -e HOME=/tmp \\
  --entrypoint ${UPDATER_BIN} "$image" \\
  --name "$name" --dir "$dir"${extra.length ? ` ${extra.join(' ')}` : ''} >> "$log" 2>&1
code=$?
echo "$(now) finished with exit code $code" >> "$log"
# 125 with no sign the updater ran (it writes $started first; nothing in flight, no report kept, no
# updater container left): Docker could not start it (the socket, the image), so it reported
# nothing. Say so now, or Admin › Updates would show the attempt running until its lease ran out.
# Any other 125 is the updater's own run, which reports for itself.
if [ "$code" -eq 125 ] && [ -n "$attempt" ] && [ ! -f "$started" ] && [ ! -f "$inflight" ] && [ ! -f "${pending}" ] && ! exists "$name-updater"; then
  detail='Docker could not start the updater on this host; nothing was changed. The reason is in updates/updates.log in the install folder.'
  "$docker" exec "$name" ${SLATEBOX_BIN} updates report --attempt "$attempt" --phase failed --kind "$kind" --detail "$detail" >/dev/null 2>>"$log" \\
    || printf '{"attemptId":"%s","phase":"failed","detail":"%s","kind":"%s"}\\n' "$attempt" "$detail" "$kind" > "${pending}"
fi
rm -f "$started"
# After an update or a rollback, the version now running writes this script again from the options
# it was made with, so a fix to it arrives the way the rest of Slatebox does, and the script always
# matches the version it talks to. The new one takes effect next run.
if [ "$code" -eq 0 ] && [ -f "$dir/${HOST_SCRIPT_OPTIONS}" ]; then
  running=$("$docker" inspect --format '{{.Image}}' "$name" 2>/dev/null)
  if [ -n "$running" ] && [ "$running" != "$image" ]; then
    "$docker" run --rm --user "$user" --network none -v "$dir:$dir" --entrypoint ${UPDATER_BIN} "$running" --write-host-script --dir "$dir" >> "$log" 2>&1 \\
      || echo "$(now) updater.sh was kept as it is: the version now running could not write it again" >> "$log"
  fi
fi
# Keep the log short: the last 2000 lines.
tail -n 2000 "$log" > "$log.tmp" 2>/dev/null && mv "$log.tmp" "$log"
exit $code
`
}
