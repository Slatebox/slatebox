// What a team admin does in Team settings > Sign-in & security: the team's single sign-on
// connections, the domains they prove, and the team's policy. The registry actions
// (server/actions/team-sso.mjs) call these; the stores are injected (server/sso/index.js), so the
// rules run under node alone (scripts/sso-connections.test.mjs).
//
// - Team owners and admins only (team-guard's rule), in the app (person principals).
// - A secret is write-only: sealed with the server's key (metering/vault.mjs, the same sealing as
//   Integration apps), bound to the team and the connection, and never returned.
// - A verified domain belongs to one team: the claim (ssoDomainClaims, _id = the domain) is taken
//   when it is verified and released when it is removed.
// - "Require single sign-on" turns on only for a connection that routes a verified domain, and only
//   by an admin who signed in with that connection or is a break-glass account (the owner, or one
//   of up to two named admins), so nobody locks the team out with a broken connection. Turning it
//   on ends the other sessions of the members it covers.
import {
  DEFAULT_POLICY, MAX_CONNECTIONS, MAX_DOMAINS, SsoConfigError, connectionFields, describeConnection, normalizeDomain,
  policyFields, routableDomains, secretFingerprint,
} from './connections.mjs'
import { afterCheck, lookupChallenge, newDomainEntry } from './domains.mjs'
import { requireSsoCovers } from './policy.mjs'
import { isBreakGlass } from './accounts.mjs'
import { seal } from '../metering/vault.mjs'

export class TeamSsoError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}
const refuse = (message, code = 'invalid_input', status = 400) => { throw new TeamSsoError(code, message, status) }

/** A stored connection as the fields saveConnection takes (no secret, no certificate: those stay as saved). */
export function asInput(connection) {
  const values = {
    label: connection.label,
    enabled: connection.enabled,
    issuer: connection.oidc?.issuer,
    tenantId: connection.oidc?.tenantId,
    clientId: connection.oidc?.clientId,
    idpEntityId: connection.saml?.idpEntityId,
    ssoUrl: connection.saml?.ssoUrl,
    emailAttribute: connection.saml?.emailAttribute,
  }
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
}

export const secretOwner = (connection) => ({ ownerType: 'team', ownerId: connection.orgId, provider: `sso:${connection._id}` })

