# Governance

Slatebox is an open-source project led by its maintainers at Slatebox LLC. This page says who
decides what, and how changes and releases happen.

## Maintainers

| Maintainer | Areas |
| --- | --- |
| Tim Heckel ([@TimHeckel](https://github.com/TimHeckel)) | Everything; project lead |

Maintainers review and land changes, triage issues, answer in Discussions, cut releases and enforce
the [Code of Conduct](CODE_OF_CONDUCT.md). [CODEOWNERS](.github/CODEOWNERS) lists who reviews which
paths.

Contributors who make sustained, high-quality contributions and help others may be invited to
become maintainers by the existing maintainers. A maintainer who is inactive for six months may be
moved to emeritus status, and can return by asking.

## Decisions

- Most decisions are made in the open, in issues, pull requests and
  [Discussions](https://github.com/Slatebox/slatebox/discussions), by lazy consensus: a proposal
  that draws no objection from a maintainer goes ahead.
- Larger changes (a new surface, a breaking change, a change to how the project works) start as an
  issue or discussion describing the problem and the proposal, before the code.
- When consensus is not reached, the project lead decides and writes down why.
- The MIT-licensed core stays MIT. The `enterprise/` directory is under its own license
  ([enterprise/LICENSE](enterprise/LICENSE)), and nothing outside it depends on it.

## How changes land

`main` is the only long-lived branch and is always deployable. Changes reach it through one script,
`ship`, run by a maintainer on the build box after the maintainer has run the targeted checks for
the change (tests for the changed files, lint). The script refuses a branch that is behind `main`,
scans the tree for secrets, builds and checks the image, fast-forwards and pushes `main`, deploys
and checks the live app; if a step before the push fails, nothing reaches `main`. Nobody pushes to `main` by hand or with the merge button.

Review happens on pull requests, but there is no required review, required check or merge queue:
the ship script's checks are the gate, and the full suite runs after each ship. A red suite is
fixed forward by whoever caused it; a rollback is a deliberate maintainer decision. GitHub Actions
results on pull requests are informational.

## Releases

Each released artifact (the app and self-host image, the `slatebox` npm package and the
`slatebox-mcp` npm package) follows [Semantic Versioning](https://semver.org) and has its own tags
and changelog. A release is a step of the ship script; the GitHub Release is created from the pushed
tag. See [docs/releasing.md](docs/releasing.md).

## Security

Vulnerabilities are handled privately, as described in [SECURITY.md](SECURITY.md).

## Changes to this document

Changes to governance are proposed as a pull request to this file and decided by the maintainers.
