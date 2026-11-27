/* eslint-disable no-underscore-dangle, no-await-in-loop, no-restricted-syntax, no-continue */
// SCIM 2.0 (RFC 7643, RFC 7644), the parts Slatebox serves at /scim/v2. Pure: no Meteor, no
// database; unit-tested in scripts/scim.test.mjs with the request shapes Okta and Microsoft Entra
// ID send.
//
//   parseFilter       the filter subset identity providers use to look people and groups up:
//                     userName, externalId, id, displayName, emails.value and
//                     emails[type eq "work"].value, each with eq, joined by and
//   normalizePatch    one shape for a PatchOp from either provider (Entra's capitalised ops,
//                     values without a path, "True"/"False" strings, members[value eq "x"])
//   renderUser, renderGroup, listResponse, scimError, and the discovery documents

export const SCIM_CONTENT_TYPE = 'application/scim+json'
export const SCHEMA = Object.freeze({
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  enterpriseUser: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
  list: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  patch: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  error: 'urn:ietf:params:scim:api:messages:2.0:Error',
  serviceProviderConfig: 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
  resourceType: 'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
  schema: 'urn:ietf:params:scim:schemas:core:2.0:Schema',
})
export const MAX_RESULTS = 200
export const DEFAULT_COUNT = 100

/** A refusal in SCIM's error shape. status is sent as a string, as RFC 7644 §3.12 says. */
export class ScimError extends Error {
  constructor(status, detail, scimType) {
    super(detail)
    this.name = 'ScimError'
    this.status = status
    if (scimType) this.scimType = scimType
  }
}

export const scimError = (status, detail, scimType) => ({
  schemas: [SCHEMA.error],
  status: String(status),
  ...(scimType && { scimType }),
  detail,
})

// ---- filters ---------------------------------------------------------------------------------

// The attributes a filter may name, by resource, and the key the service matches them on.
const FILTER_ATTRIBUTES = Object.freeze({
  user: {
    username: 'userName',
    externalid: 'externalId',
    id: 'id',
    'emails.value': 'email',
    'emails[type eq "work"].value': 'email',
    displayname: 'displayName',
  },
  group: {
    displayname: 'displayName',
    externalid: 'externalId',
    id: 'id',
  },
})

const TERM = /^\s*([A-Za-z][\w.:]*(?:\[\s*type\s+eq\s+"work"\s*\])?(?:\.value)?)\s+(eq)\s+("(?:[^"\\]|\\.)*"|true|false)\s*/i

/**
 * The filter as { key: value } (every term joined by and, each an eq), or {} for none.
 * Throws ScimError 400 invalidFilter for anything else: or, not, other operators, other attributes.
 */
export function parseFilter(text, resource = 'user') {
  if (text === undefined || text === null || text === '') return {}
  if (typeof text !== 'string' || text.length > 1000) throw new ScimError(400, 'The filter is not supported.', 'invalidFilter')
  const known = FILTER_ATTRIBUTES[resource]
  const query = {}
  let rest = text
  for (let terms = 0; ; terms += 1) {
    const match = TERM.exec(rest)
    if (!match || terms >= 10) throw new ScimError(400, 'Use a filter of the form attribute eq "value", joined by and.', 'invalidFilter')
    const attribute = match[1].replace(/\[\s*type\s+eq\s+"work"\s*\]/i, '[type eq "work"]')
    const name = known[attribute.toLowerCase().replace(/^urn:ietf:params:scim:schemas:core:2\.0:(user|group):/, '')]
    if (!name) throw new ScimError(400, `Filtering on ${match[1]} is not supported.`, 'invalidFilter')
    const raw = match[3]
    const value = raw.startsWith('"') ? JSON.parse(raw) : raw.toLowerCase() === 'true'
    if (typeof value !== 'string') throw new ScimError(400, `${match[1]} takes a quoted value.`, 'invalidFilter')
    if (Object.hasOwn(query, name) && query[name] !== value) return { never: true }
    query[name] = value
    rest = rest.slice(match[0].length)
    if (!rest.trim()) return query
    const and = /^and\s+/i.exec(rest)
    if (!and) throw new ScimError(400, 'Terms of a filter are joined by and.', 'invalidFilter')
    rest = rest.slice(and[0].length)
  }
}

