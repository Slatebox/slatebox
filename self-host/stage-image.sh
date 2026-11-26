#!/usr/bin/env bash
# Stage the build context of the one Slatebox image from committed trees only: the app (web/app,
# enterprise/, the installer), SlateboxJS and the relay, each by commit. build-image.sh (a local or
# manual build) and .github/workflows/selfhost-image.yml (a release) both use this, so a release
# image and a local one are staged the same way.
#
#   ./stage-image.sh <stage dir> <app checkout> <app commit> <engine checkout> <engine commit> <relay checkout> <relay commit>
#
# The image's own files (Dockerfile, build, licenses, rootfs) come from this directory as it stands:
# identical to the app commit unless build-image.sh was told ALLOW_DIRTY=1.
set -euo pipefail

if [[ $# != 7 ]]; then
  echo 'Usage: ./stage-image.sh <stage dir> <app checkout> <app commit> <engine checkout> <engine commit> <relay checkout> <relay commit>' >&2
  exit 2
fi
stage=$1 app=$2 app_sha=$3 engine=$4 engine_sha=$5 relay=$6 relay_sha=$7
here=$(cd "$(dirname "$0")" && pwd -P)

mkdir -p "$stage/app" "$stage/engine" "$stage/relay" "$stage/self-host" "$stage/app-license" "$stage/installer"
git -C "$app" archive "$app_sha:web/app" | tar -x -C "$stage/app"
git -C "$engine" archive "$engine_sha" | tar -x -C "$stage/engine"
git -C "$relay" archive "$relay_sha" | tar -x -C "$stage/relay"
git -C "$app" show "$app_sha:LICENSE" > "$stage/app-license/LICENSE.md"
git -C "$app" show "$app_sha:LICENSING.md" > "$stage/app-license/LICENSING.md"
# The installer (MIT): the host updater runs its own tested upgrade path from the image. Its code
# only; it needs no npm dependency for that path (slatebox exec and mcp are not in the image).
git -C "$app" archive "$app_sha:packages/slatebox" bin src package.json LICENSE.md | tar -x -C "$stage/installer"

# The app tree carries settings files for the hosted service. None of them may
# enter an image: each installation generates its own on first start.
find "$stage/app" -name 'settings*.json' -delete
# The committed enterprise/ code (enterprise/LICENSE, not MIT) goes in at the app's '/enterprise'
# path. It stays locked on a self-hosted install until an on-prem license key from Slatebox LLC
# unlocks it (web/app/server/enterprise-license.mjs); single sign-on with the bundled Keycloak is
# never locked, and payments and metering are never part of a self-hosted Slatebox.
mkdir -p "$stage/app/enterprise"
git -C "$app" archive "$app_sha:enterprise" | tar -x -C "$stage/app/enterprise"
node "$app/scripts/enterprise-stage.mjs" check-present "$stage/app"
rm -rf "$stage/app/.vscode" "$stage/app/.circleci"
printf '%s\n' '**/settings*.json' '**/.env' '**/.env.*' '**/node_modules' '**/.meteor/local' > "$stage/.dockerignore"

for item in Dockerfile build licenses rootfs; do cp -R "$here/$item" "$stage/self-host/$item"; done
# A release image never carries test release keys (they exist only in test builds).
rm -rf "$stage/self-host/rootfs/opt/slatebox/release-keys.d"

# Files in the image are owned by root and read by an unprivileged user, so
# their modes must not depend on the umask this script or the checkout ran under.
chmod -R u+rwX,go+rX,go-w "$stage"
