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
| `google.status` | `GET /api/v1/google` | |
| `google.saveToDrive` | `POST /api/v1/slates/{shareId}/google/drive` | |
| `google.exportDoc` / `lastDoc` | `POST`/`GET /api/v1/slates/{shareId}/google/doc` | |
| `google.exportSlides` | `POST /api/v1/slates/{shareId}/google/slides` | |
| `google.importFile` | `POST /api/v1/slates/{shareId}/google/import` | `import_google_file` |
| `google.slateFiles` / `attachFiles` | `GET`/`POST /api/v1/slates/{shareId}/google/files` | |

Connecting, pasting a key, setting a standing rule and disconnecting (`integrations.connect`,
`integrations.useKey`, `integrations.setRule`, `integrations.disconnect`) are for people in their own
signed-in browser only: they decide what reaches every slate you own, so no token can do them.
Removing an agent from one slate is `connectors.disconnect` (`remove_agent`). Signing in (to an MCP
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
