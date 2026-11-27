# syntax=docker/dockerfile:1
#
# Slatebox in one image: the app, the collaboration relay, MongoDB and a front
# proxy, supervised by one init. Keycloak, for single sign-on, is in the image
# too and starts only with SLATEBOX_SSO=keycloak. cloudflared, for a team
# address (https://<name>.slatebox.team), starts only with SLATEBOX_TUNNEL_TOKEN. Build it with ./build-image.sh, which stages
# the three committed source trees into the context this file expects:
#
#   app/        web/app of the Slatebox app checkout (no settings*.json)
#   engine/     SlateboxJS
#   relay/      the Slatebox fork of y-websocket
#   installer/  packages/slatebox (bin, src, package.json): the host updater runs it from the image
#   self-host/  this directory
#
# See DESIGN.md for the reasoning behind each stage.

ARG NODE_VERSION=26.13.1
ARG MONGO_VERSION=8.0.17
ARG CADDY_VERSION=2.11.9
ARG METEOR_BASE=geoffreybooth/meteor-base:3.6.1
ARG KEYCLOAK_VERSION=26.8.2
# The Java runtime Keycloak 26.8 is built and tested on (21), from Eclipse Temurin's Ubuntu 24.04 image.
ARG TEMURIN_JRE=21.0.13_9-jre-noble
# cloudflared, from Cloudflare's GitHub release, pinned by version here and by each
# architecture's sha256 below and in build/cloudflared.sha256 (a bump changes both files).
ARG CLOUDFLARED_VERSION=2026.11.2
# The Docker CLI for the host updater (self-hosted updates), from Docker's static builds, pinned by
# version here and by checksum below and in build/docker-cli.sha256 (a bump changes both files).
ARG DOCKER_CLI_VERSION=29.10.1

# Meteor 3.6.1 bundles against Node 26.13.1. Every stage that runs or compiles
# for the app takes its Node binary from this one image.
FROM node:${NODE_VERSION}-bookworm-slim AS node
FROM mongo:${MONGO_VERSION} AS mongo
FROM caddy:${CADDY_VERSION} AS caddy
FROM quay.io/keycloak/keycloak:${KEYCLOAK_VERSION} AS keycloak-dist

# --- cloudflared, for a team address -------------------------------------------
# BuildKit checks each download against its checksum; the stage for the target
# architecture is the one used. The verify stage checks it again against
# build/cloudflared.sha256 and that it is the pinned version.
FROM scratch AS cloudflared-amd64
ARG CLOUDFLARED_VERSION
ADD --checksum=sha256:56f13335143ec0e22772963290683a84a04114a35ec64cbc794a4d39ff9bb8cf \
    https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64 /cloudflared
FROM scratch AS cloudflared-arm64
ARG CLOUDFLARED_VERSION
ADD --checksum=sha256:04a7b7f08bce85d56b26ffe1fdbfbb21a074495a363d16f0783c40e25b5c5281 \
    https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-arm64 /cloudflared
FROM scratch AS cloudflared-license
ARG CLOUDFLARED_VERSION
ADD --checksum=sha256:58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd \
    https://raw.githubusercontent.com/cloudflare/cloudflared/${CLOUDFLARED_VERSION}/LICENSE /cloudflared-LICENSE.txt
FROM cloudflared-${TARGETARCH} AS cloudflared-download

# --- the Docker CLI, for the host updater ----------------------------------------
FROM scratch AS docker-cli-amd64
ARG DOCKER_CLI_VERSION
ADD --checksum=sha256:061642059fa7f2ed9b2f04a327a951cff4249585cf04b2661c2a6539197c9962 \
    https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_CLI_VERSION}.tgz /docker.tgz
FROM scratch AS docker-cli-arm64
ARG DOCKER_CLI_VERSION
ADD --checksum=sha256:a38c8a9ef6d17bce07499bfd3a3688542274769dc3b4f75c06ea2705fe65053e \
    https://download.docker.com/linux/static/stable/aarch64/docker-${DOCKER_CLI_VERSION}.tgz /docker.tgz
