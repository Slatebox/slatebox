// Kubernetes: render the objects in code, show the plan with the context it
// will touch, then `kubectl apply --server-side` on standard input. kubectl
// only; Helm is optional (export --format helm).
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { EXIT, InstallError } from '../errors.mjs'
import { collect, resolveAnswers } from '../answers.mjs'
import { checkArch, DEFAULT_IMAGE, FALLBACK_CAPABILITIES, hasRegistry, isPinnedImage, isTag, PINNED_CAPABILITIES, probeImage } from '../image.mjs'
import { emptyPlan } from '../plan.mjs'
import { installDir, recordText, writeRecord } from '../record.mjs'
import { MANAGER, names, renderK8s, renderSecret } from '../render/k8s.mjs'
import { settingsFor } from '../render/settings.mjs'
import { secretValues } from '../secret-values.mjs'
import { firstAdmin, makeSetupLink, setupState, stillWaiting } from '../setup-link.mjs'
import { checkTeamAddress, ensureTeamAddress, TUNNEL_TOKEN } from './address.mjs'
import { stringifyAll } from '../yaml.mjs'

const SLATEBOX = '/opt/slatebox/bin/slatebox'
const lastLine = text => text.trim().split('\n').filter(Boolean).pop() || ''
const PROD = /(^|[^a-z])(prod|production)([^a-z]|$)/i

export function kube(ctx, context) {
  return (args, options) => ctx.run('kubectl', ['--context', context, ...args], options)
}

/** Which context, and may the installer touch it? */
export async function chooseContext(ctx, answers, { explicit }) {
  let context = answers.k8s.context
  if (!context) {
    const current = await ctx.run('kubectl', ['config', 'current-context'])
    if (current.code === 127) throw new InstallError(EXIT.PRECONDITION, 'kubectl is not installed. Install it, or use --target export --format manifests to write the files only.')
    if (current.code !== 0 || !current.stdout.trim()) throw new InstallError(EXIT.PRECONDITION, 'There is no current kube context. Give one with --k8s-context <name>.')
    context = current.stdout.trim()
  }
  if (PROD.test(context) && !explicit) {
    throw new InstallError(EXIT.PRECONDITION, `The current kube context is "${context}". The installer does not apply to a production-looking context unless it is named: run again with --k8s-context ${context}.`, { field: 'k8s.context' })
  }
  return context
}

const RESOURCES = answers => [
  ['configmaps', ''], ['secrets', ''], ['services', ''], ['persistentvolumeclaims', ''], ['statefulsets', 'apps'],
  ...(answers.k8s.route === 'ingress' ? [['ingresses', 'networking.k8s.io']] : []),
  ...(answers.k8s.route === 'gateway' ? [['httproutes', 'gateway.networking.k8s.io']] : []),
]

