# Changelog: slatebox

All notable changes to the `slatebox` npm package (`npx slatebox`: the installer and CLI for a self-hosted Slatebox) are recorded here. Releases are tagged `slatebox@X.Y.Z` in
[Slatebox/slatebox](https://github.com/Slatebox/slatebox) and published to npm as
[`slatebox`](https://www.npmjs.com/package/slatebox).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Sections are generated from
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) that touch this package, by
[git-cliff](https://git-cliff.org) when a release is cut with `scripts/release.mjs` (see
[docs/releasing.md](../../docs/releasing.md)). Notes written by hand under [Unreleased] become that
release's highlights.

## [Unreleased]

## [0.3.0] - 2026-11-25

### Added

- **updates:** automatic updates for self-hosted Slatebox: `slatebox install` and `slatebox upgrade` set up a host
  updater (a launchd agent, systemd timer or cron line every five minutes) on an image that has
  `slatebox updates` (2.1.0 on). It applies only a release signed by Slatebox, pulled by its digest,
  through the same backup, health check and rollback as `slatebox upgrade`; when to apply is set in
  Admin › Updates. New: `slatebox updates [enable | disable | check | apply | auto on|off | run]`
  (also `slatebox update`), `--no-auto-updates`. `slatebox uninstall` removes the updater.
  `slatebox upgrade` refuses while an automatic update runs.
- **installer:** a wizard in the terminal. Questions, answers, the plan and the setup link are
  in the terminal's own text color (bold where it matters), so they read on light and dark
  backgrounds; Slatebox gold (dark), deep green (light) or mid tones (not known) mark the
  pointer, steps and tags. The background comes from `SLATEBOX_THEME=light|dark`, `COLORFGBG`,
  or the terminal's answer to a background query. The machine
  check runs first and shows one row per check (Docker, processor, disk, port; `r` checks
  again). Six short sections follow (where, address, admin, agents, sign-in, review),
  answered with the arrow keys, numbers and Enter, and each answer folds into one line. A
  taken team address offers the free ones to pick. One question takes the usual settings
  for backups, size and mail (exactly what `--yes` would choose). The review shows the plan
  in a box, with Install, Change a section… (asks that section again) or Cancel, and `d` for
  every file and command; on a server or a cluster Cancel is highlighted, as before. Each
  install step is a spinner row that settles into its result and time, and the end shows
  where Slatebox runs and the one-time setup link, never wrapped (a link the terminal can
  open, where it supports one). Ctrl-C stops at any question and changes nothing (exit 7),
  and the terminal is always given back.
- **installer:** `--plain` (or `SLATEBOX_PLAIN=1`) keeps the line-by-line questions, for
  screen readers and simple terminals. They are also used with `TERM=dumb`, in CI, without
  raw mode, or under 60 columns, and they are the same, byte for byte, as in 0.2.3.
  `NO_COLOR` and `FORCE_COLOR` are honored.
- **installer:** dependencies: `@clack/core` is pinned to exactly 1.6.0 (as `slatebox-mcp` is
  to its version). Its own four small dependencies (fast-string-width, fast-string-truncated-width,
  fast-wrap-ansi, sisteransi; all MIT, no install scripts) keep the caret ranges `@clack/core`
  publishes, so `npx slatebox` resolves the newest within those ranges, as it already does for
  `slatebox-mcp`'s `@modelcontextprotocol/sdk`. No `npm-shrinkwrap.json` is shipped.
- **installer:** after "Slatebox is running", the wizard continues with the first admin:
  **Create the admin account now** (recommended) asks name, email (the admin email given
  earlier), team name and the password twice (hidden, with a strength check) and sends them to
  the server's own one-time setup endpoint (`POST /setup/<token>`, the form the setup link
  opens; no new server path), over this computer's port or the link's address. The link is
  single use and stops working once the admin exists. **I'll use the setup link** shows the
  link with a QR code and waits up to 10 minutes (polling the setup state) for the admin to be
  created; Enter stops waiting and keeps the link. With single sign-on only, the link is kept.
- **installer:** plain prompts (`--plain` and friends) ask one optional question after the
  closing lines, only at a terminal: "Create the admin account here in the terminal now?".
  `--yes` and `--json` are unchanged (no question; the JSON events are the same).
- **installer:** where no browser can open (an SSH session, Linux with no `DISPLAY` or
  `WAYLAND_DISPLAY`, a container, CI) the device sign-in and the setup link are not offered to a
  browser: "No browser here (this is an SSH session). Open this on any device:" with the link
  (an OSC 8 link where the terminal supports one) and, in the wizard, a QR code (half blocks,
  black on white; ASCII without Unicode). An opener that is missing, exits non-zero or errors
  says so and shows the same. `--plain --qr` adds the QR code to plain output.
