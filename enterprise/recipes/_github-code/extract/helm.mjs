// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Helm: Chart.yaml only (the chart and the charts it depends on). Templates are not rendered, so
// the facts say so and the service map shows one plain warning note.
import { parseYaml } from '../yaml.mjs'
import { kindOf } from './kinds.mjs'

export const match = (path) => /(?:^|\/)Chart\.ya?ml$/.test(path)

export function extract(path, text) {
  const doc = parseYaml(text) || {}
  const name = `${doc.name ?? ''}`
  if (!name) return {}
  const deps = (Array.isArray(doc.dependencies) ? doc.dependencies : []).map((d) => `${d?.name ?? ''}`).filter(Boolean)
  const services = [
    { name: `chart:${name}`, label: name, kind: 'service', image: null, refs: deps.map((d) => ({ to: `chart:${d}`, protocol: null, via: 'helm' })), source: 'helm' },
    ...deps.map((d) => ({ name: `chart:${d}`, label: d, kind: kindOf(d, d) === 'service' ? 'external' : kindOf(d, d), image: null, refs: [], source: 'helm' })),
  ]
  return { services, warnings: [`Helm charts are read from Chart.yaml only; templates in ${path.replace(/Chart\.ya?ml$/, '')}templates are not rendered.`] }
}
