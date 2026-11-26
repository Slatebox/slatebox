#!/usr/bin/env node
// The live eval for free-form smart components: every prompt in prompts.mjs, typed on a fresh builder slate of a
// running app, built by whatever model that app is configured to use (settings.ai connections + use, or Admin › AI
// control; this script names no model and holds no key), then checked, kept and drawn on the canvas.
//
// For each prompt, as a disposable signed-in account (one per prompt: the one-draft-a-minute lock is per person):
//   1. library.branch {itemId: 'new'}: an empty builder slate, as /new#build makes;
//   2. nativeCanvas.preview: the builder's own path (builder-freeform.mjs); timed;
//   3. checks: the preview is a board of lanes (play, lanes), its workshop passes validateWorkshop (the one gate),
//      the agent drafted it (provider 'ai', not the starter a failed draft falls back to), its title and pieces
//      come from the words (not the starter's), it says what it made, and its rules are the rulebook's sentences;
//   4. nativeCanvas.keep, then (unless --no-render) the slate opened in a fresh headless browser signed in as that
//      account: every card and lane of the kept board is drawn on #slateCanvas, with no page error;
//   5. latency, and tokens and cost from the app's aiAudit rows for that account (--mongo; cost for a model with a
//      price in --prices or the EVAL_PRICES env, dollars per million tokens: {"<model>": [in, out]}, else in the
//      app's own model table, aiModels).
// The disposable accounts and their slates are removed at the end (--mongo; --keep leaves them).
//
//   node scripts/evals/smart-components/live.mjs --origin http://127.0.0.1:3660 --mongo mongodb://127.0.0.1:3661/meteor \
//     [--only id,id] [--concurrency 3] [--no-render] [--out report.json] [--shots dir] [--keep]
// SLATEBOX_CHROMIUM names a Chromium executable for the render step (as the browser specs read it).
// Exit code: 0 when the pass rate meets --target (default 0.95), else 1.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import '../../../web/app/imports/api/common/library.mjs'
import { builderDescription } from '../../../web/app/imports/api/common/builder-freeform.mjs'
import { previewProblems } from './checks.mjs'
import { DDP } from './ddp.mjs'
import { PROMPTS } from './prompts.mjs'

const { values: args } = parseArgs({
  options: {
    origin: { type: 'string', default: process.env.SLATEBOX_ORIGIN || 'http://127.0.0.1:3660' },
    mongo: { type: 'string', default: process.env.SLATEBOX_MONGO || '' },
    only: { type: 'string', default: '' },
    concurrency: { type: 'string', default: '3' },
    render: { type: 'boolean', default: true },
    'no-render': { type: 'boolean', default: false },
    out: { type: 'string', default: '' },
    shots: { type: 'string', default: '' },
    prices: { type: 'string', default: process.env.EVAL_PRICES || '' },
    target: { type: 'string', default: '0.95' },
    keep: { type: 'boolean', default: false },
    repeat: { type: 'string', default: '1' },
  },
})
const RUN = 'e' + Date.now().toString(36)
const render = args.render && !args['no-render']
const prices = args.prices ? JSON.parse(args.prices) : {}
const only = args.only ? new Set(args.only.split(',')) : null
const cases = PROMPTS.filter((p) => !only || only.has(p.id)).flatMap((p) => Array.from({ length: Number(args.repeat) }, (_, i) => ({ ...p, n: i })))
if (args.shots) mkdirSync(args.shots, { recursive: true })

const mongo = (script) => execFileSync('mongosh', ['--quiet', args.mongo, '--eval', script], { encoding: 'utf8' })

