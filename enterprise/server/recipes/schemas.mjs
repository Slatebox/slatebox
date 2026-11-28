// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The shapes recipes.* actions take and answer (the registry checks inputs; outputs are documented
// for the OpenAPI document, exec and MCP).
import { shareIdInput } from '/server/actions/slate-schemas.mjs'

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const open = (properties) => ({ type: 'object', properties })
export const idText = (description) => ({ type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9_:.-]+$', description })
export const instanceIdInput = idText('The recipe in a project (recipes.list instanceId).')
export const projectIdInput = idText('The project (a drive or a folder).')
export const runIdInput = idText('A run (recipes.runs runId).')
export const hookIdInput = idText('A webhook (recipes.hooks.list hookId).')
export const grantIdInput = idText('A standing permission (recipes.get permissions[].grantId).')
export const cardIdInput = idText('A change outside Slatebox waiting for approval (recipes.get waiting[].cardId).')
export { shareIdInput }

export const triggerInput = {
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: {
    kind: { type: 'string', enum: ['vendor', 'schedule', 'manual', 'inbound'] },
    cron: { type: 'string', maxLength: 100, description: 'schedule: five fields, minute hour day month weekday, at most every 15 minutes ("0 18 * * 1-5").' },
    tz: { type: 'string', maxLength: 64, description: 'schedule: an IANA time zone (America/New_York). UTC by default.' },
    event: { type: 'string', maxLength: 60, description: 'vendor: the event, one the recipe takes (github.push).' },
    debounceMs: { type: 'integer', minimum: 0, maximum: 21600000, description: 'vendor: wait this long after the last event, so a burst is one run.' },
  },
}

export const recipeOutput = open({
  instanceId: { type: 'string' }, recipeId: { type: 'string' }, projectId: { type: 'string' }, name: { type: 'string' },
  agentName: { type: 'string' }, runsFor: { type: 'string', description: '"GitHub architect · runs for Ana"' },
  state: { type: 'string', enum: ['draft', 'active', 'paused', 'needs_sign_in', 'blocked_access', 'blocked_limit', 'failed'] }, stateText: { type: 'string' },
  pausedReason: { type: ['string', 'null'] }, applyMode: { type: 'string', enum: ['suggest', 'auto'] }, firstRunKept: { type: 'boolean' }, canAuto: { type: 'boolean' },
  config: { type: 'object' }, triggers: { type: 'array', items: { type: 'object' } }, nextRunAt: { type: ['string', 'null'] },
  lastRun: { type: ['object', 'null'] }, slates: { type: 'array', items: open({ role: { type: 'string' }, slateId: { type: 'string' } }) },
  colorIndex: { type: 'integer' }, mine: { type: 'boolean' }, created: { type: 'string' },
})

export const runOutput = open({
  runId: { type: 'string' }, trigger: { type: 'object' }, state: { type: 'string', enum: ['queued', 'running', 'done', 'partial', 'failed', 'skipped', 'cancelled'] },
  created: { type: 'string' }, startedAt: { type: ['string', 'null'] }, finishedAt: { type: ['string', 'null'] }, durationMs: { type: ['integer', 'null'] }, attempts: { type: 'integer' },
  stats: { type: ['object', 'null'] }, changes: { type: 'array', items: { type: 'object' } }, writes: { type: 'array', items: { type: 'object' } },
  log: { type: 'array', items: open({ at: { type: 'string' }, level: { type: 'string' }, code: { type: 'string' }, msg: { type: 'string' } }) },
  error: { type: ['object', 'null'] }, skippedReason: { type: ['string', 'null'] },
})

export const hookOutput = open({
  hookId: { type: 'string' }, direction: { type: 'string', enum: ['outbound', 'inbound', 'intercept'] }, host: { type: ['string', 'null'] }, url: { type: ['string', 'null'] },
  events: { type: ['array', 'null'], items: { type: 'string' } }, point: { type: ['string', 'null'] }, failMode: { type: 'string' }, state: { type: 'string', enum: ['active', 'disabled'] },
  failures: { type: 'integer' }, scope: { type: 'object' }, secrets: { type: 'array', items: { type: 'object' }, description: 'When each secret was made and when an old one stops signing; never the secret.' },
  lastDelivery: { type: ['object', 'null'] }, created: { type: 'string' },
})

export const empty = obj({})
export { obj, open }