FROM scratch AS docker-cli-license
ARG DOCKER_CLI_VERSION
ADD --checksum=sha256:2d81ea060825006fc8f3fe28aa5dc0ffeb80faf325b612c955229157b8c10dc0 \
    https://raw.githubusercontent.com/docker/cli/v${DOCKER_CLI_VERSION}/LICENSE /docker-cli-LICENSE.txt
FROM docker-cli-${TARGETARCH} AS docker-cli-download

# --- Keycloak, built once for how Slatebox runs it -----------------------------
# Build options are fixed here so the container starts it with --optimized:
# the embedded H2 file database (see DESIGN.md for why), served under /auth,
# health checks on, no cluster. SCIM is the app's own (/scim/v2), not Keycloak's.
# Its data directory is the volume's /data/keycloak.
FROM eclipse-temurin:${TEMURIN_JRE} AS keycloak
COPY --from=keycloak-dist /opt/keycloak /opt/keycloak
RUN /opt/keycloak/bin/kc.sh build --db=dev-file --http-relative-path=/auth --health-enabled=true \
      --cache=local \
 && rm -rf /opt/keycloak/data \
 && chmod -R a+rX,go-w /opt/keycloak \
 && ln -s /data/keycloak /opt/keycloak/data \
 && cp /opt/java/openjdk/legal/java.base/LICENSE /openjdk-LICENSE.txt

# --- SlateboxJS: a fresh build for every image, stamped with its revision ----
FROM node AS engine
ARG ENGINE_REVISION
RUN test -n "$ENGINE_REVISION"
WORKDIR /src/engine
COPY engine/package.json engine/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY engine/ ./
RUN npm pkg set "version=$(node -p 'require("./package.json").version.split("+")[0]')+selfhost.${ENGINE_REVISION}" \
 && npm run build \
 && mkdir /out \
 && npm pack --pack-destination /out >/dev/null
# Point the app at exactly that artifact and prove the lock agrees.
WORKDIR /src/app
COPY self-host/build/pin-engine.mjs /build/pin-engine.mjs
COPY app/package.json app/package-lock.json ./
RUN cp /out/slateboxjs-*.tgz . \
 && node /build/pin-engine.mjs prepare "$(basename /out/slateboxjs-*.tgz)" \
 && npm install --package-lock-only --legacy-peer-deps=false --ignore-scripts --no-audit --no-fund \
 && node /build/pin-engine.mjs verify "$ENGINE_REVISION" \
 && cp package.json package-lock.json /out/

# --- Meteor bundle -----------------------------------------------------------
FROM ${METEOR_BASE} AS meteor-build
COPY app/ $APP_SOURCE_FOLDER/
COPY --from=engine /out/ $APP_SOURCE_FOLDER/
# An operator's settings never belong in an image. build-image.sh removes them
# and the context ignores them; this stops the build if either guard is bypassed.
RUN found="$(find "$APP_SOURCE_FOLDER" -name 'settings*.json' -not -path '*/node_modules/*')" \
 && if [ -n "$found" ]; then echo "Settings files must not enter the image:" >&2; echo "$found" >&2; exit 1; fi
RUN bash $SCRIPTS_FOLDER/build-app-npm-dependencies.sh
RUN bash $SCRIPTS_FOLDER/build-meteor-bundle.sh

# --- Runtime base: Ubuntu 24.04, the platform MongoDB 8.0 is built for --------
FROM ubuntu:24.04 AS base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates fontconfig fonts-liberation libcurl4t64 tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node

# --- cloudflared, checked once more on the runtime base -------------------------
FROM base AS cloudflared
ARG TARGETARCH
ARG CLOUDFLARED_VERSION
COPY self-host/build/cloudflared.sha256 /build/cloudflared.sha256
COPY --from=cloudflared-download /cloudflared /out/cloudflared
RUN expected="$(awk -v file="cloudflared-linux-${TARGETARCH}" '$2 == file { print $1 }' /build/cloudflared.sha256)" \
 && test -n "$expected" \
 && echo "$expected  /out/cloudflared" | sha256sum -c - \
 && chmod 0755 /out/cloudflared \
 && /out/cloudflared --version | grep -F "version ${CLOUDFLARED_VERSION} "