async function renderCheck(token, userId, shareId, workshop, id) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ ...(process.env.SLATEBOX_CHROMIUM && { executablePath: process.env.SLATEBOX_CHROMIUM }) })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    // Signed in as the account that kept the board, the way Meteor resumes a login (a fresh context each time).
    await context.addInitScript(({ token, userId }) => {
      localStorage.setItem('Meteor.loginToken', token)
      localStorage.setItem('Meteor.loginTokenExpires', new Date(Date.now() + 864e5).toString())
      localStorage.setItem('Meteor.userId', userId)
    }, { token, userId })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(args.origin + '/canvas/' + shareId, { waitUntil: 'domcontentloaded', timeout: 90000 })
    const want = workshop.cards.length
    const drawn = async () => page.evaluate((cardIds) => {
      const ids = [...document.querySelectorAll('#slateCanvas [data-node-id]')].map((g) => g.getAttribute('data-node-id'))
      return { notes: new Set(ids).size, cards: cardIds.filter((card) => ids.some((nodeId) => nodeId === card || nodeId.endsWith(card) || nodeId.endsWith(':' + card))).length }
    }, workshop.cards.map((card) => card.id))
    let seen = { notes: 0, cards: 0 }
    const until = Date.now() + 45000
    while (Date.now() < until) {
      seen = await drawn()
      if (seen.cards >= want) break
      await page.waitForTimeout(500)
    }
    await page.waitForTimeout(600)
    if (args.shots) await page.screenshot({ path: join(args.shots, id + '.png') })
    const problems = []
    if (seen.cards < want) problems.push(`drawn on the canvas: ${seen.cards} of ${want} pieces (${seen.notes} notes in all)`)
    if (errors.length) problems.push('page errors: ' + errors.slice(0, 2).join(' | '))
    return { problems, notes: seen.notes }
  } finally { await browser.close() }
}

async function runCase(item, index) {
  const started = Date.now()
  const ddp = await new DDP(args.origin).connect()
  const row = { id: item.id + (item.n ? '#' + item.n : ''), prompt: item.prompt, tags: item.tags, ok: false, problems: [] }
  try {
    const email = `${RUN}-${index}@eval.example.test`
    await ddp.createAccount(email, 'eval-' + RUN + '-' + index + '-' + Math.random().toString(36).slice(2), { firstName: 'Eval', lastName: String(index), name: 'Eval ' + index })
    row.userId = ddp.userId
    const { shareId } = await ddp.call('library.branch', { itemId: 'new' })
    row.shareId = shareId
    if (!builderDescription({ library: { mode: 'build' } }, item.prompt)) row.problems.push('the words do not take the builder path (builderDescription)')
    const t = Date.now()
    let preview
    try { preview = await ddp.call('nativeCanvas.preview', shareId, item.prompt, [], null) }
    catch (error) { row.problems.push(`preview refused: ${error.error}: ${error.reason || error.message}`); return row }
    finally { row.latencyMs = Date.now() - t }
    row.provider = preview.provider
    row.said = preview.said
    row.rules = preview.rules
    const { problems, workshop } = previewProblems(preview, item.prompt)
    row.problems.push(...problems)
    row.validComponent = Boolean(workshop)
    if (workshop) row.board = { title: workshop.title, lanes: workshop.lanes.map((l) => l.label + (l.capacity ? ` (${l.capacity})` : '')), cards: workshop.cards.length, rules: preview.rules?.length ?? 0 }
    if (workshop) {
      await ddp.call('nativeCanvas.keep', shareId, preview.id)
      if (render) {
        const drawn = await renderCheck(ddp.token, ddp.userId, shareId, workshop, row.id)
        row.problems.push(...drawn.problems)
        row.rendered = !drawn.problems.length
      }
    }
    row.ok = !row.problems.length
    return row
  } catch (error) {
    row.problems.push('eval error: ' + (error.reason || error.message))
    return row
  } finally {
    ddp.close()
    row.totalMs = Date.now() - started
  }
}

