// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// ctx.vendor.linear for one recipe run: Linear's GraphQL API (https://api.linear.app/graphql) as the
// person the recipe runs for, with their own rights in Linear. Fixed queries only (a recipe never
// sends its own GraphQL): each one is one HTTP call, counted against the run's vendor budget, and
// each stays well under Linear's 10,000-point complexity cap for one query (pages of 50 projects,
// 100 issues, 10 relations an issue). A refused token is renewed once (the vault's lease), then the
// recipe waits for "connect again". Linear's rate limit (5,000 requests and 2,000,000 points an
// hour, per person) shows up as a retryable 429.
//
// The session a recipe gets has no writes. perform() asks for a writable one (updateIssueState,
// createComment) only after a standing permission or a person's approval.
import { spendVendorCall } from '../spend.mjs'

export const LINEAR_GRAPHQL = 'https://api.linear.app/graphql'
export const LINEAR_RECIPE_LIMITS = Object.freeze({ bytes: 4 * 1024 * 1024, projectPages: 4, issuePages: 6, identifiersPerQuery: 50, textChars: 300 })
const ID = /^[0-9a-f-]{8,64}$/i
export const IDENTIFIER = /^[A-Z][A-Z0-9]{0,9}-[0-9]{1,7}$/

export class LinearRecipeError extends Error {
  constructor(code, status) {
    super(`Linear answered ${code}`)
    this.name = 'LinearRecipeError'
    this.code = code
    this.status = status
  }
}
export class LinearSignInNeeded extends Error {
  constructor() {
    super('Connect Linear again to keep this recipe running.')
    this.name = 'SignInNeeded'
    this.code = 'needs_sign_in'
  }
}

