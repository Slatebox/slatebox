#!/bin/sh
# Written by the slatebox installer: automatic updates for the Slatebox "team".
# Run every five minutes by systemd; safe to run by hand. It changes nothing unless Admin › Updates
# (or `slatebox updates apply`) says so, and then only to a release signed by Slatebox, pulled by digest.
# Turn it off with: npx slatebox updates disable --name team
set -u
umask 077
docker=/usr/bin/docker
name=team
dir=/opt/slatebox/team
socket=/var/run/docker.sock
mkdir -p "$dir/updates"
log="$dir/updates/updates.log"
lock="$dir/updates/lock"
inflight="$dir/updates/in-flight"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
exists() { "$docker" inspect --format '{{.Id}}' "$1" >/dev/null 2>&1; }

# One run at a time, and never beside `slatebox upgrade` (it takes the same lock, as "upgrade").
take_lock() { mkdir "$lock" 2>/dev/null && echo "updater $(now)" > "$lock/owner"; }
if ! take_lock; then
  stale=$(find "$lock" -maxdepth 0 -mmin +180 2>/dev/null)
  # A run of this script that died with the computer or Docker: no updater container is left.
  if [ -z "$stale" ] && grep -q '^updater' "$lock/owner" 2>/dev/null && [ -n "$(find "$lock" -maxdepth 0 -mmin +15 2>/dev/null)" ] && ! exists "$name-updater"; then
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
        "$docker" run --rm -i --network none --volume "$name-data:/data" --entrypoint /bin/sh "$previous" -c 'umask 077; cat > /data/restore-on-start.gz.part && mv /data/restore-on-start.gz.part /data/restore-on-start.gz' < "$backup" >> "$log" 2>&1 || backup=
      else
        backup=
      fi
      if "$docker" start "$name" >> "$log" 2>&1; then
        detail="The update was cut off (the server or Docker restarted) before it finished, so the version from before it was put back${backup:+ with its data from before the upgrade}."
        [ "$kind" = rollback ] || outcome=rolled-back
      fi
    fi
    [ "$outcome" != failed ] || [ "$kind" = rollback ] || detail='The update was cut off (the server or Docker restarted) and the previous container could not be started again. Run: npx slatebox upgrade --name team'
  fi
  if [ -n "$attempt" ]; then
    printf '{"attemptId":"%s","phase":"%s","detail":"%s","kind":"%s","from":"%s"}\n' "$attempt" "$outcome" "$detail" "${kind:-apply}" "$from" > "$dir/updates/pending-report.json"
  fi
  rm -f "$inflight"
fi

# Slatebox is not running (stopped, or being changed by hand): nothing to do now.
"$docker" exec "$name" /opt/slatebox/bin/slatebox updates heartbeat --updater 1 --scheduler systemd --feed-url https://mirror.example/update-feed/channels.json >/dev/null 2>>"$log" || exit 0

# A run that could not reach Slatebox at the end left its outcome here: deliver it now.
if [ -f "$dir/updates/pending-report.json" ]; then
  if "$docker" exec -i "$name" /opt/slatebox/bin/slatebox updates report --pending < "$dir/updates/pending-report.json" >/dev/null 2>>"$log"; then
    rm -f "$dir/updates/pending-report.json"
  fi
fi

decision=$("$docker" exec "$name" /opt/slatebox/bin/slatebox updates policy --json 2>>"$log") || exit 0
case "$decision" in
  *'"action":"apply"'*|*'"action":"rollback"'*) ;;
  *) exit 0 ;;
esac
# Never a folder where the socket should be (docker run -v would make one): say so and stop.
if [ ! -S "$socket" ]; then
  echo "$(now) no Docker socket at $socket: run npx slatebox updates enable --name team again" >> "$log"
  exit 1
fi
image=$("$docker" inspect --format '{{.Image}}' "$name") || exit 1
# As the folder's owner, in the socket's group: what it rewrites (install.yaml, the settings, the
# backups) stays readable by whoever runs npx slatebox here.
user="$(stat -c %u "$dir"):$(stat -c %g "$dir")"
group=$(stat -c %g "$socket")
echo "$(now) starting: $decision" >> "$log"
"$docker" run --rm --user "$user" --group-add "$group" --name "$name-updater" --network host \
  -v "$socket:/var/run/docker.sock" \
  -v "$dir:$dir" \
  -v /srv/backups:/srv/backups \
  -e SLATEBOX_UPDATE_DECISION="$decision" -e HOME=/tmp \
  --entrypoint /opt/slatebox/bin/slatebox-updater "$image" \
  --name "$name" --dir "$dir" --backups /srv/backups --feed-url https://mirror.example/update-feed/channels.json >> "$log" 2>&1
code=$?
echo "$(now) finished with exit code $code" >> "$log"
# Keep the log short: the last 2000 lines.
tail -n 2000 "$log" > "$log.tmp" 2>/dev/null && mv "$log.tmp" "$log"
exit $code
