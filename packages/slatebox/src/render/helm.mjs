// `export --format helm`: the same objects renderK8s makes, wrapped as a chart
// for GitOps. The objects are rendered once with marker values, and each
// marker becomes a template expression, so the chart cannot drift from what
// `install k8s` applies. The Secret is not in the chart: it names an existing
// one (create it with your secret manager, or from secret.example.yaml).
import { names, renderK8s } from './k8s.mjs'
import { stringify } from '../yaml.mjs'

const MARK = {
  image: '__SBX_IMAGE__', namespace: '__SBX_NAMESPACE__', memory: '__SBX_MEMORY__', cpu: '__SBX_CPU__',
  storage: '__SBX_STORAGE__', host: '__sbx-host__.invalid', secret: '__SBX_SECRET__', storageClass: '__SBX_STORAGE_CLASS__',
}

const EXPR = {
  [MARK.image]: '{{ .Values.image | quote }}',
  [MARK.namespace]: '{{ .Release.Namespace | quote }}',
  [MARK.memory]: '{{ .Values.resources.memory | quote }}',
  [MARK.cpu]: '{{ .Values.resources.cpu | quote }}',
  [MARK.storage]: '{{ .Values.storage.size | quote }}',
  [MARK.host]: '{{ .Values.host | quote }}',
  [MARK.secret]: '{{ .Values.existingSecret | quote }}',
  [MARK.storageClass]: '{{ .Values.storage.className | quote }}',
}

function templated(object) {
  let text = stringify(object)
  for (const [mark, expression] of Object.entries(EXPR)) text = text.split(mark).join(expression)
  return text
}

/**
 * @returns {Record<string, string>} chart files by path, relative to the chart directory
 */
export function renderHelmChart(answers, { image, env, version, appVersion }) {
  const n = names(answers)
  const host = answers.address.url ? new URL(answers.address.url).hostname : null
  const marked = structuredClone(answers)
  marked.k8s = { ...marked.k8s, namespace: MARK.namespace, storageClass: answers.k8s.storageClass ? MARK.storageClass : null }
  marked.size = { memory: MARK.memory, cpu: MARK.cpu, storage: MARK.storage }
  if (answers.k8s.route !== 'none') marked.address = { url: `https://${MARK.host}` }
  const objects = renderK8s(marked, { image: MARK.image, env: {}, record: '' })
    .filter(object => object.kind !== 'Namespace' && object.metadata.name !== n.record && object.metadata.name !== n.config)
  const files = {}
  files['Chart.yaml'] = stringify({
    apiVersion: 'v2', name: 'slatebox', description: 'Slatebox: the app, live collaboration and its database in one pod.',
    type: 'application', version, appVersion: String(appVersion),
  })
  const values = {
    image,
    host,
    existingSecret: n.secret,
    resources: { memory: answers.size.memory, cpu: answers.size.cpu },
    storage: { size: answers.size.storage, className: answers.k8s.storageClass || '' },
    settings: { ...env },
  }
  files['values.yaml'] = `# Values for the Slatebox chart, written by \`slatebox install export --format helm\`.\n# The Secret "${n.secret}" must exist: see secret.example.yaml next to this chart.\n${stringify(values)}`
  files['templates/configmap.yaml'] = `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${n.config}
  namespace: {{ .Release.Namespace | quote }}
  labels:
${Object.entries(objects[0].metadata.labels).map(([key, value]) => `    ${key}: ${value}`).join('\n')}
data:
{{- range $key, $value := .Values.settings }}
  {{ $key }}: {{ $value | quote }}
{{- end }}
`
  for (const object of objects) {
    let text = templated(object)
    if (object.kind === 'StatefulSet') {
      text = text.replace(/slatebox\.com\/config-hash: \S+/, `slatebox.com/config-hash: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum | trunc 16 | quote }}`)
      text = text.replace(`name: ${n.secret}`, `name: ${EXPR[MARK.secret]}`)
    }
    files[`templates/${object.kind.toLowerCase()}-${object.metadata.name}.yaml`] = text
  }
  return files
}
