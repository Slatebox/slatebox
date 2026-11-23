import { Meteor } from 'meteor/meteor'
import { guardHandlers, skipsArgumentGuard } from './common/document-keys.mjs'

// No method or publication receives a Mongo operator or a field name minimongo refuses
// (server/common/document-keys.mjs). This covers every handler, the app's and the packages',
// so a lookup like Slates.findOneAsync({ shareId: opts.shareId }) can never become a search.
const options = {
  skip: skipsArgumentGuard,
  refuse: () => new Meteor.Error('invalid-argument', 'That request has a field name the server does not accept.'),
  log: (name, path) => console.warn(`[argument-guard] refused ${name}: ${path}`),
}

function guardAll() {
  guardHandlers(Meteor.server.method_handlers, options)
  guardHandlers(Meteor.server.publish_handlers, options)
}

Meteor.startup(() => {
  guardAll()
  // A method or publication registered later is guarded as it is registered.
  const methods = Meteor.methods
  Meteor.methods = function guardedMethods(...args) {
    const result = methods.apply(this, args)
    guardAll()
    return result
  }
  const publish = Meteor.publish
  Meteor.publish = function guardedPublish(...args) {
    const result = publish.apply(this, args)
    guardAll()
    return result
  }
})
