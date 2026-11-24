// Renders every email Slatebox sends (web/app/server/email/templates.mjs SAMPLES) with sample data,
// to <name>.html, <name>.txt and index.html in a folder, for a look in a browser. A dev tool: it runs
// from a checkout, sends nothing and is not part of the app or its routes.
//
//   node scripts/email-preview.mjs [folder]   (default: ./email-previews)
//   node scripts/email-preview.mjs --fixtures (rewrites the snapshots the tests compare with,
//                                              scripts/fixtures/email/; only for a deliberate change)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SAMPLES } from '../web/app/server/email/templates.mjs'

export const FIXTURES = fileURLToPath(new URL('./fixtures/email/', import.meta.url))

export function renderAll() {
  return Object.entries(SAMPLES).map(([name, render]) => ({ name, ...render() }))
}

export function writePreviews(folder, { index = true } = {}) {
  mkdirSync(folder, { recursive: true })
  const emails = renderAll()
  for (const { name, html, text, subject, preheader } of emails) {
    writeFileSync(join(folder, `${name}.html`), html)
    writeFileSync(join(folder, `${name}.txt`), `Subject: ${subject}\nPreheader: ${preheader}\n\n${text}`)
  }
  if (index) {
    const rows = emails.map(({ name, subject }) => `<li><a href="${name}.html">${name}</a> (<a href="${name}.txt">text</a>): ${subject.replace(/</g, '&lt;')}</li>`).join('\n')
    writeFileSync(join(folder, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Slatebox emails</title><h1>Slatebox emails</h1><ul>\n${rows}\n</ul>\n`)
  }
  return emails.map(({ name }) => name)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2]
  const folder = arg === '--fixtures' ? FIXTURES : resolve(arg || 'email-previews')
  const names = writePreviews(folder, { index: arg !== '--fixtures' })
  console.log(`${names.length} emails → ${folder}`)
}
