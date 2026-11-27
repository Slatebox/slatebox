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
// The words of a few common changes, each tried on a clause that starts with its verb.
const PAGE_WORDS = '^(create|write|draft|add|make|start|publish)\\b.*\\b(pages?|docs?|specs?|wiki)\\b'
const TASK_WORDS = '^(create|add|make|file|log|track|remind)\\b.*\\b(tasks?|to-?dos?|reminders?)\\b'
const STATUS_WORDS = '^(mark|move|set|change|update|transition)\\b.*\\b(done|status|state|in progress|to do|todo|review|blocked)\\b'
// Words of a lookup.
// An ask that reads (a question, or a verb that looks up or lays out): a server's broad ask uses this,
// never "any words", so a request for a change is not also sent a search first.
const ASK_WORDS = '^\\s*(what|which|who|when|where|how|why|is|are|do|does|did|find|search|show|list|bring|get|look|summari[sz]e|pull|put|map|lay out|group|compare|count)\\b|\\?\\s*$'
const FIND_WORDS = '\\b(find|search|look up|look for|bring in|show)\\b'
const MY_TASK_WORDS = '\\bmy (open |overdue )?tasks\\b'
/**
 * A known ask whose tool is fixed and whose arguments the planner fills from the request (args
 * 'plan'): the first of the tools this agent may use wins, and a server with none of them is planned
 * as usual. For servers whose argument names are theirs to change.
 */
const ask = (key, label, keywords, tool) => ({ key, label, keywords, steps: [{ tool, args: 'plan' }] })

