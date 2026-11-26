// The questions a person is asked, in order, for whatever the flags, the
// answers file and an earlier install did not already say. Each answer lands
// in the same fields an answers file uses.
import { AI_CHOICES, QUESTIONS, SIZES } from './answers.mjs'
import { PRESETS } from './ai/settings-adapter.mjs'
import { looksLikeKey } from './secrets.mjs'
import { teamAddressProblem, teamHost } from './cloud.mjs'
import { availability } from './targets/address.mjs'

/** Ask for a team address until one is free. Taken, reserved and blocked names get the same answer. */
export async function askTeamAddress(ctx, p) {
  if (p.rich) return askTeamAddressRich(ctx, p)
  for (;;) {
    const name = (await p.text('Team address', { validate: v => teamAddressProblem(v.toLowerCase()) })).toLowerCase()
    const answer = await availability(ctx, name)
    if (answer.available) {
      ctx.stderr.write(`[ok] ${teamHost(name)} is available\n`)
      return name
    }
    ctx.stderr.write(`[!!] ${teamHost(name)} isn't available.${answer.suggestions.length ? `\n     Free right now: ${answer.suggestions.join(', ')}` : ''}\n`)
  }
}

// The wizard: characters are checked as they are typed, availability once on Enter, and a name that
// is not free offers the free ones to pick (same wording as the plain prompt).
async function askTeamAddressRich(ctx, p) {
  // Names are lowercase: the folded answer, the check and the plan all show the same name.
  const ask = () => p.text('Team address', { label: 'Team address', suffix: '.slatebox.team', normalize: v => v.toLowerCase(), validate: v => teamAddressProblem(v) })
  let name = await ask()
  for (;;) {
    name = name.toLowerCase()
    const checking = p.task(`Checking ${teamHost(name)}…`)
    let answer
    try { answer = await availability(ctx, name) } catch (error) { checking.clear(); throw error }
    if (answer.available) {
      checking.ok(`${teamHost(name)} is available`)
      ctx.addressShown = name
      return name
    }
    checking.warn(`${teamHost(name)} isn't available.${answer.suggestions.length ? ' Free right now:' : ''}`)
    if (answer.suggestions.length) {
      const pick = await p.choose('Pick a free address', [
        ...answer.suggestions.map(value => ({ value, label: teamHost(value) })),
        { value: '', label: 'Type another…' },
      ], { label: 'Team address' })
      if (pick) { name = pick; continue }
    }
    name = await ask()
  }
}

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
  ], { default: 'env', label: `${label} key` })
  if (how === 'prompt') return 'prompt'
  const name = await p.text(`Name of the environment variable that holds the ${label} key`, { validate: variableName(false), label: 'Key variable' })
  return `env:${name}`
}

async function provider(ctx, p, kind, ids) {
  const preset = PRESETS[kind]
  let id = kind
  for (let n = 2; ids.includes(id); n++) id = `${kind}-${n}`
  if (preset.kind === 'deepinfra') return { id, kind: 'deepinfra', keyFrom: await keyRef(p, 'DeepInfra') }
  if (kind === 'openai-compatible') {
    const baseUrl = await p.text('Endpoint URL (OpenAI-compatible)', { label: 'Endpoint', default: 'http://localhost:11434/v1', validate: v => { try { new URL(v); return null } catch { return 'A URL, like http://ollama:11434/v1' } } })
    const models = await listModels(ctx, baseUrl)
    const model = models.length
      ? await p.choose(`Model at ${baseUrl}`, models.map(value => ({ value, label: value })), { default: models[0], label: 'Model' })
      : await p.text('Model name the endpoint serves (for example qwen3:8b)', { label: 'Model' })
    const token = await p.text('Name of the environment variable that holds its token (Enter if it needs none)', { optional: true, validate: variableName(true), label: 'Token variable' })
    return { id: ids.includes('local') ? `local-${ids.length + 1}` : 'local', kind: 'openai-compatible', baseUrl, model, keyFrom: token ? `env:${token}` : 'none' }
  }
  const model = await p.text(`${kind} model to use`, { label: 'Model' })
  return { id, kind, model, keyFrom: await keyRef(p, kind) }
}

const AGENT_TITLES = {
  none: { title: 'None for now', hint: 'add one later: slatebox ai add' },
  cloud: { title: 'A cloud provider key', hint: 'OpenAI, Anthropic, DeepInfra, OpenRouter, Groq, Together, Mistral' },
  endpoint: { title: 'An endpoint I run', hint: 'Ollama, vLLM, LM Studio or any OpenAI-compatible URL' },
  both: { title: 'Both' },
}

