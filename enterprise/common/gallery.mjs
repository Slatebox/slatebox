// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The curated gallery of outside agents (first-party servers only, no gateways). The cards say
// what lands on the slate, never how many tools a server has. `featured` cards come first (in order
// only: a featured card looks like every other card, so a tint never reads as "connected").
// signIn: 'oauth' cards need the person to sign in to the vendor (a popup on the vendor's own
// page); keyHint says what they may paste instead. Agents read and write (owner, 2026-11-24): Linear
// is listed by its full address (its read-only one, where earlier agents were invited, is an alias
// of the same card); GitHub signs in with Slatebox's registered GitHub app
// (settings.connectors.oauthApps.github) or a pasted personal access token. Every change an agent
// proposes lands as an action card a person approves (enterprise/server/outside.mjs).
//
// Curated by what an agent adds that Slatebox cannot do itself (owner, 2026-11-24): Slatebox draws
// diagrams, flows, mind maps and boards, so a drawing agent (Excalidraw) is not listed: bringing in
// a person's own Excalidraw drawings is "Import from Excalidraw" in the + menu. ApexCharts is not
// listed until Slatebox has a chart note (it answers chart configurations only).
//
// recipe: what this code does for the asks an agent is known for, with no planner reading the
// server's words (enterprise/server/recipes.mjs). intents are tried in order; a step's arguments
// are filled from the request ({owner}, {repo}, {topic}, {org}, {request}) or from an earlier
// step's extraction ({login}); `each` runs a step once per value; `output` turns the last step's
// answer into notes. A tool may name alternatives (the first the agent may use wins); a server
// that offers none of a step's tools falls back to the planner. writes: the changes it is known for
// (tool names checked against each server's published tool list, 2026-11-24: Linear's
// mcp.linear.app create_issue/update_issue/create_comment, save_* in newer releases; GitHub's
// github-mcp-server issue_write, add_issue_comment, create_pull_request), each offered to the change
// planner alone when the request's words match; args are fixed values the planner cannot change
// ("method": "create"); tools: an administrator's word for what a tool does (lookup, change,
// destructive) over its annotations. Administrators edit the recipe in
// /admin/ai › Gallery (aiAgents); this list is the built-in copy and the fallback.

// Commits from every repository asked, newest first across them (not the first repository's only).
const COMMIT_NOTE = { list: '[*]', text: '{repo} · {sha7} · {commit.message}', link: 'html_url', maxNotes: 5, label: 'Latest commits', newest: 'commit.author.date' }
const REPO = 'Try naming the repository (owner/name).'
// The repositories a pull request search names (organization repositories included), from its text.
const PR_REPOS = 're:"repository_url"\\s*:\\s*"https://api\\.github\\.com/repos/([A-Za-z0-9-]+/[A-Za-z0-9._-]+)"'
const ITEM_NOTE = (label) => ({ list: 'items[*]', text: '{repo} #{number} · {title}', link: 'html_url', maxNotes: 6, label })
// Tried on the request's clauses that ask for a change (tools.mjs changeClauses), each starting with its verb.
const ISSUE_WORDS = '^(file|open|create|log|raise|add|make|report|track|write up)\\b.*\\b(issues?|bugs?|tickets?|tasks?)\\b'
const COMMENT_WORDS = '\\b(comment|reply)\\b'

