// What the image contains, checked without starting Slatebox.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { IMAGE, docker, ok } from './lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const appTree = join(here, '../../web/app')
// Meteor serves web/app/public from here; the app's fonts are in its fonts/ folder.
const APP_FONTS = '/opt/slatebox/app/bundle/programs/web.browser/app/fonts'
const APP_FONT_FAMILIES = readdirSync(join(appTree, 'public/fonts'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)

// Read-only look inside the image, as root so that no directory is skipped.
// No Slatebox process is started and the container has no network.
const inside = (script, options) =>
  docker(['run', '--rm', '-i', '--network', 'none', '--user', '0', '--entrypoint', 'sh', IMAGE, '-c', script], options)

test('the image identifies what it was built from', async () => {
  const config = JSON.parse(await ok(['image', 'inspect', IMAGE]))[0]
  const labels = config.Config.Labels
  for (const label of ['org.opencontainers.image.revision', 'com.slatebox.engine.revision', 'com.slatebox.relay.revision']) {
    assert.match(labels[label] || '', /^[0-9a-f]{12}(-dirty)?$/, `${label} names a source revision`)
  }
  // The version label is Slatebox's own, not the base image's.
  assert.equal(labels['org.opencontainers.image.version'], labels['org.opencontainers.image.revision'])
  const identity = JSON.parse((await inside('cat /opt/slatebox/identity.json')).stdout)
  assert.equal(identity.app, labels['org.opencontainers.image.revision'])
  assert.equal(identity.engine, labels['com.slatebox.engine.revision'])
  assert.equal(identity.relay, labels['com.slatebox.relay.revision'])
  // The engine inside is the one built for this image, not a registry release.
  const engine = JSON.parse((await inside('cat /opt/slatebox/app/bundle/programs/server/npm/node_modules/slateboxjs/package.json')).stdout)
  assert.ok(engine.version.endsWith(`+selfhost.${identity.engine}`), `engine version ${engine.version} carries its revision`)
  assert.deepEqual(Object.keys(config.Config.Volumes), ['/data'])
  assert.ok(config.Config.Healthcheck?.Test?.length, 'a health check is defined')
})

test('every process runs as an unprivileged user', async () => {
  const config = JSON.parse(await ok(['image', 'inspect', IMAGE]))[0]
  assert.equal(config.Config.User, 'slatebox')
  const id = (await docker(['run', '--rm', '--network', 'none', '--entrypoint', 'sh', IMAGE, '-c', 'id -u; id -g; stat -c %U:%a /data'])).stdout.trim().split('\n')
  assert.deepEqual(id, ['10001', '10001', 'slatebox:700'])
})

test('license notices say which parts are MIT and which are not', async () => {
  const notice = (await inside('cat /opt/slatebox/licenses/NOTICE.md')).stdout
  assert.match(notice, /not under a single license/)
  assert.match(notice, /MongoDB Community Server.*Server Side Public License/)
  const files = (await inside('cd /opt/slatebox/licenses && find . -type f | sort')).stdout.trim().split('\n')
  for (const file of [
    './NOTICE.md', './slatebox-app-LICENSE.md', './slatebox-app-LICENSING.md', './slateboxjs-LICENSE.txt', './slatebox-relay-LICENSE.txt',
    './third-party/mongodb-server-SSPL.txt', './third-party/mongodb-database-tools-LICENSE.md',
    './third-party/caddy-LICENSE.txt', './third-party/node-LICENSE.txt', './third-party/meteor-LICENSE.txt',
    './third-party/tini-LICENSE.txt', './third-party/fonts.md', './third-party/fonts-OFL-1.1.txt', './third-party/fonts-Apache-2.0.txt',
    './third-party/mongodb-server-third-party.md',
    './third-party/mongodb-database-tools-THIRD-PARTY-NOTICES.txt', './third-party/cloudflared-LICENSE.txt',
  ]) assert.ok(files.includes(file), `${file} is in the image`)
  // Every file NOTICE.md names under third-party/ is in the image.
  for (const named of new Set(notice.match(/third-party\/[\w.-]+/g))) {
    assert.ok(files.includes(`./${named}`), `NOTICE.md names ${named}, which is in the image`)
  }
  assert.match((await inside('head -c 400 /opt/slatebox/licenses/third-party/mongodb-server-third-party.md')).stdout, /MongoDB Third Party Dependencies/)
  // Every bundled Google Fonts family is listed with its copyright and one of the two license texts.
  const fonts = (await inside('cat /opt/slatebox/licenses/third-party/fonts.md')).stdout
  const families = (await inside("fc-list : family | tr ',' '\\n' | sort -u")).stdout.trim().split('\n')
  for (const family of ['Roboto', 'Caveat', 'EB Garamond', 'Permanent Marker', 'IBM Plex Mono']) {
    assert.ok(families.includes(family), `${family} is installed`)
    assert.match(fonts, new RegExp(`^\\| ${family} \\| Copyright .+ \\| (SIL Open Font License 1\\.1|Apache License 2\\.0) \\|`, 'm'))
  }
  assert.match((await inside('head -c 200 /opt/slatebox/licenses/third-party/fonts-OFL-1.1.txt')).stdout, /SIL OPEN FONT LICENSE Version 1\.1/)
  // The interface and note fonts browsers load from the instance are the app's own
  // (web/app/public/fonts): NOTICE.md names them, and each family's folder carries its OFL.txt.
  assert.match(notice, /Interface and note fonts .*SIL Open Font License 1\.1/)
  for (const family of APP_FONT_FAMILIES) {
    const ofl = (await inside(`cat ${APP_FONTS}/${family}/OFL.txt`)).stdout
    assert.match(ofl, /Copyright/, `${family}/OFL.txt names the copyright`)
    assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/i, `${family}/OFL.txt is the OFL 1.1`)
  }
  // The app's license is the repository's LICENSE as committed (the MIT License alone), and its
  // LICENSING.md beside it says the enterprise/ directory is under the Slatebox Enterprise License.
  const appLicense = (await inside('cat /opt/slatebox/licenses/slatebox-app-LICENSE.md')).stdout
  assert.equal(appLicense, readFileSync(join(here, '../../LICENSE'), 'utf8'), 'the image carries the app\'s LICENSE unchanged')
  assert.match(appLicense, /^MIT License\n/)
  const appLicensing = (await inside('cat /opt/slatebox/licenses/slatebox-app-LICENSING.md')).stdout
  assert.equal(appLicensing, readFileSync(join(here, '../../LICENSING.md'), 'utf8'), 'the image carries the app\'s LICENSING.md unchanged')
  assert.match(appLicensing, /`enterprise\/`[\s\S]*Slatebox Enterprise License/)
  const heads = (await inside('cd /opt/slatebox/licenses && head -c 200 slateboxjs-LICENSE.txt third-party/mongodb-server-SSPL.txt')).stdout
  assert.match(heads, /MIT License[\s\S]*Server Side Public License/)
})

