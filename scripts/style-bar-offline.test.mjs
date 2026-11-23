import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

// Self-host stays offline-clean and the picture-search key stays on the server.
const app = new URL('../web/app/', import.meta.url)
const read = (path) => readFileSync(new URL(path, app), 'utf8')

test('the page asks Google Fonts for nothing: no stylesheet, no preconnect', () => {
  const html = read('client/main.html')
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/)
})

test('no settings file gives the browser a Google key; picture search reads its key from server settings only', () => {
  // The repository tracks only the example; local settings files (git-ignored) are checked when present.
  const files = ['settings.example.json', ...['settings.dev.json', 'settings.test.json'].filter((file) => existsSync(new URL(file, app)))]
  for (const file of files) {
    const settings = JSON.parse(read(file))
    const pub = Object.keys(settings.public ?? {})
    for (const key of ['googleImageSearchAPIKey', 'googleImageSearchEngineKey', 'googleFontAPIKey']) {
      assert.ok(!pub.includes(key), `${file}: public.${key} reaches every browser`)
    }
    assert.ok(settings.googleImageSearch?.apiKey !== undefined && settings.googleImageSearch?.engineKey !== undefined,
      `${file}: googleImageSearch { apiKey, engineKey } belongs in the server settings`)
  }
  const images = read('server/methods/images.js')
  assert.doesNotMatch(images, /settings\.public\??\.googleImageSearch/)
  const compose = readFileSync(new URL('../docker-compose.yml', app), 'utf8')
  const publicBlock = compose.slice(compose.indexOf('"public"'))
  assert.doesNotMatch(publicBlock, /googleImageSearch|googleFontAPIKey/)
})