export function createTeamSso({ store, env }) {
  const now = () => env.now?.() ?? Date.now()
  // The activity log (server/audit/recorder.mjs audit.record): names and ids only, never a secret.
  // The caller's actor and door come from the running registry call.
  const record = async (caller, entry) => {
    try { await env.record?.({ orgId: caller.orgId, ...entry }) } catch { /* the log never fails a change */ }
  }
  const connectionTarget = (connection) => ({ type: 'connection', id: connection._id, name: connection.label })

  function mayChange(caller) {
    if (!caller?.orgId) refuse('Join or create a team first.', 'forbidden', 403)
    if (!caller.isAdmin) refuse('Only team owners and admins can change sign-in settings.', 'forbidden', 403)
  }
  async function gateOn(caller) {
    if (!(await env.gate(caller.orgId))) refuse('Single sign-on settings are not available for this team.', 'forbidden', 403)
  }
  async function ownConnection(caller, id) {
    const connection = typeof id === 'string' ? await store.connections.byId(id) : null
    if (!connection || connection.orgId !== caller.orgId) refuse('That connection is not in your team.', 'not_found', 404)
    if (connection.managed) refuse('This connection is set by the server administrator and cannot be changed here.', 'forbidden', 403)
    return connection
  }
  const asConfigError = (fn) => async (...args) => {
    try { return await fn(...args) } catch (error) {
      if (error instanceof SsoConfigError) throw new TeamSsoError('invalid_input', error.message)
      throw error
    }
  }

  // The members a connection's "Require single sign-on" covers (not the caller, not already signed in
  // through it): every way in other than single sign-on ends, their sessions and their API tokens and
  // sign-in links among them, so none outlives the rule (server/sso/accounts.mjs revokeCredentials).
  async function endCoveredSessions(caller, connection) {
    const domains = routableDomains(connection, now())
    const members = await store.people.teamMembers(connection.orgId)
    const covered = members.filter((m) => m._id !== caller._id && m.services?.sso?.connectionId !== connection._id &&
      requireSsoCovers(m, connection, { domains, breakGlass: isBreakGlass(m, connection) }))
    if (covered.length) await store.people.endSessions(covered.map((m) => m._id))
  }

  async function view(caller) {
    const connections = await store.connections.forTeam(caller.orgId)
    const admins = await store.people.teamAdmins(caller.orgId)
    return {
      available: await env.gate(caller.orgId),
      cloud: env.cloud,
      canChange: Boolean(caller.isAdmin),
      serverAdmin: !env.cloud && Boolean(await env.serverAdmin?.(caller._id)),
      secretsAvailable: Boolean(env.master),
      you: { id: caller._id, ssoConnectionId: (await store.people.person(caller._id))?.services?.sso?.connectionId ?? null },
      admins: admins.map((a) => ({ id: a._id, name: a.name, email: a.email, owner: a.isOrgOwner === true })),
      connections: connections.map((c) => describeConnection(c, { origin: env.origin, now: now() })),
    }
  }

  return {
    get: async (caller) => {
      if (!caller?.orgId) refuse('Join or create a team first.', 'forbidden', 403)
      return view(caller)
    },

    saveConnection: asConfigError(async (caller, input) => {
      mayChange(caller)
      await gateOn(caller)
      const existing = input.id ? await ownConnection(caller, input.id) : null
      // A change names only what changes (turning a connection off sends { id, enabled }): the rest stays.
      if (existing) input = { ...asInput(existing), ...input }
      if (!existing && (await store.connections.forTeam(caller.orgId)).filter((c) => !c.managed).length >= MAX_CONNECTIONS) {
        refuse(`A team can have up to ${MAX_CONNECTIONS} connections.`)
      }
      const { fields, secret, secretRequired } = connectionFields(input, { existing })
      const id = existing?._id ?? env.newId()
      const at = new Date(now())
      const doc = { ...fields }
      if (fields.protocol === 'oidc') {
        if (secretRequired && !secret) refuse('Enter the client secret the identity provider gave Slatebox.')
        if (secret && !env.master) refuse('Client secrets need SLATEBOX_KEY_ENCRYPTION_KEY on this server.')
        const draft = { _id: id, orgId: caller.orgId }
        doc.oidc = {
          ...fields.oidc,
          secret: secret ? seal({ master: env.master, owner: secretOwner(draft), plaintext: secret }) : existing.oidc.secret,
          secretFingerprint: secret ? secretFingerprint(secret) : existing.oidc.secretFingerprint,
        }
        // The provider must answer its discovery document for this issuer before it is saved.
        if (env.discover) await env.discover({ ...existing, ...doc, _id: id, orgId: caller.orgId })
      }
      if (existing) {
        await store.connections.set(id, { ...doc, updatedAt: at, updatedBy: caller._id }, fields.protocol === 'oidc' ? ['saml'] : ['oidc'])
      } else {
        await store.connections.insert({
          _id: id, orgId: caller.orgId, ...doc, domains: [], policy: { ...DEFAULT_POLICY }, createdAt: at, createdBy: caller._id, updatedAt: at, updatedBy: caller._id,
        })
      }
      await record(caller, { action: 'sso.connectionSaved', target: { type: 'connection', id, name: fields.label }, details: { protocol: fields.protocol, preset: fields.preset, mode: fields.enabled ? 'on' : 'off' } })
      return { connectionId: id, ...(await view(caller)) }
    }),

    removeConnection: async (caller, { connectionId }) => {
      mayChange(caller)
      const connection = await ownConnection(caller, connectionId)
      for (const entry of connection.domains || []) await store.claims.release(entry.domain, connection._id)
      await store.connections.remove(connection._id)
      // The accounts it signed in are no longer tied to it: they sign in another way (a password
      // reset or a sign-in link to their address), and their sessions from it end.
      await store.people.unlinkConnection(connection._id)
      await record(caller, { action: 'sso.connectionRemoved', target: connectionTarget(connection), details: { protocol: connection.protocol, preset: connection.preset } })
      return view(caller)
    },

    addDomain: asConfigError(async (caller, { connectionId, domain: raw }) => {
      mayChange(caller)
      await gateOn(caller)
      const connection = await ownConnection(caller, connectionId)
      const domain = normalizeDomain(raw)
      if ((connection.domains || []).some((entry) => entry.domain === domain)) refuse(`${domain} is already on this connection.`)
      if ((connection.domains || []).length >= MAX_DOMAINS) refuse(`A connection can have up to ${MAX_DOMAINS} domains.`)
      const owner = await store.claims.owner(domain)
      if (owner && owner.orgId !== caller.orgId) refuse(`${domain} is already verified by another Slatebox team.`, 'conflict', 409)
      if (owner) refuse(`${domain} is already verified on another of your team's connections. Remove it there first.`, 'conflict', 409)
      await store.connections.pushDomain(connection._id, newDomainEntry(domain, now()))
      await record(caller, { action: 'sso.domainAdded', target: connectionTarget(connection), details: { domain } })
      return view(caller)
    }),

    checkDomain: async (caller, { connectionId, domain, withoutDns = false }) => {
      mayChange(caller)
      await gateOn(caller)
      const connection = await ownConnection(caller, connectionId)
      const entry = (connection.domains || []).find((d) => d.domain === domain)
      if (!entry) refuse('That domain is not on this connection.', 'not_found', 404)
      let status
      if (withoutDns) {
        if (env.cloud || !(await env.serverAdmin?.(caller._id))) refuse('Only the server administrator of a self-hosted Slatebox can verify a domain without DNS.', 'forbidden', 403)
        status = 'found'
      } else {
        ({ status } = await lookupChallenge({ domain, token: entry.token, resolveTxt: env.resolveTxt }))
      }
      let next = afterCheck(entry, status, now())
      if (withoutDns) next = { ...next, verifiedBy: 'server-admin' }
      if (status === 'found' && !entry.verifiedAt) {
        const claimed = await store.claims.claim(domain, { orgId: caller.orgId, connectionId: connection._id, at: new Date(now()) })
        if (!claimed) refuse(`${domain} is already verified by another Slatebox team.`, 'conflict', 409)
      }
      await store.connections.setDomain(connection._id, domain, next)
      if (status === 'found' && !entry.verifiedAt) {
        await record(caller, { action: 'sso.domainVerified', target: connectionTarget(connection), details: { domain, method: withoutDns ? 'server-admin' : 'dns' } })
        // Members a required single sign-on now covers sign in again through it.
        if (connection.enabled && connection.policy?.requireSso) await endCoveredSessions(caller, { ...connection, domains: (connection.domains || []).map((d) => (d.domain === domain ? next : d)) })
      }
      const result = await view(caller)
      return { status, ...result }
    },

    removeDomain: async (caller, { connectionId, domain }) => {
      mayChange(caller)
      const connection = await ownConnection(caller, connectionId)
      if (!(connection.domains || []).some((d) => d.domain === domain)) refuse('That domain is not on this connection.', 'not_found', 404)
      await store.connections.pullDomain(connection._id, domain)
      await store.claims.release(domain, connection._id)
      await record(caller, { action: 'sso.domainRemoved', target: connectionTarget(connection), details: { domain } })
      // Without a domain left to route, "Require single sign-on" has nothing to cover.
      const after = await store.connections.byId(connection._id)
      if (after?.policy?.requireSso && routableDomains(after, now()).length === 0) {
        await store.connections.set(connection._id, { 'policy.requireSso': false })
      }
      return view(caller)
    },

    setPolicy: asConfigError(async (caller, { connectionId, ...input }) => {
      mayChange(caller)
      await gateOn(caller)
      const connection = await ownConnection(caller, connectionId)
      const admins = (await store.people.teamAdmins(caller.orgId))
      const owner = admins.find((a) => a.isOrgOwner === true)
      const policy = policyFields({ ...DEFAULT_POLICY, ...connection.policy, ...input }, { admins: admins.map((a) => a._id), ownerId: owner?._id })
      const turningOn = policy.requireSso && !connection.policy?.requireSso
      const after = { ...connection, policy }
      if (policy.requireSso) {
        const domains = routableDomains(after, now())
        if (!after.enabled || domains.length === 0) refuse('Verify a domain on this connection, and turn the connection on, before requiring single sign-on.')
        if (turningOn) {
          const me = await store.people.person(caller._id)
          const meBreakGlass = isBreakGlass(me, after)
          if (!meBreakGlass && me?.services?.sso?.connectionId !== connection._id) {
            refuse('Sign in with this connection once first (or be the owner or a named break-glass admin), so you know it works before it is required.')
          }
          // Members it now covers sign in again with single sign-on: their other sessions end.
          await endCoveredSessions(caller, after)
        }
      }
      await store.connections.set(connection._id, { policy, updatedAt: new Date(now()), updatedBy: caller._id })
      await record(caller, {
        action: 'sso.policyChanged',
        target: connectionTarget(connection),
        details: { mode: policy.requireSso ? 'required' : 'optional', role: policy.joinRule, count: policy.breakGlass.length },
      })
      return view(caller)
    }),
  }
}
