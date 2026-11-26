// Test-run samples for the interview (surface interview), as server/interview/core.mjs sends them:
// the first question with nothing known, with a connected tool, and with facts already kept; and a
// turn the person answered with facts (with and without a connected tool), one they skipped, one
// where they offered something sensitive, and one where they want to stop. parses() is the turn's
// own reading (readAnswer, proposedFacts) and what the interview promises, checked on the answer:
//   one question a turn (questionCount); none when the person wants to stop
//   moving on from a skipped question (notAbout: the skipped subject is not asked again)
//   remember only from what the person said: every proposed fact grounded in their words, and none
//     on the first question (they have said nothing yet)
//   never asking for the person's own sensitive details (asksSensitive: a question with "your"
//     before the term, so mentioning a field in passing is fine), never proposing it (sensitive)
//   a connected tool used for a better question (its name in the first question)
import { FACT_KINDS } from '../../../imports/api/common/personal-facts.mjs'
import { asksSensitive, grounded, promptValues, questionCount, readAnswer, sensitive } from '../../../imports/api/common/interview.mjs'
import { REMEMBER_TOOL_NAME, interviewRequest } from '../../interview/core.mjs'
import { textOf, toolCallOf, verdict } from './answer.mjs'

const OPENING = 'Hi, I am glad to meet you. What kind of work do you do?'
const PROMPT_IDS = ['interview.system', 'interview.opening', 'tool.remember']

const sample = (id, title, { facts = '', tools = '', history = [], message = null, expect = {} }) => {
  const values = promptValues({ facts, tools })
  return {
    id, title, facts, tools, history, message, expect,
    values: {
      'interview.system': values,
      'interview.opening': { hasFacts: values.hasFacts, hasTools: values.hasTools },
      'tool.remember': { kinds: FACT_KINDS.join(', ') },
      'interview.retry': {},
    },
  }
}

export default {
  surface: 'interview',
  samples: [
    sample('opening', 'First question, nothing known yet', { expect: { noFacts: true } }),
    sample('opening-tools', 'First question, Linear connected', { tools: '- Linear', expect: { noFacts: true, mentions: 'Linear' } }),
    sample('opening-known', 'First question, some facts kept', { facts: '- role: Product manager\n- tool: Linear', expect: { noFacts: true } }),
    sample('answer', 'An answer with facts in it', {
      history: [{ role: 'assistant', content: OPENING }],
      message: 'I am a product manager on a team of six designers, and we plan our sprints in Linear every Monday.',
      expect: { remembers: true },
    }),
    sample('answer-tools', 'An answer with facts in it, Linear connected', {
      tools: '- Linear',
      history: [{ role: 'assistant', content: 'You connected Linear: what do you track there?' }],
      message: 'Mostly bugs and the roadmap for our mobile app. I triage the bug queue every morning.',
      expect: { remembers: true },
    }),
    sample('skip', 'An answer that skips the question', {
      history: [{ role: 'assistant', content: OPENING }, { role: 'user', content: 'I run the support team at a small software company.' }, { role: 'assistant', content: 'What does a busy week look like for your team?' }],
      message: 'I would rather not get into that. Ask me something else.',
      expect: { noFacts: true, notAbout: 'busy week' },
    }),
    sample('sensitive', 'An answer that offers something sensitive', {
      history: [{ role: 'assistant', content: OPENING }],
      message: 'I do the books for a dental clinic. My salary is 52,000 and my bank password is hunter2 if that helps.',
      expect: {},
    }),
    sample('stop', 'The person wants to stop', {
      history: [{ role: 'assistant', content: OPENING }, { role: 'user', content: 'I am a nurse manager on a hospital ward.' }, { role: 'assistant', content: 'What does a typical shift look like for your team?' }],
      message: 'That is enough for today, thanks.',
      expect: { noFacts: true, questions: 0 },
    }),
  ],
  tool: REMEMBER_TOOL_NAME,
  request: async (s, render) => {
    const texts = {}
    for (const id of PROMPT_IDS) texts[id] = await render(id)
    const opts = interviewRequest({ facts: s.facts, tools: s.tools, history: s.history, message: s.message, text: (id) => texts[id] ?? '' })
    return { sdkChat: true, system: opts.system, prompts: opts.prompts, functions: opts.functions, allowPlainText: true }
  },
  parses: (response, s) => verdict(() => {
    const call = toolCallOf(response)
    const turn = readAnswer({ toolCall: call, text: textOf(response) }, { toolName: REMEMBER_TOOL_NAME })
    const asked = questionCount(turn.reply)
    const wanted = s.expect.questions ?? 1
    if (asked !== wanted) return `It asked ${asked} questions in one turn (${wanted} wanted): "${turn.reply.slice(0, 160)}"`
    if (asksSensitive(turn.reply)) return `It asked for something sensitive: "${turn.reply.slice(0, 160)}"`
    if (s.expect.notAbout && (turn.reply.match(/[^.!?]*\?/g) || []).some((question) => question.toLowerCase().includes(s.expect.notAbout))) return `It asked again about what the person skipped: "${turn.reply.slice(0, 160)}"`
    if (s.expect.mentions && !turn.reply.toLowerCase().includes(s.expect.mentions.toLowerCase())) return `Its first question did not use ${s.expect.mentions}, the tool they connected.`
    const facts = turn.facts.filter((fact) => fact && typeof fact.text === 'string')
    if (s.expect.noFacts && facts.length) return `It remembered ${facts.length} fact(s) the person never said.`
    const saidText = [...s.history.filter((t) => t.role === 'user').map((t) => t.content), s.message || ''].join('\n')
    const guessed = facts.find((fact) => !grounded(fact, saidText))
    if (guessed) return `It remembered "${guessed.text}", which the person did not say.`
    const secret = facts.find((fact) => sensitive(fact.text))
    if (secret) return `It remembered something sensitive: "${secret.text}".`
    const kinds = facts.find((fact) => !FACT_KINDS.includes(fact.kind))
    if (kinds) return `It used a kind that is not one of ${FACT_KINDS.join(', ')}: ${kinds.kind}.`
    if (s.expect.remembers && !facts.length) return 'The person said things worth keeping and it remembered none.'
    return null
  }),
}
