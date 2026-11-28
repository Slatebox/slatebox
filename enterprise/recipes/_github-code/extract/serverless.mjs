// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Serverless Framework (serverless.yml) and AWS SAM (template.yaml): functions and what starts
// them (http routes become endpoints; queues, topics and streams become queue notes).
import { parseYaml } from '../yaml.mjs'

export const match = (path) => /(?:^|\/)(serverless\.ya?ml|template\.ya?ml|samconfig\.ya?ml)$/i.test(path) && !/samconfig/i.test(path)

const queueName = (arn) => `${arn ?? ''}`.split(':').pop().replace(/[^\w.-]/g, '') || null

export function extract(path, text) {
  if (!/(^|\n)\s*(functions|Resources)\s*:/.test(text)) return {}
  const doc = parseYaml(text) || {}
  const services = []
  const endpoints = []
  const fn = (name, events) => {
    const refs = []
    for (const event of events) {
      if (!event || typeof event !== 'object') continue
      const [type, spec] = Object.entries(event)[0] || []
      if (!type) continue
      if (['http', 'httpApi', 'Api', 'HttpApi'].includes(type)) {
        const s = typeof spec === 'string' ? { method: spec.split(' ')[0], path: spec.split(' ')[1] } : spec?.Properties ?? spec ?? {}
        const method = `${s.method ?? s.Method ?? 'ANY'}`.toUpperCase()
        const route = `${s.path ?? s.Path ?? '/'}`
        endpoints.push({ method, path: route.startsWith('/') ? route : `/${route}`, group: name, file: path, line: null, source: 'serverless' })
      } else if (['sqs', 'SQS', 'sns', 'SNS', 'stream', 'Kinesis', 'kafka', 'MSK'].includes(type)) {
        const arn = typeof spec === 'string' ? spec : spec?.arn ?? spec?.Properties?.Queue ?? spec?.Properties?.Topic ?? spec?.Properties?.Stream ?? spec?.topic
        const q = queueName(typeof arn === 'object' ? JSON.stringify(arn) : arn)
        if (q) {
          if (!services.some((s) => s.name === `queue:${q}`)) services.push({ name: `queue:${q}`, label: q, kind: 'queue', image: null, refs: [], source: 'serverless' })
          services.find((s) => s.name === `queue:${q}`).refs.push({ to: `fn:${name}`, protocol: type.toLowerCase(), via: 'event' })
        }
      }
    }
    services.push({ name: `fn:${name}`, label: name, kind: 'function', image: null, refs, source: 'serverless' })
  }
  if (doc.functions && typeof doc.functions === 'object')
    for (const [name, spec] of Object.entries(doc.functions)) fn(name, Array.isArray(spec?.events) ? spec.events : [])
  if (doc.Resources && typeof doc.Resources === 'object')
    for (const [name, res] of Object.entries(doc.Resources))
      if (res?.Type === 'AWS::Serverless::Function') fn(name, Object.values(res.Properties?.Events || {}).map((e) => ({ [e?.Type]: e })))
  return services.length ? { services, endpoints } : {}
}
