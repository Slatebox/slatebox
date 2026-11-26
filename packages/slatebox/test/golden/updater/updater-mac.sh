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
mkdir -p "$dir/updates"
log="$dir/updates/updates.log"
lock="$dir/updates/lock"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# One run at a time, and never beside `slatebox upgrade` (it takes the same lock).
if ! mkdir "$lock" 2>/dev/null; then
  if [ -n "$(find "$lock" -maxdepth 0 -mmin +180 2>/dev/null)" ]; then
    rm -rf "$lock"
    mkdir "$lock" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rm -rf "$lock"' EXIT
trap 'exit 1' INT TERM

# Slatebox is not running (stopped, or being changed by hand): nothing to do now.
"$docker" exec "$name" /opt/slatebox/bin/slatebox updates heartbeat --updater 1 --scheduler launchd >/dev/null 2>>"$log" || exit 0

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
image=$("$docker" inspect --format '{{.Image}}' "$name") || exit 1
echo "$(now) starting: $decision" >> "$log"
"$docker" run --rm --user 0:0 --name "$name-updater" --add-host host.docker.internal:host-gateway \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$dir:$dir" \
  -e SLATEBOX_UPDATE_DECISION="$decision" \
  --entrypoint /opt/slatebox/bin/slatebox-updater "$image" \
  --name "$name" --dir "$dir" --outside-url http://host.docker.internal:7070 >> "$log" 2>&1
code=$?
echo "$(now) finished with exit code $code" >> "$log"
# Keep the log short: the last 2000 lines.
tail -n 2000 "$log" > "$log.tmp" 2>/dev/null && mv "$log.tmp" "$log"
exit $code
