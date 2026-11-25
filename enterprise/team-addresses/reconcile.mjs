// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The team-address reconciler: one pass every 10 minutes on one Cloud server (meteor.js holds the
// lease). Our database decides; Cloudflare is made to match it.
//
//   finish     claims left releasing, failed claims left needing cleanup, renames past 24 hours
//   status     lastSeen from Cloudflare's own tunnel status (installs never phone home); more than
//              one connector client on a tunnel tells the owner (a copied token)
//   drift      an active claim's ingress and CNAME put back; a suspended one kept at 451
//   orphans    sbx- tunnels and slatebox-team-claim: records with no live claim, older than an hour
//   reaping    never connected within 24 hours of the claim: released; idle 60 days: the owner is
//              told; idle 90 days: released (the owner may claim it again within 30 days)
//   zone       slatebox.team's settings checked (WebSockets on, SSL Full, Always Use HTTPS, TLS 1.2+)
import { DNS_COMMENT_PREFIX, TUNNEL_PREFIX, tunnelTarget } from './cf.mjs'
import { DAY_MS, SUSPENDED_INGRESS } from './claims.mjs'
import { LIVE } from './store.mjs'

export const REAP = Object.freeze({ neverConnectedMs: DAY_MS, idleNoticeMs: 60 * DAY_MS, idleReleaseMs: 90 * DAY_MS, orphanAgeMs: 3_600_000, multiAlertMs: DAY_MS })
export const ZONE_EXPECT = Object.freeze({
  websockets: (value) => value === 'on',
  ssl: (value) => value === 'full' || value === 'strict',
  always_use_https: (value) => value === 'on',
  min_tls_version: (value) => typeof value === 'string' && Number(value) >= 1.2,
  email_obfuscation: (value) => value === 'off',
  rocket_loader: (value) => value === 'off',
})

