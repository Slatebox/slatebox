#!/bin/bash
# Run this app for the trade harness (slateboxjs tests/harness/trade/harness.mjs): Meteor listens on
# APP_PORT, but browsers reach it through the harness's latency proxy at ROOT_URL, so a method's
# answer comes back a hosted round trip after the server acted on it.
#
#   APP_PORT=4494 ROOT_URL=http://localhost:4496 scripts/trade-harness-meteor.sh <settings.json>
#
# The settings file is the person's own copy (never committed): public.baseUrl = ROOT_URL,
# public.wsUrl = the harness's relay proxy (ws://localhost:2294), and slateboxAPI holding the same
# key pair the harness gives the relay as API_KEYS. Install the engine build under test into
# node_modules/slateboxjs first (one fresh `npm pack` of the engine, unpacked there).
set -euo pipefail
settings=${1:?settings file}
cd "$(dirname "$0")/.."
export ROOT_URL=${ROOT_URL:-http://localhost:4496}
exec meteor run --port "${APP_PORT:-4494}" --settings "$settings"
