// The Meteor side of custom shapes: the two stores, the model request for the AI feature
// `shape` (its connection chosen by settings.ai.use.shape, its built-in model by
// server/config/ai-defaults.json, never named here), the meter, and the methods the canvas calls.
// Agents reach the same service through the actions (server/actions/shapes.mjs, deps.shapes).
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { Random } from 'meteor/random'
import { check, Match } from 'meteor/check'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import OAuth from 'oauth'
import req from '../methods/ai/req'
import { runAIAction } from '../metering/context.mjs'
import { ESTIMATES } from '../metering/prices.mjs'
import { resolveAIFeatureConfig } from '../methods/ai/feature-config.mjs'
import { resolveRequestConnection } from '../methods/ai/ai-settings'
import { GENERATION_TTL_MS, SHAPE_FEATURE, ShapeProblem } from './shape-core.mjs'
import { createShapeService } from './shape-service.mjs'
import { createIconSearch } from './icon-search.mjs'

export const Shapes = new Mongo.Collection('shapes')
export const ShapeGenerations = new Mongo.Collection('shapeGenerations')

Meteor.startup(async () => {
  try {
    const shapes = Shapes.rawCollection()
    await shapes.createIndex({ ownerId: 1, usedAt: -1 })
    await shapes.createIndex({ teamId: 1, visibility: 1, usedAt: -1 })
    await shapes.createIndex({ ownerId: 1, d: 1 })
    const generations = ShapeGenerations.rawCollection()
    await generations.createIndex({ key: 1, createdAt: -1 })
    await generations.createIndex({ 'candidates.candidateId': 1 })
    await generations.createIndex({ userId: 1, createdAt: -1 })
    // Generated candidates are kept 30 days (a repeat of the same description is free meanwhile,
    // and its candidates can still be applied).
    await generations.createIndex({ createdAt: 1 }, { expireAfterSeconds: GENERATION_TTL_MS / 1000 })
  } catch (error) {
    console.error('[shapes] could not create indexes', error.message)
  }
})

// The model that will serve this person (the cache key only: a new choice draws anew).
async function modelFor(principal) {
  const chosen = await resolveRequestConnection({ feature: SHAPE_FEATURE, request: { tools: true }, userId: principal.userId }).catch(() => null)
  if (chosen?.connection) return `${chosen.ref || 'connection'}:${chosen.connection.model || ''}`
  return resolveAIFeatureConfig(SHAPE_FEATURE, Meteor.settings).engine || 'builtin'
}

// The Noun Project's icon search (settings.nounProject: key and secret; apiOrigin only to point it
// at another address, such as a test double). Requests are signed with OAuth 1.0a, as its API asks.
const noun = Meteor.settings.nounProject || {}
const nounOrigin = noun.apiOrigin || 'https://api.thenounproject.com'
const nounOAuth = noun.key && noun.secret
  ? new OAuth.OAuth(nounOrigin, nounOrigin, noun.key, noun.secret, '1.0', null, 'HMAC-SHA1')
  : null
const ICON_TIMEOUT_MS = 8000
export const iconSearch = createIconSearch({
  configured: Boolean(nounOAuth),
  apiOrigin: nounOrigin,
  requestJson: (url) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { status: 504 })), ICON_TIMEOUT_MS)
    nounOAuth.get(url, null, null, (error, data) => {
      clearTimeout(timer)
      if (error) {
        reject(Object.assign(new Error('noun project request failed'), { status: error.statusCode || 502 }))
        return
      }
      try { resolve(JSON.parse(data)) } catch { reject(Object.assign(new Error('unreadable answer'), { status: 502 })) }
    })
  }),
  fetchText: async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(ICON_TIMEOUT_MS), redirect: 'error' })
    if (!response.ok) throw new Error(`icon ${response.status}`)
    const text = await response.text()
    return text.length > 400000 ? null : text
  },
})

