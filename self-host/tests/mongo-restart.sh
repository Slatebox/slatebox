#!/usr/bin/env bash
# Exercise the Compose entrypoint twice in the same container filesystem.
set -euo pipefail
cd "$(dirname "$0")/.."
setup=$(awk '/^  mongo:/ {mongo=1} mongo && /^        umask / {key=1} key && /exec .* mongod / {exit} key {sub(/^        /, ""); gsub(/\$\$/, "$"); print}' compose.yaml)
keyfile=$(awk '/exec .* mongod .*--keyFile / {print $NF;exit}' compose.yaml)
[[ -n $setup && $keyfile == /* ]]
docker run --rm --network none --entrypoint bash -e REPLICA_KEY=first-synthetic-key \
  mongo:8.0.17 -ec '
    eval "$1"
    export REPLICA_KEY=second-synthetic-key
    eval "$1"
    [[ "$(stat -c "%a:%U" "$2")" == "600:mongodb" ]]
    [[ "$(gosu mongodb cat "$2")" == "$REPLICA_KEY" ]]
  ' _ "$setup" "$keyfile"