export const GALLERY = Object.freeze([
  {
    id: 'huggingface',
    name: 'Hugging Face',
    url: 'https://huggingface.co/mcp',
    job: 'Models and papers',
    lands: 'Finds models, datasets, Spaces and papers, and adds them as linked notes.',
    try: 'Find open models that remove image backgrounds',
    featured: true,
    cost: 'Free',
    recipe: { rounds: 1, calls: 2, intents: [] },
  },
  {
    id: 'github',
    name: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    job: 'Code and issues',
    lands: 'Adds your commits, pull requests and issues as linked notes, and opens issues, comments and pull requests you approve.',
    try: 'My PRs to review',
    featured: true,
    signIn: 'oauth',
    keyHint: 'Or paste a GitHub personal access token.',
    cost: 'Uses your GitHub account',
    recipe: {
      rounds: 1,
      calls: 3,
      intents: [
        { key: 'repo-commits', label: 'Latest commits', needs: ['owner', 'repo'], missing: REPO, keywords: ['\\bcommits?\\b.*\\b[A-Za-z0-9-]+/[A-Za-z0-9._-]+', '\\b[A-Za-z0-9-]+/[A-Za-z0-9._-]+\\b.*\\bcommits?\\b'],
          steps: [{ tool: 'list_commits', args: { owner: '{owner}', repo: '{repo}', perPage: 5 } }], output: COMMIT_NOTE },
        { key: 'org-commits', label: 'My latest commits', needs: ['org'], missing: 'Try naming the organization ("in the acme org").', keywords: ['\\b(my|i)\\b.*\\bcommits?\\b.*\\b(org|organi[sz]ation)\\b'],
          steps: [
            { tool: 'get_me', args: {}, extract: { login: 'login' } },
            { tool: 'search_repositories', args: { query: 'org:{org}', sort: 'updated', perPage: 3 }, extract: { repos: 'items[0..2].full_name' } },
            { tool: 'list_commits', each: 'repos', args: { owner: '{owner}', repo: '{repo}', author: '{login}', perPage: 5 } },
          ],
          output: COMMIT_NOTE },
        // "My" is the signed-in person (get_me); their repositories are their own most recently
        // updated ones and the ones their latest pull requests are in (organization repositories
        // too), taken in turn; their commits in those, newest first across all of them.
        { key: 'my-commits', label: 'My latest commits', missing: 'Try naming the repository (owner/name).', keywords: ['\\b(my|i|me)\\b.*\\bcommits?\\b', '\\bcommits?\\b.*\\b(i|me) (made|pushed|wrote)\\b', '^\\s*(latest|recent) commits?\\b'],
          steps: [
            { tool: 'get_me', args: {}, extract: { login: 'login' } },
            { tool: 'search_repositories', args: { query: 'user:{login}', sort: 'updated', perPage: 3 }, extract: { repos: 'items[0..2].full_name' } },
            { tool: 'search_pull_requests', args: { query: 'is:pr involves:{login}', sort: 'updated', perPage: 6 }, extract: { repos: PR_REPOS }, merge: true },
            { tool: 'list_commits', each: 'repos', args: { owner: '{owner}', repo: '{repo}', author: '{login}', perPage: 5 } },
          ],
          output: COMMIT_NOTE },
        { key: 'prs-to-review', label: 'Pull requests to review', keywords: ['\\b(prs?|pull requests?)\\b.*\\breview', '\\breview\\b.*\\b(prs?|pull requests?)\\b'],
          steps: [{ tool: 'search_pull_requests', args: { query: 'is:open is:pr review-requested:@me', perPage: 6 } }], output: ITEM_NOTE('Pull requests to review') },
        { key: 'prs-touching', label: 'Open pull requests', needs: ['topic'], keywords: ['\\b(prs?|pull requests?)\\b.*\\b(touch|about|mention)'],
          steps: [{ tool: 'search_pull_requests', args: { query: 'is:open is:pr {topic}', perPage: 6 } }], output: ITEM_NOTE('Open pull requests') },
        { key: 'my-prs', label: 'My open pull requests', keywords: ['\\bmy (open |latest |recent )?(prs?|pull requests?)\\b'],
          steps: [{ tool: 'search_pull_requests', args: { query: 'is:open is:pr author:@me', perPage: 6 } }], output: ITEM_NOTE('My open pull requests') },
        { key: 'issues-assigned', label: 'Issues assigned to me', keywords: ['\\bissues?\\b.*\\b(assigned|for) (to )?me\\b', '\\bmy (open )?issues\\b'],
          steps: [{ tool: 'search_issues', args: { query: 'is:open is:issue assignee:@me', perPage: 6 } }], output: ITEM_NOTE('Issues assigned to me') },
      ],
      writes: [
        { key: 'create-issue', label: 'Open GitHub issue', tool: ['issue_write', 'create_issue'], keywords: [ISSUE_WORDS], args: { method: 'create' }, fields: { title: ['title'], body: ['body'], target: ['owner', 'repo'] } },
        { key: 'comment', label: 'Comment on GitHub', tool: ['add_issue_comment'], keywords: [COMMENT_WORDS], fields: { body: ['body'], item: ['issue_number'], target: ['owner', 'repo'] } },
        // Only where the server offers it, and from a branch that already exists (head): Slatebox never pushes code.
        { key: 'create-pr', label: 'Open GitHub pull request', tool: ['create_pull_request'], keywords: ['\\b(open|create|make|raise)\\b.*\\b(prs?|pull requests?)\\b'], fields: { title: ['title'], body: ['body'], target: ['owner', 'repo', 'head', 'base'] } },
      ],
      tools: { merge_pull_request: 'destructive', delete_file: 'destructive', push_files: 'destructive', create_or_update_file: 'destructive' },
    },
  },
  {
    id: 'linear',
    name: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    aliases: ['https://mcp.linear.app/mcp/readonly'],
    job: 'Issues',
    lands: 'Brings your team\'s issues and cycles onto the slate as linked notes, and files issues, comments and status changes you approve.',
    try: 'What is in the current cycle?',
    featured: true,
    signIn: 'oauth',
    cost: 'Uses your Linear account',
    recipe: {
      rounds: 1,
      calls: 2,
      intents: [],
      writes: [
        { key: 'create-issue', label: 'Create Linear issue', tool: ['create_issue', 'save_issue'], keywords: [ISSUE_WORDS], fields: { title: ['title'], body: ['description'], target: ['team', 'teamId', 'project', 'projectId'] } },
        { key: 'comment', label: 'Comment on Linear issue', tool: ['create_comment', 'save_comment'], keywords: [COMMENT_WORDS], fields: { body: ['body'], item: ['issueId', 'issue', 'id'] } },
        { key: 'update-status', label: 'Update Linear issue status', tool: ['update_issue', 'save_issue'], keywords: ['\\b(mark|move|set|change|update)\\b.*\\b(done|status|state|in progress|todo|backlog|canceled|cancelled|started)\\b'], fields: { item: ['id', 'issueId'], target: ['state', 'stateId', 'status'], title: ['title'] } },
      ],
    },
  },
  {
    id: 'deepwiki',
    name: 'DeepWiki',
    url: 'https://mcp.deepwiki.com/mcp',
    job: 'Code Q&A',
    lands: 'Answers questions about a public GitHub repository, as notes with a link.',
    try: 'How does routing work in vercel/next.js?',
    cost: 'Free',
    recipe: {
      rounds: 1,
      calls: 1,
      intents: [
        { key: 'repo-parts', label: 'Parts of the repository', needs: ['fullName'], missing: REPO, keywords: ['\\b(parts|structure|modules|overview|sections)\\b.*\\b[A-Za-z0-9-]+/[A-Za-z0-9._-]+'],
          steps: [{ tool: 'read_wiki_structure', args: { repoName: '{fullName}' } }] },
        { key: 'repo-question', label: 'Answer', needs: ['fullName'], missing: REPO, keywords: ['\\b[A-Za-z0-9-]+/[A-Za-z0-9._-]+\\b'],
          steps: [{ tool: ['ask_question', 'ask_wiki_question'], args: { repoName: '{fullName}', question: '{request}' } }] },
      ],
    },
  },
  {
    id: 'context7',
    name: 'Context7',
    url: 'https://mcp.context7.com/mcp',
    job: 'Library docs',
    lands: 'Adds current docs for the libraries named in your notes.',
    try: 'How do I use React useEffect cleanup?',
    cost: 'Free tier',
    recipe: {
      rounds: 1,
      calls: 2,
      intents: [
        { key: 'docs', label: 'Docs', keywords: ['.'],
          steps: [
            { tool: 'resolve-library-id', args: 'plan', extract: { libraryId: 're:Context7-compatible library ID:\\s*(/[A-Za-z0-9._/-]+)' } },
            { tool: ['query-docs', 'get-library-docs'], args: { libraryId: '{libraryId}', context7CompatibleLibraryID: '{libraryId}', query: '{request}', topic: '{request}' } },
          ] },
      ],
    },
  },
  { id: 'wolfram', name: 'Wolfram', url: 'https://agenttools.wolfram.com/mcp', job: 'Math and facts', lands: 'Adds computed facts and unit math as notes.', try: 'How far is the Moon in km?', cost: 'Free', recipe: { rounds: 1, calls: 1, intents: [] } },
  { id: 'firecrawl', name: 'Firecrawl', url: 'https://mcp.firecrawl.dev/v2/mcp', job: 'Web pages', lands: 'Reads a web page and adds a summary note with its link.', try: 'Summarize https://example.com', cost: 'Free tier', recipe: { rounds: 1, calls: 1, intents: [] } },
  { id: 'exa', name: 'Exa', url: 'https://mcp.exa.ai/mcp', job: 'Research', lands: 'Finds sources on your question, each a note with a quote and link.', try: 'How do others retry declined cards?', cost: 'Free tier', recipe: { rounds: 1, calls: 1, intents: [] } },
])