async function preflight(ctx, k, answers, context) {
  const version = await k(['version', '-o', 'json'], { timeout: 30_000 })
  if (version.code !== 0) throw new InstallError(EXIT.PRECONDITION, `The cluster of context "${context}" does not answer: ${lastLine(version.stderr)}`)
  const ns = answers.k8s.namespace
  const nsExists = (await k(['get', 'namespace', ns, '-o', 'name'])).code === 0
  const checks = [
    ...(nsExists ? [] : [['create', 'namespaces', '']]),
    ...RESOURCES(answers).flatMap(([resource, group]) => [['create', resource, group], ['patch', resource, group]]),
    // Reading the Secret is how the key encryption key is kept: without it the installer would make a new one.
    ['get', 'secrets', ''], ['get', 'pods', ''], ['delete', 'pods', ''], ['create', 'pods/exec', ''],
  ]
  const denied = []
  for (const [verb, resource, group] of checks) {
    const result = await k(['auth', 'can-i', verb, group ? `${resource}.${group}` : resource, ...(resource === 'namespaces' ? [] : ['-n', ns])])
    if (result.stdout.trim() !== 'yes') denied.push(`${verb} ${group ? `${resource}.${group}` : resource}${resource === 'namespaces' ? '' : ` in ${ns}`}`)
  }
  if (denied.length) {
    throw new InstallError(EXIT.PRECONDITION, `Your access to "${context}" does not allow: ${denied.join('; ')}. Ask a cluster admin for these, or use --target export to hand them the manifests.`, { denied })
  }
  const notes = []
  if (answers.k8s.storageClass) {
    if ((await k(['get', 'storageclass', answers.k8s.storageClass, '-o', 'name'])).code !== 0) throw new InstallError(EXIT.PRECONDITION, `There is no StorageClass "${answers.k8s.storageClass}" in "${context}".`)
  } else {
    const classes = await k(['get', 'storageclass', '-o', 'json'])
    const items = classes.code === 0 ? JSON.parse(classes.stdout).items : []
    const preferred = items.find(item => item.metadata.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true')
    if (!preferred) throw new InstallError(EXIT.PRECONDITION, `"${context}" has no default StorageClass. Give one with --storage-class <name> (${items.map(item => item.metadata.name).join(', ') || 'none found'}).`)
    notes.push(`Volumes from the default StorageClass "${preferred.metadata.name}".`)
  }
  if (answers.k8s.tlsIssuer) {
    const { kind, name } = answers.k8s.tlsIssuer
    const args = kind === 'Issuer' ? ['get', 'issuers.cert-manager.io', name, '-n', ns] : ['get', 'clusterissuers.cert-manager.io', name]
    if ((await k([...args, '-o', 'name'])).code !== 0) throw new InstallError(EXIT.PRECONDITION, `cert-manager ${kind} "${name}" was not found in "${context}". Install cert-manager and the issuer first, or leave --tls-issuer out.`)
  }
  if (answers.k8s.route === 'gateway') {
    const [gns, gname] = answers.k8s.gatewayRef.split('/')
    if ((await k(['get', 'gateways.gateway.networking.k8s.io', gname, '-n', gns, '-o', 'name'])).code !== 0) throw new InstallError(EXIT.PRECONDITION, `Gateway ${answers.k8s.gatewayRef} was not found in "${context}".`)
  }
  if (answers.k8s.route === 'ingress' && answers.k8s.ingressClass) {
    if ((await k(['get', 'ingressclass', answers.k8s.ingressClass, '-o', 'name'])).code !== 0) throw new InstallError(EXIT.PRECONDITION, `IngressClass "${answers.k8s.ingressClass}" was not found in "${context}".`)
  }
  return { nsExists, notes }
}

/**
 * A registry reference the cluster can pull, pinned when this computer can tell
 * the digest. For an upgrade (refresh) a tag is fetched here first, because a
 * tag string that did not change says nothing about the bytes behind it; if
 * no digest can be found that way the upgrade is refused rather than called
 * "nothing to change".
 */
export async function clusterImage(ctx, ref, { refresh = false } = {}) {
  const wanted = ref || DEFAULT_IMAGE
  if (wanted.includes('@sha256:')) return { ref: wanted, pinned: wanted, local: false }
  let pullError = null
  if (refresh && isTag(wanted)) {
    const pulled = await ctx.run('docker', ['pull', wanted], { timeout: 60 * 60_000 })
    if (pulled.code !== 0) pullError = pulled.stderr.trim().split('\n').pop() || 'docker pull failed'
  }
  const inspected = await ctx.run('docker', ['image', 'inspect', '--format', '{{json .}}', wanted])
  const info = inspected.code === 0 ? JSON.parse(inspected.stdout) : null
  const repository = wanted.replace(/:[^/:]+$/, '')
  const digest = info && (info.RepoDigests || []).find(item => item.startsWith(`${repository}@`))
  if (refresh && isTag(wanted) && (pullError || !digest)) {
    throw new InstallError(EXIT.PRECONDITION, `Cannot tell which image ${wanted} is now${pullError ? ` (pulling it here failed: ${pullError})` : ' (no registry digest for it here)'}, so the upgrade would not know what it changes. Nothing was changed. Give the image by digest: slatebox upgrade --to ${repository}@sha256:<digest>.`)
  }
  if (info) return { ref: wanted, pinned: hasRegistry(wanted) && digest ? digest : wanted, local: true, id: info.Id, architecture: info.Architecture || null }
  return { ref: wanted, pinned: wanted, local: false }
}

async function checkNodeArch(k, image, context) {
  if (!image.architecture) return
  const nodes = await k(['get', 'nodes', '-o', 'jsonpath={.items[*].metadata.labels.kubernetes\\.io/arch}'])
  if (nodes.code !== 0 || !nodes.stdout.trim()) return // nodes may not be listable with namespace rights
  checkArch(image, nodes.stdout.trim().split(/\s+/), `the nodes of "${context}"`)
}

async function capabilities(ctx, image, warnings) {
  if (image.local) {
    try { return await probeImage((args, o) => ctx.run('docker', args, o), image.id || image.ref) } catch { /* fall through */ }
  }
  // This release's own image: what it accepts is known without pulling it here (the cluster pulls it).
  if (isPinnedImage(image.ref)) return PINNED_CAPABILITIES
  warnings.push(`The image was not on this computer, so its settings could not be read from it; the installer assumed the settings of the current image (pull ${image.ref} first to check).`)
  return FALLBACK_CAPABILITIES
}

/** The Secret's values; {} only when it does not exist. Any other failure stops the run: a guess would make a new key. */
async function existingSecret(k, answers) {
  const result = await k(['get', 'secret', names(answers).secret, '-n', answers.k8s.namespace, '-o', 'json'])
  if (result.code !== 0) {
    if (/NotFound|not found/.test(result.stderr)) return {}
    throw new InstallError(EXIT.PRECONDITION, `The Secret ${answers.k8s.namespace}/${names(answers).secret} could not be read: ${lastLine(result.stderr) || `kubectl exit ${result.code}`}. Nothing was changed: without it the installer cannot keep SLATEBOX_KEY_ENCRYPTION_KEY.`)
  }
  const data = JSON.parse(result.stdout).data || {}
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Buffer.from(value, 'base64').toString('utf8')]))
}