- **installer:** the QR encoder is vendored (uqr 0.1.3, MIT, pure JavaScript) in
  `src/vendor/qrcode.mjs`; the package still has two dependencies.
- **installer:** a setup link or sign-in page on `localhost` / `127.0.0.1` / `::1`, with no
  browser here, says "This link opens only on this computer:" instead of "Open this on any
  device:", gives the `ssh -L <port>:localhost:<port> <user>@<server>` tunnel (the server
  address from `SSH_CONNECTION`) and shows no QR code; the wizard's "I'll use the setup link"
  hint says so too.
- **installer:** plain closing lines with no browser here say so before the setup link ("No
  browser here (...). Open this on any device:"), and `--qr` adds a QR code for the setup link
  there (it was only on the device sign-in page). Runs where a browser can open (every golden
  transcript) are unchanged.

### Changed

- The wizard's key handling is `@clack/core` 1.6.0 (pinned exactly; about 56 kB), loaded only
  for a wizard run: `--version`, `--json`, `--yes`, agents, pipes and CI never load it.
- `--json`, `--yes`, a run with nobody to ask (exit 3), the answers file, flags and exit codes
  are unchanged.
- `create-slatebox` 0.1.4 installs `slatebox` 0.3.0.
- **installer:** golden QR snapshot `setup-link.color.txt` follows the new colored look.
- **installer:** golden transcript `plain-team-taken.stderr.txt` gains one line, the optional
  first-admin question (no answer left in that scenario, so the printed link stays as it is).
  The scenario sets `DISPLAY` (a Linux desktop), so its browser question is asked as before.

### Fixed

- **installer:** Esc or Ctrl-C at a first-admin question (First admin, Name, Email, Team,
  Password) no longer reports a finished install as "Canceled. Nothing was changed." with exit
  7: it ends that step only, keeps the setup link (shown in its box if it was not yet), draws
  the closing lines (the secrets warning, the install record, next steps) and exits 0. Ctrl-C
  between those questions (while the account is being created) does the same, abandoning the
  request in flight, instead of "Run slatebox install again to finish". Plain prompts: the
  input ending or a cancel at any first-admin question leaves the printed link, exits 0 and
  still runs `--show-secrets`; a password question at the end of piped input no longer asks
  again forever.
- **installer:** the wait for the admin is bounded: each check (the setup page first, a cheap
  GET; the image's own `setup-link --check` through docker or kubectl exec only when no page
  answers) is given up on after 10 seconds and raced against Enter and the 10-minute
  deadline, so a hung exec no longer holds the wait (and Enter) for up to 15 minutes, and the
  container no longer starts a process every 3 seconds.
- **installer:** the colored QR code draws every cell as an upper half block in the top
  module's color on the bottom module's color, so terminals that add line spacing below the
  glyph no longer show light gaps across it (they made the code unreadable to scanners), and
  the wizard uses full cells (backgrounds only, which no line spacing breaks) when the
  terminal has the rows. Terminals that add spacing above the glyph can still show gaps in the
  half-block look; without color the code is drawn in the terminal's own colors (inverted on
  a light terminal).
- **installer:** `CI=false`, `CI=0`, `CI=no` and `CI=off` no longer count as a CI run (a browser
  is offered again).

## [0.2.3] - 2026-11-25

### Changed

- The installer still installs the self-host image 0.2.2.

### Fixed

