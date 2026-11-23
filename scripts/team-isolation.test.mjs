// Cross-team isolation: a person (or their token) in team B is refused every read and write of
// team A's slates that A did not open to everyone, whatever ids B names; B's exports hold none
// of A; an import into a new team never lands in A or B. The export and import halves are in
// scripts/team-export.test.mjs; this file covers the slate and token surfaces every agent uses.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiTokenService } from '../web/app/server/api-token-core.mjs'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'
import { memoryMeteorCollection } from './action-test-stores.mjs'

function teams() {
  const users = memoryMeteorCollection('user')
  const apiTokens = memoryMeteorCollection('token')
  const slates = memoryMeteorCollection('slate')
  const slateAccess = memoryMeteorCollection('grant')
  users.docs.push(
    { _id: 'alice', orgId: 'teamA' },
    { _id: 'bob', orgId: 'teamA' },
    { _id: 'carol', orgId: 'teamB' },
  )
  slates.docs.push(
    { _id: 'a-private', shareId: 'aprivate01', userId: 'alice', orgId: 'teamA', options: { isPrivate: true } },
    { _id: 'a-unlisted', shareId: 'aunlisted1', userId: 'alice', orgId: 'teamA', options: { isUnlisted: true } },
    { _id: 'a-public', shareId: 'apublic001', userId: 'alice', orgId: 'teamA', options: { isPublic: true } },
    { _id: 'a-shared', shareId: 'ashared001', userId: 'alice', orgId: 'teamA', options: { isPrivate: true } },
    { _id: 'b-private', shareId: 'bprivate01', userId: 'carol', orgId: 'teamB', options: { isPrivate: true } },
  )
  slateAccess.docs.push(
    { _id: 'g1', slateId: 'a-unlisted', type: 'unlisted', slateAccessPermissionId: 'EDIT', accessKey: 'unlistedkey' },
    { _id: 'g2', slateId: 'a-shared', type: 'private', userId: 'bob', slateAccessPermissionId: 'EDIT', accessKey: 'bobkey' },
    { _id: 'g3', slateId: 'a-public', type: 'public', slateAccessPermissionId: 'READ', accessKey: 'publickey' },
  )
  const service = createApiTokenService({ users, apiTokens, slates, slateAccess })
  return { service, slates }
}

const token = (userId) => ({ _id: 'tok-' + userId, userId, name: 'Agent' })

test('a token in team B reads and writes none of team A\'s slates that A kept to itself', async () => {
  const { service } = teams()
  for (const shareId of ['aprivate01', 'aunlisted1', 'ashared001']) {
    for (const write of [false, true]) {
      const { authorized } = await service.authorizeTokenForSlate(token('carol'), shareId, write)
      assert.equal(authorized, false, `carol ${write ? 'writes' : 'reads'} ${shareId}`)
    }
  }
  // What A published to everyone, B may read and never write.
  assert.equal((await service.authorizeTokenForSlate(token('carol'), 'apublic001', false)).authorized, true)
  assert.equal((await service.authorizeTokenForSlate(token('carol'), 'apublic001', true)).authorized, false)
  // Being in the same team is not access either: a slate is opened per slate.
  assert.equal((await service.authorizeTokenForSlate(token('bob'), 'aprivate01', false)).authorized, false)
  assert.equal((await service.authorizeTokenForSlate(token('bob'), 'ashared001', true)).authorized, true)
  // And A reaches none of B's.
  assert.equal((await service.authorizeTokenForSlate(token('alice'), 'bprivate01', false)).authorized, false)
})

test('the slate actions, called as team B with team A\'s ids, are refused before they read or write', async () => {
  const { service, slates } = teams()
  const registry = createAppRegistry({
    deps: {
      authorizeTokenForSlate: service.authorizeTokenForSlate,
      // the session rule: a slate is the caller's to edit only when they own it
      async resolveSlateForUser(shareId, userId) {
        const slate = slates.docs.find((doc) => doc.shareId === shareId)
        return slate && { slate, canRead: slate.userId === userId, canEdit: slate.userId === userId }
      },
      // never reached: the load refuses first
      readSlate: () => assert.fail('read a slate it may not'),
      saveCore: { save: () => assert.fail('saved a slate it may not') },
    },
  })
  const carolToken = { kind: 'agent', userId: 'carol', tokenId: 'tok-carol', tokenName: 'Agent', scopes: registry.scopes }
  const carolSession = { kind: 'person', userId: 'carol', tokenId: null, tokenName: null, scopes: registry.scopes }
  const calls = [
    [carolToken, 'slates.get', { shareId: 'aprivate01' }],
    [carolToken, 'slates.get', { shareId: 'ashared001' }],
    [carolToken, 'slates.get', { shareId: 'aunlisted1' }],
    [carolToken, 'slates.exportMermaid', { shareId: 'aprivate01' }],
    [carolSession, 'slates.updateSettings', { shareId: 'aprivate01', welcomeAid: 'mine' }],
    [carolSession, 'slates.updateSettings', { shareId: 'apublic001', welcomeAid: 'mine' }],
  ]
  for (const [principal, id, input] of calls)
    await assert.rejects(registry.run(principal, id, input), (error) => [403, 404].includes(error.status), `${id} ${input.shareId}`)
})

test('team export and import are scoped: one team\'s admin cannot name another team, and only administrators import', () => {
  const registry = createAppRegistry()
  // team.export takes no team: it is always the caller's own.
  assert.deepEqual(Object.keys(registry.get('team.export').input.properties), [])
  for (const id of ['teamImports.start', 'teamImports.list', 'teamImports.get', 'teamImports.confirm', 'teamImports.discard'])
    assert.equal(registry.get(id).scope, 'team:import', id)
  assert.equal(registry.get('team.export').scope, 'team:export')
})
