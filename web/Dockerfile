FROM geoffreybooth/meteor-base:3.6 AS meteor-build

# Copy the complete app before installing dependencies. Published releases use
# the registry dependency directly; the local production-candidate gate stages
# a packed SlateboxJS artifact beside package.json in a disposable context.
COPY ./app $APP_SOURCE_FOLDER/

RUN bash $SCRIPTS_FOLDER/build-app-npm-dependencies.sh

RUN bash $SCRIPTS_FOLDER/build-meteor-bundle.sh

# Meteor 3.5 bundles against Node 24.15.0. Keep both runtime stages identical.
FROM node:24.15.0-alpine AS server-dependencies

ENV APP_BUNDLE_FOLDER /opt/bundle
ENV SCRIPTS_FOLDER /docker

# Install OS build dependencies, which stay with this intermediate image but don’t become part of the final published image
RUN apk --no-cache add \
    bash \
    g++ \
    make \
    python3

# Copy in entrypoint
COPY --from=meteor-build $SCRIPTS_FOLDER $SCRIPTS_FOLDER/

# Copy in app bundle
COPY --from=meteor-build $APP_BUNDLE_FOLDER/bundle $APP_BUNDLE_FOLDER/bundle/

RUN bash $SCRIPTS_FOLDER/build-meteor-npm-dependencies.sh

# accounts-password@3.3.0 bundles bcrypt@5 plus node-pre-gyp's vulnerable,
# install-only tar stack. Re-resolve its isolated native dependency tree with
# bcrypt 6 while retaining the package's pinned Argon2 implementation.
RUN BCRYPT_ROOT="$APP_BUNDLE_FOLDER/bundle/programs/server/npm/node_modules/meteor/accounts-password" && \
    npm install --prefix "$BCRYPT_ROOT" --ignore-scripts --no-save --no-audit --no-fund \
      bcrypt@6.0.0 argon2@0.41.1 && \
    BCRYPT_ROOT="$BCRYPT_ROOT" node --eval \
      "const root = process.env.BCRYPT_ROOT + '/node_modules/'; const bcrypt = require(root + 'bcrypt'); const argon2 = require(root + 'argon2'); const hash = bcrypt.hashSync('slatebox-runtime-check', 4); if (!bcrypt.compareSync('slatebox-runtime-check', hash)) process.exit(1); argon2.hash('slatebox-runtime-check').then((argonHash) => argon2.verify(argonHash, 'slatebox-runtime-check')).then((valid) => { if (!valid) process.exit(1) })"

# Meteor creates the server bundle on glibc, so Sharp's generated dependency
# tree contains glibc binaries. Install the matching musl payload explicitly
# for Alpine while deriving versions from the bundled Sharp package.
RUN SHARP_ARCH="$(node --print 'process.arch')" && \
    case "$SHARP_ARCH" in arm64|x64) ;; *) exit 1 ;; esac && \
    SHARP_PACKAGE="$APP_BUNDLE_FOLDER/bundle/programs/server/npm/node_modules/sharp/package.json" && \
    SHARP_VERSION="$(node --print "require('$SHARP_PACKAGE').optionalDependencies['@img/sharp-linuxmusl-' + process.arch]")" && \
    LIBVIPS_VERSION="$(node --print "require('$SHARP_PACKAGE').optionalDependencies['@img/sharp-libvips-linuxmusl-' + process.arch]")" && \
    npm install --prefix /tmp/sharp-musl --ignore-scripts --no-save \
      "@img/sharp-linuxmusl-$SHARP_ARCH@$SHARP_VERSION" \
      "@img/sharp-libvips-linuxmusl-$SHARP_ARCH@$LIBVIPS_VERSION" && \
    cp -R /tmp/sharp-musl/node_modules/@img/* \
      "$APP_BUNDLE_FOLDER/bundle/programs/server/npm/node_modules/@img/" && \
    rm -rf /tmp/sharp-musl && \
    cd "$APP_BUNDLE_FOLDER/bundle/programs/server/npm" && \
    node --eval "require('sharp')"

# Meteor includes node-gyp so native packages can be compiled while the bundle
# is assembled. Native rebuilds are complete above; remove that install-only
# tool and its vulnerable tar/cache tree before copying into the runtime image.
# Meteor also regenerates its own server dependency manifest, so patch
# Underscore at this boundary instead of trusting the app-level lock alone.
RUN SERVER_ROOT="$APP_BUNDLE_FOLDER/bundle/programs/server" && \
    cd "$SERVER_ROOT" && \
    npm install --ignore-scripts --no-audit --no-fund --save-exact underscore@1.13.8 && \
    npm uninstall --ignore-scripts --no-audit --no-fund node-gyp && \
    test ! -e node_modules/node-gyp && \
    node --eval "if (require('underscore/package.json').version !== '1.13.8') process.exit(1)"

# Start another Docker stage, so that the final image doesn’t contain the layer with the build dependencies
# See previous FROM line; this must match
FROM node:24.15.0-alpine AS runtime

ENV APP_BUNDLE_FOLDER /opt/bundle
ENV SCRIPTS_FOLDER /docker

# Add default Google Fonts list (can be overridden by build arg)
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
ENV GOOGLE_FONTS=${GOOGLE_FONTS}

# Install OS runtime dependencies and font dependencies
RUN apk --no-cache add \
    bash \
    ca-certificates \
    fontconfig \
    wget \
    unzip \
    ttf-liberation \
    curl

# Create fonts directory and install fonts
RUN mkdir -p /usr/share/fonts/googlefonts && \
    echo '#!/bin/sh' > /install-fonts.sh && \
    echo 'for font in $GOOGLE_FONTS; do' >> /install-fonts.sh && \
    echo '  echo "Downloading $font..."' >> /install-fonts.sh && \
    echo '  curl -o font.css "https://fonts.googleapis.com/css2?family=$font&display=swap"' >> /install-fonts.sh && \
    echo '  grep -o "https://fonts.gstatic.com/s/[^)]*.ttf" font.css | while read url; do' >> /install-fonts.sh && \
    echo '    wget -P /usr/share/fonts/googlefonts "$url"' >> /install-fonts.sh && \
    echo '  done' >> /install-fonts.sh && \
    echo '  rm font.css' >> /install-fonts.sh && \
    echo 'done' >> /install-fonts.sh && \
    chmod +x /install-fonts.sh && \
    /install-fonts.sh && \
    fc-cache -f -v

# Copy in entrypoint with the built and installed dependencies from the previous image
COPY --from=server-dependencies $SCRIPTS_FOLDER $SCRIPTS_FOLDER/

# Copy in app bundle with the built and installed dependencies from the previous image
COPY --from=server-dependencies $APP_BUNDLE_FOLDER/bundle $APP_BUNDLE_FOLDER/bundle/

# Start app
ENTRYPOINT ["/docker/entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/readyz" || exit 1

CMD ["node", "main.js"]
