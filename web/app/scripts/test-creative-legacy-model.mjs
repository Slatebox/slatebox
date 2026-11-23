import assert from 'node:assert/strict'
import { readCreativeState } from '../imports/api/common/creativeSlates.mjs'

const base = { version: 1, firstPrint: 'Fern', secondPrint: 'Moth', thirdPrint: 'Sea fan', route: 'opener' }
const stored = { revision: 4, model: base }
const reopened = readCreativeState(stored)
assert.deepEqual(reopened, { revision: 4, model: { ...base, kind: 'focus-darkroom' } })
assert.equal(stored.model.kind, undefined)
assert.equal(readCreativeState(reopened), reopened)
const future = { revision: 8, model: { ...base, kind: 'future-medium' } }
assert.equal(readCreativeState(future), future)
const broken = { revision: 1, model: { ...base, route: 'missing' } }
assert.equal(readCreativeState(broken), broken)
console.log('PASS kindless darkrooms reopen with the saved print names, return path and revision')
