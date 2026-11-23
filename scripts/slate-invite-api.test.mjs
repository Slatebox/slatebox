import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import express from 'express'
import { createSlateInviteOperation } from '../web/app/server/slate-invite-api.mjs'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'
import { mountHttp } from '../web/app/server/actions/http.mjs'
import { buildOpenApi } from '../web/app/server/actions/openapi.mjs'
import { createIdempotencyStore } from '../web/app/server/actions/idempotency.mjs'
import { memoryDriverCollection } from './action-test-stores.mjs'

// Restated (P02): the published schema is generated from the action registry.
const slateOpenApi = buildOpenApi(createAppRegistry())
import { configureGeneralLink } from '../web/app/server/methods/general-slate-link.mjs'

const key = 'grant-1',
  shareId = 'synthetic',
  token = { _id: 'test-token', userId: 'owner' }
const issue = { token, shareId, key, body: { role: 'read' }, revoke: false }

test('invite commands and published schema require explicit role, generation and retry intent', async () => {
  const run = createSlateInviteOperation({})
  for (const body of [
    null,
    {},
    { role: 'admin' },
    { role: 'EDIT' },
    { role: 'edit', email: 'owner@example.invalid' },
    { role: 'read', isPublic: true },
  ]) {
    await assert.rejects(run({ ...issue, body }), { code: 'invalid_request' })
  }
  for (const badKey of ['', undefined, 'a b', 'z'.repeat(129)])
    await assert.rejects(run({ ...issue, key: badKey }), {
      code: 'invalid_request',
    })
  for (const inviteId of ['wrong', null, undefined])
    await assert.rejects(
      run({ ...issue, body: undefined, revoke: true, inviteId }),
      { code: 'invalid_request' }
    )
  const post = slateOpenApi.paths['/slates/{shareId}/invite'].post
  const del = slateOpenApi.paths['/slates/{shareId}/invite/{inviteId}'].delete
  assert.equal(post['x-required-scope'], 'slates:share')
  assert.deepEqual(
    post.requestBody.content['application/json'].schema.properties.role.enum,
    ['read', 'comment', 'edit']
  )
  assert.equal(del.requestBody, undefined)
  assert.equal(del.parameters.find((p) => p.name === 'inviteId').in, 'path')
})

// Restated (P02): the route is mounted from the registry, and a token without slates:share
// now gets 403 insufficient_scope (it was 401, when the scope was checked as authentication).
test('a token with read and write only cannot reach invite handling; DELETE rejects bodies', async (t) => {
  const registry = createAppRegistry({
    deps: {
      manageInvite: async () => {
        throw Error('must not reach mutation')
      },
    },
    idempotency: createIdempotencyStore({ collection: memoryDriverCollection() }),
  })
  const app = express()
  mountHttp(app, registry, {
    express,
    authenticate: async (req) => {
      const raw = req.get('authorization')
      if (raw === 'Bearer share') return { kind: 'agent', ...token, tokenId: token._id, scopes: ['slates:share'] }
      if (raw === 'Bearer readwrite') return { kind: 'agent', ...token, tokenId: token._id, scopes: ['slates:read', 'slates:write'] }
      return null
    },
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((ok) => server.once('listening', ok))
  t.after(() => new Promise((ok) => server.close(ok)))
  const url =
    'http://127.0.0.1:' +
    server.address().port +
    '/api/v1/slates/example/invite'
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { authorization: 'Bearer readwrite' },
      })
    ).status,
    403
  )
  assert.equal(
    (
      await fetch(url + '/' + 'a'.repeat(32), {
        method: 'DELETE',
        headers: {
          authorization: 'Bearer share',
          'content-type': 'application/json',
        },
        body: '{}',
      })
    ).status,
    400
  )
})

