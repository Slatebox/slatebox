# Run your own Slatebox

One container is a complete Slatebox: the app, live collaboration, and the
database. Install Docker, run one command, open one address.

```sh
docker run -d --name slatebox -p 7070:7070 -v slatebox-data:/data ghcr.io/slatebox/slatebox
```

Open <http://localhost:7070>. A start usually takes well under a minute; until
then the page says that Slatebox is starting and opens by itself when it is
ready. `docker ps` shows the container as `healthy` once a slate can be opened.

Everything Slatebox stores is in the `slatebox-data` volume: your slates and
accounts, and the secrets generated for this installation on its first start.
There is nothing to configure and nothing to keep beside the volume.

The operator guide covers a public address and HTTPS, mail, AI drafts,
upgrades, backup and restore, and troubleshooting:
<https://docs.slatebox.com/installation/install-with-docker/>

## The same thing, with the settings most servers want

```sh
docker run -d --name slatebox --restart unless-stopped \
  -p 80:80 -p 443:443 \
  -e SLATEBOX_URL=https://boards.example.com \
  -v slatebox-data:/data ghcr.io/slatebox/slatebox
```

With an `https://` address, Slatebox obtains and renews its own certificate.
Point the DNS name at the host and let ports 80 and 443 through first.

## Settings

Every setting is optional and is given with `-e NAME=value`.

| Setting | What it does |
| --- | --- |
| `SLATEBOX_URL` | The address people type to reach this Slatebox. Default `http://localhost:7070`. Set it whenever the address is anything else, including another port. |
| `SLATEBOX_HTTPS` | `off` when your own proxy terminates HTTPS and forwards to port 7070. Otherwise an `https://` address turns on built-in HTTPS on ports 80 and 443. |
| `SLATEBOX_ACME_CA` | The ACME directory of your own certificate authority, when certificates should not come from Let's Encrypt. |
| `SLATEBOX_MAIL_URL` | An `smtp://` or `smtps://` URL. Turns on invitations, email verification and password mail. Mail is sent from `Slatebox <info@slatebox.com>`, so use a mail service that accepts that sender. |
| `SLATEBOX_AI_KEY` | A DeepInfra API key. Turns on AI drafts. |
| `SLATEBOX_AI_URL`, `SLATEBOX_AI_MODEL` | Use your own OpenAI-compatible endpoint and model for AI drafts. `SLATEBOX_AI_KEY` is then its bearer token, if it needs one. |
| `SLATEBOX_SETTINGS` | A JSON object of further app settings, for example `{"daily":{"apiKey":"…"}}` to turn on calls. |
| `MONGO_URL`, `MONGO_OPLOG_URL` | Use a MongoDB you run elsewhere. The bundled database is then not started. |

A misspelled `SLATEBOX_` setting stops the container with the list of valid
names, so a setting is never silently ignored.

## Everyday commands

```sh
docker logs slatebox                                           # what is happening
docker exec slatebox slatebox backup > slatebox-backup.gz      # back up while running
docker exec -i slatebox slatebox restore < slatebox-backup.gz  # restore a backup
```

To upgrade, pull the newer image, remove the container and run your `docker
run` command again. The volume keeps your data:

```sh
docker pull ghcr.io/slatebox/slatebox
docker rm -f slatebox
docker run -d --name slatebox -p 7070:7070 -v slatebox-data:/data ghcr.io/slatebox/slatebox
```

## Build the image from source

You need Git, Docker, and checkouts of three repositories: this one,
SlateboxJS, and the Slatebox collaboration relay
(<https://github.com/Slatebox/y-websocket>).

```sh
./build-image.sh /path/to/slateboxjs /path/to/y-websocket
```

The script builds from committed files only and prints the image name and the
command to run it. The image is labelled with the three source revisions. It
targets the Docker host's own architecture; set `TARGET_PLATFORM=linux/amd64`
or `linux/arm64` to choose. The Meteor build needs about 4 GB of memory.

## Test an image

The tests start real containers on ports 17000 to 17999 and remove everything
they create. They need Node 22 or newer, Docker, Chrome, and a checkout that
has `@playwright/test` installed (SlateboxJS does). Run them from this
directory:

```sh
SLATEBOX_IMAGE=<image name> PLAYWRIGHT_FROM=/path/to/slateboxjs/package.json \
  node --test --test-concurrency=1 tests/
```

They cover the image's contents (identity, licenses, no settings or keys),
the first start, restart, stop, a crashed process, upgrade, backup and
restore, every setting, and two browsers editing one slate. Outside services
are replaced by local stand-ins: a mail sink, an OpenAI-compatible endpoint,
a second MongoDB, a proxy in front, and Let's Encrypt's Pebble test server
as the certificate authority. To also search the image for the values in
settings files kept outside this checkout, list their folders in
`SLATEBOX_SETTINGS_DIRS`, separated by colons.

## What is inside, and its licenses

The Slatebox app, the SlateboxJS engine and the collaboration relay are MIT
licensed. The image also contains third-party programs under their own
licenses, most notably MongoDB Community Server under the Server Side Public
License (SSPL), which is not an MIT-style license. The image as a whole is
therefore not MIT. The full list and every license text are in the image:

```sh
docker run --rm --entrypoint cat ghcr.io/slatebox/slatebox /opt/slatebox/licenses/NOTICE.md
```

[DESIGN.md](DESIGN.md) explains how the container is put together.