/** 1-based startIndex and count, clamped (RFC 7644 §3.4.2.4): count at most MAX_RESULTS. */
export function readPage(query = {}) {
  const number = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback
    const parsed = Number.parseInt(String(value), 10)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  const startIndex = Math.max(1, number(query.startIndex, 1))
  const count = Math.min(MAX_RESULTS, Math.max(0, number(query.count, DEFAULT_COUNT)))
  return { startIndex, count, skip: startIndex - 1 }
}

// ---- patches ---------------------------------------------------------------------------------

const truthy = (value) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string' && /^(true|false)$/i.test(value)) return value.toLowerCase() === 'true'
  return value
}

// Paths as Slatebox reads them, lower-cased, with the core schema's urn taken off.
const canonicalPath = (path) => String(path)
  .trim()
  .replace(/^urn:ietf:params:scim:schemas:core:2\.0:(user|group):/i, '')
  .replace(/\s+/g, ' ')
  .toLowerCase()

const MEMBER_FILTER = /^members\[\s*value\s+eq\s+"((?:[^"\\]|\\.)*)"\s*\]$/i

/**
 * A PatchOp as a list of { op: 'add'|'replace'|'remove', path, value }, path one of the
 * lower-cased attribute paths ('active', 'username', 'name.givenname', 'emails', 'members', …).
 * An op without a path becomes one op per attribute of its value; members[value eq "x"] becomes
 * a remove of members with that value. Throws ScimError 400 for a body that is not a PatchOp.
 */
export function normalizePatch(body) {
  if (!body || typeof body !== 'object') throw new ScimError(400, 'Send a PatchOp.', 'invalidSyntax')
  const operations = body.Operations ?? body.operations
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > 1000)
    throw new ScimError(400, 'A PatchOp needs Operations.', 'invalidSyntax')
  const out = []
  for (const operation of operations) {
    const op = String(operation?.op ?? '').toLowerCase()
    if (!['add', 'replace', 'remove'].includes(op)) throw new ScimError(400, `Unknown patch op ${operation?.op}.`, 'invalidSyntax')
    const { path, value } = operation
    if (path === undefined || path === null || path === '') {
      if (op === 'remove') throw new ScimError(400, 'A remove needs a path.', 'noTarget')
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ScimError(400, 'An op without a path takes an object value.', 'invalidValue')
      for (const [key, inner] of Object.entries(value)) {
        // {"name": {"givenName": "Ada"}} and {"name.givenName": "Ada"} are the same change.
        if (canonicalPath(key) === 'name' && inner && typeof inner === 'object' && !Array.isArray(inner)) {
          for (const [part, v] of Object.entries(inner)) out.push({ op, path: `name.${canonicalPath(part)}`, value: truthy(v) })
        } else {
          out.push({ op, path: canonicalPath(key), value: truthy(inner) })
        }
      }
      continue
    }
    if (typeof path !== 'string') throw new ScimError(400, 'A path is text.', 'invalidPath')
    const member = MEMBER_FILTER.exec(path.trim())
    if (member) {
      if (op !== 'remove') throw new ScimError(400, 'A filtered members path is for remove only.', 'invalidPath')
      out.push({ op: 'remove', path: 'members', value: [{ value: JSON.parse(`"${member[1]}"`) }] })
      continue
    }
    const canonical = canonicalPath(path)
    // Entra writes emails[type eq "work"].value; the one address Slatebox keeps is it.
    const email = /^emails\[\s*type\s+eq\s+"work"\s*\]\.value$/.test(canonical) || canonical === 'emails.value'
    out.push({ op, path: email ? 'emails.value' : canonical, value: truthy(value) })
  }
  return out
}

// ---- resources -------------------------------------------------------------------------------

const iso = (value) => (value ? new Date(value).toISOString() : undefined)