export const shapeService = createShapeService({
  icons: iconSearch,
  shapes: Shapes.rawCollection(),
  generations: ShapeGenerations.rawCollection(),
  newId: () => Random.id(),
  model: modelFor,
  // One tool call, named where the connection takes a named choice; a connection on toolChoice
  // auto (a provider that refuses named and required) may answer in text, so a text answer comes
  // back as it is (allowPlainText) for readCandidates to find the JSON in, instead of req.js's
  // strict-JSON retries. The chosen connection never falls back (req.js). The person is named
  // explicitly: agents, exec and HTTP calls run outside any Meteor method.
  request: (options, principal) =>
    req({ ...resolveAIFeatureConfig(SHAPE_FEATURE, Meteor.settings), ...options, allowPlainText: true, userId: principal?.userId, maxTokens: 6000 }),
  run: (fn, principal) => runAIAction({ feature: SHAPE_FEATURE, kind: 'ai', estimateMicros: ESTIMATES.shape, userId: principal.userId }, fn),
})

async function principalOf() {
  const user = await Meteor.userAsync()
  if (!user || user.isAnonymous) throw new Meteor.Error('sign_in', 'Sign in to draw shapes with AI.')
  return { userId: user._id, teamId: user.orgId ?? null, teamAdmin: Boolean(user.orgId && user.isOrgOwner), isAnonymous: false }
}

// A refusal the person reads as it is; anything else is said plainly.
function asMeteorError(error) {
  if (error instanceof Meteor.Error) return error
  if (error instanceof ShapeProblem) return new Meteor.Error(error.code, error.message)
  if (error?.error && error?.reason) return error
  console.error('[shapes]', error?.message)
  return new Meteor.Error('shape_unavailable', 'Could not draw that shape. Try describing it more simply.')
}

const call = (fn) => async function shapeMethod(...args) {
  this.unblock?.()
  try {
    return await fn(...args)
  } catch (error) {
    throw asMeteorError(error)
  }
}

Meteor.methods({
  'shapes.generate': call(async (input) => {
    check(input, { describe: String, count: Match.Maybe(Match.Integer), fresh: Match.Maybe(Boolean) })
    // The hourly limit is the service's, the same for every surface.
    return shapeService.generate(await principalOf(), input)
  }),
  'shapes.list': call(async (input = {}) => {
    check(input, { q: Match.Maybe(String), scope: Match.Maybe(Match.OneOf('mine', 'team', 'all')), limit: Match.Maybe(Match.Integer) })
    return shapeService.library.list(await principalOf(), input)
  }),
  // An icon picked from the search is kept as "imported", with its credit.
  'shapes.save': call(async (input) => {
    check(input, {
      name: String,
      d: String,
      fillRule: Match.Maybe(Match.OneOf('nonzero', 'evenodd')),
      describe: Match.Maybe(String),
      visibility: Match.Maybe(Match.OneOf('private', 'team')),
      source: Match.Maybe(Match.OneOf('generated', 'imported')),
      credit: Match.Maybe({ text: String, url: Match.Maybe(String) }),
    })
    const source = input.source === 'imported' ? 'imported' : 'generated'
    return shapeService.library.save(await principalOf(), { ...input, source, credit: source === 'imported' ? input.credit : undefined })
  }),
  // The Noun Project's icons for some words, each one checked outline. A guest may search too
  // (keeping a shape needs an account).
  'shapes.searchIcons': call(async (input) => {
    check(input, { q: String, limit: Match.Maybe(Match.Integer), page: Match.Maybe(Match.Integer) })
    const user = await Meteor.userAsync()
    if (!user) throw new Meteor.Error('sign_in', 'Sign in to search icons.')
    return shapeService.icons.search({ userId: user._id, teamId: user.orgId ?? null, isAnonymous: Boolean(user.isAnonymous) }, input)
  }),
  'shapes.update': call(async (input) => {
    check(input, { id: String, name: Match.Maybe(String), visibility: Match.Maybe(Match.OneOf('private', 'team')) })
    return shapeService.library.update(await principalOf(), input.id, input)
  }),
  'shapes.remove': call(async (input) => {
    check(input, { id: String })
    return shapeService.library.remove(await principalOf(), input.id)
  }),
  'shapes.used': call(async (input) => {
    check(input, { id: String, count: Match.Maybe(Match.Integer) })
    await shapeService.library.used(await principalOf(), input.id, Math.max(1, Math.min(200, input.count || 1)))
    return true
  }),
})

// A search is one Noun Project API call: 20 a minute for each connection.
DDPRateLimiter.addRule({ type: 'method', name: 'shapes.searchIcons', connectionId: () => true }, 20, 60000)