# --- the Docker CLI, unpacked and checked once more ------------------------------
FROM base AS docker-cli
ARG TARGETARCH
ARG DOCKER_CLI_VERSION
COPY self-host/build/docker-cli.sha256 /build/docker-cli.sha256
COPY --from=docker-cli-download /docker.tgz /build/docker.tgz
RUN mkdir /out && tar -xzf /build/docker.tgz -C /build docker/docker \
 && mv /build/docker/docker /out/docker \
 && expected="$(awk -v file="docker-linux-${TARGETARCH}" '$2 == file { print $1 }' /build/docker-cli.sha256)" \
 && test -n "$expected" \
 && echo "$expected  /out/docker" | sha256sum -c - \
 && chmod 0755 /out/docker \
 && /out/docker --version | grep -F "version ${DOCKER_CLI_VERSION},"

# --- Server dependencies, compiled against the runtime's own libc -------------
FROM base AS server-dependencies
RUN apt-get update \
 && apt-get install -y --no-install-recommends g++ make python3 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=node /usr/local/include/node /usr/local/include/node
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
COPY --from=meteor-build /opt/bundle/bundle /opt/slatebox/app/bundle
WORKDIR /opt/slatebox/app/bundle/programs/server

# accounts-password@3.3.3 (Meteor 3.6.1) bundles bcrypt 6 and Argon2 with
# prebuilt bindings (bcrypt 5 and its node-pre-gyp/tar install stack are gone),
# so no re-resolve is needed before the rebuild below. The check after it still
# insists on bcrypt 6.

# Install the server's own dependencies and rebuild native modules for this
# platform, then prove password hashing loads and works.
RUN npm install --no-audit --no-fund \
 && BCRYPT_ROOT="$PWD/npm/node_modules/meteor/accounts-password" node --eval \
      "const root = process.env.BCRYPT_ROOT + '/node_modules/'; const bcrypt = require(root + 'bcrypt'); const argon2 = require(root + 'argon2'); if (!require(root + 'bcrypt/package.json').version.startsWith('6.')) process.exit(1); const hash = bcrypt.hashSync('slatebox-runtime-check', 4); if (!bcrypt.compareSync('slatebox-runtime-check', hash)) process.exit(1); argon2.hash('slatebox-runtime-check').then((argonHash) => argon2.verify(argonHash, 'slatebox-runtime-check')).then((valid) => { if (!valid) process.exit(1) })"

# Meteor includes node-gyp so native packages can be compiled while the bundle
# is assembled. Native rebuilds are complete above; remove that install-only
# tool and its vulnerable tar/cache tree. Meteor also regenerates its own
# server dependency manifest, so patch Underscore at this boundary.
RUN npm install --ignore-scripts --no-audit --no-fund --save-exact underscore@1.13.8 \
 && npm uninstall --ignore-scripts --no-audit --no-fund node-gyp \
 && test ! -e node_modules/node-gyp \
 && node --eval "if (require('underscore/package.json').version !== '1.13.8') process.exit(1)"

# Leave out what no running server reads: editor and agent folders that some
# npm packages publish by mistake, the sample keys in their test suites, and
# third-party source maps (130 MB).
RUN cd /opt/slatebox/app/bundle/programs/server \
 && find . -type d \( -name .claude -o -name .vscode -o -name .idea \) -prune -exec rm -rf {} + \
 && find . \( -path '*/node_modules/*/test/*' -o -path '*/node_modules/*/tests/*' -o -path '*/node_modules/*/fixtures/*' \) -type f \( -name '*.pem' -o -name '*.key' -o -name '*.p12' \) -delete \
 && find . -path '*/node_modules/*' -type f \( -name '*.js.map' -o -name '*.mjs.map' -o -name '*.cjs.map' -o -name '*.css.map' -o -name '*.d.ts.map' \) -delete \
 && cd npm && node --eval "require('sharp')"

