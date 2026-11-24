// Kubernetes objects for one Slatebox, rendered in code (one source of truth
// for `install k8s`, `export --format manifests` and `export --format helm`).
//
// One pod, one replica: MongoDB runs inside it. Data on a ReadWriteOnce
// volume. Backups by a sidecar that shares the pod's network and /run/slatebox
// with Slatebox, runs the image's own `slatebox backup` once a day and keeps
// the last N on a second volume. No liveness probe: a restore pauses the app on
// purpose, and the image's supervisor already ends the container when any of
// its services dies.
import { createHash } from 'node:crypto'
import { hasRegistry, isTag } from '../image.mjs'

export const MANAGER = 'slatebox-installer'

export function labels(answers) {
  return {
    'app.kubernetes.io/name': 'slatebox',
    'app.kubernetes.io/instance': answers.name,
    'app.kubernetes.io/managed-by': MANAGER,
    'slatebox.com/install': answers.name,
  }
}

const selector = answers => ({ 'app.kubernetes.io/name': 'slatebox', 'app.kubernetes.io/instance': answers.name })

export const names = answers => ({
  set: answers.name,
  service: answers.name,
  config: `${answers.name}-config`,
  secret: `${answers.name}-env`,
  script: `${answers.name}-backup-script`,
  backups: `${answers.name}-backups`,
  record: `${answers.name}-install`,
  tls: `${answers.name}-tls`,
  pod: `${answers.name}-0`,
})

const meta = (answers, name, extra = {}) => ({ name, namespace: answers.k8s.namespace, labels: labels(answers), ...extra })

export const BACKUP_SCRIPT = `#!/bin/bash
# Daily backups of the Slatebox in this pod, kept on the backups volume.
#   backup-loop.sh          wait for BACKUP_AT (HH:MM, UTC) every day
#   backup-loop.sh --once   one backup now, then exit
set -u
dir=/backups
keep=\${BACKUP_KEEP:-14}
once() {
  local file="$dir/slatebox-$(date -u +%Y%m%d-%H%M%S).gz"
  if /opt/slatebox/bin/slatebox backup > "$file.part"; then
    mv "$file.part" "$file"
    echo "[backups] $(date -u +%FT%TZ) wrote $file"
  else
    rm -f "$file.part"
    echo "[backups] $(date -u +%FT%TZ) the backup failed; the previous ones are kept" >&2
  fi
  ls -1t "$dir"/slatebox-*.gz 2>/dev/null | tail -n +$((keep + 1)) | xargs -r rm -f
}
if [[ \${1:-} == --once ]]; then once; exit; fi
while :; do
  now=$(date -u +%s)
  next=$(date -u -d "today \${BACKUP_AT:-03:00}" +%s)
  ((next > now)) || next=$(date -u -d "tomorrow \${BACKUP_AT:-03:00}" +%s)
  sleep $((next - now))
  once
done
`

function backupAt(schedule) {
  const [minute, hour] = schedule.split(' ')
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
}

/**
 * @param {object} answers resolved answers (target k8s, or export with manifests/helm)
 * @param {{image: string, env: Record<string,string>, secretsHash?: string, record: string}} options
 */