test(
  'Mongo invitation lifecycle remains consistent across UI changes, active retries, replacement, named access and mixed historical grants',
  {
    skip: !process.env.SLATEBOX_TEST_WORKSHOP_MONGO_PORT,
  },
  async (t) => {
    const port = Number(process.env.SLATEBOX_TEST_WORKSHOP_MONGO_PORT)
    assert.ok(Number.isInteger(port) && port > 0 && port < 65536)
    const require = createRequire(
      new URL('../web/app/package.json', import.meta.url)
    )
    const { MongoClient } = require(
      process.env.SLATEBOX_TEST_MONGODB_DRIVER || 'mongodb'
    )
    const client = new MongoClient('mongodb://127.0.0.1:' + port)
    const db = client.db(
      'slatebox_invite_test_' + randomUUID().replaceAll('-', '')
    )
    t.after(async () => {
      await db.dropDatabase()
      await client.close()
    })
    const users = db.collection('users'),
      slates = db.collection('slates'),
      grants = db.collection('access'),
      runs = db.collection('runs')
    await users.insertMany([
      { _id: 'owner' },
      { _id: 'peer' },
      { _id: 'guest', isAnonymous: true },
    ])
    await slates.insertOne({
      _id: 'slate',
      shareId,
      userId: 'owner',
      options: { isPrivate: true },
    })
    await grants.insertOne({
      _id: 'named',
      slateId: 'slate',
      type: 'private',
      userId: 'peer',
      slateAccessPermissionId: 'EDIT',
    })
    await runs.createIndex({ tokenId: 1, idempotencyKey: 1 }, { unique: true })
    const core = {
      users,
      slates,
      grants,
      runs,
      withTransaction: (f) =>
        client.withSession((s) => s.withTransaction(() => f(s))),
      generateKey: () => randomUUID().slice(0, 8),
      appOrigin: () => 'https://operator.example',
    }
    const run = createSlateInviteOperation(core)
    await assert.rejects(
      run({ ...issue, token: { ...token, userId: 'guest' } }),
      { status: 403 }
    )
    await assert.rejects(
      run({ ...issue, token: { ...token, userId: 'peer' } }),
      { status: 404 }
    )
    const [a, b] = await Promise.all([run(issue), run(issue)])
    assert.deepEqual([a.status, b.status].sort(), [200, 201])
    assert.deepEqual(a.body, b.body)
    const { inviteId, url } = a.body
    const gen = {
      ...issue,
      inviteId,
      revoke: true,
      key: 'withdraw',
      body: undefined,
    }
    assert.match(inviteId, /^[a-f0-9]{32}$/)
    assert.match(url, /^https:\/\/operator\.example\/canvas\//)
    assert.equal(await runs.countDocuments(), 1)
    assert.ok(
      !JSON.stringify(await runs.findOne({})).includes(
        new URL(url).pathname.split('/').pop()
      )
    )
    await assert.rejects(run({ ...issue, body: { role: 'edit' } }), {
      code: 'idempotency_conflict',
    })
    const edited = await run({
      ...issue,
      body: { role: 'edit' },
      key: 'upgrade',
    })
    assert.equal(edited.body.url, url)
    assert.equal(edited.body.inviteId, inviteId)
    await assert.rejects(run(issue), { code: 'invite_changed' })
    // The browser Share dialog uses this same transaction and grant mutation.
    await core.withTransaction(async (session) => {
      const owner = { _id: 'slate', userId: 'owner' }
      const board = await slates.findOneAndUpdate(
        owner,
        { $inc: { sharingRevision: 1 } },
        { session, includeResultMetadata: false }
      )
      await configureGeneralLink(
        { owner, board, boards: slates, grants, session },
        {
          type: 'unlisted',
          permission: 'COMMENT',
          generateKey: core.generateKey,
        }
      )
    })
    const share = await run({
      ...issue,
      key: 'comment',
      body: { role: 'comment' },
    })
    assert.equal(share.body.url, url)
    const drop = await run(gen)
    assert.deepEqual(drop.body, { shareId, inviteId, revoked: true })
    assert.equal((await slates.findOne({})).options.isPrivate, true)
    assert.equal(await grants.countDocuments({ _id: 'named' }), 1)
    assert.equal(
      await grants.countDocuments({
        accessKey: new URL(url).pathname.split('/').pop(),
      }),
      0
    )
    assert.deepEqual(await run(gen), drop)
    await assert.rejects(run(issue), { code: 'invite_changed' })
    const replacement = await run({ ...issue, key: 'fresh' })
    assert.notEqual(replacement.body.inviteId, inviteId)
    assert.notEqual(replacement.body.url, url)
    assert.deepEqual(await run(gen), drop)
    await assert.rejects(run({ ...gen, key: 'stale-generation' }), {
      code: 'invite_changed',
    })
    assert.equal(
      (await run({ ...issue, key: 'fresh' })).body.url,
      replacement.body.url
    )
    await grants.insertOne({
      _id: 'historical',
      slateId: 'slate',
      type: 'unlisted',
      accessKey: 'other',
      slateAccessPermissionId: 'EDIT',
    })
    await assert.rejects(run({ ...issue, key: 'many' }), {
      code: 'multiple_invites',
    })
    const repair = await run({
      ...gen,
      key: 'remove-all',
      inviteId: replacement.body.inviteId,
    })
    assert.equal(repair.body.revoked, true)
    assert.equal(await grants.countDocuments(), 1)
    await slates.insertOne({
      _id: 'another',
      shareId: 'another',
      userId: 'owner',
      options: { isPrivate: true },
    })
    const contested = 'one-key-two-boards'
    const competing = await Promise.allSettled([
      run({ ...issue, key: contested }),
      run({ ...issue, shareId: 'another', key: contested }),
    ])
    assert.deepEqual(competing.map((r) => r.status).sort(), [
      'fulfilled',
      'rejected',
    ])
    assert.equal(
      competing.find((r) => r.status === 'rejected').reason.code,
      'idempotency_conflict'
    )
    assert.equal(await slates.countDocuments({ 'options.isUnlisted': true }), 1)
    const loser = await slates.findOne({ 'options.isPrivate': true })
    const broken = createSlateInviteOperation({
      ...core,
      runs: {
        findOne: () => null,
        insertOne: () => {
          throw Error('receipt unavailable')
        },
      },
    })
    await assert.rejects(
      broken({ ...issue, key: 'rollback', shareId: loser.shareId }),
      /receipt unavailable/
    )
    assert.equal(
      (await slates.findOne({ _id: loser._id })).options.isPrivate,
      true
    )
    assert.equal(
      await grants.countDocuments({ slateId: loser._id, userId: null }),
      0
    )
    await slates.updateOne(
      { _id: 'slate' },
      { $set: { options: { isPublic: true } } }
    )
    await assert.rejects(run({ ...issue, key: 'public' }), {
      code: 'public_slate',
    })
    assert.equal(
      (await slates.findOne({ _id: 'slate' })).options.isPublic,
      true
    )
  }
)
