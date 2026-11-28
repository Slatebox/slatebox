// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Kubernetes manifests: Deployments, StatefulSets, DaemonSets, CronJobs and Jobs are services; a
// Service's selector joins it to the workloads whose labels it matches; an Ingress's backends join
// it to Services; env values naming a Service (<svc>, <svc>.<ns>, <svc>.<ns>.svc[.cluster.local])
// are connections. Per file the objects are facts; the joins happen across files (joinK8s).
import { parseYamlAll } from '../yaml.mjs'
import { defaultProtocol, kindOf, protocolOf } from './kinds.mjs'

const WORKLOADS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'CronJob', 'Job', 'ReplicaSet'])

export const match = (path) => /\.ya?ml$/i.test(path) && !/(?:^|\/)templates\//.test(path) && !/(?:^|\/)(?:docker-)?compose/i.test(path)

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v)

function podSpec(doc) {
  if (doc.kind === 'CronJob') return doc.spec?.jobTemplate?.spec?.template?.spec
  return doc.spec?.template?.spec
}

export function extract(path, text) {
  if (!/^\s*kind\s*:/m.test(text) || !/^\s*apiVersion\s*:/m.test(text)) return {}
  const objects = []
  for (const doc of parseYamlAll(text).docs) {
    if (!isObject(doc) || typeof doc.kind !== 'string' || !isObject(doc.metadata)) continue
    const name = `${doc.metadata.name ?? ''}`
    if (!name) continue
    const ns = `${doc.metadata.namespace ?? 'default'}`
    if (WORKLOADS.has(doc.kind)) {
      const pod = podSpec(doc) || {}
      const containers = Array.isArray(pod.containers) ? pod.containers : []
      const env = containers.flatMap((c) => (Array.isArray(c?.env) ? c.env : [])).filter((e) => e && typeof e.value === 'string').map((e) => [e.name, e.value])
      const labels = { ...(doc.spec?.template?.metadata?.labels || {}), ...(doc.kind === 'CronJob' ? doc.spec?.jobTemplate?.spec?.template?.metadata?.labels || {} : {}) }
      objects.push({ type: 'workload', kind: doc.kind, name, ns, labels, image: `${containers[0]?.image ?? ''}`, env })
    } else if (doc.kind === 'Service') {
      objects.push({ type: 'service', name, ns, selector: isObject(doc.spec?.selector) ? doc.spec.selector : {}, external: doc.spec?.type === 'ExternalName' ? `${doc.spec.externalName ?? ''}` : null })
    } else if (doc.kind === 'Ingress') {
      const backends = []
      const take = (b) => {
        const svc = b?.service?.name ?? b?.serviceName
        if (svc) backends.push(`${svc}`)
      }
      take(doc.spec?.defaultBackend ?? doc.spec?.backend)
      for (const rule of Array.isArray(doc.spec?.rules) ? doc.spec.rules : [])
        for (const p of Array.isArray(rule?.http?.paths) ? rule.http.paths : []) take(p?.backend)
      const hosts = (Array.isArray(doc.spec?.rules) ? doc.spec.rules : []).map((r) => r?.host).filter(Boolean)
      objects.push({ type: 'ingress', name, ns, hosts, backends: [...new Set(backends)] })
    }
  }
  return objects.length ? { k8s: objects } : {}
}

/** Services and connections from every file's objects together. → [{ name, kind, image, refs, source }] */
export function joinK8s(objects) {
  const workloads = objects.filter((o) => o.type === 'workload')
  const services = objects.filter((o) => o.type === 'service')
  const matches = (selector, labels) => Object.keys(selector).length > 0 && Object.entries(selector).every(([k, v]) => `${labels?.[k]}` === `${v}`)
  // Each k8s Service name stands for the workloads it selects (or itself, for an external name).
  const serviceTargets = new Map()
  for (const svc of services) {
    const targets = workloads.filter((w) => w.ns === svc.ns && matches(svc.selector, w.labels)).map((w) => w.name)
    serviceTargets.set(`${svc.ns}/${svc.name}`, targets.length ? targets : svc.external ? [svc.name] : [])
  }
  const out = new Map()
  for (const w of workloads) out.set(w.name, { name: w.name, kind: kindOf(w.image, w.name), image: w.image || null, refs: [], source: 'k8s' })
  for (const svc of services) if (svc.external && !out.has(svc.name)) out.set(svc.name, { name: svc.name, kind: 'external', image: null, refs: [], source: 'k8s' })
  const resolveHost = (host, ns) => {
    const parts = host.split('.')
    const svcNs = parts.length >= 2 && parts[1] !== 'svc' ? parts[1] : ns
    return serviceTargets.get(`${svcNs}/${parts[0]}`) || []
  }
  for (const w of workloads) {
    const me = out.get(w.name)
    for (const [, value] of w.env) {
      const host = value.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^:/?#,]+)/i)?.[1] ?? value.split(':')[0]
      if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9-]+)*$/.test(host)) continue
      for (const target of resolveHost(host, w.ns)) {
        if (target === w.name || me.refs.some((r) => r.to === target)) continue
        me.refs.push({ to: target, protocol: protocolOf(value) ?? defaultProtocol(out.get(target)?.kind, out.get(target)?.image ?? ''), via: 'env' })
      }
    }
  }
  for (const ing of objects.filter((o) => o.type === 'ingress')) {
    const name = `ingress:${ing.name}`
    const refs = ing.backends.flatMap((b) => serviceTargets.get(`${ing.ns}/${b}`) || []).map((to) => ({ to, protocol: 'http', via: 'ingress' }))
    out.set(name, { name, label: ing.hosts[0] || ing.name, kind: 'ingress', image: null, refs, source: 'k8s' })
  }
  return [...out.values()]
}
