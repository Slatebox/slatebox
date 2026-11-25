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
