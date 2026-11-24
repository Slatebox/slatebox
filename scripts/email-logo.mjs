// Draws the email logo, web/app/public/brand/email-logo.png: the five-tile mark
// (public/brand/slatebox.svg) and the "Slatebox" wordmark in Manrope 800, as the app's brand bar
// shows them, on the email header's green. Email clients block SVG and web fonts, so the email
// shows this PNG (drawn at 2x, shown at 160x40). The green is part of the picture, so a client's
// dark mode cannot leave the light wordmark on a light background.
//
//   node scripts/email-logo.mjs
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../web/app/public/', import.meta.url))
const mark = await readFile(`${root}brand/slatebox.svg`, 'utf8')
const font = (await readFile(`${root}fonts/manrope/manrope-latin-wght-normal.woff2`)).toString('base64')

const html = `<!doctype html><html><head><style>
@font-face { font-family: Manrope; font-weight: 200 800; src: url(data:font/woff2;base64,${font}) format('woff2'); }
html, body { margin: 0; background: #223e32; }
.logo { width: 160px; height: 40px; display: flex; align-items: center; gap: 9px; padding-left: 2px; box-sizing: border-box;
  font: 800 25px/1 Manrope; letter-spacing: -.055em; color: #fffef8; }
.logo svg { width: 31px; height: 31px; flex: none; }
</style></head><body><div class="logo">${mark}<span>Slatebox</span></div></body></html>`

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 160, height: 40 } })
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  await page.locator('.logo').screenshot({ path: `${root}brand/email-logo.png` })
} finally {
  await browser.close()
}
console.log('wrote web/app/public/brand/email-logo.png')