// The app serves its own interface and note fonts at /fonts/ (web/app/public/fonts, linked from
// client/main.html); the image neither fetches them nor serves them from a path of its own.
test('the interface fonts are the app\'s own, served at /fonts/, not from Google', async () => {
  const css = (await inside(`cat ${APP_FONTS}/fonts.css`)).stdout
  assert.equal(css, readFileSync(join(appTree, 'public/fonts/fonts.css'), 'utf8'), 'the image serves the app\'s fonts.css')
  for (const family of ['Manrope', 'Lora', 'Courier Prime', 'Caveat']) assert.match(css, new RegExp(`font-family: '${family}'`))
  assert.doesNotMatch(css, /https?:\/\//, 'the stylesheet names no outside address')
  const sources = [...css.matchAll(/url\('([^')]+)'\)/g)].map(match => match[1])
  assert.ok(sources.length >= 10, `${sources.length} font files are named`)
  const files = new Set((await inside(`cd ${APP_FONTS} && find . -type f`)).stdout.trim().split('\n').map(file => file.replace(/^\.\//, '')))
  for (const file of sources) assert.ok(files.has(file), `${file} is in the image`)
  // The old setup (fonts fetched at build time, served at /_fonts/) is gone.
  assert.equal((await inside('test -e /opt/slatebox/share/fonts && echo present || echo absent')).stdout.trim(), 'absent')
})

test('no settings file, environment file or private key is in the image', async () => {
  const found = (await inside(
    `find / -xdev \\( -path /proc -o -path /sys -o -path /dev \\) -prune -o -type f \\( ` +
    `-name 'settings*.json' -o -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.p12' -o -name '*.pfx' -o -name 'id_rsa*' -o -name 'id_ed25519*' -o -name '*.key' \\) -print`)).stdout
    .trim().split('\n').filter(Boolean)
  assert.deepEqual(found, [], 'files that could hold settings or keys')
})

// The scanner runs inside the image, as root and without a network. What it
// is asked to find arrives on standard input, so no secret is ever part of a
// command line, and it reports only where something was found.
const scan = async request => {
  const result = await docker(['run', '--rm', '-i', '--network', 'none', '--user', '0', '--entrypoint', 'node', IMAGE,
    '--input-type=module', '-e', readFileSync(join(here, 'in-image-scan.mjs'), 'utf8')], { input: JSON.stringify(request) })
  assert.equal(result.code, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('no value from the app tree\'s settings files appears anywhere in the image', async () => {
  // Collect every distinctive value from the hosted service's settings files
  // and search every file of the image for each of them. Values are never
  // printed: a failure names the setting and the file it was found in.
  const names = new Map() // value -> names of the settings that hold it
  let addresses = 0
  const isPlainAddress = value => {
    // A name made of lowercase words, or an address without credentials or a
    // query string, is not a secret, and ordinary ones (http://localhost:3000)
    // appear in any software.
    if (/^[a-z]+(-[a-z]+)*$/.test(value)) return true
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/[\w./-]*)?$/i.test(value)) return true // a bare host name, with or without a path
    try {
      const url = new URL(value)
      return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && !url.username && !url.password && !url.search
    } catch { return false }
  }
  const keep = (name, value) => {
    if (value.length < 16 || /\s/.test(value)) return
    if (isPlainAddress(value)) { addresses += 1; return }
    names.set(value, (names.get(value) || new Set()).add(name))
  }
  const collect = (node, name) => {
    if (typeof node === 'string') keep(name, node)
    else if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) collect(value, name ? `${name}.${key}` : key)
  }
  const sources = [appTree, ...(process.env.SLATEBOX_SETTINGS_DIRS || '').split(':').filter(Boolean)]
  let files = 0
  for (const dir of sources) {
    for (const file of readdirSync(dir).filter(entry => /^settings.*\.json$/.test(entry))) {
      const text = readFileSync(join(dir, file), 'utf8')
      try {
        collect(JSON.parse(text), '')
      } catch {
        // Some are lists of NAME=value lines despite their name.
        for (const line of text.split(/\r?\n/)) {
          const [, name, raw] = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/) || []
          if (!raw) continue
          const value = raw.replace(/^(['"])(.*)\1$/, '$2')
          try { collect(JSON.parse(value), name) } catch { keep(name, value) }
        }
      }
      files += 1
    }
  }
  const values = [...names.keys()]
  assert.ok(files >= 1 && values.length >= 5, `read ${files} settings files with ${values.length} distinctive values`)
  const report = await scan({ values })
  console.log(`searched ${report.files} files (${(report.bytes / 1e9).toFixed(2)} GB) for ${values.length} values from ${files} settings files; ${addresses} plain names and addresses were left out`)
  assert.ok(report.files > 50_000, 'the whole image was searched')
  const found = report.hits.flatMap(hit => hit.found.map(index => `${[...names.get(values[index])].join(', ')} in ${hit.path}`))
  assert.deepEqual(found, [], 'settings whose value is in the image')
})

test('nothing Slatebox adds to the image looks like a credential', async () => {
  // The app's own server code, the bundles it serves to browsers, its assets,
  // the relay's own code, the start-up scripts and the system configuration.
  // Third-party packages are covered by the exact search above; their
  // documentation is full of sample keys.
  const report = await scan({ roots: [
    '/opt/slatebox/app/bundle/programs/server/app', '/opt/slatebox/app/bundle/programs/server/assets',
    '/opt/slatebox/app/bundle/programs/web.browser', '/opt/slatebox/app/bundle/programs/web.browser.legacy',
    '/opt/slatebox/app/bundle/programs/server/npm/node_modules/slateboxjs',
    '/opt/slatebox/relay/bin', '/opt/slatebox/relay/src', '/opt/slatebox/bin', '/opt/slatebox/lib', '/opt/slatebox/share',
    '/etc', '/data', '/run',
  ] })
  console.log(`searched ${report.files} files (${(report.bytes / 1e6).toFixed(0)} MB) for credential-shaped strings`)
  assert.ok(report.files > 300, 'the app, the relay and the scripts were searched')
  assert.deepEqual(report.hits, [], 'files with credential-shaped strings')
})

test('only the programs Slatebox needs were taken from the MongoDB image', async () => {
  const listing = (await inside('ls /usr/local/bin')).stdout.trim().split('\n').sort()
  assert.deepEqual(listing, ['caddy', 'mongod', 'mongodump', 'mongorestore', 'node', 'slatebox'])
  const versions = (await inside('node --version; mongod --version | head -1; caddy version; tini --version')).stdout
  assert.match(versions, /^v24\.15\.0\n.*v8\.0\.\d+\nv2\.\d+\.\d+ .*\ntini version/)
})

test('cloudflared is the pinned release, executable, and named in the identity', async () => {
  const pinned = /^ARG CLOUDFLARED_VERSION=(\S+)$/m.exec(readFileSync(join(here, '../Dockerfile'), 'utf8'))[1]
  const version = (await inside('/opt/cloudflared/bin/cloudflared --version')).stdout
  assert.match(version, new RegExp(`cloudflared version ${pinned.replace(/\./g, '\\.')} `))
  assert.equal(JSON.parse((await inside('cat /opt/slatebox/identity.json')).stdout).cloudflared, pinned)
  const arch = (await inside('uname -m')).stdout.trim() === 'aarch64' ? 'arm64' : 'amd64'
  const listed = readFileSync(join(here, '../build/cloudflared.sha256'), 'utf8').split('\n').find(line => line.endsWith(`cloudflared-linux-${arch}`)).split(/\s+/)[0]
  assert.equal((await inside('sha256sum /opt/cloudflared/bin/cloudflared')).stdout.split(/\s+/)[0], listed)
})
