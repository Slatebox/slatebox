// Live updates come from MongoDB change streams, with polling as the only fallback (Meteor 3.6.1):
// packages.mongo.reactivity is ["changeStreams","polling"] in the example settings, in the settings the
// one-container image writes (configure.mjs) and in the compose kit's (init.mjs). MONGO_OPLOG_URL stays
// set everywhere until the change-stream measurement says it can go.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
const ORDER = ['changeStreams', 'polling']

test('settings.example.json: change streams, then polling, no oplog', () => {
  const example = JSON.parse(read('web/app/settings.example.json'))
  assert.deepEqual(example.packages.mongo.reactivity, ORDER)
})

test('the one-container image writes the same order, and an operator packages.mongo still wins', () => {
  const configure = read('self-host/rootfs/opt/slatebox/lib/configure.mjs')
  assert.match(configure, /const MONGO_REACTIVITY = Object\.freeze\(\['changeStreams', 'polling'\]\)/)
  assert.match(configure, /settings\.packages = \{ \.\.\.settings\.packages, mongo: \{ reactivity: MONGO_REACTIVITY, \.\.\.settings\.packages\?\.mongo \} \}/)
  // Written before METEOR_SETTINGS is serialised.
  assert.ok(configure.indexOf('settings.packages = ') < configure.indexOf('METEOR_SETTINGS: JSON.stringify(settings)'))
})

test('the compose kit writes the same order', () => {
  assert.match(read('self-host/init.mjs'), /packages: \{ mongo: \{ reactivity: \['changeStreams', 'polling'\] \} \}/)
})

test('MONGO_OPLOG_URL is not removed yet: the image and the compose kit still set it', () => {
  assert.match(read('self-host/rootfs/opt/slatebox/lib/configure.mjs'), /MONGO_OPLOG_URL: externalMongo\n\s+\? externalOplog\n\s+: mongoUrl\('app', secrets\.mongoAppPassword, \{ database: 'local', authSource: DATABASE \}\)/)
  assert.match(read('self-host/compose.yaml'), /MONGO_OPLOG_URL: mongodb:\/\/app:/)
})
