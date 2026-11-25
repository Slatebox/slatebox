# Contributing to Slatebox

Thanks for helping. Slatebox is free and open source, and it gets better with every bug report,
fix, guide and idea. This page covers how to set up, how to write a change, and how changes ship.

- [Code of Conduct](#code-of-conduct)
- [Ways to help](#ways-to-help)
- [The repository](#the-repository)
- [Development setup](#development-setup)
- [Tests](#tests)
- [Commit messages: Conventional Commits](#commit-messages-conventional-commits)
- [Pull requests](#pull-requests)
- [How changes ship](#how-changes-ship)
- [Licensing of contributions](#licensing-of-contributions)

## Code of Conduct

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report
unacceptable behavior through https://slatebox.com/contact/?topic=conduct.

## Ways to help

- **Questions and ideas** go to [Discussions](https://github.com/Slatebox/slatebox/discussions)
  (support.slatebox.com). See [SUPPORT.md](SUPPORT.md).
- **Bugs**: open an [issue](https://github.com/Slatebox/slatebox/issues/new/choose) with steps to
  reproduce.
- **Security problems**: never in public. Use a
  [private report](https://github.com/Slatebox/slatebox/security/advisories/new); see
  [SECURITY.md](SECURITY.md).
- **Code and docs**: issues labeled
  [`good first issue`](https://github.com/Slatebox/slatebox/labels/good%20first%20issue) and
  [`help wanted`](https://github.com/Slatebox/slatebox/labels/help%20wanted) are good places to
  start. For anything larger than a fix, open an issue or a discussion first so we can agree on the
  shape before you spend time on it.

## The repository

| Path | What it is | Versioned as |
| --- | --- | --- |
| [`web/app`](web/app) | The Slatebox app (Meteor 3.5, React) | app, tags `vX.Y.Z` |
| [`self-host`](self-host) | The one-container image `ghcr.io/slatebox/slatebox` | with the app |
| [`packages/slatebox`](packages/slatebox) | `npx slatebox`: the installer and CLI | npm `slatebox`, tags `slatebox@X.Y.Z` |
| [`packages/slatebox-mcp`](packages/slatebox-mcp) | The MCP server and local CLI | npm `slatebox-mcp`, tags `slatebox-mcp@X.Y.Z` |
| [`packages/create-slatebox`](packages/create-slatebox) | A thin `create-slatebox` wrapper around `npx slatebox install` (not on npm yet) | follows `slatebox` |
| [`scripts`](scripts) | Tests, checks and the release script | |
| [`docs`](docs) | Guides that live with the code (docs.slatebox.com is the published site) | |
| [`enterprise`](enterprise) | Enterprise features. **Not MIT**: [Slatebox Enterprise License](enterprise/LICENSE) | with the app |

The canvas engine, SlateboxJS, lives in its own repository,
[Slatebox/slateboxjs](https://github.com/Slatebox/slateboxjs).

Versioning, tags and releases are described in [docs/releasing.md](docs/releasing.md).

## Development setup

You need Node 22 (`web/app/.nvmrc` pins 22.12.0 for the app; the npm packages need 22.13 or later), [Meteor 3.5](https://docs.meteor.com/about/install.html)
and Git. Meteor runs its own MongoDB in development.

1. Clone this repository and, next to it, the engine. The app links the engine from a sibling
   folder named `slateboxjs-v2` (see `web/app/package.json`):

   ```sh
   git clone https://github.com/Slatebox/slatebox.git
   git clone https://github.com/Slatebox/slateboxjs.git slateboxjs-v2
   (cd slateboxjs-v2 && npm install && npm run build)
   ```

2. Install the app's dependencies and make a local settings file. No settings file with real
   values is ever committed; `settings.dev.json` is git-ignored.

   ```sh
   cd slatebox/web/app
   meteor npm install
   cp settings.example.json settings.dev.json
   ```

3. Start the app, then open http://localhost:3000:

   ```sh
   meteor run --settings ./settings.dev.json
   ```

   Meteor reloads the app as you edit. Fill in only the keys you need in `settings.dev.json`
   (for example an agent provider key to try chat); everything else works without them.

For the npm packages, install the workspaces from the repository root:

```sh
npm ci --workspace slatebox --workspace slatebox-mcp
```

## Tests

Run the tests for what you changed before you open a pull request. Most suites are plain
`node --test` files in [`scripts/`](scripts) and in each package, grouped as npm scripts in the root
[package.json](package.json). A few examples:

| You changed | Run |
| --- | --- |
| The installer (`packages/slatebox`) | `npm run test:installer` |
| The MCP server (`packages/slatebox-mcp`) | `npm run test:mcp:unit` |
| The self-host image (`self-host`) | `npm run test:self-host` |
| Slate operations, the API, exec | `npm run test:slate-operations`, `npm run test:exec` |
| Release tooling or a changelog | `npm run test:release` |
| Something risky in the app | `npm run test:port-container` (builds the image, runs a two-client suite) |

`npm run test:mcp` runs the MCP server's whole suite, including
`tools-against-app.integration.test.js`, which loads the app's server code and the engine: run it
once the app's dependencies (`web/app`, `meteor npm install`) and the engine (the sibling
`slateboxjs-v2` build) are installed, as in the setup above.

A failing test is fixed in the code, or in the test only when the test itself is wrong. Never
loosen a test to make it pass.

## Commit messages: Conventional Commits

Commits follow [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/). The
changelogs and release notes are generated from them ([cliff.toml](cliff.toml)), so the subject is
written for the people who use Slatebox:

```
<type>(<scope>): <what changes, in plain words>

<optional body: why, and anything a reviewer should know>

<optional footers, for example BREAKING CHANGE: ... or Fixes #123>
```

| Type | Use it for | Changelog group |
| --- | --- | --- |
| `feat` | Something new people can do | Added |
| `fix` | Something that was broken now works | Fixed |
| `perf`, `refactor`, `polish` | Faster, restructured, or a visual refinement | Changed |
| `feat`/`fix` subject starting with "remove" or "drop" | Taking something away | Removed |
| `fix(security)` | A security fix (after any advisory is published) | Security |
| `docs`, `test`, `chore`, `ci`, `build`, `style` | Everything else | not listed |

- The scope is the area: `installer`, `mcp`, `self-host`, `boards`, `agents`, `exec`, `library`,
  and so on. Look at `git log --oneline` for the names in use.
- A breaking change adds `!` after the type or scope (`feat(api)!: ...`) or a `BREAKING CHANGE:`
  footer. It moves the next release up a major version.
- `chore(release): ...` commits are made by the release script only.

## Pull requests

- Branch from the latest `main` and keep your branch rebased on it (no merge commits from `main`).
- Keep a pull request to one change. Small pull requests land faster.
- The title is a Conventional Commit; it becomes the commit subject when a pull request is squashed.
- Fill in the template: what changes, why, and how you tested it. Screenshots help for anything
  visible.
- Update docs, READMEs, or the `[Unreleased]` notes in the relevant changelog when people will
  notice the change. Hand-written `[Unreleased]` notes become the release's highlights.
- [CI](.github/workflows/ci.yml) runs secret scanning, workflow lint and the tests for the parts you
  touched. It is informational: a maintainer reads it, but it is not a required check (see below).

## How changes ship

Slatebox ships from `main` with one script, run by a maintainer on the build box. There is no merge
queue and no required check on GitHub. The script is the gate:

1. A maintainer reviews your pull request and runs the targeted checks for it (the tests for the
   changed files, lint), then lands it with `ship`. The script refuses a branch that is not rebased
   on the current `main` or has uncommitted changes, scans the tree for secrets, builds the engine
   and the app image, checks the image's pages and the self-host image built from the same tree,
   fast-forwards and pushes `main`, deploys, and checks the live app in a browser. If any step
   before the push fails, nothing reaches `main`.
2. If your commits land unchanged, GitHub marks the pull request as merged. If they were rebased
   or squashed on the way, the maintainer closes the pull request with a link to the commit that
   landed.
3. After the ship, the full test suite runs against the new `main`. If it turns red, the fix goes
   forward through the same path; changes are not rolled back by default.
4. Releases are a step of the same script (`ship --release <artifact>:<bump>`); see
   [docs/releasing.md](docs/releasing.md).

Maintainers do not use the merge button to update `main`, and nobody pushes to `main` by hand.

## Licensing of contributions

Everything in this repository is MIT ([LICENSE](LICENSE); see [LICENSING.md](LICENSING.md)) except the `enterprise/` directory, which
is under the [Slatebox Enterprise License](enterprise/LICENSE).

- **MIT code**: you contribute under the MIT license, the same license the project uses
  ("inbound = outbound", as GitHub's Terms of Service, section D.6, also provide). You keep your
  copyright.
- **`enterprise/`**: a contribution there is made under section 3 of
  [enterprise/LICENSE](enterprise/LICENSE).
- MIT code must work without `enterprise/` and never imports from it. Enterprise code reaches the
  app only through the loader (`web/app/server/enterprise-loader.mjs`,
  `web/app/imports/api/client/enterprise-slots.mjs`), and only where it is unlocked.

**No CLA, and no DCO sign-off.** A CLA would ask contributors to sign a separate agreement, and the
MIT core does not need one. We considered the Developer Certificate of Origin (`git commit -s`) and
chose not to require it: the license grant above already covers MIT contributions, and
`enterprise/` has its own written terms; enforcing sign-offs would need a required check, which
our shipping policy does not have; and a missing sign-off is the most common reason a first
contribution stalls. By opening a pull request you confirm that you have the right to submit the
work under these terms.
