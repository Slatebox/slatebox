#!/usr/bin/env bash
# Build the current committed app, engine and collaboration sources for this host.
set -euo pipefail
if [[ $# != 2 ]]; then echo 'Usage: ./build-images.sh <engine checkout> <collab checkout>' >&2; exit 2; fi
app=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
engine=$(git -C "$1" rev-parse --show-toplevel)
relay=$(git -C "$2" rev-parse --show-toplevel)
app_sha=$(git -C "$app" rev-parse --short=12 HEAD)
engine_sha=$(git -C "$engine" rev-parse --short=12 HEAD)
relay_sha=$(git -C "$relay" rev-parse --short=12 HEAD)
platform=${TARGET_PLATFORM:-${DOCKER_DEFAULT_PLATFORM:-$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')}}
case "$platform" in
  linux/amd64|linux/arm64) ;;
  *) echo "Choose TARGET_PLATFORM=linux/amd64 or linux/arm64 (received $platform)" >&2; exit 2 ;;
esac
arch=${platform#linux/}
stage=$(mktemp -d)
trap 'rm -r "$stage"' EXIT
mkdir -p "$stage/app" "$stage/engine" "$stage/relay"
git -C "$app" archive "$app_sha:web" | tar -x -C "$stage/app"
git -C "$engine" archive "$engine_sha" | tar -x -C "$stage/engine"
git -C "$relay" archive "$relay_sha" | tar -x -C "$stage/relay"
# Only the installed operator's runtime settings enter the app container.
find "$stage/app/app" -maxdepth 1 -type f -name 'settings*.json' -delete
# The committed enterprise/ code (enterprise/LICENSE, not MIT) goes in at the app's '/enterprise'
# path. It stays locked on a self-hosted install until a license key from Slatebox LLC unlocks it
# (web/app/server/enterprise-license.mjs); single sign-on with the bundled Keycloak is never locked.
mkdir -p "$stage/app/app/enterprise"
git -C "$app" archive "$app_sha:enterprise" | tar -x -C "$stage/app/app/enterprise"
node "$app/scripts/enterprise-stage.mjs" check-present "$stage/app"
(
  cd "$stage/engine"
  npm ci --no-audit --no-fund
  npm pkg set "version=$(node -p 'require("./package.json").version.split("+")[0]')+selfhost.$engine_sha"
  npm run build
  npm pack --pack-destination "$stage/app/app" >/dev/null
)
(
  cd "$stage/app/app"
  tarballs=(slateboxjs-*selfhost*.tgz)
  [[ ${#tarballs[@]} == 1 && -f ${tarballs[0]} ]] || { echo 'Missing fresh engine artifact' >&2; exit 1; }
  npm pkg set "dependencies.slateboxjs=file:./${tarballs[0]}"
  npm install --package-lock-only --legacy-peer-deps=false --ignore-scripts --no-audit --no-fund
  node -e 'const p=require("./package.json"),l=require("./package-lock.json").packages["node_modules/slateboxjs"]; if(!p.dependencies.slateboxjs.startsWith("file:") || !l?.version.endsWith("+selfhost."+process.argv[1])) process.exit(1)' "$engine_sha"
)
app_image="slatebox-app:selfhost-$app_sha-$engine_sha-$arch"
relay_image="slatebox-collab:selfhost-$relay_sha-$arch"
docker build --platform "$platform" --label "org.opencontainers.image.revision=$app_sha" --label "com.slatebox.engine.revision=$engine_sha" -t "$app_image" "$stage/app"
docker build --platform "$platform" --label "org.opencontainers.image.revision=$relay_sha" -t "$relay_image" "$stage/relay"
for image in "$app_image" "$relay_image"; do
  actual=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")
  [[ $actual == "$platform" ]] || { echo "Expected $image to be $platform, got $actual" >&2; exit 1; }
done
printf 'Built images. Use APP_IMAGE=%s COLLAB_IMAGE=%s with ./run init.\n' "$app_image" "$relay_image"
