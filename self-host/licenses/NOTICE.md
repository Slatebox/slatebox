# What is inside the Slatebox image, and under which license

The image bundles several programs so that one container is a complete
Slatebox. They are separate works with separate licenses. **The image as a
whole is not under a single license, and it is not "MIT" as a whole.**

## Slatebox: MIT

| Part | License | Text in this image |
| --- | --- | --- |
| Slatebox app | MIT | `slatebox-app-LICENSE.md` |
| SlateboxJS, the canvas engine | MIT | `slateboxjs-LICENSE.txt` |
| Slatebox collaboration relay, a fork of y-websocket | MIT | `slatebox-relay-LICENSE.txt` |
| The start-up, health, backup and restore scripts under `/opt/slatebox/bin` and `/opt/slatebox/lib` | MIT, part of the Slatebox app repository | `slatebox-app-LICENSE.md` |

## Third-party programs, each under its own license

| Part | License | Text in this image |
| --- | --- | --- |
| MongoDB Community Server (`mongod`) | **Server Side Public License, version 1 (SSPL-1.0)**. This is not an MIT-style license. | `third-party/mongodb-server-SSPL.txt` |
| MongoDB Database Tools (`mongodump`, `mongorestore`) | Apache License 2.0 | `third-party/mongodb-database-tools-LICENSE.md` |
| Caddy, the front proxy | Apache License 2.0 | `third-party/caddy-LICENSE.txt` |
| Node.js, with the libraries it embeds | MIT, and the licenses listed in its license file | `third-party/node-LICENSE.txt` |
| Meteor, the app's framework | MIT | `third-party/meteor-LICENSE.txt` |
| tini, the container's init | MIT | `third-party/tini-LICENSE.txt` |
| npm packages used by the app and the relay | Each package's own license | In each package's folder under `/opt/slatebox/app/bundle` and `/opt/slatebox/relay/node_modules` |
| Fonts for rendering slate images (Google Fonts families and Liberation) | SIL Open Font License 1.1 or Apache License 2.0, per family | `/usr/share/fonts`, `/usr/share/doc/fonts-liberation/copyright` |
| Ubuntu base system | Each package's own license | `/usr/share/doc/*/copyright` |

## About MongoDB and the SSPL

The image runs an unmodified MongoDB Community Server binary, taken from
MongoDB's official `mongo` container image, as the database of this one
Slatebox installation. MongoDB is a separate program that Slatebox talks to
over a network connection; its license does not apply to Slatebox's own code.

The SSPL adds conditions for anyone who offers the functionality of MongoDB
to third parties as a service. If you plan to do that, or to redistribute this
image as part of a product, read `third-party/mongodb-server-SSPL.txt` and
decide what applies to you. This notice is not legal advice.

Setting `MONGO_URL` makes Slatebox use a database you run separately. The
bundled server is then not started, though its binary remains in the image.

All license texts are in `/opt/slatebox/licenses` inside the image:

    docker run --rm --entrypoint cat ghcr.io/slatebox/slatebox /opt/slatebox/licenses/NOTICE.md