const LISTED = [
  {
    id: 'huggingface',
    group: 'research',
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
    group: 'dev',
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
      // About you › Use GitHub to personalize: who they are, their latest repositories, their open issues.
      lookAround: { steps: [
        { tool: 'get_me', args: {}, extract: { login: 'login' } },
        { tool: 'search_repositories', args: { query: 'user:{login}', sort: 'updated', perPage: 5 } },
        { tool: 'search_issues', args: { query: 'is:open assignee:@me', perPage: 5 } },
      ] },
    },
  },
  {
    id: 'linear',
    group: 'work',
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
      intents: [
        ask('my-issues', 'My issues', ['\\bmy (open |latest |recent )?issues\\b', '\\bissues?\\b.*\\bassigned to me\\b'], ['list_my_issues', 'list_issues']),
        ask('cycle', 'Current cycle', ['\\b(cycles?|sprints?)\\b'], ['list_cycles', 'list_issues']),
        ask('projects', 'Linear projects', ['\\b(projects?|roadmap)\\b'], ['list_projects']),
      ],
      writes: [
        { key: 'create-issue', label: 'Create Linear issue', tool: ['create_issue', 'save_issue'], keywords: [ISSUE_WORDS], fields: { title: ['title'], body: ['description'], target: ['team', 'teamId', 'project', 'projectId'] } },
        { key: 'comment', label: 'Comment on Linear issue', tool: ['create_comment', 'save_comment'], keywords: [COMMENT_WORDS], fields: { body: ['body'], item: ['issueId', 'issue', 'id'] } },
        { key: 'update-status', label: 'Update Linear issue status', tool: ['update_issue', 'save_issue'], keywords: ['\\b(mark|move|set|change|update)\\b.*\\b(done|status|state|in progress|todo|backlog|canceled|cancelled|started)\\b'], fields: { item: ['id', 'issueId'], target: ['state', 'stateId', 'status'], title: ['title'] } },
      ],
      lookAround: { steps: [{ tool: 'list_teams', args: {} }, { tool: 'list_projects', args: { limit: 5 } }, { tool: ['list_my_issues', 'list_issues'], args: { assignee: 'me', limit: 5 } }] },
    },
  },
  {
    id: 'deepwiki',
    group: 'research',
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
    group: 'research',
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
  { id: 'wolfram', group: 'web', name: 'Wolfram', url: 'https://agenttools.wolfram.com/mcp', job: 'Math and facts', lands: 'Adds computed facts and unit math as notes.', try: 'How far is the Moon in km?', cost: 'Free', recipe: { rounds: 1, calls: 1, intents: [] } },
  { id: 'firecrawl', group: 'web', name: 'Firecrawl', url: 'https://mcp.firecrawl.dev/v2/mcp', job: 'Web pages', lands: 'Reads a web page and adds a summary note with its link.', try: 'Summarize https://example.com', cost: 'Free tier', recipe: { rounds: 1, calls: 1, intents: [] } },
  { id: 'exa', group: 'web', name: 'Exa', url: 'https://mcp.exa.ai/mcp', job: 'Research', lands: 'Finds sources on your question, each a note with a quote and link.', try: 'How do others retry declined cards?', cost: 'Free tier', recipe: { rounds: 1, calls: 1, intents: [] } },
  // Added 2026-11-24 (owner: "more agents we can connect to"). Each address answered an MCP
  // initialize the same day; the sign-in ones advertised protected-resource metadata. Their known
  // asks (intents) were filled in 2026-11-26 from each server's published tools: a step whose tool
  // is fixed and whose arguments the planner fills from the request (args 'plan'), or fixed steps
  // where the arguments are known. A server that offers none of a step's tools falls back to the
  // planner, so a renamed tool costs a planning round, never an answer.
  {
    id: 'notion', group: 'workspace', name: 'Notion', url: 'https://mcp.notion.com/mcp', job: 'Docs and wikis',
    lands: 'Brings your team\'s Notion pages, wikis and database rows onto the slate, and creates or updates pages and comments you approve.',
    try: 'Bring in the onboarding wiki page, grouped by section', signIn: 'oauth', cost: 'Uses your Notion account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('page', 'Notion page', ['notion\\.(so|site)/'], ['notion-fetch', 'fetch']),
        ask('search', 'From Notion', [FIND_WORDS, '\\b(pages?|wikis?|docs?|databases?)\\b'], ['notion-search', 'search']),
      ],
      writes: [
        { key: 'create-page', label: 'Create Notion page', tool: ['notion-create-pages', 'create-pages'], keywords: [PAGE_WORDS], fields: { title: ['title'], body: ['content'], target: ['parent'] } },
        { key: 'comment', label: 'Comment in Notion', tool: ['notion-create-comment', 'create-comment'], keywords: [COMMENT_WORDS], fields: { body: ['rich_text', 'content'], item: ['page_id', 'parent'] } },
      ],
      lookAround: { steps: [{ tool: ['notion-get-teams', 'get-teams'], args: {} }, { tool: ['notion-search', 'search'], args: { query: 'project' } }] },
    },
  },
  // Deletes sit in their own tool on Atlassian's server: off until someone turns them on. Loom and
  // Bitbucket Cloud have no server of their own: their tools come with this one (v2). The v1
  // addresses are older ones of the same server (no sign-in details there any more): an agent
  // invited at one is this card, and writesAddress moves it to v2.
  {
    id: 'atlassian', group: 'work', name: 'Jira, Confluence and Loom', url: 'https://mcp.atlassian.com/v2/mcp',
    aliases: ['https://mcp.atlassian.com/v1/mcp', 'https://mcp.atlassian.com/v1/sse'], job: 'Tickets, specs and videos',
    lands: 'Brings Jira issues, sprints, Confluence pages, Loom videos and Bitbucket repositories onto the slate, and creates tickets, status changes and pages you approve.',
    try: 'Show the open tickets in the PAY epic, grouped by status', signIn: 'oauth', cost: 'Uses your Atlassian account',
    recipe: {
      rounds: 1, calls: 3,
      intents: [
        { key: 'my-issues', label: 'Jira issues assigned to me', keywords: ['\\bmy (open )?(tickets|issues|jira)\\b', '\\b(tickets?|issues?)\\b.*\\bassigned to me\\b'],
          steps: [
            { tool: 'getAccessibleAtlassianResources', args: {}, extract: { cloudId: '[0].id' } },
            { tool: 'searchJiraIssuesUsingJql', args: { cloudId: '{cloudId}', jql: 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC', maxResults: 10 } },
          ] },
        { key: 'jira', label: 'Jira issues', keywords: ['\\b(jira|tickets?|epics?|sprints?|backlog)\\b'],
          steps: [{ tool: 'getAccessibleAtlassianResources', args: {}, extract: { cloudId: '[0].id' } }, { tool: 'searchJiraIssuesUsingJql', args: 'plan' }] },
        { key: 'confluence', label: 'Confluence pages', keywords: ['\\b(confluence|specs?|wiki)\\b'],
          steps: [{ tool: 'getAccessibleAtlassianResources', args: {}, extract: { cloudId: '[0].id' } }, { tool: 'searchConfluenceUsingCql', args: 'plan' }] },
        ask('search', 'From Atlassian', [FIND_WORDS, '\\b(loom|videos?|bitbucket|repositor(y|ies))\\b'], ['search']),
      ],
      writes: [
        { key: 'create-issue', label: 'Create Jira issue', tool: ['createJiraIssue'], keywords: [ISSUE_WORDS], fields: { title: ['summary'], body: ['description'], target: ['projectKey', 'issueTypeName'] } },
        { key: 'comment', label: 'Comment on Jira issue', tool: ['addCommentToJiraIssue'], keywords: [COMMENT_WORDS], fields: { body: ['commentBody'], item: ['issueIdOrKey'] } },
        { key: 'transition', label: 'Move Jira issue', tool: ['transitionJiraIssue'], keywords: [STATUS_WORDS], fields: { item: ['issueIdOrKey'], target: ['transition'] } },
        { key: 'create-page', label: 'Create Confluence page', tool: ['createConfluencePage'], keywords: [PAGE_WORDS], fields: { title: ['title'], body: ['body'], target: ['spaceId'] } },
      ],
      tools: { executeDestructive: 'destructive' },
      lookAround: { steps: [
        { tool: 'atlassianUserInfo', args: {} },
        { tool: 'getAccessibleAtlassianResources', args: {}, extract: { cloudId: '[0].id' } },
        { tool: 'searchJiraIssuesUsingJql', args: { cloudId: '{cloudId}', jql: 'assignee = currentUser() ORDER BY updated DESC', maxResults: 5 } },
      ] },
    },
  },
  {
    id: 'granola', group: 'workspace', name: 'Granola', url: 'https://mcp.granola.ai/mcp', job: 'Meeting notes',
    lands: 'Brings the notes and transcripts of your meetings onto the slate for retros and decision maps. It only reads.',
    try: 'Put the action items from yesterday\'s planning call on the slate', signIn: 'oauth', cost: 'Uses your Granola account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('transcript', 'Transcript', ['\\btranscripts?\\b'], ['get_meeting_transcript']),
        ask('meetings', 'Meetings', [ASK_WORDS], ['query_granola_meetings', 'list_meetings', 'get_meetings']),
      ],
      lookAround: { steps: [{ tool: ['list_meetings', 'get_meetings'], args: {} }] },
    },
  },
  {
    id: 'asana', needsApp: 'asana', group: 'work', name: 'Asana', url: 'https://mcp.asana.com/v2/mcp', job: 'Projects and tasks',
    lands: 'Brings Asana projects, tasks and goals onto the slate, and creates or updates tasks and comments you approve.',
    try: 'Show the overdue tasks in the Website Relaunch project', signIn: 'oauth', cost: 'Uses your Asana account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('my-tasks', 'My tasks', [MY_TASK_WORDS], ['get_my_tasks', 'asana_get_my_tasks', 'search_tasks']),
        ask('goals', 'Goals', ['\\bgoals?\\b'], ['get_goals', 'asana_get_goals']),
        ask('search', 'From Asana', [ASK_WORDS], ['search_tasks', 'asana_search_tasks', 'search_objects', 'asana_typeahead_search']),
      ],
      writes: [
        { key: 'create-task', label: 'Create Asana task', tool: ['create_task', 'asana_create_task'], keywords: [TASK_WORDS], fields: { title: ['name'], body: ['notes'], target: ['projects', 'project', 'workspace'] } },
        { key: 'comment', label: 'Comment on Asana task', tool: ['create_task_story', 'add_comment', 'asana_create_task_story'], keywords: [COMMENT_WORDS], fields: { body: ['text'], item: ['task_gid', 'task_id'] } },
      ],
      lookAround: { steps: [{ tool: ['get_me', 'asana_get_me', 'get_user'], args: {} }, { tool: ['get_projects', 'asana_get_projects', 'list_projects'], args: { limit: 5 } }] },
    },
  },
  {
    id: 'monday', group: 'work', name: 'monday.com', url: 'https://mcp.monday.com/mcp', job: 'Boards and CRM',
    lands: 'Brings monday boards, items and CRM records onto the slate, and creates items and groups or changes values you approve.',
    try: 'Bring the Marketing Calendar board in, grouped by status', signIn: 'oauth', cost: 'Uses your monday.com account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('board', 'Board items', ['\\b(boards?|items?|groups?)\\b'], ['get_board_items_page', 'get_board_items_by_name', 'get_board_info']),
        ask('search', 'From monday.com', [ASK_WORDS], ['search', 'get_board_items_by_name']),
      ],
      writes: [
        { key: 'create-item', label: 'Create monday item', tool: ['create_item'], keywords: ['^(create|add|make|log|track)\\b.*\\b(items?|tasks?|rows?|leads?)\\b'], fields: { title: ['name', 'itemName'], target: ['boardId', 'groupId'] } },
      ],
      lookAround: { steps: [{ tool: ['list_workspaces', 'get_workspaces'], args: {} }] },
    },
  },
  {
    id: 'clickup', group: 'work', name: 'ClickUp', url: 'https://mcp.clickup.com/mcp', job: 'Tasks and docs',
    lands: 'Brings ClickUp tasks, docs and time tracked onto the slate, and creates or updates tasks and docs you approve.',
    try: 'Show this sprint\'s tasks tagged bug', signIn: 'oauth', cost: 'Uses your ClickUp account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('docs', 'ClickUp docs', ['\\bdocs?\\b'], ['clickup_search', 'search']),
        ask('tasks', 'ClickUp tasks', [ASK_WORDS], ['clickup_filter_tasks', 'clickup_search', 'search']),
      ],
      writes: [
        { key: 'create-task', label: 'Create ClickUp task', tool: ['clickup_create_task', 'create_task'], keywords: [TASK_WORDS], fields: { title: ['name'], body: ['description', 'markdown_description'], target: ['list_id', 'listId'] } },
      ],
      // "filter" reads here: it only narrows the task list.
      tools: { clickup_filter_tasks: 'lookup' },
      lookAround: { steps: [{ tool: ['clickup_get_workspace_hierarchy', 'get_workspace_hierarchy'], args: {} }] },
    },
  },
  {
    id: 'trello', group: 'work', name: 'Trello', url: 'https://mcp.trello.com/v1', job: 'Kanban boards',
    lands: 'Brings Trello boards, lists and cards onto the slate, and creates or moves cards you approve.',
    try: 'Bring our Content board onto the slate', signIn: 'oauth', cost: 'Uses your Trello account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [ask('board', 'Trello cards', [ASK_WORDS], ['get_board_cards', 'get_cards_by_list_id', 'get_board', 'list_boards'])],
      writes: [
        { key: 'create-card', label: 'Create Trello card', tool: ['create_card', 'add_card_to_list'], keywords: ['^(create|add|make)\\b.*\\bcards?\\b'], fields: { title: ['name'], body: ['desc', 'description'], target: ['listId', 'idList'] } },
        { key: 'move-card', label: 'Move Trello card', tool: ['move_card'], keywords: ['^(move)\\b.*\\bcards?\\b'], fields: { item: ['cardId'], target: ['listId', 'idList'] } },
      ],
      lookAround: { steps: [{ tool: ['list_boards', 'get_boards', 'get_my_boards'], args: {} }] },
    },
  },
  {
    id: 'airtable', group: 'work', name: 'Airtable', url: 'https://mcp.airtable.com/mcp', job: 'Team databases',
    lands: 'Brings records from your Airtable bases onto the slate, such as content calendars and trackers, and adds or edits records you approve.',
    try: 'Put this month\'s content calendar on the slate', signIn: 'oauth', keyHint: 'Or paste an Airtable personal access token.', cost: 'Uses your Airtable account',
    recipe: {
      rounds: 1, calls: 3,
      intents: [ask('records', 'Airtable records', [ASK_WORDS], ['list_records', 'search_records'])],
      writes: [
        { key: 'create-record', label: 'Add Airtable record', tool: ['create_record', 'create_records'], keywords: ['^(add|create|log|append|insert)\\b.*\\b(records?|rows?|entry|entries)\\b'], fields: { title: ['fields'], target: ['baseId', 'tableId'] } },
      ],
      lookAround: { steps: [{ tool: ['list_bases'], args: {} }] },
    },
  },
  // Zapier's tools are the actions each person enabled there, so it has no fixed asks: the planner
  // reads their own descriptions.
  { id: 'zapier', group: 'work', name: 'Zapier', url: 'https://mcp.zapier.com/api/v1/connect', job: 'Thousands of apps', lands: 'Reaches the apps your team set up in Zapier, and runs each action you approve, such as adding a row or sending an email.', try: 'Append each note as a row in the Feedback sheet', signIn: 'oauth', cost: 'Uses your Zapier account', recipe: { rounds: 1, calls: 2, intents: [] } },
  {
    id: 'hubspot', needsApp: 'hubspot', group: 'business', name: 'HubSpot', url: 'https://mcp.hubspot.com', job: 'Customers and deals',
    lands: 'Brings HubSpot contacts, companies, deals and tickets onto the slate for account and pipeline reviews, and updates records you approve.',
    try: 'Show the deals closing this quarter by stage', signIn: 'oauth', cost: 'Uses your HubSpot account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('deals', 'Deals', ['\\b(deals?|pipeline|forecast)\\b'], ['search_crm_objects', 'hubspot-search-objects', 'search_objects']),
        ask('records', 'From HubSpot', [ASK_WORDS], ['search_crm_objects', 'hubspot-search-objects', 'search_objects']),
      ],
      lookAround: { steps: [{ tool: ['get_user_details', 'hubspot-get-user-details'], args: {} }] },
    },
  },
  // Refunds are a payment that leaves the account: off until someone turns them on (cancel_* already is).
  {
    id: 'stripe', group: 'business', name: 'Stripe', url: 'https://mcp.stripe.com', job: 'Revenue and billing',
    lands: 'Brings customers, subscriptions, invoices and payments onto the slate for business reviews, and creates invoices or payment links you approve.',
    try: 'List our ten largest customers by revenue', signIn: 'oauth', keyHint: 'Or paste a Stripe restricted key.', cost: 'Uses your Stripe account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('subscriptions', 'Subscriptions', ['\\bsubscriptions?\\b'], ['list_subscriptions']),
        ask('invoices', 'Invoices', ['\\binvoices?\\b'], ['list_invoices']),
        ask('balance', 'Balance', ['\\bbalance\\b'], ['retrieve_balance']),
        ask('disputes', 'Disputes', ['\\bdisputes?\\b'], ['list_disputes']),
        ask('customers', 'Customers', ['\\bcustomers?\\b'], ['list_customers']),
        ask('payments', 'Payments', ['\\b(payments?|charges?|revenue)\\b'], ['list_payment_intents']),
      ],
      writes: [
        { key: 'invoice', label: 'Create Stripe invoice', tool: ['create_invoice'], keywords: ['^(create|send|draft|make|bill)\\b.*\\binvoices?\\b'], fields: { target: ['customer'] } },
        { key: 'payment-link', label: 'Create Stripe payment link', tool: ['create_payment_link'], keywords: ['^(create|make|generate)\\b.*\\bpayment links?\\b'], fields: { target: ['price', 'quantity'] } },
      ],
      tools: { create_refund: 'destructive' },
    },
  },
  {
    id: 'posthog', group: 'business', name: 'PostHog', url: 'https://mcp.posthog.com/mcp', job: 'Product numbers',
    lands: 'Brings product trends, funnels, feature flags and experiments onto the slate, and changes flags or insights you approve.',
    try: 'Show the onboarding funnel and where people drop off', signIn: 'oauth', keyHint: 'Or paste a PostHog personal API key.', cost: 'Uses your PostHog account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('flags', 'Feature flags', ['\\b(feature )?flags?\\b'], ['feature-flag-get-all', 'feature-flags-list']),
        ask('experiments', 'Experiments', ['\\bexperiments?\\b'], ['experiment-get-all', 'experiments-list']),
        ask('errors', 'Errors', ['\\b(errors?|exceptions?)\\b'], ['list-errors', 'error-tracking-issues-list']),
        ask('dashboards', 'Dashboards', ['\\bdashboards?\\b'], ['dashboards-get-all', 'dashboards-list']),
        ask('numbers', 'Product numbers', ['\\b(funnels?|trends?|insights?|retention|drop off|conversion|signups?|active users)\\b'], ['query-run', 'insight-query']),
      ],
      // "run" reads here: query-run runs a read-only query of the events.
      tools: { 'query-run': 'lookup' },
    },
  },
  {
    id: 'sentry', group: 'dev', name: 'Sentry', url: 'https://mcp.sentry.dev/mcp', job: 'Production errors',
    lands: 'Brings live errors, stack traces and releases onto the slate for incident triage, and changes an issue\'s status or owner when you approve.',
    try: 'What are the top new errors since yesterday\'s release?', signIn: 'oauth', cost: 'Uses your Sentry account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('issues', 'Errors', ['\\b(errors?|issues?|exceptions?|crash(es)?|bugs?)\\b'], ['search_issues', 'search_events']),
        ask('releases', 'Releases', ['\\breleases?\\b'], ['find_releases']),
        ask('projects', 'Sentry projects', ['\\bprojects?\\b'], ['find_projects']),
      ],
      writes: [
        { key: 'update', label: 'Update Sentry issue', tool: ['update_issue'], keywords: ['^(resolve|assign|ignore|mark|set|change|update)\\b.*\\b(issues?|errors?|status|owner|resolved)\\b'], fields: { item: ['issueId', 'issueUrl'], target: ['status', 'assignedTo'] } },
      ],
      lookAround: { steps: [{ tool: 'whoami', args: {} }, { tool: 'find_organizations', args: {} }] },
    },
  },
  {
    id: 'jina',
    group: 'research',
    name: 'Jina',
    url: 'https://mcp.jina.ai/v1',
    job: 'Papers and PDFs',
    lands: 'Finds papers on arXiv and SSRN and reads any web page or PDF, as notes with a link. It only reads.',
    try: 'Find recent papers on remote team productivity',
    cost: 'Free',
    recipe: {
      rounds: 1,
      calls: 1,
      // search_arxiv and search_ssrn take the question as their query (tools/list, 2026-11-24).
      intents: [
        { key: 'papers', label: 'Papers', keywords: ['\\b(papers?|preprints?|arxiv|studies|study|research)\\b'],
          steps: [{ tool: ['search_arxiv', 'search_ssrn'], args: { query: '{request}' } }] },
      ],
      // Its server sends no annotations, and these names read as changes; each only reads or
      // reshapes what it is given, so none should wait on a card (checked against its tools, 2026-11-24).
      tools: { primer: 'lookup', guess_datetime_url: 'lookup', capture_screenshot_url: 'lookup', sort_by_relevance: 'lookup', deduplicate_strings: 'lookup' },
    },
  },
  { id: 'parallel', group: 'web', name: 'Parallel', url: 'https://mcp.parallel.ai/mcp', job: 'Web search', lands: 'Searches and reads the live web with no account, and adds what it finds as notes with their sources. It only reads.', try: 'What are competitors charging for team plans?', cost: 'Free', recipe: { rounds: 1, calls: 2, intents: [] } },
  // Added 2026-11-26 (owner: "GitHub, Linear, Notion, Jira, Slack, Sentry, Microsoft, Google, Miro,
  // Figma, Canva, Adobe, Replit, Lovable ... all MCP servers are welcome"). Each is the vendor's own
  // remote server; every address was probed the same day and answered with MCP sign-in metadata
  // (protected resource metadata and an authorization server), or answered openly. Miro, Figma and
  // Canva are listed for a person's own boards and designs, not for drawing what Slatebox draws.
  // needsApp: the vendor offers no open automatic registration (no DCR anyone may use, no CIMD;
  // Salesforce's registration needs an initial access token), so the card shows once
  // an operator registers an app (settings.connectors.oauthApps.<provider>: docs/integrations.md).
  // Writes that move money, run code or SQL, or send to a whole list start off (tools: 'destructive').

  // ---- Developer tools ----
  {
    id: 'gitlab', group: 'dev', name: 'GitLab', url: 'https://gitlab.com/api/v4/mcp', job: 'Code and merge requests',
    lands: 'Brings GitLab issues, merge requests and pipelines onto the slate as linked notes, and opens issues and comments you approve.',
    try: 'Which merge requests are waiting on my review?', signIn: 'oauth', cost: 'Uses your GitLab account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('pipelines', 'Pipelines', ['\\b(pipelines?|jobs?|builds?|ci)\\b'], ['get_pipeline_jobs', 'get_merge_request_pipelines']),
        ask('search', 'From GitLab', [ASK_WORDS], ['gitlab_search', 'search']),
      ],
      writes: [
        { key: 'create-issue', label: 'Open GitLab issue', tool: ['create_issue'], keywords: [ISSUE_WORDS], fields: { title: ['title'], body: ['description'], target: ['id', 'project_id'] } },
        { key: 'comment', label: 'Comment on GitLab', tool: ['create_workitem_note', 'create_note'], keywords: [COMMENT_WORDS], fields: { body: ['body'], item: ['work_item_iid', 'iid'] } },
      ],
      // "merge" in a name that only reads a merge request's pipelines.
      tools: { get_merge_request_pipelines: 'lookup', get_merge_request: 'lookup', get_merge_request_commits: 'lookup', get_merge_request_diffs: 'lookup' },
    },
  },
  {
    id: 'vercel', group: 'dev', name: 'Vercel', url: 'https://mcp.vercel.com', job: 'Deploys and projects',
    lands: 'Brings your Vercel projects, deployments and build logs onto the slate for release reviews and incident triage.',
    try: 'Why did the last production deploy fail?', signIn: 'oauth', cost: 'Uses your Vercel account',
    recipe: {
      rounds: 1, calls: 3,
      intents: [
        ask('logs', 'Build logs', ['\\b(logs?|fail(ed|ing|ure)?|broke|error)\\b'], ['get_deployment_build_logs']),
        ask('deployments', 'Deployments', ['\\b(deploy(s|ments?)?|releases?)\\b'], ['list_deployments']),
        ask('projects', 'Vercel projects', ['\\bprojects?\\b'], ['list_projects']),
        ask('docs', 'Vercel docs', [ASK_WORDS], ['search_vercel_documentation', 'search_documentation']),
      ],
      tools: { buy_domain: 'destructive', deploy_to_vercel: 'destructive' },
      lookAround: { steps: [{ tool: 'list_teams', args: {} }, { tool: 'list_projects', args: {} }] },
    },
  },
  {
    id: 'netlify', group: 'dev', name: 'Netlify', url: 'https://netlify-mcp.netlify.app/mcp', job: 'Sites and deploys',
    lands: 'Brings your Netlify sites, deploys and form submissions onto the slate, and changes settings you approve.',
    try: 'List my sites and when each last deployed', signIn: 'oauth', cost: 'Uses your Netlify account',
    recipe: { rounds: 1, calls: 2, intents: [ask('sites', 'Netlify sites', [ASK_WORDS], ['get-projects', 'netlify-project-services-reader'])], tools: { 'netlify-project-services-reader': 'lookup' } },
  },
  // Its tools can run SQL and change databases: those start off.
  {
    id: 'supabase', group: 'dev', name: 'Supabase', url: 'https://mcp.supabase.com/mcp', job: 'Databases and backends',
    lands: 'Brings your Supabase projects, tables and logs onto the slate for schema maps and incident reviews. SQL and migrations stay off until you turn them on.',
    try: 'Map the tables in our main project', signIn: 'oauth', cost: 'Uses your Supabase account',
    recipe: {
      rounds: 1, calls: 3,
      intents: [
        { key: 'tables', label: 'Tables', keywords: ['\\b(tables?|schema|columns?)\\b'], steps: [{ tool: 'list_projects', args: {} }, { tool: 'list_tables', args: 'plan' }] },
        ask('logs', 'Logs', ['\\blogs?\\b'], ['get_logs']),
        ask('docs', 'Supabase docs', ['\\b(docs?|how (do|to|can))\\b'], ['search_docs']),
        ask('projects', 'Supabase projects', [ASK_WORDS], ['list_projects']),
      ],
      tools: {
        execute_sql: 'destructive', apply_migration: 'destructive', deploy_edge_function: 'destructive', create_project: 'destructive', pause_project: 'destructive',
        restore_project: 'destructive', create_branch: 'destructive', merge_branch: 'destructive', reset_branch: 'destructive', rebase_branch: 'destructive',
      },
      lookAround: { steps: [{ tool: 'list_organizations', args: {} }, { tool: 'list_projects', args: {} }] },
    },
  },
  {
    id: 'neon', group: 'dev', name: 'Neon', url: 'https://mcp.neon.tech/mcp', job: 'Postgres databases',
    lands: 'Brings your Neon projects, branches and table schemas onto the slate for database maps. SQL and migrations stay off until you turn them on.',
    try: 'Show the branches of our app database', signIn: 'oauth', cost: 'Uses your Neon account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('docs', 'Neon docs', ['\\b(docs?|how (do|to|can))\\b'], ['search_docs', 'get_doc']),
        ask('projects', 'Neon projects', [ASK_WORDS], ['list_projects', 'describe_project']),
      ],
      tools: {
        run_sql: 'destructive', run_sql_transaction: 'destructive', prepare_database_migration: 'destructive', complete_database_migration: 'destructive',
        complete_query_tuning: 'destructive', create_project: 'destructive', create_branch: 'destructive', provision_neon_auth: 'destructive',
      },
      lookAround: { steps: [{ tool: 'list_organizations', args: {} }, { tool: 'list_projects', args: {} }] },
    },
  },
  // One code tool (execute) reaches Cloudflare's whole API: off until someone turns it on.
  {
    id: 'cloudflare', group: 'dev', name: 'Cloudflare', url: 'https://mcp.cloudflare.com/mcp', job: 'Edge and DNS',
    lands: 'Looks up your Cloudflare accounts, zones, Workers and docs and adds them as notes. Its code tool stays off until you turn it on.',
    try: 'Which Workers do we run, and on which routes?', signIn: 'oauth', cost: 'Uses your Cloudflare account',
    recipe: { rounds: 1, calls: 2, intents: [ask('docs', 'Cloudflare docs', ['\\b(docs?|how (do|to|can))\\b'], ['docs', 'search'])], tools: { execute: 'destructive' } },
  },
  // Its address depends on the Datadog site: the other sites' addresses are this card too.
  {
    id: 'datadog', group: 'dev', name: 'Datadog', url: 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp',
    aliases: ['https://mcp.us3.datadoghq.com/api/unstable/mcp-server/mcp', 'https://mcp.us5.datadoghq.com/api/unstable/mcp-server/mcp', 'https://mcp.datadoghq.eu/api/unstable/mcp-server/mcp', 'https://mcp.ap1.datadoghq.com/api/unstable/mcp-server/mcp'],
    job: 'Monitoring and incidents',
    lands: 'Brings monitors, incidents, logs and dashboards onto the slate for incident reviews and service maps.',
    try: 'What incidents did we have this week, and which services?', signIn: 'oauth', cost: 'Uses your Datadog account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('incidents', 'Incidents', ['\\bincidents?\\b'], ['search_datadog_incidents', 'search_incidents']),
        ask('monitors', 'Monitors', ['\\b(monitors?|alerts?)\\b'], ['search_datadog_monitors', 'search_monitors']),
        ask('logs', 'Logs', ['\\blogs?\\b'], ['search_datadog_logs', 'search_logs']),
        ask('dashboards', 'Dashboards', ['\\bdashboards?\\b'], ['search_datadog_dashboards', 'list_dashboards']),
      ],
    },
  },
  {
    id: 'pagerduty', group: 'dev', name: 'PagerDuty', url: 'https://mcp.pagerduty.com/mcp', job: 'On-call and incidents',
    lands: 'Brings incidents, on-call schedules and services onto the slate for incident reviews and rota planning.',
    try: 'Who is on call this weekend?', signIn: 'oauth', cost: 'Uses your PagerDuty account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('oncall', 'On call', ['\\bon[- ]?calls?\\b', '\\bschedules?\\b'], ['list_oncalls', 'list_schedules']),
        ask('incidents', 'Incidents', [ASK_WORDS], ['list_incidents']),
      ],
      lookAround: { steps: [{ tool: ['get_user_data', 'get_current_user'], args: {} }, { tool: 'list_services', args: {} }] },
    },
  },
  {
    id: 'postman', group: 'dev', name: 'Postman', url: 'https://mcp.postman.com/mcp', job: 'APIs and collections',
    lands: 'Brings your Postman workspaces, collections and API specs onto the slate for API maps and reviews.',
    try: 'Map the endpoints in our Payments collection', signIn: 'oauth', keyHint: 'Or paste a Postman API key.', cost: 'Uses your Postman account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [ask('collections', 'Collections', [ASK_WORDS], ['getCollections', 'getCollection', 'getWorkspaces'])],
      lookAround: { steps: [{ tool: 'getAuthenticatedUser', args: {} }, { tool: 'getWorkspaces', args: {} }] },
    },
  },
  {
    id: 'replit', group: 'dev', name: 'Replit', url: 'https://replit-mcp.com/server/mcp', job: 'Apps you build',
    lands: 'Lists your Replit apps as linked notes, and starts apps or sends the Replit Agent a request you approve. In beta at Replit.',
    try: 'Build an app from this slate\'s feature list', signIn: 'oauth', cost: 'Uses your Replit account',
    recipe: { rounds: 1, calls: 2, intents: [ask('apps', 'Replit apps', ['\\b(apps?|projects?|repls?)\\b'], ['list_apps', 'get_apps'])], lookAround: { steps: [{ tool: ['list_apps', 'get_apps'], args: {} }] } },
  },
  {
    id: 'lovable', group: 'dev', name: 'Lovable', url: 'https://mcp.lovable.dev', job: 'Apps you build',
    lands: 'Lists your Lovable projects as linked notes, and creates projects or sends Lovable a change you approve, from the notes on this slate.',
    try: 'Build a landing page from these notes', signIn: 'oauth', cost: 'Uses your Lovable account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [ask('projects', 'Lovable projects', ['\\b(projects?|apps?|sites?)\\b'], ['list_projects'])],
      writes: [
        { key: 'create-project', label: 'Create Lovable project', tool: ['create_project'], keywords: ['^(build|create|make|start|generate)\\b.*\\b(lovable|projects?|apps?|sites?|landing pages?|prototypes?)\\b'], fields: { body: ['initial_message'], target: ['workspace_id'] } },
        { key: 'message', label: 'Ask Lovable for a change', tool: ['send_message'], keywords: ['^(ask|tell)\\b.*\\blovable\\b', '^(change|update|add|fix)\\b.*\\b(lovable|projects?|apps?|sites?)\\b'], fields: { body: ['message'], item: ['project_id'] } },
      ],
      tools: { deploy_project: 'destructive', accept_draft: 'destructive', set_project_visibility: 'destructive', set_folder_visibility: 'destructive' },
      lookAround: { steps: [{ tool: 'get_me', args: {} }, { tool: 'list_workspaces', args: {} }] },
    },
  },
  {
    id: 'v0', group: 'dev', name: 'v0', url: 'https://v0.app/api/mcp', job: 'Generated interfaces',
    lands: 'Lists your v0 chats and projects as linked notes, and starts a v0 chat from this slate\'s notes when you approve.',
    try: 'Make a v0 chat for this dashboard sketch', signIn: 'oauth', cost: 'Uses your v0 account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [ask('chats', 'v0 chats', [ASK_WORDS], ['findChats', 'getChats', 'listChats'])],
      writes: [{ key: 'create-chat', label: 'Start v0 chat', tool: ['createChat'], keywords: ['^(build|create|make|start|generate|design)\\b'], fields: { body: ['message'] } }],
    },
  },

  // ---- Design ----
  // Miro's card id is miroboard: Slatebox's own MCP package names Miro only beside its not-affiliated
  // line (packages/slatebox-mcp), and every card's prompt id (connectors.recipe.<id>) reaches its client.
  {
    id: 'figma', group: 'design', name: 'Figma', url: 'https://mcp.figma.com/mcp', job: 'Designs and FigJam',
    lands: 'Brings the frames, comments and design details of a Figma file you link onto the slate, for design reviews and handoffs. Figma may need to approve Slatebox before sign-in works.',
    try: 'What changed in the checkout frames? figma.com/design/abc/Checkout', signIn: 'oauth', cost: 'Uses your Figma account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('comments', 'Figma comments', ['\\bcomments?\\b'], ['get_comments']),
        ask('design', 'From Figma', ['figma\\.com/'], ['get_metadata', 'get_design_context']),
      ],
    },
  },
  {
    id: 'miroboard', group: 'design', name: 'Miro', url: 'https://mcp.miro.com/', job: 'Boards',
    lands: 'Brings the content of your Miro boards onto the slate, such as stickies, frames and tables, and adds notes or diagrams to a board when you approve.',
    try: 'Bring the sticky notes from our retro board', signIn: 'oauth', cost: 'Uses your Miro account',
    recipe: { rounds: 1, calls: 2, intents: [ask('boards', 'From Miro', ['\\b(boards?|stick(y|ies)|frames?)\\b'], ['board_list_items', 'context_get_board_docs', 'board_search'])] },
  },
  {
    id: 'canva', group: 'design', name: 'Canva', url: 'https://mcp.canva.com/mcp', job: 'Designs',
    lands: 'Finds your Canva designs and folders and adds them as linked notes, and makes designs or exports you approve.',
    try: 'Find our launch social posts in Canva', signIn: 'oauth', cost: 'Uses your Canva account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [ask('designs', 'Canva designs', [ASK_WORDS], ['search-designs', 'search_designs'])],
      lookAround: { steps: [{ tool: ['search-designs', 'search_designs'], args: { query: '' } }] },
    },
  },
  {
    id: 'lucid', group: 'design', name: 'Lucid', url: 'https://mcp.lucid.app/mcp', job: 'Diagrams',
    lands: 'Finds your Lucidchart and Lucidspark documents and brings their contents onto the slate as linked notes.',
    try: 'Bring in the system architecture diagram', signIn: 'oauth', keyHint: 'Or paste a Lucid API key.', cost: 'Uses your Lucid account',
    recipe: { rounds: 1, calls: 2, intents: [ask('documents', 'Lucid documents', [ASK_WORDS], ['search_documents', 'searchDocuments'])] },
  },
  {
    id: 'whimsical', group: 'design', name: 'Whimsical', url: 'https://mcp.whimsical.com/mcp', job: 'Flows and docs',
    lands: 'Brings your Whimsical boards, flowcharts and docs onto the slate, and adds to them when you approve.',
    try: 'Bring in the signup flowchart', signIn: 'oauth', cost: 'Uses your Whimsical account',
    recipe: { rounds: 1, calls: 2, intents: [ask('files', 'From Whimsical', [ASK_WORDS], ['search', 'search_files'])] },
  },
  {
    id: 'webflow', group: 'design', name: 'Webflow', url: 'https://mcp.webflow.com/mcp', job: 'Sites and CMS',
    lands: 'Brings your Webflow sites, pages and CMS items onto the slate for content plans, and changes items you approve.',
    try: 'List the blog posts in our CMS', signIn: 'oauth', cost: 'Uses your Webflow account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [ask('cms', 'CMS items', ['\\b(cms|collections?|posts?|items?)\\b'], ['collections_list', 'collections_items_list_items']), ask('sites', 'Webflow sites', [ASK_WORDS], ['sites_list'])],
      tools: { sites_publish: 'destructive' },
    },
  },
  {
    id: 'framer', group: 'design', name: 'Framer', url: 'https://mcp.framer.com/mcp', job: 'Sites',
    lands: 'Brings the pages and CMS collections of one Framer project you approve onto the slate, and edits them when you approve.',
    try: 'List the pages of our marketing site', signIn: 'oauth', cost: 'Uses your Framer account',
    recipe: { rounds: 1, calls: 2, intents: [], tools: { publish: 'destructive' } },
  },
  {
    id: 'gamma', group: 'design', name: 'Gamma', url: 'https://mcp.gamma.app/mcp', job: 'Decks and docs',
    lands: 'Finds your Gamma decks and docs as linked notes, and makes a Gamma presentation from this slate when you approve. Making one uses Gamma credits.',
    try: 'Turn this slate into a Gamma deck', signIn: 'oauth', cost: 'Uses your Gamma account',
    recipe: { rounds: 1, calls: 2, intents: [ask('gammas', 'Gamma files', ['\\b(decks?|gammas?|docs?|presentations?)\\b'], ['list_gammas', 'search_gammas'])] },
  },
  {
    id: 'pitch', needsApp: 'pitch', group: 'design', name: 'Pitch', url: 'https://mcp.pitch.com/mcp', job: 'Presentations',
    lands: 'Brings your Pitch presentations and how shared ones are read onto the slate, and makes decks from templates when you approve.',
    try: 'Which of our shared decks were read this week?', signIn: 'oauth', cost: 'Uses your Pitch account',
    recipe: { rounds: 1, calls: 2, intents: [] },
  },
  {
    id: 'wix', group: 'design', name: 'Wix', url: 'https://mcp.wix.com/mcp', job: 'Sites and stores',
    lands: 'Brings your Wix sites, store products, bookings and contacts onto the slate, and makes changes you approve.',
    try: 'List the products in our store', signIn: 'oauth', cost: 'Uses your Wix account',
    recipe: { rounds: 1, calls: 2, intents: [ask('sites', 'Wix sites', ['\\bsites?\\b'], ['ListWixSites', 'list_sites'])], tools: { CallWixSiteAPI: 'destructive', ManageWixSite: 'destructive' } },
  },
  {
    id: 'adobeaem', group: 'design', name: 'Adobe Experience Manager', url: 'https://mcp.adobeaemcloud.com/adobe/mcp/aem', job: 'Sites and assets',
    lands: 'Brings the pages, assets and folders of your Adobe Experience Manager sites onto the slate for content reviews. For AEM customers.',
    try: 'List the pages under our product section', signIn: 'oauth', cost: 'Uses your Adobe account',
    recipe: { rounds: 1, calls: 2, intents: [] },
  },
  {
    id: 'adobefirefly', group: 'design', name: 'Adobe Firefly workflows', url: 'https://run-workflow.adobe.io/mcp', job: 'Creative production',
    lands: 'Runs the Firefly creative production workflows your team set up, such as image variants for a campaign, when you approve. For Firefly enterprise customers.',
    try: 'Make banner variants for each market on this slate', signIn: 'oauth', cost: 'Uses your Adobe account',
    recipe: { rounds: 1, calls: 2, intents: [] },
  },

  // ---- Docs, chat and meetings ----
  // Microsoft 365 through Microsoft's own remote servers (Work IQ: mail, calendar, Teams, SharePoint,
  // OneDrive; and its directory server). Microsoft offers no automatic registration: an operator
  // registers one Entra app (oauthApps.microsoft) and each tenant's administrator consents to it.
  {
    id: 'microsoft365', needsApp: 'microsoft', group: 'workspace', name: 'Microsoft 365', url: 'https://workiq.svc.cloud.microsoft/mcp', job: 'Mail, Teams and files',
    lands: 'Brings your Outlook mail and calendar, Teams chats and SharePoint and OneDrive files onto the slate as linked notes. Changes start off. Your Microsoft 365 admin turns it on.',
    try: 'What did my team decide in Teams about the launch?', signIn: 'oauth', cost: 'Uses your Microsoft work account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('ask', 'From Microsoft 365', [ASK_WORDS], ['ask', 'fetch']),
      ],
      // Work IQ's one permission (WorkIQAgent.Ask) reads and writes: every tool that changes or sends
      // (mail included, through do_action) starts off until the person turns it on.
      tools: { create_entity: 'destructive', update_entity: 'destructive', delete_entity: 'destructive', do_action: 'destructive', call_function: 'destructive' },
    },
  },
  {
    id: 'microsoftdirectory', needsApp: 'microsoft', group: 'workspace', name: 'Microsoft Entra directory', url: 'https://mcp.svc.cloud.microsoft/enterprise', job: 'People and groups',
    lands: 'Looks up the people, groups and teams in your organization\'s Microsoft directory and adds them as notes, for org charts and team maps. It only reads.',
    try: 'Map the people in the Platform group', signIn: 'oauth', cost: 'Uses your Microsoft work account',
    recipe: { rounds: 1, calls: 2, intents: [ask('directory', 'From the directory', [ASK_WORDS], ['microsoft_graph_get'])], lookAround: { steps: [{ tool: 'microsoft_graph_get', args: { relativeUrl: '/me?$select=displayName,jobTitle,department' } }] } },
  },
  // Google Workspace through Google's own remote servers. They answer initialize without a sign-in
  // and ask for one only on a tool call, so these cards sign in first (signInFirst). Google offers no
  // automatic registration: an operator registers one OAuth client (oauthApps.google). Their tool
  // names are from each server's own tools/list (open, 2026-11-26).
  {
    id: 'gmail', needsApp: 'google', signInFirst: true, group: 'workspace', name: 'Gmail', url: 'https://gmailmcp.googleapis.com/mcp/v1', job: 'Email',
    lands: 'Finds the email threads you ask about and adds their subjects and gist as linked notes. It only reads, unless your administrator allows drafts.',
    try: 'What did the vendor say about the contract renewal?', signIn: 'oauth', cost: 'Uses your Google account',
    recipe: { rounds: 1, calls: 2, intents: [ask('threads', 'Email threads', [ASK_WORDS], ['search_threads'])] },
  },
  {
    id: 'googlecalendar', needsApp: 'google', signInFirst: true, group: 'workspace', name: 'Google Calendar', url: 'https://calendarmcp.googleapis.com/mcp/v1', job: 'Calendar',
    lands: 'Brings the events on your Google Calendar onto the slate, for week plans and meeting maps. It only reads, unless your administrator allows changes.',
    try: 'Lay out my meetings for next week', signIn: 'oauth', cost: 'Uses your Google account',
    recipe: { rounds: 1, calls: 2, intents: [ask('events', 'Events', [ASK_WORDS], ['list_events', 'search_events'])] },
  },
  {
    id: 'googledocs', needsApp: 'google', signInFirst: true, group: 'workspace', name: 'Google Docs', url: 'https://docsmcp.googleapis.com/mcp/v1', job: 'Docs',
    lands: 'Reads the Google Docs you name and adds their sections as linked notes.',
    try: 'Bring in the sections of the Q3 planning doc', signIn: 'oauth', cost: 'Uses your Google account',
    recipe: { rounds: 1, calls: 2, intents: [ask('doc', 'Google Doc', [ASK_WORDS], ['read_doc'])] },
  },
  {
    id: 'googlesheets', needsApp: 'google', signInFirst: true, group: 'workspace', name: 'Google Sheets', url: 'https://sheetsmcp.googleapis.com/mcp/v1', job: 'Spreadsheets',
    lands: 'Reads the rows of a Google Sheet you name and adds them as notes, such as a tracker or a content calendar.',
    try: 'Put the rows of the launch tracker sheet on the slate', signIn: 'oauth', cost: 'Uses your Google account',
    recipe: { rounds: 1, calls: 2, intents: [ask('values', 'Sheet rows', [ASK_WORDS], ['get_values', 'get_spreadsheet'])] },
  },
  {
    id: 'googlechat', needsApp: 'google', signInFirst: true, group: 'workspace', name: 'Google Chat', url: 'https://chatmcp.googleapis.com/mcp/v1', job: 'Team chat',
    lands: 'Brings messages from your Google Chat spaces onto the slate so decisions made in chat become notes.',
    try: 'What did the design space decide this week?', signIn: 'oauth', cost: 'Uses your Google account',
    recipe: { rounds: 1, calls: 2, intents: [ask('messages', 'Chat messages', [ASK_WORDS], ['search_messages', 'search_conversations', 'list_messages'])] },
  },
  {
    id: 'dropbox', group: 'workspace', name: 'Dropbox', url: 'https://mcp.dropbox.com/mcp', job: 'Files',
    lands: 'Finds the Dropbox files and folders you ask about and adds them as linked notes. In beta at Dropbox.',
    try: 'Find the signed contracts from last month', signIn: 'oauth', cost: 'Uses your Dropbox account',
    recipe: { rounds: 1, calls: 2, intents: [ask('files', 'Dropbox files', [ASK_WORDS], ['search', 'search_files', 'list_folder'])] },
  },
  {
    id: 'dropboxdash', group: 'workspace', name: 'Dropbox Dash', url: 'https://mcp.dropbox.com/dash', job: 'Search across apps',
    lands: 'Searches everything your team connected to Dropbox Dash and adds what it finds as linked notes. Needs a Dash plan.',
    try: 'Find everything about the Acme renewal', signIn: 'oauth', cost: 'Uses your Dropbox account',
    recipe: { rounds: 1, calls: 2, intents: [ask('search', 'From Dash', [ASK_WORDS], ['search', 'dash_search'])] },
  },
  {
    id: 'box', needsApp: 'box', group: 'workspace', name: 'Box', url: 'https://mcp.box.com', job: 'Files',
    lands: 'Finds the Box files and folders you ask about and adds them as linked notes, with answers from their contents.',
    try: 'Find the latest board deck in Box', signIn: 'oauth', cost: 'Uses your Box account',
    recipe: { rounds: 1, calls: 2, intents: [ask('search', 'Box files', [ASK_WORDS], ['search_files_keyword', 'search_files', 'search'])] },
  },
  {
    id: 'zoom', needsApp: 'zoom', group: 'workspace', name: 'Zoom', url: 'https://mcp.zoom.us/mcp/zoom/streamable', job: 'Meetings and recordings',
    lands: 'Brings your Zoom meetings, notes and recording summaries onto the slate for retros and decision maps.',
    try: 'Put the action items from this morning\'s standup on the slate', signIn: 'oauth', cost: 'Uses your Zoom account',
    recipe: { rounds: 1, calls: 2, intents: [] },
  },
  {
    id: 'calendly', group: 'workspace', name: 'Calendly', url: 'https://mcp.calendly.com', job: 'Scheduling',
    lands: 'Brings your upcoming Calendly meetings and event types onto the slate, and books or changes meetings you approve.',
    try: 'Who booked time with me this week?', signIn: 'oauth', cost: 'Uses your Calendly account',
    recipe: { rounds: 1, calls: 2, intents: [ask('events', 'Upcoming meetings', [ASK_WORDS], ['list_scheduled_events', 'list_events'])] },
  },

  // ---- Projects and tasks ----
  {
    id: 'todoist', group: 'work', name: 'Todoist', url: 'https://ai.todoist.net/mcp', job: 'Tasks',
    lands: 'Brings your Todoist tasks and projects onto the slate, and adds or completes tasks you approve.',
    try: 'What is on my list for today?', signIn: 'oauth', cost: 'Uses your Todoist account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [ask('today', 'Today', ['\\b(today|overdue|this week)\\b'], ['find-tasks-by-date']), ask('tasks', 'Todoist tasks', [ASK_WORDS], ['find-tasks'])],
      writes: [{ key: 'add-tasks', label: 'Add Todoist task', tool: ['add-tasks'], keywords: [TASK_WORDS], fields: { title: ['tasks'] } }],
      lookAround: { steps: [{ tool: 'find-projects', args: {} }] },
    },
  },
  {
    id: 'coda', group: 'workspace', name: 'Coda', url: 'https://coda.io/apis/mcp', job: 'Docs and tables',
    lands: 'Brings pages and table rows from your Coda docs onto the slate, and adds rows you approve. In beta at Coda.',
    try: 'Bring in the OKR table from our planning doc', signIn: 'oauth', cost: 'Uses your Coda account',
    recipe: { rounds: 1, calls: 2, intents: [] },
  },
  {
    id: 'make', group: 'work', name: 'Make', url: 'https://mcp.make.com', job: 'Automations',
    lands: 'Runs the Make scenarios your team set up as tools, such as adding a row or sending a message, each when you approve.',
    try: 'Send each note to our Feedback scenario', signIn: 'oauth', cost: 'Uses your Make account',
    recipe: { rounds: 1, calls: 2, intents: [] },
  },

  // ---- Business ----
  {
    id: 'salesforce', needsApp: 'salesforce', group: 'business', name: 'Salesforce', url: 'https://api.salesforce.com/platform/mcp/v1/platform/sobject-reads', job: 'Accounts and opportunities',
    lands: 'Brings Salesforce accounts, opportunities, contacts and cases onto the slate for pipeline and account reviews. It only reads.',
    try: 'Show my open opportunities by stage', signIn: 'oauth', cost: 'Uses your Salesforce account',
    recipe: { rounds: 1, calls: 2, intents: [] },
  },
  {
    id: 'intercom', group: 'business', name: 'Intercom', url: 'https://mcp.intercom.com/mcp', aliases: ['https://mcp.eu.intercom.com/mcp'], job: 'Customer conversations',
    lands: 'Brings Intercom conversations, contacts and help articles onto the slate, so support themes become notes.',
    try: 'What are customers asking about the new pricing?', signIn: 'oauth', cost: 'Uses your Intercom account',
    recipe: { rounds: 1, calls: 2, intents: [ask('search', 'From Intercom', [ASK_WORDS], ['search', 'search_conversations'])] },
  },
  {
    id: 'typeform', group: 'business', name: 'Typeform', url: 'https://api.typeform.com/mcp', aliases: ['https://api.eu.typeform.com/mcp'], job: 'Forms and responses',
    lands: 'Brings your Typeform forms and their responses onto the slate, so feedback becomes notes you can group.',
    try: 'Group the answers to our onboarding survey', signIn: 'oauth', cost: 'Uses your Typeform account',
    recipe: { rounds: 1, calls: 2, intents: [ask('responses', 'Responses', ['\\b(responses?|answers?|results?|feedback)\\b'], ['retrieve_responses', 'list_responses']), ask('forms', 'Typeform forms', [ASK_WORDS], ['list_forms', 'retrieve_forms'])] },
  },
  {
    id: 'attio', group: 'business', name: 'Attio', url: 'https://mcp.attio.com/mcp', job: 'CRM',
    lands: 'Brings Attio companies, people, deals and notes onto the slate for account reviews, and updates records you approve.',
    try: 'Show the deals in negotiation', signIn: 'oauth', cost: 'Uses your Attio account',
    recipe: { rounds: 1, calls: 2, intents: [ask('records', 'From Attio', [ASK_WORDS], ['search_records', 'list_records'])] },
  },
  {
    id: 'pipedrive', group: 'business', name: 'Pipedrive', url: 'https://mcp.pipedrive.ai/mcp', job: 'Sales pipeline',
    lands: 'Brings Pipedrive deals, people and activities onto the slate for pipeline reviews, and updates deals you approve. In beta at Pipedrive.',
    try: 'Show my open deals by stage', signIn: 'oauth', cost: 'Uses your Pipedrive account',
    recipe: { rounds: 1, calls: 2, intents: [ask('deals', 'Deals', ['\\bdeals?\\b'], ['search_deals', 'list_deals', 'get_deals'])] },
  },
  {
    id: 'apollo', group: 'business', name: 'Apollo.io', url: 'https://mcp.apollo.io/mcp', job: 'Prospects',
    lands: 'Finds companies and people in Apollo and adds them as notes for account plans. Emails, sequences and lookups that spend credits wait for your approval.',
    try: 'Find the heads of operations at our top ten accounts', signIn: 'oauth', cost: 'Uses your Apollo account',
    recipe: { rounds: 1, calls: 2, intents: [] },
  },
  // Square and PayPal move money: their payment writes start off.
  {
    id: 'square', group: 'business', name: 'Square', url: 'https://mcp.squareup.com/mcp', job: 'Payments and catalog',
    lands: 'Brings Square payments, orders, catalog items and customers onto the slate for sales reviews. Changes stay off until you turn them on.',
    try: 'What sold best at each location last week?', signIn: 'oauth', cost: 'Uses your Square account',
    recipe: { rounds: 1, calls: 2, intents: [], tools: { make_api_request: 'destructive' } },
  },
  {
    id: 'paypal', group: 'business', name: 'PayPal', url: 'https://mcp.paypal.com/mcp', job: 'Payments and invoices',
    lands: 'Brings PayPal invoices, orders, transactions and disputes onto the slate for business reviews, and drafts invoices you approve.',
    try: 'List the unpaid invoices from this month', signIn: 'oauth', cost: 'Uses your PayPal account',
    recipe: {
      rounds: 1, calls: 2,
      intents: [ask('invoices', 'Invoices', ['\\binvoices?\\b'], ['list_invoices']), ask('disputes', 'Disputes', ['\\bdisputes?\\b'], ['list_disputes']), ask('transactions', 'Transactions', ['\\b(transactions?|payments?|sales)\\b'], ['list_transactions'])],
      tools: { create_refund: 'destructive', capture_order: 'destructive', send_invoice: 'destructive', accept_dispute_claim: 'destructive' },
    },
  },
  // ---- Research (no sign-in) ----
  { id: 'microsoftlearn', group: 'research', name: 'Microsoft Learn', url: 'https://learn.microsoft.com/api/mcp', job: 'Microsoft docs', lands: 'Answers questions from Microsoft\'s own docs and code samples, as notes with a link.', try: 'How do I add a tab to a Teams app?', cost: 'Free', recipe: { rounds: 1, calls: 1, intents: [ask('code', 'Code samples', ['\\b(code|samples?|examples?|snippets?)\\b'], ['microsoft_code_sample_search']), ask('docs', 'Microsoft docs', ['.'], ['microsoft_docs_search'])] } },
  { id: 'cloudflaredocs', group: 'research', name: 'Cloudflare Docs', url: 'https://docs.mcp.cloudflare.com/mcp', job: 'Cloudflare docs', lands: 'Answers questions from Cloudflare\'s docs, as notes with a link.', try: 'How do Durable Objects keep state?', cost: 'Free', recipe: { rounds: 1, calls: 1, intents: [ask('docs', 'Cloudflare docs', ['.'], ['search_cloudflare_documentation'])] } },
]

