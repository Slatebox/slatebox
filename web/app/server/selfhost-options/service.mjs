// The header's Move to Cloud on a self-hosted install, the server's side (owner, 2026-11-25; since
// 2026-11-26 integrations are free on every install, so moving to Cloud is the button's only job).
// MIT, runs without Meteor (scripts/selfhost-options.test.mjs); server/selfhost-options/meteor.js wires it.
//
// One flow, started by one click and followed by the panel (follow(id) every second or two):
//
//   move    signing_in → exporting → uploading → review → confirming → moved
//           A device sign-in for team:export team:move, then the team's export, written here and
//           streamed straight to Cloud's one-time move address (no file, no passphrase to keep: a
//           random one encrypts it on the way and is thrown away). Cloud's report is compared with
//           what was sent, section by section, and the team goes live only when the administrator
//           says so (Make it live, with or without inviting the others). This install is left as
//           it was; nothing here is deleted.
//
// Re-runnable and resumable:
//   - starting a move while one is under way answers that one (one at a time per server);
//   - every step keeps what it achieved on the flow (the Cloud move id once uploaded), so resume()
//     goes on from the step that stopped, after a new sign-in when Cloud's token ended (an hour for
//     a move) or the server restarted (tokens are kept in memory only, never in the database);
//   - Cloud's writes carry Idempotency-Keys kept on the flow, so a retried confirm is one confirm.
// Cancel stops a move at any step before it is done: a sign-in nobody wants to finish (a closed
// window, the wrong account), or its export and upload (aborted, and discarded on Cloud).
// Refusals are MoveError with a code and words a person can act on.
import { randomBytes, randomUUID } from 'node:crypto'
import { Transform } from 'node:stream'
import { CLI_CLIENT, CloudError, MOVE_SCOPE, SERVER_CLIENT } from './cloud-client.mjs'

export const ACTIVE = Object.freeze(['signing_in', 'exporting', 'uploading', 'review', 'confirming'])
export const RESUMABLE = Object.freeze(['failed', 'needs_sign_in'])

export class MoveError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.error = code
    this.status = status
  }
}

// Cloud's refusals in words for the panel (Cloud's own message otherwise).
const CLOUD_WORDS = {
  access_denied: 'The sign-in was declined on Slatebox Cloud. Nothing was changed.',
  expired_token: 'The sign-in code expired before it was approved. Start again for a new code.',
  unreachable: null,
  move_limit: null,
  team_owner_required: 'On Slatebox Cloud, only the owner of a team can move a team into it. Sign in there as the owner, or with an account in no team yet.',
}
const cloudWords = (error) => (Object.hasOwn(CLOUD_WORDS, error.code) && CLOUD_WORDS[error.code]) || error.message
const signInEnded = (error) => error instanceof CloudError && (error.status === 401 || error.code === 'unauthorized' || error.code === 'invalid_token')
const notOffered = (error) => error instanceof CloudError && ['invalid_client', 'invalid_scope', 'not_found', 'http_404', 'unauthorized_client'].includes(error.code)

