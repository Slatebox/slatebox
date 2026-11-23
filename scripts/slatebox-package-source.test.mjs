import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyDeclaredSlateboxPackage } from './slatebox-package-source.mjs'

const version = '3.0.0'
const integrity = `sha512-${'a'.repeat(86)}==`

function candidate({
  declaredVersion = version,
  lockedVersion = version,
  resolved = `https://registry.npmjs.org/slateboxjs/-/slateboxjs-${version}.tgz`,
  lockedIntegrity = integrity,
} = {}) {
  return {
    packageJson: { dependencies: { slateboxjs: declaredVersion } },
    lock: {
      packages: {
        'node_modules/slateboxjs': {
          version: lockedVersion,
          resolved,
          integrity: lockedIntegrity,
        },
      },
    },
    expectedVersion: version,
    expectedIntegrity: integrity,
  }
}

test('accepts an exact registry package with the expected integrity', () => {
  assert.equal(verifyDeclaredSlateboxPackage(candidate()), version)
})

test('rejects a local tarball declaration', () => {
  assert.throws(
    () =>
      verifyDeclaredSlateboxPackage(
        candidate({
          declaredVersion: 'file:../../../slateboxjs-v2/slateboxjs-3.0.0.tgz',
        })
      ),
    /expected exact 3\.0\.0/
  )
})

test('rejects a non-registry lock resolution', () => {
  assert.throws(
    () =>
      verifyDeclaredSlateboxPackage(
        candidate({ resolved: 'file:../../../slateboxjs-v2/slateboxjs-3.0.0.tgz' })
      ),
    /expected https:\/\/registry\.npmjs\.org\//
  )
})

test('rejects an integrity mismatch', () => {
  assert.throws(
    () =>
      verifyDeclaredSlateboxPackage(
        candidate({ lockedIntegrity: `sha512-${'b'.repeat(86)}==` })
      ),
    /expected sha512-/
  )
})

test('requires an exact expected version and sha512 integrity', () => {
  assert.throws(
    () =>
      verifyDeclaredSlateboxPackage({
        ...candidate(),
        expectedVersion: '^3.0.0',
      }),
    /must be an exact package version/
  )
  assert.throws(
    () =>
      verifyDeclaredSlateboxPackage({
        ...candidate(),
        expectedIntegrity: 'sha1-not-accepted',
      }),
    /must be the expected sha512 npm integrity/
  )
})
