# Versioning and releases

Slatebox ships three artifacts from this repository. Each one has its own version, tags and
changelog, and all three follow [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).

| Artifact | Where it is published | Version lives in | Tag | Changelog |
| --- | --- | --- | --- | --- |
| **Slatebox**: the app (app.slatebox.com) and the self-host image | `ghcr.io/slatebox/slatebox:X.Y.Z` | root `package.json` | `vX.Y.Z` | [CHANGELOG.md](../CHANGELOG.md) |
| **slatebox**: the installer and CLI (`npx slatebox`) | npm [`slatebox`](https://www.npmjs.com/package/slatebox) | `packages/slatebox/package.json` | `slatebox@X.Y.Z` | [packages/slatebox/CHANGELOG.md](../packages/slatebox/CHANGELOG.md) |
| **slatebox-mcp**: the MCP server and its local CLI | npm [`slatebox-mcp`](https://www.npmjs.com/package/slatebox-mcp), the MCP registry (`server.json`) | `packages/slatebox-mcp/package.json` and `server.json` | `slatebox-mcp@X.Y.Z` | [packages/slatebox-mcp/CHANGELOG.md](../packages/slatebox-mcp/CHANGELOG.md) |

`packages/create-slatebox` follows `slatebox`: the release script moves its pin and its patch
version with every `slatebox` release. The installer runs one exact `slatebox-mcp`, so every
`slatebox-mcp` release also moves the `slatebox-mcp` pin in `packages/slatebox/package.json` (and
its lock entry). The installer's own version does not move with it: `npx slatebox mcp` serves the
new MCP server only once `slatebox` is released as well, so release the two together
(`--release slatebox-mcp:<bump> --release slatebox:patch`). The ship always runs the MCP server's
release first, whatever order the flags are typed in, so the `slatebox` tag points at a commit that
already pins the new `slatebox-mcp` (tags can't be moved afterwards), and the installer's notes
get a generated line, "Runs slatebox-mcp X.Y.Z". The canvas
engine, SlateboxJS, is versioned in its own repository.

## What a version number means

- **App and image.** Major: something people or self-hosters rely on goes away or changes
  incompatibly (a feature removed, a public link parameter or `/api/v1` behavior changed, an upgrade
  that needs manual steps or cannot be rolled back). Minor: new features, and data migrations that
  run on their own. Patch: fixes only. The hosted app always runs the newest build of `main`; the
  version marks what self-hosters get.
- **slatebox (installer).** Major: a command, flag or the install layout changes incompatibly.
  Minor: a new command, option or install target. Patch: fixes, and pinning a newer self-host image
  of the same major.
- **slatebox-mcp.** Major: a tool, prompt or resource removed or renamed, or its arguments changed
  incompatibly. Minor: new tools or options. Patch: fixes and wording.
- Before 1.0.0 a minor bump may include breaking changes (the npm packages are 0.x today).
- Pre-releases use `X.Y.Z-rc.N` (or `-beta.N`) and tag the same way (`v2.1.0-rc.1`).

## The app's next version: 2.0.0

The app has two earlier version lines. The hosted app was released as 1.0 to 1.3.21 until July
2026 (the older sections of [CHANGELOG.md](../CHANGELOG.md); the ship script still stamped Cloud
images `1.3.21-local…` because it reads the newest changelog heading). The self-host image then
published previews 0.1.0 to 0.2.2 in November 2026, built from the same code. The root
`package.json` starts at 0.2.2, the newest version actually published.

The next app release is **2.0.0**:

- it must be above every app version anyone has seen (1.3.21 and 0.2.2), so no person or tool reads
  it as a downgrade, and the image tag `2.0.0` sorts above `0.2.2`;
- the changes since 1.3.21 include breaking ones (themes and the `themeId` creation link parameter
  are gone), which call for a major version;
- the public surfaces it carries (`/api/v1`, the hosted MCP server, the self-host image) are ones
  people now build on, which is what 1.0 and above promise.

Cut it with an explicit version: `ship --release app:2.0.0`. After that, plain bumps apply.

**Order for the first release.** `release.mjs` reads the commit range from the artifact's previous
tag, and the ship has no way to pass `--since`. So the earlier versions must be tagged first:

1. Ship the branch that adds the release tooling (`cliff.toml`, `scripts/release.mjs`, the
   changelogs, `.github/workflows/release.yml`) without `--release`.
2. Run the owner's tag backfill, `backfill-release-tags.sh --apply`, against `community/main`
   (see [Earlier versions](#earlier-versions)).
3. Then `ship --release app:2.0.0` (and any npm package releases).

A `--release` before the backfill stops with "No earlier v* tag is reachable from HEAD" before
anything is built; nothing is left behind.

## Commits become the changelog

Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) (see
[CONTRIBUTING.md](../CONTRIBUTING.md#commit-messages-conventional-commits)).
[git-cliff](https://git-cliff.org), configured by [cliff.toml](../cliff.toml), turns them into
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) sections: `feat` is Added, `fix` is Fixed,
`perf`/`refactor`/`polish` is Changed, removals are Removed, `fix(security)` is Security; `docs`,
`test`, `chore`, `ci`, `build` and `style` are left out, and so is any commit scoped `release`
(the release tooling). Each artifact only sees commits that touch its paths: the npm packages
their `packages/...` folder, the app everything else except the release tooling.

Hand-written notes under `## [Unreleased]` in a changelog are kept: at release time they become the
release's **Highlights**, above the generated list. Use them for what a commit list cannot say well.

To preview the app's next section: `npm run changelog:preview`.

## Cutting a release

A release is a step of the ship, not a separate process: there is no release pull request and no
release bot.

```sh
# on the build box, through the usual ship entry point
slatebox-roscoe-ship.py --test --release slatebox-mcp:minor
slatebox-roscoe-ship.py --both --release app:2.0.0 --release slatebox:patch
```

`--release <artifact>:<major|minor|patch|X.Y.Z>` (repeatable) runs, after the stale-tree gate and
before anything is built:

1. `node scripts/release.mjs <artifact> <bump>` on the app checkout, which
   - computes the new version from the artifact's version file,
   - runs git-cliff over the commits since the artifact's previous tag,
   - writes the new changelog section (Highlights from `[Unreleased]`, then the generated groups)
     and the compare links,
   - updates the version files (and `package-lock.json`; `server.json` and the installer's
     `slatebox-mcp` pin for the MCP server; the `create-slatebox` pin for the installer),
   - commits `chore(release): <tag>` and creates the annotated tag, whose message is the notes.
2. The ship builds and checks that commit as usual, so the shipped identity is the release commit.
3. The ship pushes `main` and the new tags together, atomically. If any step before the push fails,
   the ship deletes the tags and drops the release commit, so nothing is left behind and a rerun
   starts clean. The cleanup names the dropped commit and any image tags already pushed for it
   (they point at a commit on no branch; nothing deploys them).

Release commits and tags made by a ship that was killed (so its cleanup never ran) are caught at
the start of the next ship: it refuses while `community/main..main` holds a `chore(release)`
commit or a local release tag is not on GitHub, and prints the command that removes them.

**Retrying after the push.** Once the push has succeeded the release is on `main`: the version
files already carry the new version and the tag is on GitHub. If a later step fails (deploy,
rollout, smoke), fix forward and rerun the ship **without** `--release`. A rerun with the same
`--release` for a tag that is already on GitHub at `HEAD` is treated as done and skipped; any
other repeat is refused, because the version is no longer above the current one.

**Push protection.** GitHub's secret-scanning push protection can reject the push (`GH013`). The
ship prints GitHub's message and stops, with nothing on `main`. Remove the secret and ship again,
or, for a false positive, use the bypass link GitHub prints. Never force-push.

Then `.github/workflows/release.yml` turns each pushed tag into a GitHub Release with the
changelog section as its notes. For an app tag it adds the self-host image's digest when
`ghcr.io/slatebox/slatebox:X.Y.Z` exists. "Latest" on the repository is always the newest stable
app release.

### After the tag: publishing

- **Self-host image (automatic):** `.github/workflows/selfhost-image.yml` builds
  `ghcr.io/slatebox/slatebox:X.Y.Z` from the tag, on a native runner per architecture, from the
  engine and relay commits the tag pins in `self-host/sources.json` (written by `release.mjs app
  --engine <sha> --relay <sha>`, which the ship passes from the engine build it consumed). It
  smoke-tests each architecture, pushes by digest, joins one index (exactly linux/amd64 and
  linux/arm64), signs it with cosign (keyless) with SLSA provenance, moves `X.Y`, `X`, `stable` and
  `latest` when it is the newest stable release (`preview` for an `-rc` tag), then publishes the
  signed release manifest and updates the signed update feed. Every self-hosted Slatebox sees the
  release in Admin › Updates within 6 hours. It publishes; it gates nothing. A dry run: Actions,
  Self-host image, Run workflow, the tag, `push` off (both architectures build and are
  smoke-tested, nothing is published). `self-host/build-images.sh` and
  `self-host/release-images.py` stay as the manual fallback.
- **npm packages:** from the tagged commit, `npm publish --workspace slatebox` or
  `npm publish --workspace slatebox-mcp` (the `prepublishOnly` checks run first).

### Self-host updates

Self-hosted servers update from GitHub, never from anywhere else:

| File | Where | Signed with |
| --- | --- | --- |
| the image `ghcr.io/slatebox/slatebox@sha256:…` | GHCR | cosign keyless (identity `https://github.com/Slatebox/slatebox/.github/workflows/selfhost-image.yml@refs/tags/vX.Y.Z`, issuer `https://token.actions.githubusercontent.com`) + provenance |
| `release-manifest.json` (+ `.sig`): version, index and per-platform digests, notes, `minUpgradeFrom`, `downgradeSafeTo`, migrations | assets of the release `vX.Y.Z` | the project release key (Ed25519, `sbrel1`) |
| `channels.json` (+ `.sig`): stable and preview versions, withdrawn versions, a sequence and an expiry | assets of the rolling release `update-feed` | the project release key |

The app (Admin › Updates) checks the feed every 6 hours and records what the admin wants. The host
updater (`updater.sh`, set up by the installer, every five minutes) asks the container over `docker
exec`, then fetches and verifies the feed and the manifest itself, refuses anything they do not
name, pulls by digest and runs the installer's upgrade (backup, health check, rollback).
`update-feed-refresh.yml` re-signs the feed every day so it never expires; run it by hand with
`yank: X.Y.Z=why` to withdraw a release (servers on it are told to update; nobody else installs it).

#### One-time setup (owner)

1. **Tag ruleset:** in the repository's Settings, Rules, a tag ruleset for `v*` that only the
   owner and the build box's deploy key may create, update or delete. Whoever can create a `v*`
   tag can ship to every self-hosted server.
2. **Release key:** `node scripts/release-manifest.mjs keygen --id slatebox-rel-2026-11 --out
   ~/slatebox-release-keys` (keep that folder off every repository). Add the printed public half
   to `RELEASE_KEYS` in `packages/slatebox/src/updater/verify.mjs` and its copy
   `web/app/server/updates/verify.mjs` in a commit before the first release. Make a second key the
   same way and keep it offline: it is added to `RELEASE_KEYS` only to rotate or to recover.
3. **Environment `release`:** Settings, Environments, New environment `release`, deployment
   branches and tags: tags `v*` only. Secret `SLATEBOX_RELEASE_KEY` = the private key file's
   contents; variable `SLATEBOX_RELEASE_KEY_ID` = `slatebox-rel-2026-11`.
4. **GHCR:** the package `ghcr.io/slatebox/slatebox` was first pushed from a laptop. In its package
   settings, Manage Actions access, add `Slatebox/slatebox` with the Write role, so the workflow's
   `GITHUB_TOKEN` can push.
5. **The feed release, once:** `gh release create update-feed --title "Self-host update feed"
   --notes "Signed channel feed for self-hosted updates. Do not delete." --latest=false
   --prerelease` (from the default branch).
6. **Ship script:** pass `--engine <sha> --relay <sha>` to `release.mjs app` with `--release app:…`.
- **npm packages:** from the tagged commit, `npm publish --workspace slatebox` or
  `npm publish --workspace slatebox-mcp` (the `prepublishOnly` checks run first).

### Without the ship script

To try the script, or to cut a release on a branch:

```sh
node scripts/release.mjs slatebox patch --dry-run   # shows the version, files and section
node scripts/release.mjs slatebox patch             # commits and tags locally; pushes nothing
node scripts/release.mjs notes slatebox@0.2.4       # prints a release's notes
node scripts/release.mjs current app                # prints a version
```

The script refuses a dirty tree, a branch other than `main` (unless `--any-branch`), an existing
tag, and a version that is not above the current one. When an artifact has no earlier tag, pass
`--since <ref>`.

## Earlier versions

The versions published before this scheme were tagged afterwards, at the commits they were built
from: the npm packages by matching each published tarball's files to a commit, and the image
previews by the commit recorded in each image's `org.opencontainers.image.revision` label.
`slatebox-mcp` 0.3.4 (published from an uncommitted version change) and 0.1.0 (published from
history that predates this repository) have no tag; their changelog entries say so.