# --- Collaboration relay ------------------------------------------------------
FROM node AS relay
WORKDIR /opt/slatebox/relay
COPY relay/package.json relay/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY relay/bin ./bin
COPY relay/src ./src
COPY relay/LICENSE ./LICENSE

# --- Fonts used when the server renders slate images --------------------------
FROM node AS fonts
ARG GOOGLE_FONTS="\
Roboto:wght@400;700 \
Courier+Prime \
Indie+Flower \
Abril+Fatface \
Bangers \
Caveat \
EB+Garamond \
IBM+Plex+Mono \
IBM+Plex+Sans \
IBM+Plex+Serif \
PT+Sans \
PT+Sans+Narrow \
PT+Serif \
Permanent+Marker \
Roboto+Condensed \
Roboto+Mono \
Roboto+Slab"
COPY self-host/build/fetch-fonts.mjs /build/fetch-fonts.mjs
RUN node /build/fetch-fonts.mjs /out /fonts.md $GOOGLE_FONTS
# The interface and note fonts are the app's own (web/app/public/fonts, each with its OFL.txt):
# the app serves them at /fonts/, so a page view sends nothing to a font host.

# --- MongoDB's notices for the libraries its programs embed --------------------
# The official mongo image leaves its documentation out, so the notices come
# from MongoDB's sources at the released versions, pinned by checksum.
FROM scratch AS mongodb-notices
ADD --checksum=sha256:02aac1f4b8a784e394b49eae23cf10b797e45a7b220145a3b650dcb534d40b77 \
    https://raw.githubusercontent.com/mongodb/mongo/r8.0.17/README.third_party.md /mongodb-server-third-party.md
ADD --checksum=sha256:1be50e3f7fa3c3c6b0fdbf2487d29fbeabfb751accf6b58668485252ff3786d7 \
    https://raw.githubusercontent.com/mongodb/mongo-tools/100.14.0/THIRD-PARTY-NOTICES /mongodb-database-tools-THIRD-PARTY-NOTICES.txt

# --- The image ----------------------------------------------------------------
FROM base AS runtime

# One unprivileged account runs every process. /data is the only state; the
# account's home is inside the container so caches never land on the volume.
# /run/slatebox is open to any user (sticky, like /tmp) so that the container
# can also run as the owner of a host folder (docker run --user UID:GID); every
# file in it is private to the user that writes it.
RUN groupadd --gid 10001 slatebox \
 && useradd --uid 10001 --gid 10001 --home-dir /run/slatebox --no-create-home --shell /usr/sbin/nologin slatebox \
 && install -d -o slatebox -g slatebox -m 0700 /data \
 && install -d -m 1777 /run/slatebox
ENV HOME=/run/slatebox

COPY --from=mongo /usr/bin/mongod /usr/bin/mongodump /usr/bin/mongorestore /usr/local/bin/
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
# A third-party program, kept beside Keycloak and Java rather than in Slatebox's own /opt/slatebox.
COPY --from=cloudflared /out/cloudflared /opt/cloudflared/bin/cloudflared
# The Docker CLI and the installer, for the host updater (self-hosted updates). Only a short-lived
# container the host's updater.sh starts, with the Docker socket mounted, ever runs them.
COPY --from=docker-cli /out/docker /opt/slatebox/libexec/docker
COPY installer/ /opt/slatebox/installer/
COPY --from=fonts /out/ /usr/share/fonts/googlefonts/
RUN fc-cache -f

COPY --from=relay /opt/slatebox/relay /opt/slatebox/relay
COPY --from=keycloak --chown=0:0 /opt/java/openjdk /opt/java/openjdk
COPY --from=keycloak --chown=0:0 /opt/keycloak /opt/keycloak
COPY --from=server-dependencies /opt/slatebox/app/bundle /opt/slatebox/app/bundle