- **installer:** slatebox 0.2.3 checks the target first and runs Slatebox with plain docker run ([257c75f6](https://github.com/Slatebox/slatebox/commit/257c75f6e218426869d8f4c9ab72640584c694fb))

## [0.2.2] - 2026-11-25

### Changed

- `slatebox status` gains the single sign-on check line ([16a9b247](https://github.com/Slatebox/slatebox/commit/16a9b2473446bf56abff956093c1905cefb3c080)).
- Installs the self-host image 0.2.2, pinned by digest ([2f939cf0](https://github.com/Slatebox/slatebox/commit/2f939cf052a5e230b48ffeade5be6ee8867bb5dd)).

### Fixed

- **sso:** SSO accounts join the setup team as members (SSO slice 1) ([e0fad6dc](https://github.com/Slatebox/slatebox/commit/e0fad6dc732a77f5f70f65c3377b17a78b46b40f))

## [0.2.1] - 2026-11-25

### Fixed

- **installer:** 0.2.1 fixes from the published-installer end-to-end run ([08dfa231](https://github.com/Slatebox/slatebox/commit/08dfa2314e2a95e686b5008e4186a85c68fac50f))

## [0.2.0] - 2026-11-25

### Changed

- Installs the self-host image 0.2.1, pinned by digest ([c9bbdbd9](https://github.com/Slatebox/slatebox/commit/c9bbdbd91d6cc94163daac3587413dfd9e4a1261), [e8ad57b2](https://github.com/Slatebox/slatebox/commit/e8ad57b2dc907df9870fbafc9c72814b6f6afd2d)).

### Added

- **cli:** one slatebox command with team addresses; slatebox-mcp keeps only its own bin ([a311547d](https://github.com/Slatebox/slatebox/commit/a311547d9c073785b8e2daa0f292af8c2fa2e33d))
- **cli:** print the one-time setup link at the end of an install; slatebox setup-link ([9acdeb23](https://github.com/Slatebox/slatebox/commit/9acdeb238a76440b688c6214a21e7a6aa70ffbfb))
- **cli:** slatebox migrate --to cloud / import --from cloud move a team either way ([3fb66f2e](https://github.com/Slatebox/slatebox/commit/3fb66f2eb7f23bc74d09d7d94f5c4ab4e3c2046a))
- **cli:** moves ask once to invite (yes at a terminal), offer to delete the archive, say "update that server" ([cffefa63](https://github.com/Slatebox/slatebox/commit/cffefa63b5e5cf01eca1ae2a458f35dd216bd39f))

### Fixed

- **cli:** ask before opening the browser for the sign-in; interactive address tests ([973c3926](https://github.com/Slatebox/slatebox/commit/973c3926decc4df75caeebbcc1cef782208dc296))
- **image:** keep cloudflared beside the other third-party programs; read /self's claim ([28f7ad5c](https://github.com/Slatebox/slatebox/commit/28f7ad5c48866c93a91c56a53ee9e44488345a1d))
- **cli:** say plainly when Cloudflare refused the tunnel; no duplicate first-account line ([d9b06171](https://github.com/Slatebox/slatebox/commit/d9b06171281efa0fdd4fa6767175aa5f7e06471d))
- **cli:** e2e- names skip the signed-out availability check ([0e61393f](https://github.com/Slatebox/slatebox/commit/0e61393f81fccffa81c6403d900881faa3e666d1))
- **cli:** no personal-token shortcut for team addresses; MCP exec hint test names the bin it ran ([1aad6f64](https://github.com/Slatebox/slatebox/commit/1aad6f640bf34a37132f7efb86808e8a9b4f7811))
- **cli:** a re-run that changes nothing still says the server waits for its first admin ([ee3d19b7](https://github.com/Slatebox/slatebox/commit/ee3d19b73520f7d6e6eb31389b81cf9da58947b3))

## [0.1.0] - 2026-11-24

First release of `npx slatebox`. Installs the self-host image 0.1.0, pinned by digest ([0e56c752](https://github.com/Slatebox/slatebox/commit/0e56c75298874996b41b6a8d6027d165e7048075)).

### Added

- **install:** npx slatebox, the guided installer, and the install_slatebox prompt ([bde42bfe](https://github.com/Slatebox/slatebox/commit/bde42bfe7d8dc69dd50d8c66500fe6be8f66b5fd))

### Fixed

- **install:** commit the settings modules; install_slatebox off until npm publish; publish needs a digest pin ([83605135](https://github.com/Slatebox/slatebox/commit/83605135c5bbe72957088fcd2038387f3aa92239))
- **install:** slatebox ai test forces the ping tool, as the image's ai check and the integration fixture do ([190ac8bd](https://github.com/Slatebox/slatebox/commit/190ac8bdc419a1917679c5d4be8fd79294055dc5))
- **create-slatebox:** exact slatebox dependency and a publish check (round-2 review nit 10) ([edc1d813](https://github.com/Slatebox/slatebox/commit/edc1d8139a7261362561129ec781292e25e5229e))

_Not tagged:_ `0.0.0-stage` (2026-11-24) only reserved the package name on npm.

[Unreleased]: https://github.com/Slatebox/slatebox/compare/slatebox%400.2.3...HEAD
[0.2.3]: https://github.com/Slatebox/slatebox/compare/slatebox%400.2.2...slatebox%400.2.3
[0.2.2]: https://github.com/Slatebox/slatebox/compare/slatebox%400.2.1...slatebox%400.2.2
[0.2.1]: https://github.com/Slatebox/slatebox/compare/slatebox%400.2.0...slatebox%400.2.1
[0.2.0]: https://github.com/Slatebox/slatebox/compare/slatebox%400.1.0...slatebox%400.2.0
[0.1.0]: https://github.com/Slatebox/slatebox/releases/tag/slatebox%400.1.0
