// A fake of Linear's GraphQL endpoint (https://api.linear.app/graphql) for the Linear recipe tests:
// it answers the vendor's fixed queries (by operation name) from the sample workspace
// (enterprise/recipes/_linear/fixtures/acme.mjs), with paging, partial answers for unknown
// identifiers, a 401 or a rate limit on demand, and records every call and mutation.
import { BLOCKING_ISSUES, CYCLE, CYCLE_ISSUES, P, PROJECTS, RELEASE_ISSUES, STATES, TEAMS, uuid } from '../../enterprise/recipes/_linear/fixtures/acme.mjs'

const page = (list, after, size) => {
  const at = after ? Number(after) : 0
  const nodes = list.slice(at, at + size)
  return { nodes, pageInfo: { hasNextPage: at + size < list.length, endCursor: String(at + size) } }
}

/**
 * A fake https://api.linear.app/graphql. opts: { pageSize, token, unauthorizedOnce, rateLimited,
 *   noInitiatives, workspace overrides (projects, blockers, cycleIssues, cycle) }. → { fetch, calls, mutations }
 */
export function fakeLinear(opts = {}) {
  const calls = []
  const mutations = []
  const size = opts.pageSize || 1000
  let unauthorized = Boolean(opts.unauthorizedOnce)
  const projects = opts.projects || PROJECTS
  const blockers = opts.blockers || BLOCKING_ISSUES
  const answer = (status, body) => ({ status, ok: status < 300, text: async () => JSON.stringify(body), json: async () => body })
  async function fetch(url, init) {
    const body = JSON.parse(init.body)
    const op = /^(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1]
    calls.push({ url, op, variables: body.variables, auth: init.headers.authorization })
    if (unauthorized) {
      unauthorized = false
      return answer(401, { errors: [{ message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } }] })
    }
    if (opts.rateLimited) return answer(400, { errors: [{ message: 'Rate limit exceeded', extensions: { code: 'RATELIMITED' } }] })
    const v = body.variables || {}
    if (op === 'Teams') return answer(200, { data: { teams: { nodes: Object.values(TEAMS) } } })
    if (op === 'Projects' || op === 'ProjectsWithInitiatives') {
      if (op === 'ProjectsWithInitiatives' && opts.noInitiatives) return answer(200, { data: null, errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] })
      const teams = new Set(v.teams || [])
      // the query's status filter, as Linear applies it: closed projects are not in the list
      const openOnly = /status: \{ type: \{ nin: \["completed", "canceled"\] \} \}/.test(body.query)
      const list = projects.filter((p) => !teams.size || p.teams.nodes.some((t) => teams.has(t.id))).filter((p) => !openOnly || !['completed', 'canceled'].includes(p.status?.type)).map((p) => (op === 'Projects' ? { ...p, initiatives: undefined } : p))
      return answer(200, { data: { projects: page(list, v.after, size) } })
    }
    if (op === 'Blockers') {
      const want = new Set(v.projects || [])
      return answer(200, { data: { issues: page(blockers.filter((i) => want.has(i.project.id)), v.after, size) } })
    }
    if (op === 'ActiveCycle') {
      // read on every call, so a test can roll the cycle over or change its issues between runs
      const cycleIssues = opts.cycleIssues || CYCLE_ISSUES
      const cycle = opts.cycle === undefined ? CYCLE : opts.cycle
      const team = Object.values(TEAMS).find((t) => t.id === v.team)
      if (!team) return answer(200, { data: { team: null } })
      return answer(200, { data: { team: { ...team, states: { nodes: STATES }, activeCycle: cycle && team.key === 'ENG' ? { ...cycle, issues: page(cycleIssues, v.after, size) } : null } } })
    }
    if (op === 'IssuesByIdentifier') {
      const known = opts.issues || RELEASE_ISSUES
      const issueOf = (id) => {
        const k = known[id]
        const p = k.project ? projects.find((x) => x.id === P[k.project]) : null
        return { id: uuid(9000 + Number(id.split('-')[1])), identifier: id, number: Number(id.split('-')[1]), title: `Issue ${id}`, url: `https://linear.app/acme/issue/${id}`, completedAt: k.done ? '2026-11-20T00:00:00.000Z' : null, state: { type: k.done ? 'completed' : 'started', name: k.done ? 'Done' : 'In Progress' }, project: p ? { id: p.id, name: p.name, url: p.url, progress: p.progress } : null, team: { key: id.split('-')[0] } }
      }
      // Aliased issue(id:) lookups, as real Linear answers them: issue(id:) is Issue!, so one
      // identifier it does not have nulls the whole answer (GraphQL's non-null propagation).
      const aliased = [...body.query.matchAll(/(i\d+): issue\(id: "([^"]+)"\)/g)]
      if (aliased.length) {
        const missing = aliased.filter(([, , id]) => !known[id])
        if (missing.length) return answer(200, { data: null, errors: missing.map(([, alias]) => ({ message: 'Entity not found: Issue', path: [alias], extensions: { code: 'INPUT_ERROR' } })) })
        return answer(200, { data: Object.fromEntries(aliased.map(([, alias, id]) => [alias, issueOf(id)])) })
      }
      // issues(filter: { or: [{ team: { key: { eq } }, number: { in } }] }): the ones there, nothing for the rest
      const wanted = (v.filter?.or || []).flatMap((f) => (f.number?.in || []).map((n) => `${f.team?.key?.eq}-${n}`))
      return answer(200, { data: { issues: { nodes: wanted.filter((id) => known[id]).slice(0, v.first || 50).map(issueOf) } } })
    }
    if (op === 'UpdateIssueState') {
      mutations.push({ op, variables: v })
      return answer(200, { data: { issueUpdate: { success: true, issue: { id: v.id, identifier: 'ENG-200', state: { id: v.stateId, type: 'started' } } } } })
    }
    if (op === 'CreateComment') {
      mutations.push({ op, variables: v })
      return answer(200, { data: { commentCreate: { success: true, comment: { id: uuid(9999), url: 'https://linear.app/acme/issue/ENG-200#comment-1' } } } })
    }
    return answer(400, { errors: [{ message: 'Unknown query', extensions: { code: 'INPUT_ERROR' } }] })
  }
  return { fetch, calls, mutations }
}

