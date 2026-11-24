#!/usr/bin/env node
// `npm create slatebox` runs this: the same as `npx slatebox install`.
let main
try {
  ({ main } = await import('slatebox/src/cli.mjs'))
} catch {
  ({ main } = await import(new URL('../../slatebox/src/cli.mjs', import.meta.url)))
}
process.exitCode = await main(['install', ...process.argv.slice(2)])
