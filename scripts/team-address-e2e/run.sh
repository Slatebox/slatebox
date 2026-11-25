#!/usr/bin/env bash
# The one REAL team-address run (spec 11.4), for what the CLI and the container can show:
# claim e2e-<random>.slatebox.team through a local claim service, install the locally built
# image with the CLI from this checkout, check HTTPS through Cloudflare, the tunnel, a restart,
# token rotation (and that the old token can no longer connect), a rename, and an uninstall that
# releases the name; then confirm through Cloudflare's API that nothing is left. The cleanup
# runs from a trap whatever happens.
#
# Needs: the claim service running at SLATEBOX_CLOUD_URL (a local Meteor in Cloud edition with
# settings.cloudflare.teamClaims, from the team-claims branch), a personal access token there
# with the team-addresses scope in SLATEBOX_CLOUD_TOKEN for the e2e account (or E2E_DEVICE=1 to
# approve the sign-in by hand), Docker, and the image (self-host/build-image.sh).
#
#   SLATEBOX_CLOUD_URL=http://localhost:3000 SLATEBOX_CLOUD_TOKEN=... \
#     IMAGE=slatebox:0.2.0-local scripts/team-address-e2e/run.sh
#
# The transcript goes to $EVIDENCE (default a new file in $TMPDIR). Nothing secret is printed:
# the CLI redacts tokens and credentials, and the checks below compare secrets in variables.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd -P)
repo=$(git -C "$here" rev-parse --show-toplevel)
cli=(node "$repo/packages/slatebox/bin/slatebox.mjs")
IMAGE=${IMAGE:-slatebox:0.2.0-local}
: "${SLATEBOX_CLOUD_URL:?set SLATEBOX_CLOUD_URL to the local claim service, e.g. http://localhost:3000}"
export SLATEBOX_CLOUD_URL
if [[ ${E2E_DEVICE:-} != 1 ]]; then : "${SLATEBOX_CLOUD_TOKEN:?set SLATEBOX_CLOUD_TOKEN (team-addresses scope) or E2E_DEVICE=1}"; export SLATEBOX_CLOUD_TOKEN; else unset SLATEBOX_CLOUD_TOKEN; fi
NAME=${NAME:-e2e-$(openssl rand -hex 4)}
RENAMED=${RENAMED:-e2e-$(openssl rand -hex 4)}
INSTALL=e2e
PORT=${PORT:-17599}
export SLATEBOX_INSTALL_HOME
SLATEBOX_INSTALL_HOME=$(mktemp -d "${TMPDIR:-/tmp}/sbx-e2e-home.XXXXXX")   # never the operator's ~/.slatebox
EVIDENCE=${EVIDENCE:-$(mktemp "${TMPDIR:-/tmp}/sbx-e2e-transcript.XXXXXX")}
claim_id=-
failures=0
exec > >(tee -a "$EVIDENCE") 2>&1

say() { printf '\n== %s\n' "$*"; }
check() { if "$@"; then echo "PASS: $*"; else echo "FAIL: $*"; failures=$((failures + 1)); fi; }
secret() { sed -n "s/^$1='\(.*\)'\$/\1/p" "$SLATEBOX_INSTALL_HOME/installs/$INSTALL/secrets.env"; }
answers() { curl -fsS --max-time 10 "https://$1.slatebox.team/readyz" | grep -q '"ok":true'; }
wait_answers() { local i; for i in $(seq 1 60); do answers "$1" && return 0; sleep 3; done; return 1; }
gone() { local i code; for i in $(seq 1 40); do code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$1.slatebox.team/readyz" || true); [[ $code == 404 || $code == 000 || $code == 530 || $code == 1033 ]] && return 0; sleep 3; done; return 1; }

cleanup() {
  set +e
  say "cleanup (always)"
  "${cli[@]}" uninstall --name "$INSTALL" --delete-data --confirm "$INSTALL" --yes
  docker rm -f sbx-e2e-old-token >/dev/null 2>&1
  node "$here/cloudflare-leftovers.mjs" "$claim_id" "$NAME" "$RENAMED"
  local leftovers=$?
  if ((leftovers)); then
    echo "FAIL: Cloudflare still has pieces of this run (a release bug); deleting them now"
    node "$here/cloudflare-leftovers.mjs" "$claim_id" "$NAME" "$RENAMED" --delete
    failures=$((failures + 1))
  fi
  rm -rf "$SLATEBOX_INSTALL_HOME"
  say "done: $failures failure(s); transcript in $EVIDENCE"
  exit $((failures ? 1 : 0))
}
trap cleanup EXIT

say "1. install with a team address ($NAME.slatebox.team) from this checkout's CLI, image $IMAGE"
"${cli[@]}" install --name "$INSTALL" --team-address "$NAME" --image "$IMAGE" --ai none --backups off --port "$PORT" --yes
claim_id=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).claimId)' "$SLATEBOX_INSTALL_HOME/installs/$INSTALL/credentials.json")
check test "$(stat -f %Lp "$SLATEBOX_INSTALL_HOME/installs/$INSTALL/credentials.json" 2>/dev/null || stat -c %a "$SLATEBOX_INSTALL_HOME/installs/$INSTALL/credentials.json")" = 600
check wait_answers "$NAME"
check bash -c "curl -fsS 'https://$NAME.slatebox.team/' | grep -qi '<title>'"
check bash -c "curl -sI 'https://$NAME.slatebox.team/' | grep -qi '^server: cloudflare'"

