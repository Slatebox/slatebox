// The questions a person is asked, in order, for whatever the flags, the
// answers file and an earlier install did not already say. Each answer lands
// in the same fields an answers file uses.
import { AI_CHOICES, QUESTIONS, SIZES } from './answers.mjs'
import { PRESETS } from './ai/settings-adapter.mjs'
import { looksLikeKey } from './secrets.mjs'

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const CLOUD = ['openai', 'anthropic', 'deepinfra', 'openrouter', 'groq', 'together', 'mistral']

async function listModels(ctx, baseUrl) {
  try {
    const response = await ctx.fetch(`${baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) return []
    return ((await response.json()).data || []).map(model => model.id).filter(Boolean).slice(0, 20)
  } catch { return [] }
}

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/
// Never repeat what was typed: it may be the key.
const KEY_TYPED = 'That looks like a key, not a variable name. It was not saved or shown. Type the NAME of the variable that holds it, like GROQ_API_KEY.'
const variableName = optional => v => (looksLikeKey(v) ? KEY_TYPED : VARIABLE.test(v) ? null : `A variable name, like OPENAI_API_KEY${optional ? ', or Enter for none' : ''}`)

async function keyRef(p, label) {
  // Two steps, so that nobody pastes a key where a name is asked for.
  const how = await p.choose(`How will you give the ${label} key?`, [
    { value: 'env', label: 'It is in an environment variable (I will give its name)' },
    { value: 'prompt', label: 'Type it now, hidden; it goes only into the secrets file' },
  ], { default: 'env' })
  if (how === 'prompt') return 'prompt'
  const name = await p.text(`Name of the environment variable that holds the ${label} key`, { validate: variableName(false) })
  return `env:${name}`
}

async function provider(ctx, p, kind, ids) {
  const preset = PRESETS[kind]
  let id = kind
  for (let n = 2; ids.includes(id); n++) id = `${kind}-${n}`
  if (preset.kind === 'deepinfra') return { id, kind: 'deepinfra', keyFrom: await keyRef(p, 'DeepInfra') }
  if (kind === 'openai-compatible') {
    const baseUrl = await p.text('Endpoint URL (OpenAI-compatible)', { default: 'http://localhost:11434/v1', validate: v => { try { new URL(v); return null } catch { return 'A URL, like http://ollama:11434/v1' } } })
    const models = await listModels(ctx, baseUrl)
    const model = models.length
      ? await p.choose(`Model at ${baseUrl}`, models.map(value => ({ value, label: value })), { default: models[0] })
      : await p.text('Model name the endpoint serves (for example qwen3:8b)')
    const token = await p.text('Name of the environment variable that holds its token (Enter if it needs none)', { optional: true, validate: variableName(true) })
    return { id: ids.includes('local') ? `local-${ids.length + 1}` : 'local', kind: 'openai-compatible', baseUrl, model, keyFrom: token ? `env:${token}` : 'none' }
  }
  const model = await p.text(`${kind} model to use`)
  return { id, kind, model, keyFrom: await keyRef(p, kind) }
}

/**
 * @param {object} ctx run context (prompt, fetch, freePort, currentContext)
 * @param {object} partial collected answers
 * @returns {Promise<object>} partial with the person's answers added
 */
export async function interview(ctx, partial) {
  const p = ctx.prompt
  const a = structuredClone(partial)
  const has = (object, key) => object && object[key] !== undefined && object[key] !== null
  ctx.stderr.write('\nSlatebox installer. Enter accepts the default in brackets; Ctrl-C stops without changing anything.\n\n')

  if (!has(a, 'target')) {
    const choices = QUESTIONS.target.choices.map(choice => choice.value === 'k8s' && ctx.currentContext ? { ...choice, label: `Kubernetes (current context: ${ctx.currentContext})` } : choice)
    a.target = await p.choose(QUESTIONS.target.question, choices, { default: 'local' })
  }
  if (a.target === 'ssh') {
    a.ssh ||= {}
    if (!has(a.ssh, 'host')) {
      const spec = await p.text(QUESTIONS['ssh.host'].question)
      const at = spec.indexOf('@')
      if (at > 0) { a.ssh.user = spec.slice(0, at); a.ssh.host = spec.slice(at + 1) } else a.ssh.host = spec
    }
  }
  if (a.target === 'export') {
    a.export ||= {}
    if (!has(a.export, 'format')) a.export.format = await p.choose('Which files?', [
      { value: 'compose', label: 'Docker Compose file' }, { value: 'manifests', label: 'Kubernetes manifests' }, { value: 'helm', label: 'Helm chart' },
    ], { default: 'compose' })
    if (!has(a.export, 'dir')) a.export.dir = await p.text('Write them to', { default: './slatebox-deploy' })
  }
  const kube = a.target === 'k8s' || ['manifests', 'helm'].includes(a.export?.format)

  // Address
  a.address ||= {}
  if (!has(a.address, 'url') && !has(a.address, 'domain')) {
    if (a.target === 'local' && !has(a.address, 'port')) {
      const port = await p.text('Port on this computer', { default: String(ctx.freePort), validate: v => (/^\d+$/.test(v) && Number(v) < 65536 ? null : 'A port number') })
      a.address.port = Number(port)
    } else if (a.target === 'ssh' || (a.target === 'export' && !kube)) {
      const domain = await p.text(`Domain name for HTTPS, pointed at the server (Enter for plain http://${a.ssh?.host || '<server>'}:7070)`, { optional: true })
      if (domain) a.address.domain = domain
    } else if (kube) {
      a.k8s ||= {}
      if (!has(a.k8s, 'route')) a.k8s.route = await p.choose('How does traffic reach it?', [
        { value: 'ingress', label: 'An Ingress (ingress-nginx, Traefik, ...)' }, { value: 'gateway', label: 'Gateway API (an HTTPRoute on an existing Gateway)' },
        { value: 'none', label: 'Nothing for now (kubectl port-forward)' },
      ], { default: 'ingress' })
      if (a.k8s.route !== 'none') {
        a.address.domain = await p.text('Host name people will use (for example boards.example.com)')
        if (a.k8s.route === 'ingress' && !has(a.k8s, 'ingressClass')) a.k8s.ingressClass = (await p.text('IngressClass', { optional: true })) || null
        if (a.k8s.route === 'gateway' && !has(a.k8s, 'gatewayRef')) a.k8s.gatewayRef = await p.text('Gateway, as namespace/name')
        if (!has(a.k8s, 'tlsIssuer')) {
          const issuer = await p.text('cert-manager issuer for TLS, as ClusterIssuer/name or Issuer/name', { optional: true })
          if (issuer) { const [kind, name] = issuer.includes('/') ? issuer.split('/') : ['ClusterIssuer', issuer]; a.k8s.tlsIssuer = { kind, name } }
        }
      }
    }
  }

  if (!has(a, 'adminEmail')) {
    const optional = a.target === 'local' || a.target === 'export'
    const email = await p.text(QUESTIONS.adminEmail.question, { optional, validate: v => (EMAIL.test(v) ? null : 'An email address') })
    if (email) a.adminEmail = email
  }

  // AI: nothing is pre-selected.
  a.ai ||= {}
  if (!has(a.ai, 'mode')) {
    const choice = await p.choose(QUESTIONS['ai.mode'].question, AI_CHOICES)
    if (choice === 'none') a.ai = { mode: 'none' }
    else {
      const providers = []
      if (choice === 'cloud' || choice === 'both') {
        do {
          const kind = await p.choose('Which provider?', CLOUD.map(value => ({ value, label: value })))
          providers.push(await provider(ctx, p, kind, providers.map(item => item.id)))
        } while (await p.confirm('Add another cloud provider?', { default: false }))
      }
      if (choice === 'endpoint' || choice === 'both') providers.push(await provider(ctx, p, 'openai-compatible', providers.map(item => item.id)))
      a.ai = { mode: 'providers', providers }
      if (providers.length > 1) a.ai.default = await p.choose('Which one is the default?', providers.map(item => ({ value: item.id, label: `${item.id} (${item.model || item.kind})` })))
    }
  }

  a.sso ||= {}
  if (!has(a.sso, 'enabled')) {
    a.sso.enabled = await p.confirm('Single sign-on (bundled Keycloak: Entra ID, Okta, Google Workspace, SAML, LDAP)?', { default: false })
    if (a.sso.enabled) {
      a.sso.only = await p.confirm('Single sign-on only (no passwords, no guests)?', { default: false })
      a.sso.adminConsole = (await p.confirm('Close Keycloak\'s admin console on the public address?', { default: false })) ? 'closed' : 'open'
    }
  }

  a.backups ||= {}
  if (!has(a.backups, 'to')) {
    const where = await p.choose('Backups', kube
      ? [{ value: 'default', label: 'Daily at 03:00 UTC to a volume in the namespace, keep 14' }, { value: 'off', label: 'Off' }]
      : [{ value: 'default', label: 'Daily at 03:00, keep 14, next to the install' }, { value: 'dir', label: 'Daily to another folder' }, { value: 's3', label: 'Daily to S3 (needs the aws command on the host)' }, { value: 'off', label: 'Off' }],
    { default: 'default' })
    a.backups.to = where === 'dir' ? await p.text('Folder') : where === 's3' ? await p.text('S3 URL (s3://bucket/prefix)') : where
  }

  if (!has(a, 'size')) {
    a.size = await p.choose('Size', Object.entries(SIZES).map(([value, size]) => ({ value, label: `${value}: ${size.memory} memory, ${size.cpu} CPU, ${size.storage} storage${a.sso?.enabled ? ' (+0.5 GB for SSO)' : ''}` })), { default: 'small' })
  }

  a.mail ||= {}
  if (!has(a.mail, 'urlFrom')) {
    const name = await p.text('Mail: name of the environment variable that holds your SMTP URL (smtp://user:pass@host:587)', { optional: true, validate: v => variableName(true)(v.replace(/^env:/, '')) })
    if (name) {
      a.mail.urlFrom = `env:${name.replace(/^env:/, '')}`
      a.mail.from = (await p.text('Send mail from (for example Slatebox <boards@example.com>)', { optional: true })) || null
    } else {
      ctx.stderr.write(`  Without mail, someone who forgets a password gets a one-time link from you: docker exec ${a.name || 'slatebox'} slatebox password-link <email>\n`)
    }
  }
  return a
}
