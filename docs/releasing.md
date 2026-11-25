# Versioning and releases

Slatebox ships three artifacts from this repository. Each one has its own version, tags and
changelog, and all three follow [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).

| Artifact | Where it is published | Version lives in | Tag | Changelog |
| --- | --- | --- | --- | --- |
| **Slatebox**: the app (app.slatebox.com) and the self-host image | `ghcr.io/slatebox/slatebox:X.Y.Z` | root `package.json` | `vX.Y.Z` | [CHANGELOG.md](../CHANGELOG.md) |
| **slatebox**: the installer and CLI (`npx slatebox`) | npm [`slatebox`](https://www.npmjs.com/package/slatebox) | `packages/slatebox/package.json` | `slatebox@X.Y.Z` | [packages/slatebox/CHANGELOG.md](../packages/slatebox/CHANGELOG.md) |
| **slatebox-mcp**: the MCP server and its local CLI | npm [`slatebox-mcp`](https://www.npmjs.com/package/slatebox-mcp), the MCP registry (`server.json`) | `packages/slatebox-mcp/package.json` and `server.json` | `slatebox-mcp@X.Y.Z` | [packages/slatebox-mcp/CHANGELOG.md](../packages/slatebox-mcp/CHANGELOG.md) |

`packages/create-slatebox` follows `slatebox`: the release script moves its pin and its patch
version with every `slatebox` release. The canvas engine, SlateboxJS, is versioned in its own
repository.

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

## Commits become the changelog

Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) (see
[CONTRIBUTING.md](../CONTRIBUTING.md#commit-messages-conventional-commits)).
[git-cliff](https://git-cliff.org), configured by [cliff.toml](../cliff.toml), turns them into
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) sections: `feat` is Added, `fix` is Fixed,
`perf`/`refactor`/`polish` is Changed, removals are Removed, `fix(security)` is Security; `docs`,
`test`, `chore`, `ci`, `build` and `style` are left out. Each artifact only sees commits that touch
its paths: the npm packages their `packages/...` folder, the app everything else.

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
   - updates the version files (and `package-lock.json`; `server.json` for the MCP server; the
     `create-slatebox` pin for the installer),
   - commits `chore(release): <tag>` and creates the annotated tag, whose message is the notes.
2. The ship builds and checks that commit as usual, so the shipped identity is the release commit.
3. The ship pushes `main` and the new tags together, atomically. If any step before the push fails,
   the ship deletes the tags and drops the release commit, so nothing is left behind and a rerun
   starts clean.

Then `.github/workflows/release.yml` turns each pushed tag into a GitHub Release with the
changelog section as its notes. For an app tag it adds the self-host image's digest when
`ghcr.io/slatebox/slatebox:X.Y.Z` exists. "Latest" on the repository is always the newest stable
app release.

### After the tag: publishing

Publishing stays a deliberate, owner-run step, outside CI:

- **Self-host image:** build and publish `ghcr.io/slatebox/slatebox:X.Y.Z` from the tagged commit
  (`self-host/build-images.sh`, `self-host/release-images.py`), then run the Release workflow by hand
  (Actions, Release, Run workflow, tag `vX.Y.Z`) so the release notes record the digest.
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
