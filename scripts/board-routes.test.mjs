import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { BOARD_SAMPLES } from '../web/app/imports/api/common/board-routes.mjs'

// Every /new/<kind> board route loads what its board needs: the kind's rules and, for a board with a
// rulebook (a hiring plan), the rulebook's module. 2026-11-23: /new/hiring-plan crashed with "This board
// has rules, and they have not loaded" because the route loaded the rules but not the rulebook.
// Each route is checked in a fresh process, as a fresh page is: a module one route loaded must not
// hide one another route forgot.

const routes = fileURLToPath(new URL('../web/app/imports/api/common/board-routes.mjs', import.meta.url))
const open = kind => spawnSync(process.execPath, ['--input-type=module', '-e', `
  const { BOARD_SAMPLES, loadBoardRoute } = await import(${JSON.stringify(routes)})
  const loaded = await loadBoardRoute(${JSON.stringify(kind)})
  const { encodeWorkshopFragment, validateWorkshop } = await import('slateboxjs/workshops/model')
  const board = loaded[BOARD_SAMPLES[${JSON.stringify(kind)}]]()
  validateWorkshop(board)
  encodeWorkshopFragment(board)
  console.log('opened ' + board.kind)
`], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' })

test('every business board kind has a /new/<kind> route', async () => {
  const { businessBoardKinds } = await import('slateboxjs/workshops/model')
  assert.deepEqual(Object.keys(BOARD_SAMPLES).sort(), [...businessBoardKinds].sort())
})

for (const kind of Object.keys(BOARD_SAMPLES)) {
  test(`/new/${kind} loads its rules and rulebook, and its sample board reads`, () => {
    const run = open(kind)
    assert.equal(run.status, 0, run.stderr.split('\n').find(line => /Error/.test(line)) ?? run.stderr)
    assert.match(run.stdout, new RegExp('opened ' + kind))
  })
}
