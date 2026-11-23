const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/

export function verifyDeclaredSlateboxPackage({
  packageJson,
  lock,
  expectedVersion,
  expectedIntegrity,
}) {
  if (!EXACT_VERSION.test(expectedVersion || '')) {
    throw new Error(
      'SLATEBOX_LIBRARY_VERSION must be an exact package version such as 3.0.0'
    )
  }
  if (!SHA512_INTEGRITY.test(expectedIntegrity || '')) {
    throw new Error(
      'SLATEBOX_LIBRARY_INTEGRITY must be the expected sha512 npm integrity'
    )
  }

  const declaredVersion = packageJson.dependencies?.slateboxjs
  if (declaredVersion !== expectedVersion) {
    throw new Error(
      `App declares slateboxjs ${declaredVersion || 'missing'}; expected exact ${expectedVersion}`
    )
  }

  const lockedPackage = lock.packages?.['node_modules/slateboxjs']
  if (lockedPackage?.version !== expectedVersion) {
    throw new Error(
      `App lock contains SlateboxJS ${lockedPackage?.version || 'missing'}; expected ${expectedVersion}`
    )
  }
  const expectedResolution = `https://registry.npmjs.org/slateboxjs/-/slateboxjs-${expectedVersion}.tgz`
  if (lockedPackage.resolved !== expectedResolution) {
    throw new Error(
      `App lock resolves SlateboxJS from ${lockedPackage.resolved || 'missing'}; expected ${expectedResolution}`
    )
  }
  if (lockedPackage.integrity !== expectedIntegrity) {
    throw new Error(
      `App lock integrity is ${lockedPackage.integrity || 'missing'}; expected ${expectedIntegrity}`
    )
  }

  return expectedVersion
}