async function currentImage(k, answers) {
  const result = await k(['get', 'statefulset', names(answers).set, '-n', answers.k8s.namespace, '-o', 'jsonpath={.spec.template.spec.containers[0].image}'])
  return result.code === 0 ? result.stdout.trim() || null : null
}

async function rollout(ctx, k, answers) {
  const n = names(answers)
  const status = await k(['rollout', 'status', `statefulset/${n.set}`, '-n', answers.k8s.namespace, `--timeout=${ctx.healthTimeout}s`], { timeout: (ctx.healthTimeout + 60) * 1000 })
  if (status.code !== 0) return { ok: false, why: lastLine(status.stderr) || 'rollout did not finish' }
  const deep = await k(['exec', '-n', answers.k8s.namespace, n.pod, '-c', 'slatebox', '--', SLATEBOX, 'health', '--deep', '--wait', '60'], { timeout: 120_000 })
  if (deep.code !== 0) return { ok: false, why: lastLine(deep.stderr) || 'slatebox health failed' }
  if (answers.address.team) {
    for (let attempt = 0; attempt < (ctx.teamHealthAttempts ?? 30); attempt++) {
      try {
        const response = await ctx.fetch(`${answers.address.url}/readyz`, { signal: AbortSignal.timeout(8000) })
        if (response.ok) return { ok: true }
      } catch { /* retry */ }
      await new Promise(resolve => setTimeout(resolve, ctx.teamHealthDelay ?? 2000))
    }
    return { ok: true, warning: `Slatebox is healthy in the cluster, but ${answers.address.url} does not answer from here yet: the secure tunnel keeps trying by itself (kubectl logs ${n.pod} -c slatebox | grep tunnel).` }
  }
  if (answers.k8s.route !== 'none') {
    try {
      const response = await ctx.fetch(`${answers.address.url}/readyz`, { signal: AbortSignal.timeout(8000) })
      if (!response.ok) return { ok: true, warning: `${answers.address.url}/readyz answered HTTP ${response.status} from here; check the route and DNS.` }
    } catch (error) {
      return { ok: true, warning: `${answers.address.url} does not answer from here yet (${error.cause?.code || error.message}); check DNS and the ${answers.k8s.route}.` }
    }
  }
  return { ok: true }
}

const apply = (k, objects) => k(['apply', '--server-side', `--field-manager=${MANAGER}`, '-f', '-'], { input: stringifyAll(objects), timeout: 120_000 })

