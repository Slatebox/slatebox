#!/usr/bin/env node
import { main } from '../src/cli.mjs'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 13)) {
  process.stderr.write(`slatebox needs Node.js 22.13 or newer (this is ${process.versions.node}).\n`)
  process.exit(4)
}
process.exitCode = await main(process.argv.slice(2))