/**
 * A Slatebox account as a SCIM User. user: the account document; base: the /scim/v2 address.
 * userName is what the provider sent (kept in scim.userName), else the account's address.
 */
export function renderUser(user, { base, groups = [] } = {}) {
  const email = user.emails?.[0]?.address || ''
  const givenName = user.profile?.firstName || ''
  const familyName = user.profile?.lastName || ''
  const formatted = [givenName, familyName].filter(Boolean).join(' ')
  const resource = {
    schemas: [SCHEMA.user],
    id: user._id,
    ...(user.scim?.externalId && { externalId: user.scim.externalId }),
    userName: user.scim?.userName || email,
    name: { givenName, familyName, ...(formatted && { formatted }) },
    displayName: user.scim?.displayName || formatted || email,
    emails: email ? [{ value: email, type: 'work', primary: true }] : [],
    active: user.isDisabled !== true,
    groups: groups.map((group) => ({ value: group._id, display: group.displayName, $ref: `${base}/Groups/${group._id}` })),
    meta: {
      resourceType: 'User',
      created: iso(user.createdAt) || iso(Date.now()),
      lastModified: iso(user.scim?.updatedAt) || iso(user.createdAt) || iso(Date.now()),
      location: `${base}/Users/${user._id}`,
    },
  }
  return resource
}

/** A SCIM group as a SCIM Group. members: [{ _id, label }] for the people in it. */
export function renderGroup(group, { base, members = [], excludeMembers = false } = {}) {
  return {
    schemas: [SCHEMA.group],
    id: group._id,
    ...(group.externalId && { externalId: group.externalId }),
    displayName: group.displayName,
    ...(!excludeMembers && {
      members: members.map((member) => ({ value: member._id, display: member.label, $ref: `${base}/Users/${member._id}` })),
    }),
    meta: {
      resourceType: 'Group',
      created: iso(group.createdAt),
      lastModified: iso(group.updatedAt) || iso(group.createdAt),
      location: `${base}/Groups/${group._id}`,
    },
  }
}

export const listResponse = (resources, { total, startIndex }) => ({
  schemas: [SCHEMA.list],
  totalResults: total,
  startIndex,
  itemsPerPage: resources.length,
  Resources: resources,
})

/**
 * What a POST or PUT body says about a person: { userName, externalId, email, givenName,
 * familyName, displayName, active }. The address is the primary one, else the work one, else
 * the first, else userName when it is an address.
 */
export function readUserBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ScimError(400, 'Send a User.', 'invalidSyntax')
  const text = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const userName = text(body.userName, 256)
  if (!userName) throw new ScimError(400, 'userName is required.', 'invalidValue')
  const emails = Array.isArray(body.emails) ? body.emails.filter((entry) => entry && typeof entry.value === 'string') : []
  const chosen = emails.find((entry) => truthy(entry.primary) === true) || emails.find((entry) => entry.type === 'work') || emails[0]
  const email = (text(chosen?.value, 254) || (userName.includes('@') ? userName : '')).toLowerCase()
  const active = body.active === undefined ? true : truthy(body.active)
  if (typeof active !== 'boolean') throw new ScimError(400, 'active is true or false.', 'invalidValue')
  return {
    userName,
    externalId: text(body.externalId, 256),
    email,
    givenName: text(body.name?.givenName, 100),
    familyName: text(body.name?.familyName, 100),
    displayName: text(body.displayName, 200),
    active,
  }
}

/** What a Group body says: { displayName, externalId, memberIds }. */
export function readGroupBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ScimError(400, 'Send a Group.', 'invalidSyntax')
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 200) : ''
  if (!displayName) throw new ScimError(400, 'displayName is required.', 'invalidValue')
  const members = Array.isArray(body.members) ? body.members : []
  return {
    displayName,
    externalId: typeof body.externalId === 'string' ? body.externalId.trim().slice(0, 256) : '',
    memberIds: [...new Set(members.map((member) => member?.value).filter((value) => typeof value === 'string' && value))],
  }
}