export async function applyK8s(ctx, answers, { record, planOnly = false, imageRef, explicitContext, refresh = false }) {
  const { out } = ctx
  if (ctx.flags['image-archive']) throw new InstallError(EXIT.USAGE, 'An image archive cannot be loaded into a cluster. Push the image to a registry the cluster can pull from and give --image <ref>.')
  const context = await chooseContext(ctx, answers, { explicit: explicitContext })
  answers.k8s.context = context
  const k = kube(ctx, context)
  out.step('preflight', 'start', `Checking kube context "${context}"`)
  const facts = await preflight(ctx, k, answers, context)
  out.step('preflight', 'ok', `Context "${context}", namespace ${answers.k8s.namespace}${facts.nsExists ? '' : ' (new)'}`)
  const team = answers.address.team ? await checkTeamAddress(ctx, answers) : null

  const warnings = []
  const image = await clusterImage(ctx, imageRef || answers.image, { refresh })
  await checkNodeArch(k, image, context)
  if (!image.pinned.includes('@sha256:')) warnings.push(`${image.pinned} is not pinned to a digest, so the cluster may pull different bytes later. Give --image <repo>@sha256:<digest> to pin it.`)
  const caps = await capabilities(ctx, image, warnings)
  const settings = settingsFor(answers, caps)
  const stored = await existingSecret(k, answers)
  const previous = await currentImage(k, answers)
  if (settings.secrets.SLATEBOX_KEY_ENCRYPTION_KEY === 'generate' && !stored.SLATEBOX_KEY_ENCRYPTION_KEY && !ctx.flags['new-encryption-key']) {
    const pvc = (await k(['get', 'pvc', `data-${names(answers).set}-0`, '-n', answers.k8s.namespace, '-o', 'name'])).code === 0
    if (previous || pvc) {
      throw new InstallError(EXIT.PRECONDITION, `Slatebox "${answers.name}" already has ${previous ? 'a StatefulSet' : 'a data volume'} in ${answers.k8s.namespace}, but its Secret ${names(answers).secret} holds no SLATEBOX_KEY_ENCRYPTION_KEY. A new key would make every AI and call key people saved unreadable. Nothing was changed. Put the Secret back from your backup, or add --new-encryption-key to start over with a new key.`, { needs: 'encryption-key' })
    }
  }
  // The Secret is part of the server-side diff, so a team address still to be claimed is claimed
  // (after its own yes) before the plan; a plan-only run shows a stand-in and claims nothing.
  let secretCtx = ctx
  if (team && !stored[TUNNEL_TOKEN]) {
    if (planOnly) secretCtx = { ...ctx, tunnelToken: 'pending-team-address-claim' }
    else {
      if (team.claim) {
        const claimPlan = emptyPlan({ action: 'claim', target: 'k8s', name: answers.name, where: 'Slatebox Cloud', address: answers.address.url,
          notes: [`You sign in to Slatebox in your browser to claim ${team.host}. Its tunnel token goes into the Secret ${names(answers).secret}; the install credential stays on this computer (mode 0600).`] })
        ctx.emitPlan(claimPlan)
        await ctx.confirm(claimPlan)
      }
      await ensureTeamAddress(ctx, answers, team, stored)
    }
  }
  const { values, generated } = await secretValues(secretCtx, settings.secrets, stored)
  const secretsHash = createHash('sha256').update(JSON.stringify(values)).digest('hex')
  const imageChanged = Boolean(previous && previous !== image.pinned)

  const n = names(answers)
  const nextRecord = {
    ...answers, image: image.ref, installedVersion: ctx.version, imageRef: image.ref, imageDigest: image.pinned,
    previousImageDigest: imageChanged ? previous : record?.previousImageDigest ?? null,
    secretRefs: settings.secrets, secretsLocation: `Secret ${answers.k8s.namespace}/${n.secret} in context ${context}`,
    installedAt: record?.installedAt || new Date().toISOString(), state: 'installed',
  }
  const objects = renderK8s(answers, { image: image.pinned, env: settings.env, secretsHash, record: recordText(nextRecord) })
  const secret = renderSecret(answers, values)

  // Server-side diff: the same answers applied twice change nothing.
  const all = [objects[0], secret, ...objects.slice(1)]
  const diff = previous ? await k(['diff', '--server-side', `--field-manager=${MANAGER}`, '-f', '-'], { input: stringifyAll(all), timeout: 120_000 }) : { code: 1 }
  const nothing = diff.code === 0 && (await k(['get', 'pod', n.pod, '-n', answers.k8s.namespace, '-o', 'jsonpath={.status.containerStatuses[?(@.name=="slatebox")].ready}'])).stdout.trim() === 'true'
  const plan = emptyPlan({
    action: nothing ? 'nothing' : previous ? (imageChanged ? 'upgrade' : 'change') : 'install', target: 'k8s', name: answers.name,
    where: `kube context "${context}", namespace ${answers.k8s.namespace}`, address: answers.address.url,
    image: { ref: image.ref, pinned: image.pinned, previous: previous || undefined },
    secretsLocation: nextRecord.secretsLocation, warnings: [...warnings, ...settings.warnings], notes: [...facts.notes, ...settings.notes],
    objects: [...objects.slice(0, 1), secret, ...objects.slice(1)].map(object => `${object.kind}/${object.metadata.name}`),
  })
  if (imageChanged) plan.commands.push(`back up first: kubectl exec ${n.pod} -c slatebox -- slatebox backup > ${join(installDir(ctx.home, answers.name), 'backups', 'pre-upgrade-….gz')}`)
  plan.commands.push(`kubectl --context ${context} apply --server-side --field-manager=${MANAGER} -f - (the objects above, on standard input)`,
    `kubectl rollout status statefulset/${n.set} -n ${answers.k8s.namespace}`, `kubectl exec ${n.pod} -c slatebox -- slatebox health --deep`)
  if (answers.k8s.route === 'none') plan.notes.push(`No route: reach it with kubectl --context ${context} -n ${answers.k8s.namespace} port-forward svc/${n.service} 7070:7070, then open http://localhost:7070.`)
  if (answers.k8s.route === 'gateway') plan.notes.push('TLS for the HTTPRoute is the Gateway listener\'s certificate; the installer does not change the Gateway.')
  ctx.emitPlan(plan)
  if (planOnly) return { planned: true, plan }
  if (nothing) {
    nextRecord.lastHealthy = new Date().toISOString()
    ctx.recordFile = writeRecord(ctx.home, nextRecord)
    await stillWaiting(ctx, args => k(['exec', '-n', answers.k8s.namespace, n.pod, '-c', 'slatebox', '--', SLATEBOX, ...args]))
    return {
      address: answers.address.url, name: answers.name, target: 'k8s', version: null, imageDigest: image.pinned,
      installRecord: ctx.recordFile, secretsFile: nextRecord.secretsLocation, nothingToChange: true, keyGenerated: false, fresh: false,
    }
  }
  await ctx.confirm(plan)

  let preUpgrade = null
  if (imageChanged) {
    preUpgrade = join(installDir(ctx.home, answers.name), 'backups', `pre-upgrade-${Date.now()}.gz`)
    mkdirSync(join(preUpgrade, '..'), { recursive: true, mode: 0o700 })
    out.step('backup', 'start', `Backing up before the upgrade to ${preUpgrade}`)
    const backup = await k(['exec', '-n', answers.k8s.namespace, n.pod, '-c', 'slatebox', '--', SLATEBOX, 'backup'], { outputFile: preUpgrade, timeout: 60 * 60_000 })
    if (backup.code !== 0) {
      rmSync(preUpgrade, { force: true })
      throw new InstallError(EXIT.PRECONDITION, `The backup before the upgrade failed, so nothing was changed: ${lastLine(backup.stderr)}`)
    }
  }
  const previousObjects = previous ? previousState(answers, record, { image: previous, caps, stored, nextRecord }) : null

  out.step('apply', 'start', `Applying ${objects.length + 1} objects to "${context}"`)
  const applied = await apply(k, all)
  if (applied.code !== 0) throw new InstallError(EXIT.PRECONDITION, `kubectl apply failed: ${lastLine(applied.stderr)}`)
  out.step('apply', 'ok', 'Applied')
  out.step('start', 'start', `Waiting until Slatebox is ready (up to ${ctx.healthTimeout}s)`)
  const result = await rollout(ctx, k, answers)
  if (!result.ok) {
    out.step('start', 'fail', `Slatebox did not become ready: ${result.why}`)
    const manual = [`kubectl --context ${context} -n ${answers.k8s.namespace} logs ${n.pod} -c slatebox`, `kubectl --context ${context} -n ${answers.k8s.namespace} describe pod ${n.pod}`]
    if (!previousObjects) {
      throw new InstallError(EXIT.ROLLED_BACK, `Slatebox did not become ready (${result.why}). The objects are kept for you to inspect.`, { commands: manual })
    }
    out.step('rollback', 'start', 'Putting the previous version back')
    await apply(k, previousObjects)
    // A StatefulSet does not replace a pod that never became ready; do it here.
    await k(['delete', 'pod', n.pod, '-n', answers.k8s.namespace, '--wait=false'])
    let back = await rollout(ctx, k, answers)
    if (back.ok && preUpgrade) {
      const restored = await k(['exec', '-i', '-n', answers.k8s.namespace, n.pod, '-c', 'slatebox', '--', SLATEBOX, 'restore'], { inputFile: preUpgrade, timeout: 60 * 60_000 })
      if (restored.code !== 0) back = { ok: false, why: lastLine(restored.stderr) }
    }
    if (!back.ok) {
      throw new InstallError(EXIT.ROLLBACK_FAILED, `The change failed (${result.why}) and putting the previous version back failed too (${back.why}). The volumes are untouched.`, {
        commands: [...manual, ...(preUpgrade ? [`kubectl --context ${context} -n ${answers.k8s.namespace} exec -i ${n.pod} -c slatebox -- slatebox restore < ${preUpgrade}`] : [])],
      })
    }
    throw new InstallError(EXIT.ROLLED_BACK, `The change failed (${result.why}), so the previous version was put back and is ready.`, { commands: manual })
  }
  if (result.warning) out.step('route', 'warn', result.warning)
  out.step('start', 'ok', `Slatebox is ready${answers.k8s.route === 'none' ? ' (port-forward to reach it)' : ` at ${answers.address.url}`}`)
  // The first admin comes from the image's one-time setup link; an image without one keeps the old advice.
  const linked = await firstAdmin(ctx, args => k(['exec', '-n', answers.k8s.namespace, n.pod, '-c', 'slatebox', '--', SLATEBOX, ...args]))
  if (!linked && !previous) {
    out.say(`\n${answers.adminEmail ? `Open ${answers.address.url} and create the first account with ${answers.adminEmail}.` : `Open ${answers.address.url} and create the first account.`}`)
  }
  nextRecord.lastHealthy = new Date().toISOString()
  ctx.recordFile = writeRecord(ctx.home, nextRecord)
  ctx.record = nextRecord
  return {
    address: answers.address.url, name: answers.name, target: 'k8s', version: null, imageDigest: image.pinned,
    installRecord: `${ctx.recordFile} (and ConfigMap ${answers.k8s.namespace}/${n.record})`, secretsFile: nextRecord.secretsLocation,
    keyGenerated: generated.includes('SLATEBOX_KEY_ENCRYPTION_KEY'), fresh: !previous,
  }
}

