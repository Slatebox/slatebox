// Themes are gone (owner, 2026-11-23: "yes to remove themes"). No theme picker, theme library, theme generator
// slates, theme approval, theme AI preference or theme methods remain, and nothing reads a slate's or a person's
// theme fields. Slates saved before keep options.themeId, options.basedOnThemeId, options.syncWithTheme,
// options.eligibleForThemeCompilation or isThemeGenerator until those are cleared from the databases; such a slate
// opens, draws, copies and saves like any other. Restyling is through chat and presentation styles.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { copyDocument } from '../web/app/server/actions/slate-copy.mjs'
import { slatePreview } from '../web/app/imports/api/common/slate-preview.mjs'
import { isUserSelectableTemplate, userSelectableTemplateSelector } from '../web/app/imports/api/common/template-policy.mjs'

const app = fileURLToPath(new URL('../web/app/', import.meta.url))
const read = (path) => readFileSync(join(app, path), 'utf8')
const walk = (dir) => readdirSync(join(app, dir)).flatMap((name) => {
  const path = join(dir, name)
  if (name === 'generated' || name === 'node_modules') return []
  if (statSync(join(app, path)).isDirectory()) return walk(path)
  return /\.(m?js|jsx|ts|tsx|json)$/.test(name) ? [path] : []
})
const code = [...walk('imports'), ...walk('server'), ...walk('client')]

// A slate saved while themes existed: a theme generator, based on a theme, synced to it.
const oldSlate = () => ({
  _id: 'old1', shareId: 'old1', userId: 'ana', isThemeGenerator: true,
  options: {
    id: 'old1', name: 'Roadmap', themeId: 'retired-theme', basedOnThemeId: 'retired-theme', syncWithTheme: true,
    eligibleForThemeCompilation: true, containerStyle: { backgroundColor: '#ffffff' }, viewPort: { left: 9800, top: 9800, zoom: { r: 1 } },
  },
  nodes: [
    { options: { id: 'parent', text: 'Goals', xPos: 10000, yPos: 10000, width: 160, height: 60, vectorPath: 'roundedrectangle', backgroundColor: '#1e5aa8', foregroundColor: '#ffffff' }, relationships: { associations: [] } },
    { options: { id: 'child_1', text: 'Ship it', xPos: 10240, yPos: 10000, width: 160, height: 60, vectorPath: 'roundedrectangle', backgroundColor: '#f0f0f0', foregroundColor: '#000000' }, relationships: { associations: [] } },
  ],
})