// Native integrations: built into Slatebox (no MCP address), connected on the Integrations page and
// invited onto slates like any agent. Administrators turn one on or off and edit its words in
// /admin/ai › Gallery (its address never changes). Google Drive reads only the files a person picks
// for a slate (drive.file scope: enterprise/server/google/google.mjs).
export const NATIVE_ADDRESSES = Object.freeze({ googledrive: 'google://drive' })
export const NATIVE_CARDS = Object.freeze([
  {
    id: 'googledrive',
    kind: 'native',
    name: 'Google Drive',
    url: NATIVE_ADDRESSES.googledrive,
    job: 'Your Drive files',
    lands: 'Reads the Drive files you pick for a slate and adds notes that link back to them.',
    try: 'Summarize the picked files',
    signIn: 'google',
    cost: 'Uses your Google account',
    recipe: { rounds: 1, calls: 2, intents: [] },
  },
])

// Card words the built-in cards said before agents read and write (owner, 2026-11-24). A saved edit
// that is still one of these is the old default, not an administrator's choice: the card's current
// words are served instead (enterprise/server/gallery-admin.mjs liveGallery).
export const RETIRED_WORDS = Object.freeze({
  linear: Object.freeze({ lands: Object.freeze(['Brings your team\'s issues and cycles onto the slate as linked notes. Reads only.']) }),
  github: Object.freeze({ lands: Object.freeze(['Adds your commits, pull requests and issues as linked notes, one per item.']) }),
})

