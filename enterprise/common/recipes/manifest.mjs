// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// A recipe's manifest: what it is, what it needs, when it runs, what it keeps in a project, what it
// may propose to change outside Slatebox, what it tells webhooks and where hooks may step in.
// defineRecipe checks one at import time, so a mistake fails the boot (and the recipe's own test),
// never a run. Pure and browser-safe: the catalog the UI reads is these manifests.
import { isValidCron, shortestGapMinutes } from './cron.mjs'
import { COMMON_EVENT_NAMES, EVENT_NAME } from './events.mjs'

export const RECIPE_ID = /^[a-z][a-z0-9-]{2,40}$/
export const INTEGRATIONS = Object.freeze(['github', 'slack', 'google'])
export const TRIGGER_KINDS = Object.freeze(['vendor', 'schedule', 'manual', 'inbound'])
export const OUTPUT_KINDS = Object.freeze(['diagram', 'board', 'index', 'presentation'])
// Changes outside Slatebox a recipe may propose. Each needs a standing permission per recipe
// (enterprise/server/recipes/permissions.mjs) or a person's approval on an action card.
export const WRITE_KINDS = Object.freeze(['github.check_run', 'github.pr_comment', 'github.pull_request', 'slack.post', 'google.write_sheet'])
export const INTERCEPT_POINTS = Object.freeze(['graph.ready', 'output.ready', 'writeback.proposed'])
export const COST_CLASSES = Object.freeze(['low', 'medium', 'high'])
export const MIN_SCHEDULE_MINUTES = 15
export const MAX_DEBOUNCE_MS = 6 * 3600 * 1000

export class ManifestError extends Error {
  constructor(id, message) {
    super(`Recipe ${id || '(unnamed)'}: ${message}`)
    this.name = 'ManifestError'
  }
}

const isText = (value, max = 120) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const isRange = (value) => Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n) && n >= 0) && value[0] <= value[1]
const isObjectSchema = (schema) => schema && typeof schema === 'object' && schema.type === 'object' && typeof schema.properties === 'object' && schema.additionalProperties === false
const sentenceCase = (text) => /^[A-Z0-9]/.test(text) && !/\s[A-Z][a-z]+\s[A-Z][a-z]+/.test(text.replace(/GitHub|Slack|Google|Slatebox|Mermaid|Drive|Sheets|Docs|API|PR/g, 'x'))