/**
 * A user body with a patch applied: the patch ops run against what the user is now, and the
 * result is read as a PUT body would be. Unknown attributes (an enterprise extension's title or
 * department, which Entra sends by default) are accepted and change nothing.
 */
export function patchUserBody(current, ops) {
  const next = structuredClone(current)
  next.name = next.name || {}
  for (const { op, path, value } of ops) {
    const set = op !== 'remove'
    switch (path) {
      case 'active': next.active = set ? value : true; break
      case 'username': if (set) next.userName = value; break
      case 'externalid': next.externalId = set ? value : undefined; break
      case 'displayname': next.displayName = set ? value : undefined; break
      case 'name.givenname': next.name.givenName = set ? value : ''; break
      case 'name.familyname': next.name.familyName = set ? value : ''; break
      case 'name.formatted': break
      case 'name':
        if (set && value && typeof value === 'object') next.name = { ...next.name, ...value }
        break
      case 'emails':
        if (set && Array.isArray(value)) next.emails = value
        break
      case 'emails.value':
        if (set && typeof value === 'string') next.emails = [{ value, type: 'work', primary: true }]
        break
      default:
        break
    }
  }
  return next
}

// ---- discovery -------------------------------------------------------------------------------

export function serviceProviderConfig(base) {
  return {
    schemas: [SCHEMA.serviceProviderConfig],
    documentationUri: 'https://docs.slatebox.com/Using-Slatebox/scim',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: MAX_RESULTS },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{
      type: 'oauthbearertoken',
      name: 'Bearer token',
      description: 'A SCIM token from Team settings › Sign-in & security, sent as Authorization: Bearer <token>.',
      primary: true,
    }],
    meta: { resourceType: 'ServiceProviderConfig', location: `${base}/ServiceProviderConfig` },
  }
}

export function resourceTypes(base) {
  return [
    {
      schemas: [SCHEMA.resourceType], id: 'User', name: 'User', endpoint: '/Users', description: 'A person in the team',
      schema: SCHEMA.user, meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` },
    },
    {
      schemas: [SCHEMA.resourceType], id: 'Group', name: 'Group', endpoint: '/Groups', description: 'A group, which a team admin may map to a role',
      schema: SCHEMA.group, meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/Group` },
    },
  ]
}

const attribute = (name, type, extra = {}) => ({
  name, type, multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', ...extra,
})

export function schemas(base) {
  return [
    {
      schemas: [SCHEMA.schema],
      id: SCHEMA.user,
      name: 'User',
      description: 'A person in the team',
      attributes: [
        attribute('userName', 'string', { required: true, uniqueness: 'server' }),
        attribute('externalId', 'string', { caseExact: true }),
        attribute('name', 'complex', { subAttributes: [attribute('givenName', 'string'), attribute('familyName', 'string'), attribute('formatted', 'string', { mutability: 'readOnly' })] }),
        attribute('displayName', 'string'),
        attribute('emails', 'complex', { multiValued: true, subAttributes: [attribute('value', 'string'), attribute('type', 'string'), attribute('primary', 'boolean')] }),
        attribute('active', 'boolean'),
        attribute('groups', 'complex', { multiValued: true, mutability: 'readOnly', subAttributes: [attribute('value', 'string'), attribute('display', 'string')] }),
      ],
      meta: { resourceType: 'Schema', location: `${base}/Schemas/${SCHEMA.user}` },
    },
    {
      schemas: [SCHEMA.schema],
      id: SCHEMA.group,
      name: 'Group',
      description: 'A group, which a team admin may map to a role',
      attributes: [
        attribute('displayName', 'string', { required: true }),
        attribute('externalId', 'string', { caseExact: true }),
        attribute('members', 'complex', { multiValued: true, subAttributes: [attribute('value', 'string', { mutability: 'immutable' }), attribute('display', 'string', { mutability: 'readOnly' })] }),
      ],
      meta: { resourceType: 'Schema', location: `${base}/Schemas/${SCHEMA.group}` },
    },
  ]
}