export function renderK8s(answers, { image, env, secretsHash = '', record }) {
  // A digest is the same bytes on every node. A registry tag can move, and with IfNotPresent each
  // node would keep whichever build it pulled first: pull a tag every start instead. A local tag
  // (loaded into kind or minikube, no registry) can only be used as it is.
  const imagePullPolicy = isTag(image) && hasRegistry(image) ? 'Always' : 'IfNotPresent'
  const n = names(answers)
  const backups = answers.backups.to !== 'off'
  const objects = []
  objects.push({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: answers.k8s.namespace, labels: labels(answers) } })
  objects.push({ apiVersion: 'v1', kind: 'ConfigMap', metadata: meta(answers, n.config), data: { ...env } })
  if (backups) {
    objects.push({ apiVersion: 'v1', kind: 'ConfigMap', metadata: meta(answers, n.script), data: { 'backup-loop.sh': BACKUP_SCRIPT } })
    objects.push({
      apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: meta(answers, n.backups),
      spec: {
        accessModes: ['ReadWriteOnce'],
        ...(answers.k8s.storageClass ? { storageClassName: answers.k8s.storageClass } : {}),
        resources: { requests: { storage: answers.size.storage } },
      },
    })
  }
  const configHash = createHash('sha256').update(JSON.stringify(env)).update(secretsHash).digest('hex').slice(0, 16)
  const restricted = { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } }
  const health = { exec: { command: ['/opt/slatebox/bin/slatebox', 'health'] }, timeoutSeconds: 10 }
  const app = {
    name: 'slatebox',
    image,
    imagePullPolicy,
    ports: [{ name: 'http', containerPort: 7070 }],
    envFrom: [{ configMapRef: { name: n.config } }, { secretRef: { name: n.secret } }],
    volumeMounts: [{ name: 'data', mountPath: '/data' }, { name: 'run', mountPath: '/run/slatebox' }],
    startupProbe: { ...health, periodSeconds: 5, failureThreshold: 120 },
    readinessProbe: { ...health, periodSeconds: 10, failureThreshold: 3 },
    resources: { requests: { memory: answers.size.memory, cpu: answers.size.cpu }, limits: { memory: answers.size.memory } },
    securityContext: restricted,
  }
  const containers = [app]
  const volumes = [{ name: 'run', emptyDir: {} }]
  if (backups) {
    containers.push({
      name: 'backups',
      image,
      imagePullPolicy,
      command: ['/bin/bash', '/opt/slatebox-backup/backup-loop.sh'],
      env: [{ name: 'BACKUP_AT', value: backupAt(answers.backups.schedule) }, { name: 'BACKUP_KEEP', value: String(answers.backups.keep) }],
      volumeMounts: [
        { name: 'data', mountPath: '/data' }, { name: 'run', mountPath: '/run/slatebox' },
        { name: 'backups', mountPath: '/backups' }, { name: 'backup-script', mountPath: '/opt/slatebox-backup', readOnly: true },
      ],
      resources: { requests: { memory: '64Mi', cpu: '10m' }, limits: { memory: '1Gi' } },
      securityContext: restricted,
    })
    volumes.push({ name: 'backups', persistentVolumeClaim: { claimName: n.backups } })
    volumes.push({ name: 'backup-script', configMap: { name: n.script, defaultMode: 365 } })
  }
  objects.push({
    apiVersion: 'apps/v1', kind: 'StatefulSet', metadata: meta(answers, n.set),
    spec: {
      serviceName: n.service,
      replicas: 1,
      selector: { matchLabels: selector(answers) },
      template: {
        metadata: { labels: labels(answers), annotations: { 'slatebox.com/config-hash': configHash } },
        spec: {
          // Service links would add SLATEBOX_SERVICE_HOST and the like, which the
          // image refuses as unknown settings.
          enableServiceLinks: false,
          terminationGracePeriodSeconds: 60,
          securityContext: { runAsUser: 10001, runAsGroup: 10001, fsGroup: 10001, runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' } },
          containers,
          volumes,
        },
      },
      volumeClaimTemplates: [{
        metadata: { name: 'data', labels: labels(answers) },
        spec: {
          accessModes: ['ReadWriteOnce'],
          ...(answers.k8s.storageClass ? { storageClassName: answers.k8s.storageClass } : {}),
          resources: { requests: { storage: answers.size.storage } },
        },
      }],
    },
  })
  objects.push({
    apiVersion: 'v1', kind: 'Service', metadata: meta(answers, n.service),
    spec: { type: 'ClusterIP', selector: selector(answers), ports: [{ name: 'http', port: 7070, targetPort: 'http' }] },
  })
  const host = answers.address.url ? new URL(answers.address.url).hostname : null
  if (answers.k8s.route === 'ingress') {
    const annotations = {}
    if (answers.k8s.tlsIssuer) {
      annotations[answers.k8s.tlsIssuer.kind === 'Issuer' ? 'cert-manager.io/issuer' : 'cert-manager.io/cluster-issuer'] = answers.k8s.tlsIssuer.name
    }
    if (/nginx/.test(answers.k8s.ingressClass || '')) {
      // Live editing keeps one WebSocket open for as long as a slate is open.
      annotations['nginx.ingress.kubernetes.io/proxy-read-timeout'] = '3600'
      annotations['nginx.ingress.kubernetes.io/proxy-send-timeout'] = '3600'
      annotations['nginx.ingress.kubernetes.io/proxy-body-size'] = '50m'
    }
    objects.push({
      apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: meta(answers, answers.name, { annotations }),
      spec: {
        ...(answers.k8s.ingressClass ? { ingressClassName: answers.k8s.ingressClass } : {}),
        ...(answers.k8s.tlsIssuer ? { tls: [{ hosts: [host], secretName: n.tls }] } : {}),
        rules: [{ host, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: n.service, port: { number: 7070 } } } }] } }],
      },
    })
  } else if (answers.k8s.route === 'gateway') {
    const [namespace, name] = answers.k8s.gatewayRef.split('/')
    objects.push({
      apiVersion: 'gateway.networking.k8s.io/v1', kind: 'HTTPRoute', metadata: meta(answers, answers.name),
      spec: {
        parentRefs: [{ name, namespace }],
        hostnames: [host],
        rules: [{ matches: [{ path: { type: 'PathPrefix', value: '/' } }], backendRefs: [{ name: n.service, port: 7070 }] }],
      },
    })
  }
  objects.push({ apiVersion: 'v1', kind: 'ConfigMap', metadata: meta(answers, n.record), data: { 'install.yaml': record } })
  return objects
}

/** The Secret, with every secret value. Only ever sent to `kubectl apply -f -` on standard input. */
export function renderSecret(answers, values) {
  return {
    apiVersion: 'v1', kind: 'Secret', metadata: meta(answers, names(answers).secret), type: 'Opaque', stringData: { ...values },
  }
}