/** The manifest's first problem as a sentence, or null. */
export function validateManifest(m) {
  if (!m || typeof m !== 'object') return 'a manifest is an object'
  if (typeof m.id !== 'string' || !RECIPE_ID.test(m.id)) return 'id is 3 to 41 lowercase letters, digits and dashes'
  if (!Number.isInteger(m.version) || m.version < 1) return 'version is a whole number from 1'
  if (!isText(m.label, 60) || !sentenceCase(m.label)) return 'label is sentence case, at most 60 characters'
  if (!isText(m.agentName, 40)) return 'agentName is at most 40 characters'
  if (/\bAI\b/.test(m.label) || /\bAI\b/.test(m.agentName)) return 'say "agent", not "AI"'
  if (!isText(m.summary ?? 'x', 280)) return 'summary is at most 280 characters'
  if (m.integration !== null && !INTEGRATIONS.includes(m.integration)) return `integration is null or one of ${INTEGRATIONS.join(', ')}`
  if (m.needs !== undefined) {
    if (!m.needs || typeof m.needs !== 'object') return 'needs maps an integration to its scopes'
    for (const [vendor, scopes] of Object.entries(m.needs)) {
      if (!INTEGRATIONS.includes(vendor)) return `needs names an unknown integration ${vendor}`
      if (!Array.isArray(scopes) || scopes.some((scope) => !isText(scope, 80))) return `needs.${vendor} is a list of scopes`
    }
  }
  if (!Array.isArray(m.triggers) || !m.triggers.length) return 'triggers lists at least one'
  for (const [k, t] of m.triggers.entries()) {
    if (!TRIGGER_KINDS.includes(t?.kind)) return `triggers[${k}].kind is one of ${TRIGGER_KINDS.join(', ')}`
    if (t.kind === 'vendor') {
      if (!m.integration) return `triggers[${k}] is a vendor event, but the recipe has no integration`
      if (typeof t.event !== 'string' || !t.event.startsWith(m.integration + '.')) return `triggers[${k}].event starts with ${m.integration}.`
    }
    if (t.kind === 'schedule') {
      if (!isValidCron(t.cron)) return `triggers[${k}].cron is not a five-field schedule`
      if (shortestGapMinutes(t.cron, 'UTC', Date.UTC(2026, 0, 5)) < MIN_SCHEDULE_MINUTES) return `triggers[${k}] runs more often than every ${MIN_SCHEDULE_MINUTES} minutes`
    }
    if (t.debounceMs !== undefined && (!Number.isInteger(t.debounceMs) || t.debounceMs < 0 || t.debounceMs > MAX_DEBOUNCE_MS)) return `triggers[${k}].debounceMs is 0 to 6 hours`
  }
  if (!isObjectSchema(m.configSchema)) return 'configSchema is an object schema that refuses undeclared fields'
  if (m.inputSchema !== null && m.inputSchema !== undefined && !isObjectSchema(m.inputSchema)) return 'inputSchema is null or an object schema that refuses undeclared fields'
  if (m.triggers.some((t) => t.kind === 'inbound') && !m.inputSchema) return 'an inbound trigger needs an inputSchema'
  if (!Array.isArray(m.outputs) || !m.outputs.length) return 'outputs lists the slates it keeps'
  const roles = new Set()
  for (const [k, o] of m.outputs.entries()) {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(o?.role || '')) return `outputs[${k}].role is lowercase letters and dashes`
    if (o.role === 'status') return 'the status slate is kept by the runtime, not listed'
    if (roles.has(o.role)) return `outputs role ${o.role} is listed twice`
    roles.add(o.role)
    if (!isText(o.name, 80)) return `outputs[${k}].name is at most 80 characters`
    if (!OUTPUT_KINDS.includes(o.kind)) return `outputs[${k}].kind is one of ${OUTPUT_KINDS.join(', ')}`
    if (o.kind === 'board' && !isText(o.component, 40)) return `outputs[${k}] is a board and names its component`
  }
  for (const [k, w] of (m.writes || []).entries()) {
    if (!WRITE_KINDS.includes(w?.kind)) return `writes[${k}].kind is one of ${WRITE_KINDS.join(', ')}`
    if (m.integration && !w.kind.startsWith(m.integration + '.')) return `writes[${k}] writes to another integration`
    if (typeof w.describe !== 'function') return `writes[${k}].describe(scope) says the scope in plain words`
    if (!isObjectSchema(w.scopeSchema)) return `writes[${k}].scopeSchema is an object schema`
  }
  for (const name of m.events || []) {
    if (!EVENT_NAME.test(name)) return `event ${name} is lowercase words joined by dots`
    if (COMMON_EVENT_NAMES.includes(name)) return `event ${name} is a common event; every recipe sends it`
  }
  for (const point of m.intercepts || []) if (!INTERCEPT_POINTS.includes(point)) return `intercept ${point} is one of ${INTERCEPT_POINTS.join(', ')}`
  if (!m.cost || !COST_CLASSES.includes(m.cost.class) || !isRange(m.cost.tokensPerRun) || !isRange(m.cost.vendorCallsPerRun)) return 'cost is { class, tokensPerRun: [min, max], vendorCallsPerRun: [min, max] }'
  if (typeof m.idPrefix !== 'string' || !/^[a-z]{2,4}$/.test(m.idPrefix)) return 'idPrefix is 2 to 4 lowercase letters'
  return null
}

/** Checks and freezes a manifest. Throws ManifestError. */
export function defineRecipe(manifest) {
  const wrong = validateManifest(manifest)
  if (wrong) throw new ManifestError(manifest?.id, wrong)
  const deep = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value)
      for (const item of Object.values(value)) deep(item)
    }
    return value
  }
  return deep({ inputSchema: null, needs: {}, writes: [], events: [], intercepts: [], summary: '', ...manifest })
}

/** The triggers an instance starts with: those marked default, else the first. */
export function defaultTriggers(manifest, tz = 'UTC') {
  const picked = manifest.triggers.filter((t) => t.default)
  return (picked.length ? picked : [manifest.triggers[0]]).map((t) => ({
    kind: t.kind,
    ...(t.kind === 'schedule' && { cron: t.cron, tz }),
    ...(t.kind === 'vendor' && { event: t.event, debounceMs: t.debounceMs ?? 0 }),
  }))
}

/** What the catalog shows of a manifest (functions dropped). */
export function publicManifest(m) {
  return {
    id: m.id, version: m.version, label: m.label, summary: m.summary, agentName: m.agentName, integration: m.integration, needs: m.needs,
    triggers: m.triggers.map((t) => ({ ...t })), configSchema: m.configSchema, inputSchema: m.inputSchema,
    outputs: m.outputs.map((o) => ({ ...o })),
    writes: m.writes.map((w) => ({ kind: w.kind, scopeSchema: w.scopeSchema })),
    events: [...m.events], intercepts: [...m.intercepts], cost: { ...m.cost },
  }
}
