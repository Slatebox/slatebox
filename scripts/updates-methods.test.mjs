// Admin › Updates' methods (server/updates/meteor.js), read as source: registered only on a
// self-hosted server, every one for a server administrator alone, rate limited, audited; the page
// and the admin link only on a self-hosted server; US spelling and no payment words in the copy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ADMIN_SECTIONS, SELF_HOST_SECTIONS, adminLinksFor, selfHostedServer } from '../web/app/imports/api/common/server-admin.mjs'
import CONSTANTS from '../web/app/imports/api/common/constants.js'

const app = fileURLToPath(new URL('../web/app/', import.meta.url))
const read = path => readFileSync(`${app}${path}`, 'utf8')
const meteor = read('server/updates/meteor.js')

test('the methods exist only on a self-hosted server (the setup link\'s rule), never on Cloud', () => {
  assert.match(meteor, /export const updatesApply = setupAppliesHere/)
  assert.match(meteor, /if \(updatesApply\) \{[\s\S]*Meteor\.methods\(/)
  assert.equal(selfHostedServer({ public: { env: 'selfhost', edition: 'self-host' } }), true)
  assert.equal(selfHostedServer({ public: { env: 'selfhost', edition: 'cloud' } }), false)
  assert.equal(selfHostedServer({ public: { env: 'production' } }), false)
  assert.match(read('server/main.js'), /import '\.\/updates\/meteor'/)
})

test('every method checks the server administrator claim (isInstanceAdmin), so a team admin is refused', () => {
  const names = Object.values(CONSTANTS.methods.updates)
  assert.deepEqual(names.sort(), ['updates.applyNow', 'updates.approve', 'updates.cancel', 'updates.checkNow', 'updates.retry', 'updates.rollback', 'updates.setPolicy', 'updates.status'])
  assert.match(meteor, /const asAdmin = async \(method\) => \{\s*if \(!method\.userId \|\| !\(await isInstanceAdmin\(method\.userId\)\)\) throw new Meteor\.Error\(403/)
  const registered = [...meteor.matchAll(/\[M\.(\w+)\]: plain\(/g)].map(m => m[1])
  assert.equal([...meteor.matchAll(/\[M\.\w+\]:/g)].length, registered.length, 'no method outside plain()')
  assert.deepEqual(registered.sort(), Object.keys(CONSTANTS.methods.updates).sort(), 'each one goes through plain(), which calls asAdmin first')
  assert.match(meteor, /const plain = \(fn\) => async function \(\.\.\.args\) \{\s*const who = await asAdmin\(this\)/)
})

test('rate limits: check now once a minute, each change ten a minute; changes audited', () => {
  assert.match(meteor, /DDPRateLimiter\.addRule\(\{ type: 'method', name: M\.checkNow, userId: \(\) => true \}, 1, 60000\)/)
  assert.match(meteor, /for \(const name of \[M\.setPolicy, M\.approve, M\.applyNow, M\.retry, M\.cancel, M\.rollback\]\) \{\s*DDPRateLimiter\.addRule\(\{ type: 'method', name, userId: \(\) => true \}, 10, 60000\)/)
  assert.match(meteor, /audit: \(\{ by, action, before, after \}\) => Audit\.insertAsync\(\{ type: 'self-host-updates'/)
})

test('the default feed is fetched only from GitHub\'s hosts; SLATEBOX_UPDATES=off starts no timer', () => {
  assert.match(meteor, /safeFetch\(url, \{ allowHosts: FEED_HOSTS/)
  assert.match(meteor, /if \(mode !== 'off'\) \{\s*Meteor\.startup/)
})

test('the Updates link and route only on a self-hosted server', () => {
  assert.deepEqual(SELF_HOST_SECTIONS.map(s => s.to), ['/admin/updates'])
  assert.deepEqual(adminLinksFor(true, { selfHosted: true }).map(s => s.to), ['/admin', '/admin/ai', '/admin/library', '/admin/updates'])
  assert.deepEqual(adminLinksFor(true).map(s => s.to), ADMIN_SECTIONS.map(s => s.to), 'Cloud: no Updates')
  assert.deepEqual(adminLinksFor(false, { selfHosted: true }), [])
  assert.match(read('imports/ui/SBRoutes.jsx'), /\{selfHostedServer\(Meteor\.settings\) && <Route path="\/admin\/updates" element=\{<PrivateRoute><AdminRoute><Updates \/><\/AdminRoute><\/PrivateRoute>\} \/>\}/)
  assert.match(read('imports/ui/pages/AdminTools.jsx'), /\{selfHostedServer\(Meteor\.settings\) && \(\s*<Grid size=\{12\}>\s*<UpdatesCard \/>/)
})

test('the copy: US spelling and no payment words', () => {
  const copy = ['server/updates/service.mjs', 'server/updates/policy.mjs', 'imports/ui/pages/admin/updates/Updates.jsx', 'imports/ui/pages/admin/updates/UpdatesCard.jsx', 'imports/ui/pages/admin/updates/updates-view.mjs'].map(read).join('\n')
  assert.doesNotMatch(copy, /\b(colour|behaviour|organis\w*|authoris\w*|favourite|centre|licence)\b/i)
  assert.doesNotMatch(copy, /stripe|\bbilling\b|\bpayments?\b|\bsubscriptions?\b|\binvoices?\b|\bpricing\b|top.?ups?\b/i)
})