/** An in-memory flow store (tests, and the shape server/selfhost-options/meteor.js gives over Mongo). */
export function memoryFlows() {
  const rows = new Map()
  return {
    rows,
    insert: async (doc) => {
      rows.set(doc._id, structuredClone(doc))
    },
    get: async (id) => (rows.has(id) ? structuredClone(rows.get(id)) : null),
    set: async (id, fields) => {
      if (!rows.has(id)) return
      rows.set(id, { ...rows.get(id), ...structuredClone(fields) })
    },
    latest: async (kind) => [...rows.values()].filter((row) => row.kind === kind).sort((a, b) => b.createdAt - a.createdAt).map((row) => structuredClone(row))[0] || null,
  }
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./cloud-client.mjs').createCloudClient>} deps.cloud
 * @param {ReturnType<typeof memoryFlows>} deps.flows
 * @param {(userId: string) => Promise<boolean>} deps.isServerAdmin
 * @param {(userId: string) => Promise<{ team: { name: string }, members: number, slates: number }>} deps.preflight
 *   the caller's team, or throws (not a team admin, no team): transfer.mjs startExport's checks
 * @param {(userId: string, passphrase: string, onEnd: (end: object) => void) => Promise<import('node:stream').Readable>} deps.exportStream
 * @param {{ label: string }} deps.install  how this server names itself on Cloud's sign-in page
 */
export function createMoveService({
  cloud,
  flows,
  isServerAdmin,
  preflight,
  exportStream,
  install,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  newId = () => randomBytes(12).toString('hex'),
  log = () => {},
}) {
  // Kept in memory only: the device code while signing in, and Cloud's token after.
  const secrets = new Map()
  const running = new Set()
  // A move's export and upload under way, aborted by cancel().
  const aborts = new Map()
  const cancelled = async (flowId) => (await flows.get(flowId))?.state === 'cancelled'

  async function admin(userId) {
    if (!userId || !(await isServerAdmin(userId))) throw new MoveError('admin_required', 'Only an administrator of this server can do this. Ask your admin.', 403)
  }

  const view = (flow) => {
    if (!flow) return null
    const { userId: _u, keys: _k, ...shown } = flow
    return shown
  }

  async function own(userId, flowId, kind) {
    const flow = typeof flowId === 'string' && /^[a-f0-9]{24}$/.test(flowId) ? await flows.get(flowId) : null
    if (!flow || flow.kind !== kind) throw new MoveError('not_found', 'There is no such step to follow.', 404)
    return flow
  }

  // A device sign-in on Cloud: the code and link the panel shows (and opens for the person).
  async function signIn(flow, { scope, clients }) {
    let grant = null
    let clientId = null
    let lastError = null
    for (const client of clients) {
      try {
        grant = await cloud.deviceAuthorize({ clientId: client, scope, label: install.label })
        clientId = client
        break
      } catch (error) {
        lastError = error
        if (!notOffered(error)) throw error
      }
    }
    if (!grant) throw lastError
    if (!grant.device_code || !grant.user_code) throw new MoveError('cloud_refused', 'Slatebox Cloud did not start a sign-in.', 502)
    // Only a link on Cloud's own origin is shown or opened.
    const sameOrigin = (link) => {
      try {
        return new URL(link).origin === cloud.origin
      } catch {
        return false
      }
    }
    const page = sameOrigin(grant.verification_uri) ? grant.verification_uri : `${cloud.origin}/device`
    const complete = sameOrigin(grant.verification_uri_complete) ? grant.verification_uri_complete : `${page}?code=${encodeURIComponent(grant.user_code)}`
    secrets.set(flow._id, { ...secrets.get(flow._id), deviceCode: grant.device_code, clientId, interval: Math.max(1, Number(grant.interval) || 5) })
    const signInView = { userCode: grant.user_code, verificationUri: page, verificationUriComplete: complete, expiresAt: now() + (Number(grant.expires_in) || 600) * 1000 }
    await flows.set(flow._id, { state: 'signing_in', signIn: signInView, failure: null, updatedAt: now() })
    return signInView
  }

  // Polls Cloud's token endpoint until the person approves (or declines, or the code expires).
  async function waitForToken(flow) {
    const secret = secrets.get(flow._id)
    let interval = secret.interval * 1000
    const current = await flows.get(flow._id)
    const deadline = current?.signIn?.expiresAt || now() + 600_000
    for (;;) {
      await sleep(interval)
      const live = await flows.get(flow._id)
      if (!live || live.state === 'cancelled') throw new MoveError('cancelled', 'Canceled.')
      try {
        const token = await cloud.deviceToken({ clientId: secret.clientId, deviceCode: secret.deviceCode })
        if (!token?.access_token) throw new MoveError('cloud_refused', 'Slatebox Cloud approved the sign-in but sent no token.', 502)
        secrets.set(flow._id, { ...secrets.get(flow._id), token: token.access_token, deviceCode: null, tokenEndsAt: now() + (Number(token.expires_in) || 900) * 1000 })
        await flows.set(flow._id, { signIn: null, signedInAt: now(), updatedAt: now() })
        return token.access_token
      } catch (error) {
        if (error instanceof CloudError && error.code === 'authorization_pending') {
          /* keep waiting */
        } else if (error instanceof CloudError && error.code === 'slow_down') interval += 5000
        else throw error
      }
      if (now() > deadline) throw new CloudError('expired_token', CLOUD_WORDS.expired_token)
    }
  }

  async function fail(flow, error) {
    const ended = signInEnded(error)
    const code = error?.code || 'failed'
    // A refusal with its own words (this module's or Cloud's).
    const known = error instanceof MoveError || error instanceof CloudError || (typeof error?.code === 'string' && error?.status >= 400 && error?.status < 500)
    const message = error instanceof CloudError ? cloudWords(error) : known ? error.message : 'Something went wrong on this server. Try again.'
    if (!known) log('selfhost step failed', { flow: flow._id, error: error?.stack || error?.message || String(error) })
    if (error?.detail) log('selfhost step failed', { flow: flow._id, code, detail: error.detail })
    // Canceled by the administrator: the flow says so already, whatever the step threw on its way out.
    if (code === 'cancelled' || (await cancelled(flow._id))) return
    secrets.delete(flow._id)
    await flows.set(flow._id, {
      state: ended ? 'needs_sign_in' : 'failed',
      signIn: null,
      failure: { code: ended ? 'sign_in_ended' : code, message: ended ? 'The sign-in to Slatebox Cloud ended. Sign in again to go on from where it stopped.' : message, ...(error?.retryAfter && { retryAfter: error.retryAfter }) },
      updatedAt: now(),
    })
  }

  // Runs one flow's remaining steps in the background, once at a time per flow.
  function drive(flow, steps) {
    if (running.has(flow._id)) return
    running.add(flow._id)
    Promise.resolve()
      .then(() => steps(flow))
      .catch((error) => fail(flow, error))
      .finally(() => running.delete(flow._id))
  }

  // ------------------------------------------------------------------ move to Cloud

  // Counts per section: what this server wrote against what Cloud made (and skipped, with reasons).
  function verify(sent, report) {
    const sections = {}
    let ok = true
    for (const [section, count] of Object.entries(sent || {})) {
      const there = report?.sections?.[section]
      if (!there) {
        sections[section] = { sent: count, arrived: null, skipped: null }
        continue
      }
      const arrived = there.created || 0
      const skipped = there.skipped || 0
      sections[section] = { sent: count, arrived, skipped }
      if (arrived + skipped !== count) ok = false
    }
    return {
      ok,
      sections,
      slates: { sent: sent?.slates ?? 0, arrived: report?.sections?.slates?.created ?? (report?.slates || []).length },
      people: (report?.people || []).length,
      files: report?.files?.created ?? 0,
      skipped: (report?.skipped || []).slice(0, 20),
    }
  }

  async function moveSteps(flow) {
    let live = await flows.get(flow._id)
    let token = secrets.get(flow._id)?.token || (await waitForToken(live))
    live = await flows.get(flow._id)
    if (!live.importId) {
      await flows.set(flow._id, { state: 'exporting', updatedAt: now(), progress: { bytes: 0 } })
      let ticket
      try {
        ticket = await cloud.startMove(token, live.keys.start)
      } catch (error) {
        if (error.code !== 'move_pending') throw error
        const waiting = ((await cloud.listMoves(token)).moves || []).find((move) => ['pending', 'running'].includes(move.state))
        if (!waiting || !live.replaceWaiting) throw new MoveError('move_pending', `A move${waiting?.teamName ? ` of ${waiting.teamName}` : ''} is already waiting on Slatebox Cloud for that account. Replace it to start again, or finish it there.`, 409)
        await cloud.discardMove(token, waiting.importId)
        ticket = await cloud.startMove(token, randomUUID())
      }
      await flows.set(flow._id, { into: ticket.into || null, updatedAt: now() })
      // A random passphrase encrypts the archive on its way to Cloud, then is forgotten.
      const passphrase = randomBytes(24).toString('base64url')
      let end = null
      const archive = await exportStream(flow.userId, passphrase, (written) => {
        end = written
      })
      let bytes = 0
      let lastSaved = 0
      const counter = new Transform({
        transform(chunk, _encoding, done) {
          bytes += chunk.length
          if (bytes - lastSaved > 256 * 1024) {
            lastSaved = bytes
            flows.set(flow._id, { progress: { bytes }, updatedAt: now() }).catch(() => {})
          }
          done(null, chunk)
        },
      })
      archive.on('error', (error) => counter.destroy(error))
      archive.pipe(counter)
      if (await cancelled(flow._id)) {
        archive.destroy?.()
        return
      }
      await flows.set(flow._id, { state: 'uploading', updatedAt: now() })
      const abort = new AbortController()
      aborts.set(flow._id, abort)
      let result
      try {
        result = await cloud.upload(ticket.uploadUrl, counter, passphrase, { signal: abort.signal })
      } finally {
        aborts.delete(flow._id)
        if (abort.signal.aborted) archive.destroy?.()
      }
      if (!result?.importId) throw new MoveError('cloud_refused', 'Slatebox Cloud did not take the archive.', 502)
      // Canceled as the upload finished: nothing goes live, and Cloud's copy is discarded.
      if (await cancelled(flow._id)) {
        await cloud.discardMove(token, result.importId).catch(() => {})
        return
      }
      const record = result.report ? result : await cloud.getMove(token, result.importId)
      const checked = verify(end?.counts, record.report)
      await flows.set(flow._id, {
        importId: result.importId,
        state: record.state === 'confirmed' ? 'moved' : 'review',
        progress: { bytes },
        report: { team: record.report?.team?.name ?? live.team?.name ?? null, into: ticket.into || null, duplicate: Boolean(result.duplicate) },
        verify: checked,
        others: Math.max(0, (record.report?.people || []).filter((person) => person.email).length - 1),
        ...(record.state === 'confirmed' && { cloudUrl: cloud.origin + '/' }),
        updatedAt: now(),
      })
      return
    }
    // Uploaded earlier (a resume after a new sign-in): Cloud says where it stands.
    const record = await cloud.getMove(token, live.importId)
    if (record.state === 'confirmed') {
      await flows.set(flow._id, { state: 'moved', cloudUrl: cloud.origin + '/', updatedAt: now() })
      return
    }
    if (record.state === 'discarded' || record.state === 'failed') {
      await flows.set(flow._id, { importId: null, keys: { ...live.keys, start: randomUUID(), confirm: randomUUID() }, updatedAt: now() })
      return moveSteps(flow)
    }
    if (live.confirmAsked) return confirmSteps(flow, token)
    await flows.set(flow._id, { state: 'review', failure: null, updatedAt: now() })
  }

  async function confirmSteps(flow, given) {
    const token = given || secrets.get(flow._id)?.token
    const live = await flows.get(flow._id)
    await flows.set(flow._id, { state: 'confirming', updatedAt: now() })
    const done = await cloud.confirmMove(token, live.importId, live.invite, live.keys.confirm)
    secrets.delete(flow._id)
    await flows.set(flow._id, { state: 'moved', cloudUrl: cloud.origin + '/', invited: done?.invited || null, merged: Boolean(done?.merged), updatedAt: now() })
  }

  async function startMove(userId, { replaceWaiting = false } = {}) {
    await admin(userId)
    const team = await preflight(userId)
    const latest = await flows.latest('move')
    if (latest && (ACTIVE.includes(latest.state) || RESUMABLE.includes(latest.state)) && latest.userId === userId) {
      if (RESUMABLE.includes(latest.state) || (latest.state === 'signing_in' && latest.signIn?.expiresAt < now()) || (!running.has(latest._id) && latest.state !== 'review'))
        return resumeMove(userId, latest._id, { replaceWaiting })
      return view(latest)
    }
    if (latest && ACTIVE.includes(latest.state) && latest.userId !== userId)
      throw new MoveError('move_running', 'Another administrator is moving a team from this server right now.', 409)
    const flow = { _id: newId(), kind: 'move', state: 'signing_in', userId, team: team.team, members: team.members, slates: team.slates, replaceWaiting, keys: { start: randomUUID(), confirm: randomUUID() }, createdAt: now(), updatedAt: now() }
    await flows.insert(flow)
    try {
      await signIn(flow, { scope: MOVE_SCOPE, clients: [SERVER_CLIENT, CLI_CLIENT] })
    } catch (error) {
      await fail(flow, error)
      throw error instanceof MoveError ? error : new MoveError(error.code || 'cloud_refused', cloudWords(error), 502)
    }
    drive(flow, moveSteps)
    return view(await flows.get(flow._id))
  }

  async function resumeMove(userId, flowId, { replaceWaiting } = {}) {
    await admin(userId)
    const flow = await own(userId, flowId, 'move')
    if (flow.userId !== userId) throw new MoveError('not_found', 'There is no such step to follow.', 404)
    if (['moved', 'cancelled'].includes(flow.state) || running.has(flow._id)) return view(flow)
    if (replaceWaiting !== undefined) await flows.set(flow._id, { replaceWaiting: Boolean(replaceWaiting) })
    if (!secrets.get(flow._id)?.token) {
      await signIn(flow, { scope: MOVE_SCOPE, clients: [SERVER_CLIENT, CLI_CLIENT] })
    } else await flows.set(flow._id, { failure: null, updatedAt: now() })
    drive(flow, moveSteps)
    return view(await flows.get(flow._id))
  }

  /** Make it live on Cloud (the administrator's yes), inviting the others or not. */
  async function confirmMove(userId, flowId, { invite = true } = {}) {
    await admin(userId)
    const flow = await own(userId, flowId, 'move')
    if (flow.userId !== userId) throw new MoveError('not_found', 'There is no such step to follow.', 404)
    if (flow.state === 'moved') return view(flow)
    if (flow.state !== 'review' && !(RESUMABLE.includes(flow.state) && flow.importId)) throw new MoveError('not_ready', 'The move is not ready to go live yet.', 409)
    await flows.set(flow._id, { invite: Boolean(invite), confirmAsked: true, failure: null, updatedAt: now() })
    if (!secrets.get(flow._id)?.token) {
      // The sign-in ended (an hour) or the server restarted: sign in again, then confirm.
      await signIn(flow, { scope: MOVE_SCOPE, clients: [SERVER_CLIENT, CLI_CLIENT] })
      drive(flow, moveSteps)
    } else {
      await flows.set(flow._id, { state: 'confirming', updatedAt: now() })
      drive(flow, (f) => confirmSteps(f))
    }
    return view(await flows.get(flow._id))
  }

  /** Stops a move. One uploaded but not live is discarded on Cloud; nothing here changes. */
  async function cancel(userId, flowId) {
    await admin(userId)
    const flow = await own(userId, flowId, 'move')
    if (['moved', 'cancelled'].includes(flow.state)) return view(flow)
    const token = secrets.get(flow._id)?.token
    // Said first, so a step still running sees it and stops without writing over it.
    await flows.set(flow._id, { state: 'cancelled', signIn: null, failure: null, updatedAt: now() })
    aborts.get(flow._id)?.abort()
    if (flow.importId && token) await cloud.discardMove(token, flow.importId).catch(() => {})
    secrets.delete(flow._id)
    return view(await flows.get(flow._id))
  }

  async function follow(userId, flowId) {
    await admin(userId)
    const flow = typeof flowId === 'string' && /^[a-f0-9]{24}$/.test(flowId) ? await flows.get(flowId) : null
    if (!flow || flow.kind !== 'move') throw new MoveError('not_found', 'There is no such step to follow.', 404)
    // A sign-in nobody approved in time.
    if (flow.state === 'signing_in' && flow.signIn?.expiresAt < now() - 5000 && !running.has(flow._id)) {
      await flows.set(flow._id, { state: 'failed', signIn: null, failure: { code: 'expired_token', message: CLOUD_WORDS.expired_token }, updatedAt: now() })
      return view(await flows.get(flow._id))
    }
    // The server restarted mid-way: the in-memory token is gone, so it needs a new sign-in.
    if (ACTIVE.filter((state) => state !== 'review').includes(flow.state) && !running.has(flow._id) && !secrets.has(flow._id)) {
      await flows.set(flow._id, { state: 'needs_sign_in', signIn: null, failure: { code: 'sign_in_ended', message: 'This server restarted while it worked. Sign in again to go on from where it stopped.' }, updatedAt: now() })
      return view(await flows.get(flow._id))
    }
    return view(flow)
  }

  return {
    startMove,
    resumeMove,
    confirmMove,
    cancel,
    follow,
    latest: async (userId) => {
      await admin(userId)
      return view(await flows.latest('move'))
    },
    // for tests: wait until no flow is running
    idle: async () => {
      while (running.size) await new Promise((resolve) => setTimeout(resolve, 5))
    },
  }
}
