// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The three addresses Slack calls (registered through api.addRoute; the manifest names them):
//   POST /integrations/slack/events       url_verification, link_shared (a slate's preview),
//                                         app_uninstalled, tokens_revoked, and for recipes (when
//                                         they are on): message, reaction_added, reaction_removed in
//                                         the channels a recipe watches (recipes/vendors/slack/ingest.mjs)
//   POST /integrations/slack/interactive  the "Send to slate" message shortcut and its modal
//   POST /integrations/slack/commands     /slatebox [words]
// Every request is checked first (verify.mjs: the signing secret over the raw body, signed in the
// last five minutes); one that fails gets 401 and nothing else. Slack wants an answer within three
// seconds: each route answers first and does the rest after. Slack retries an event it thinks was
// missed; each event id is handled once (slackEvents, hashed, kept an hour).
import { createHash } from 'node:crypto'
import { SLACK_CALLBACKS, SLACK_PATHS } from './manifest.mjs'
import { readRaw, slackHeaders, verifySlackRequest } from './verify.mjs'

const hashOf = (text) => createHash('sha256').update(String(text)).digest('hex')

/**
 * slack(): the running Slack service (slack.mjs); events: { claim(id, expiresAt) -> bool } (first
 * time only); recipes(): the recipe runtime's Slack ingest ({ handles(type), handle(body) }) or null
 * when recipes are off; later(fn): runs fn after the answer is sent; log(entry): metadata only.
 * → [{ method, path, handler }] for api.addRoute.
 */
export function slackRoutes({ slack, events, recipes = () => null, later = (fn) => setImmediate(fn), log = () => {}, now = Date.now }) {
  const after = (kind, fn) => later(() => Promise.resolve().then(fn).catch((error) => log({ kind: 'slack_failed', what: kind, error: String(error?.message || error).slice(0, 120) })))

  // The request, verified. → its raw body, or null once it has answered (401, 413, 503).
  async function verified(req, res) {
    let raw
    try {
      raw = await readRaw(req)
    } catch {
      res.status(413).end()
      return null
    }
    let service = null
    try {
      service = slack()
    } catch {
      res.status(503).end()
      return null
    }
    const secret = await service.signingSecret().catch(() => null)
    const { timestamp, signature } = slackHeaders(req)
    if (!verifySlackRequest({ signingSecret: secret, timestamp, signature, raw, now: now() })) {
      log({ kind: 'slack_unsigned' })
      res.status(401).end()
      return null
    }
    return { raw: raw.toString('utf8'), service }
  }

  const form = (raw) => Object.fromEntries(new URLSearchParams(raw))
  const json = (text) => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  return [
    {
      method: 'POST',
      path: SLACK_PATHS.events,
      async handler(req, res) {
        const got = await verified(req, res)
        if (!got) return
        const body = json(got.raw)
        if (!body || typeof body !== 'object') return res.status(400).end()
        if (body.type === 'url_verification') return res.status(200).json({ challenge: String(body.challenge || '').slice(0, 200) })
        res.status(200).end()
        if (body.type !== 'event_callback' || typeof body.event_id !== 'string') return
        // Slack's retries (X-Slack-Retry-Num) of an event already taken are answered and dropped.
        const first = await events.claim(hashOf(body.event_id), new Date(now() + 3600000)).catch(() => false)
        if (!first) return
        const type = body.event?.type
        log({ kind: 'slack_event', type: typeof type === 'string' ? type.slice(0, 40) : null })
        if (type === 'link_shared') after(type, () => got.service.linkShared(body))
        else if (type === 'app_uninstalled') after(type, () => got.service.uninstalled(body.team_id))
        else if (type === 'tokens_revoked') after(type, () => got.service.tokensRevoked(body.team_id, body.event?.tokens || {}))
        else {
          const ingest = recipes()
          if (ingest?.handles(type)) after(type, () => ingest.handle(body))
        }
      },
    },
    {
      method: 'POST',
      path: SLACK_PATHS.interactive,
      async handler(req, res) {
        const got = await verified(req, res)
        if (!got) return
        const payload = json(form(got.raw).payload || '')
        if (!payload || typeof payload !== 'object') return res.status(400).end()
        if (payload.type === 'message_action' && payload.callback_id === SLACK_CALLBACKS.sendToSlate) {
          res.status(200).end()
          // The trigger lasts three seconds: the modal opens right after the answer.
          return after('send_to_slate', () => got.service.messageAction(payload))
        }
        if (payload.type === 'view_submission' && payload.view?.callback_id === SLACK_CALLBACKS.sendToSlate) {
          const answer = await got.service.viewSubmission(payload).catch(() => ({ response: { response_action: 'errors', errors: { slate: 'That did not work. Try again.' } } }))
          res.status(200).json(answer.response)
          if (answer.land) after('send_to_slate_land', answer.land)
          return undefined
        }
        return res.status(200).end()
      },
    },
    {
      method: 'POST',
      path: SLACK_PATHS.commands,
      async handler(req, res) {
        const got = await verified(req, res)
        if (!got) return
        const answer = await got.service.command(form(got.raw)).catch(() => ({ response_type: 'ephemeral', text: 'That did not work. Try again.' }))
        res.status(200).json(answer)
      },
    },
  ]
}
