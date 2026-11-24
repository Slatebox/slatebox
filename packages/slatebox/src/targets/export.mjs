// Export only: write the compose file, the Kubernetes manifests or a Helm
// chart for GitOps, with placeholders where secrets go. Nothing is applied and
// no host or cluster is contacted (the local Docker is asked for the image's
// digest and settings when it has the image).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { EXIT, InstallError } from '../errors.mjs'
import { DEFAULT_IMAGE, FALLBACK_CAPABILITIES, probeImage } from '../image.mjs'
import { emptyPlan } from '../plan.mjs'
import { renderCompose, SECRETS_FILE, SETTINGS_FILE } from '../render/compose.mjs'
import { renderHelmChart } from '../render/helm.mjs'
import { names, renderK8s, renderSecret } from '../render/k8s.mjs'
import { settingsFor } from '../render/settings.mjs'
import { envFileText } from '../secrets.mjs'
import { stringify, stringifyAll } from '../yaml.mjs'
import { clusterImage } from './k8s.mjs'

function placeholder(name, ref) {
  if (ref === 'generate') return '<32 random bytes in base64: openssl rand -base64 32; keep it with your backups>'
  return `<the value of ${ref}>`
}

export async function exportFiles(ctx, answers, { planOnly = false } = {}) {
  const dir = resolve(answers.export.dir)
  const warnings = []
  const image = await clusterImage(ctx, answers.image || DEFAULT_IMAGE)
  let caps = FALLBACK_CAPABILITIES
  if (image.local) {
    try { caps = await probeImage((args, o) => ctx.run('docker', args, o), image.id) } catch { warnings.push('The image did not list its settings; the current image\'s settings were assumed.') }
  } else {
    warnings.push(`${image.ref} is not on this computer, so the files assume the current image's settings and are not pinned to a digest.`)
  }
  const settings = settingsFor(answers, caps)
  const placeholders = Object.fromEntries(Object.entries(settings.secrets).map(([name, ref]) => [name, placeholder(name, ref)]))
  const files = {}
  if (answers.export.format === 'compose') {
    files['compose.yaml'] = renderCompose(answers, { image: image.pinned, hostGateway: settings.hostGateway, pullPolicy: null })
    files[SETTINGS_FILE] = envFileText(settings.env, 'Settings for Slatebox. No secrets.')
    files[`${SECRETS_FILE}.example`] = envFileText(placeholders, `Copy to ${SECRETS_FILE} (mode 0600) and fill in. Never commit the real file.`)
    files['README.md'] = `# Slatebox "${answers.name}"\n\n1. \`cp ${SECRETS_FILE}.example ${SECRETS_FILE} && chmod 600 ${SECRETS_FILE}\` and fill in each value.\n2. \`docker compose up -d --wait\`\n3. Open ${answers.address.url}\n\nBack up with \`docker exec ${answers.name} slatebox backup > slatebox-backup.gz\`, and keep SLATEBOX_KEY_ENCRYPTION_KEY with your backups: they do not contain it.\n`
  } else {
    const record = stringify({ ...answers, imageDigest: image.pinned, secretRefs: settings.secrets, state: 'exported' })
    const secret = renderSecret(answers, placeholders)
    if (answers.export.format === 'manifests') {
      files['slatebox.yaml'] = `# Slatebox "${answers.name}". Apply with: kubectl apply --server-side -f slatebox.yaml (after the Secret).\n${stringifyAll(renderK8s(answers, { image: image.pinned, env: settings.env, record }))}`
    } else {
      const version = ctx.version
      for (const [path, text] of Object.entries(renderHelmChart(answers, { image: image.pinned, env: settings.env, version, appVersion: image.pinned.split(/[@:]/).pop().slice(0, 19) }))) {
        files[join('slatebox', path)] = text
      }
    }
    files['secret.example.yaml'] = `# Fill in, then: kubectl apply -n ${answers.k8s.namespace} -f secret.yaml  (never commit the filled-in file)\n${stringify(secret)}`
    files['README.md'] = `# Slatebox "${answers.name}" on Kubernetes\n\n1. Copy secret.example.yaml to secret.yaml, fill in each value, apply it.\n2. ${answers.export.format === 'helm' ? `helm upgrade --install ${answers.name} ./slatebox -n ${answers.k8s.namespace} --create-namespace` : 'kubectl apply --server-side -f slatebox.yaml'}\n3. Open ${answers.address.url}${answers.k8s.route === 'none' ? ` after kubectl -n ${answers.k8s.namespace} port-forward svc/${names(answers).service} 7070:7070` : ''}\n`
  }
  const plan = emptyPlan({
    action: 'export', target: 'export', name: answers.name, where: dir, address: answers.address.url,
    image: { ref: image.ref, pinned: image.pinned }, files: Object.keys(files).map(path => ({ path: join(dir, path) })),
    warnings: [...warnings, ...settings.warnings], notes: settings.notes,
  })
  ctx.emitPlan(plan)
  if (planOnly) return { planned: true, plan }
  const clashes = Object.keys(files).filter(path => existsSync(join(dir, path)) && !ctx.yes)
  if (clashes.length && !ctx.interactive) {
    throw new InstallError(EXIT.NEEDS_INPUT, `${dir} already has ${clashes.join(', ')}. Run again with --yes to overwrite them.`, { needsConfirmation: true })
  }
  if (clashes.length) await ctx.confirm({ ...plan, action: 'export' })
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  return { address: answers.address.url, name: answers.name, target: 'export', format: answers.export.format, dir, files: Object.keys(files), imageDigest: image.pinned }
}
