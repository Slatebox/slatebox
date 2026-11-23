import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { portableWorkshopSlate } from '../web/app/imports/api/common/portableWorkshopSlate.mjs'

const { encodeWorkshopFragment, nightTransfer, releasePlan } =
  createRequire(new URL('../web/app/package.json', import.meta.url))('slateboxjs/workshops/model')

const caseModel = {
  version: 1, title: 'Two mounts & three loans',
  lanes: [{ id: 'store', label: 'Reserve' }, { id: 'case', label: 'Loan case', capacity: 2 }],
  cards: [
    { id: 'shell', label: 'Coquille émaillée', laneId: 'case' },
    { id: 'chart', label: 'Star chart', laneId: 'store' },
  ],
}

test('a portable workshop keeps authored labels, placements and rule types in its owned document', () => {
  for (const workshop of [caseModel, nightTransfer, releasePlan]) {
    const source = structuredClone(workshop)
    const imported = portableWorkshopSlate.initial(encodeWorkshopFragment(workshop))
    assert.deepEqual(imported.workshop, source)
    assert.equal(imported.kind, 'workshop')
    assert.equal(portableWorkshopSlate.name(imported), source.title)
    assert.deepEqual(portableWorkshopSlate.normalize(JSON.parse(JSON.stringify(imported))), imported)
    assert.deepEqual(workshop, source)
  }
})

test('invalid, oversized and duplicated import payloads fail before creating a document', () => {
  for (const hash of ['', '#model=%7B', '#model={}&model={}', '#model='+'x'.repeat(65536),
    '#'+new URLSearchParams({model:JSON.stringify({...caseModel,lanes:[]})})]) {
    assert.throws(() => portableWorkshopSlate.initial(hash))
  }
  assert.throws(() => portableWorkshopSlate.normalize({ kind:'workshop', version:2,workshop:caseModel }))
  assert.throws(() => portableWorkshopSlate.normalize({ kind:'listening-room',version:1,workshop:caseModel }))
})
