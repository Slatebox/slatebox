# Integrations: connect once, invite anywhere

Integrations are free for everyone: on Slatebox Cloud with any account, and on every self-hosted
install with no key. No integration needs a plan. The agent work they run counts like any other agent request: on Slatebox Cloud
against your Slatebox credits, or on your own key, which spends no Slatebox credits; on a
self-hosted install on the models its administrator sets up, or on people's own.

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

## The agent gallery

**+ Invite agent** (and **Connect an integration**) opens with a gallery of agents that bring in what
Slatebox can't do itself: your work data, your files and chats, your code and deploys, your own
designs and boards, your customers and numbers, knowledge, the web and facts. Every card is the
vendor's own remote MCP server at the vendor's own address. Unofficial third-party servers and gateways
are not built in (paste any of them under **Custom**); **Community** cards are servers people suggested
and Slatebox reviewed. Agents that only draw what Slatebox draws (Excalidraw,
tldraw) are not listed; Miro, Figma and Canva are, because they bring in a person's own boards and
designs. A card whose vendor needs an app the server's administrator registers
(see [Apps an operator registers](#apps-an-operator-registers)) shows greyed out, *Not set up on this
server yet*, until that app is set up. Use the chips (**All**, **Work**, **Docs, chat and meetings**, **Developer tools**, **Design**,
**Business**, **Research**, **Web and facts**) or the search box to find one. Any MCP server works
too: paste its address.

The last column says whether About you can use the tool to personalize Slatebox (see
[Use your tools to personalize](#use-your-tools-to-personalize-about-you)).

| Chip | Agent | Address | Sign-in | Personalize |
| --- | --- | --- | --- | --- |
| Work | Linear | `https://mcp.linear.app/mcp` | Linear | Yes |
| Work | Jira, Confluence and Loom | `https://mcp.atlassian.com/v2/mcp` | Atlassian | Yes |
| Work | Asana | `https://mcp.asana.com/v2/mcp` | Asana (needs the operator's asana app, see below) | Yes |
| Work | monday.com | `https://mcp.monday.com/mcp` | monday.com | Yes |
| Work | ClickUp | `https://mcp.clickup.com/mcp` | ClickUp | Yes |
| Work | Trello | `https://mcp.trello.com/v1` | Atlassian | Yes |
| Work | Airtable | `https://mcp.airtable.com/mcp` | Airtable (or a personal access token) | Yes |
| Work | Zapier | `https://mcp.zapier.com/api/v1/connect` | Zapier |  |
| Work | Todoist | `https://ai.todoist.net/mcp` | Todoist | Yes |
| Work | Make | `https://mcp.make.com` | Make |  |
| Docs, chat and meetings | Notion | `https://mcp.notion.com/mcp` | Notion | Yes |
| Docs, chat and meetings | Slack | `https://mcp.slack.com/mcp` | Slack (needs the operator's slack app, see below) | Yes |
| Docs, chat and meetings | Granola | `https://mcp.granola.ai/mcp` | Granola | Yes |
| Docs, chat and meetings | Microsoft 365 | `https://workiq.svc.cloud.microsoft/mcp` | Microsoft (needs the operator's microsoft app, see below) |  |
| Docs, chat and meetings | Microsoft Entra directory | `https://mcp.svc.cloud.microsoft/enterprise` | Microsoft (needs the operator's microsoft app, see below) | Yes |
| Docs, chat and meetings | Gmail | `https://gmailmcp.googleapis.com/mcp/v1` | Google (needs the operator's google app, see below) |  |
| Docs, chat and meetings | Google Calendar | `https://calendarmcp.googleapis.com/mcp/v1` | Google (needs the operator's google app, see below) |  |
| Docs, chat and meetings | Google Docs | `https://docsmcp.googleapis.com/mcp/v1` | Google (needs the operator's google app, see below) |  |
| Docs, chat and meetings | Google Sheets | `https://sheetsmcp.googleapis.com/mcp/v1` | Google (needs the operator's google app, see below) |  |
| Docs, chat and meetings | Google Chat | `https://chatmcp.googleapis.com/mcp/v1` | Google (needs the operator's google app, see below) |  |
| Docs, chat and meetings | Dropbox | `https://mcp.dropbox.com/mcp` | Dropbox |  |
| Docs, chat and meetings | Dropbox Dash | `https://mcp.dropbox.com/dash` | Dropbox |  |
| Docs, chat and meetings | Box | `https://mcp.box.com` | Box (needs the operator's box app, see below) |  |
| Docs, chat and meetings | Zoom | `https://mcp.zoom.us/mcp/zoom/streamable` | Zoom (needs the operator's zoom app, see below) |  |
| Docs, chat and meetings | Calendly | `https://mcp.calendly.com` | Calendly |  |
| Docs, chat and meetings | Coda | `https://coda.io/apis/mcp` | Coda |  |
| Developer tools | GitHub | `https://api.githubcopilot.com/mcp/` | GitHub (or a personal access token) | Yes |
| Developer tools | Sentry | `https://mcp.sentry.dev/mcp` | Sentry | Yes |
| Developer tools | GitLab | `https://gitlab.com/api/v4/mcp` | GitLab |  |
| Developer tools | Vercel | `https://mcp.vercel.com` | Vercel | Yes |
| Developer tools | Netlify | `https://netlify-mcp.netlify.app/mcp` | Netlify |  |
| Developer tools | Supabase | `https://mcp.supabase.com/mcp` | Supabase | Yes |
| Developer tools | Neon | `https://mcp.neon.tech/mcp` | Neon | Yes |
| Developer tools | Cloudflare | `https://mcp.cloudflare.com/mcp` | Cloudflare |  |
| Developer tools | Datadog | `https://mcp.datadoghq.com/api/unstable/mcp-server/mcp` | Datadog |  |
| Developer tools | PagerDuty | `https://mcp.pagerduty.com/mcp` | PagerDuty | Yes |
| Developer tools | Postman | `https://mcp.postman.com/mcp` | Postman (or an API key) | Yes |
| Developer tools | Replit | `https://replit-mcp.com/server/mcp` | Replit | Yes |
| Developer tools | Lovable | `https://mcp.lovable.dev` | Lovable | Yes |
| Developer tools | v0 | `https://v0.app/api/mcp` | Vercel |  |
| Design | Figma | `https://mcp.figma.com/mcp` | Figma |  |
| Design | Miro | `https://mcp.miro.com/` | Miro |  |
| Design | Canva | `https://mcp.canva.com/mcp` | Canva | Yes |
| Design | Lucid | `https://mcp.lucid.app/mcp` | Lucid (or an API key) |  |
| Design | Whimsical | `https://mcp.whimsical.com/mcp` | Whimsical |  |
| Design | Webflow | `https://mcp.webflow.com/mcp` | Webflow |  |
| Design | Framer | `https://mcp.framer.com/mcp` | Framer |  |
| Design | Gamma | `https://mcp.gamma.app/mcp` | Gamma |  |
| Design | Pitch | `https://mcp.pitch.com/mcp` | Pitch (needs the operator's pitch app, see below) |  |
| Design | Wix | `https://mcp.wix.com/mcp` | Wix |  |
| Design | Adobe Experience Manager | `https://mcp.adobeaemcloud.com/adobe/mcp/aem` | Adobe |  |
| Design | Adobe Firefly workflows | `https://run-workflow.adobe.io/mcp` | Adobe |  |
| Business | HubSpot | `https://mcp.hubspot.com` | HubSpot (needs the operator's hubspot app, see below) | Yes |
| Business | Stripe | `https://mcp.stripe.com` | Stripe (or a restricted key) |  |
| Business | PostHog | `https://mcp.posthog.com/mcp` | PostHog (or a personal API key) |  |
| Business | Salesforce | `https://api.salesforce.com/platform/mcp/v1/platform/sobject-reads` | Salesforce (needs the operator's salesforce app, see below) |  |
| Business | Intercom | `https://mcp.intercom.com/mcp` | Intercom |  |
| Business | Typeform | `https://api.typeform.com/mcp` | Typeform |  |
| Business | Attio | `https://mcp.attio.com/mcp` | Attio |  |
| Business | Pipedrive | `https://mcp.pipedrive.ai/mcp` | Pipedrive |  |
| Business | Apollo.io | `https://mcp.apollo.io/mcp` | Apollo.io |  |
| Business | Square | `https://mcp.squareup.com/mcp` | Square |  |
| Business | PayPal | `https://mcp.paypal.com/mcp` | PayPal |  |
| Research | Hugging Face | `https://huggingface.co/mcp` | None |  |
| Research | DeepWiki | `https://mcp.deepwiki.com/mcp` | None |  |
| Research | Context7 | `https://mcp.context7.com/mcp` | None |  |
| Research | Jina | `https://mcp.jina.ai/v1` | None |  |
| Research | Microsoft Learn | `https://learn.microsoft.com/api/mcp` | None |  |
| Research | Cloudflare Docs | `https://docs.mcp.cloudflare.com/mcp` | None |  |
| Web and facts | Wolfram | `https://agenttools.wolfram.com/mcp` | None |  |
| Web and facts | Firecrawl | `https://mcp.firecrawl.dev/v2/mcp` | None |  |
| Web and facts | Exa | `https://mcp.exa.ai/mcp` | None |  |
| Web and facts | Parallel | `https://mcp.parallel.ai/mcp` | None |  |

Notes on some of them:

- **Atlassian** (Jira, Confluence, Loom, Bitbucket Cloud, Compass): one server. Its older addresses
  (`https://mcp.atlassian.com/v1/mcp`, `/v1/sse`) are the same card; an agent invited there makes its
  changes at `/v2/mcp`.
- **Datadog** has one address per Datadog site (`mcp.us3.datadoghq.com`, `mcp.us5.datadoghq.com`,
  `mcp.datadoghq.eu`, `mcp.ap1.datadoghq.com`, each at `/api/unstable/mcp-server/mcp`); paste yours if
  it is not US1. **Intercom** (`mcp.eu.intercom.com/mcp`) and **Typeform** (`api.eu.typeform.com/mcp`)
  have EU addresses too. Each is the same card.
- **Supabase** and **Neon** start with SQL, migrations and new projects **off**; **Cloudflare**'s code
  tool, **Square**'s API tool, **PayPal** and **Stripe** refunds, **Lovable** publishing, **Vercel**
  deploys and domain purchases, and **Microsoft 365**'s changes (sending mail included) start off too.
  **PagerDuty** asks for its `read` scope only, not the about 90 scopes its server lists.
- **Replit**, **Dropbox**, **Coda** and **Pipedrive** are in beta at their vendors. **Vercel**, **Figma**
  and **Lovable** may ask Slatebox's operator to register or approve Slatebox as a client before
  automatic registration works for a hosted install; **Adobe Experience Manager** and **Adobe Firefly
  workflows** are for those Adobe enterprise customers. **Microsoft 365** needs your Microsoft 365
  administrator to turn it on.
- **Not listed yet, and why**: Adobe's creative connector (`adobe-creativity.adobe.io`) answers only
  allowlisted clients; Mural has no public address; Cursor has no remote server; Smartsheet's sign-in
  does not offer PKCE, which Slatebox requires (paste a Smartsheet API token under Custom); Gong and
  QuickBooks are partner-only; Bolt, Zendesk, Squarespace, Mailchimp, Adobe Acrobat and tldraw's
  account server answer but their vendors do not document them yet; Shopify's catalog and Plaid's
  dashboard servers are not for team workspaces. Azure DevOps has one address per organization
  (`https://mcp.dev.azure.com/<organization>`): paste yours under Custom, and it signs in with the
  operator's Microsoft app.

Most of the sign-in agents register Slatebox with their service automatically when you first sign
in. The ones marked *needs the operator's app* don't: their card shows once the server's operator
registers an app with that service (below). Stripe refunds and every tool that deletes, closes,
cancels or merges start **off**. Administrators turn cards on or off, reorder them and edit their
words and recipes in /admin/ai › Agent gallery; each card's hint for the planner is a prompt
(`connectors.recipe.<card>`) in /admin/ai › Prompts.

## Apps an operator registers

Slack, Asana, HubSpot, Box, Zoom, Pitch, Salesforce, Microsoft and Google offer no automatic
registration, so Slatebox signs people in through one app the server's operator registers with each.
On **Slatebox Cloud** Slatebox LLC registers them, and each card is offered once its app is
registered (until then it shows *Not set up on this server yet*); on a **self-hosted install** the
administrator does, for their own install. Each one needs:

- **Redirect URL** (also called callback or reply URL): `<your Slatebox address>/connectors/oauth/callback`,
  for example `https://app.slatebox.com/connectors/oauth/callback`. It must be https.
- **Settings**: `settings.connectors.oauthApps.<provider>` with `clientId` and `clientSecret` (the
  secret lives only in settings or the environment that fills them, never in the database). The
  provider's sign-in server and the only MCP servers its sign-in is sent to are built into Slatebox
  (`enterprise/server/oauth.mjs` `KNOWN_PROVIDERS`), so nothing else is needed. `scopes` replaces the
  scopes Slatebox asks for, on purpose (for example to allow Gmail drafts).
- `SLATEBOX_KEY_ENCRYPTION_KEY` set, as for every sign-in.

| Provider (`oauthApps.<provider>`) | Cards | Where to register | Scopes Slatebox asks for |
| --- | --- | --- | --- |
| `slack` | Slack | api.slack.com/apps: a Slack app with *User Token Scopes* for the MCP server (channels, search, chat, canvases), distributed or installed to the workspace; a workspace admin may need to approve it | what the server's metadata lists |
| `asana` | Asana | Asana developer console: an app for MCP V2 (confidential client) | what the server names (`default`) |
| `hubspot` | HubSpot | HubSpot: Development › MCP Auth Apps | what the server names |
| `box` | Box | Box Developer Console: an OAuth 2.0 app with the *Manage AI Requests* scope (or the admin's predefined *Box MCP Server* integration) | what the server names |
| `zoom` | Zoom | Zoom Marketplace: Develop › Build app › General app, with the read scopes below; PKCE on | read-only: `meeting:read:search meeting:read:assets cloud_recording:read:content cloud_recording:read:list_user_recordings my_notes:read:content hub:read:content agentic_search:read:search agentic_search:read:ask` (Zoom's metadata lists its write and delete scopes too; Slatebox never asks for them unless `scopes` says so) |
| `pitch` | Pitch | ask Pitch for an OAuth client for an MCP client | `openid profile email offline_access` |
| `salesforce` | Salesforce | in each Salesforce org: an External Client App (not a Connected App) with the `mcp_api` and `refresh_token` scopes, and the org's admin turns on the hosted MCP server | `mcp_api refresh_token` |
| `microsoft` | Microsoft 365, Microsoft Entra directory (and a pasted Azure DevOps address) | Microsoft Entra admin center: App registrations › New, *Accounts in any organizational directory* (multi-tenant), platform *Web* with the redirect URL, a client secret; API permissions (delegated): Work IQ `WorkIQAgent.Ask` (its only permission; it reads and writes, so the card's write tools start off), the Microsoft MCP Server for Enterprise's `MCP.User.Read.All` and `MCP.Group.Read.All`, Azure DevOps if you want it, and `offline_access` | Work IQ `fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask`; directory `api://e8c77dc2-69b3-43f4-bc51-3213c9d915b4/.default`; Azure DevOps `https://mcp.dev.azure.com/.default`; each with `offline_access` |
| `google` | Gmail, Google Calendar, Google Docs, Google Sheets, Google Chat | Google Cloud console: an OAuth client of type *Web application* with *Use this client for an AI-powered agent* checked, the redirect URL; enable each API and its MCP API (`gmailmcp`, `calendarmcp`, `docsmcp`, `sheetsmcp`, `chatmcp` `.googleapis.com`) | read-only by default: `gmail.readonly`; `calendar.calendarlist.readonly calendar.events.readonly`; `documents.readonly drive.readonly`; `spreadsheets.readonly drive.readonly`; `chat.spaces.readonly chat.messages.readonly` (Slatebox also asks Google for offline access) |

Each tenant or workspace decides for itself too:

- **Microsoft**: every permission above needs a tenant administrator's consent, and the tenant must
  turn on Work IQ (Microsoft 365 admin center › Agents › Tools); the directory server needs the
  tenant's administrator to grant Slatebox's app its `MCP.*` scopes. Personal Microsoft accounts are
  not supported by these servers. Microsoft says to use Work IQ for Microsoft 365 rather than its older
  per-workload Agent 365 servers, so Slatebox lists Work IQ only.
- **Google**: Gmail and Drive scopes are restricted, so a public Google app needs Google's OAuth
  verification and a yearly security assessment; a Google Workspace organization can instead mark the
  app internal or trusted for its own users.
- **Slack**, **Box**, **Zoom**: a workspace or account admin may need to approve the app.

Slatebox's own sign-in steps stay as strict for these as for every server (PKCE, the issuer checked
exactly, every address public and https), with each vendor's documented exceptions built in:
Microsoft's issuer is its `{tenantid}` template, it does not advertise PKCE (Entra supports it) and its
token service refuses the `resource` parameter; Google and Box spell their issuer with and without a
trailing slash; Zoom takes its client secret only in a Basic header; Google's servers answer without a
sign-in until a tool is called, so their cards sign in first.

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
- Each row sums up what the agent may use in one line ("Looks things up with 34 tools · Makes
  changes with 6 (you approve each one) · 2 off"); **Review tools** lists every tool. Only Google's
  row says which Google access it has.
- In **Connect an agent**, the gallery card of an agent you already connected says **✓ Connected**
  and **Manage** brings its row into view; on a slate, the card offers **Invite to this slate**. No
  other card is highlighted.

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
- **Connected before agents read and write?** Its changes stayed off: Slatebox never turns on what
  you did not choose. Its row on the Integrations page (and **Review tools**) offers **Let it make
  changes too (you approve each one)**: one click turns on the changes its server offers, on every
  slate it is on (a tool you turned off on one slate stays off there). Ones that delete, close or
  merge stay off. Linear connected at its read-only address (`https://mcp.linear.app/mcp/readonly`)
  can only look things up there: the same button signs you in to Linear once more at its full
  address, and the agent moves there with its name, slates and rule; its read-only sign-in is removed.
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

## Use your tools to personalize (About you)

Profile › About you › **Use your tools to personalize** lists the tools you connected that Slatebox can
read to get to know your work (the *Personalize* column above). Each has its own switch, **Use <tool>
to personalize**, off until you turn it on. Slatebox reads nothing from a tool whose switch is off, or
while personalization is off.

With a switch on, **Look around in <tool>** reads a small sample, such as your profile, your projects,
your recent issues or channels: at most three lookups, each a tool you allowed that only looks things
up (never one that changes anything, whatever you allowed), each answer capped. The agent turns the
sample into a few facts (projects, tools, teams, work and topics) and shows them as chips: **Keep** or
**Skip** each. Nothing is kept until you choose Keep. A kept fact says *From <tool>*; turning the
switch off stops Slatebox using it, and you can edit, hide or remove it like any fact.

- What a tool's server answered is outside data: it is quarantined, sent to the model wrapped as
  data, and never followed as instructions. Nothing it said is stored; only the facts you keep are.
- The look is metered like any other agent request (feature `profile.sources`). Administrators bind
  or turn off its model in /admin/ai (part *Learning from your tools*, which follows the conversation
  until bound) and edit its prompts there (`profile.sources.facts`, `.sample`, `.tool`, `.retry`).
- Which lookups a card makes is its recipe's `lookAround` (fixed steps, at most three, no planner),
  edited in /admin/ai › Agent gallery like the rest of its recipe.
- Methods: `profile.sources.list`, `profile.sources.read`, `profile.sources.keep`, for the signed-in
  person in the app only (no token reads your tools for personalization).

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
