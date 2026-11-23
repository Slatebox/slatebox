// Present on a slate opens the presenter: the slate's presentation (its viewpoints, from the
// slate's analysis) played full screen over the slate's own SVG. One presenter serves Present,
// presenting to everyone, following, and published links and embeds. These checks pin where
// Present goes, and that the players it replaced are gone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const ui = (path) => new URL('../web/app/imports/ui/' + path, import.meta.url)
const source = (path) => readFileSync(ui(path), 'utf8')

test('Present opens the presenter on every slate drawn on the canvas, a workshop slate included', async () => {
  const { presentTarget } = await import(ui('components/presentations/presentTarget.mjs'))
  assert.equal(presentTarget({ options: { name: 'Plain' } }), 'presenter')
  assert.equal(presentTarget({ creativeKind: 'workshop' }), 'presenter')
  // A board drawn by its own renderer (not on the canvas) keeps its own read-only view.
  assert.equal(presentTarget({ creativeKind: 'listening' }), 'overlay')
  assert.equal(presentTarget(null), null)
})

test('the header routes Present through presentTarget and holds only Present and Present to everyone', () => {
  const toolbar = source('components/CanvasToolbar.jsx')
  assert.match(toolbar, /presentTarget\(/)
  assert.match(toolbar, /setPresentOpen\(true\)/)
  assert.doesNotMatch(toolbar, /BoardPlayback|WorkshopProjection|WorkshopPublication|PresentPublishedSlate|Edit or publish presentation|onAuthor/)
})

test('the players Present replaced are gone', () => {
  for (const path of ['components/BoardPlayback.jsx', 'components/presentations/WorkshopReadout.jsx',
    'components/presentations/WorkshopPresentation.jsx', 'components/presentations/WorkshopProjection.jsx',
    'components/presentations/WorkshopPublication.jsx']) assert.equal(existsSync(ui(path)), false, path)
  for (const path of ['pages/SharedWorkshopRoom.jsx', 'components/PresentPublishedSlate.jsx',
    'components/presentations/useLivePresentation.jsx']) assert.doesNotMatch(source(path), /WorkshopReadout|BoardPlayback/, path)
})

test('the presenter never speaks of stations or tokens', () => {
  for (const path of ['components/PresentSlate.jsx', 'components/PresentSlateDialogue.jsx', 'components/PresentPublishedSlate.jsx',
    'components/presentations/BasePresent.jsx', 'components/presentations/PresenterFrame.jsx',
    'components/presentations/FollowPresentation.jsx', 'components/presentations/useLivePresentation.jsx']) {
    assert.doesNotMatch(source(path), /\bstations?\b|\btokens?\b|Next station/i, path)
  }
})

test('the presenter goes full screen where it may, leaves on Escape, and moves by keys and swipes', () => {
  const frame = source('components/presentations/PresenterFrame.jsx')
  assert.match(frame, /requestFullscreen/)
  assert.match(frame, /fullscreenchange/)
  assert.match(frame, /exitFullscreen/)
  assert.match(frame, /fullScreen/)
  const player = source('components/presentations/BasePresent.jsx')
  for (const key of ['ArrowLeft', 'ArrowRight', 'Space']) assert.match(player, new RegExp("'" + key + "'"))
  assert.match(player, /onTouchStart/)
  assert.match(player, /onTouchEnd/)
})
