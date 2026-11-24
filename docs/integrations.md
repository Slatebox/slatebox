# Integrations: connect once, invite anywhere

Integrations are part of Slatebox Pro and Slatebox Business on Slatebox Cloud, and of every
self-hosted install with a Slatebox license. Plans and prices: <https://slatebox.com/plans/>.

## What an integration is

An integration is an outside agent (any MCP server) or your Google account, connected **once** on the
**Integrations** page (`/integrations`, also in the left navigation and on Profile). After that:

- **Invite it onto any slate** from the slate's **+ Invite agent** → *Your integrations* →
  **Invite to this slate**. There is no new sign-in and you don't choose its tools again.
- **Or let it join every slate you own** by itself: set *Joins slates* to **On every slate I own**.
  It arrives when you open one of your slates. Everyone who can open that slate sees its name on the
  slate (only you see its server's address). Slates anyone with the link can view are skipped: invite
  it there yourself if you want it there.
- **Who may bring outside agents** (a slate's owner chooses: editors, only the owner, or no one) also
  holds for agents already on the slate: theirs stop answering until it allows them again.
- **Remove it from one slate** from its chip. That slate remembers: your rule never brings it back
  there. You can still invite it there yourself.
- **Disconnect it** on the Integrations page. It leaves every slate, its suggestions that are still
  waiting are discarded (notes people kept stay), and its sign-in is revoked.

Connecting a server from a slate's walkthrough makes the integration too, so the next slate only needs
**Invite to this slate**.

## Who can do what

- Only you can ask your agent. Everyone on a slate sees its cursor and its suggestions, and that it
  was "invited by" you or "joined by" your rule. They never see its tools, its address or your sign-in.
- Rules only bring **your** integrations onto slates **you own**. On someone else's slate you invite
  it yourself, if you can edit there.
- A slate's owner chooses who may bring outside agents onto it (in **+ Invite agent**): anyone who can
  edit (the default), only the owner, or no one. The owner can remove any agent.
- On each slate an agent sees only what you ask it, unless you change that for that slate.
- When an agent's tools change, it pauses on every slate at once. **Review tools** on the
  Integrations page, then save, and it resumes everywhere.

## Agents read and write

Every agent you connect can look things up **and** change things in the system it connects to (a
Linear issue, a GitHub comment), as much as its server allows. Nothing changes without a person:

- **What it may do.** When you connect or invite it, its tools come in two groups: *Look things up*
  and *Change things outside Slatebox*. Changes start **on**; ones that delete, close or merge
  something start **off**, with a warning. Slatebox reads each tool's own annotations
  (`readOnlyHint`, `destructiveHint`) first, then its name; an administrator can correct a tool in
  the gallery recipe (`recipe.tools`, /admin/ai › Agent gallery). A server's read-only claim never
  turns a tool whose name writes (`create_issue`, `delete_repository`) into a lookup, and an
  administrator's correction never loosens a tool you already allowed as a change: it still waits on
  a card.
- **Ask for a change in plain words**: "@Linear file the retry bug", "@GitHub open an issue for this",
  "@Linear mark ENG-12 done". The agent proposes it only when your own words ask for a change (a part
  of your ask that starts with a verb such as *file*, *open an*, *create*, *comment*, *mark*); never
  because a note or a server's description says so. Questions such as "list the open issues" or
  "make a list of bugs" are lookups, as before.
- **It lands as an action card**, in the same frame as the agent's other suggestions: what would
  happen, where, and with what ("Create Linear issue: Retry fails on 502 · Team: ENG", then its
  description and **every other value it sends**, such as labels or an assignee, in full). What you
  approve is exactly what is sent; a change too long to show on a card in full is not proposed.
  **Approve** on the card approves it, **Decline** declines it. Keep all never
  approves a card: on a frame with cards it says **Keep all suggestions** and keeps only the other
  notes, and a frame of cards only has none. The agent's chip lists its cards too, with
  **Approve** and **Decline**.
- **When you approve**, the change is made then, as you, after Slatebox checks the tool is still the
  one you allowed. The card then says *Done*, with a link to what was made. If the server refuses,
  the card says why in plain words and stays, to approve again or decline. If the request went out but
  no answer came back (a timeout, a lost connection), the card says *Not sure it was made*: look in
  the other system first. Approve never sends it twice; *Try again anyway* (on the card, or on the
  agent's chip) does, on purpose. A change being made right now cannot be stopped: Discard and Decline leave its card,
  which then says how it went.
- **Undo** takes back the agent's notes on the slate, never what was done outside it: the card stays,
  and the undo says so. Change it where it was made (the card links there).
- **Who approves.** Only the person who invited the agent (the same rule as asking), unless they or
  the slate's owner let anyone who can edit the slate approve (its chip: *Who approves*). Either can
  narrow it back. A token (exec, MCP, API) approves only for an agent that acts without asking, and
  never a destructive change; Slatebox's own conversation and teammate never approve.
- **Act without asking** (off by default): for one slate on the agent's chip, or for every slate on
  its row on the Integrations page. Its changes are then made during the ask and its cards say *Done
  without asking*. Deleting, closing, cancelling or merging still waits for a person, whether the
  tool says so or the change's own values do (an update that sets an issue to *closed* or
  *Canceled*). Only the person who invited it turns this on; they or the slate's owner can turn it
  off, and the owner's *off* holds until the owner lets the inviter choose again. The Integrations
  page setting reaches only slates you own; on someone else's slate you turn it on there. Every
  change of this setting is kept in the agent's activity and the audit log; each change made names
  the account that approved it (and the token, for a token).
- **Gallery recipes.** Linear (connected at `https://mcp.linear.app/mcp`; agents invited earlier at
  its read-only address keep working and show the same card): create an issue, comment, update an
  issue's status. GitHub: open an issue, comment, and open a pull request from a branch that already
  exists, where its server offers it (Slatebox never pushes code). Any other server: whatever change
  tools it lists.

## Google

Connect Google on the Integrations page, then:

- **Save to Google Drive** (the slate's export panel): the slate's picture goes into a *Slatebox*
  folder in your Drive.
- **Export to Google Docs**: the slate's title, each branch as a heading with its notes as bullets
  (links kept), and its picture. **Update this Doc** writes over the last Doc you made from that slate.
  Docs and Slides export need edit rights on the slate. Google fetches the picture from this server
  once, and the server's copy is removed straight after. If Google can't reach it (for example a
  self-hosted install on a private network), the Doc is made without the picture and the app says so.
- **Import from Google Drive** (the + menu): pick a Doc, sheet, Slides deck or text file. It lands as
  one suggestion of notes (headings become groups) to keep or discard, with one undo.
- **Google Drive as an agent**: invite *Google Drive* onto a slate like any integration, choose
  **Drive files** on its chip, and ask it about those files in Ask Slatebox.

**What Slatebox can see in your Drive.** Slatebox asks Google only for access to the files it makes
and the files you pick (the `drive.file` scope). It cannot list, search or read the rest of your
Drive. Searching a whole Drive would need a restricted Google scope (`drive.readonly`), which means
Google's OAuth verification plus a yearly third-party security assessment; Slatebox does not ask
for it.

Your Google sign-in is kept encrypted on the server for you alone. It never reaches your browser,
another person, an agent's prompt or a log.

## For agents and scripts (exec, API, MCP)

| Action | Route | MCP tool |
| --- | --- | --- |
| `integrations.list` | `GET /api/v1/integrations` | `list_integrations` |
| `integrations.discover` | `POST /api/v1/integrations/discover` | |
| `integrations.review` | `POST /api/v1/integrations/{integrationId}/review` | |
| `integrations.invite` | `POST /api/v1/slates/{shareId}/integrations/{integrationId}` | `invite_integration_to_slate` |
| `integrations.applyRules` | `POST /api/v1/slates/{shareId}/integrations/apply-rules` | |
| `integrations.slateSetting` / `setSlateSetting` | `GET`/`POST /api/v1/slates/{shareId}/agent-settings` | |
| `connectors.outsideActions` | `GET /api/v1/slates/{shareId}/agent-changes` | `list_agent_changes` |
| `connectors.approve` | `POST /api/v1/agent-changes/{cardId}/approve` | `approve_agent_change` |
| `connectors.decline` | `POST /api/v1/agent-changes/{cardId}/decline` | `decline_agent_change` |
| `google.status` | `GET /api/v1/google` | |
| `google.saveToDrive` | `POST /api/v1/slates/{shareId}/google/drive` | |
| `google.exportDoc` / `lastDoc` | `POST`/`GET /api/v1/slates/{shareId}/google/doc` | |
| `google.exportSlides` | `POST /api/v1/slates/{shareId}/google/slides` | |
| `google.importFile` | `POST /api/v1/slates/{shareId}/google/import` | `import_google_file` |
| `google.slateFiles` / `attachFiles` | `GET`/`POST /api/v1/slates/{shareId}/google/files` | |

Connecting, pasting a key, setting a standing rule and disconnecting (`integrations.connect`,
`integrations.useKey`, `integrations.setRule`, `integrations.disconnect`) are for people in their own
signed-in browser only: they decide what reaches every slate you own, so no token can do them.
Removing an agent from one slate is `connectors.disconnect` (`remove_agent`). A token approves an
action card only for an agent its inviter lets act without asking, and never one that deletes,
closes or merges; any token that may edit the slate may decline one. Letting an agent act without
asking, or letting others approve its changes (`connectors.setActing`, `integrations.setActing`), is
a person's choice in the app only. `suggestions.decide` keeps an action card's note (approving it)
only when the note is named on its own (`itemIds`); its answer's `held[]` says why a card waits. Signing in (to an MCP
server or to Google) happens only in your own signed-in browser: no token, route or tool can start
one. The Google Picker is browser-only, so over exec or the API `google.importFile` works on files
Slatebox may already open (ones it made, or ones picked before).

## Self-hosting: setting up Google

1. In Google Cloud, use the project of the OAuth client in `settings.googleDocs.web`, and enable the
   Google Drive, Docs, Slides and Picker APIs.
2. On the OAuth consent screen, ask only for `https://www.googleapis.com/auth/drive.file`, and publish
   it (brand verification applies; no restricted-scope assessment is needed).
3. Add your app's origin to the client's *Authorized JavaScript origins*. No redirect address is
   needed (the sign-in uses Google's popup).
4. Create an API key restricted to your app's address (HTTP referrer) and to the Picker API, and set
   `settings.public.google.pickerApiKey` to it and `settings.public.google.appId` to the project
   number.
5. `SLATEBOX_KEY_ENCRYPTION_KEY` must be set (the same key that seals agents' sign-ins).

/admin/ai › Gallery shows each of these as set or missing, and turns Google on or off.