/** The "Where" choices in the wizard, from what the machine check found. */
function whereChoices(ctx, choices, machine) {
  const windows = machine?.why === 'windows'
  const dockerOk = machine ? machine.ok : true
  const needs = { docker: machine?.docker === 'missing' ? 'needs Docker installed' : 'needs Docker running', processor: 'needs an amd64 or arm64 processor', disk: 'needs 5 GB free' }[machine?.why] || 'needs Docker running'
  const facts = machine?.facts
  const extra = {
    local: windows ? { title: 'This computer', hint: 'needs WSL 2', disabled: true }
      : dockerOk ? { title: 'This computer', hint: facts ? `Docker ${facts.docker}${facts.runtime ? ` (${facts.runtime})` : ''}` : 'with Docker', recommended: true }
        : { title: 'This computer', hint: needs, disabled: true },
    ssh: windows ? { title: 'A Linux server over SSH', hint: 'needs WSL 2', disabled: true } : { title: 'A Linux server over SSH', hint: 'installs Docker there if it is missing', recommended: !dockerOk },
    k8s: { title: 'Kubernetes', hint: ctx.currentContext ? `current context: ${ctx.currentContext}` : 'no context found' },
    export: { title: 'Just write the files', hint: 'a Compose file, Kubernetes manifests or a Helm chart, for GitOps' },
  }
  return choices.map(choice => ({ ...choice, ...extra[choice.value] }))
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
  const rich = Boolean(p.rich)
  if (!rich) ctx.stderr.write('\nSlatebox installer. Enter accepts the default in brackets; Ctrl-C stops without changing anything.\n\n')
  else if (!ctx.introShown) { p.intro(); ctx.introShown = true }

  if (!has(a, 'target')) {
    // The wizard checks this computer first (read-only), so "Where" can say what works here.
    let machine = rich && ctx.machineCheck ? await ctx.machineCheck() : null
    p.section?.('Where', 1, 6)
    for (;;) {
      const choices = QUESTIONS.target.choices.map(choice => choice.value === 'k8s' && ctx.currentContext ? { ...choice, label: `Kubernetes (current context: ${ctx.currentContext})` } : choice)
      a.target = await p.choose(QUESTIONS.target.question, rich ? whereChoices(ctx, choices, machine) : choices, { default: 'local', ...(rich ? { label: 'Where', keys: { r: 'recheck' }, help: machine && !machine.ok ? 'r checks this computer again' : undefined } : {}) })
      if (a.target !== 'recheck') break
      machine = await ctx.machineCheck()
    }
    ctx.machineShown = Boolean(machine?.ok) && a.target === 'local'
  }
  if (a.target === 'ssh') {
    a.ssh ||= {}
    if (!has(a.ssh, 'host')) {
      const spec = await p.text(QUESTIONS['ssh.host'].question, rich ? { label: 'Server', title: 'Server, as user@host', hint: 'ssh user@host must work without a password' } : undefined)
      const at = spec.indexOf('@')
      if (at > 0) { a.ssh.user = spec.slice(0, at); a.ssh.host = spec.slice(at + 1) } else a.ssh.host = spec
    }
  }
  // Check what the chosen target needs now, before the rest of the questions (preflightTarget).
  if (ctx.preflight) {
    if (rich && a.target === 'ssh') await p.during('Connecting over SSH…', () => ctx.preflight(a))
    else if (rich && a.target === 'k8s') await p.during('Checking the cluster…', () => ctx.preflight(a))
    else await ctx.preflight(a)
  }
  if (a.target === 'export') {
    a.export ||= {}
    if (!has(a.export, 'format')) a.export.format = await p.choose('Which files?', [
      { value: 'compose', label: 'Docker Compose file' }, { value: 'manifests', label: 'Kubernetes manifests' }, { value: 'helm', label: 'Helm chart' },
    ], { default: 'compose', label: 'Files' })
    if (!has(a.export, 'dir')) a.export.dir = await p.text('Write them to', { default: './slatebox-deploy', label: 'Folder' })
  }
  const kube = a.target === 'k8s' || ['manifests', 'helm'].includes(a.export?.format)

  // Address
  p.section?.('Address', 2, 6)
  a.address ||= {}
  if (!has(a.address, 'url') && !has(a.address, 'domain') && a.address.team === undefined && !has(a.address, 'port') && (a.target === 'local' || a.target === 'ssh')) {
    const where = await p.choose('Where should your team open Slatebox?', [
      { value: 'team', label: 'A free team address, https://<name>.slatebox.team  (recommended: no DNS, ports or certificates)', title: 'A free team address', hint: '<name>.slatebox.team · no DNS, ports or certificates', recommended: true },
      { value: 'domain', label: 'My own domain (I point DNS at this server, or I run a proxy)', title: 'My own domain', hint: a.target === 'local' ? 'you point DNS at this computer, or run a proxy' : 'you point DNS at this server, or run a proxy' },
      { value: 'local', label: a.target === 'local' ? `Only this computer, http://localhost:${ctx.freePort}` : `Plain http://${a.ssh?.host || '<server>'}:7070, no HTTPS`, title: a.target === 'local' ? 'Only this computer' : 'Plain HTTP', hint: a.target === 'local' ? `http://localhost:${ctx.freePort}` : `http://${a.ssh?.host || '<server>'}:7070, no HTTPS` },
    ], { default: 'team', label: 'Address' })
    if (where === 'team') a.address.team = await askTeamAddress(ctx, p)
    else if (where === 'domain') a.address.domain = await p.text('Domain name, pointed at this server (for example boards.example.com)', rich ? { label: 'Domain' } : undefined)
    else {
      a.address.team = null
      if (a.target === 'local') a.address.port = ctx.freePort
      else a.address.port = 7070
    }
  }
  if (!has(a.address, 'url') && !has(a.address, 'domain') && !a.address.team && !(a.address.team === null && has(a.address, 'port'))) {
    if (a.target === 'local' && !has(a.address, 'port')) {
      const port = await p.text('Port on this computer', { label: 'Port', default: String(ctx.freePort), validate: v => (/^\d+$/.test(v) && Number(v) < 65536 ? null : 'A port number') })
      a.address.port = Number(port)
    } else if (a.target === 'ssh' || (a.target === 'export' && !kube)) {
      const domain = await p.text(`Domain name for HTTPS, pointed at the server (Enter for plain http://${a.ssh?.host || '<server>'}:7070)`, { optional: true, label: 'Domain' })
      if (domain) a.address.domain = domain
    } else if (kube) {
      a.k8s ||= {}
      if (!has(a.k8s, 'route')) a.k8s.route = await p.choose('How does traffic reach it?', [
        { value: 'ingress', label: 'An Ingress (ingress-nginx, Traefik, ...)' }, { value: 'gateway', label: 'Gateway API (an HTTPRoute on an existing Gateway)' },
        { value: 'none', label: 'Nothing for now (kubectl port-forward)' },
      ], { default: 'ingress', label: 'Traffic' })
      if (a.k8s.route !== 'none') {
        a.address.domain = await p.text('Host name people will use (for example boards.example.com)', { label: 'Host name' })
        if (a.k8s.route === 'ingress' && !has(a.k8s, 'ingressClass')) a.k8s.ingressClass = (await p.text('IngressClass', { optional: true, label: 'IngressClass' })) || null
        if (a.k8s.route === 'gateway' && !has(a.k8s, 'gatewayRef')) a.k8s.gatewayRef = await p.text('Gateway, as namespace/name', { label: 'Gateway' })
        if (!has(a.k8s, 'tlsIssuer')) {
          const issuer = await p.text('cert-manager issuer for TLS, as ClusterIssuer/name or Issuer/name', { optional: true, label: 'TLS issuer' })
          if (issuer) { const [kind, name] = issuer.includes('/') ? issuer.split('/') : ['ClusterIssuer', issuer]; a.k8s.tlsIssuer = { kind, name } }
        }
      }
    }
  }

  if (!has(a, 'adminEmail')) {
    const optional = a.target === 'local' || a.target === 'export'
    p.section?.('Admin', 3, 6)
    const email = await p.text(QUESTIONS.adminEmail.question, rich
      ? { optional, label: 'Admin email', title: 'Admin email', hint: optional ? '(for HTTPS certificate notices; Enter skips)' : '(for HTTPS certificate notices)', validate: v => (EMAIL.test(v) ? null : 'An email address, like you@example.com') }
      : { optional, validate: v => (EMAIL.test(v) ? null : 'An email address') })
    if (email) a.adminEmail = email
  }

  // AI: nothing is pre-selected.
  a.ai ||= {}
  if (!has(a.ai, 'mode')) {
    p.section?.('Agents', 4, 6)
    const choice = await p.choose(QUESTIONS['ai.mode'].question, rich ? AI_CHOICES.map(choice => ({ ...choice, ...AGENT_TITLES[choice.value] })) : AI_CHOICES, rich
      ? { label: 'Agents', title: 'Agents for drafts and the canvas assistant. You pick the provider; none is chosen for you.', initial: 'none' }
      : undefined)
    if (choice === 'none') a.ai = { mode: 'none' }
    else {
      const providers = []
      if (choice === 'cloud' || choice === 'both') {
        do {
          const kind = await p.choose('Which provider?', CLOUD.map(value => ({ value, label: value })), rich ? { label: 'Provider' } : undefined)
          providers.push(await provider(ctx, p, kind, providers.map(item => item.id)))
        } while (await p.confirm('Add another cloud provider?', { default: false, label: 'Another provider' }))
      }
      if (choice === 'endpoint' || choice === 'both') providers.push(await provider(ctx, p, 'openai-compatible', providers.map(item => item.id)))
      a.ai = { mode: 'providers', providers }
      if (providers.length > 1) a.ai.default = await p.choose('Which one is the default?', providers.map(item => ({ value: item.id, label: `${item.id} (${item.model || item.kind})` })), { label: 'Default provider' })
    }
  }

  a.sso ||= {}
  if (!has(a.sso, 'enabled')) {
    p.section?.('Sign-in', 5, 6)
    a.sso.enabled = await p.confirm('Single sign-on (bundled Keycloak: Entra ID, Okta, Google Workspace, SAML, LDAP)?', rich
      ? { default: false, label: 'Single sign-on', title: 'Single sign-on with the bundled Keycloak?', help: 'Entra ID, Okta, Google Workspace, SAML or LDAP. Off until you turn it on.', yes: 'On', no: 'Off', order: 'no-first' }
      : { default: false })
    if (a.sso.enabled) {
      a.sso.only = await p.confirm('Single sign-on only (no passwords, no guests)?', { default: false, label: 'SSO only' })
      a.sso.adminConsole = (await p.confirm('Close Keycloak\'s admin console on the public address?', { default: false, label: 'Keycloak console closed' })) ? 'closed' : 'open'
    }
  }

  a.backups ||= {}
  a.mail ||= {}
  // The wizard offers the usual settings in one question: exactly what --yes would choose.
  // (Kept on ctx so that changing another section in the review does not ask for mail.)
  let usual = Boolean(ctx.usualSettings)
  if (rich && !has(a.backups, 'to') && !has(a, 'size') && !has(a.mail, 'urlFrom')) {
    p.section?.('Sign-in', 5, 6)
    usual = await p.confirm('Use the usual settings for backups, size and mail?', {
      default: true, label: 'Usual settings',
      help: `Daily backups at 03:00${kube ? ' UTC' : ''}, keep 14 · size small · no mail (setup links come from the CLI)`,
    })
    if (usual) { a.backups.to = 'default'; a.size = 'small'; ctx.usualSettings = true }
  }
  if (!has(a.backups, 'to')) {
    const where = await p.choose('Backups', kube
      ? [{ value: 'default', label: 'Daily at 03:00 UTC to a volume in the namespace, keep 14' }, { value: 'off', label: 'Off' }]
      : [{ value: 'default', label: 'Daily at 03:00, keep 14, next to the install' }, { value: 'dir', label: 'Daily to another folder' }, { value: 's3', label: 'Daily to S3 (needs the aws command on the host)' }, { value: 'off', label: 'Off' }],
    { default: 'default', label: 'Backups' })
    a.backups.to = where === 'dir' ? await p.text('Folder', { label: 'Backups to' }) : where === 's3' ? await p.text('S3 URL (s3://bucket/prefix)', { label: 'Backups to' }) : where
  }

  if (!has(a, 'size')) {
    a.size = await p.choose('Size', Object.entries(SIZES).map(([value, size]) => ({ value, label: `${value}: ${size.memory} memory, ${size.cpu} CPU, ${size.storage} storage${a.sso?.enabled ? ' (+0.5 GB for SSO)' : ''}` })), { default: 'small', label: 'Size' })
  }

  if (!has(a.mail, 'urlFrom') && !usual) {
    const name = await p.text('Mail: name of the environment variable that holds your SMTP URL (smtp://user:pass@host:587)', { optional: true, label: 'Mail', validate: v => variableName(true)(v.replace(/^env:/, '')) })
    if (name) {
      a.mail.urlFrom = `env:${name.replace(/^env:/, '')}`
      a.mail.from = (await p.text('Send mail from (for example Slatebox <boards@example.com>)', { optional: true, label: 'Mail from' })) || null
    } else if (p.note) {
      p.note('info', `Without mail, someone who forgets a password gets a one-time link from you: docker exec ${a.name || 'slatebox'} slatebox password-link <email>`)
    } else {
      ctx.stderr.write(`  Without mail, someone who forgets a password gets a one-time link from you: docker exec ${a.name || 'slatebox'} slatebox password-link <email>\n`)
    }
  }
  return a
}