// Words a card is found by that its name, job and what lands do not say (a brand, a product it
// covers, an older name): the invite dialog's search box (filterCards).
const KEYWORDS = Object.freeze({
  atlassian: ['atlassian', 'bitbucket', 'compass'],
  microsoft365: ['outlook', 'teams', 'sharepoint', 'onedrive', 'excel', 'word', 'powerpoint', 'office'],
  microsoftdirectory: ['azure', 'active directory', 'org chart'],
  gmail: ['google', 'mail', 'inbox'],
  googlesheets: ['spreadsheet'],
  miroboard: ['whiteboard', 'stickies'],
  adobeaem: ['aem'],
  v0: ['vercel'],
  zoom: ['video', 'calls'],
})

// The order the gallery shows (owner, 2026-11-26, "GitHub, Linear, Notion, Jira, Slack, Sentry,
// Microsoft, Google, Miro, Figma, Canva, Adobe, Replit, Lovable"): the eight listed before keep their
// places, the agents the owner named come next, then the rest as listed above.
const SHOWN_FIRST = Object.freeze(['huggingface', 'github', 'linear', 'deepwiki', 'context7', 'wolfram', 'firecrawl', 'exa',
  'notion', 'atlassian', 'slack', 'sentry', 'microsoft365', 'gmail', 'googlecalendar', 'googledocs', 'googlesheets', 'googlechat',
  'miroboard', 'figma', 'canva', 'adobeaem', 'adobefirefly', 'replit', 'lovable'])