const age = (value, now) => {
  const at = typeof value === 'string' ? Date.parse(value) : Number(value)
  return Number.isFinite(at) ? now - at : Infinity
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// Cloudflare may answer the stored ingress with extra defaults; compare the parts we set.
const shape = (config) => ({
  ingress: (config?.ingress || []).map((rule) => ({ hostname: rule.hostname || null, service: rule.service })),
})

export function createReconciler({ store, cf, service, now = Date.now, log = () => {}, notify = () => {} }) {
  const system = { kind: 'system' }
  const say = (line) => log(`[team-addresses] reconcile: ${line}`)
  const tell = async (message) => {
    try {
      await notify(message)
    } catch {
      // A notice that cannot be sent never stops the pass.
    }
  }
  const fixed = (claim, what, report) => {
    report.fixed.push(`${claim?._id || '-'}: ${what}`)
    return service.audit({ actor: system, action: 'reconcile_fix', claim, error: { code: what } })
  }

  async function step(report, label, fn) {
    try {
      await fn()
    } catch (error) {
      report.errors.push(`${label}: ${error?.message || error}`)
    }
  }

  async function run() {
    const t = now()
    const report = { fixed: [], reaped: [], noticed: [], zone: [], errors: [], live: 0 }

    // ---- finish what was left half-done --------------------------------------------------
    for (const doc of await store.claims.inStatuses(['releasing'])) await step(report, `release ${doc._id}`, () => service.release(doc, { actor: system }))
    for (const doc of await store.claims.needingCleanup()) await step(report, `cleanup ${doc._id}`, async () => {
      if (await service.compensate(doc)) await fixed(doc, 'cleaned_up', report)
    })
    for (const doc of await store.claims.inStatuses(['active', 'suspended']))
      if (doc.previousNames?.some((entry) => entry.until <= t)) await step(report, `rename ${doc._id}`, async () => {
        await service.finishRename(doc)
        await fixed(doc, 'rename_finished', report)
      })

    // ---- each live claim: status, drift, reaping --------------------------------------------
    const live = await store.claims.inStatuses(['pending', 'active', 'suspended'])
    report.live = live.length
    for (const doc of live) {
      await step(report, `claim ${doc._id}`, async () => {
        if (!doc.cf?.tunnelId) {
          if (age(doc.createdAt, t) > REAP.neverConnectedMs) {
            await service.release(doc, { actor: system })
            report.reaped.push(doc._id)
          }
          return
        }
        const tunnel = await cf.getTunnel(doc.cf.tunnelId)
        if (!tunnel) {
          say(`claim ${doc._id} lost its tunnel`)
          report.errors.push(`claim ${doc._id}: tunnel missing at Cloudflare`)
          return
        }
        const connections = Array.isArray(tunnel.connections) ? tunnel.connections.length : 0
        const lastSeen = { at: t, connections, connectedAt: connections > 0 ? t : doc.lastSeen?.connectedAt ?? null }
        await store.claims.update(doc._id, { lastSeen })
        doc.lastSeen = lastSeen

        // Reaping first: a claim about to be released needs no repair.
        if (doc.status !== 'suspended') {
          if (!lastSeen.connectedAt && age(doc.createdAt, t) > REAP.neverConnectedMs) {
            await service.release(doc, { actor: system })
            report.reaped.push(doc._id)
            return
          }
          const idle = lastSeen.connectedAt ? age(lastSeen.connectedAt, t) : 0
          if (idle > REAP.idleReleaseMs) {
            await service.release(doc, { actor: system })
            report.reaped.push(doc._id)
            return
          }
          if (idle > REAP.idleNoticeMs && !doc.idleNoticeAt) {
            await tell({ userId: doc.ownerId, subject: `Team address ${service.hostOf(doc.name)} is idle`, text: `${service.hostOf(doc.name)} has not connected for 60 days. It is released after 90 days without a connection; start your Slatebox to keep it.` })
            await store.claims.update(doc._id, { idleNoticeAt: t })
            report.noticed.push(doc._id)
          }
        }

        // More than one connector client: someone else may hold a copy of the token.
        if (connections > 0 && doc.status === 'active') {
          const clients = await cf.listConnections(doc.cf.tunnelId)
          const distinct = new Set(clients.map((client) => client.id || client.client_id).filter(Boolean))
          if (distinct.size > 1 && age(doc.multiAlertAt || 0, t) > REAP.multiAlertMs) {
            await tell({ userId: doc.ownerId, subject: `More than one computer is serving ${service.hostOf(doc.name)}`, text: `${distinct.size} connectors are serving ${service.hostOf(doc.name)}. If you run only one Slatebox, run "slatebox address rotate" on it now: that stops every other copy.` })
            await store.claims.update(doc._id, { multiAlertAt: t })
            await fixed(doc, 'multiple_connectors_alerted', report)
          }
        }

        // Drift: what the tunnel serves, and the name's record.
        const hosts = [service.hostOf(doc.name), ...(doc.previousNames || []).map((entry) => service.hostOf(entry.name))]
        const want = doc.status === 'suspended' ? SUSPENDED_INGRESS : service.ingress(hosts)
        if (doc.status !== 'pending') {
          const have = await cf.getConfig(doc.cf.tunnelId)
          if (!same(shape(have), shape(want))) {
            await cf.putConfig(doc.cf.tunnelId, want)
            await fixed(doc, 'ingress_reset', report)
          }
          const record = await cf.findCname(hosts[0])
          if (!record) {
            const made = await cf.createCname({ name: hosts[0], content: tunnelTarget(doc.cf.tunnelId), comment: `${DNS_COMMENT_PREFIX}${doc._id}` })
            await store.claims.update(doc._id, { 'cf.dnsRecordId': made?.id || null })
            await fixed(doc, 'dns_recreated', report)
          } else if (record.content !== tunnelTarget(doc.cf.tunnelId)) {
            report.errors.push(`claim ${doc._id}: its DNS record points elsewhere`)
          }
        }
      })
    }

    // ---- orphans at Cloudflare ----------------------------------------------------------------
    await step(report, 'orphan tunnels', async () => {
      for (const tunnel of await cf.listTunnels()) {
        if (!tunnel?.name?.startsWith(TUNNEL_PREFIX) || age(tunnel.created_at, t) < REAP.orphanAgeMs) continue
        const claim = await store.claims.get(tunnel.name.slice(TUNNEL_PREFIX.length))
        if (claim && LIVE.includes(claim.status) && claim.cf?.tunnelId === tunnel.id) continue
        await cf.deleteConnections(tunnel.id)
        await cf.deleteTunnel(tunnel.id)
        await fixed(claim, 'orphan_tunnel_deleted', report)
      }
    })
    await step(report, 'orphan records', async () => {
      for (const record of await cf.listDns()) {
        if (!`${record?.comment || ''}`.startsWith(DNS_COMMENT_PREFIX) || age(record.created_on, t) < REAP.orphanAgeMs) continue
        const claim = await store.claims.get(record.comment.slice(DNS_COMMENT_PREFIX.length))
        const ours = claim && LIVE.includes(claim.status) && (claim.cf?.dnsRecordId === record.id || (claim.previousNames || []).some((entry) => entry.dnsRecordId === record.id))
        if (ours) continue
        await cf.deleteDns(record.id)
        await fixed(claim, 'orphan_record_deleted', report)
      }
    })

    // ---- the zone's own settings ----------------------------------------------------------------
    await step(report, 'zone', async () => {
      for (const [id, ok] of Object.entries(ZONE_EXPECT)) {
        const value = await cf.zoneSetting(id)
        if (!ok(value)) report.zone.push(`${id}=${value}`)
      }
    })

    const settings = service.settings()
    if (report.live >= settings.alertTunnels) say(`alert: ${report.live} live claims (alert at ${settings.alertTunnels}, cap ${settings.maxTunnels})`)
    if (report.zone.length) say(`zone settings drifted: ${report.zone.join(', ')}`)
    if (report.errors.length) say(`${report.errors.length} step(s) failed; the next pass tries again`)
    return report
  }

  return { run }
}
