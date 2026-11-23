// The browser specs in scripts/ (*.spec.mjs: one-renderer, library-*, huddle-editors), run against an app
// that is already running (SLATEBOX_ORIGIN). Found by `npx playwright test` run from scripts/, or named:
//   npx playwright test -c scripts/playwright.config.mjs one-renderer.spec.mjs
//
// Only *.spec.mjs: the *.test.mjs files beside them are node:test files, which run when they are imported,
// so without this Playwright loads all of them and never gets to the specs.
//
// Pinned: @playwright/test 1.57.0 (root package.json, exact), whose Chromium is headless shell 1200 —
// install it once with `npx playwright install chromium` (huddle-editors also needs firefox). 1.57 loads
// these ES-module specs on Node 22 to 26; 1.51 hung loading them on Node 26. SLATEBOX_CHROMIUM still names
// another Chromium executable where a spec reads it.
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const major = Number(process.versions.node.split('.')[0])
if (major < 20) throw new Error(`The browser specs need Node 20 or later (this is ${process.version}).`)

const here = dirname(fileURLToPath(import.meta.url))

export default {
  testDir: here,
  testMatch: '*.spec.mjs',
  // Each spec makes its own guests and slates on one app: one at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // Results beside the root's (ignored by git), not in scripts/.
  outputDir: process.env.SLATEBOX_PW_OUT || `${here}/../test-results/specs`,
  reporter: process.env.CI ? 'line' : [['list']],
}
