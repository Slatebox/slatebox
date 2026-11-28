// The slate menu's Rename, Slate style, Settings, History, Export, Embed and Delete follow canManageSlate
// (Main.jsx passes it to CanvasToolbar as `manage`). On a workshop slate (every board a /new/<kind> route
// makes: /new/map, /new/pilot-budget, /new/launch-plan, /new/hiring-plan, /new/pipeline, /new/budget,
// /new/nest, /new/grid, /new/workshop and a /new#brief map) the page reads its read-only access at render
// from the board's publication (workshop.editable), which is false on the render that first draws the
// board: its subscription only starts then. The effect that writes canManageSlate ran on [phoneView,
// boardLoaded] alone, so it kept that first "view only" answer after the board arrived editable, and the
// owner's menu had no Rename and no Slate style (seen on test 2026-11-27 for a new account's /new/map).
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const canvas = readFileSync(new URL('../web/app/imports/ui/pages/Canvas.jsx', import.meta.url), 'utf8')

// The effect whose body sets canManageSlate from the render-time permissions, and its dependency list.
function manageEffect() {
  const at = canvas.indexOf('setCanManageSlate(Boolean(Meteor.userId() && !viewOnly')
  assert.ok(at > 0, 'the render-time canManageSlate write is found')
  const start = canvas.lastIndexOf('React.useEffect(', at)
  const deps = canvas.slice(at).match(/\}, \[([^\]]*)\]\)/)
  assert.ok(start > 0 && deps, 'it is written in an effect with a dependency list')
  return { body: canvas.slice(start, at + deps.index), deps: deps[1].split(',').map(d => d.trim()) }
}

test('the slate menu follows a workshop board turning editable after the board is drawn', () => {
  const { deps } = manageEffect()
  // The workshop's read-only state reaches the effect only through viewOnly, which is derived each render.
  assert.ok(deps.includes('viewOnly'), 'canManageSlate is written again when viewOnly changes: ' + deps.join(', '))
  assert.ok(deps.includes('boardLoaded'))
  assert.ok(deps.includes('phoneView'))
})

test('viewOnly is derived after the workshop sets its read-only access, on every render', () => {
  const override = canvas.indexOf('if (workshopSlate) accessLevel.current.isReadOnly = Boolean(grantedReadOnly.current || !workshop.editable)')
  const viewOnly = canvas.indexOf('const viewOnly = phoneView || Boolean(accessLevel.current.isReadOnly)')
  const effect = canvas.indexOf('setCanManageSlate(Boolean(Meteor.userId() && !viewOnly')
  assert.ok(override > 0 && viewOnly > override && effect > viewOnly)
})