COPY self-host/licenses/ /opt/slatebox/licenses/
COPY --from=fonts /fonts.md /opt/slatebox/licenses/third-party/fonts.md
COPY --from=mongodb-notices / /opt/slatebox/licenses/third-party/
COPY --from=cloudflared-license / /opt/slatebox/licenses/third-party/
COPY --from=docker-cli-license / /opt/slatebox/licenses/third-party/
COPY installer/LICENSE.md /opt/slatebox/licenses/slatebox-installer-LICENSE.md
COPY app-license/LICENSE.md /opt/slatebox/licenses/slatebox-app-LICENSE.md
COPY app-license/LICENSING.md /opt/slatebox/licenses/slatebox-app-LICENSING.md
COPY engine/LICENSE /opt/slatebox/licenses/slateboxjs-LICENSE.txt
COPY relay/LICENSE /opt/slatebox/licenses/slatebox-relay-LICENSE.txt
COPY --from=node /usr/local/LICENSE /opt/slatebox/licenses/third-party/node-LICENSE.txt
COPY --from=keycloak /opt/keycloak/LICENSE.txt /opt/slatebox/licenses/third-party/keycloak-LICENSE.txt
COPY --from=keycloak /openjdk-LICENSE.txt /opt/slatebox/licenses/third-party/openjdk-LICENSE.txt

COPY self-host/rootfs/ /
RUN ln -s /opt/slatebox/bin/slatebox /usr/local/bin/slatebox

ARG APP_REVISION
ARG ENGINE_REVISION
ARG RELAY_REVISION
# The release this image is (SemVer, the app tag without its v): 2.1.0. A local build without one
# says 0.0.0-dev+<app revision>, which the updater never treats as a release.
ARG RELEASE_VERSION
ARG DOCKER_CLI_VERSION
ARG NODE_VERSION
ARG MONGO_VERSION
ARG CADDY_VERSION
ARG KEYCLOAK_VERSION
ARG CLOUDFLARED_VERSION
RUN test -n "$APP_REVISION" && test -n "$ENGINE_REVISION" && test -n "$RELAY_REVISION" \
 && version="${RELEASE_VERSION:-0.0.0-dev+${APP_REVISION}}" \
 && printf '{"version":"%s","app":"%s","engine":"%s","relay":"%s","node":"%s","mongodb":"%s","caddy":"%s","keycloak":"%s","cloudflared":"%s","docker":"%s"}\n' \
      "$version" "$APP_REVISION" "$ENGINE_REVISION" "$RELAY_REVISION" "$NODE_VERSION" "$MONGO_VERSION" "$CADDY_VERSION" "$KEYCLOAK_VERSION" "$CLOUDFLARED_VERSION" "$DOCKER_CLI_VERSION" \
      > /opt/slatebox/identity.json \
 && test ! -e /opt/slatebox/release-keys.d
# The version label is the release (SemVer); the revision label is the app commit. Without a
# version label the image would show the Ubuntu base image's version.
LABEL org.opencontainers.image.title="Slatebox" \
      org.opencontainers.image.description="Slatebox with its collaboration relay and database in one container, Keycloak for optional single sign-on, and cloudflared for an optional team address" \
      org.opencontainers.image.version="${RELEASE_VERSION:-0.0.0-dev}" \
      org.opencontainers.image.revision="${APP_REVISION}" \
      com.slatebox.engine.revision="${ENGINE_REVISION}" \
      com.slatebox.relay.revision="${RELAY_REVISION}" \
      com.slatebox.licenses="/opt/slatebox/licenses/NOTICE.md"

USER slatebox
WORKDIR /data
VOLUME /data
EXPOSE 7070 80 443
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=10s --start-period=600s --start-interval=3s --retries=3 \
  CMD ["/opt/slatebox/bin/slatebox", "health"]
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/slatebox/bin/slatebox-init"]
