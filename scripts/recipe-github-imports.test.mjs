// What the GitHub recipes may import (design B.7): a recipe never reaches the registry, Mongo or
// the network itself. Files under enterprise/recipes/github-* and the shared enterprise/recipes/_github-code
// import only enterprise/common/**, the Mermaid core (web/app/imports/api/common/mermaid/**),
// slateboxjs/operations and slateboxjs/workshops, enterprise/recipes/_github-code/** and their own folder.
// The vendor session a recipe sees has read calls only (no write, merge or delete).
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : path.endsWith('.mjs') ? [path] : []
})

test('GitHub recipe files import only what a recipe may', () => {
  const recipes = join(root, 'enterprise/recipes')
  const files = readdirSync(recipes).filter((d) => d.startsWith('github-') || d === '_github-code').flatMap((d) => walk(join(recipes, d)))
    // fixtures are sample repositories as text (their import lines are data, never run)
    .filter((file) => !file.includes('/fixtures/'))
  assert.ok(files.length >= 30)
  const allowed = [join(root, 'enterprise/common'), join(root, 'web/app/imports/api/common/mermaid'), join(recipes, '_github-code')]
  for (const file of files) {
    const own = join(recipes, relative(recipes, file).split('/')[0])
    for (const m of readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
      const spec = m[1] || m[2]
      if (spec === 'slateboxjs/operations' || spec === 'slateboxjs/workshops') continue
      assert.ok(spec.startsWith('.'), `${relative(root, file)} imports ${spec}`)
      const target = resolve(dirname(file), spec)
      assert.ok([own, ...allowed].some((dir) => target === dir || target.startsWith(`${dir}/`)), `${relative(root, file)} imports ${spec}`)
    }
    const text = readFileSync(file, 'utf8')
    assert.ok(!/\bfetch\(|\bprocess\.env\b|\bMeteor\.|\brequire\(['"]/.test(text), `${relative(root, file)} reaches outside the recipe context`)
  }
})