test('the theme surfaces and their files are gone', () => {
  for (const file of ['server/methods/themes.js', 'server/bootstrap/themeGenerator.json', 'server/bootstrap/defaultThemes.json',
    'imports/ui/components/slate/SlateThemes.jsx', 'imports/ui/pages/ShowThemes.jsx', 'imports/ui/components/ThemeHarness.jsx']) {
    assert.equal(existsSync(join(app, file)), false, file)
  }
  const constants = read('imports/api/common/constants.js')
  assert.doesNotMatch(constants, /defaultThemeId|themes\.|\bthemes: \{/)
  assert.match(constants, /buildColorPalette: 'colors\.buildColorPalette'/, 'generated colours stay, under their own name')
  assert.doesNotMatch(read('imports/api/common/models.js'), /Themes|'themes'|privateThemes/)
  assert.doesNotMatch(read('imports/ui/SBRoutes.jsx'), /\/themes|themeId|ShowThemes/)
  assert.doesNotMatch(read('imports/ui/Main.jsx'), /Theme library|getThemes/)
  assert.doesNotMatch(read('server/main.js'), /methods\/themes/)
})

test('no code reads or writes a theme field, calls a theme method or offers a theme', () => {
  const themeCode = /themeId|ThemeId|basedOnTheme|syncWithTheme|eligibleForThemeCompilation|isThemeGenerator|applyTheme|onSlateThemeChanged|onThemeRequired|buildNodeStyleFromTheme|methods\.themes|'themes\.|themeInUse|themeApproval|createWithTheme|SlateWithTheme|themeTemplateId|parseSlateIntoTheme|getPresetColors|\bThemes\b|aiProp="theme|type: 'theme'|Create with theme|Theme approval|Request Theme/
  const hits = code.filter((file) => themeCode.test(read(file))).map((file) => file + ': ' + read(file).match(themeCode)[0])
  assert.deepEqual(hits, [])
})

test('delete takes any of your slates: there is no "theme in use" rule', () => {
  const action = read('server/actions/slate-delete.mjs')
  assert.doesNotMatch(action, /theme|409|conflict/i)
  const remove = read('server/methods/slates.js')
  const owned = remove.slice(remove.indexOf('export async function deleteOwnedSlate'), remove.indexOf('method[CONSTANTS.methods.slates.remove]'))
  assert.doesNotMatch(owned, /theme/i)
  assert.match(owned, /return \{ deleted: true \}/)
})

test('a slate that still carries theme fields is a template, a copy and a preview like any other', () => {
  const slate = oldSlate()
  // An approved template is listed whatever theme fields it carries; the selector names none.
  assert.deepEqual(Object.keys(userSelectableTemplateSelector()).sort(), ['options.isTemplate', 'options.templateApproved'])
  assert.equal(isUserSelectableTemplate({ ...slate, options: { ...slate.options, isTemplate: true, templateApproved: true } }), true)
  const copy = copyDocument(slate, { id: 'new1', shareId: 'new1', user: { _id: 'ben' }, now: new Date(0) })
  assert.equal(copy.options.name, 'Roadmap')
  assert.equal(copy.nodes.length, 2)
  const preview = slatePreview(slate)
  assert.deepEqual(preview.nodes.map((n) => n.options.id), ['parent', 'child_1'])
})

test('a slate that still carries theme fields loads, draws and saves on the canvas without errors', async () => {
  // jsdom is the web app's dependency: read it from there, wherever the root's packages are.
  const webRequire = createRequire(new URL('../web/app/package.json', import.meta.url))
  const { JSDOM } = webRequire('jsdom')
  // The engine the web app builds with (its file: dependency), as the browser loads it: its ES module.
  let engineDir = dirname(webRequire.resolve('slateboxjs'))
  while (!existsSync(join(engineDir, 'package.json'))) engineDir = dirname(engineDir)
  const engineModule = join(engineDir, JSON.parse(readFileSync(join(engineDir, 'package.json'), 'utf8')).module)
  const dom = new JSDOM('<!doctype html><div id="slateCanvas" style="width:800px;height:600px"></div>', { pretendToBeVisual: true })
  const saved = {}
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'SVGElement', 'getComputedStyle',
    'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'DOMParser', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent']) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true })
  }
  saved.ResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  dom.window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 40 })
  dom.window.SVGElement.prototype.getComputedTextLength = () => 50
  // jsdom draws no text: words measure 7px a character, as a stand-in for the browser's canvas.
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (text) => ({ width: String(text).length * 7 }) })
  const errors = []
  const quiet = { log: console.log, warn: console.warn, error: console.error }
  console.log = () => {}
  console.warn = () => {}
  console.error = (...args) => errors.push(args.map(String).join(' '))
  const onError = (error) => errors.push(String(error?.stack ?? error))
  process.on('unhandledRejection', onError)
  try {
    const { Slatebox } = await import(pathToFileURL(engineModule).href)
    const slate = await new Slatebox.slate({ container: 'slateCanvas', id: 'old1', viewPort: { allowDrag: true } }, {}).init()
    await slate.loadJSON(JSON.stringify(oldSlate()))
    assert.deepEqual(slate.nodes.allNodes.map((n) => n.options.id).sort(), ['child_1', 'parent'])
    assert.equal(dom.window.document.querySelectorAll('#slateCanvas [data-node-id]').length, 2, 'both notes are drawn')
    assert.equal(slate.options.containerStyle.backgroundColor, '#ffffff')
    const exported = JSON.parse(slate.exportJSON())
    assert.equal(exported.nodes.length, 2, 'the slate saves its notes')
    await new Promise((resolve) => setTimeout(resolve, 50))
    slate.destroy?.()
  } finally {
    process.off('unhandledRejection', onError)
    Object.assign(console, quiet)
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
  assert.deepEqual(errors, [])
})
