#!/usr/bin/env bash
# Build the one Slatebox image from three committed source checkouts:
# this app checkout, SlateboxJS and the Slatebox fork of y-websocket.
#
#   ./build-image.sh /path/to/slateboxjs /path/to/y-websocket
#
# Needs Git and Docker with BuildKit. Everything else, including the engine
# build, happens inside the build. Only committed files are used (stage-image.sh).
# RELEASE_VERSION=2.1.0 stamps the release into identity.json and the version label; a release is
# normally built by .github/workflows/selfhost-image.yml from its tag, and this stays the manual way.
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
# Git-ignored files count too: rootfs is copied from disk below, so an ignored file there would go
# into the image without ever being in the revision the label names.
if [[ -n $(git -C "$app" status --porcelain -- self-host web/app enterprise packages/slatebox LICENSE LICENSING.md) ]] \
  || [[ -n $(git -C "$app" ls-files --others --ignored --exclude-standard -- self-host/Dockerfile self-host/build self-host/licenses self-host/rootfs) ]]; then
  if [[ ${ALLOW_DIRTY:-} != 1 ]]; then
    echo 'Commit your changes under self-host/ and web/app/ first (git-ignored files under self-host/rootfs, build or licenses count), or set ALLOW_DIRTY=1 for a local trial build.' >&2
    exit 1
  fi
  app_label="$app_sha-dirty"
else
  app_label=$app_sha
fi

# One platform, or both as one multi-platform image under one tag
# (TARGET_PLATFORM=linux/amd64,linux/arm64; that needs Docker's containerd
# image store, and the platform that is not the host's runs under emulation).
platform=${TARGET_PLATFORM:-${DOCKER_DEFAULT_PLATFORM:-$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')}}
IFS=, read -r -a platforms <<< "$platform"
for each in "${platforms[@]}"; do
  case "$each" in
    linux/amd64|linux/arm64) ;;
    *) echo "Choose TARGET_PLATFORM=linux/amd64, linux/arm64 or linux/amd64,linux/arm64 (received $platform)" >&2; exit 2 ;;
  esac
done
if ((${#platforms[@]} == 1)); then
  image=${IMAGE:-slatebox:$app_label-$engine_sha-$relay_sha-${platform#linux/}}
else
  if ((${#platforms[@]} != 2)) || [[ ${platforms[0]} == "${platforms[1]}" ]]; then
    echo "Choose TARGET_PLATFORM=linux/amd64,linux/arm64 for both (received $platform)" >&2; exit 2
  fi
  if [[ $(docker info --format '{{.DriverStatus}}') != *io.containerd.snapshotter* ]]; then
    echo 'Both platforms under one tag need the containerd image store: in Docker Desktop, Settings > General > "Use containerd for pulling and storing images"; in Docker Engine, "features": {"containerd-snapshotter": true} in daemon.json. Or build each platform on its own.' >&2
    exit 2
  fi
  image=${IMAGE:-slatebox:$app_label-$engine_sha-$relay_sha}
fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
"$here/stage-image.sh" "$stage" "$app" "$app_sha" "$engine" "$engine_sha" "$relay" "$relay_sha"

docker build --platform "$platform" \
  --build-arg "APP_REVISION=$app_label" \
  --build-arg "ENGINE_REVISION=$engine_sha" \
  --build-arg "RELAY_REVISION=$relay_sha" \
  ${RELEASE_VERSION:+--build-arg "RELEASE_VERSION=$RELEASE_VERSION"} \
  -f "$stage/self-host/Dockerfile" -t "$image" "$stage"

for each in "${platforms[@]}"; do
  actual=$(docker image inspect --platform "$each" --format '{{.Os}}/{{.Architecture}}' "$image")
  [[ $actual == "$each" ]] || { echo "Expected $image to hold $each, got $actual" >&2; exit 1; }
done

cat <<EOF

Built $image
  app $app_label, engine $engine_sha, relay $relay_sha, $platform

Run it:
  docker run -d --name slatebox -p 7070:7070 -v slatebox-data:/data $image
Then open http://localhost:7070
EOF
