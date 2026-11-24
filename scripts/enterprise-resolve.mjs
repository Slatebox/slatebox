// Lets the enterprise/ tests load enterprise code the way the Meteor app does (MIT, test support).
// In the app, enterprise/ sits at web/app/enterprise (scripts/enterprise-stage.mjs), so its files
// import the app's own modules by Meteor's root paths ('/server/...', '/imports/...') and its
// packages from web/app/node_modules. Under plain Node (node --import ./scripts/enterprise-resolve.mjs)
// this maps both the same way.
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = join(root, 'web/app')
const enterprise = pathToFileURL(join(root, 'enterprise')).href + '/'
const appParent = pathToFileURL(join(app, 'package.json')).href

registerHooks({
  resolve(specifier, context, next) {
    if (/^\/(server|imports|client)\//.test(specifier)) return next(pathToFileURL(join(app, specifier)).href, context)
    // The engine is the app's dependency: a test that imports it resolves it as the app does.
    if (specifier === 'slateboxjs' || specifier.startsWith('slateboxjs/')) return next(specifier, { ...context, parentURL: appParent })
    const fromEnterprise = context.parentURL?.startsWith(enterprise)
    if (fromEnterprise && /^(@[a-z0-9-]+\/)?[a-z0-9][\w.-]*(\/.*)?$/i.test(specifier) && !specifier.startsWith('node:') && !specifier.startsWith('meteor/'))
      return next(specifier, { ...context, parentURL: appParent })
    try {
      return next(specifier, context)
    } catch (error) {
      // A linked engine build (node_modules/slateboxjs -> a checkout) imports its peers (react)
      // from the app, as the app's bundler resolves them.
      if (error?.code === 'ERR_MODULE_NOT_FOUND' && !specifier.startsWith('.') && !specifier.startsWith('/')) return next(specifier, { ...context, parentURL: appParent })
      throw error
    }
  },
})
