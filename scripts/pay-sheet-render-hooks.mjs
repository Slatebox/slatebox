// Lets a node:test render the pay sheet's real components (MIT, test support): JSX in web/app/imports
// is compiled with the app's own @babel/core and the small JSX transform below (React.createElement,
// the classic runtime the sheet's files use), Meteor's extensionless relative imports resolve as the
// app's bundler resolves them, MUI's CommonJS builds load with their default exports, and three
// modules are stand-ins the test drives: meteor/meteor, meteor/react-meteor-data and the payment SDK
// loader (@stripe/stripe-js/pure). The real @stripe/react-stripe-js provider and elements run.
// Used by scripts/pay-sheet-mount.test.mjs (registered from there, before anything is imported).
import { registerHooks, createRequire } from 'node:module'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const app = join(root, 'web/app')
const imports = pathToFileURL(join(app, 'imports')).href + '/'
const appParent = pathToFileURL(join(app, 'package.json')).href
const appRequire = createRequire(appParent)
const babel = appRequire('@babel/core')
const STUBS = { 'meteor/meteor': 'meteor', 'meteor/react-meteor-data': 'tracker', '@stripe/stripe-js/pure': 'stripe' }
const STUB_URL = 'pay-sheet-stub:'
const MUI_WRAP = '?mui-default'
const EXTS = ['', '.jsx', '.js', '.mjs', '/index.jsx', '/index.js']

// JSX text as React reads it: lines trimmed, blank lines dropped, the rest joined by one space.
function jsxText(value) {
  const lines = value.split(/\r\n|\n|\r/)
  let out = ''
  lines.forEach((line, i) => {
    let text = line.replace(/\t/g, ' ')
    if (i !== 0) text = text.replace(/^ +/, '')
    if (i !== lines.length - 1) text = text.replace(/ +$/, '')
    if (text) out += (out && i !== 0 ? ' ' : '') + text
  })
  return out
}

function jsxPlugin({ types: t }) {
  const react = name => t.memberExpression(t.identifier('React'), t.identifier(name))
  const tag = n => {
    if (t.isJSXIdentifier(n)) return /^[a-z]/.test(n.name) && !n.name.includes('.') ? t.stringLiteral(n.name) : t.identifier(n.name)
    if (t.isJSXMemberExpression(n)) return t.memberExpression(tag(n.object), t.identifier(n.property.name))
    return t.stringLiteral(`${n.namespace.name}:${n.name.name}`)
  }
  const key = n => {
    const name = t.isJSXNamespacedName(n) ? `${n.namespace.name}:${n.name.name}` : n.name
    return t.isValidIdentifier(name) ? t.identifier(name) : t.stringLiteral(name)
  }
  const value = v => {
    if (v == null) return t.booleanLiteral(true)
    if (t.isJSXExpressionContainer(v)) return v.expression
    return v
  }
  const children = list => list.flatMap(c => {
    if (t.isJSXText(c)) { const s = jsxText(c.value); return s ? [t.stringLiteral(s)] : [] }
    if (t.isJSXExpressionContainer(c)) return t.isJSXEmptyExpression(c.expression) ? [] : [c.expression]
    if (t.isJSXSpreadChild(c)) return [t.spreadElement(c.expression)]
    return [c]
  })
  const build = (type, attributes, kids) => {
    const props = attributes.length
      ? t.objectExpression(attributes.map(a => (t.isJSXSpreadAttribute(a) ? t.spreadElement(a.argument) : t.objectProperty(key(a.name), value(a.value)))))
      : t.nullLiteral()
    return t.callExpression(react('createElement'), [type, props, ...children(kids)])
  }
  return {
    visitor: {
      JSXElement: { exit(path) { path.replaceWith(build(tag(path.node.openingElement.name), path.node.openingElement.attributes, path.node.children)) } },
      JSXFragment: { exit(path) { path.replaceWith(build(react('Fragment'), [], path.node.children)) } },
    },
  }
}

const fileIn = (base, spec) => {
  const target = fileURLToPath(new URL(spec, base))
  for (const ext of EXTS) if (existsSync(target + ext) && statSync(target + ext).isFile()) return pathToFileURL(target + ext).href
  return null
}

function resolveHook(specifier, context, next) {
    if (STUBS[specifier]) return { url: STUB_URL + STUBS[specifier], shortCircuit: true }
    // 'app:<package>': the test's own imports, resolved as the sheet's files resolve them (one React,
    // one jotai, one router, one MUI theme context)
    if (specifier.startsWith('app:')) return resolveHook(specifier.slice(4), { ...context, parentURL: pathToFileURL(join(app, 'imports/index.js')).href }, next)
    const parent = context.parentURL || ''
    const fromApp = parent.startsWith(imports) || parent.startsWith(STUB_URL)
    if (fromApp && (specifier.startsWith('./') || specifier.startsWith('../'))) {
      const url = fileIn(parent, specifier)
      if (url) return { url, shortCircuit: true }
    }
    if (fromApp && /^@mui\/(material|icons-material)\//.test(specifier)) {
      // MUI's CommonJS build, as require() finds it (its ES build imports directories, which Node does not)
      return { url: pathToFileURL(appRequire.resolve(specifier)).href + MUI_WRAP, shortCircuit: true }
    }
    if (fromApp && !specifier.startsWith('.') && !specifier.startsWith('node:')) return next(specifier, { ...context, parentURL: appParent })
    return next(specifier, context)
}

registerHooks({
  resolve: resolveHook,
  load(url, context, next) {
    if (url.startsWith(STUB_URL)) {
      // each stand-in reads what the test put on globalThis.__paySheetTest
      const name = url.slice(STUB_URL.length)
      const source = {
        meteor: 'const h = () => globalThis.__paySheetTest; export const Meteor = { get settings() { return h().settings }, userId: () => h().userId(), user: () => h().user(), subscribe: n => h().subscribe(n), callAsync: (n, a) => h().call(n, a), isClient: true, isServer: false, startup: f => f() }',
        tracker: "import React from 'react'; export const useTracker = fn => { const [, bump] = React.useState(0); React.useEffect(() => globalThis.__paySheetTest.watch(() => bump(n => n + 1)), []); return fn() }",
        stripe: 'export const loadStripe = key => globalThis.__paySheetTest.loadStripe(key)',
      }[name]
      return { format: 'module', source, shortCircuit: true }
    }
    if (url.endsWith(MUI_WRAP)) {
      const real = JSON.stringify(url.slice(0, -MUI_WRAP.length))
      return { format: 'module', source: `export * from ${real}; import m from ${real}; export default (m && m.__esModule && 'default' in m ? m.default : m);`, shortCircuit: true }
    }
    if (url.startsWith(imports) && /\.(jsx|js)$/.test(url)) {
      const filename = fileURLToPath(url)
      const { code } = babel.transformSync(readFileSync(filename, 'utf8'), {
        filename, babelrc: false, configFile: false, sourceType: 'module', parserOpts: { plugins: ['jsx'] }, plugins: [jsxPlugin],
      })
      return { format: 'module', source: code, shortCircuit: true }
    }
    return next(url, context)
  },
})