/**
 * What was running before this change: the previous answers (from the install
 * record) with the previous Secret's values and image, so a rollback puts the
 * settings and keys back too, not only the image.
 */
const withoutHealthy = ({ lastHealthy, ...rest }) => rest

function previousState(answers, record, { image, caps, stored, nextRecord }) {
  let before = answers
  if (record) {
    const resolved = resolveAnswers(collect({ record }), {})
    if (!resolved.errors.length) before = { ...resolved.answers, k8s: { ...resolved.answers.k8s, context: answers.k8s.context } }
  }
  const settings = settingsFor(before, caps)
  const values = Object.fromEntries(Object.keys(settings.secrets).filter(name => name in stored).map(name => [name, stored[name]]))
  const secretsHash = createHash('sha256').update(JSON.stringify(values)).digest('hex')
  const objects = renderK8s(before, { image, env: settings.env, secretsHash, record: recordText(record ? withoutHealthy(record) : { ...nextRecord, imageDigest: image }) })
  return [objects[0], renderSecret(before, values), ...objects.slice(1)]
}

export async function statusK8s(ctx, record) {
  const k = kube(ctx, record.k8s.context)
  const n = names(record)
  const pod = await k(['get', 'pod', n.pod, '-n', record.k8s.namespace, '-o', 'json'])
  const info = pod.code === 0 ? JSON.parse(pod.stdout) : null
  const ready = info?.status?.containerStatuses?.find(item => item.name === 'slatebox')?.ready
  const version = ready ? await k(['exec', '-n', record.k8s.namespace, n.pod, '-c', 'slatebox', '--', SLATEBOX, 'version']) : null
  const backups = ready && record.backups.to !== 'off' ? await k(['exec', '-n', record.k8s.namespace, n.pod, '-c', 'backups', '--', 'sh', '-c', 'ls -1t /backups | head -1']) : null
  const setup = ready ? await setupState(args => k(['exec', '-n', record.k8s.namespace, n.pod, '-c', 'slatebox', '--', SLATEBOX, ...args])) : null
  return {
    name: record.name, target: 'k8s', where: `context ${record.k8s.context}, namespace ${record.k8s.namespace}`, address: record.address.url,
    running: Boolean(info), health: ready ? 'healthy' : info ? info.status.phase : 'missing',
    version: version?.code === 0 ? JSON.parse(version.stdout) : null, imageDigest: record.imageDigest,
    ai: record.ai.mode === 'none' ? 'off' : record.ai.providers.map(provider => provider.id).join(', '),
    sso: record.sso.enabled ? 'on' : 'off', lastBackup: backups?.stdout.trim() || null,
    setup: setup ? (setup.setUp ? 'done' : 'waiting for the first admin') : null,
  }
}

