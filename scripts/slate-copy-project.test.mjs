// A slate's project is its own: a copy, a library snapshot and a team export's copy never carry it,
// and a copy goes in a project only where its maker puts it (slates.copy projectId, checked by
// server/projects/place.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { copyDocument, sourceOnly } from '../web/app/server/actions/slate-copy.mjs'
import { snapshotSlate } from '../web/app/server/library/snapshot.mjs'
import { checkPlacement } from '../web/app/server/projects/place.mjs'
import { projectWorld } from './project-test-stores.mjs'

const source = { _id: 'src', shareId: 'srcShare', userId: 'ana', orgId: 't1', projectId: 'd1', options: { name: 'Map', isPrivate: true }, nodes: [] }
const made = (placement) => copyDocument(source, { id: 'c1', shareId: 'c1s', user: { _id: 'eve', orgId: 't2' }, now: 1, placement })

test('a copy strips the source\'s project', () => {
  assert.ok(sourceOnly.includes('projectId'))
  const copy = made(null)
  assert.equal(copy.projectId, undefined)
  assert.equal(copy.orgId, 't2', 'an ordinary copy is its maker\'s team\'s')
})

test('a copy put in a project is that project\'s team\'s', () => {
  const copy = made({ projectId: 'd9', orgId: 't1' })
  assert.deepEqual([copy.projectId, copy.orgId, copy.userId], ['d9', 't1', 'eve'])
  const personal = made({ projectId: 'd8', orgId: null })
  assert.deepEqual([personal.projectId, personal.orgId], ['d8', undefined])
})

test('a library snapshot never carries the author\'s project', () => {
  assert.equal(snapshotSlate(source).projectId, undefined)
})

test('placement: none outside a project; an editor of the project; refused for a viewer, a stranger or a guest', async () => {
  const w = projectWorld()
  const drive = await w.core.create(w.person('ana'), { name: 'Platform' })
  const place = (user, projectId, options) => checkPlacement({ access: w.access }, user, projectId, options)
  assert.deepEqual(await place({ _id: 'eve', orgId: 't2' }, undefined), { projectId: null, orgId: 't2' })
  await assert.rejects(place({ _id: 'eve', orgId: 't2' }, drive.projectId), { status: 404 })
  await w.core.share(w.person('ana'), drive.projectId, { userId: 'eve', role: 'viewer' })
  await assert.rejects(place({ _id: 'eve', orgId: 't2' }, drive.projectId), { status: 403 })
  await w.core.share(w.person('ana'), drive.projectId, { userId: 'eve', role: 'editor' })
  assert.deepEqual(await place({ _id: 'eve', orgId: 't2' }, drive.projectId), { projectId: drive.projectId, orgId: 't1' })
  await assert.rejects(place(null, drive.projectId), { status: 403 })
  await assert.rejects(place({ _id: 'eve' }, 'bad id!'), { status: 400 })
  // a token never uses a team admin's rights to place a slate
  assert.deepEqual(await place({ _id: 'dee', orgId: 't1' }, drive.projectId), { projectId: drive.projectId, orgId: 't1' })
  await assert.rejects(place({ _id: 'dee', orgId: 't1' }, drive.projectId, { token: true }), { status: 404 })
})

test('a team export carries no slate\'s project', async () => {
  const { slateContent } = await import('../web/app/server/team-export/format.mjs')
  assert.equal(slateContent(source).projectId, undefined)
})
