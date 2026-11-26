// Test runs and the eval gate for prompts (spec 3.6, 6.5). A test run renders a candidate version of
// one prompt into the request its surface sends (fixtures/<surface>.mjs), with every other prompt at
// its live version, sends it through the chosen surface's binding, and reports the rendered request,
// the raw answer, whether the surface's own check accepts it, the latency and the cost. The answer
// is shown, never applied. The eval gate runs the surface's cases (evals/<surface>.mjs) the same way
// and blocks a publish on a deterministic failure.
//
// Pure apart from the injected request: index.mjs gives it req() inside runAIAction (admin.test).
import { renderTemplate } from './render.mjs'
import { lintPrompt } from './lint.mjs'
import { textOf, toolCallOf } from './fixtures/answer.mjs'

export const EVAL_BUDGET_MICROS = 200_000
const UNUSABLE_TURN = 'An answer that could not be used.'

export class PromptTestError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'PromptTestError'
    this.status = status
  }
}

/**
 * Builds the request for one sample with the candidate in place of the prompt under test.
 * prompt: the registry row; candidate: { body, variables } (the version under test); fixture,
 * sample; live(id, values): the live text of any other prompt. → { request, used: Set, rendered }
 */
export async function buildTestRequest({ prompt, candidate, fixture, sample, live }) {
  const used = new Set()
  const cache = new Map()
  const render = async (id, explicit) => {
    used.add(id)
    if (!explicit && cache.has(id)) return cache.get(id)
    let values = explicit ?? sample.values?.[id] ?? {}
    if (typeof values === 'function') values = await values(render)
    const text = id === prompt.id ? renderTemplate(candidate.body, values, candidate.variables ?? null) : live(id, values)
    if (!explicit) cache.set(id, text)
    return text
  }
  const request = await fixture.request(sample, render)
  // a retry prompt is sent after an answer that could not be used, as the call site does
  if (prompt.kind === 'retry') {
    request.prompts = [...(request.prompts || []), { role: 'assistant', content: UNUSABLE_TURN }, { role: 'user', content: await render(prompt.id) }]
  }
  return { request, used }
}

/**
 * One test run. deps.request(opts, { surface }) → req()'s answer; deps.costOf?({ model, usage }).
 * → { sample, surface, rendered: { system, prompts, tools }, answer: { text, toolCall, abort? },
 *     parses: { ok, problem? }, latencyMs, model, costMicros, lint }
 */
export async function runPromptTest({ prompt, candidate, fixture, sampleId = null, surface = null, live, request, costOf = null, now = Date.now }) {
  if (!fixture) throw new PromptTestError(`There are no samples for ${prompt.surface} yet.`, 404)
  const sample = sampleId ? fixture.samples.find((s) => s.id === sampleId) : fixture.samples[0]
  if (!sample) throw new PromptTestError(`There is no sample ${sampleId} for ${prompt.surface}. Samples: ${fixture.samples.map((s) => s.id).join(', ')}.`, 404)
  const { request: opts, used } = await buildTestRequest({ prompt, candidate, fixture, sample, live })
  if (!used.has(prompt.id)) throw new PromptTestError(`The sample "${sample.title}" does not use this prompt. Choose another sample.`)
  const rendered = { system: opts.system ?? null, prompts: opts.prompts, tools: (opts.functions || []).map((f) => ({ name: f.name, description: f.description })) }
  const lint = lintPrompt({ ...prompt, body: candidate.body, variables: candidate.variables ?? prompt.variables }, { codeVariables: prompt.variables })
  // A voice part's session (fixtures/voice.mjs): no realtime model is asked here; the rendered
  // session is shown, and the surface's check reads it instead of an answer.
  if (fixture.sessionOnly) {
    return {
      sample: sample.id, sampleTitle: sample.title, surface: surface || prompt.surface,
      rendered: { ...rendered, session: opts.session ?? null }, answer: { text: '', toolCall: null, sessionOnly: true },
      parses: await fixture.parses(opts, sample), latencyMs: 0, model: null, costMicros: 0, lint,
    }
  }
  const started = now()
  const response = await request(opts, { surface: surface || prompt.surface })
  const latencyMs = Math.max(0, now() - started)
  const call = toolCallOf(response)
  const answer = response?.abort
    ? { abort: true, text: response.abortMessage || 'The model could not answer.', toolCall: null }
    : { text: textOf(response).slice(0, 8000), toolCall: call }
  const parses = response?.abort ? { ok: false, problem: answer.text } : await fixture.parses(response, sample)
  const model = response?.model || response?.chosen || null
  const costMicros = costOf && response?.usage ? (costOf({ model, usage: response.usage })?.costMicros ?? 0) : 0
  return {
    sample: sample.id, sampleTitle: sample.title, surface: surface || prompt.surface,
    rendered, answer, parses, latencyMs, model, costMicros, lint,
  }
}