say "2. status: active, at least one tunnel connection"
status_out=$("${cli[@]}" status --name "$INSTALL" || true)
echo "$status_out"
check grep -qE "Team address +https://$NAME\.slatebox\.team \(active, [1-9]" <<<"$status_out"

say "3. live editing: the relay answers through the tunnel at wss://$NAME.slatebox.team/live"
nonce=$(openssl rand -base64 16)   # a WebSocket handshake nonce, not a secret
check bash -c "curl -s --max-time 10 -o /dev/null -w '%{http_code}' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H \"Sec-WebSocket-Key: $nonce\" 'https://$NAME.slatebox.team/live/slatebox-e2e' | grep -qE '^(101|401|403)$'"
echo "   (two-tab live editing in a fresh browser session is the browser step of the spec; run it against https://$NAME.slatebox.team now if a browser agent is attached)"

say "4. restart: the tunnel comes back with no CLI"
docker restart "$INSTALL" >/dev/null
check wait_answers "$NAME"

say "5. rotate: a new token; the old one cannot connect"
old=$(secret SLATEBOX_TUNNEL_TOKEN)
"${cli[@]}" address rotate --name "$INSTALL" --yes
new=$(secret SLATEBOX_TUNNEL_TOKEN)
check test -n "$new" -a "$old" != "$new"
check wait_answers "$NAME"
oldfile=$(mktemp); chmod 600 "$oldfile"; printf '%s' "$old" > "$oldfile"; unset old new
docker run -d --name sbx-e2e-old-token --entrypoint /opt/slatebox/bin/cloudflared -v "$oldfile:/tok:ro" "$IMAGE" tunnel --no-autoupdate --loglevel info run --token-file /tok >/dev/null
sleep 30
registered=$(docker logs sbx-e2e-old-token 2>&1 | grep -c 'Registered tunnel connection' || true)
echo "   connections the OLD token registered after rotation: $registered"
docker logs sbx-e2e-old-token 2>&1 | grep -E 'ERR|Unauthorized|failed' | head -3 | sed 's/^/   old-token log: /'
docker rm -f sbx-e2e-old-token >/dev/null; rm -f "$oldfile"
check test "$registered" = 0

say "6. logs carry no token or credential (counts only)"
cred=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).installCredential)' "$SLATEBOX_INSTALL_HOME/installs/$INSTALL/credentials.json")
tok=$(secret SLATEBOX_TUNNEL_TOKEN)
hits=$(docker logs "$INSTALL" 2>&1 | grep -cF -e "$tok" -e "$cred" || true)
cli_hits=$("${cli[@]}" logs --name "$INSTALL" | grep -cF -e "$tok" -e "$cred" || true)
unset cred tok
echo "   container log lines with the token or credential: $hits; slatebox logs: $cli_hits"
check test "$hits" = 0 -a "$cli_hits" = 0

say "7. rename to $RENAMED.slatebox.team; the old name stops answering"
"${cli[@]}" rename "$RENAMED" --name "$INSTALL" --yes
check wait_answers "$RENAMED"
check gone "$NAME"

say "8. uninstall releases the name (the trap then confirms nothing is left at Cloudflare)"
"${cli[@]}" uninstall --name "$INSTALL" --delete-data --confirm "$INSTALL" --yes
check test ! -e "$SLATEBOX_INSTALL_HOME/installs/$INSTALL/credentials.json"
check gone "$RENAMED"
