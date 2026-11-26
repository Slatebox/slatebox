// Test-run samples for For you (surface personal.suggest), as server/personal/core.mjs sends them:
// a product manager with Linear connected, a teacher with nothing connected, someone known only by
// the tools they connected, someone who mentions a tool they did not connect, someone whose About
// you holds something sensitive, and someone who turned ideas down. parses() is the suggestion's own
// check (readIdeasCall, ideasFrom) held strictly: every idea the agent gave must survive it, so the
// eval fails on any idea that
//   is not tied to what the person said or connected (its why, its title and brief in their words),
//   is generic (a board's shape as its title),
//   names a tool they did not connect,
//   holds something sensitive,
//   repeats another or one they turned down;
// and on fewer than the minimum.
import { IDEA_KINDS, IDEA_LIMITS, ideaKey, ideasFrom, readIdeasCall, suggestValues } from '../../../imports/api/common/personal-ideas.mjs'
import { SUGGEST_TOOL_NAME, dismissedLines, suggestRequest } from '../../personal/core.mjs'
import { toolCallOf, verdict } from './answer.mjs'

const PROMPT_IDS = ['personal.suggest.system', 'personal.suggest.ask', 'tool.suggest_ideas']
const bounds = { min: IDEA_LIMITS.min, max: IDEA_LIMITS.max }

const sample = (id, title, { facts = '', tools = [], dismissed = [], expect = {} }) => {
  const turnedDown = dismissedLines(dismissed.map((d) => d.title))
  return {
    id, title, facts, tools, dismissed, expect,
    values: {
      'personal.suggest.system': { ...bounds, ...suggestValues({ facts, tools }) },
      'personal.suggest.ask': { hasDismissed: Boolean(turnedDown), ...(turnedDown && { dismissed: turnedDown }) },
      'tool.suggest_ideas': { ...bounds, kinds: IDEA_KINDS.join(', ') },
      'personal.suggest.retry': { ...bounds, problem: '2 of the ideas could be used; 1 had a title anyone would get.' },
    },
  }
}
const tool = (name) => ({ name, cardId: name.toLowerCase(), kind: 'mcp' })

export default {
  surface: 'personal.suggest',
  samples: [
    sample('pm-linear', 'A product manager who plans sprints in Linear (Linear connected)', {
      facts: '- role: Product manager\n- team: Six designers on the mobile app\n- routine: Plans sprints in Linear every Monday\n- work: Triages the bug queue every morning',
      tools: [tool('Linear')],
    }),
    sample('teacher', 'A teacher, nothing connected', {
      facts: '- role: 4th grade teacher\n- routine: Gives a Spanish vocabulary quiz every Friday\n- goal: Get every student reading chapter books by June',
    }),
    sample('tools-only', 'Known only by the tools they connected (Notion and Slack)', { tools: [tool('Notion'), tool('Slack')] }),
    sample('unconnected-tool', 'Mentions Jira but connected only GitHub', {
      facts: '- role: Backend engineer\n- tool: Tracks tickets in Jira\n- routine: Reviews pull requests before lunch',
      tools: [tool('GitHub')],
    }),
    sample('sensitive', 'About you holds something sensitive', {
      facts: '- role: Bookkeeper at a dental clinic\n- other: My salary is 52,000 a year\n- routine: Closes the month on the last Friday',
    }),
    sample('dismissed', 'Some ideas turned down already', {
      facts: '- role: Product manager\n- routine: Plans sprints in Linear every Monday\n- project: Launching the mobile app in March',
      tools: [tool('Linear')],
      dismissed: [{ key: ideaKey({ kind: 'component', title: 'Monday sprint planning' }), title: 'Monday sprint planning' }],
    }),
  ],
  tool: SUGGEST_TOOL_NAME,
  request: async (s, render) => {
    const texts = {}
    for (const id of PROMPT_IDS) texts[id] = await render(id)
    const opts = suggestRequest({ facts: s.facts, tools: s.tools, dismissed: s.dismissed.map((d) => d.key), dismissedTitles: s.dismissed.map((d) => d.title), text: (id) => texts[id] ?? '' })
    return { system: opts.system, prompts: opts.prompts, functions: opts.functions, function_call: opts.function_call }
  },
  parses: (response, s) => verdict(() => {
    const raw = readIdeasCall(toolCallOf(response), { toolName: SUGGEST_TOOL_NAME })
    const { ideas, dropped } = ideasFrom(raw, { facts: s.facts, tools: s.tools, dismissed: s.dismissed.map((d) => d.key) })
    if (dropped.tools) return `${dropped.tools} idea(s) named a tool the person did not connect.`
    if (dropped.sensitive) return `${dropped.sensitive} idea(s) held something sensitive.`
    if (dropped.ungrounded) return `${dropped.ungrounded} idea(s) were not tied to what the person said or connected.`
    if (dropped.generic) return `${dropped.generic} idea(s) were generic.`
    if (dropped.dismissed) return `${dropped.dismissed} idea(s) had been turned down already.`
    if (dropped.repeated) return `${dropped.repeated} idea(s) repeated another.`
    if (dropped.shape) return `${dropped.shape} idea(s) were missing a kind, title, why or brief.`
    if (ideas.length < IDEA_LIMITS.min) return `It gave ${ideas.length} usable ideas; at least ${IDEA_LIMITS.min} are wanted.`
    return null
  }),
}
