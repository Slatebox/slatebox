// Point the app's manifest and lock at the engine tarball built in this image,
// then prove that they do. The app repository itself depends on a sibling
// SlateboxJS checkout, which does not exist inside a build.
//
//   pin-engine.mjs prepare TARBALL    before `npm install --package-lock-only`
//   pin-engine.mjs verify REVISION    after it
import { readFileSync, writeFileSync } from 'node:fs'

const [mode, value] = process.argv.slice(2)
const read = file => JSON.parse(readFileSync(file, 'utf8'))
const write = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n')

if (mode === 'prepare') {
  const manifest = read('package.json')
  manifest.dependencies.slateboxjs = `file:./${value}`
  write('package.json', manifest)
  // Drop the link to the sibling checkout so npm resolves the tarball afresh.
  const lock = read('package-lock.json')
  for (const key of Object.keys(lock.packages)) {
    if (key === 'node_modules/slateboxjs' || key.startsWith('..')) delete lock.packages[key]
  }
  write('package-lock.json', lock)
} else if (mode === 'verify') {
  const dependency = read('package.json').dependencies.slateboxjs
  const locked = read('package-lock.json').packages['node_modules/slateboxjs']
  if (!dependency.startsWith('file:./slateboxjs-') || locked?.link || !locked?.version?.endsWith(`+selfhost.${value}`)) {
    console.error(`The app lock does not point at the engine built from ${value}:`, dependency, locked?.version)
    process.exit(1)
  }
  console.log(`App pinned to slateboxjs ${locked.version}`)
} else {
  console.error('Usage: pin-engine.mjs prepare TARBALL | verify REVISION')
  process.exit(2)
}