const rank = (card) => {
  const at = SHOWN_FIRST.indexOf(card.id)
  return at === -1 ? SHOWN_FIRST.length : at
}

export const GALLERY = Object.freeze(LISTED
  .map((card, at) => ({ card: KEYWORDS[card.id] ? { ...card, keywords: KEYWORDS[card.id] } : card, at }))
  .sort((a, b) => rank(a.card) - rank(b.card) || a.at - b.at)
  .map(({ card }) => card))

// The gallery's filter chips (the invite dialog), in this order after All: each card names one by
// `group`. A card an administrator added words to keeps its group (it is not an edited field).
// The library's categories for a suggested integration (library-model.mjs INTEGRATION_CATEGORIES)
// are among these ids, with the same words.
export const GROUPS = Object.freeze([
  { id: 'work', label: 'Work' },
  { id: 'workspace', label: 'Docs, chat and meetings' },
  { id: 'dev', label: 'Developer tools' },
  { id: 'design', label: 'Design' },
  { id: 'business', label: 'Business' },
  { id: 'research', label: 'Research' },
  { id: 'web', label: 'Web and facts' },
])

/**
 * The cards the invite dialog shows for a chip (group: a GROUPS id, or 'all') and the words typed in
 * its search box: every word must be in the card's name, id, what it is for, what it adds, its
 * keywords, or its group's name. Order is kept.
 */
