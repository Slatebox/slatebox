// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Admin tools › Team addresses: the methods the admin view calls (client/TeamAddressesAdmin.jsx).
// Plain Meteor methods, not registry actions, on purpose (like enterprise.licenseStatus): they are
// Cloud administrators' own operations, with nothing a token or an agent should reach. Each one
// checks, every call, that team addresses run here (gate) and that the caller holds the platform
// administrator claim; every change is audited by the service.
export const ADMIN_METHODS = Object.freeze({
  list: 'teamAddresses.admin.list',
  why: 'teamAddresses.admin.why',
  suspend: 'teamAddresses.admin.suspend',
  unsuspend: 'teamAddresses.admin.unsuspend',
  release: 'teamAddresses.admin.release',
  pause: 'teamAddresses.admin.pause',
  blocklist: 'teamAddresses.admin.blocklist',
  blockAdd: 'teamAddresses.admin.blockAdd',
  blockRemove: 'teamAddresses.admin.blockRemove',
  audit: 'teamAddresses.admin.audit',
})

const text = (value, max = 500) => (typeof value === 'string' ? value.slice(0, max) : '')

/**
 * @param {() => null | { gate(): boolean, isAdmin(userId): Promise<boolean>, service, describeOwner }} running
 * @param {(code: string, reason: string) => Error} [makeError]  an error Meteor sends to the browser as
 *   it is (isClientSafe, the flag Meteor.Error carries), so the admin view shows the reason
 */
export function adminMethods(running, makeError = (code, reason) => Object.assign(new Error(reason), { error: code, reason, isClientSafe: true, errorType: 'Meteor.Error' })) {
  async function admin(invocation) {
    const started = running()
    if (!started || !started.gate()) throw makeError('not_found', 'Team addresses do not run on this server.')
    const userId = invocation?.userId
    if (!userId || !(await started.isAdmin(userId))) throw makeError('denied', 'Only an administrator can manage team addresses.')
    return { started, userId }
  }
  const call = async (fn) => {
    try {
      return await fn()
    } catch (error) {
      if (error?.code && error?.status && error.status < 500 && !error.error) throw makeError(error.code, error.message)
      throw error
    }
  }
  return {
    async [ADMIN_METHODS.list](input = {}) {
      const { started } = await admin(this)
      return call(() => started.service.adminList({ q: text(input?.q, 80), describeOwner: started.describeOwner }))
    },
    async [ADMIN_METHODS.why](input = {}) {
      const { started } = await admin(this)
      return call(() => started.service.adminWhy(text(input?.name, 64)))
    },
    async [ADMIN_METHODS.suspend](input = {}) {
      const { started, userId } = await admin(this)
      return call(() => started.service.suspend({ admin: userId, id: text(input?.id, 40), reason: text(input?.reason), notice: text(input?.notice) }))
    },
    async [ADMIN_METHODS.unsuspend](input = {}) {
      const { started, userId } = await admin(this)
      return call(() => started.service.unsuspend({ admin: userId, id: text(input?.id, 40) }))
    },
    async [ADMIN_METHODS.release](input = {}) {
      const { started, userId } = await admin(this)
      return call(() => started.service.forceRelease({ admin: userId, id: text(input?.id, 40) }))
    },
    async [ADMIN_METHODS.pause](input = {}) {
      const { started, userId } = await admin(this)
      return call(() => started.service.setPaused({ admin: userId, paused: input?.paused === true }))
    },
    async [ADMIN_METHODS.blocklist]() {
      const { started } = await admin(this)
      return call(() => started.service.blocklistList())
    },
    async [ADMIN_METHODS.blockAdd](input = {}) {
      const { started, userId } = await admin(this)
      return call(() => started.service.blocklistAdd({ admin: userId, pattern: text(input?.pattern, 64), kind: input?.kind, reason: text(input?.reason, 200) }))
    },
    async [ADMIN_METHODS.blockRemove](input = {}) {
      const { started } = await admin(this)
      return call(() => started.service.blocklistRemove({ id: text(input?.id, 40) }))
    },
    async [ADMIN_METHODS.audit](input = {}) {
      const { started } = await admin(this)
      return call(() => started.service.auditList({ claimId: text(input?.claimId, 40) || undefined, limit: Number(input?.limit) || 100 }))
    },
  }
}