// The checks an eval case names. Deterministic ones block a publish; the rest are reported.
function check(name, run, toolName) {
  if (typeof name === 'object' && name?.maxLatencyMs) {
    return { check: `answers within ${name.maxLatencyMs} ms`, ok: run.latencyMs <= name.maxLatencyMs, blocking: false }
  }
  switch (name) {
    case 'renders': return { check: 'renders', ok: true, blocking: true }
    // the candidate's own text: no placeholder tokens, no undeclared values, nothing the lint blocks
    case 'noPlaceholders': return { check: 'no placeholders or lint problems in the prompt', ok: !run.lint.blocking.length, blocking: true, ...(run.lint.blocking.length && { problem: run.lint.blocking[0] }) }
    case 'answered': return { check: 'the model answered', ok: !run.answer.abort, blocking: true, ...(run.answer.abort && { problem: run.answer.text }) }
    case 'toolCalled': return { check: `called ${toolName}`, ok: run.answer.toolCall?.name === toolName, blocking: true }
    case 'parses': return { check: 'the answer is one this part of Slatebox can use', ok: run.parses.ok, blocking: true, ...(run.parses.problem && { problem: run.parses.problem }) }
    default: return { check: String(name), ok: true, blocking: false }
  }
}

/**
 * The eval gate: every case of the surface whose sample uses the prompt, against the binding's
 * primary model, within a cost budget (EVAL_BUDGET_MICROS, charged to the administrator).
 * → { at, passed, failed, cases: [{ name, sample, passed, checks, latencyMs, costMicros, error? }], costMicros, skipped }
 */
export async function runEvals({ prompt, candidate, fixture, cases, live, request, costOf = null, now = Date.now, budgetMicros = EVAL_BUDGET_MICROS }) {
  const out = []
  let spent = 0
  let skipped = 0
  for (const kase of cases || []) {
    if (spent >= budgetMicros) {
      out.push({ name: kase.name, sample: kase.sample, passed: false, checks: [], error: 'Stopped: the eval budget for one publish was spent.' })
      continue
    }
    const sample = fixture?.samples.find((s) => s.id === kase.sample)
    if (!sample) continue
    const { used } = await buildTestRequest({ prompt, candidate, fixture, sample, live }).catch(() => ({ used: new Set([prompt.id]) }))
    if (!used.has(prompt.id)) {
      skipped += 1
      continue
    }
    try {
      const run = await runPromptTest({ prompt, candidate, fixture, sampleId: kase.sample, live, request, costOf, now })
      spent += run.costMicros || 0
      const toolName = fixture.toolFor ? fixture.toolFor(sample) : fixture.tool
      const checks = (kase.assert || []).map((name) => check(name, run, toolName))
      out.push({ name: kase.name, sample: kase.sample, passed: checks.every((c) => c.ok || !c.blocking), checks, latencyMs: run.latencyMs, costMicros: run.costMicros, answer: run.answer.toolCall ? { toolCall: run.answer.toolCall.name } : { text: run.answer.text.slice(0, 300) } })
    } catch (error) {
      // a candidate that does not render fails "renders"; anything else fails the case
      const renders = error?.name === 'PromptVarsError' || error?.name === 'TemplateError'
      out.push({ name: kase.name, sample: kase.sample, passed: false, checks: [{ check: 'renders', ok: !renders, blocking: true }], error: error?.message || String(error) })
    }
  }
  const failed = out.filter((c) => !c.passed).length
  return { at: new Date(now()), passed: out.length - failed, failed, cases: out, costMicros: spent, skipped }
}
