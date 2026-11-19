# Design: Slatebox in one container

One image, `ghcr.io/slatebox/slatebox`, is a complete Slatebox. One command
starts it, one volume holds everything it knows, one port serves it.

```sh
docker run -d --name slatebox -p 7070:7070 -v slatebox-data:/data ghcr.io/slatebox/slatebox
```

## Process tree

```
tini                     PID 1: reaps orphans, passes SIGTERM on
└─ slatebox-init         the supervisor, a Bash script
   ├─ mongod             MongoDB 8.0, single-member replica set    127.0.0.1:27017
   ├─ node bin/server.js collaboration relay (y-websocket fork)    127.0.0.1:7072
   ├─ node main.js       the Slatebox app (Meteor bundle)          127.0.0.1:3000
   └─ caddy              front proxy                               0.0.0.0:7070 (and :80, :443 with built-in HTTPS)
```

Everything runs as the unprivileged user `slatebox` (10001). Nothing in the
container ever runs as root, and only Caddy listens beyond loopback. The
account's home is `/run/slatebox`, inside the container, so that caches never
land on the data volume.

**Supervisor: tini plus a Bash script.** The job is small: start four
processes in order, stop them in order, and leave when one of them dies. tini
(a 30 kB static binary from Ubuntu's package) does what PID 1 must do. The
script (`rootfs/opt/slatebox/bin/slatebox-init`) uses Bash's `wait -n -p`,
adds no runtime and no resident memory beyond the shell, and is short enough
to read in one sitting. s6-overlay and supervisord were considered: both want
to keep a container alive and restart services inside it, which is the
opposite of what Docker's restart policy needs, and supervisord would add a
Python runtime.

**Front proxy: Caddy.** One static binary proxies HTTP and WebSocket
traffic and obtains and renews certificates by itself. nginx would need a
second program for certificates. A proxy written for the purpose in Node
would not do HTTPS.

## One port, one origin

The browser talks to a single origin. Caddy sends `/live/*` to the relay with
the prefix removed (the relay reads the room name from the path) and
everything else to the app. The app tells browsers where the relay is through
`public.wsUrl`, which `configure.mjs` derives from the public address:
`http://localhost:7070` gives `ws://localhost:7070/live`,
`https://boards.example.com` gives `wss://boards.example.com/live`.
`Canvas.jsx` and `SnapSlate.jsx` hand that value to SlateboxJS unchanged, and
y-websocket appends `/<room>?bearer=…&timestamp=…`.

Because links, sign-in mail and the live-editing address are all built from
the public address, the proxy only serves the app for that address (and for
the container's own loopback checks). Reached under any other host or port it
answers with a page that says which setting to change, rather than an app in
which live editing silently fails.

While the app boots, Caddy answers with a self-refreshing "Slatebox is
starting" page instead of a refused connection.

## Paths under /data

| Path | Contents |
| --- | --- |
| `/data/db` | MongoDB data files |
| `/data/secrets/secrets.json` | Generated secrets, mode 0600 in a 0700 directory |
| `/data/secrets/mongo.key` | Replica-set key file, mode 0400 |
| `/data/caddy` | Certificates and ACME account, only with built-in HTTPS |
| `/data/tmp` | Working files of a running backup or restore |

Files rendered for the current start (environment for the app and relay, the
Caddyfile, credentials for the database tools) live in `/run/slatebox`, mode
0600, inside the container and not on the volume. They are rewritten at every
start.

## First start, and every start

1. `configure.mjs` validates the settings, creates any missing secret with
   `crypto.randomBytes(32)` (Mongo root, app and relay passwords, the
   replica-set key, the API key pair the app and relay share, and the relay's
   encryption key), and renders the files above. An unknown `SLATEBOX_*`
   variable stops the start with the list of valid names. A database without
   its secrets stops the start too.
2. `mongod` starts with access control on, bound to loopback.
3. `mongo-init.mjs` initiates the replica set and creates the `root`, `app`
   and `relay` accounts if they are missing, then waits for a writable
   primary. The first administrator is created through MongoDB's loopback
   exception; an interrupted first start resumes where it stopped.
4. Caddy, the relay and the app start.
5. A readiness check opens a signed live-editing connection through port
   7070, exactly as a browser would. Only then does the log say `Ready`.

A second start finds the secrets and the accounts and changes neither.
No secret is in the image, in the container's environment or in the log.

## Health

`HEALTHCHECK` runs `slatebox health`: through port 7070 it asks the app's
`/readyz` (which queries the slates collection) and the relay. It is green
only when the proxy, the app, the database and the relay all answer. The
signed WebSocket handshake is part of the start-up check and of every restore;
it is left out of the periodic check because the relay logs each connection.

The start-up check allows ten minutes before it gives up and the container
exits; the health check's start period is the same. A start normally takes
well under a minute, but the app's boot is CPU-bound and a small or busy
machine can need several.

## Stopping and failing

`docker stop` sends SIGTERM. The supervisor stops the app and the relay first
(they hold no state and end at once; after three seconds they are killed),
then sends SIGTERM to Caddy and `mongod` together and waits for MongoDB's
clean exit. MongoDB's fifteen-second quiesce period for signalled shutdowns is
set to zero, since its clients are already gone. What remains is the storage
engine's final checkpoint: under a second on an idle disk, several seconds on
a heavily loaded one. Exit status 0. If the disk is so slow that this exceeds
Docker's ten-second default, Docker kills the container and MongoDB replays
its journal at the next start; no acknowledged write is lost.

If any of the four processes ends by itself, the same ordered stop runs and
the container exits with status 1. With `--restart unless-stopped` Docker
starts it again on the same volume.

The supervisor also answers two signals used by `slatebox restore`: SIGUSR1
stops the app and the relay and leaves MongoDB and Caddy running (the proxy
shows the starting page), SIGUSR2 starts them again.

## The log

Every line carries the name of the process that wrote it: `[slatebox]`,
`[app]`, `[relay]`, `[proxy]`, `[mongo]`. MongoDB writes a JSON line for
every routine event and several host-tuning hints at each start; only its
errors are passed on. Caddy logs errors only. The relay's deprecation notice
from Node 24 is switched off.

## Settings

Every setting is optional.

| Variable | Effect |
| --- | --- |
| `SLATEBOX_URL` | The address people type. Default `http://localhost:7070`. |
| `SLATEBOX_HTTPS` | `auto` (default): an `https://` address turns on built-in HTTPS on ports 80 and 443. `off`: your own proxy terminates HTTPS and forwards to 7070. |
| `SLATEBOX_ACME_CA` | ACME directory of a private certificate authority, instead of Let's Encrypt. |
| `SLATEBOX_MAIL_URL` | `smtp://` or `smtps://` URL for invitations, verification and password mail. |
| `SLATEBOX_AI_KEY` | DeepInfra key; turns on AI drafts. With `SLATEBOX_AI_URL`, the bearer token for that endpoint. |
| `SLATEBOX_AI_URL`, `SLATEBOX_AI_MODEL` | An OpenAI-compatible endpoint and model to use for AI drafts instead of DeepInfra. |
| `SLATEBOX_SETTINGS` | A JSON object merged into the app's settings, for integrations without a variable of their own (`daily.apiKey` for calls, `aws.*` for published images). It cannot change the generated address and key wiring. |
| `MONGO_URL`, `MONGO_OPLOG_URL` | Use an external MongoDB. The bundled `mongod` is not started. |

Parity with the Compose kit's `init.mjs`: the same settings object
(`public.env = selfhost`, `baseUrl`, `wsUrl`, `chatWoot.enabled = false`,
`slateboxAPI`, `selfHosted.workshopAI`), the same three database accounts and
relay role, the same relay environment (`API_KEYS`, `API_GEN_KEY`).

## Upgrade, backup, restore

**Upgrade:** pull, remove the container, run the same command. The volume
carries the data and the secrets; the new container finds both.

**Backup:** `docker exec slatebox slatebox backup > slatebox-backup.gz` writes
a gzip-compressed `mongodump` archive of the `slatebox` database. The dump is
completed and verified inside the container before the first byte is written
out, so a failed backup leaves an empty file, never a plausible partial one.
The secrets are not in the backup and are not needed: accounts, passwords and
login tokens live in the database, and the API key pair only signs live
connections between the app and relay of one installation.

**Restore:** `docker exec -i slatebox slatebox restore < slatebox-backup.gz`,
into the same container or a new one. The restore verifies the file, pauses
the app and relay (the supervisor handles SIGUSR1 and SIGUSR2 for this; the
proxy shows the starting page meanwhile), saves the current database, replaces
it, starts the app and relay again and waits for the signed readiness check.
If loading fails, the saved database is put back.

## Build

`./build-image.sh <SlateboxJS checkout> <y-websocket checkout>` stages the
committed files of the three repositories and runs one multi-stage
`Dockerfile`:

- `engine`: a fresh SlateboxJS build for every image, versioned
  `<version>+selfhost.<revision>`. The app's manifest and lock normally point
  at a sibling checkout; `build/pin-engine.mjs` points them at that tarball
  and checks the result.
- `meteor-build`: the Meteor bundle. The build stops if a `settings*.json` is
  in the app tree; the script removes them and the context ignores them.
- `server-dependencies`: native modules for the runtime's own base. bcrypt 5
  inside `accounts-password` is replaced by bcrypt 6 before the rebuild,
  because bcrypt 5 has no arm64 glibc binary and does not compile on Node 24.
  Third-party source maps, editor folders and the sample keys in packages'
  test suites are left out (about 130 MB).
- `relay`, `fonts`: production dependencies of the relay; the Google Fonts
  families the server uses to render slate images.
- `runtime`: Ubuntu 24.04 (the platform MongoDB 8.0 publishes builds for),
  Node 24.15.0, `mongod`, `mongodump` and `mongorestore` from the official
  `mongo` image, Caddy from the official `caddy` image, tini.

The result is about 360 MB to download and 1.5 GB on disk, of which the
app's server bundle is 0.94 GB (it carries every npm dependency of the app,
as the hosted image does) and MongoDB 0.25 GB. The four images of the Compose
kit came to more than twice that.

Labels and `/opt/slatebox/identity.json` carry the app, engine and relay
revisions. The base is glibc because MongoDB publishes no musl build; that
is also why this file does not reuse the Alpine stages of `web/Dockerfile`.

License notices are in `/opt/slatebox/licenses`. The image is not MIT as a
whole: MongoDB Community Server is SSPL-1.0.

## What was removed, and why

| Removed | Because |
| --- | --- |
| `compose.yaml`, `Caddyfile`, `mongo-init.js` | Five containers became one; their roles live in `slatebox-init`, `configure.mjs` and `mongo-init.mjs`. |
| `run`, `init.mjs` | There is no initialise step and no state directory beside the checkout. Secrets are generated inside the container on first start. |
| `hostnames.mjs` and the `promote` command | The address is a setting read at every start. Changing it means starting the container with a new `SLATEBOX_URL`. There is one hostname, not two. |
| `build-images.sh` | Replaced by `build-image.sh`, which builds one image and moves the engine build into the Docker build. |
| `release-images.py`, its test, the release-archive flow | Two images had to be matched by hand across two architectures. One multi-architecture image needs no matching. |
| `tests/mongo-restart.sh` | It tested the Compose entrypoint. The image tests cover restart with real data. |

## Left for later

- Publishing: a `docker buildx` multi-platform build and push to GHCR, with
  `org.opencontainers.image.source` set to the public repository. The image
  has been built and tested on linux/arm64 only; the amd64 image has not been
  built or run yet. Nothing in the Dockerfile is specific to one architecture.
- MongoDB major upgrades (8.0 to a later series) need a
  feature-compatibility step; the image pins 8.0.
- Two things in the app, outside this directory, show in a self-hosted
  installation: mail is sent from the fixed address `info@slatebox.com`
  (`server/email/setup.js`), which many SMTP providers reject for a sender
  who does not own that domain; and every page requests an analytics script
  from `cdn.heapanalytics.com` with no key (`imports/ui/components/LoadHeap.jsx`),
  which fails with a 404 and sends nothing but is a call to a third party.
