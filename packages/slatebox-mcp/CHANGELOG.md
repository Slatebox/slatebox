# Changelog: slatebox-mcp

All notable changes to the `slatebox-mcp` npm package (the Slatebox MCP server and its local CLI) are recorded here. Releases are tagged `slatebox-mcp@X.Y.Z` in
[Slatebox/slatebox](https://github.com/Slatebox/slatebox) and published to npm as
[`slatebox-mcp`](https://www.npmjs.com/package/slatebox-mcp).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Sections are generated from
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) that touch this package, by
[git-cliff](https://git-cliff.org) when a release is cut with `scripts/release.mjs` (see
[docs/releasing.md](../../docs/releasing.md)). Notes written by hand under [Unreleased] become that
release's highlights.

## [Unreleased]

## [0.4.1] - 2026-11-25

### Added

- **mcp:** tool and server words lead with what people ask for ([3dd8b433](https://github.com/Slatebox/slatebox/commit/3dd8b433c264202582df50ce406ca6a1bdcbb802))
- **mcp:** sharper words for mind maps, whiteboards, retros and slides ([748e1cde](https://github.com/Slatebox/slatebox/commit/748e1cde217490a27a3fba465f3497962983facd))
- **agents:** pick-rate eval of the MCP tool list ([56ba1d7c](https://github.com/Slatebox/slatebox/commit/56ba1d7c0d79dc2e501d97aa4d0763261b0eadac))
- **admin:** agent clients and share of voice on the Overview ([dd93824c](https://github.com/Slatebox/slatebox/commit/dd93824c039978cebd1ef19ed86cd63e8b89e2ec))
- **team-move:** browser sign-in for moves, no staff review with a daily limit and audit, library to the review queue, invitations that existing accounts accept ([827c40f4](https://github.com/Slatebox/slatebox/commit/827c40f437fd207a002fff39d9839485910e60b5))

### Fixed

- **mcp:** keep the exec lead and describe_instance words as they were ([86435713](https://github.com/Slatebox/slatebox/commit/86435713730f71b619104bcacd737b693fd84a0a))
- **installer:** 0.2.1 fixes from the published-installer end-to-end run ([08dfa231](https://github.com/Slatebox/slatebox/commit/08dfa2314e2a95e686b5008e4186a85c68fac50f))

## [0.4.0] - 2026-11-25

### Added

- **suggestions:** a host's gate on suggestions.decide; retext a waiting note; undo can skip items ([cb27daea](https://github.com/Slatebox/slatebox/commit/cb27daea4f7dac95fd4dce906a1616309ad73871))
- **ai-control:** keys only in the backend, named providers, one model per part ([73f3691c](https://github.com/Slatebox/slatebox/commit/73f3691c8a2f9c1fc41666d4c444c9d681477474))
- **image:** team-address tunnel (cloudflared) in the one container, 0.2.0 ([e487ed5e](https://github.com/Slatebox/slatebox/commit/e487ed5e9b055ba272d15efed01c6c304acf7e5f))
- **cli:** one slatebox command with team addresses; slatebox-mcp keeps only its own bin ([a311547d](https://github.com/Slatebox/slatebox/commit/a311547d9c073785b8e2daa0f292af8c2fa2e33d))

### Fixed

- **agents:** review fixes for agents read and write ([28bc2774](https://github.com/Slatebox/slatebox/commit/28bc27741076bbe2c01f35c059de3d76249a46e6))
- **cli:** no personal-token shortcut for team addresses; MCP exec hint test names the bin it ran ([1aad6f64](https://github.com/Slatebox/slatebox/commit/1aad6f640bf34a37132f7efb86808e8a9b4f7811))

## [0.3.5] - 2026-11-24

### Added

- **agents:** create_presentation, a first-class action for Present's planner ([57a1258b](https://github.com/Slatebox/slatebox/commit/57a1258bf92a87ba2e20536c8aeb4ae54f8125e2))
- **boards:** Move anyway on pipelines, budgets, plans and nested boards (server, exec, dialog) ([a9095d73](https://github.com/Slatebox/slatebox/commit/a9095d73e6a58d33fece0b05cefc004c22538ab3))
- **enterprise:** carve out Cloud-only enterprise/ under its own license ([3d1e76e3](https://github.com/Slatebox/slatebox/commit/3d1e76e32024acbe08d91c01a13f2ab712c8f790))
- **agents:** live suggestions on the slate, kept or discarded right on the ghost; per-agent undo, roster, choreography (S1) ([98c39d08](https://github.com/Slatebox/slatebox/commit/98c39d08af0e13b0fb57c934ff87db4150b23cc6))
- **media:** video notes — paste a YouTube, Vimeo or Loom link, see its poster, play in place ([b24b5e07](https://github.com/Slatebox/slatebox/commit/b24b5e0788f140f7f9a2bdca1519324e497f2973))
- **undo:** first-class Undo and Redo on every slate, per person, with board steps and slates.undo/redo ([d8be3401](https://github.com/Slatebox/slatebox/commit/d8be3401d2238dc9f3f3e5e697adad37ae2a34d6))
- **shapes:** the custom shape pane searches Noun Project icons first, draws one shape with AI ([c76403a2](https://github.com/Slatebox/slatebox/commit/c76403a2a2ccb4766d6263a7d89453bea17e7ee2))
- **library:** library.* actions on every surface, with one permission matrix ([c237fa4e](https://github.com/Slatebox/slatebox/commit/c237fa4ebd1ebacba15401d3e293ff7adf4d5f4a))
- **ai-control:** S0 surface catalogue and one follows table ([9bb337a8](https://github.com/Slatebox/slatebox/commit/9bb337a8df3025d0aacb3ea8f3744e7d5b453cc9))
- **ai-control:** S2 admin shell, audit trail for existing writes, reset and surface status ([a79b5de2](https://github.com/Slatebox/slatebox/commit/a79b5de259d0fbcc3481605e6de6f2552ed5baa2))
- **ai-control:** S3 providers, connections, models and prices in the DB ([42efeb30](https://github.com/Slatebox/slatebox/commit/42efeb30896f8b389eb2c00052596cbc03012a9b))
- **ai-control:** S4 bindings: chain, fallbacks, params, tools, limits, kill switches, versions ([171da785](https://github.com/Slatebox/slatebox/commit/171da785845ee80a794e0a26ef31d142b4ac7156))
- **ai-control:** S6 prompts tab: drafts, diff, test runs, eval gate, publish and rollback ([4b136ced](https://github.com/Slatebox/slatebox/commit/4b136ced202ed221f47d9c46110c0fc4d00bcb83))
- **boards:** say how a board looks in chat or exec, with no AI call ([aa2dfdc4](https://github.com/Slatebox/slatebox/commit/aa2dfdc43bfa91069b40e727961014ffe551fc3a))
- **install:** npx slatebox, the guided installer, and the install_slatebox prompt ([bde42bfe](https://github.com/Slatebox/slatebox/commit/bde42bfe7d8dc69dd50d8c66500fe6be8f66b5fd))
- **connectors:** one run per ask, one suggestion per answer, capped to what was asked; GitHub recipes ([78a8d035](https://github.com/Slatebox/slatebox/commit/78a8d035b7e8390ebf4c69dcce2077a37df39d2d))

### Removed

- remove themes (picker, library, generator slates, AI preference, theme rule in delete) ([06efd145](https://github.com/Slatebox/slatebox/commit/06efd1450f95bb3c18d13f338736815c2266e374))

### Fixed

- **decision-path:** a refused move is "Move anyway", never "your model cannot call tools" ([c4522f73](https://github.com/Slatebox/slatebox/commit/c4522f73ee53e8c6b7d8ec1e8cb356247407ac4f))
- **mcp:** exec is open world (openWorldHint true) ([87bd4ace](https://github.com/Slatebox/slatebox/commit/87bd4ace0875530a33efcff1375cd19d7d89511f))
- **integrate:** every method stays in the exec index; the shape notice stays first; video notes in the every-method test ([e77d6401](https://github.com/Slatebox/slatebox/commit/e77d6401daf0dfff93c1050fcf620b4f88ccff87))
- **media:** an agent's video note is a live suggestion; keeping it keeps the video ([bd005b05](https://github.com/Slatebox/slatebox/commit/bd005b054ec202ed6a33ef4b06bd1291bd7f3237))
- **agents:** only people keep suggestions; only an agent's owner lets it edit directly ([99f22cb9](https://github.com/Slatebox/slatebox/commit/99f22cb9434477067fc3ec5e00e759f8e740805a))
- **undo api:** an agent's slates.undo and slates.redo meet the rules its edits meet, never take back someone else's line, and a held undo names its edit ([a7f7a179](https://github.com/Slatebox/slatebox/commit/a7f7a179287d7ec468aa0e004ce5a2c8380e4b5f))
- **shapes:** icon outlines keep every point; pane trims dead picker, spends fewer searches ([9a6940b6](https://github.com/Slatebox/slatebox/commit/9a6940b6212b794231adccfbe9df870c47e560d5))
- **library:** the security review's findings, each held by a test ([0a944686](https://github.com/Slatebox/slatebox/commit/0a944686904dd74f0f8922f0559aeb2c961feb35))
- **describe:** the index gives each method the start of its summary ([eecb9738](https://github.com/Slatebox/slatebox/commit/eecb9738f09717fb0b8ebc3cd5ba93b6ce2b8a4d))
- **library on prod:** every exec method stays named in factual words; no theme fields; prod's copy wording ([1f7e6bfa](https://github.com/Slatebox/slatebox/commit/1f7e6bfa7ae7d77c72043f319ef6816966d0287e))
- **ai-control:** review fixes for S0-S4: person-only rule, kill switches, breaker, prices, UI ([19870e25](https://github.com/Slatebox/slatebox/commit/19870e25cbfe10a49d8dd4946f72842dd90251c6))
- **ai-control:** Off follows the follows chain, Changes tab in words, Off before the rate limit, console warnings ([2c9090d3](https://github.com/Slatebox/slatebox/commit/2c9090d3fda90ed1c5dc7738989ebdea41059fae))
- **library:** the version shown after approval is the stored publishedVersion ([7a4d327a](https://github.com/Slatebox/slatebox/commit/7a4d327a2f754e21b0c3485b43164fc3ced020b1))
- **ai-control:** S5/S6 review: rollback eval gate, pins, cache keys, audit, lint, served-now truth ([1af666f2](https://github.com/Slatebox/slatebox/commit/1af666f234312acd6d5623ba9f35fa95c733e380))
- **mcp:** install_slatebox links the install guide's troubleshooting section ([70e26117](https://github.com/Slatebox/slatebox/commit/70e261176440691fd0bf2b1c614c6fc97e783a73))
- **install:** commit the settings modules; install_slatebox off until npm publish; publish needs a digest pin ([83605135](https://github.com/Slatebox/slatebox/commit/83605135c5bbe72957088fcd2038387f3aa92239))

## [0.3.4] - 2026-11-24

Published to npm from a working tree whose version change was never committed, so no commit matches
its contents exactly and it is not tagged. Its changes are part of 0.3.5.

## [0.3.3] - 2026-11-24

### Changed

- Package, registry entry, READMEs and server instructions carry the new positioning ([eaa5c049](https://github.com/Slatebox/slatebox/commit/eaa5c0497e7981b4ac4b7e9af8a9cbe3b0dfed1d)).

### Fixed

- **mcp:** every tool has annotations.title, and tool descriptions say only what a tool does ([6b38bfbf](https://github.com/Slatebox/slatebox/commit/6b38bfbf4849fffd120f214f3a1551036a82c66e))

## [0.3.2] - 2026-11-23

### Added

- **exec:** presentations.get and presentations.setStyle for agents ([1e1dbba1](https://github.com/Slatebox/slatebox/commit/1e1dbba164603fdcabf8adc2e4a47dc9c9a5baa3))
- **agents:** parity with the Slates page and the comment drawer on every surface ([27bc6b19](https://github.com/Slatebox/slatebox/commit/27bc6b192ebb58ba5884538c0a814706131237a0))
- **agents:** agent teammates phase 1: agent tasks, the Slatebox agent, hand-offs between agents ([e8e00e63](https://github.com/Slatebox/slatebox/commit/e8e00e63f06f5ae98b4db5c37c9a6cd64c2576f3))
- **scopes:** slates:delete for deleting; drop the registry's cli field (owner decisions 2026-11-23) ([c429849f](https://github.com/Slatebox/slatebox/commit/c429849f496b8373ae57d1502e4db55e96049053))

### Fixed

- **workshops:** an empty note or a wordless add_card is a card named for the board ([99dd3041](https://github.com/Slatebox/slatebox/commit/99dd3041889539b3533d8156fa09638937e3fa55))
- **agents:** review findings: exact approvals, quoted notes, comment role, server @Slatebox, caps ([22ae3220](https://github.com/Slatebox/slatebox/commit/22ae3220b4783217d23eebe8962aed98ceb8ca85))

## [0.1.0] - 2026-07-16

First npm release of `slatebox-mcp`: read, add, update, delete, connect and arrange tools over the
authenticated Slatebox API (see 1.3.21 in the [app changelog](../../CHANGELOG.md)). It was published
from history that predates the public repository, so it is not tagged here.

[Unreleased]: https://github.com/Slatebox/slatebox/compare/slatebox-mcp%400.4.1...HEAD
[0.4.1]: https://github.com/Slatebox/slatebox/compare/slatebox-mcp%400.4.0...slatebox-mcp%400.4.1
[0.4.0]: https://github.com/Slatebox/slatebox/compare/slatebox-mcp%400.3.5...slatebox-mcp%400.4.0
[0.3.5]: https://github.com/Slatebox/slatebox/compare/slatebox-mcp%400.3.3...slatebox-mcp%400.3.5
[0.3.3]: https://github.com/Slatebox/slatebox/compare/slatebox-mcp%400.3.2...slatebox-mcp%400.3.3
[0.3.2]: https://github.com/Slatebox/slatebox/releases/tag/slatebox-mcp%400.3.2
