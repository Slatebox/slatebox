// Under "SSO only" the server, not just the browser, refuses anyone who is not signed in: every
// method and every publication needs a session, except the few that signing in itself needs.
// (Guests cannot sign in under SSO only, so a session always belongs to a real account.)
// No Meteor import: unit-tested with node.
const GATED = Symbol.for('slatebox.ssoOnlyGate')

// Signing in, and loading the app's code, before there is a session.
const OPEN_METHODS = new Set(['login', 'logout', '__dynamicImport'])
// Meteor's own publications: the client version and the sign-in services (no user data).
const OPEN_PUBLICATIONS = new Set(['meteor_autoupdate_clientVersions', 'meteor.loginServiceConfiguration'])

/**
 * Wrap every handler in `handlers` (Meteor.server.method_handlers or publish_handlers) so that a
 * caller without a session is refused: a method throws refuse(name), a publication is ready
 * with nothing in it. Safe to call again: handlers already wrapped are left alone.
 */
export function gateHandlers(handlers, { kind, refuse, log = () => {} }) {
  const open = kind === 'publication' ? OPEN_PUBLICATIONS : OPEN_METHODS
  for (const name of Object.keys(handlers)) {
    const handler = handlers[name]
    if (typeof handler !== 'function' || handler[GATED] || open.has(name)) continue
    const gated = kind === 'publication'
      ? function signedInOnly(...args) {
        if (!this.userId) {
          log(name)
          this.ready()
          return undefined
        }
        return handler.apply(this, args)
      }
      : function signedInOnly(...args) {
        if (!this.userId) {
          log(name)
          throw refuse(name)
        }
        return handler.apply(this, args)
      }
    gated[GATED] = true
    handlers[name] = gated
  }
}
