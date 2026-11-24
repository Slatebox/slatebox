// Prompts an administrator edits (spec 1.6, 3.6, 4): drafts, test runs, the eval gate, publish and
// rollback, every change through store.mjs (the document, its audit row and the generation in one
// call, so every pod serves the change within one poll).
//   - A version is only ever added (aiPromptVersions, immutable apart from its status): a draft
//     changes nothing live. Version 0 is the built-in text and is never stored.
//   - Publishing moves the head's published label (aiPrompts labels { published, previous }) after the
//     lint (never overridable) and the surface's eval cases (overridable with a reason, recorded).
//   - Rollback moves the label to an earlier version, or to the built-in text (0).
//   - An agent may save drafts (marked as suggestions) and run tests; only a person publishes or
//     rolls back (the actions are person-only).
// A version's variables are the built-in version's, those its text uses: the call site gives only
// those values, so a version cannot ask for one the code does not have. Text from a person, a slate
// or an outside service may be switched to wrap 'data' per variable.
//
// Pure apart from the injected collections, store and request.
import { ModelError } from './models.mjs'
import { surface as surfaceById } from './catalogue.mjs'
import { BINDABLE_SURFACES } from './bindings.mjs'
import { TemplateError, templateNames } from './render.mjs'
import { MAX_BODY, lintPrompt } from './lint.mjs'
import { PromptTestError, buildTestRequest, runEvals, runPromptTest } from './prompt-tests.mjs'

const NOTE_MAX = 200
const fail = (message, status = 400, details) => { throw new ModelError(message, status, details) }

/**
 * deps: {
 *   store       store.mjs createControlStore
 *   prompts     the aiPrompts collection; versions the aiPromptVersions collection (find → toArray, findOne, updateOne)
 *   registry    prompts/registry.mjs (the built-in prompts, and resolved(id): the version served now)
 *   live(id, values)  the text a call site gets now (prompts/index.mjs promptText)
 *   fixtureFor(surface), evalsFor(surface)
 *   request(opts, { surface, actor }) → req()'s answer, metered to the administrator (admin.test)
 *   costOf?({ model, usage }), snapshot?() for health, testLimit?: { take(userId) }, now?()
 * }
 */
