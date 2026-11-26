// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The one-time move to integrations (owner, 2026-11-24: connect once, invite anywhere), run at
// every server start and idempotent. Each person's live agents on slates are grouped by server
// address; each group becomes (or joins) that person's integration, with the newest agent's name
// and consented tools, rule 'ask'. Every agent is then linked to its integration.
//
// Nothing anyone holds changes: the vault's rows keep their ids (credentialId(userId, address)), so
// nobody signs in again; each agent keeps its id, agentId, colour and suggestions, so no slate breaks.
// A sign-in with no agent on any slate is not turned into an integration (no tools were consented
// to): housekeeping forgets it after a day, as before.
import { randomBytes } from 'node:crypto'
import { canonicalAddress } from '../common/gallery.mjs'

const newId = () => 'i' + randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x')
const time = (doc) => new Date(doc.updatedAt || doc.createdAt || 0).getTime()

/**
 * connections: { find(query), update(id, set) }  integrations: { findOne(query), insert(doc), update(id, set) }
 * → { created, linked }
 */
export async function migrateIntegrations({ connections, integrations, now = Date.now }) {
  const live = await connections.find({ status: { $ne: 'removed' } })
  const groups = new Map()
  for (const doc of live) {
    const address = canonicalAddress(doc.address)
    if (!doc.ownerId || !address) continue
    const key = `${doc.ownerId}\n${address}`
    if (!groups.has(key)) groups.set(key, { ownerId: doc.ownerId, address, docs: [] })
    groups.get(key).docs.push(doc)
  }
  let created = 0
  let linked = 0
  for (const { ownerId, address, docs } of groups.values()) {
    const newest = [...docs].sort((a, b) => time(b) - time(a))[0]
    let integration = await integrations.findOne({ ownerId, address })
    if (!integration) {
      const at = new Date(now())
      // Paused anywhere (its tools changed since consent) means the integration waits for one review.
      const paused = docs.find((doc) => doc.status === 'paused')
      integration = {
        _id: newId(),
        ownerType: 'user',
        ownerId,
        kind: 'mcp',
        address,
        host: newest.host || new URL(address).host,
        galleryId: newest.galleryId || null,
        name: newest.name,
        serverName: newest.serverName || '',
        tools: newest.tools || [],
        auth: newest.auth || null,
        scopes: [],
        defaultContextLevel: 'request',
        rule: 'ask',
        colorIndex: newest.colorIndex ?? 1,
        status: paused ? 'paused' : newest.status === 'needs_sign_in' ? 'needs_sign_in' : 'active',
        ...(paused?.changed && { changed: paused.changed }),
        createdAt: new Date(Math.min(...docs.map((doc) => new Date(doc.createdAt || at).getTime()))),
        updatedAt: at,
        lastUsedAt: null,
        migratedAt: at,
      }
      try {
        await integrations.insert(integration)
        created++
      } catch (error) {
        // Another app process made it first (the store is unique on person and address).
        if (error?.code !== 11000) throw error
        integration = await integrations.findOne({ ownerId, address })
        if (!integration) throw error
      }
    }
    for (const doc of docs) {
      if (doc.integrationId === integration._id) continue
      await connections.update(doc._id, { integrationId: integration._id, ...(!doc.joinedBy && { joinedBy: 'invite' }) })
      linked++
    }
  }
  return { created, linked }
}

/**
 * Integrations are free (owner, 2026-11-26): an integration or agent a lapsed plan had paused (its
 * status 'pro_ended', from before that decision) works again. Run at every server start and idempotent.
 * connections, integrations: { find(query), update(id, set) } → { resumed }
 */
export async function resumeLapsedIntegrations({ connections, integrations, now = Date.now }) {
  let resumed = 0
  for (const store of [integrations, connections]) {
    for (const doc of await store.find({ status: 'pro_ended' })) {
      await store.update(doc._id, { status: 'active', proEndedAt: null, updatedAt: new Date(now()) })
      resumed++
    }
  }
  return { resumed }
}
