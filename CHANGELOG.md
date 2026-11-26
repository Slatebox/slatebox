# Changelog

All notable changes to Slatebox, the app at app.slatebox.com and the self-host image
`ghcr.io/slatebox/slatebox`, are recorded here. The npm packages keep their own changelogs:
[packages/slatebox/CHANGELOG.md](packages/slatebox/CHANGELOG.md) (the `slatebox` installer and CLI)
and [packages/slatebox-mcp/CHANGELOG.md](packages/slatebox-mcp/CHANGELOG.md) (the `slatebox-mcp`
MCP server).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Release sections are generated
from [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) by
[git-cliff](https://git-cliff.org) ([cliff.toml](cliff.toml)) when a release is cut with
`scripts/release.mjs`; notes written by hand under [Unreleased] become that release's highlights. See
[docs/releasing.md](docs/releasing.md).

About the version numbers: 1.3.21 (July 2026) and the versions before it were releases of the hosted
app. The self-host image previews 0.1.0 to 0.2.2 (November 2026) were built from the line that
followed. The [Unreleased] notes summarize everything since 1.3.21, including what those previews
shipped early. The next release is 2.0.0, which is above both lines.

## [Unreleased]

## [2.1.0] - 2026-11-26

### Added

- **style:** no data loss when a style is worn, switched or removed; Revert to original; modern Slate settings; cog by the slate name ([f4cc9254](https://github.com/Slatebox/slatebox/commit/f4cc925446d007dbaf703e778e9eb68e67500b69))
- **integrations:** Existing and Custom tabs; suggest a custom MCP server for the library ([3ad11f12](https://github.com/Slatebox/slatebox/commit/3ad11f12a139852ff8baee920cad9c8695168358))
- **selfhost:** header Upgrade on self-hosted installs: unlock enterprise here, or move the team to Slatebox Cloud ([ddb971c3](https://github.com/Slatebox/slatebox/commit/ddb971c3b3a601b26081c586ee10bd3f3647163c))
- **agents:** add an already-connected agent to a slate in one click ([3f155ccb](https://github.com/Slatebox/slatebox/commit/3f155ccb82179c7671023825d2c33c4e38af3c7a))
- **builder:** printable pages are grid sheets: drafted, started, printed and saved as a PDF ([86cc5290](https://github.com/Slatebox/slatebox/commit/86cc52905ee689a1f90f06acec414584c7dd36c1))
- **selfhost:** automatic updates from signed GitHub releases ([934281d9](https://github.com/Slatebox/slatebox/commit/934281d97af9cd2e721fe4ed23d64f65dc038d67))
- **updates:** trust the 2026-11 release key ([04a26a00](https://github.com/Slatebox/slatebox/commit/04a26a007f6f028cca31cc9df97e31cf8a403db5))

### Fixed

- **server:** stop on SIGTERM so a rollout's old pod does not linger and drop sessions ([5c6de8dc](https://github.com/Slatebox/slatebox/commit/5c6de8dc494df3b24281c9744bcfa9fd2c738468))
- **my-slates:** draw a card on the background its canvas opens on ([369b11fe](https://github.com/Slatebox/slatebox/commit/369b11fefe44e83b008e442ba102f9a0c96c906e))
- **style:** review fixes: keep lines, pictures and edited decoration; settle style words; settings Revert puts decks back ([121a3c0e](https://github.com/Slatebox/slatebox/commit/121a3c0efa6d5532b24c294f0033da2bdd3eca9c))
- **integrations:** no path secrets in the library, honest consent, Cloud cards age out ([34f67689](https://github.com/Slatebox/slatebox/commit/34f676895d310c5e7f47fe21ad32570acaf81cfa))
- **builder:** a described smart component builds a board; agent plans repair themselves and fail in plain words ([32e1c745](https://github.com/Slatebox/slatebox/commit/32e1c745ce27dede02144f95498a59a99e687ebe))
- **builder:** smart components drafted as working tools, held to a quality gate; agent wording ([d946620d](https://github.com/Slatebox/slatebox/commit/d946620db0026293d387b8872bbedad3a0e5a597))
- **selfhost:** trials need a proven public host, no grace, Cloud-decided offer; clearer Upgrade panel and header ([0c437e37](https://github.com/Slatebox/slatebox/commit/0c437e3789281900f632f90223ec65e114187ccc))
- **builder:** a usefulness judge in the live eval, a harder quality gate, no cap on the finished lane, guest starters with real domain cards ([51f38413](https://github.com/Slatebox/slatebox/commit/51f384133ec4bc743e9862d93304f444b7bf57c7))
- **builder:** starter kits match whole words, finished lanes by name and place, an independent and calibrated eval judge ([7a82b8b2](https://github.com/Slatebox/slatebox/commit/7a82b8b2dcedad07b8e6459d1707cf808b5a5546))
- **style:** Revert to original gives notes made since their own look back ([c2a545a1](https://github.com/Slatebox/slatebox/commit/c2a545a19b3c3c837b92ef44fd80871dfa6c61ab))
- **style:** two lines between the same notes keep their own look and id on Revert ([8f643056](https://github.com/Slatebox/slatebox/commit/8f6430560c6e316f2af90292c000ea5d651163d3))
- **builder:** grid sheets print their own words; honest evals; Print docked on phones, hidden in Present ([315e905e](https://github.com/Slatebox/slatebox/commit/315e905e571f6367fcd1e06312bcb68e9883eadf))
- **updates:** host updater trusts only its own feed, version and sequence; recovers cut-off updates; restores before the older version starts ([e7924769](https://github.com/Slatebox/slatebox/commit/e792476976c8b382090d6222e1273e048a4858d4))

## [2.0.0] - 2026-11-25

### Highlights

#### Added

- Six presentations built by Slatebox in the library (Launch day war room, The 41-minute checkout
  outage, Q3 investor update, Why trials stall, 2027: three bets, Your first month), one in each of
  six presentation styles. Open a copy and it is the same slate, notes, colors and connections, with
  the same presentation: Present in the copy plays it in its style. The marketing site's Make it yours
  opens these copies.

- Integrations (on Slatebox Cloud, and on self-hosted installs with an enterprise license): connect an outside agent or Google
  once on the new Integrations page (`/integrations`) and invite it onto any slate with no new sign-in,
  or let it join every slate you own. A removal from one slate is remembered; the slate's owner
  chooses who may bring outside agents. Google: Save to Google Drive, Export to Google Docs (and
  Update this Doc), Import from Google Drive as a suggestion, and Google Drive as an agent that reads
  the files you pick for a slate, all with the `drive.file` scope only. Actions `integrations.*` and
  `google.*` (Meteor method, `/api/v1`, exec; MCP tools `list_integrations`,
  `invite_integration_to_slate`, `import_google_file`). Connecting, keys, standing rules and
  disconnecting are for people in the app only, never a token. See docs/integrations.md.

- Agents create presentations: `presentations.create` (`POST /api/v1/slates/{shareId}/presentation`,
  the MCP tool `create_presentation`, `slatebox.presentations.create` in exec and so `slatebox exec`)
  plans a presentation of a slate with the Present button's planner (the AI feature `presentation`,
  counted like Present), for someone who may edit the slate. Optional style (voyage, stage, editorial, neon, sketch, blueprint,
  journey, calm), palette and brief; `mode: "preview"` plans without saving. It answers with the
  presentation id, its steps (layout, kicker, caption) and a link, `/canvas/<shareId>?present=1`,
  that opens the slate and plays it.
- Undo and Redo on every slate: a pill at the canvas's bottom-left from a tablet up and a column at the
  left on a phone, with Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y. They take back and redo the person's own
  steps only: a teammate's or an agent's later change is never undone by them, and a step someone else
  has changed since is passed over with "Someone else changed that since, so there was nothing of yours to
  take back there." A drag, resize or rotation is one step. Board changes (a card moved, moved anyway past a
  rule, a lane renamed, a card taken off, a Keep in the board's chat) are steps in the same history, made
  again on the board as it stands (what someone else changed since stays). A Keep in Ask Slatebox is drawn
  in place, without a reload, as one step; so is a Mermaid import into the open slate and an in-app AI plan.
  The board strip's one-step "Undo last change" is replaced by them.
- `slates.undo` and `slates.redo` (`POST /api/v1/slates/{shareId}/undo|redo`, `undo_my_edit`,
  `redo_my_edit`): the caller's own canvas edits (same account, same token), taken back and made again; a
  part someone else changed since stays and is listed in `left`. In exec a call is held for the person, as
  any removal is.

- Agents reach what a person does on the Slates page and in the comment drawer, with the app's own
  rules: list your slates or your team's (`slates.list`, `GET /api/v1/slates`, `list_slates`), copy a
  slate (`slates.copy`, now also `POST /api/v1/slates/{shareId}/copy`, `copy_slate`), delete your own
  slate (`slates.delete`, `delete_slate`; the owner only), and read, add, resolve
  and remove comments (`comments.*`, `/api/v1/slates/{shareId}/comments`, `list_comments`,
  `add_comment`, `resolve_comments`, `remove_comment`; only the author removes). Every surface gets them
  from the registry: OpenAPI, the exec client, the hosted and local MCP typed tools, and
  `slatebox exec`. A delete or a comment removal waits for the person to agree, as any removal does.

- A presentation's words are fitted in the faces they are drawn in (measured, once the styles'
  fonts have loaded): a title too wide for its frame gets a smaller size, and a word is never broken
  across lines. A restyle of a published presentation renders its share card again. A board kept
  during a visit presents with its lanes, live too, and a slate of many boards presents each
  board's lanes in turn.

- A presentation's silhouettes (blobs, chevrons, bubbles, pins, masks) are custom shapes from the
  shapes service (slateboxjs/shapes: checked, normalized, stored with their text box and name), the
  same as any drawn or library shape; only line art (open ribbons, hairline rings) stays a plain
  outline. A searched picture names its source in a small credit line on the steps it shows
  (its license asks for attribution); generated pictures and the style's art need none.

- Presentations look like their slate and their style, not a template. Captions, kickers and the
  closing line are written from the slate's own words in each style's voice (a keynote is terse, a
  magazine reads in chapters, a road trip counts stops); a style switch gives the same steps that
  style's own beats; a quote is always a note's own words. Every styled deck a signed-in person
  makes asks for pictures (licensed for reuse, copied into Slatebox's storage, else generated, else
  the style's art), counted up front, reused across refines and capped per day; the style sheet
  shows each picture, why it is there and where it came from, with Another and Drawn art. While
  presenting, a styled deck is full bleed with one small control pill (publishing, versions and
  settings in More), screen readers hear each step and the notes it shows, a phone frames every
  note a step lights, and labels stay inside their shapes. Publishing builds the published slate
  copy on the server and checks the deck's direction; the share card renders its title in the
  style's kind of type with its cover.

- Three more smart components in Ask Slatebox's library, each with a looping picture, "Say it like this" phrases and
  "What can this do?" on the board: Impact × effort (a 2 by 2; "Do now holds 4", "Move Exports to Later", "Rename
  the axes Reach and Confidence", "Is Exports harder than Search?"), Reorg & hiring sandbox (an org chart; "No manager
  over 3 reports", "Engineers don’t manage", "Every pod needs a designer, just warn me", a pasted name/role/manager
  list) and Goals & owners (key results owned by teams; "When I move a key result, bring its initiatives along",
  "Stop me when a key result is owned outside its objective’s team", "Give X to Platform"). Rule changes are a diff,
  then Keep; the server makes every kept change again through the engine's edits. Under "Stop me when a manager has
  no designer" a new manager is hired before their designer (a pasted pod lands), and only a change that leaves a
  team short is stopped.
- A note's content never refuses its trade to a card. Words are kept as typed, markup included,
  and shown as text everywhere; a picture held in the page is stored with the slate's pictures and
  the card keeps its address; an older note whose id a card cannot have keeps that id when it comes
  back. A full board says it is at its size limit of 24 cards. A teammate's open screen gets a
  note's lines even when the page that took the card off closed before telling the room.
- Any note becomes a workshop card. An empty note dropped on a lane is an empty card (and an empty
  note again off the lanes); a note with long words, a picture or a link becomes a card and gets them
  back as a note. "Add a card to Next" in the workshop conversation adds an empty card. A trade is
  refused only by the board's own rules (a full lane, a board that keeps its own cards) or someone
  else's change.
- Workshop cards keep their lines. A note joined to other notes by lines becomes a card when it is
  dropped on a lane, and keeps its lines; a card dropped on the canvas becomes a note with them.
  Lines are drawn from a card to a note, from a note to a card, and between cards, with the same
  plugs as any note. The server saves a trade's lines with the board and the drawing in one write,
  so a teammate sees them live and a reload keeps them. Agents connect and disconnect cards with
  `connect_workshop_card` and `disconnect_workshop_card`, and the workshop read lists its `lines`;
  the workshop conversation takes "Connect CARD to CARD" and "Disconnect CARD from CARD".
- A card's lines keep their pinned ends: a line end pinned to a spot on a note's edge goes with the
  card and back, and moving a card's line end onto another note or card keeps the line. A card's
  line has no free end: let go on empty canvas, the end goes back and the canvas says why.

#### Changed

- The slate is the presentation. A slate wears a style (`options.style`, one property that replaces the
  old themes): "Wear this style" in Present's style picker, or in Slate settings → Slate style, puts the
  style's background, its notes' outlines, fills and fonts, its lines and its art (title cards, kickers,
  numbers, quotes, captions, bolts, bursts, ribbons, stars, grids) on the canvas as real notes you can
  edit, as one step that Undo takes back. Present is a camera over the slate as saved: it frames, flies,
  dims and reveals notes, and draws nothing of its own (no painted background, caption overlay, step
  dots, phone layout or web-font link). The six presentations Slatebox built are published wearing
  their styles (a new version of each library item), so Make it yours opens a canvas that looks like
  the site's poster. The styles' faces (Anton, Space Grotesk, Fraunces, Inter, IBM Plex Mono, Abril
  Fatface, PT Sans) are served by the app itself under the OFL.
- A presentation saved before styles were worn plays the slate as it is drawn; choose a style in
  Present to wear it.
- **Google Docs export now goes through the Google integration.** The old export, which kept a
  Google token in a browser cookie, is retired: connect Google once on the Integrations page and Slatebox keeps the sign-in encrypted on the server. PNG, SVG and Mermaid
  downloads stay as they are.
- Removing an invited agent from a slate no longer signs you out of its server: the sign-in lives as
  long as the integration, and disconnecting the integration revokes it.
- API and MCP: a workshop read's `livePresentation` is now
  `{ sessionId, step, revision, expiresAt }`, where `step` is an index into the
  presenter's deck (-1 is the whole slate); it no longer has `laneId`. The read
  no longer has `publication`: a workshop slate is published like any slate.
  `set_presentation_order` is unchanged.

#### Removed

- Themes: the Themes panel, the theme library (`/themes`), theme generator slates, the "Create with
  theme?" AI preference, theme approval and the `themeId` creation link parameter. A slate that was
  built on a theme can be deleted like any other. Slates and people that still carry theme fields
  open and draw as before, with their own colors; restyle a slate through chat or a presentation
  style.
- Themes: the Themes panel, the theme library (`/themes`), theme generator slates, the "Create with
  theme?" AI preference, theme approval and the `themeId` creation link parameter. A slate that was
  built on a theme can be deleted like any other. Slates and people that still carry theme fields
  open and draw as before, with their own colors; restyle a slate through chat or a presentation
  style.

#### Fixed

- A copy of a library presentation keeps its look: Present plays the copied deck instead of planning
  the slate again in another style.
- A slate made from a brief of steps is named after its first note, not after a whole row of steps.
- A copy of a library presentation keeps its look: Present plays the copied deck instead of planning
  the slate again in another style.
- A slate made from a brief of steps is named after its first note, not after a whole row of steps.
- A run another page or an agent saved, drawn on this canvas, became this person's undo step (their undo
  took the agent's work away for everyone).

### Added

- **present:** the slate is the presentation: a slate wears a style, Present only plays it ([c30139b4](https://github.com/Slatebox/slatebox/commit/c30139b432834f898f808a9bc28108acd430b3dd))
- **first-run:** the first slate's plans, builder and firstSlate.create ([4540c8cb](https://github.com/Slatebox/slatebox/commit/4540c8cbad0fa864c8ee2c272a31821d1bf3457a))
- **first-run:** Create slate asks what the first slate should do ([9ca5c8b2](https://github.com/Slatebox/slatebox/commit/9ca5c8b20bd9ec0642a061a2e56679a0303a7285))
- **first-run:** Ask Slatebox opens on the board's three starters; Make it yours; Share invites ([b57c2988](https://github.com/Slatebox/slatebox/commit/b57c298892e2a7fb9cd37d54e7f0b441b19e5978))

### Changed

- **slates:** one createWorkshopSlate helper for every made-once private slate ([acc9a78a](https://github.com/Slatebox/slatebox/commit/acc9a78ac600cc0251a25a2dce66d2f6e3dd8ce0))

### Fixed

- **present:** a copy plays its worn deck; the Slate style panel wears on the live engine ([56d02cac](https://github.com/Slatebox/slatebox/commit/56d02cac373af6ceb0913d41f494ed2d5f1d96eb))
- **style:** canvas and player agree, captions sit like the posters, agents and old decks wear styles natively ([ac0168a3](https://github.com/Slatebox/slatebox/commit/ac0168a395757aef09ef0d4de3d67d35a4fee8d3))
- **style:** a worn slate's plain notes are stored as tall as the engine draws their words ([8420c960](https://github.com/Slatebox/slatebox/commit/8420c960fd7d29daf03ff6abb5316cde45e46578))
- **style:** an uppercase caption is stored as tall as the engine wraps it (capitals run wide) ([3c8ad418](https://github.com/Slatebox/slatebox/commit/3c8ad418b05d592a23a8ce006eadc79251cf4ba6))
- **first-run:** useful boards from their words, no slate from Back, live Make it yours ([d1650336](https://github.com/Slatebox/slatebox/commit/d1650336e5d8c12949a8e7703b9756bbccef81a2))

## [0.2.2] - 2026-11-25

Self-host image preview `ghcr.io/slatebox/slatebox:0.2.2` (index `sha256:8a64b09e8e6d53a0fb2b76b60048474eba52a010ddd7f7b834ea898a003e4ec5`), built from [f3ef2946](https://github.com/Slatebox/slatebox/commit/f3ef2946b63651b7a695662aae6cbc474c9a1b91).

### Added

- **help:** Help and support menu replaces the support mailto ([f3ef2946](https://github.com/Slatebox/slatebox/commit/f3ef2946b63651b7a695662aae6cbc474c9a1b91))

### Fixed

- **installer:** 0.2.1 fixes from the published-installer end-to-end run ([08dfa231](https://github.com/Slatebox/slatebox/commit/08dfa2314e2a95e686b5008e4186a85c68fac50f))
- **team-addresses:** mark tunnels and DNS comments per instance so prod and test never reap each other ([d9c22e56](https://github.com/Slatebox/slatebox/commit/d9c22e568779942a56e7458d76c34f4fefb2ba7d))
- **sso:** SSO accounts join the setup team as members (SSO slice 1) ([e0fad6dc](https://github.com/Slatebox/slatebox/commit/e0fad6dc732a77f5f70f65c3377b17a78b46b40f))

## [0.2.1] - 2026-11-25

Self-host image preview `ghcr.io/slatebox/slatebox:0.2.1` (index `sha256:208d4bfc460ed2feedc435ccc22231177929e8885ab5f856933c67e6831ca5b5`), built from [96c0552c](https://github.com/Slatebox/slatebox/commit/96c0552cfd8dd19a57ed59f0dcf372ba4e86bead).

### Added

- **mcp:** tool and server words lead with what people ask for ([3dd8b433](https://github.com/Slatebox/slatebox/commit/3dd8b433c264202582df50ce406ca6a1bdcbb802))
- **mcp:** sharper words for mind maps, whiteboards, retros and slides ([748e1cde](https://github.com/Slatebox/slatebox/commit/748e1cde217490a27a3fba465f3497962983facd))
- **agents:** pick-rate eval of the MCP tool list ([56ba1d7c](https://github.com/Slatebox/slatebox/commit/56ba1d7c0d79dc2e501d97aa4d0763261b0eadac))
- **admin:** agent clients and share of voice on the Overview ([dd93824c](https://github.com/Slatebox/slatebox/commit/dd93824c039978cebd1ef19ed86cd63e8b89e2ec))
- **mcp:** serve the server card at /.well-known/mcp/server-card.json ([4fd120e1](https://github.com/Slatebox/slatebox/commit/4fd120e195ed130b3826079e7f01d018364f56a0))
- **team-export:** a team's owner moves it between servers themselves (teamMove.*) ([e5ccf451](https://github.com/Slatebox/slatebox/commit/e5ccf4510c64adc05ba1caee0b8fdc03b6b35db9))
- **team-move:** browser sign-in for moves, no staff review with a daily limit and audit, library to the review queue, invitations that existing accounts accept ([827c40f4](https://github.com/Slatebox/slatebox/commit/827c40f437fd207a002fff39d9839485910e60b5))

### Fixed

- **mcp:** keep the exec lead and describe_instance words as they were ([86435713](https://github.com/Slatebox/slatebox/commit/86435713730f71b619104bcacd737b693fd84a0a))
- **image:** accept SLATEBOX_LICENSE and SLATEBOX_LICENSE_FILE for an on-prem license ([71d4870d](https://github.com/Slatebox/slatebox/commit/71d4870dbbc9781ab06837194fb86b87b7e769d5))
- **team-export:** a moved slate hashes the same: options.shareId is identity ([ff054fe3](https://github.com/Slatebox/slatebox/commit/ff054fe32180caf382d5295f04d35e57804c18be))
- **team-move:** after joining a moved team, Open Slatebox reloads so the session shows the new team ([96c0552c](https://github.com/Slatebox/slatebox/commit/96c0552cfd8dd19a57ed59f0dcf372ba4e86bead))

## [0.2.0] - 2026-11-25

Self-host image preview `ghcr.io/slatebox/slatebox:0.2.0` (index `sha256:78a96e572b9a714b199af36de4850ff6b88ee733da483954e685cc199da3ef8c`), built from [e4e53f89](https://github.com/Slatebox/slatebox/commit/e4e53f89f2f19204fa154f5c02ede4a1062899de).

### Added

- **integrations:** connect once, invite anywhere; Google as a native integration ([dae536ac](https://github.com/Slatebox/slatebox/commit/dae536ac96beaca6ff956b9be642fdf837822ae6))
- **suggestions:** a host's gate on suggestions.decide; retext a waiting note; undo can skip items ([cb27daea](https://github.com/Slatebox/slatebox/commit/cb27daea4f7dac95fd4dce906a1616309ad73871))
- **agents:** agents read and write: changes elsewhere land as action cards a person approves ([509d6d00](https://github.com/Slatebox/slatebox/commit/509d6d00d6211b5837093f77529276cd573aab10))
- **brand-kit:** one style for every slate; no per-kind presets ([12ce5bbf](https://github.com/Slatebox/slatebox/commit/12ce5bbf5f6a626a5c1ca829c508ade854c6bb66))
- **admin:** server admins need no team; Admin link in the account menu and profile; /admin Overview dashboard ([0fd21834](https://github.com/Slatebox/slatebox/commit/0fd2183448bfb3399238d3e97f2e4ef9e9c508b0))
- **agents:** sixteen more agents in the gallery, with chips and search in the invite dialog ([c4fd022b](https://github.com/Slatebox/slatebox/commit/c4fd022be935fa0fad6811bf8afa5fea797a2561))
- **ai-control:** keys only in the backend, named providers, one model per part ([73f3691c](https://github.com/Slatebox/slatebox/commit/73f3691c8a2f9c1fc41666d4c444c9d681477474))
- **self-host:** the image makes its key-encryption key on first boot and keeps it ([ce5131b9](https://github.com/Slatebox/slatebox/commit/ce5131b9f21cbc697f9d23b034c8bc36c4e93ff7))
- **library:** the six Present-page decks are real library presentations ([11a0999a](https://github.com/Slatebox/slatebox/commit/11a0999aa7c416a1d6df4f1376181863e79e47b2))
- **team-addresses:** Cloud claim service for <name>.slatebox.team + device-code sign-in ([5ec21489](https://github.com/Slatebox/slatebox/commit/5ec21489911c146f5243a9e7949dd3a873d8658d))
- **image:** team-address tunnel (cloudflared) in the one container, 0.2.0 ([e487ed5e](https://github.com/Slatebox/slatebox/commit/e487ed5e9b055ba272d15efed01c6c304acf7e5f))
- **cli:** one slatebox command with team addresses; slatebox-mcp keeps only its own bin ([a311547d](https://github.com/Slatebox/slatebox/commit/a311547d9c073785b8e2daa0f292af8c2fa2e33d))
- **self-host:** nobody signs up until the first admin uses the one-time setup link ([cb85e520](https://github.com/Slatebox/slatebox/commit/cb85e520a81acfb2ed50e284e226a0e1ea31a6fd))
- **image:** slatebox setup-link makes the one-time link for the first admin ([b2f147b3](https://github.com/Slatebox/slatebox/commit/b2f147b3a4eed5f60905fc0e6795ad1c6c5d11d5))
- **cli:** print the one-time setup link at the end of an install; slatebox setup-link ([9acdeb23](https://github.com/Slatebox/slatebox/commit/9acdeb238a76440b688c6214a21e7a6aa70ffbfb))

### Fixed

- **integrations:** review fixes for Google and connect-once ([365d7ccb](https://github.com/Slatebox/slatebox/commit/365d7ccbd3be5af4320fe9aef888b59bf84d2cee))
- **emails:** review follow-ups, proven through a local Meteor and SMTP catcher ([8e9b6583](https://github.com/Slatebox/slatebox/commit/8e9b6583af660043110b2d77700dc8bdaa3180b4))
- **team:** server guards who may remove or re-role a member; invite reviews before sending ([df1b4019](https://github.com/Slatebox/slatebox/commit/df1b40199aef4adc7b10204cdef30d2cef30acf6))
- **team:** wait for the account before choosing the create page (no "Create your team" flash) ([4a9db848](https://github.com/Slatebox/slatebox/commit/4a9db84825fb06c4710894320e9014a963b601a4))
- **team-settings:** review fixes — delete dialog names only what applies ([9a47b25d](https://github.com/Slatebox/slatebox/commit/9a47b25d6c5491388b1c9a3971cf3b7daa86d491))
- **team-settings:** no "Your 0 slates" line in the delete dialog ([d13124c1](https://github.com/Slatebox/slatebox/commit/d13124c1920d4cce70794f7a3f38b24b990ad917))
- **agents:** review fixes for agents read and write ([28bc2774](https://github.com/Slatebox/slatebox/commit/28bc27741076bbe2c01f35c059de3d76249a46e6))
- **agents:** action cards say Approve and Decline on the slate, and the chat says so ([ced1a9ee](https://github.com/Slatebox/slatebox/commit/ced1a9ee745d883e9cc3c562ec308ae58950a5b7))
- **brand-kit:** preview notes never shrink at any allowed font or size; lines chain; title fits its frame ([d9f8d6c3](https://github.com/Slatebox/slatebox/commit/d9f8d6c331ab844ea895be6b99078459f841a2a9))
- **brand-kit:** a person with no permissions sees the read-only note; font select and color names read plainly ([2e0f0a20](https://github.com/Slatebox/slatebox/commit/2e0f0a20d437cbdcfaee73c6937e184a941a4cac))
- **brand-kit:** the preview draws real new notes and the engine autofits them; size-aware AA; guided colors; phone preview folded ([3a64352b](https://github.com/Slatebox/slatebox/commit/3a64352ba1c24f83fb94633d908361f91b5b833c))
- **integrations:** a connected card says Connected; no featured tint; one-line tool summary; let older connections make changes ([df580795](https://github.com/Slatebox/slatebox/commit/df580795988de81781d2e2530f7ff1d2eb22af80))
- **auth:** Sign out always ends on the sign-in page, never a new guest ([8b7ff164](https://github.com/Slatebox/slatebox/commit/8b7ff1641d19330a82dff812f0f779ea72389345))
- **integrations:** Disconnect always forgets the agent; failures say what did not happen ([1c84d894](https://github.com/Slatebox/slatebox/commit/1c84d8944c964fa651d5da69910fd32284a56e3a))
- **integrations:** Let it make changes too says what did not happen on a server failure ([a37bdbb2](https://github.com/Slatebox/slatebox/commit/a37bdbb20d39eb8027aece8535048650ff14a1a7))
- **gallery:** Slack, Asana and HubSpot show only once their vendor app is set up ([b858b4bb](https://github.com/Slatebox/slatebox/commit/b858b4bb809ad184ef153e6a130af001df52572d))
- **ai-control:** a key's last use is a request that is sent, not an availability check ([55d199c3](https://github.com/Slatebox/slatebox/commit/55d199c32956921ee0435ca57801672fa7428cbf))
- **ai-control:** no request fails mid-switch, revoked keys stay dead, self-host upgrades keep their model ([35fe3c95](https://github.com/Slatebox/slatebox/commit/35fe3c959a2c7d420f187b02873356f00107ba41))
- **ai-control:** Add a provider marks providers already added; Bindings pickers fit a phone ([2a18f0a8](https://github.com/Slatebox/slatebox/commit/2a18f0a88ee31ff2aff03bfde4f0beb1ba4d9466))
- **ai-control:** outside agents ask for their model through AI control ([f0804100](https://github.com/Slatebox/slatebox/commit/f0804100e0c50d6a0a4f80068dd9c8191c2c856f))
- **library:** leaving a library page gives the tab its title back ([9ecb5d4a](https://github.com/Slatebox/slatebox/commit/9ecb5d4ad5b64ac4ff51712fd04eaf36b687191c))
- **library:** the six showcase decks draw no line through a note ([09b1ff3d](https://github.com/Slatebox/slatebox/commit/09b1ff3df6670c40302e13c3ffab96be7693fc15))
- **team-addresses:** a released takedown stays held; rename-back keeps its record; replay token limit; blocklist remove ([8c910e51](https://github.com/Slatebox/slatebox/commit/8c910e516f1b564c3c4417b518484e1a6ea80954))
- **team-addresses:** claim attempts share the daily check limit; unsuspend a claim that was never set up ([11dae173](https://github.com/Slatebox/slatebox/commit/11dae17317390889f52e692d08e80cf7d6d92bc3))
- **image:** keep cloudflared beside the other third-party programs; read /self's claim ([28f7ad5c](https://github.com/Slatebox/slatebox/commit/28f7ad5c48866c93a91c56a53ee9e44488345a1d))
- **cli:** no personal-token shortcut for team addresses; MCP exec hint test names the bin it ran ([1aad6f64](https://github.com/Slatebox/slatebox/commit/1aad6f640bf34a37132f7efb86808e8a9b4f7811))
- **e2e:** the team-address run prints no secret and works from an agent shell ([5faf28d5](https://github.com/Slatebox/slatebox/commit/5faf28d5d6ea60c9993cd98a68597e660b388ed5))
- **team-addresses:** closed until the settings say otherwise: missing or paused settings answer 503 and nothing calls Cloudflare ([3bcc549c](https://github.com/Slatebox/slatebox/commit/3bcc549c1a7cef5b3adcbd4a0b196aa4dc2f7bf1))

## [0.1.0] - 2026-11-24

Self-host image preview `ghcr.io/slatebox/slatebox:0.1.0` (index `sha256:94f761bd8153ca9b9d9ef1ecd4af9faddf318427f7495c3af8492bb2a1d22d4f`), built from [a695484d](https://github.com/Slatebox/slatebox/commit/a695484da7f1ff59b78f01f4f56d4b0271db48a6).

### Added

- **presentations:** styled decks on the live canvas, Prezi camera, AI art direction ([3ca1af65](https://github.com/Slatebox/slatebox/commit/3ca1af6536689781999534a97a768873be3acf6b))
- **exec:** presentations.get and presentations.setStyle for agents ([1e1dbba1](https://github.com/Slatebox/slatebox/commit/1e1dbba164603fdcabf8adc2e4a47dc9c9a5baa3))
- **boards:** boards look designed in the app — drafts drawn as boards, Rules chips, focus dims, column copy ([c9809429](https://github.com/Slatebox/slatebox/commit/c9809429dcb42b81363f813ccee45fa020cbb255))
- **agents:** parity with the Slates page and the comment drawer on every surface ([27bc6b19](https://github.com/Slatebox/slatebox/commit/27bc6b192ebb58ba5884538c0a814706131237a0))
- **agents:** agent teammates phase 1: agent tasks, the Slatebox agent, hand-offs between agents ([e8e00e63](https://github.com/Slatebox/slatebox/commit/e8e00e63f06f5ae98b4db5c37c9a6cd64c2576f3))
- **scopes:** slates:delete for deleting; drop the registry's cli field (owner decisions 2026-11-23) ([c429849f](https://github.com/Slatebox/slatebox/commit/c429849f496b8373ae57d1502e4db55e96049053))
- **agents:** create_presentation, a first-class action for Present's planner ([57a1258b](https://github.com/Slatebox/slatebox/commit/57a1258bf92a87ba2e20536c8aeb4ae54f8125e2))
- **boards:** Move anyway on pipelines, budgets, plans and nested boards (server, exec, dialog) ([a9095d73](https://github.com/Slatebox/slatebox/commit/a9095d73e6a58d33fece0b05cefc004c22538ab3))
- **enterprise:** carve out Cloud-only enterprise/ under its own license ([3d1e76e3](https://github.com/Slatebox/slatebox/commit/3d1e76e32024acbe08d91c01a13f2ab712c8f790))
- **agents:** live suggestions on the slate, kept or discarded right on the ghost; per-agent undo, roster, choreography (S1) ([98c39d08](https://github.com/Slatebox/slatebox/commit/98c39d08af0e13b0fb57c934ff87db4150b23cc6))
- **agents:** invite outside agents (open MCP servers) onto a slate, Cloud only (S2a) ([b758db06](https://github.com/Slatebox/slatebox/commit/b758db062bd28d8a5a033bac5bbfb14352ecb295))
- **agents:** invite outside agents that need sign-in (OAuth popup or pasted key), Cloud only (S2b) ([d912b581](https://github.com/Slatebox/slatebox/commit/d912b58169215373cd2b9ef273b403ec2043fa37))
- **media:** video notes — paste a YouTube, Vimeo or Loom link, see its poster, play in place ([b24b5e07](https://github.com/Slatebox/slatebox/commit/b24b5e0788f140f7f9a2bdca1519324e497f2973))
- **enterprise:** invited agents are on wherever enterprise code runs; self-host carries it locked until a license key unlocks it ([3d190af5](https://github.com/Slatebox/slatebox/commit/3d190af5279f61b26b998bb92ae10e92f19905f5))
- **agents:** ask an invited agent by @name in Ask Slatebox; it answers as itself ([197ea8c7](https://github.com/Slatebox/slatebox/commit/197ea8c7382f504361a016574f06e7738849d1e8))
- **undo:** first-class Undo and Redo on every slate, per person, with board steps and slates.undo/redo ([d8be3401](https://github.com/Slatebox/slatebox/commit/d8be3401d2238dc9f3f3e5e697adad37ae2a34d6))
- **agents, undo:** a person's Keep of an agent's suggestion is one step of their own undo history ([d0c982c4](https://github.com/Slatebox/slatebox/commit/d0c982c44fc1ab1b13ed4947a2460179ec3e7538))
- **shapes:** the custom shape pane searches Noun Project icons first, draws one shape with AI ([c76403a2](https://github.com/Slatebox/slatebox/commit/c76403a2a2ccb4766d6263a7d89453bea17e7ee2))
- **library:** the shared library's model and core ([ddee2928](https://github.com/Slatebox/slatebox/commit/ddee2928441bb4d54d145aa9a0f8c5199af04a76))
- **ai:** a use key for library review and refinement, following chat ([ad9e7e88](https://github.com/Slatebox/slatebox/commit/ad9e7e888371f019e9b5494ca1225c1626110535))
- **library:** library.* actions on every surface, with one permission matrix ([c237fa4e](https://github.com/Slatebox/slatebox/commit/c237fa4ebd1ebacba15401d3e293ff7adf4d5f4a))
- **library:** routes, stub pages, the canvas slot and the client wrappers ([476348bf](https://github.com/Slatebox/slatebox/commit/476348bff12a9df56abe84ae0141341892788132))
- **library:** the review queue's server side: refine AI, author notices, the thread, the move ([50e8485e](https://github.com/Slatebox/slatebox/commit/50e8485eacbca1bf8a5f7f04fd9b2f85f2df6a04))
- **library:** review queue, review panel, My library, and Publish to the library ([0211a2b7](https://github.com/Slatebox/slatebox/commit/0211a2b7031adfdc885b170602a7b0a9bc04935f))
- **play:** a rule control's change is saved on every board that takes rules ([0421f893](https://github.com/Slatebox/slatebox/commit/0421f8932e347cbbee2b772c9298f66d65b1b528))
- **canvas:** boards show their rule controls and save them as a drag is saved ([b6972c6a](https://github.com/Slatebox/slatebox/commit/b6972c6aa24f8d7263646615ef3243b757cf0cf8))
- **library:** build a smart component on a new slate ([ffae6a02](https://github.com/Slatebox/slatebox/commit/ffae6a0228fddef6181f75dd72849250f0916c7d))
- **library:** Add to this slate lists Yours and the community's components ([fc87f52b](https://github.com/Slatebox/slatebox/commit/fc87f52b771503617003ef43c9834f49e0903ece))
- **library:** share-preview tags and canonical for /library/<slug> ([0f12e5a5](https://github.com/Slatebox/slatebox/commit/0f12e5a57194d07b4c90ecd6b5adda6c41d35909))
- **library:** the public gallery, /library and /library/<slug> ([27989e6f](https://github.com/Slatebox/slatebox/commit/27989e6f49f8ddd43894a040451fc5204110dc89))
- **ai-control:** S0 surface catalog and one follows table ([9bb337a8](https://github.com/Slatebox/slatebox/commit/9bb337a8df3025d0aacb3ea8f3744e7d5b453cc9))
- **ai-control:** S1 resolver, snapshot, store and audit collection (read path) ([a8e4a13e](https://github.com/Slatebox/slatebox/commit/a8e4a13ed3767867839f45fd4a650ec752015806))
- **ai-control:** S2 admin shell, audit trail for existing writes, reset and surface status ([a79b5de2](https://github.com/Slatebox/slatebox/commit/a79b5de259d0fbcc3481605e6de6f2552ed5baa2))
- **ai-control:** S3 providers, connections, models and prices in the DB ([42efeb30](https://github.com/Slatebox/slatebox/commit/42efeb30896f8b389eb2c00052596cbc03012a9b))
- **ai-control:** S4 bindings: chain, fallbacks, params, tools, limits, kill switches, versions ([171da785](https://github.com/Slatebox/slatebox/commit/171da785845ee80a794e0a26ef31d142b4ac7156))
- **library:** submit asks "How should we credit you?" when the account has no name ([90d3aad0](https://github.com/Slatebox/slatebox/commit/90d3aad0576becf8f932b168aa985ed125e380ef))
- **ai-control:** S5 prompt registry; shapes, boards, exec chat, agent, presentation and library refine prompts move to it ([1678383a](https://github.com/Slatebox/slatebox/commit/1678383a4ec234662b82edae2d2f8f227e6b15b2))
- **ai-control:** S6 prompts tab: drafts, diff, test runs, eval gate, publish and rollback ([4b136ced](https://github.com/Slatebox/slatebox/commit/4b136ced202ed221f47d9c46110c0fc4d00bcb83))
- **boards:** say how a board looks in chat or exec, with no AI call ([aa2dfdc4](https://github.com/Slatebox/slatebox/commit/aa2dfdc43bfa91069b40e727961014ffe551fc3a))
- **install:** npx slatebox, the guided installer, and the install_slatebox prompt ([bde42bfe](https://github.com/Slatebox/slatebox/commit/bde42bfe7d8dc69dd50d8c66500fe6be8f66b5fd))
- **connectors:** one run per ask, one suggestion per answer, capped to what was asked; GitHub recipes ([78a8d035](https://github.com/Slatebox/slatebox/commit/78a8d035b7e8390ebf4c69dcce2077a37df39d2d))
- **ai-control:** the layout turn makes only what was asked, once (new code default, its own golden) ([a8e64896](https://github.com/Slatebox/slatebox/commit/a8e6489633807bdfa9a6017fb5e1f747797cf7b5))
- **agents:** lines kept with both ends, specific failure words, Import from Excalidraw on the server ([38be79ba](https://github.com/Slatebox/slatebox/commit/38be79ba922448f47519d20046aec7c9d7e85db2))
- **agents:** chat with invited agents only in Ask Slatebox; the chip shows a summary; the gallery knows who is here ([4c9f1fdf](https://github.com/Slatebox/slatebox/commit/4c9f1fdf0c8d168a2f3112e22f173a5b7a5fdbaf))
- **ai-control:** Agent gallery in /admin/ai: cards on/off, order, words and recipes, audited, people only ([b937d65e](https://github.com/Slatebox/slatebox/commit/b937d65e4a350e4c4ae374af86173a6b1f4bcd9b))

### Changed

- **client:** heavy tools and pages a first visit never opens load on first use (eager bundle -515 KB gzip) ([f54dabe4](https://github.com/Slatebox/slatebox/commit/f54dabe44acb272bb0e49af02825d872ba5ee8cb))
- **huddle:** Daily loads with this browser's first huddle, never with the page; presence works without it ([20a88809](https://github.com/Slatebox/slatebox/commit/20a8880963a78abcb29ffacc22dcc51e32ffa23e))
- **no dead ends:** a designed 404, a real sign-up, empty lists with a next step, a slim phone cookie strip, Mermaid for guests ([4b3958f4](https://github.com/Slatebox/slatebox/commit/4b3958f4450cf3b9ea1a005120f1790a0a39661f))
- **no dead ends:** review fixes: one-row phone header, a sign-up's own email line, no empty flash, a reader's Mermaid note ([82ffdcd7](https://github.com/Slatebox/slatebox/commit/82ffdcd78626eb5163ea5cf37f9151af988fd40a))
- **dark mode:** the canvas is dark in dark mode, its ink reads, and a chosen background is kept ([92bdc09b](https://github.com/Slatebox/slatebox/commit/92bdc09b0a6d91d82b533de8e898ed80721e89e2))
- **dark mode:** review fixes: copies of the drawing keep the slate's own colors, the minimap's dark frame shows, a plan's bars are dark ([6a43bbeb](https://github.com/Slatebox/slatebox/commit/6a43bbeb4138dea68fb394cd56aeb1d37d82a586))
- **first minute:** a new slate opens on a welcome, the library finds maps and plans, and Ask Slatebox reads as a conversation ([efb747d3](https://github.com/Slatebox/slatebox/commit/efb747d37beddeca39e49f365696d8f29e38bb00))
- **first minute:** review fixes: the welcome sits under what floats over the canvas, and its note is a slate's usual first note ([c2cd514a](https://github.com/Slatebox/slatebox/commit/c2cd514a7ec274a964e89db4e8fcba0fedb76768))
- **first minute:** review fixes: one new note everywhere, the library's words, the phone's conversation, one spacing scale ([92a476ac](https://github.com/Slatebox/slatebox/commit/92a476ac3b43b9045b0ea141fd1a0265ac1b513e))
- **first minute:** a new note's size is a pixel number, so its words wrap and the note grows ([e2b3d69a](https://github.com/Slatebox/slatebox/commit/e2b3d69abcaaa5770bda4e00312af476ece63059))
- **first minute:** Ask Slatebox's first turn follows the slate as it is now ([4ecfc24e](https://github.com/Slatebox/slatebox/commit/4ecfc24e8f0e6199eebba6fcabc3724bb7b27389))
- **agents:** invited agents suggest through the app's live suggestions (S2a adapter replaced by S1) ([34d1d30b](https://github.com/Slatebox/slatebox/commit/34d1d30b351acf8fa0d2602208d03a1d0327ea03))
- **slates.copy:** a copy is an ordinary slate; templates' copy switches go ([50280c2e](https://github.com/Slatebox/slatebox/commit/50280c2e242206c50174609f2a2b45f7bfcf2c83))
- **Breaking:** community slates, the template gallery and featuring are gone (the library replaced them) ([33f3ad7a](https://github.com/Slatebox/slatebox/commit/33f3ad7ac671253654e8595efe7c4d95f4384889))
- **renderer:** draw boards through the engine's slateboxjs/boards/still ([bc18f0eb](https://github.com/Slatebox/slatebox/commit/bc18f0eb2dbaa9d4b14c175a84b584247a5506f5))
- **connectors:** the invited agents' plan and layout prompts move into the prompt registry, byte for byte ([542bd4b8](https://github.com/Slatebox/slatebox/commit/542bd4b8e89d7c5acbc717184e92b8c7202ed893))

### Removed

- remove themes (picker, library, generator slates, AI preference, theme rule in delete) ([06efd145](https://github.com/Slatebox/slatebox/commit/06efd1450f95bb3c18d13f338736815c2266e374))
- **ui:** remove the legacy "Welcome To Slatebox!" dialog and its code ([57de1093](https://github.com/Slatebox/slatebox/commit/57de1093f053eb60aacbdbff7af6246a4919c53c))

### Fixed

- **presentations:** captions from the slate in each style's voice, beats that differ by style, honest quotes, every lit note in frame ([68f692b7](https://github.com/Slatebox/slatebox/commit/68f692b7472826d9a35fb0f78a86f165309001d0))
- **presentations:** pictures for every styled deck, counted up front and kept; publish builds its own slate copy; a share card that renders ([9bf24765](https://github.com/Slatebox/slatebox/commit/9bf247650aa93aa41ad0a107f989f32351fd812f))
- **presenter:** a styled deck is full bleed while authoring too; screen readers hear each step; fewer repaints ([91e3b0a8](https://github.com/Slatebox/slatebox/commit/91e3b0a8d23b90638a408c10772d049502391b38))
- **presenter:** the floating bar has no width cap (the player area stays uncapped); the stage exposes its engine to checks; changelog ([7a13240c](https://github.com/Slatebox/slatebox/commit/7a13240cce008362a42d4b9d71c1c5e17fb6efb9))
- **presentations:** Calm's kicker says 'Part 2 of 6' (never the counter's '2 / 6'); wider font estimates keep headlines in frame; the phone pill hides the planner chip and keeps tooltips off touch ([507b5520](https://github.com/Slatebox/slatebox/commit/507b5520557aa5878c6e580acb4d86d5eaa20d72))
- **presenter:** fit each note's words again once the styles' fonts have loaded, so a wide face never runs past its shape ([82431151](https://github.com/Slatebox/slatebox/commit/82431151fbf295e74ff133eff156e1eb3b811113))
- **presentations:** on a phone a dive's picture is the step's backdrop (its notes stay in frame, the picture stays big); publish falls back to the editor's copy, cut down, when the saved slate lags an edit ([78000158](https://github.com/Slatebox/slatebox/commit/78000158558bb15baaac434a20c6bc40cdd0f068))
- **presenter:** a slate of many boards presents every board's lanes, board by board ([9815ec79](https://github.com/Slatebox/slatebox/commit/9815ec798765d445ad339e837dc1aad4b27183b3))
- **presenter:** a board kept during this visit presents (and presents live) with its lanes ([0c508ba1](https://github.com/Slatebox/slatebox/commit/0c508ba16a0ff14109e756d5d7ef38e6bfbb896f))
- **presenter:** words are fitted in the faces they are drawn in; a word is never broken across lines ([823584fa](https://github.com/Slatebox/slatebox/commit/823584fa30a364292231a7cfcdbb844d49ad91ba))
- **presentations:** a restyle of a published version renders its share card again ([6ccf6bf6](https://github.com/Slatebox/slatebox/commit/6ccf6bf609c0492b7e390f10abeb1e50564828a9))
- **presenter:** the deck never scrolls up and leaves the window half blank ([5a1e6cc2](https://github.com/Slatebox/slatebox/commit/5a1e6cc2cce6690f011722450c007c0232e4d497))
- **canvas:** an agent's saved edit reaches every open canvas, a visitor with no account too ([ec5158b3](https://github.com/Slatebox/slatebox/commit/ec5158b37ae69ffba6c8326281a2bacb3f97d8be))
- **canvas:** no canvas saves an agent's run again; the refusal names the current revision ([e5cf2f46](https://github.com/Slatebox/slatebox/commit/e5cf2f4670de4ead80455db97614296a3e781dd0))
- **collaboration:** a visitor with no account saves their edits when the relay's keys are not set up ([f7488ee6](https://github.com/Slatebox/slatebox/commit/f7488ee6aa937c8753bd404075f1794d88e126e8))
- **boards:** a draft's tag clear of the phone's header; no gear across the focus frame (polish review) ([4ab78ffe](https://github.com/Slatebox/slatebox/commit/4ab78ffece2e3d04bcf8d7118e2c12a11eb2f722))
- **boards:** the board chrome reads on the dark canvas; a second board's columns and bars are dark too ([c5481a71](https://github.com/Slatebox/slatebox/commit/c5481a7113b4bc6fb8608c5e324b932d4c5ef28c))
- **boards:** the zoom pill stays beside the add button from a tablet up, never stretched across the canvas ([cf1be76c](https://github.com/Slatebox/slatebox/commit/cf1be76c1ea345bacb50921cded439638b25e0da))
- **boards:** one renderer for every board on every surface — slate cards draw the real board ([b935e0d0](https://github.com/Slatebox/slatebox/commit/b935e0d03b95bc3e78ccfd352a9daf0b19e1a39c))
- **workshops:** an empty note or a wordless add_card is a card named for the board ([99dd3041](https://github.com/Slatebox/slatebox/commit/99dd3041889539b3533d8156fa09638937e3fa55))
- **new slate:** every /new/<kind> board route loads its rulebook too ([2f2d691a](https://github.com/Slatebox/slatebox/commit/2f2d691af8e16eec732a696d525332bafe0e76d6))
- **ask slatebox:** the button works as soon as it is in sight; a request sent while the chat gets ready is sent ([bc5b8987](https://github.com/Slatebox/slatebox/commit/bc5b8987b2a6ac6307f0f4e1584388110cde9d03))
- **huddle:** the strip of people over the canvas leaves its empty room to the canvas ([cd7d3833](https://github.com/Slatebox/slatebox/commit/cd7d38338a0b868d4dde1ba07a77787d23ddd599))
- **privacy:** keep less: idempotency and replay records 24 hours, run receipts 90 days ([01372ac4](https://github.com/Slatebox/slatebox/commit/01372ac43c8aa27bed8706b2bfee710571de8cd5))
- **oauth:** advertise every scope a tool needs; consent explains each; OAuth step-up says reconnect ([86f354c9](https://github.com/Slatebox/slatebox/commit/86f354c9c566bb8f2e2f18affab97fdbd6705deb))
- **agents:** review findings: exact approvals, quoted notes, comment role, server @Slatebox, caps ([22ae3220](https://github.com/Slatebox/slatebox/commit/22ae3220b4783217d23eebe8962aed98ceb8ca85))
- **plans:** a note let go on a launch or hiring plan's days becomes a task on that day ([8619237c](https://github.com/Slatebox/slatebox/commit/8619237c2e22742ea561edfb7b097dcae34a305d))
- **my slates:** a slate's thumbnail is one picture named after the slate ([540fb413](https://github.com/Slatebox/slatebox/commit/540fb41309cb0e586435230f7d0ec120048f4207))
- **slates:** a board kept on an untitled slate names the slate ([a95ffef7](https://github.com/Slatebox/slatebox/commit/a95ffef733719581904e976ed725fe37b17aa43c))
- **plans:** a launch plan asked for with a date launches on that date ([2d3a7de6](https://github.com/Slatebox/slatebox/commit/2d3a7de6084f36a00306524be3e0e51fb97de0e3))
- **share:** a public slate's link shows a picture of its board ([7be38173](https://github.com/Slatebox/slatebox/commit/7be381732f97766e07019e50037aaec76eb92687))
- **mcp:** every tool has annotations.title, and tool descriptions say only what a tool does ([6b38bfbf](https://github.com/Slatebox/slatebox/commit/6b38bfbf4849fffd120f214f3a1551036a82c66e))
- **save:** a canvas save from a page that is behind changes only what its person changed ([f9a4a3b0](https://github.com/Slatebox/slatebox/commit/f9a4a3b07d6386e2cb76a604b7eae847cdf20701))
- **decision-path:** a refused move is "Move anyway", never "your model cannot call tools" ([c4522f73](https://github.com/Slatebox/slatebox/commit/c4522f73ee53e8c6b7d8ec1e8cb356247407ac4f))
- **mcp:** exec is open world (openWorldHint true) ([87bd4ace](https://github.com/Slatebox/slatebox/commit/87bd4ace0875530a33efcff1375cd19d7d89511f))
- **cookie-notice:** Got it dismisses on a phone for good, and the notice never covers the bar ([7fec1395](https://github.com/Slatebox/slatebox/commit/7fec139574e3da619c84bfd4d75d0a8c62221faf))
- **boards:** move anyway after review: exec holds every move made anyway, the page can't forge marks, a changed board asks again ([d8105c12](https://github.com/Slatebox/slatebox/commit/d8105c120aeadbce12e9194d9c5dd13050bbf4a7))
- **plus-menu:** AA contrast for the + dock, the phone add sheet and the zoom pill ([81402a39](https://github.com/Slatebox/slatebox/commit/81402a3919d8f5b5085e64429ee07fd5837a723d))
- **media:** read a poster by its bytes when the picture server labels it octet-stream ([dee222c4](https://github.com/Slatebox/slatebox/commit/dee222c41992d49e79464cd8a52e7517b8a38120))
- **integrate:** every method stays in the exec index; the shape notice stays first; video notes in the every-method test ([e77d6401](https://github.com/Slatebox/slatebox/commit/e77d6401daf0dfff93c1050fcf620b4f88ccff87))
- **media:** an agent's video note is a live suggestion; keeping it keeps the video ([bd005b05](https://github.com/Slatebox/slatebox/commit/bd005b054ec202ed6a33ef4b06bd1291bd7f3237))
- **connectors:** only a sign-in's owner can start it; provider sign-ins go to that provider's servers only ([548a94e9](https://github.com/Slatebox/slatebox/commit/548a94e9015680d692f10455bafd5388a50ae478))
- **agents:** only people keep suggestions; only an agent's owner lets it edit directly ([99f22cb9](https://github.com/Slatebox/slatebox/commit/99f22cb9434477067fc3ec5e00e759f8e740805a))
- **agents:** invited agents work where people look, with one chip each ([5e9c3f93](https://github.com/Slatebox/slatebox/commit/5e9c3f93b80fcef5a1065aa54bcf658b13214522))
- **media, agents:** posters must be Slatebox's own; pasted videos land on free space; plain gallery copy; new settings in the example ([08ed7bc1](https://github.com/Slatebox/slatebox/commit/08ed7bc1fb18e22181e80bba481a5c40110cbe4b))
- **agents:** one pointer per agent on screen; Cancel on Remove gives focus back ([2b1727a2](https://github.com/Slatebox/slatebox/commit/2b1727a2eec14874287e46d90c9eb0b28da696eb))
- **enterprise:** Cloud unlocks only with its own signed key; a key that ends mid-run locks the publication, the sweep and the browser too ([cfd0b1eb](https://github.com/Slatebox/slatebox/commit/cfd0b1ebc259591970966a3f360dec4a8cf95322))
- **agents:** @name reaches your own agent first; one agent per name on a slate ([fe919efa](https://github.com/Slatebox/slatebox/commit/fe919efad67bb93d450ea1984675ff30b553d331))
- **undo:** a board change is a step from the moment it is made; a drawing Keep in place keeps the page current ([b0090eea](https://github.com/Slatebox/slatebox/commit/b0090eea593408b4d630b3ee6830e65e7702c89b))
- **undo, move-anyway:** every move made anyway is one undo step of its own; the words name the canvas Undo (Ctrl/Cmd+Z) ([33216922](https://github.com/Slatebox/slatebox/commit/33216922de202c7a2e9d083c9d0068325030e5a2))
- **undo, move-anyway:** a board step ends where the server stored it, so undo after redo of a move made anyway works ([7f531f22](https://github.com/Slatebox/slatebox/commit/7f531f2262cfe52b0f93111691f4b6a81aea0ff7))
- **undo api:** an agent's slates.undo and slates.redo meet the rules its edits meet, never take back someone else's line, and a held undo names its edit ([a7f7a179](https://github.com/Slatebox/slatebox/commit/a7f7a179287d7ec468aa0e004ce5a2c8380e4b5f))
- **board undo:** after an undo that left a teammate's change alone, Redo leaves it alone too; a move made anyway is named as the dialog asked it ([0f274d36](https://github.com/Slatebox/slatebox/commit/0f274d3642b284b9e75ca71d49e64c14d82329a5))
- **canvas:** Agent tasks starts right of the canvas Undo and Redo, so it no longer covers them on a desktop ([741fa234](https://github.com/Slatebox/slatebox/commit/741fa234c73a755a51e6f33526f83b02658d11fb))
- **sticky:** + menu Sticky Note is the default rounded note, Lemon, no border, Sticky note effect; tile redrawn ([8ab01f54](https://github.com/Slatebox/slatebox/commit/8ab01f54e214c930fd19025944a539306c095a4a))
- **sticky:** review fixes - sticky height follows the copied font size; the tile fills its box with a folded corner ([146b3a69](https://github.com/Slatebox/slatebox/commit/146b3a69a86a1b8603d8222889c91e73fc506a49))
- **shapes:** icon outlines keep every point; pane trims dead picker, spends fewer searches ([9a6940b6](https://github.com/Slatebox/slatebox/commit/9a6940b6212b794231adccfbe9df870c47e560d5))
- **quick-add:** store a new shape's outline from its own origin, not in canvas coordinates ([8a1abd50](https://github.com/Slatebox/slatebox/commit/8a1abd50bebef0b50fecbca1b7ece6445fe61794))
- **quick-add, ai:** a note quick-added while zoomed lands in the middle of the view; AI notes store outlines from their origin ([4ddb96d3](https://github.com/Slatebox/slatebox/commit/4ddb96d39aa1c9920f83e46381a93f71b7a39cd3))
- **shapes:** custom shape tiles draw only the outline, no dash across the middle ([0374ede7](https://github.com/Slatebox/slatebox/commit/0374ede7eaf841c708178ec24ee601330fe015b8))
- **library:** a refine the AI could not answer says so, in plain words ([4f37d7c7](https://github.com/Slatebox/slatebox/commit/4f37d7c7f4db5a3fea3e2272b16578f8d7326233))
- **library:** the decision dialog keeps its words and its version while it closes ([cde3cb17](https://github.com/Slatebox/slatebox/commit/cde3cb17728b647812f5bf1c2fee59da68ee26a7))
- **renderer:** hand the engine's still renderer its modules (createStillRenderer) ([baf7b8b5](https://github.com/Slatebox/slatebox/commit/baf7b8b507fb2ce38e27e851c52de8a437b198aa))
- **library:** the template the app seeds itself is credited to Slatebox, not "A Slatebox user" ([51c02aa7](https://github.com/Slatebox/slatebox/commit/51c02aa72b89ba9bac7d8544a94f3c1b34fa6eab))
- **library:** the build bar's Save and Submit keep their words when the Ask Slatebox panel is open ([02bdf212](https://github.com/Slatebox/slatebox/commit/02bdf2129b13009696937767f888d313ceedbfe5))
- **library:** the security review's findings, each held by a test ([0a944686](https://github.com/Slatebox/slatebox/commit/0a944686904dd74f0f8922f0559aeb2c961feb35))
- **library:** what is taken out leaves shared caches within a minute ([b7cce0e0](https://github.com/Slatebox/slatebox/commit/b7cce0e0aa463718b4c86582d3e2f56d8324fb6e))
- **library:** the intent and UX review's findings in the app ([965883f4](https://github.com/Slatebox/slatebox/commit/965883f46ddf15ec8ef753bf851dcc33e279270d))
- **library:** the save sheet opens below the two-line build bar; the specs state the new behavior ([b46473d6](https://github.com/Slatebox/slatebox/commit/b46473d6d0766707066e8790108e60f336e9b9ee))
- **describe:** the index gives each method the start of its summary ([eecb9738](https://github.com/Slatebox/slatebox/commit/eecb9738f09717fb0b8ebc3cd5ba93b6ce2b8a4d))
- **library, undo:** a rule control's change is one step of the canvas's Undo ([f42369a8](https://github.com/Slatebox/slatebox/commit/f42369a8dfdb9d1bc8431cdbde752ca0686e9de7))
- **library, agents:** an agent's library.fork onto a slate and a kept refinement meet the agents' pause ([692557e4](https://github.com/Slatebox/slatebox/commit/692557e4ad1c098569c82e61bd04be3c499ba380))
- **library on prod:** every exec method stays named in factual words; no theme fields; prod's copy wording ([1f7e6bfa](https://github.com/Slatebox/slatebox/commit/1f7e6bfa7ae7d77c72043f319ef6816966d0287e))
- **ai-control:** review fixes for S0-S4: person-only rule, kill switches, breaker, prices, UI ([19870e25](https://github.com/Slatebox/slatebox/commit/19870e25cbfe10a49d8dd4946f72842dd90251c6))
- **ai-control:** Off follows the follows chain, Changes tab in words, Off before the rate limit, console warnings ([2c9090d3](https://github.com/Slatebox/slatebox/commit/2c9090d3fda90ed1c5dc7738989ebdea41059fae))
- **conversation:** a board described with no AI gets the real refusal, never a note holding the prompt ([81db7fec](https://github.com/Slatebox/slatebox/commit/81db7fec78204a523cb14459cf835f4b468f7f33))
- **library:** the self-review alert says it in plain words, not the API's selfReview ([1ddb76ab](https://github.com/Slatebox/slatebox/commit/1ddb76ab48145f2d5128357f20ac8a4ed953a63a))
- **library:** the version shown after approval is the stored publishedVersion ([7a4d327a](https://github.com/Slatebox/slatebox/commit/7a4d327a2f754e21b0c3485b43164fc3ced020b1))
- **library:** "Say it like this" never renames a column to a name another column has ([4156906d](https://github.com/Slatebox/slatebox/commit/4156906d4ab46efa5830a6b3300be65428d19b1a))
- **ai-control:** S5/S6 review: rollback eval gate, pins, cache keys, audit, lint, served-now truth ([1af666f2](https://github.com/Slatebox/slatebox/commit/1af666f234312acd6d5623ba9f35fa95c733e380))
- **ai-control:** Changes names a failed test run and a prompt's first draft; values table scrolls at 390 ([471d65ce](https://github.com/Slatebox/slatebox/commit/471d65ce17761eaaa5966f8ab572f7545844b71a))
- **library:** the build bar lives in the canvas header, never over the canvas ([58b84a50](https://github.com/Slatebox/slatebox/commit/58b84a50c569a52950b20ede509a82f7da6f03da))
- **library:** review panel docks beside the canvas; build bar reads in full at 1440, never folds on a desktop ([f0632c45](https://github.com/Slatebox/slatebox/commit/f0632c4565725394bcad24719f1d1ebd20f0941e))
- **library:** the build bar measures the header and gives way in a fixed order; a width x name sweep proves it ([a4023bb8](https://github.com/Slatebox/slatebox/commit/a4023bb853421970846de811f89640dea70e6964))
- **boards:** look sentences leave the wording to the agent, ask about one column, clear colors, and say a look the board has ([4333985b](https://github.com/Slatebox/slatebox/commit/4333985b71e13ce94913801e0b4079884b1bbf73))
- **chat:** on a phone the newest turn's own buttons are in sight; 'make it pop' with a column selected still offers looks ([c3fa1c30](https://github.com/Slatebox/slatebox/commit/c3fa1c30bc04870f1ab008f61687c9c59fe5b952))
- **sso:** keep prod's Suspense and /oauth/consent route beside the SSO gate and /sso/done ([83837cb9](https://github.com/Slatebox/slatebox/commit/83837cb94e3a045000b2a5c559718e3b6ed3fc08))
- **sso:** SSO only closes the embed page; prod has no /api/public-presentations ([d5b649f9](https://github.com/Slatebox/slatebox/commit/d5b649f9d41ebabf4c5667f5c0552fde0002d9ea))
- **self-host:** commit the image's settings module; the build refuses ignored files; README says the image is being published ([231bdee2](https://github.com/Slatebox/slatebox/commit/231bdee29f9abfd4956cf270dbdc61369cccb726))
- **mcp:** install_slatebox links the install guide's troubleshooting section ([70e26117](https://github.com/Slatebox/slatebox/commit/70e261176440691fd0bf2b1c614c6fc97e783a73))
- **install:** commit the settings modules; install_slatebox off until npm publish; publish needs a digest pin ([83605135](https://github.com/Slatebox/slatebox/commit/83605135c5bbe72957088fcd2038387f3aa92239))
- **suggestions:** Keep and Discard at the same moment never undo each other; a line whose end is gone is refused ([ffa41020](https://github.com/Slatebox/slatebox/commit/ffa410209e5c8a6c241788315d5b90e1c959d8f1))
- **connectors:** one ask is one answer; beside earlier answers; counts not replies in history; re-invite a paused agent ([11bd79f0](https://github.com/Slatebox/slatebox/commit/11bd79f06ea3f90df4058da45e753988e932b2bf))
- **agents:** the gallery waits for the live cards; Ask Slatebox keys each ask, cancels cleanly, keeps Slatebox's own starts with Slatebox ([5f8fd041](https://github.com/Slatebox/slatebox/commit/5f8fd041c45149701617e9e207608894957cfeda))
- **agents:** the same ask while its answer waits is said once in Ask Slatebox ([19dc1706](https://github.com/Slatebox/slatebox/commit/19dc1706cffd0fd1bcb65352fc7688cf88eb9589))
- **agents:** load the suggestions' drawing (slateboxjs/suggestions) only when a suggestion waits ([177d57e9](https://github.com/Slatebox/slatebox/commit/177d57e929a7a295b890e0baa8be011b64d20c42))
- **agents:** a pointer whose agent's suggestion waits says "Waiting for you", never "Done" ([a695484d](https://github.com/Slatebox/slatebox/commit/a695484da7f1ff59b78f01f4f56d4b0271db48a6))

### Security

- **security:** actions that reach outside addresses (discovering, signing in to, inviting and asking outside agents, video lookups) are rate-limited per account whoever calls them, a signed-in page included; the MCP 401 challenge asks to read and edit only ([91725513](https://github.com/Slatebox/slatebox/commit/917255132bc3a9f50c40ac4436184f5c63bde86e))

## [1.3.21] - 2026-07-16

### Added

- Added a validated, idempotent slate-operation contract shared by AI chat and
  authenticated HTTP clients, with personal read/write API tokens and audit
  records available from the new Developer profile tab.
- Added the `slatebox-mcp` package with read, add, update, delete, connect, and
  arrange tools over the authenticated Slatebox API.

### Changed

- Routed every existing-slate chat message through a bounded DeepInfra Qwen
  edit classifier before the legacy content generator, preserving unrelated
  nodes and styling for direct manipulation requests.
- Promoted DeepInfra Qwen as the presentation planner after live evaluation cut
  the representative plan from 43 seconds to 8, with DeepSeek Terminus as the
  all-DeepInfra fallback.

### Fixed

- Prevented simple node-edit prompts from becoming new prompt nodes or changing
  the canvas theme, and added visible progress plus verified terminal chat
  responses after mutations finish.
- Applied authenticated external operations to active collaboration sessions
  while persisting the same materialized, idempotent plan server-side.
- Kept directly connected presentation steps in the transition frame so their
  relationship line remains visible, and anchored narrative bars edge to edge.

## [1.3.20] - 2026-07-16

### Fixed

- Expanded full-screen presentations across the complete viewport instead of
  constraining the stage to Material UI's desktop container width.
- Kept SlateboxJS v3 relationship lines and arrow markers visible during
  presentation pan and zoom, while avoiding compounded opacity on node
  descendants and shared connector groups.

## [1.3.19] - 2026-07-15

### Fixed

- Attached orphan top-level AI output to the real prompt node for structured
  graph layouts while preserving intentional standalone nodes in freeform
  diagram recreation.

## [1.3.18] - 2026-07-15

### Fixed

- Consumed anonymous onboarding prompts as one-shot URL inputs before starting
  welcome generation, preventing hard reloads from charging for and appending
  duplicate AI content.

## [1.3.17] - 2026-07-15

### Fixed

- Upgraded to `slateboxjs@3.0.3` so compatibility node wrappers rebind to
  replacement v2 nodes after `loadJSON`, preserving generated root
  relationships across persistence and reload.

## [1.3.16] - 2026-07-15

### Fixed

- Persisted AI graph layout moves through the SlateboxJS v3 collaboration
  contract and automatically fit the completed graph into view.
- Restored generated parent-child and decorative-node relationships without
  relying on removed v1 node-add callbacks.

## [1.3.15] - 2026-07-15

### Fixed

- Restored deterministic server-calculated graph layout for AI-generated
  slates on SlateboxJS v3, with response validation and local overlap removal
  as a bounded fallback.

## [1.3.14] - 2026-07-15

### Fixed

- Mapped all generated `main` parent aliases to the slate's real center-node ID
  before graph layout, preventing expert-generated mind maps from stacking as
  disconnected nodes.

## [1.3.13] - 2026-07-15

### Changed

- Routed the default expert-collaborator mind-map generator through DeepInfra
  DeepSeek V3.1 Terminus with Qwen3-235B Instruct as its bounded fallback.
- Stored provider-normalized assistant tool calls and tool results so DeepInfra
  generation conversations retain usable follow-up history.

### Fixed

- Parsed generation responses from the provider-neutral tool-call contract and
  added bounded validation for malformed `respond` tools, nodes, and ids.

## [1.3.12] - 2026-07-15

### Changed

- Routed welcome chat through DeepInfra Qwen3-235B Instruct with DeepSeek V3.1
  Terminus as an all-DeepInfra fallback.
- Forced the `setIntention` tool only for explicit `!!` requests and added a
  bounded semantic retry for undersized implementation briefs.

### Fixed

- Corrected the welcome tool JSON schemas for array items, object properties,
  and required fields so provider tool contracts are valid.

## [1.3.11] - 2026-07-15

### Fixed

- Accepted provider-normalized plain-text replies for welcome chat while
  retaining strict JSON enforcement for structured presentation, layout, and
  slate-generation requests.
- Prevented valid DeepInfra follow-up replies after welcome tool calls from
  entering the invalid-JSON retry loop and timing out.

## [1.3.10] - 2026-07-15

### Changed

- Promoted welcome chat to DeepInfra DeepSeek V3.2 after three consecutive
  Slatebox-specific routing, tool-shape, instruction-length, and latency gate
  passes; Anthropic remains the bounded fallback.
- Kept automatic layout on Anthropic because both DeepSeek V3 and V3.2 still
  produced collisions in the live layout gate.

### Fixed

- Applied the configured welcome-chat fallback to initial, continuing, and
  post-template provider requests.

## [1.3.9] - 2026-07-15

### Fixed

- Restored active SlateboxJS v3 node groups and their visible descendants to
  full opacity during presentation playback and viewpoint previews.

## [1.3.8] - 2026-07-15

### Fixed

- Preserved the absolute coordinate origin from SlateboxJS v3 fit-to-content
  SVG exports so presentation canvases render their nodes instead of a blank
  viewport.
- Kept the generated presentation name in the client after DeepInfra replaces
  the immediate local sequence.

## [1.3.7] - 2026-07-15

### Added

- Added a provider-neutral AI request contract with normalized tool calls,
  token usage, bounded request timeouts, and privacy-conscious provider
  telemetry.
- Added live DeepInfra quality gates for presentation planning and automatic
  layout generation so feature migrations can be based on Slatebox-specific
  results.
- Added literal-safe deployment rendering coverage for both test and production
  manifests.

### Changed

- Centralized per-feature AI provider selection. Presentations use DeepInfra
  with bounded Anthropic fallback. Welcome chat and automatic layout remain on
  Anthropic, with DeepInfra welcome fallback available, until a DeepInfra model
  passes their Slatebox-specific latency and collision-free layout gates.

## [1.3.6] - 2026-07-14

### Changed

- Moved automatic presentation planning from Anthropic to DeepInfra's
  OpenAI-compatible tool-calling API, using DeepSeek V3 by default.
- Added development support for an env-style `settings.local.json` containing
  `API_KEY_DEEP_INFRA`, while deployed environments use Meteor settings.

## [1.3.5] - 2026-07-14

### Fixed

- Limited presentation background cleanup to direct SVG background elements so
  nested node rectangles cannot abort automatic presentation rendering.

## [1.3.4] - 2026-07-14

### Fixed

- Made the automatic presentation sequence interactive immediately while AI
  planning runs in the background, with a bounded provider timeout so a missing
  or invalid provider key cannot leave presentation controls on "Updating."

## [1.3.3] - 2026-07-14

### Fixed

- Adapted presentation SVG export and layout extraction to the SlateboxJS v3
  engine so automatic presentations render instead of hanging on update.
- Made the start and end arrowhead controls independent, with each button
  reflecting and changing only its own endpoint.
- Added Miro-style custom-shape resizing through `slateboxjs@3.0.2`: drag to
  stretch freely, or hold Shift to preserve proportions.

## [1.3.2] - 2026-07-14

### Changed

- Simplified relationship properties into clearer path, endpoint, stroke, and
  arrowhead controls with icon-based endpoint locking and tooltips.

### Fixed

- Restored text and shape animations through `slateboxjs@3.0.1`.
- Kept presentation mode usable with an automatic local sequence when AI
  presentation planning is unavailable.
- Corrected source arrowheads so both ends have a clean point at the node edge.

## [1.3.1] - 2026-07-14

### Changed

- Reworked anonymous-account claiming so guests can keep using Slatebox without
  registering, while offering a clear email-and-password path to save their
  work across devices.

### Fixed

- Prevented generated guest credentials from appearing in registration forms
  while anonymous-user state is still loading.

## [1.3.0] - 2026-07-14

### Added

- Added two-client collaboration coverage, production-data fixtures, health
  probes, and a registry-backed production-candidate gate.

### Changed

- Ported the canonical application to Meteor 3.5 and the immutable
  `slateboxjs@3.0.0` package.
- Reworked canvas interactions, grouping, presentation, persistence, themes,
  primitive paths, and undo/redo around the SlateboxJS v3 engine.
- Updated the production runtime to Node 24.15.0 and hardened its native and
  generated server dependency boundary.

## [1.2.6] - 2025-05-23

### Fixed

- Adjusted slate background color in present dialogue to fill the entire screen
- Renamed bg color atom with word `Atom` so it is more explicit

## [1.2.5] - 2025-05-20

### Changed

- tweaks to support look & feel for light/dark mode (especially for things like boxShadow / borderColor on initial pages, etc).
- updated chips be contained in onboarding rather than outlined.

## [1.2.4] - 2025-05-20

### Changed

- Refactored `web/app/client/main.jsx` to resolve an invalid hook call error by introducing an `AppWrapper` component to manage global state and routing.
- Updated `PresentSlateDialogue.jsx` to use the `slateBackgroundColor` Jotai atom for its background style, replacing direct DOM access.

## [1.2.3] - 2025-05-20

### Changed

- removed the sb-bg-dark default

- Improved responsive design and mobile usability for the `GetStarted` and `Login` pages.
  - Ensured content is centered and uses available space effectively on smaller screens.
  - Adjusted layout of onboarding choices in `GetStarted` to prevent overflow and improve readability on mobile devices.

### Fixed

- Corrected the summary sentence display in the `GetStarted` onboarding flow to prevent a hanging period on mobile views.

## [1.2.1] - 2025-05-20

### Fixed

- always default to dark mode on getstarted and login

## [1.2] - 2025-05-19

### Added

- `react-transition-group` to project dependencies to support animations in the Get Started flow.
- User profile information (`usageContext`, `schoolRole`, `userRole`) gathered during the "Get Started" questionnaire is now saved to `Meteor.user().profile` when a new slate is created.
- Created a reusable `AnimatedLogo.jsx` component from the animated logo in `GetStarted.jsx`.

### Changed

- Improved performance of color updates in Line Properties by debouncing the `onChange` handler for the `HexColor` component.
- Refined color update propagation from `HexColor` in `LineProperties` by removing redundant debounce, relying on `HexColor`'s internal debounce.
- Restructured the "Get Started" page into a multi-step questionnaire to gather user context (usage purpose, role) before slate creation.
- Refined "Get Started" questionnaire: removed explicit step numbering, enabled auto-advance on selection, added back navigation, and implemented an editable summary view before enabling the main creation input. Removed "Referral Source" step.
- Implemented slide animations between steps in the "Get Started" questionnaire using `react-transition-group`.
- Transformed the summary view in the "Get Started" questionnaire into a single, flowing sentence with inline clickable chips for editing selections.
- Adjusted summary sentence wording for professions to read "in a [PROFESSION] role" and improved spacing of inline chips.
- Corrected slide animation directions in the "Get Started" questionnaire: advancing steps now have new content enter from the right, and regressing steps have new content enter from the left.
- Updated school role selection chip labels from "As a Teacher"/"As a Student" to "Teacher"/"Student" in the "Get Started" questionnaire.
- Refined summary sentence construction in "Get Started" questionnaire, particularly for the student path, to read "...as a [Student Type] [Student]."
- Changed the question for teacher type selection from "What type of educator are you?" to "Where do you teach?".
- Updated labels for specific educator types in the "Get Started" questionnaire (e.g., "Elementary or secondary school", "Specialty Course or MasterClass").
- Adjusted styling of the summary view in "Get Started" questionnaire to remove box shadow and conditionally render the main input field only when the summary is shown, positioning it closely below.
- Updated routing to render `GetStarted.jsx` directly from `App.jsx` for the `/getStarted` route, bypassing `Main.jsx` and its `AppBar` for this specific page.
- Refactored the `/login` route to be a standalone page. This is achieved by adding specific logic in `App.jsx` to render the `Login` component directly, bypassing `Main.jsx` and its `AppBar`, similar to how `/getStarted` is handled.
- Updated `GetStarted.jsx` to use the new `AnimatedLogo.jsx` component.
- Refactored `Login.jsx`:
  - Page content is now centered, similar to `GetStarted.jsx`.
  - The `AnimatedLogo.jsx` component is now displayed at the top of the Login page.
  - The "Start now. No Registration required." button now navigates to the `/getStarted` page instead of creating an anonymous user.
- Updated `Login.jsx` page design:
  - Applied the same dynamic background pattern as the `GetStarted.jsx` page.
  - Replaced the lock icon and "Sign in" text with a new title "Login to slatebox", styled consistently with the `GetStarted.jsx` welcome message.
- Refactored application routing to consolidate route definitions and ensure a single Jotai provider instance. Top-level routes (`/present`, `/start`, `/login`) are now handled in `main.jsx` to provide a lightweight experience, bypassing full app context (Daily.co, sidebars, etc.). The main application routes remain in `SBRoutes.jsx`, loaded via `<App />` which initializes the full application context.

### Fixed

- Resolved client-side routing errors between standalone pages (e.g., /login, /getStarted) by refactoring `App.jsx` to use a single top-level router.
- Defined the missing `examplePromptsToDisplay` variable in `GetStarted.jsx` to correctly show example prompts.

## [1.1.6] - 2025-05-10

### Fixed

- Fixing use theme, using correct sb logomark in published presentations, some process cleanup

## [1.1.5] - 2025-05-10

### Fixed

- fixed issue w/ drawer staying open when users are logged out via Register component (when user already exists).

### Changed

- some more style fixes, specifically to components within NodeDrawer.
- some updates to make yellow more readable in light mode.

## [1.1.4] - 2025-05-09

### Fixed

- fixed appBar issues after logout.

### Changed

- updated styles of Present section to match new theme.

## [1.1.3] - 2025-05-05

- Fix for presentation buttons in the UI (set to #000 or the brand kit control color)

## [1.1.2] - 2025-05-03

### Added

- Ability to delete individual Slate Presets (except the 'Default Preset') via a trash icon in the Brand Kit > Slate Presets dropdown.

### Changed

- Replaced preset deletion mechanism: Instead of delete icons per preset, a 'Clear Preset Configuration' (X) icon now appears next to the _selected_ preset in the Brand Kit dropdown if it has saved settings. Clicking it removes the saved configuration for that preset.

### Fixed

## [1.1.1] - 2025-05-02

### Fixed

- Issue creating stripe billing session

## [1.1] - 2025-04-30

### Added

- **Documentation Process & Structure:**
  - Created `docs/CONTRIBUTING_DOCS.md` defining guidelines for AI-assisted documentation generation.
  - Established documentation directory structure (`docs/features/`, `docs/flows/`, etc.).
  - Created main `docs/README.md` as the documentation entry point.
  - Relocated AI interaction flow document to `docs/flows/ai-slate-generation.md`.
  - Implemented navigation convention with backlinks in documentation and diagram files.
  - Created Cursor rules (`.cursor/rules/*.mdc`) to enforce documentation guidelines.
  - Updated Mermaid diagram (`docs/diagrams/AI_process_flow-mermaid.md`) based on detailed code analysis.

### Changed

- Refined `docs/README.md` for clarity and conciseness.
- Updated `docs/CONTRIBUTING_DOCS.md` with guidelines for README conciseness and diagram linking/embedding.
- Improved readability of selected tab text in light mode across the application via theme update.
- Changed "Brand Kit" menu icon from `BrushIcon` to `PaletteIcon` for better differentiation from "Themes".

## [1.0.85] - 2025-04-15

### Fixed

- Retaining AI chat history on a slate prior to the intention being set (welcomeAid).
- Branding kit layout changes
- AI Usage check (doh) for non paying users

## [1.0.84] - 2025-04-13

### Fixed

- Refined logo upload filename generation in `BrandingGuidelines.jsx` to prevent duplicate file extensions.

## [1.0.80] - 2025-04-13

### Added

- Display hex color code in parentheses next to color name/value in Branding Guidelines Color Palette editor.
- Display hex color code in parentheses on tooltip for color swatches in Color Preset editor.

### Changed

- Refactored `BrandPreviewSlate` to use surgical updates (`invoke`) for example nodes, improving responsiveness to preset changes.
- Updated font handling in Branding Presets and `BrandPreviewSlate`:
  - UI state uses font shorthand names (e.g., 'bangin1').
  - Preview renders nodes using the correct CSS font value (e.g., 'bangers') based on the selected shorthand.
  - Updated font saving logic in Branding Presets.
- Presentation Mode control colors (background and foreground) are now sourced directly from the hex values stored in the `currentPresentation` atom (`presentationMenuBgColorKey`, `presentationControlsColorKey`) within `BasePresent.jsx`, removing the need for props.
- Updated `ColorPresetEditor` to save hex values directly for presentation colors and correctly display selection checkmarks using ID lookups.
- Updated `BrandPreviewSlate` to use saved hex values directly for presentation color previews.
- Removed fallback gradient generation via `Meteor.callAsync` in `createSlate.js` and `BrandPreviewSlate`, relying solely on pre-calculated `gradientColors` stored in presets.
- Stitched in the branding guidelines into the infographic intention prompt as a first pass, using the `{{technicalInstructions}}` placeholder.

### Fixed

- Ensured `BrandPreviewSlate` centers the view on example nodes after updates.
- Ensure default intentionId is used for prezi controls out of the gate

## [1.0.78] - 2025-04-07

### Brand Kit Enhancements

- Brand Kit presets (colors, fonts, background) now apply automatically when creating new slates.
- Default presets use the Organization Setting `default` intention.
- New server method `organizationSettings.getByQuery` added for targeted fetching.
- Added a live preview slate to the Brand Kit settings page.
- Preview slate uses default styles (white radial gradient, specific node colors/fonts) when no preset is selected/saved.
- Preview slate now creates multiple category/note nodes based on selected preset colors.
- Preview slate nodes dynamically resize based on text content and style.
- Added debounced layout overlap removal to preview slate.
- Added informational note below the preview slate.
- Presentation Mode checkbox in Brand Kit settings is auto-selected when Presentation preset tab is clicked.
- Fixed various bugs related to preset application, preview node removal, and logo visibility.

## [1.0.77] - 2025-03-26

- Support for copying a slate and its published presentation from the marketing side

## [1.0.75] - 2025-03-22

- Fixes for org settings and permissions

## [1.0.69] - 2025-03-22

- Mobile fixes for presentations

## [1.0.65] - 2025-03-22

- Updated authManager to ensure awaiting

## [1.0.64] - 2025-03-19

- Adjustments in presentation, better colors, fixes

## [1.0.63] - 2025-03-16

- Better SVG presentation details

## [1.0.54] - 2025-03-15

- CSS SVG transform fixes for angled text

## [1.0.49] - 2025-03-09

- Fixed present to have a better iframe embed - much less bloat, and split the public vs editable presentation into a single backend object
- More work on the dang presentations and autoplay
- resizeobserver on basepresent, better handling of onHover

## [1.0.42] - 2025-03-04

- Mobile fixes

## [1.0.41] - 2025-03-02

- Added featurePresentation for homepage

## [1.0.40] - 2025-03-01

- Enhanced AI diagram generation with improved layout algorithms
- Improved real-time collaboration performance with optimized CRDT operations
- Fixed issue with presentation mode transitions
- Updated Claude integration to use latest API features

## [1.0.39] - 2025-02-26

- Adding playOnHover for embedding

## [1.0.37] - 2025-02-25

- Upping max_tokens for anthropic to 128k
- Upgraded anthropic engine to claude-3-7-sonnet-latest for welcome chat

## [1.0.35] - 2025-02-25

- Added AI layout optimization
- Created new slateboxjs force directed layout algo instead of using graphviz API or AI prompts

## [1.0.34] - 2025-02-07

- Fixed AI category handling

## [1.0.22] - 2025-01-28

- Fixed AI request indicator
- Much better AI handling for presentations

## [1.0.19] - 2025-01-19

- Fixed presentation mode issues (highlighting, panning, zooming, and viewpoint deletion)
- Upgraded slateboxjs to 2.5.3
- Better AI workflow for diagramming

## [1.0.13] - 2025-01-01

- All the work to rebuild the app with meteor 3.1, upgrading node 22, MUI update, and AI simplification

## [0.22.6] - 2024-05-08

- Support for exporting individual node as SVG or PNG or a group of nodes

## [0.21.3] - 2024-05-01

- Support for orthogonal and bezier lines
- New Image Diagram to Slate using ChatGPT4 with vision. Early release.
- Upgraded the Kubernetes cluster tooling

## [0.20.0] - 2024-04-18

- Rendering and template fixes

## [0.19.0] - 2024-04-15

- Collaboration improvements

## [0.18.0] - 2024-04-07

- Education certification

## [0.17.1] - 2024-03-13

- Tweaks for multi-user CRDT feedback
- AI Collab fixes

## [0.16.0] - 2024-03-06

- CRDT updates for full collab

## [0.15.1] - 2024-01-17

- Major shift to Yjs/CRDT for collaboration

## [0.14.5] - 2024-01-17

- More work in adhoc AI

## [0.14.1] - 2024-01-14

- Added AI at the node level

## [0.13.3] - 2024-01-06

- Fix for the conversation

## [0.13.1] - 2023-12-31

- Refining the conversation with puncuation, endpointing, and more stable note-taking and AI conversations

## [0.12.0] - 2023-11-23

- Ability to add/remove/update AI conversations for orgs

## [0.11.0] - 2023-11-20

- Bugfixes, swapping AWS polly for openai TTS, post Altman's crazy ousting

## [0.10.4] - 2023-11-06

- Bugfixes, leveraging openai's latest models

## [0.10.0] - 2023-11-05

- Created real-time API conversations

## [0.90.2] - 2023-08-27

- Added deepgram transcription capabilities to huddling
- Isolated Huddle to its own component

## [0.80.0] - 2023-07-23

- API creation v1, bug fixes

## [0.79.7] - 2023-06-25

- Hotfix for the image saving

## [0.79.6] - 2023-06-24

- Allow embedded slate images to auto-update when the user changes them

## [0.79.5] - 2023-06-05

- Added embeddable img with websockets
- Added richer noun project integration
- Bug fixes on magic links

## [0.78.0] - 2023-05-07

- Added passwordless login

## [0.77.19] - 2023-05-07

- Actual push to test

## [0.77.17] - 2023-05-07

- Last release before go live hopefully
- Fixed welcomeMessage to show after unicorns, reenabled dur during movenodes in collaboration
- Fixed bug where too many AI slates were being created in the passthrough

## [0.77.15] - 2023-04-30

- Added video guides
- Added better mobile handling of screen size
- Added pulsing help icon
- Fixed SVG filters on mobile

## [0.77.13] - 2023-04-30

- Data loss, bug fixes

## [0.77.6] - 2023-04-29

- Rebuilt kubernetes cluster

## [0.77.5] - 2023-04-26

- Implemented URL and template magic links
- Safari filter fix
- Added template and URL magic links
- Added note for mobile browsers

## [0.77.1] - 2023-04-23

- Sped up template genning, bug fix

## [0.76] - 2023-04-23

- Private beta teams, custom prompts in templates, material ui fixes

## [0.74] - 2023-04-22

- Added passthrough auto template populating, URL into diagrams

## [0.73] - 2023-04-20

- Upgraded react-router-dom, added magiclinks, fixed org guestview bugs

## [0.72.6] - 2023-04-09

- Adding easier categorization of template segments

## [0.72.0] - 2023-04-09

- Adding AI Auto population of templates

## [0.71.4] - 2023-04-03

- Adding AI Mindmaps

## [0.70.0] - 2023-02-26

- Loading custom AWS and other icons into iconPacks

## [0.69.0] - 2023-01-25

- Creating iconPacks

## [0.68.0] - 2023-01-25

- Updating quick node actions with more features

## [0.67.6] - 2023-01-25

- Upgrading slateboxjs for individual selection of nodes and style editing

## [0.66.2] - 2023-01-25

- Hotfix for markdown and tagging retention

## [0.66] - 2022-01-20

- Added frame-savable template png generation

## [0.63] - 2022-10-01

- Added markdown and tagging for templates

## [0.61] - 2022-10-01

- Upgrading to recoil

## [0.26] - 2022-10-01

## [0.16] - 2022-07-10

### Added

### Changed

- Added daily api key

## [0.13] - 2022-07-09

### Added

### Changed

- Fix to the user management page
- Huddle toggle cleanup

## [0.12] - 2022-07-07

### Added

### Changed

- Audio only huddles by default

## [0.11] - 2022-07-07

### Added

### Changed

- Added video & audio chat
- Adjusted verbiage for pricing tiers, including video/audio chat and google docs integration

## [0.10.10] - 2022-07-03

### Added

### Changed

- Fix for the licensing language

## [0.10.9] - 2022-07-03

### Added

### Changed

- Fix to snapshots to avoid undefined Slatebox object.
- Added github release.yml file for auto versioning and release notes.

## [0.10.8] - 2022-04-26

### Added

### Changed

- Updated to better collab handling in slateboxjs
- Fix for quicknode add node to be compliant with better collab handling

## [0.10.7] - 2022-04-26

### Added

- Adding gpdr compliance
- Added ToS and Privacy documents

### Changed

## [0.10.6] - 2022-04-26

### Added

### Changed

- Missing cloudLink param

## [0.10.1] - 2022-04-24

### Added

### Changed

- Reorganized cloud link and export options
- Slateboxjs multiselection bug fix

## [0.10.0] - 2022-04-24

### Added

- Google Doc Integration

### Changed

- Fixed bug with node behavior
- Fixed bug with focus during add text only node

## [0.9.11] - 2022-04-14

### Added

### Changed

- Messages cleanup, explicit system v chat checks

## [0.9.10] - 2022-04-14

### Added

### Changed

- Payment changes, message sub changes

## [0.9.9] - 2022-03-16

### Added

### Changed

- Adjusting tweaks for streamy DDP

## [0.9.6] - 2022-03-16

### Added

### Changed

- Tweaks for streamy DDP

## [0.9.5] - 2022-03-16

### Added

### Changed

- Fixed dns name to include port 3000 for streamy

## [0.9.4] - 2022-03-16

### Added

### Changed

- Changed chat so an empty message isn't broadcast
- Updated streamy broadcasts to use dns names instead of IP

## [0.9.3] - 2022-03-16

### Added

- Added chat during collaboration
- Added follow me mode for slate canvas and zoom syncing during collaboration

### Changed

- Fixes for remote cursor position

## [0.9.2] - 2022-03-08

### Added

### Changed

- Migrated to npm installed slateboxjs instead of local

### Renoved

## [0.9.1] - 2022-03-05

### Added

### Changed

- Hotfix for collaboration

### Renoved

## [0.9.0] - 2022-03-02

### Added

- Initial versioning

### Changed

### Removed

### Fixed

- Removed unused imports and fixed import naming conflict in `Main.jsx`.

[Unreleased]: https://github.com/Slatebox/slatebox/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/Slatebox/slatebox/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/Slatebox/slatebox/compare/v0.2.2...v2.0.0
[0.2.2]: https://github.com/Slatebox/slatebox/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Slatebox/slatebox/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Slatebox/slatebox/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Slatebox/slatebox/releases/tag/v0.1.0