export function createPromptOps({ store, prompts, versions, registry, live, fixtureFor, evalsFor, request, costOf = null, snapshot = () => ({ health: [] }), testLimit = null, now = () => new Date() }) {
  const known = (id) => registry.byId[id] || fail(`There is no prompt ${id}.`, 404)

  async function versionsOf(id) {
    return (await versions.find({ promptId: id }).toArray()).sort((a, b) => b.version - a.version)
  }

  /** A version's variables: the built-in declaration of each value its text uses, with any wrap chosen. */
  function variablesFor(prompt, body, wrap = null) {
    let names
    try {
      names = templateNames(body).all
    } catch (error) {
      fail(`The text does not parse: ${error.message}`)
    }
    const out = {}
    for (const name of names) {
      const code = prompt.variables[name]
      if (!code) continue
      out[name] = { ...code, ...(wrap?.[name] && { wrap: wrap[name] }) }
    }
    return out
  }

  /** The version under test or published: 0 (built in), a stored one, or text sent with the call. */
  async function candidateOf(prompt, { version = null, body = null, wrap = null }) {
    if (typeof body === 'string') return { version: null, body, variables: variablesFor(prompt, body, wrap), origin: 'unsaved' }
    if (version === 0 || version === null) return { version: 0, body: prompt.body, variables: prompt.variables, origin: 'code' }
    const row = await versions.findOne({ _id: `${prompt.id}@${version}` })
    if (!row) fail(`There is no version ${version} of ${prompt.id}.`, 404)
    return { version: row.version, body: row.body, variables: row.variables || {}, origin: row.origin || 'admin', row }
  }

  const lintOf = (prompt, candidate) => lintPrompt({ kind: prompt.kind, body: candidate.body, variables: candidate.variables }, { codeVariables: prompt.variables })
  const head = (id) => prompts.findOne({ _id: id })

  /** The Prompts tab: every prompt by surface, with what is live, its draft and where it comes from. */
  async function list() {
    const heads = Object.fromEntries((await prompts.find({}).toArray()).map((h) => [h._id, h]))
    const drafts = {}
    for (const row of await versions.find({ status: 'draft' }).toArray()) {
      if (!drafts[row.promptId] || row.version > drafts[row.promptId].version) drafts[row.promptId] = row
    }
    const health = snapshot()?.health || []
    const groups = new Map()
    for (const prompt of registry.list) {
      const stored = heads[prompt.id]
      const published = stored?.labels?.published ?? null
      const draft = drafts[prompt.id] && drafts[prompt.id].version > (published ?? 0) ? drafts[prompt.id] : null
      const served = registry.resolved(prompt.id)
      const skipped = health.find((h) => h.kind === 'prompt' && h.id === prompt.id)
      if (!groups.has(prompt.surface)) groups.set(prompt.surface, { surface: prompt.surface, title: surfaceById(prompt.surface)?.title || prompt.surface, prompts: [] })
      groups.get(prompt.surface).prompts.push({
        id: prompt.id, kind: prompt.kind, slot: prompt.slot, title: prompt.title,
        published: published ?? 0, previous: stored?.labels?.previous ?? null,
        live: { version: served.version, source: served.source },
        draft: draft ? { version: draft.version, origin: draft.origin || 'admin', createdBy: draft.createdBy ?? null, createdAt: draft.createdAt ?? null } : null,
        ...(skipped && { problem: skipped.problem }),
      })
    }
    return { surfaces: [...groups.values()] }
  }

  /** One prompt: the built-in text, what is served now and from where, its versions, samples. */
  async function get({ id }) {
    const prompt = known(id)
    const [stored, rows] = await Promise.all([head(id), versionsOf(id)])
    const served = registry.resolved(id)
    const fixture = fixtureFor(prompt.surface)
    return {
      id, surface: prompt.surface, surfaceTitle: surfaceById(prompt.surface)?.title || prompt.surface,
      kind: prompt.kind, slot: prompt.slot, title: prompt.title,
      labels: { published: stored?.labels?.published ?? null, previous: stored?.labels?.previous ?? null },
      code: { version: 0, body: prompt.body, variables: prompt.variables },
      live: { version: served.version, source: served.source, body: served.body, variables: served.variables ?? {} },
      versions: rows.slice(0, 50).map((row) => ({
        version: row.version, status: row.status, body: row.body, variables: row.variables || {}, note: row.note ?? null,
        origin: row.origin || 'admin', createdBy: row.createdBy ?? null, createdByPrincipal: row.createdByPrincipal ?? null,
        createdAt: row.createdAt ?? null, evalRun: row.evalRun ?? null,
      })),
      samples: (fixture?.samples || []).map((s) => ({ id: s.id, title: s.title })),
      testSurfaces: [prompt.surface, ...BINDABLE_SURFACES.filter((s) => s !== prompt.surface)],
      evalCases: (evalsFor(prompt.surface) || []).map((c) => ({ name: c.name, sample: c.sample })),
    }
  }

  /** Saves a draft version: nothing live changes. An agent's draft is a suggestion. → { id, version, status, origin, lint } */
  async function saveDraft({ actor, id, body, wrap = null, note = null }) {
    const prompt = known(id)
    if (typeof body !== 'string' || !body.trim()) fail('The text is empty.')
    if (body.length > MAX_BODY) fail(`The text is at most ${MAX_BODY} characters.`)
    if (note !== null && (typeof note !== 'string' || note.length > NOTE_MAX || /[\r\n]/.test(note))) fail(`note is one line of at most ${NOTE_MAX} characters.`)
    for (const [name, value] of Object.entries(wrap || {})) {
      if (!prompt.variables[name]) fail(`{{${name}}} is not a value this prompt is given.`)
      if (!['none', 'data'].includes(value)) fail('wrap is none or data.')
    }
    const variables = variablesFor(prompt, body, wrap)
    if (!(await head(id))) {
      await store.write({ kind: 'prompts', id, doc: { surface: prompt.surface, kind: prompt.kind, title: prompt.title, labels: { published: null, previous: null }, status: 'active' }, action: 'ai.prompts.saveDraft', actor, target: { kind: 'prompt', id } })
    }
    const origin = actor.principal === 'agent' ? 'ai-proposal' : 'admin'
    for (let tries = 0; ; tries += 1) {
      const rows = await versionsOf(id)
      const version = (rows[0]?.version ?? 0) + 1
      const doc = {
        promptId: id, version, body, variables, note: note?.trim() || null, origin, status: 'draft', evalRun: null,
        createdBy: actor.userId ?? null, createdByPrincipal: actor.principal, ...(actor.tokenId && { tokenId: actor.tokenId }), createdAt: now(),
      }
      try {
        await store.write({ kind: 'promptVersions', id: `${id}@${version}`, doc, action: 'ai.prompts.saveDraft', actor, target: { kind: 'prompt', id }, create: true })
        return { id, version, status: 'draft', origin, lint: lintOf(prompt, { body, variables }) }
      } catch (error) {
        if (error?.code !== 'conflict' || tries >= 4) throw error
      }
    }
  }

  const asTestProblem = (error) => {
    if (error instanceof PromptTestError) return new ModelError(error.message, error.status)
    if (error?.name === 'PromptVarsError' || error instanceof TemplateError) return new ModelError(`This version does not render: ${error.message}`)
    return error
  }

  /**
   * Renders a version into a sample's request, with no model call (the editor's live view).
   * → { sample, rendered, lint, error? }: a version that does not render gives rendered null and why.
   */
  async function render({ id, version = null, body = null, wrap = null, sample = null }) {
    const prompt = known(id)
    let candidate
    if (typeof body === 'string') {
      // text being edited: lint it whatever it is (it may not parse yet)
      let variables = {}
      try { variables = variablesFor(prompt, body, wrap) } catch {}
      candidate = { version: null, body, variables }
    } else {
      candidate = await candidateOf(prompt, { version, body, wrap })
    }
    const fixture = fixtureFor(prompt.surface)
    const lint = lintOf(prompt, candidate)
    if (!fixture) return { sample: null, rendered: null, lint }
    const chosen = (sample && fixture.samples.find((s) => s.id === sample)) || fixture.samples[0]
    let built
    try {
      built = await buildTestRequest({ prompt, candidate, fixture, sample: chosen, live })
    } catch (error) {
      const said = asTestProblem(error)
      if (said instanceof ModelError) return { sample: chosen.id, rendered: null, lint, error: said.message }
      throw said
    }
    if (!built.used.has(id)) fail(`The sample "${chosen.title}" does not use this prompt. Choose another sample.`)
    const opts = built.request
    return { sample: chosen.id, rendered: { system: opts.system ?? null, prompts: opts.prompts, tools: (opts.functions || []).map((f) => ({ name: f.name, description: f.description })) }, lint }
  }

  /** Sends a version with a sample through a surface's binding. The answer is shown, never applied. */
  async function test({ actor, id, version = null, body = null, wrap = null, sample = null, surface = null }) {
    const prompt = known(id)
    if (surface && !BINDABLE_SURFACES.includes(surface)) fail(`${surface} is not a part of Slatebox that can be bound.`)
    testLimit?.take(actor.userId)
    const candidate = await candidateOf(prompt, { version, body, wrap })
    let run
    try {
      run = await runPromptTest({ prompt, candidate, fixture: fixtureFor(prompt.surface), sampleId: sample, surface, live, costOf, now: () => now().getTime(),
        request: (opts, at) => request(opts, { ...at, actor }) })
    } catch (error) {
      throw asTestProblem(error)
    }
    await store.record({ action: 'ai.prompts.test', actor, target: { kind: 'prompt', id }, after: { version: candidate.version, sample: run.sample, surface: run.surface, model: run.model, parses: run.parses.ok, latencyMs: run.latencyMs, costMicros: run.costMicros } })
    return { id, version: candidate.version, ...run }
  }

  async function evaluate(prompt, candidate, actor) {
    return runEvals({ prompt, candidate, fixture: fixtureFor(prompt.surface), cases: evalsFor(prompt.surface), live, costOf, now: () => now().getTime(),
      request: (opts, at) => request(opts, { ...at, actor }) })
  }

  async function setLabel({ actor, id, to, reason, action, evalRun = null }) {
    const prompt = known(id)
    const stored = await head(id)
    const current = stored?.labels?.published ?? null
    const next = to || null
    const doc = {
      surface: prompt.surface, kind: prompt.kind, title: prompt.title, status: 'active',
      labels: { published: next, previous: current === next ? stored?.labels?.previous ?? null : current },
    }
    const result = await store.write({ kind: 'prompts', id, doc, action, actor, reason, evalRun, target: { kind: 'prompt', id } })
    if (next) await versions.updateOne({ _id: `${id}@${next}` }, { $set: { status: 'published', ...(evalRun && { evalRun }) } })
    if (current && current !== next) await versions.updateOne({ _id: `${id}@${current}` }, { $set: { status: 'superseded' } })
    return { id, version: next ?? 0, previous: doc.labels.previous ?? 0, generation: result.generation }
  }

  /**
   * Publishes a saved version: the lint must pass, then the surface's eval cases run on the
   * binding's primary model. A failed case blocks unless override (with the reason, recorded).
   * → { id, version, previous, generation, evalRun }
   */
  async function publish({ actor, id, version, reason, override = false }) {
    const prompt = known(id)
    if (!reason || !String(reason).trim()) fail('Say why: publishing needs a reason.')
    if (!Number.isInteger(version) || version < 1) fail('Publish a saved version (1 or more). To use the built-in text, roll back to version 0.')
    const candidate = await candidateOf(prompt, { version })
    const lint = lintOf(prompt, candidate)
    if (lint.blocking.length) fail(`Version ${version} cannot be published: ${lint.blocking.join(' ')}`, 409, { lint })
    const run = await evaluate(prompt, candidate, actor)
    const evalRun = { at: run.at, passed: run.passed, failed: run.failed, skipped: run.skipped, costMicros: run.costMicros, overridden: Boolean(run.failed && override), cases: run.cases }
    if (run.failed && !override) {
      await store.refused({ action: 'ai.prompts.publish', actor, target: { kind: 'prompt', id }, reason, error: `${run.failed} eval case(s) failed`, trusted: true }).catch(() => {})
      fail(`${run.failed} of ${run.cases.length} checks failed, so version ${version} was not published. Fix the text, or publish anyway with a reason.`, 409, { evalRun })
    }
    const summary = { passed: evalRun.passed, failed: evalRun.failed, overridden: evalRun.overridden, ...(candidate.origin === 'ai-proposal' && { proposedBy: candidate.row?.createdBy ?? null, proposedByToken: candidate.row?.tokenId ?? null }) }
    const out = await setLabel({ actor, id, to: version, reason, action: 'ai.prompts.publish', evalRun: summary })
    return { ...out, evalRun }
  }

  /** Moves the published label back: to an earlier version (checked as a publish is) or to the built-in text (0). */
  async function rollback({ actor, id, toVersion, reason }) {
    const prompt = known(id)
    if (!reason || !String(reason).trim()) fail('Say why: a rollback needs a reason.')
    if (!Number.isInteger(toVersion) || toVersion < 0) fail('toVersion is a version number, or 0 for the built-in text.')
    if (toVersion > 0) {
      const candidate = await candidateOf(prompt, { version: toVersion })
      const lint = lintOf(prompt, candidate)
      if (lint.blocking.length) fail(`Version ${toVersion} cannot be published again: ${lint.blocking.join(' ')} Roll back to the built-in text (0) instead.`, 409, { lint, builtinInstead: true })
    }
    return setLabel({ actor, id, to: toVersion, reason, action: 'ai.prompts.rollback' })
  }

  /** ai.control.reset: one prompt (id) or every prompt back to its built-in text. → { reset: [ids] } */
  async function reset({ actor, id = null, reason }) {
    const heads = id ? [await head(known(id).id)].filter(Boolean) : await prompts.find({}).toArray()
    const done = []
    for (const stored of heads) {
      if (!stored.labels?.published) continue
      await setLabel({ actor, id: stored._id, to: 0, reason, action: 'ai.control.reset' })
      done.push(stored._id)
    }
    return { reset: done }
  }

  return { list, get, saveDraft, render, test, publish, rollback, reset }
}