export async function backupK8s(ctx, record, { to }) {
  const k = kube(ctx, record.k8s.context)
  const n = names(record)
  const dir = to ? (to.startsWith('/') ? to : join(process.cwd(), to)) : join(installDir(ctx.home, record.name), 'backups')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, `slatebox-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')}.gz`)
  const result = await k(['exec', '-n', record.k8s.namespace, n.pod, '-c', 'slatebox', '--', SLATEBOX, 'backup'], { outputFile: file, timeout: 60 * 60_000 })
  if (result.code !== 0) { rmSync(file, { force: true }); throw new InstallError(EXIT.PRECONDITION, `The backup failed: ${lastLine(result.stderr)}`) }
  return { file, where: 'this computer' }
}

export async function restoreK8s(ctx, record, archive) {
  const k = kube(ctx, record.k8s.context)
  const result = await k(['exec', '-i', '-n', record.k8s.namespace, names(record).pod, '-c', 'slatebox', '--', SLATEBOX, 'restore'], { inputFile: archive, timeout: 60 * 60_000 })
  if (result.code !== 0) throw new InstallError(EXIT.PRECONDITION, `The restore failed: ${lastLine(result.stderr)}`)
  return { restored: archive }
}

export async function uninstallK8s(ctx, record, { deleteData }) {
  const k = kube(ctx, record.k8s.context)
  const ns = record.k8s.namespace
  const n = names(record)
  const selector = `slatebox.com/install=${record.name}`
  const kinds = ['statefulset', 'service', 'ingress.networking.k8s.io', 'configmap', ...(record.k8s.route === 'gateway' ? ['httproutes.gateway.networking.k8s.io'] : [])]
  for (const kind of kinds) await k(['delete', kind, '-n', ns, '-l', selector, '--ignore-not-found'])
  if (deleteData) {
    await k(['delete', 'pvc,secret', '-n', ns, '-l', selector, '--ignore-not-found'])
    await k(['delete', 'pvc', `data-${n.set}-0`, '-n', ns, '--ignore-not-found'])
    return { dataDeleted: true }
  }
  return { dataDeleted: false, volume: `PersistentVolumeClaims data-${n.set}-0 and ${n.backups} in ${ns}`, secretsFile: `Secret ${ns}/${n.secret}` }
}

export function execNodeK8s(ctx, record, script, args = []) {
  const k = kube(ctx, record.k8s.context)
  return k(['exec', '-i', '-n', record.k8s.namespace, names(record).pod, '-c', 'slatebox', '--', 'node', '--input-type=module', '-', ...args], { input: script, timeout: 120_000 })
}

/** A fresh one-time setup link from the install's pod (setup-link.mjs makeSetupLink). */
export function setupLinkK8s(ctx, record) {
  const k = kube(ctx, record.k8s.context)
  return makeSetupLink(ctx, args => k(['exec', '-n', record.k8s.namespace, names(record).pod, '-c', 'slatebox', '--', SLATEBOX, ...args]))
}

export async function readSecretK8s(ctx, record, name) {
  const k = kube(ctx, record.k8s.context)
  return (await existingSecret(k, record))[name]
}
