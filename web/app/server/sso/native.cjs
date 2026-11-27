// openid-client and jose are ESM-only packages whose subpath exports (jose/errors, ...) the Meteor
// module loader does not resolve. Load them through Node's own resolver, from the server bundle's
// node_modules under Meteor and from the app's node_modules under node --test (as sdk-chat.cjs does).
const { createRequire } = require('node:module')
const { join } = require('node:path')

/* eslint-disable camelcase, no-undef */
const load = createRequire(typeof __meteor_bootstrap__ === 'undefined'
  ? __filename : join(__meteor_bootstrap__.serverDir, 'npm', 'package.json'))
/* eslint-enable camelcase, no-undef */

module.exports = { openidClient: load('openid-client'), jose: load('jose') }