/**
 * Where an agent connected at a card's other address makes changes: the card's own address, when
 * the stored one is an alias (Linear's read-only address). null when it is the card's address already.
 */
export function writesAddress(address, cards = GALLERY) {
  const card = cardFor(address, cards)
  const canonical = canonicalAddress(address)
  if (!card || !canonical || canonicalAddress(card.url) === canonical) return null
  return card.recipe?.writes?.length ? card.url : null
}

// Listed once, no longer in the gallery: an invited copy keeps working (any MCP address does), it
// is just not offered. Shown in /admin/ai › Gallery so an administrator sees why.
export const RETIRED = Object.freeze([
  { id: 'excalidraw', name: 'Excalidraw', url: 'https://mcp.excalidraw.com/mcp', why: 'Slatebox draws diagrams itself; bring your own drawings in with Import from Excalidraw.' },
  { id: 'apexcharts', name: 'ApexCharts', url: 'https://mcp.apexcharts.com/mcp', why: 'It answers chart configurations only; back when Slatebox has a chart note.' },
])

/** The address as stored and compared: https, no trailing slash, no query or fragment. */
export function canonicalAddress(raw) {
  let url
  try {
    url = new URL(String(raw || '').trim())
  } catch {
    return null
  }
  url.hash = ''
  url.search = ''
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${url.host.toLowerCase()}${path}`
}

/** The gallery card a pasted address is, or null (cards: the live gallery, else the built-in one). */
export const cardFor = (address, cards = GALLERY) => {
  const canonical = canonicalAddress(address)
  if (!canonical) return null
  return cards.find((card) => canonicalAddress(card.url) === canonical) || cards.find((card) => (card.aliases || []).some((alias) => canonicalAddress(alias) === canonical)) || null
}

/** The retired listing an address is (an invited copy still works; its chip says why it is not listed), or null. */
export const retiredFor = (address) => {
  const canonical = canonicalAddress(address)
  return canonical ? RETIRED.find((card) => canonicalAddress(card.url) === canonical) || null : null
}

/** Which gallery card ids are already on this slate (invited agents, as connectors.list gives them). */
export const invitedCards = (connections = []) => new Set(connections.filter((c) => c && c.status !== 'removed' && c.galleryId).map((c) => c.galleryId))

/** Hosts that look like they stand for another (punycode, mixed scripts): a warning in the walkthrough. */
export function lookalikeHost(address) {
  try {
    const host = new URL(address).hostname
    return host.split('.').some((label) => label.startsWith('xn--')) || /[^\x00-\x7f]/.test(host)
  } catch {
    return false
  }
}

// Gateways and listings known to be gone: plain words instead of a confusing failure.
export const DEAD_HOSTS = Object.freeze(['server.smithery.ai'])