const rows = []
let next = 0
const workers = Array.from({ length: Math.max(1, Number(args.concurrency)) }, async () => {
  while (next < cases.length) {
    const index = next++
    let row = await runCase(cases[index], index)
    // The eval's own connection dropping (the app restarting under it) is no answer from the app: asked once more.
    if (row.problems.some((p) => /^eval error: DDP connection (closed|failed)/.test(p)) && row.latencyMs === undefined) row = await runCase(cases[index], index + 10000)
    rows[index] = row
    console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.id} ${row.latencyMs ?? '-'}ms${row.board ? ` "${row.board.title}" [${row.board.lanes.join(' | ')}] ${row.board.cards} pieces, ${row.board.rules} rules` : ''}${row.ok ? '' : '\n     ' + row.problems.join('\n     ')}`)
  }
})
await Promise.all(workers)

// Tokens and cost from the app's own audit of every model call (both attempts of a draft), per account.
if (args.mongo) {
  const ids = rows.map((r) => r.userId).filter(Boolean)
  try {
    const audit = JSON.parse(mongo(`JSON.stringify(db.aiAudit.find({userId:{$in:${JSON.stringify(ids)}}},{userId:1,model:1,status:1,usage:1,duration:1,responseStatus:1}).toArray())`))
    // Prices: --prices / EVAL_PRICES first, else the app's own model table (Admin › AI control, aiModels).
    try {
      const table = JSON.parse(mongo('JSON.stringify(db.aiModels.find({},{model:1,prices:1}).toArray())'))
      for (const doc of table) if (!prices[doc.model] && Number.isFinite(doc.prices?.inputPerM) && Number.isFinite(doc.prices?.outputPerM)) prices[doc.model] = [doc.prices.inputPerM, doc.prices.outputPerM]
    } catch {}
    for (const row of rows) {
      const mine = audit.filter((a) => a.userId === row.userId)
      row.calls = mine.length
      row.callStatuses = mine.map((a) => a.status)
      row.inputTokens = mine.reduce((n, a) => n + (a.usage?.inputTokens ?? 0), 0)
      row.outputTokens = mine.reduce((n, a) => n + (a.usage?.outputTokens ?? 0), 0)
      row.models = [...new Set(mine.map((a) => a.model))]
      // A draft lost to the endpoint (unreachable, timed out, 5xx) is the provider's outage, not the builder's: it
      // still fails the case, named as what it was, and the summary also gives the rate without those.
      const lost = mine.filter((a) => ['network_error', 'timeout'].includes(a.status) || a.responseStatus >= 500)
      if (!row.ok && lost.length && row.provider !== 'ai') {
        row.outage = true
        row.problems.push(`the model endpoint failed: ${lost.map((a) => a.status + (a.responseStatus ? ' ' + a.responseStatus : '')).join(', ')}`)
      }
      const price = row.models.length === 1 ? prices[row.models[0]] : null
      if (price) row.costUsd = (row.inputTokens * price[0] + row.outputTokens * price[1]) / 1e6
    }
  } catch (error) { console.warn('could not read aiAudit:', error.message) }
  if (!args.keep) {
    try {
      mongo(`const ids=${JSON.stringify(ids)}; db.slates.deleteMany({userId:{$in:ids}}); db.users.deleteMany({_id:{$in:ids}}); print('removed')`)
    } catch (error) { console.warn('could not remove the eval accounts:', error.message) }
  }
}

const passed = rows.filter((r) => r.ok).length
const valid = rows.filter((r) => r.validComponent).length
const latencies = rows.map((r) => r.latencyMs).filter(Number.isFinite).sort((a, b) => a - b)
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))]
const sum = (key) => rows.reduce((n, r) => n + (r[key] ?? 0), 0)
const summary = {
  run: RUN, origin: args.origin, at: new Date().toISOString(), cases: rows.length,
  passRate: passed / rows.length, passed,
  outages: rows.filter((r) => r.outage).length,
  passRateWithoutOutages: passed / Math.max(1, rows.filter((r) => !r.outage).length),
  validComponentRate: valid / rows.length,
  drafted: rows.filter((r) => r.provider === 'ai').length,
  latencyMs: { p50: pct(0.5), p90: pct(0.9), max: latencies.at(-1) },
  models: [...new Set(rows.flatMap((r) => r.models ?? []))],
  calls: sum('calls'), inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'),
  ...(rows.some((r) => r.costUsd != null) && { costUsd: Number(sum('costUsd').toFixed(4)) }),
  failures: rows.filter((r) => !r.ok).map((r) => ({ id: r.id, problems: r.problems })),
}
console.log('\n' + JSON.stringify(summary, null, 2))
if (args.out) writeFileSync(args.out, JSON.stringify({ summary, rows }, null, 2))
process.exit(summary.passRate >= Number(args.target) ? 0 : 1)
