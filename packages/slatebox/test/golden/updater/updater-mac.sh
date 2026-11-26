#!/bin/sh
# Written by the slatebox installer: automatic updates for the Slatebox "slatebox".
# Run every five minutes by launchd; safe to run by hand. It changes nothing unless Admin › Updates
# (or `slatebox updates apply`) says so, and then only to a release signed by Slatebox, pulled by digest.
# Turn it off with: npx slatebox updates disable
set -u
umask 077
docker=/usr/local/bin/docker
name=slatebox
dir=/Users/me/.slatebox/installs/slatebox
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
    [ "$outcome" != failed ] || [ "$kind" = rollback ] || detail='The update was cut off (the server or Docker restarted) and the previous container could not be started again. Run: npx slatebox upgrade'
  fi
  if [ -n "$attempt" ]; then
    printf '{"attemptId":"%s","phase":"%s","detail":"%s","kind":"%s","from":"%s"}\n' "$attempt" "$outcome" "$detail" "${kind:-apply}" "$from" > "$dir/updates/pending-report.json"
  fi
  rm -f "$inflight"
fi

# Slatebox is not running (stopped, or being changed by hand): nothing to do now.
"$docker" exec "$name" /opt/slatebox/bin/slatebox updates heartbeat --updater 1 --scheduler launchd >/dev/null 2>>"$log" || exit 0

# A run that could not reach Slatebox at the end left its outcome here: deliver it now.
if [ -f "$dir/updates/pending-report.json" ]; then
  if "$docker" exec -i "$name" /opt/slatebox/bin/slatebox updates report --pending < "$dir/updates/pending-report.json" >/dev/null 2>>"$log"; then
    rm -f "$dir/updates/pending-report.json"
  fi
fi

# What the updater needs is checked before Slatebox is asked what to do: asking starts an attempt.
# The socket is the Docker VM's own (Docker Desktop, OrbStack, Colima): only Docker sees it, so docker run checks it.
image=$("$docker" inspect --format '{{.Image}}' "$name") || exit 1
user=0:0
group=0
# An updater from an earlier run still works (this run's docker lost it, or the lock was taken over): leave it be.
if exists "$name-updater"; then exit 0; fi

decision=$("$docker" exec "$name" /opt/slatebox/bin/slatebox updates policy --json 2>>"$log") || exit 0
case "$decision" in
  *'"action":"apply"'*) kind=apply ;;
  *'"action":"rollback"'*) kind=rollback ;;
  *) exit 0 ;;
esac
attempt=$(printf '%s' "$decision" | sed -n 's/.*"attemptId":"\([A-Za-z0-9-]*\)".*/\1/p')
started="$dir/updates/started"
rm -f "$started"
echo "$(now) starting: $decision" >> "$log"
"$docker" run --rm --user "$user" --group-add "$group" --name "$name-updater" --add-host host.docker.internal:host-gateway \
  -v "$socket:/var/run/docker.sock" \
  -v "$dir:$dir" \
  -e SLATEBOX_UPDATE_DECISION="$decision" -e HOME=/tmp \
  --entrypoint /opt/slatebox/bin/slatebox-updater "$image" \
  --name "$name" --dir "$dir" --outside-url http://host.docker.internal:7070 >> "$log" 2>&1
code=$?
echo "$(now) finished with exit code $code" >> "$log"
# 125 with no sign the updater ran (it writes $started first; nothing in flight, no report kept, no
# updater container left): Docker could not start it (the socket, the image), so it reported
# nothing. Say so now, or Admin › Updates would show the attempt running until its lease ran out.
# Any other 125 is the updater's own run, which reports for itself.
if [ "$code" -eq 125 ] && [ -n "$attempt" ] && [ ! -f "$started" ] && [ ! -f "$inflight" ] && [ ! -f "$dir/updates/pending-report.json" ] && ! exists "$name-updater"; then
  detail='Docker could not start the updater on this host; nothing was changed. The reason is in updates/updates.log in the install folder.'
  "$docker" exec "$name" /opt/slatebox/bin/slatebox updates report --attempt "$attempt" --phase failed --kind "$kind" --detail "$detail" >/dev/null 2>>"$log" \
    || printf '{"attemptId":"%s","phase":"failed","detail":"%s","kind":"%s"}\n' "$attempt" "$detail" "$kind" > "$dir/updates/pending-report.json"
fi
rm -f "$started"
# After an update or a rollback, the version now running writes this script again from the options
# it was made with, so a fix to it arrives the way the rest of Slatebox does, and the script always
# matches the version it talks to. The new one takes effect next run.
if [ "$code" -eq 0 ] && [ -f "$dir/updates/host-script.json" ]; then
  running=$("$docker" inspect --format '{{.Image}}' "$name" 2>/dev/null)
  if [ -n "$running" ] && [ "$running" != "$image" ]; then
    "$docker" run --rm --user "$user" --network none -v "$dir:$dir" --entrypoint /opt/slatebox/bin/slatebox-updater "$running" --write-host-script --dir "$dir" >> "$log" 2>&1 \
      || echo "$(now) updater.sh was kept as it is: the version now running could not write it again" >> "$log"
  fi
fi
# Keep the log short: the last 2000 lines.
tail -n 2000 "$log" > "$log.tmp" 2>/dev/null && mv "$log.tmp" "$log"
exit $code