export function filterCards(cards = [], { group = 'all', query = '' } = {}) {
  const words = String(query || '').toLowerCase().normalize('NFKC').split(/\s+/).filter(Boolean).slice(0, 8)
  return cards.filter((card) => {
    if (group && group !== 'all' && card.group !== group) return false
    if (!words.length) return true
    const label = GROUPS.find((g) => g.id === card.group)?.label || ''
    const keywords = Array.isArray(card.keywords) ? card.keywords.filter((k) => typeof k === 'string') : []
    const text = [card.name, card.id, card.job, card.lands, ...keywords, label].join(' ').toLowerCase().normalize('NFKC')
    return words.every((word) => text.includes(word))
  })
}

/** The chips worth showing: All, then each group that has a card in this gallery. */
export const groupsIn = (cards = []) => GROUPS.filter((g) => cards.some((card) => card.group === g.id))

// Native integrations: built into Slatebox (no MCP address), connected on the Integrations page and
// invited onto slates like any agent. Administrators turn one on or off and edit its words in
// /admin/ai › Gallery (its address never changes). Google Drive reads only the files a person picks
// for a slate (drive.file scope: enterprise/server/google/google.mjs).
// Slack is native too (owner, 2026-11-27: "if web api is the expected integration, then let's pivot
// to that instead of MCP"): Slack lets only Marketplace-listed or internal apps use its MCP server,
// so Slatebox reads and writes Slack through its Web API as the person (enterprise/server/slack/).
// Its tools are fixed (their hashes never move), every change it proposes always waits on a card
// (alwaysAsk: acting without asking is refused for it), and it is offered in the invite gallery
// (invite) with its own one-click sign-in (signIn 'slack': Connect, Allow on Slack, done).
export const NATIVE_ADDRESSES = Object.freeze({ googledrive: 'google://drive', slack: 'slack://workspace' })
// Asks Slack's agent knows: a thread by its permalink, a channel only when the request names one and
// says read or latest, anything else a search (search.messages is not limited for unlisted apps;
// reading a channel or a thread is, once a minute: enterprise/server/slack/slack.mjs).
const SLACK_LINK = 'https://[a-z0-9-]+\\.(enterprise\\.)?slack\\.com/archives/'
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
  {
    id: 'slack',
    kind: 'native',
    needsApp: 'slack',
    group: 'workspace',
    name: 'Slack',
    url: NATIVE_ADDRESSES.slack,
    job: 'Team chat',
    lands: 'Brings Slack messages and threads onto the slate so decisions made in chat become notes, and posts messages and reactions you approve.',
    try: 'What did #launch decide about the pricing page this week?',
    signIn: 'slack',
    cost: 'Uses your Slack account',
    invite: true,
    alwaysAsk: true,
    recipe: {
      rounds: 1, calls: 2,
      intents: [
        ask('thread', 'Slack thread', [SLACK_LINK], ['read_thread']),
        ask('channel', 'From the channel', ['\\b(read|latest)\\b.*#[a-z0-9]', '#[a-z0-9][a-z0-9_-]*.*\\b(read|latest)\\b'], ['read_channel']),
        ask('search', 'From Slack', [ASK_WORDS], ['search_messages']),
      ],
      writes: [
        { key: 'react', label: 'React in Slack', tool: ['add_reaction'], keywords: ['^(react|add (a |an )?(reaction|emoji))\\b'], fields: { body: ['name'], target: ['channel'], item: ['timestamp'] } },
        { key: 'post', label: 'Post in Slack', tool: ['post_message'], keywords: ['^(post|send|message|tell|announce|share|reply)\\b'], fields: { body: ['text'], target: ['channel'], item: ['thread_ts'] } },
      ],
      tools: { search_messages: 'lookup', list_channels: 'lookup', read_channel: 'lookup', read_thread: 'lookup', post_message: 'change', add_reaction: 'change' },
      lookAround: { steps: [{ tool: 'search_messages', args: { query: 'from:me', limit: 5 } }] },
    },
  },
])