const idOk = (id) => {
  if (!ID.test(String(id || ''))) throw new LinearRecipeError('bad_id', 400)
  return id
}
const clip = (value, n = LINEAR_RECIPE_LIMITS.textChars) => String(value ?? '').replace(/[\u0000-\u001f]+/g, ' ').slice(0, n) // eslint-disable-line no-control-regex
const day = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null)
const https = (value) => (typeof value === 'string' && /^https:\/\/linear\.app\//.test(value) ? value.slice(0, 300) : null)

// ---------- the fixed queries ----------

const PROJECT_FIELDS = `id name url state startDate targetDate health progress updatedAt completedAt canceledAt
  status { type name }
  lead { name }
  teams(first: 10) { nodes { id key name } }
  projectMilestones(first: 25) { nodes { id name targetDate } }
  projectUpdates(first: 1) { nodes { health body createdAt url } }`

export const QUERIES = Object.freeze({
  teams: 'query Teams { teams(first: 100) { nodes { id key name } } }',
  projects: `query Projects($teams: [ID!], $after: String) {
  projects(first: 50, after: $after, filter: { accessibleTeams: { some: { id: { in: $teams } } } }) {
    nodes { ${PROJECT_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`,
  projectsWithInitiatives: `query ProjectsWithInitiatives($teams: [ID!], $after: String) {
  projects(first: 50, after: $after, filter: { accessibleTeams: { some: { id: { in: $teams } } } }) {
    nodes { ${PROJECT_FIELDS} initiatives(first: 5) { nodes { id name } } }
    pageInfo { hasNextPage endCursor }
  }
}`,
  // Open issues of these projects that block another issue: collapsed to project -> project edges.
  blockers: `query Blockers($projects: [ID!], $after: String) {
  issues(first: 100, after: $after, filter: { project: { id: { in: $projects } }, state: { type: { nin: ["completed", "canceled"] } } }) {
    nodes { id identifier project { id } dueDate
      relations(first: 10) { nodes { type relatedIssue { id identifier project { id } state { type } } } } }
    pageInfo { hasNextPage endCursor }
  }
}`,
  activeCycle: `query ActiveCycle($team: String!, $after: String) {
  team(id: $team) {
    id key name
    states(first: 50) { nodes { id name type position } }
    activeCycle {
      id number name startsAt endsAt
      issues(first: 100, after: $after) {
        nodes { id identifier title url priority estimate addedToCycleAt
          state { id type name } assignee { name } team { id key }
          parent { id }
          relations(first: 10) { nodes { type relatedIssue { id identifier title url team { id key } state { type } } } }
          inverseRelations(first: 10) { nodes { type issue { id identifier title url team { id key } state { type } } } }
          attachments(first: 10) { nodes { url } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`,
  updateIssueState: 'mutation UpdateIssueState($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { id identifier state { id type } } } }',
  createComment: 'mutation CreateComment($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id url } } }',
})

/** Issues by their identifiers (ENG-123), one aliased lookup each, at most 50 a query. */
export function issuesQuery(identifiers) {
  const list = identifiers.filter((i) => IDENTIFIER.test(i)).slice(0, LINEAR_RECIPE_LIMITS.identifiersPerQuery)
  const fields = 'id identifier title url completedAt state { type name } project { id name url progress } team { key }'
  return { list, query: `query IssuesByIdentifier {\n${list.map((k, n) => `  i${n}: issue(id: ${JSON.stringify(k)}) { ${fields} }`).join('\n')}\n}` }
}

// ---------- answers, as plain data ----------

const nodes = (conn) => (Array.isArray(conn?.nodes) ? conn.nodes : [])

export function projectOf(p) {
  const update = nodes(p.projectUpdates)[0] || null
  return {
    id: p.id, name: clip(p.name, 120), url: https(p.url), state: clip(p.status?.type || p.state || 'planned', 20),
    startDate: day(p.startDate), targetDate: day(p.targetDate), health: ['onTrack', 'atRisk', 'offTrack'].includes(p.health) ? p.health : null,
    progress: Number.isFinite(p.progress) ? Math.round(p.progress * (p.progress <= 1 ? 100 : 1)) : null,
    lead: p.lead?.name ? clip(p.lead.name, 60) : null,
    teams: nodes(p.teams).map((t) => ({ id: t.id, key: clip(t.key, 10), name: clip(t.name, 60) })),
    initiatives: nodes(p.initiatives).map((i) => ({ id: i.id, name: clip(i.name, 80) })),
    milestones: nodes(p.projectMilestones).map((m) => ({ id: m.id, name: clip(m.name, 80), targetDate: day(m.targetDate) })),
    lastUpdate: update ? { health: update.health || null, at: update.createdAt || null, excerpt: clip(update.body, 280), url: https(update.url) } : null,
    updatedAt: p.updatedAt || null,
  }
}

function issueOf(i) {
  return {
    id: i.id, identifier: clip(i.identifier, 20), title: clip(i.title, 200), url: https(i.url), priority: Number.isInteger(i.priority) ? i.priority : 0,
    estimate: Number.isFinite(i.estimate) ? i.estimate : null, addedToCycleAt: i.addedToCycleAt || null,
    state: { id: i.state?.id || null, type: clip(i.state?.type || 'unstarted', 20), name: clip(i.state?.name || '', 40) },
    assignee: i.assignee?.name ? clip(i.assignee.name, 60) : null, team: { id: i.team?.id || null, key: clip(i.team?.key || '', 10) },
    parentId: i.parent?.id || null,
    blocks: nodes(i.relations).filter((r) => r.type === 'blocks' && r.relatedIssue).map((r) => linked(r.relatedIssue)),
    blockedBy: nodes(i.inverseRelations).filter((r) => r.type === 'blocks' && r.issue).map((r) => linked(r.issue)),
    links: nodes(i.attachments).map((a) => a.url).filter((u) => typeof u === 'string' && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(u)).slice(0, 5),
  }
}
const linked = (x) => ({ id: x.id, identifier: clip(x.identifier, 20), title: clip(x.title, 200), url: https(x.url), team: { id: x.team?.id || null, key: clip(x.team?.key || '', 10) }, state: { type: clip(x.state?.type || '', 20) } })

/**
 * deps: { userId, tokenFor(userId, { force }) → token, fetch (Linear's hosts only), endpoint,
 *         budget { spend | take } | null, signal, writable }
 */
export function createLinearRecipeSession({ userId, tokenFor, fetch, endpoint = LINEAR_GRAPHQL, budget = null, signal = null, writable = false }) {
  const calls = {}

  async function gql(what, query, variables = {}, retried = false) {
    if (signal?.aborted) throw Object.assign(new Error('timeout'), { name: 'AbortError', code: 'timeout' })
    if (!retried) spendVendorCall(budget)
    calls[what] = (calls[what] || 0) + (retried ? 0 : 1)
    let token
    try {
      token = await tokenFor(userId, { force: retried })
    } catch {
      throw new LinearSignInNeeded()
    }
    if (!token) throw new LinearSignInNeeded()
    let response
    try {
      response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query, variables }), ...(signal && { signal }) })
    } catch {
      if (signal?.aborted) throw Object.assign(new Error('timeout'), { name: 'AbortError', code: 'timeout' })
      throw new LinearRecipeError('unreachable', 502)
    }
    if (response.status === 401 && !retried) return gql(what, query, variables, true)
    if (response.status === 401) throw new LinearSignInNeeded()
    if (response.status === 429) throw new LinearRecipeError('rate_limited', 429)
    const text = await response.text()
    if (text.length > LINEAR_RECIPE_LIMITS.bytes) throw new LinearRecipeError('too_large', 413)
    let json
    try {
      json = JSON.parse(text || '{}')
    } catch {
      throw new LinearRecipeError('bad_answer', 502)
    }
    const codes = (json.errors || []).map((e) => String(e?.extensions?.code || e?.extensions?.type || '').toUpperCase())
    if (codes.includes('RATELIMITED')) throw new LinearRecipeError('rate_limited', 429)
    if (codes.includes('AUTHENTICATION_ERROR')) {
      if (!retried) return gql(what, query, variables, true)
      throw new LinearSignInNeeded()
    }
    if (!response.ok && response.status >= 500) throw new LinearRecipeError('failed', response.status)
    // Partial answers are kept (an aliased issue lookup where one identifier is not there);
    // no data at all is the error it says.
    if (!json.data) {
      if (codes.includes('FORBIDDEN')) throw new LinearRecipeError('forbidden', 403)
      throw new LinearRecipeError(codes.includes('INPUT_ERROR') || response.status === 400 ? 'refused' : 'failed', response.status >= 400 && response.status < 500 ? response.status : 502)
    }
    return { data: json.data, errors: codes }
  }

  async function pagedProjects(teamIds, { initiatives = false } = {}) {
    const out = []
    let after = null
    for (let page = 0; page < LINEAR_RECIPE_LIMITS.projectPages; page += 1) {
      const { data } = await gql('projects', initiatives ? QUERIES.projectsWithInitiatives : QUERIES.projects, { teams: teamIds.map(idOk), after })
      out.push(...nodes(data.projects).map(projectOf))
      if (!data.projects?.pageInfo?.hasNextPage) return { projects: out, complete: true }
      after = data.projects.pageInfo.endCursor
    }
    return { projects: out, complete: false }
  }

  return {
    name: 'linear',
    // Each GraphQL call is counted against the run's budget here (not per method).
    countsOwnCalls: true,
    calls,

    /** The teams the person can see: [{ id, key, name }]. */
    async teams() {
      const { data } = await gql('teams', QUERIES.teams)
      return nodes(data.teams).map((t) => ({ id: t.id, key: clip(t.key, 10), name: clip(t.name, 60) }))
    },

    /**
     * The projects of these teams, with their latest update, milestones and (initiatives: true, an
     * admin's app-actor install) their initiatives. initiatives refused by Linear falls back without.
     * → { projects, complete, initiatives }
     */
    async projects(teamIds, { initiatives = false } = {}) {
      if (!initiatives) return { ...(await pagedProjects(teamIds)), initiatives: false }
      try {
        return { ...(await pagedProjects(teamIds, { initiatives: true })), initiatives: true }
      } catch (error) {
        if (error?.code !== 'forbidden' && error?.code !== 'refused') throw error
        return { ...(await pagedProjects(teamIds)), initiatives: false }
      }
    },

    /** Open issues of these projects that block issues elsewhere: [{ from: projectId, to: projectId, issue, blocks }]. */
    async blockers(projectIds) {
      const out = []
      let after = null
      if (!projectIds.length) return { relations: out, complete: true }
      for (let page = 0; page < LINEAR_RECIPE_LIMITS.issuePages; page += 1) {
        const { data } = await gql('blockers', QUERIES.blockers, { projects: projectIds.map(idOk), after })
        for (const issue of nodes(data.issues)) {
          for (const r of nodes(issue.relations)) {
            if (r.type !== 'blocks' || !r.relatedIssue) continue
            out.push({ fromProject: issue.project?.id || null, toProject: r.relatedIssue.project?.id || null, issue: clip(issue.identifier, 20), blocked: clip(r.relatedIssue.identifier, 20), blockedDone: ['completed', 'canceled'].includes(r.relatedIssue.state?.type), due: day(issue.dueDate) })
          }
        }
        if (!data.issues?.pageInfo?.hasNextPage) return { relations: out, complete: true }
        after = data.issues.pageInfo.endCursor
      }
      return { relations: out, complete: false }
    },

    /** A team's current cycle, its issues and the team's workflow states. → { team, states, cycle | null, complete } */
    async activeCycle(teamId) {
      idOk(teamId)
      let after = null
      let team = null
      let cycle = null
      const issues = []
      for (let page = 0; page < LINEAR_RECIPE_LIMITS.issuePages; page += 1) {
        const { data } = await gql('cycle', QUERIES.activeCycle, { team: teamId, after })
        const t = data.team
        if (!t) throw new LinearRecipeError('not_found', 404)
        team = team || { id: t.id, key: clip(t.key, 10), name: clip(t.name, 60), states: nodes(t.states).map((s) => ({ id: s.id, name: clip(s.name, 40), type: clip(s.type, 20), position: Number(s.position) || 0 })) }
        const c = t.activeCycle
        if (!c) return { team, cycle: null, complete: true }
        cycle = cycle || { id: c.id, number: Number(c.number) || 0, name: c.name ? clip(c.name, 80) : null, startsAt: c.startsAt || null, endsAt: c.endsAt || null }
        issues.push(...nodes(c.issues).map(issueOf))
        if (!c.issues?.pageInfo?.hasNextPage) return { team, cycle: { ...cycle, issues }, complete: true }
        after = c.issues.pageInfo.endCursor
      }
      return { team, cycle: { ...cycle, issues }, complete: false }
    },

    /** Issues by identifier (ENG-123), 50 a call; the ones Linear does not show this person are left out. */
    async issuesByIdentifier(identifiers) {
      const wanted = [...new Set(identifiers.filter((i) => IDENTIFIER.test(i)))]
      const out = []
      for (let at = 0; at < wanted.length; at += LINEAR_RECIPE_LIMITS.identifiersPerQuery) {
        const { list, query } = issuesQuery(wanted.slice(at, at + LINEAR_RECIPE_LIMITS.identifiersPerQuery))
        const { data } = await gql('issues', query)
        list.forEach((_, n) => {
          const i = data[`i${n}`]
          if (!i) return
          out.push({
            id: i.id, identifier: clip(i.identifier, 20), title: clip(i.title, 200), url: https(i.url), done: ['completed', 'canceled'].includes(i.state?.type), state: { type: clip(i.state?.type || '', 20), name: clip(i.state?.name || '', 40) },
            project: i.project ? { id: i.project.id, name: clip(i.project.name, 120), url: https(i.project.url), progress: Number.isFinite(i.project.progress) ? Math.round(i.project.progress * (i.project.progress <= 1 ? 100 : 1)) : null } : null,
            team: clip(i.team?.key || '', 10),
          })
        })
      }
      return out
    },

    ...(writable && {
      /** Moves one issue to one workflow state (perform only). */
      async updateIssueState(issueId, stateId) {
        const { data } = await gql('issueUpdate', QUERIES.updateIssueState, { id: idOk(issueId), stateId: idOk(stateId) })
        if (!data.issueUpdate?.success) throw new LinearRecipeError('refused', 422)
        return { ref: data.issueUpdate.issue?.identifier || issueId }
      },
      /** Adds one comment to one issue (perform only). */
      async createComment(issueId, body) {
        const { data } = await gql('commentCreate', QUERIES.createComment, { issueId: idOk(issueId), body: String(body).slice(0, 2000) })
        if (!data.commentCreate?.success) throw new LinearRecipeError('refused', 422)
        return { ref: https(data.commentCreate.comment?.url) || issueId }
      },
    }),
  }
}
