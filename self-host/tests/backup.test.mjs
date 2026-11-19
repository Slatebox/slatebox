// Backup while running, restore into a new installation, and refusal of a bad file.
import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import { cleanup, docker, freePort, healthy, logs, name, ok, remove, removeVolume, secrets, start, volume } from './lib.mjs'
import { closeChrome, expectSlate, seedSlate } from './slate.mjs'

// Each test removes what it started, so only a few containers ever run at once.
afterEach(cleanup)
after(closeChrome)

const backup = id => docker(['exec', id, 'slatebox', 'backup'], { encoding: null })
const restore = (id, file) => docker(['exec', '-i', id, 'slatebox', 'restore'], { input: file })

test('a backup taken while running restores into a brand-new installation', async () => {
  const port = await freePort()
  const id = name('backup')
  const first = await start({ port, containerName: id })
  await healthy(first.id)
  const slate = await seedSlate(first.url, 'Kept in the backup')

  const taken = await backup(first.id)
  assert.equal(taken.code, 0, taken.stderr)
  assert.match(taken.stderr, /Backup complete: \d+ bytes\./)
  // A gzip stream holding a mongodump archive.
  assert.equal(gunzipSync(taken.stdout).subarray(0, 4).toString('hex'), '6de29981')
  // The original kept running throughout.
  assert.equal((await docker(['exec', first.id, 'slatebox', 'health'])).code, 0)
  const original = await secrets(first.id)

  // Lose everything: container and volume.
  await remove(first.id)
  await removeVolume(first.data)

  // A new installation at the same address, then the one restore command.
  const second = await start({ port, containerName: id, data: await volume() })
  await healthy(second.id)
  const restored = await restore(second.id, taken.stdout)
  assert.equal(restored.code, 0, restored.stderr)
  assert.match(restored.stderr, /Restore complete\. Slatebox is ready\./)
  assert.equal((await docker(['exec', second.id, 'slatebox', 'health', '--deep'])).code, 0)

  // The author's own browser session opens the slate again, on an
  // installation whose secrets are entirely new.
  await expectSlate(slate, 'Kept in the backup')
  const fresh = Object.values(await secrets(second.id))
  assert.equal(Object.values(original).filter(value => fresh.includes(value)).length, 0)
  // The supervisor paused and resumed the app rather than restarting the container.
  const log = await logs(second.id)
  assert.match(log, /Pausing the app and the relay\.[\s\S]*Starting the app and the relay again\.[\s\S]*Ready\. Open/)
})

test('a restore replaces what is there, and the result is exactly the backup', async () => {
  const box = await start()
  await healthy(box.id)
  const kept = await seedSlate(box.url, 'In the backup')
  const taken = await backup(box.id)
  assert.equal(taken.code, 0, taken.stderr)
  const later = await seedSlate(box.url, 'Made after the backup')
  const count = async () => Number(await ok(['exec', box.id, 'node', '--input-type=module', '-e', `
    import { mongodb, mongoUrl, readSecrets } from '/opt/slatebox/lib/common.mjs'
    const client = new (mongodb().MongoClient)(mongoUrl('root', readSecrets().mongoRootPassword, { database: '', authSource: 'admin' }))
    await client.connect()
    console.log(await client.db('slatebox').collection('slates').countDocuments())
    await client.close()`]))
  const before = await count()

  const restored = await restore(box.id, taken.stdout)
  assert.equal(restored.code, 0, restored.stderr)
  assert.equal(await count(), before - 1, 'the slate made after the backup is gone')
  await expectSlate(kept, 'In the backup')
  await assert.rejects(expectSlate(later, 'Made after the backup'))
})

test('a restore refuses a file that is not a complete backup and changes nothing', async () => {
  const box = await start()
  await healthy(box.id)
  const slate = await seedSlate(box.url, 'Untouched by a bad restore')
  const taken = await backup(box.id)

  const cases = [
    [Buffer.alloc(0), /No backup arrived/],
    [Buffer.from('this is not a backup\n'), /not a complete Slatebox backup\. Nothing was changed\./],
    [taken.stdout.subarray(0, Math.floor(taken.stdout.length / 2)), /not a complete Slatebox backup\. Nothing was changed\./],
  ]
  for (const [file, message] of cases) {
    const refused = await restore(box.id, file)
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, message)
  }
  assert.doesNotMatch(await logs(box.id), /Pausing the app/, 'the app was never paused')
  assert.equal((await docker(['exec', box.id, 'slatebox', 'health', '--deep'])).code, 0)
  await expectSlate(slate, 'Untouched by a bad restore')
  // No working files are left on the volume.
  assert.equal(await ok(['exec', box.id, 'sh', '-c', 'ls /data/tmp | wc -l']), '0')
})