// The cards the invite gallery offers: the MCP cards, and the native ones that are invited from it
// (Slack; Google Drive has its own place on the Integrations page), in the gallery's order.
export const INVITE_CARDS = Object.freeze([...LISTED, ...NATIVE_CARDS.filter((card) => card.invite)]
  .map((card, at) => ({ card: KEYWORDS[card.id] ? { ...card, keywords: KEYWORDS[card.id] } : card, at }))
  .sort((a, b) => rank(a.card) - rank(b.card) || a.at - b.at)
  .map(({ card }) => card))

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

// What went wrong checking a pasted address, and what to do about it, by the server's code: shown under
// the address field (its error state, aria-describedby). The server's own sentence when there is no
// better one; a plain fallback when there is none at all.
const ADDRESS_HELP = Object.freeze({
  bad_address: 'That is not a web address. Paste the full address, starting with https://',
  not_https: 'Only https:// addresses work. Check the address starts with https://',
  credentials: 'Leave any user name or password out of the address. Slatebox asks for a sign-in or key after it checks the server.',
  private_address: 'Slatebox only connects public servers, not ones on a private network or this computer. Use the server\'s public https address.',
  dead_listing: 'This address points to a service that shut down.',
})
// A refusing server's settings page (app_refused: the server checked it is https on its own domain),
// shown as an "Open settings" link. Checked again here: only an https link, never anything else.
export function settingsLinkOf(error) {
  if ((error?.error || error?.code) !== 'app_refused') return null
  const raw = error?.details?.settingsUrl
  if (typeof raw !== 'string' || raw.length > 300) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}
export function addressProblem(error) {
  const code = error?.error || error?.code
  const said = error?.reason || error?.message || ''
  if (code && ADDRESS_HELP[code]) return ADDRESS_HELP[code]
  if (said) return said
  return 'Slatebox could not check that address. Check it and try again.'
}
