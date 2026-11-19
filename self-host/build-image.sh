#!/usr/bin/env bash
# Build the one Slatebox image from three committed source checkouts:
# this app checkout, SlateboxJS and the Slatebox fork of y-websocket.
#
#   ./build-image.sh /path/to/slateboxjs /path/to/y-websocket
#
# Needs Git and Docker with BuildKit. Everything else, including the engine
# build, happens inside the build. Only committed files are used.
set -euo pipefail

if [[ $# != 2 ]]; then
  echo 'Usage: ./build-image.sh <SlateboxJS checkout> <y-websocket checkout>' >&2
  exit 2
fi

here=$(cd "$(dirname "$0")" && pwd -P)
app=$(git -C "$here" rev-parse --show-toplevel)
engine=$(git -C "$1" rev-parse --show-toplevel)
relay=$(git -C "$2" rev-parse --show-toplevel)
app_sha=$(git -C "$app" rev-parse --short=12 HEAD)
engine_sha=$(git -C "$engine" rev-parse --short=12 HEAD)
relay_sha=$(git -C "$relay" rev-parse --short=12 HEAD)

# The image is labelled with the app revision, so what it contains must be
# what that revision holds. Uncommitted changes to the image's own files are
# refused unless the label is allowed to say so.
if [[ -n $(git -C "$app" status --porcelain -- self-host web/app LICENSE.md) ]]; then
  if [[ ${ALLOW_DIRTY:-} != 1 ]]; then
    echo 'Commit your changes under self-host/ and web/app/ first, or set ALLOW_DIRTY=1 for a local trial build.' >&2
    exit 1
  fi
  app_label="$app_sha-dirty"
else
  app_label=$app_sha
fi

platform=${TARGET_PLATFORM:-${DOCKER_DEFAULT_PLATFORM:-$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')}}
case "$platform" in
  linux/amd64|linux/arm64) ;;
  *) echo "Choose TARGET_PLATFORM=linux/amd64 or linux/arm64 (received $platform)" >&2; exit 2 ;;
esac
arch=${platform#linux/}
image=${IMAGE:-slatebox:$app_label-$engine_sha-$relay_sha-$arch}

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/app" "$stage/engine" "$stage/relay" "$stage/self-host" "$stage/app-license"
git -C "$app" archive "$app_sha:web/app" | tar -x -C "$stage/app"
git -C "$engine" archive "$engine_sha" | tar -x -C "$stage/engine"
git -C "$relay" archive "$relay_sha" | tar -x -C "$stage/relay"
git -C "$app" show "$app_sha:LICENSE.md" > "$stage/app-license/LICENSE.md"

# The app tree carries settings files for the hosted service. None of them may
# enter an image: each installation generates its own on first start.
find "$stage/app" -name 'settings*.json' -delete
rm -rf "$stage/app/.vscode" "$stage/app/.circleci"
printf '%s\n' '**/settings*.json' '**/.env' '**/.env.*' '**/node_modules' '**/.meteor/local' > "$stage/.dockerignore"

# The image's own files come from this directory as it stands (identical to the
# commit unless ALLOW_DIRTY=1 was given).
for item in Dockerfile build licenses rootfs; do cp -R "$here/$item" "$stage/self-host/$item"; done

# Files in the image are owned by root and read by an unprivileged user, so
# their modes must not depend on the umask this script or the checkout ran under.
chmod -R u+rwX,go+rX,go-w "$stage"

docker build --platform "$platform" \
  --build-arg "APP_REVISION=$app_label" \
  --build-arg "ENGINE_REVISION=$engine_sha" \
  --build-arg "RELAY_REVISION=$relay_sha" \
  -f "$stage/self-host/Dockerfile" -t "$image" "$stage"

actual=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")
[[ $actual == "$platform" ]] || { echo "Expected $image to be $platform, got $actual" >&2; exit 1; }

cat <<EOF

Built $image
  app $app_label, engine $engine_sha, relay $relay_sha, $platform

Run it:
  docker run -d --name slatebox -p 7070:7070 -v slatebox-data:/data $image
Then open http://localhost:7070
EOF
