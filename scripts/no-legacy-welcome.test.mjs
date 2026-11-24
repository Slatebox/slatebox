// Greenfield, no legacy UI: the old first-visit "Welcome To Slatebox!" dialog (pulsing help icons in the
// left menu, a 60-second video) opened over /signup for a new account. Its code is gone, not hidden: the
// component, its server methods, its storage atom and its seed, and a database that still holds its text
// drops it at start.
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../web/app/', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')
function sources(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name)
    if (name === 'node_modules' || name.startsWith('.')) continue
    if (statSync(join(root, path)).isDirectory()) sources(path, out)
    else if (/\.(?:jsx?|mjs|tsx?)$/.test(name)) out.push(path)
  }
  return out
}

test('the legacy welcome dialog is removed, not hidden: no component, no methods, no atom, no seed', () => {
  assert.equal(existsSync(join(root, 'imports/ui/common/InitialHelp.jsx')), false)
  assert.doesNotMatch(read('imports/ui/components/MainPaper.jsx'), /InitialHelp/)
  const constants = read('imports/api/common/constants.js')
  assert.doesNotMatch(constants, /HelpStatus|welcomeMessage:/)
  assert.doesNotMatch(read('imports/ui/jotai/atoms.js'), /pulseCurrentHelpStatus/)
  for (const path of [...sources('imports'), ...sources('server'), ...sources('client')]) {
    const text = read(path)
    assert.doesNotMatch(text, /getHelpStatus|setHelpStatus|pulseCurrentHelpStatus|pulseCurrentPath|InitialHelp/, path)
    assert.doesNotMatch(text, /pulsing help icons|60-second video|Welcome To Slatebox!/, path)
  }
})

test('a database that still holds the dialog\'s text drops it at start', () => {
  assert.match(read('server/bootstrap/all.js'), /await SystemSettings\.removeAsync\(\{ _id: 'welcomeMessage' \}\)/)
})
