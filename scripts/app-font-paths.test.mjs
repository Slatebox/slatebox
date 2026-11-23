// staging-2 (2026-11-20): on /canvas/* and /new/* pages the browser asked for
// /canvas/fonts/manrope/… and got the app's HTML. The @font-face rules lived in a stylesheet the
// client imports from JavaScript. Meteor's CSS minifier (minifier-css rewriteRules) writes every
// url() relative to "/", as if the CSS were served from the site root ("/fonts/x" becomes
// "fonts/x"), but an imported stylesheet is put into the page as a <style> element, so its
// relative urls resolve against the page's own path.
//
// The fonts are now a static stylesheet in public/ (never minified or moved), linked from the page
// head, with urls relative to that stylesheet. And no stylesheet the client imports holds a
// root-absolute url(): the build would make it page-relative.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { test } from 'node:test'

const app = new URL('../web/app/', import.meta.url)
const read = (path) => readFileSync(new URL(path, app), 'utf8')
const urls = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/url\(\s*(['"]?)(.+?)\1\s*\)/g)].map((m) => m[2])

test('the page head links the fonts stylesheet from the site root', () => {
  const head = read('client/main.html')
  assert.match(head, /<link[^>]+rel="stylesheet"[^>]+href="\/fonts\/fonts\.css"/)
})

test('the fonts stylesheet is static, and every font it names is served beside it', () => {
  const css = read('public/fonts/fonts.css')
  const found = urls(css)
  for (const family of ['Manrope', 'Lora', 'Courier Prime', 'Caveat']) assert.match(css, new RegExp(`font-family: '${family}'`))
  assert.ok(found.length >= 10)
  for (const url of found) {
    assert.ok(!url.startsWith('/') && !/^[a-z]+:/i.test(url), `${url} is relative to the stylesheet`)
    // Served at /fonts/fonts.css, so the url resolves under /fonts/.
    const served = new URL(url, 'https://app.example/fonts/fonts.css').pathname
    assert.ok(existsSync(new URL('public' + served, app)), `${served} is in public/`)
  }
})

test('no stylesheet the client imports holds a root-absolute url (the build makes it page-relative)', () => {
  const sheets = []
  const walk = (dir) => {
    for (const name of readdirSync(new URL(dir, app))) {
      const path = dir + name
      if (statSync(new URL(path, app)).isDirectory()) walk(path + '/')
      else if (name.endsWith('.css')) sheets.push(path)
    }
  }
  walk('imports/')
  walk('client/')
  assert.ok(sheets.length > 0)
  for (const path of sheets) {
    for (const url of urls(read(path))) {
      assert.ok(!url.startsWith('/') || url.startsWith('//'), `${path}: url(${url}) would resolve against the page path once built`)
    }
  }
})
