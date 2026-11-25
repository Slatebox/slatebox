# Changelog

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- A copy of a library presentation keeps its look: Present plays the copied deck instead of planning
  the slate again in another style.
- A slate made from a brief of steps is named after its first note, not after a whole row of steps.

### Removed

- Themes: the Themes panel, the theme library (`/themes`), theme generator slates, the "Create with
  theme?" AI preference, theme approval and the `themeId` creation link parameter. A slate that was
  built on a theme can be deleted like any other. Slates and people that still carry theme fields
  open and draw as before, with their own colours; restyle a slate through chat or a presentation
  style.

### Added

- Six presentations built by Slatebox in the library (Launch day war room, The 41-minute checkout
  outage, Q3 investor update, Why trials stall, 2027: three bets, Your first month), one in each of
  six presentation styles. Open a copy and it is the same slate, notes, colors and connections, with
  the same presentation: Present in the copy plays it in its style. The marketing site's Make it yours
  opens these copies.

- Integrations (Pro and Business; licensed self-hosted installs): connect an outside agent or Google
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
  counted like Present: Pro credits on Cloud, the guest allowance, or the person's own key), for
  someone who may edit the slate. Optional style (voyage, stage, editorial, neon, sketch, blueprint,
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
  shapes service (slateboxjs/shapes: checked, normalised, stored with their text box and name), the
  same as any drawn or library shape; only line art (open ribbons, hairline rings) stays a plain
  outline. A searched picture names its source in a small credit line on the steps it shows
  (its licence asks for attribution); generated pictures and the style's art need none.

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

### Changed

- **Google Docs export is now part of Slatebox Pro and Slatebox Business** (the Google integration).
  The old export, which kept a Google token in a browser cookie, is retired: connect Google once on
  the Integrations page and Slatebox keeps the sign-in encrypted on the server. PNG, SVG and Mermaid
  downloads stay as they are.
- Removing an invited agent from a slate no longer signs you out of its server: the sign-in lives as
  long as the integration, and disconnecting the integration revokes it.
- API and MCP: a workshop read's `livePresentation` is now
  `{ sessionId, step, revision, expiresAt }`, where `step` is an index into the
  presenter's deck (-1 is the whole slate); it no longer has `laneId`. The read
  no longer has `publication`: a workshop slate is published like any slate.
  `set_presentation_order` is unchanged. Note this in the MCP publish runbook.

### Fixed

- A run another page or an agent saved, drawn on this canvas, became this person's undo step (their undo
  took the agent's work away for everyone).

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
