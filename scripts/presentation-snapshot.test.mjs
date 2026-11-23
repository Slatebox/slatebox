import assert from 'node:assert/strict'
import { test } from 'node:test'
import { finishSnapshot, ownedSnapshotKey } from '../web/app/server/common/presentationSnapshot.mjs'

const base = 'https://assets.example.invalid/assets'
const key = '2026/11/18/present_V1_run2.png'

test('cleanup accepts only this presentation and exact stored generation on its asset origin', () => {
  assert.equal(ownedSnapshotKey(base + '/' + key, base + '/', 'V1', 'run2'), key)
  for (const [url, id, generation] of [
    [base + '/' + key, 'V2', 'run2'],
    [base + '/' + key, 'V1', 'run1'],
    [base + '/' + key, 'V1'],
    [base + '/' + key + '?cache=1', 'V1', 'run2'],
    [base + '/other/' + key, 'V1', 'run2'],
    ['https://elsewhere.example.invalid/' + key, 'V1', 'run2'],
  ]) assert.equal(ownedSnapshotKey(url, base, id, generation), null)
  for (const legacy of ['present_V1.png', '2026/09/12/present_V1.png']) {
    assert.equal(ownedSnapshotKey(base + '/' + legacy, base, 'V1'), legacy)
  }
})

test('withdraw and republish while rendering discard only the old image', async () => {
  const stored = new Set()
  let current = 'before'
  let imageUrl = null
  let resume
  const held = new Promise(resolve => { resume = resolve })
  const render = async (generation, wait) => finishSnapshot(async () => {
    await wait
    stored.add(generation)
    return { url: generation }
  }, image => {
    if (current !== generation) return 0
    imageUrl = image.url
    return 1
  }, url => stored.delete(url))

  const old = render('before', held)
  current = 'after'
  await render('after')
  resume()
  await old
  assert.equal(imageUrl, 'after')
  assert.deepEqual([...stored], ['after'])

  const withdrawn = render('withdrawn')
  current = null
  await withdrawn
  assert.deepEqual([...stored], ['after'])
})
