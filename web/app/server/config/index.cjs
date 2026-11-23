// The configuration files shipped with the app, loaded the way the server loads JSON. A CommonJS
// module, so the same require serves the Meteor bundle and the node tests (an ES module would need
// an import attribute Meteor's compiler and Node treat differently).
exports.aiDefaults = require('./ai-defaults.json')
exports.aiProviders = require('./ai-providers.json')
