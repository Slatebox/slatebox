// Answers: what to install and how. They come from four places, lowest first:
// the install record of an earlier run, exported SLATEBOX_INSTALL_* variables,
// an answers file (--answers), and flags. Secrets are never answers: a key is
// given as a reference (env:NAME, file:/path, prompt) and read only when used.
import { isAbsolute, join, normalize, resolve as resolvePath } from 'node:path'
import { isRef, looksLikeKey } from './secrets.mjs'
import { normalizeProvider, PROVIDER_KINDS } from './ai/settings-adapter.mjs'
import { teamAddressProblem, teamUrl } from './cloud.mjs'

export const TARGETS = ['local', 'ssh', 'k8s', 'export']
export const SIZES = Object.freeze({
  small: Object.freeze({ memory: '1Gi', cpu: '1', storage: '10Gi' }),
  team: Object.freeze({ memory: '2Gi', cpu: '2', storage: '20Gi' }),
  large: Object.freeze({ memory: '4Gi', cpu: '4', storage: '50Gi' }),
})
export const DEFAULT_PORT = 7070

// Every flag the install, plan and upgrade commands take, with its type. The
// same names in capitals under SLATEBOX_INSTALL_ are read from the environment,
// except consent (see ARGV_ONLY).
export const ANSWER_FLAGS = {
  target: 'string', host: 'string', 'ssh-port': 'string', identity: 'string', 'install-docker': 'boolean', sudo: 'string',
  dir: 'string', 'ssh-option': 'multiple', url: 'string', domain: 'string', port: 'string', listen: 'string', 'admin-email': 'string',
  ai: 'string', 'ai-provider': 'multiple', 'ai-default': 'string', sso: 'boolean', 'sso-only': 'boolean', 'sso-admin': 'string',
  'mail-url-from': 'string', 'mail-from': 'string', backups: 'string', 'backup-schedule': 'string', 'backup-keep': 'string',
  size: 'string', 'k8s-context': 'string', namespace: 'string', route: 'string', 'ingress-class': 'string',
  'gateway-ref': 'string', 'tls-issuer': 'string', 'storage-class': 'string', format: 'string', out: 'string',
  image: 'string', name: 'string', 'acme-ca': 'string', settings: 'string', 'team-address': 'string', local: 'boolean',
}
// Global flags that also have an environment form.
const GLOBAL_ENV_FLAGS = { answers: 'string', json: 'boolean', agent: 'string', 'image-archive': 'string', home: 'string', debug: 'boolean', 'health-timeout': 'string', 'cloud-url': 'string' }

const isObject = value => value && typeof value === 'object' && !Array.isArray(value)

function deepMerge(base, extra) {
  const out = { ...base }
  for (const [key, value] of Object.entries(extra || {})) {
    if (value === undefined) continue
    out[key] = isObject(value) && isObject(out[key]) ? deepMerge(out[key], value) : value
  }
  return out
}

const truthy = value => /^(1|true|yes|on)$/i.test(String(value))

// Consent is typed on the command line, each time: a variable left exported in
// a shell, a CI job or an agent's environment must never approve a plan,
// install Docker on a server or replace the key encryption key.
export const ARGV_ONLY = new Set(['yes', 'install-docker', 'new-encryption-key', 'delete-data', 'confirm'])

/** SLATEBOX_INSTALL_ADMIN_EMAIL=x becomes { 'admin-email': 'x' }. Only exported variables count. */
export function flagsFromEnv(env) {
  const out = {}
  const known = { ...ANSWER_FLAGS, ...GLOBAL_ENV_FLAGS }
  for (const [flag, type] of Object.entries(known)) {
    if (ARGV_ONLY.has(flag)) continue
    const value = env[`SLATEBOX_INSTALL_${flag.toUpperCase().replace(/-/g, '_')}`]
    if (value === undefined || value === '') continue
    out[flag] = type === 'boolean' ? truthy(value) : type === 'multiple' ? value.split(/\s*;\s*/).filter(Boolean) : value
  }
  return out
}

/** "id=local,kind=ollama,url=http://...,model=qwen3:8b,key=env:NAME" */
export function parseProviderSpec(spec) {
  const fields = {}
  for (const part of String(spec).split(',')) {
    const at = part.indexOf('=')
    if (at < 1) continue
    fields[part.slice(0, at).trim()] = part.slice(at + 1).trim()
  }
  const out = { id: fields.id || fields.kind, kind: fields.kind }
  if (fields.url || fields.baseUrl) out.baseUrl = fields.url || fields.baseUrl
  if (fields.model) out.model = fields.model
  out.keyFrom = fields.key || fields.keyFrom || 'none'
  if (fields.toolChoice || fields['tool-choice']) out.toolChoice = fields.toolChoice || fields['tool-choice']
  return out
}

function splitHost(spec) {
  const match = /^(?:([^@]+)@)?(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(spec)
  if (!match) return { host: spec }
  return { user: match[1], host: match[2], port: match[3] ? Number(match[3]) : undefined }
}

/** The answers that a set of flags gives, and nothing more. */
export function answersFromFlags(flags) {
  const out = {}
  const set = (path, value) => {
    if (value === undefined) return
    const keys = path.split('.')
    let node = out
    for (const key of keys.slice(0, -1)) node = node[key] ||= {}
    node[keys.at(-1)] = value
  }
  set('name', flags.name)
  set('target', flags.target)
  set('image', flags.image)
  set('acmeCa', flags['acme-ca'])
  if (flags.host) {
    const { user, host, port } = splitHost(flags.host)
    set('ssh.host', host)
    set('ssh.user', user)
    set('ssh.port', port)
  }
  if (flags['ssh-port']) set('ssh.port', Number(flags['ssh-port']))
  set('ssh.identity', flags.identity)
  set('ssh.installDocker', flags['install-docker'])
  set('ssh.sudo', flags.sudo)
  set('ssh.dir', flags.dir)
  set('ssh.options', flags['ssh-option'])
  set('address.url', flags.url)
  set('address.domain', flags.domain)
  set('address.team', flags['team-address'])
  // One address at a time: a flag for one kind replaces what an earlier install had of the others.
  if (flags['team-address']) { set('address.url', flags.url ?? null); set('address.domain', flags.domain ?? null) }
  if (flags.domain || flags.url) set('address.team', flags['team-address'] ?? null)
  // --local: this computer only, and no team address even if an earlier install had one.
  if (flags.local) { set('address.team', null); set('address.url', null); set('address.domain', null) }
  set('address.listen', flags.listen)
  if (flags.port !== undefined) set('address.port', Number(flags.port))
  set('adminEmail', flags['admin-email'])
  if (flags.ai !== undefined) set('ai.mode', flags.ai)
  if (flags['ai-provider']?.length) {
    set('ai.mode', 'providers')
    set('ai.providers', flags['ai-provider'].map(parseProviderSpec))
  }
  set('ai.default', flags['ai-default'])
  set('sso.enabled', flags.sso)
  if (flags['sso-only'] !== undefined) {
    set('sso.only', flags['sso-only'])
    if (flags['sso-only']) set('sso.enabled', true)
  }
  set('sso.adminConsole', flags['sso-admin'])
  set('mail.urlFrom', flags['mail-url-from'])
  set('mail.from', flags['mail-from'])
  set('backups.to', flags.backups)
  set('backups.schedule', flags['backup-schedule'])
  if (flags['backup-keep'] !== undefined) set('backups.keep', Number(flags['backup-keep']))
  set('size', flags.size)
  set('k8s.context', flags['k8s-context'])
  set('k8s.namespace', flags.namespace)
  set('k8s.route', flags.route)
  set('k8s.ingressClass', flags['ingress-class'])
  set('k8s.gatewayRef', flags['gateway-ref'])
  if (flags['tls-issuer']) {
    const [kind, name] = flags['tls-issuer'].includes('/') ? flags['tls-issuer'].split('/') : ['ClusterIssuer', flags['tls-issuer']]
    set('k8s.tlsIssuer', { kind, name })
  }
  set('k8s.storageClass', flags['storage-class'])
  set('export.format', flags.format)
  set('export.dir', flags.out)
  if (flags.settings !== undefined) {
    try { set('settings', JSON.parse(flags.settings)) } catch { set('settings', flags.settings) }
  }
  return out
}

/** Merge the four sources: record < environment < answers file < flags. */
export function collect({ record, env = {}, file, flags = {} }) {
  let out = {}
  if (record) out = deepMerge(out, stripRecord(record))
  out = deepMerge(out, answersFromFlags(flagsFromEnv(env)))
  // An answers file is data from elsewhere: it cannot give consent either.
  if (file?.ssh && 'installDocker' in file.ssh) file = { ...file, ssh: Object.fromEntries(Object.entries(file.ssh).filter(([key]) => key !== 'installDocker')) }
  if (file) out = deepMerge(out, file)
  out = deepMerge(out, answersFromFlags(flags))
  return out
}

// What an install record adds beyond the answers is not an answer.
function stripRecord(record) {
  const { installedVersion, imageDigest, previousImageDigest, imageRef, lastHealthy, secretsLocation, state, installedAt, capabilities, ...answers } = record
  return answers
}

// ------------------------------------------------------------ questions

export const AI_CHOICES = [
  { value: 'none', label: 'None for now (the usual choice; add a provider later with `slatebox ai add`)' },
  { value: 'cloud', label: 'Cloud provider key(s): OpenAI, Anthropic, DeepInfra, OpenRouter, Groq, Together, Mistral' },
  { value: 'endpoint', label: 'An endpoint I run: Ollama, vLLM, LM Studio or any OpenAI-compatible URL, and its model' },
  { value: 'both', label: 'Both' },
]

export const QUESTIONS = {
  target: {
    question: 'Where should Slatebox run?',
    choices: [
      { value: 'local', label: 'This computer, with Docker' },
      { value: 'ssh', label: 'A Linux server over SSH' },
      { value: 'k8s', label: 'Kubernetes (the current kube context)' },
      { value: 'export', label: 'Just write the files (compose file or manifests) for GitOps' },
    ],
    flag: '--target',
  },
  'ssh.host': { question: 'Server (user@host or a name from ~/.ssh/config)', flag: '--host' },
  adminEmail: { question: 'Admin email (the first account, and the HTTPS certificate contact)', flag: '--admin-email' },
  'ai.mode': {
    question: 'AI for drafts and the canvas assistant. Slatebox works with any provider, and none is chosen for you.',
    choices: AI_CHOICES,
    flag: '--ai none | --ai-provider kind=<openai|anthropic|deepinfra|openrouter|groq|together|mistral|ollama|lmstudio|openai-compatible>,model=<model>,url=<endpoint>,key=env:<VAR> (repeat for several, then --ai-default <id>)',
  },
}

function question(field, extra = {}) {
  const q = QUESTIONS[field] || {}
  return { field, question: q.question || field, ...(q.choices ? { choices: q.choices } : {}), flag: q.flag, default: null, ...extra }
}

// ------------------------------------------------------------ resolve

// Never repeat the value: it may be the key itself.
const KEY_IN_NAME = 'this looks like a key, not the name of an environment variable. It was not saved or shown. Export the key in a variable (export GROQ_API_KEY=...) and give env:GROQ_API_KEY'
const refLooksLikeKey = ref => typeof ref === 'string' && ref.startsWith('env:') && looksLikeKey(ref.slice(4))

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const NAME = /^[a-z][a-z0-9-]{0,30}$/
const QUANTITY = /^[0-9]+(\.[0-9]+)?(Mi|Gi|Ti|M|G|T)?$/
const DAILY_CRON = /^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) \* \* \*$/
const CRON_FIELD = /^[0-9A-Za-z*,/-]+$/
// Image references go to docker and kubectl as arguments: no option-looking or shell-looking ones.
const IMAGE_REF = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/
// What ssh gets from an answers file. Never a ProxyCommand, LocalCommand or
// anything else that runs a program here, and never host-key checking off.
const SSH_HOST = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9_][A-Za-z0-9_.:-]*)$/
const SSH_USER = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/
const SSH_DIR = /^\/[A-Za-z0-9._/-]+$/
const SSH_OPTIONS = {
  ConnectTimeout: /^[0-9]{1,4}$/,
  ServerAliveInterval: /^[0-9]{1,4}$/,
  ServerAliveCountMax: /^[0-9]{1,3}$/,
  StrictHostKeyChecking: /^(yes|accept-new|ask)$/,
  UserKnownHostsFile: /^[A-Za-z0-9._/~-]+$/,
  IdentitiesOnly: /^(yes|no)$/,
  IdentityAgent: /^[A-Za-z0-9._/~-]+$/,
  ProxyJump: /^([A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9_][A-Za-z0-9_.-]*(:[0-9]{1,5})?(,([A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9_][A-Za-z0-9_.-]*(:[0-9]{1,5})?)*$/,
  HostKeyAlias: /^[A-Za-z0-9_.-]+$/,
  AddressFamily: /^(any|inet|inet6)$/,
  Compression: /^(yes|no)$/,
}
const S3_URL = /^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](\/[A-Za-z0-9._/-]*)?$/
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i

export function sshOptionProblem(option) {
  const match = /^([A-Za-z]+)[= ](.+)$/.exec(String(option))
  if (!match) return 'Key=Value'
  const check = SSH_OPTIONS[match[1]]
  if (!check) return `${match[1]} is not allowed (allowed: ${Object.keys(SSH_OPTIONS).join(', ')}); put anything else in ~/.ssh/config`
  if (!check.test(match[2])) return `${match[1]} has a value that is not allowed${match[1] === 'StrictHostKeyChecking' ? ' (yes, accept-new or ask: checking host keys is never turned off)' : ''}`
  return null
}

/** RFC 1123 host name, or an IP address. */
export function hostnameProblem(hostname) {
  if (/^\[[0-9a-f:.]+\]$/i.test(hostname) || /^[0-9.]+$/.test(hostname)) return null
  if (hostname.length > 253 || !hostname.split('.').every(label => LABEL.test(label))) return 'a host name: letters, digits and dashes in dot-separated labels'
  return null
}

function toMi(quantity) {
  const match = /^([0-9.]+)(Mi|Gi|Ti|M|G|T)?$/.exec(quantity)
  const n = Number(match[1])
  return { Mi: n, Gi: n * 1024, Ti: n * 1024 * 1024, M: n / 1.048576, G: n * 953.674, T: n * 953674 }[match[2] || 'Mi'] ?? n / (1024 * 1024)
}

function httpUrl(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url
  } catch { return null }
}

/**
 * Fill in defaults and check everything.
 * @param {object} partial from collect()
 * @param {{freePort?: number}} ctx
 * @returns {{answers: object, missing: object[], errors: {field: string, message: string}[]}}
 */
export function resolveAnswers(partial, ctx = {}) {
  const errors = []
  const missing = []
  const err = (field, message) => errors.push({ field, message })
  const p = structuredClone(partial || {})
  const a = { version: 1 }

  a.name = p.name ?? 'slatebox'
  if (!NAME.test(a.name)) err('name', 'lowercase letters, digits and dashes, starting with a letter, at most 31 characters')
  a.target = p.target ?? 'local'
  if (!TARGETS.includes(a.target)) err('target', `one of ${TARGETS.join(', ')}`)
  if (p.image) a.image = p.image
  if (a.image !== undefined && (typeof a.image !== 'string' || !IMAGE_REF.test(a.image))) err('image', 'an image reference, like ghcr.io/slatebox/slatebox:latest')
  if (p.acmeCa) a.acmeCa = p.acmeCa

  // --- target-specific sections
  if (a.target === 'ssh') {
    const s = p.ssh || {}
    a.ssh = {
      host: s.host ?? null, user: s.user ?? 'root', port: s.port ?? 22, identity: s.identity ?? null,
      sudo: s.sudo ?? 'auto', installDocker: Boolean(s.installDocker), dir: s.dir ?? '/opt/slatebox', options: s.options ?? [],
    }
    if (!a.ssh.host) missing.push(question('ssh.host'))
    else if (!SSH_HOST.test(a.ssh.host)) err('ssh.host', 'a host name, an IP address or a name from ~/.ssh/config (not starting with -)')
    if (!a.ssh.user) a.ssh.user = 'root'
    if (!SSH_USER.test(a.ssh.user)) err('ssh.user', 'a user name (letters, digits, . _ -, not starting with -)')
    if (!Number.isInteger(a.ssh.port) || a.ssh.port < 1 || a.ssh.port > 65535) err('ssh.port', 'a port number')
    if (!['auto', 'yes', 'no'].includes(a.ssh.sudo)) err('ssh.sudo', 'auto, yes or no')
    if (typeof a.ssh.dir !== 'string' || !SSH_DIR.test(a.ssh.dir) || a.ssh.dir.split('/').includes('..') || normalize(a.ssh.dir) === '/') err('ssh.dir', 'an absolute path on the server: letters, digits and . _ - / only')
    if (a.ssh.identity !== null && (typeof a.ssh.identity !== 'string' || a.ssh.identity.startsWith('-'))) err('ssh.identity', 'the path of a private key')
    if (!Array.isArray(a.ssh.options)) err('ssh.options', 'a list of Key=Value')
    else {
      const problems = a.ssh.options.map(sshOptionProblem).filter(Boolean)
      if (problems.length) err('ssh.options', problems.join('; '))
    }
  }
  if (a.target === 'k8s' || (a.target === 'export' && ['manifests', 'helm'].includes(p.export?.format))) {
    const k = p.k8s || {}
    a.k8s = {
      context: k.context ?? null, namespace: k.namespace ?? 'slatebox', route: k.route ?? 'none',
      ingressClass: k.ingressClass ?? null, gatewayRef: k.gatewayRef ?? null, tlsIssuer: k.tlsIssuer ?? null, storageClass: k.storageClass ?? null,
    }
    if (!['none', 'ingress', 'gateway'].includes(a.k8s.route)) err('k8s.route', 'none, ingress or gateway')
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(a.k8s.namespace)) err('k8s.namespace', 'a valid namespace name')
    if (a.k8s.route === 'gateway' && !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(a.k8s.gatewayRef || '')) err('k8s.gatewayRef', 'namespace/name of the Gateway')
    if (a.k8s.tlsIssuer && (!['ClusterIssuer', 'Issuer'].includes(a.k8s.tlsIssuer.kind) || !a.k8s.tlsIssuer.name)) err('k8s.tlsIssuer', 'ClusterIssuer/<name> or Issuer/<name>')
  }
  if (a.target === 'export') {
    a.export = { format: p.export?.format ?? 'compose', dir: p.export?.dir ?? './slatebox-deploy' }
    if (!['compose', 'manifests', 'helm'].includes(a.export.format)) err('export.format', 'compose, manifests or helm')
  }

  // --- address
  const given = p.address || {}
  const k8s = a.target === 'k8s' || Boolean(a.k8s)
  if (given.domain && given.url) err('address.url', 'give a domain or a URL, not both')
  let url = given.domain ? `https://${given.domain}` : given.url
  // A team address: https://<name>.slatebox.team through an outbound tunnel from the container.
  // Nothing is published beyond 127.0.0.1 and Slatebox's own HTTPS stays off.
  const team = given.team ?? null
  if (team !== null) {
    const problem = teamAddressProblem(team)
    if (problem) err('address.team', problem)
    if (given.domain || (given.url && given.url !== teamUrl(team))) err('address.team', 'give a team address, a domain or a URL, not more than one')
    if (a.target === 'export') err('address.team', 'a team address is claimed when Slatebox is installed; for files only use --domain, or install with --target local, ssh or k8s')
    if (k8s && a.k8s.route !== 'none') err('address.team', 'a team address needs no route: leave --route out (traffic arrives through the tunnel)')
    if (!problem) url = teamUrl(team)
  }
  if (team !== null && !k8s) {
    const port = given.port ?? (a.target === 'local' ? (ctx.freePort ?? DEFAULT_PORT) : DEFAULT_PORT)
    if (!Number.isInteger(port) || port < 1 || port > 65535) err('address.port', 'a port number')
    const listen = given.listen ?? '127.0.0.1'
    if (!['127.0.0.1', '::1'].includes(listen)) err('address.listen', 'with a team address Slatebox is published on 127.0.0.1 only (traffic arrives through the tunnel)')
    a.address = { url: url ?? null, port, listen, team }
  } else if (k8s) {
    if (a.k8s.route === 'none') {
      url ??= `http://localhost:${DEFAULT_PORT}`
    } else if (!url || !httpUrl(url) || httpUrl(url).protocol !== 'https:') {
      err('address.url', `a route (${a.k8s.route}) needs the host name people will use, given as --domain`)
      url = null
    }
    a.address = team !== null ? { url, team } : { url }
  } else {
    let port = given.port
    if (url && httpUrl(url)?.protocol === 'https:') {
      port = null // built-in HTTPS: ports 80 and 443
    } else {
      port ??= a.target === 'local' ? (ctx.freePort ?? DEFAULT_PORT) : DEFAULT_PORT
      if (!Number.isInteger(port) || port < 1 || port > 65535) err('address.port', 'a port number')
      if (url) {
        const parsed = httpUrl(url)
        const urlPort = parsed ? Number(parsed.port || 80) : null
        if (parsed && urlPort !== port) err('address.url', `the address must use the published port ${port} (it says ${urlPort})`)
      } else {
        const host = a.target === 'ssh' ? (!SSH_HOST.test(a.ssh.host || '') ? null : a.ssh.host.includes(':') && !a.ssh.host.startsWith('[') ? `[${a.ssh.host}]` : a.ssh.host) : 'localhost'
        url = host ? `http://${host}:${port}` : null
      }
    }
    const listen = given.listen ?? (a.target === 'local' && port !== null ? '127.0.0.1' : '0.0.0.0')
    if (!['127.0.0.1', '0.0.0.0', '::1', '::'].includes(listen) && !/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(listen)) err('address.listen', 'an IP address of this host to publish on: 127.0.0.1 (this computer only) or 0.0.0.0 (every network interface)')
    a.address = { url, port, listen }
  }
  if (a.address.url && !httpUrl(a.address.url)) {
    if (!errors.some(error => error.field === 'address.url')) err('address.url', 'an http:// or https:// address with nothing after the host, for example https://boards.example.com')
  } else if (a.address.url) {
    const parsed = httpUrl(a.address.url)
    const problem = hostnameProblem(parsed.hostname)
    if (problem) err('address.url', problem)
    else a.address.url = parsed.origin
  }

  // --- people
  a.adminEmail = p.adminEmail ?? null
  if (a.adminEmail && !EMAIL.test(a.adminEmail)) err('adminEmail', 'an email address')
  if (!a.adminEmail && (a.target === 'ssh' || a.target === 'k8s')) missing.push(question('adminEmail'))

  // --- AI: never a default
  const ai = p.ai || {}
  if (ai.mode === undefined || ai.mode === null) {
    missing.push(question('ai.mode'))
    a.ai = { mode: null }
  } else if (ai.mode === 'none') {
    a.ai = { mode: 'none' }
  } else if (ai.mode === 'providers') {
    const providers = (ai.providers || []).map((provider, index) => {
      if (!provider?.kind || !PROVIDER_KINDS.includes(provider.kind)) {
        err(`ai.providers[${index}].kind`, `one of ${PROVIDER_KINDS.join(', ')}`)
        return provider
      }
      const normalized = normalizeProvider(provider)
      if (refLooksLikeKey(normalized.keyFrom)) {
        err(`ai.providers[${index}].keyFrom`, KEY_IN_NAME)
        normalized.keyFrom = 'none'
        return normalized
      }
      const literal = !isRef(normalized.keyFrom)
      if (literal) {
        err(`ai.providers[${index}].keyFrom`, 'a reference: env:NAME, file:/path, prompt or none (never the key itself)')
        normalized.keyFrom = 'none'
      }
      if (literal) {
        // already reported
      } else if (normalized.kind === 'openai-compatible') {
        try { new URL(normalized.baseUrl) } catch { err(`ai.providers[${index}].baseUrl`, 'the endpoint URL, for example http://ollama:11434/v1') }
        if (!normalized.model) err(`ai.providers[${index}].model`, 'the model name the endpoint serves')
      } else if (normalized.keyFrom === 'none') {
        err(`ai.providers[${index}].keyFrom`, 'DeepInfra needs a key: env:NAME, file:/path or prompt')
      }
      if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized.id || '')) err(`ai.providers[${index}].id`, 'lowercase letters, digits and dashes')
      return normalized
    })
    if (!providers.length) err('ai.providers', 'at least one provider, or --ai none')
    const ids = providers.map(provider => provider?.id)
    if (new Set(ids).size !== ids.length) err('ai.providers', 'each provider needs its own id')
    a.ai = { mode: 'providers', providers, default: ai.default ?? (providers.length === 1 ? providers[0]?.id : null) }
    if (providers.length > 1 && !ai.default) err('ai.default', 'several providers: say which one is the default (--ai-default <id>)')
    else if (a.ai.default && !ids.includes(a.ai.default)) err('ai.default', `one of ${ids.join(', ')}`)
  } else {
    err('ai.mode', 'none or providers (with --ai-provider)')
    a.ai = { mode: null }
  }

  // --- single sign-on, mail
  const sso = p.sso || {}
  a.sso = { enabled: Boolean(sso.enabled), only: Boolean(sso.only), adminConsole: sso.adminConsole ?? 'open' }
  if (!['open', 'closed'].includes(a.sso.adminConsole)) err('sso.adminConsole', 'open or closed')
  if (a.sso.only && !a.sso.enabled) err('sso.only', 'needs single sign-on on')
  const mail = p.mail || {}
  a.mail = { urlFrom: mail.urlFrom ?? null, from: mail.from ?? null }
  if (refLooksLikeKey(a.mail.urlFrom)) {
    err('mail.urlFrom', KEY_IN_NAME)
    a.mail.urlFrom = null
  } else if (a.mail.urlFrom && !isRef(a.mail.urlFrom)) {
    err('mail.urlFrom', 'a reference to the SMTP URL: env:NAME or file:/path (it holds a password)')
    a.mail.urlFrom = null
  }
  if (a.mail.from && !a.mail.urlFrom) err('mail.from', 'only applies with a mail URL')

  // --- backups
  const b = p.backups || {}
  a.backups = { schedule: b.schedule ?? '0 3 * * *', to: b.to ?? 'default', keep: b.keep ?? 14 }
  if (!Number.isInteger(a.backups.keep) || a.backups.keep < 1) err('backups.keep', 'how many backups to keep, at least 1')
  if (a.backups.to !== 'off' && (typeof a.backups.schedule !== 'string' || a.backups.schedule.split(' ').length !== 5 || !a.backups.schedule.split(' ').every(field => CRON_FIELD.test(field)))) err('backups.schedule', 'a cron schedule, for example "0 3 * * *"')
  if (typeof a.backups.to !== 'string' || /[\0\r\n]/.test(a.backups.to)) {
    err('backups.to', 'default, off, a folder or s3://bucket/prefix')
    a.backups.to = 'off'
  } else if (a.backups.to.startsWith('s3:')) {
    if (!S3_URL.test(a.backups.to)) err('backups.to', 's3://bucket/prefix (letters, digits and . _ - / in the prefix)')
  } else if (!['default', 'off', 'pvc'].includes(a.backups.to) && !k8s) {
    // A folder, made absolute once here so the stored answer does not depend on where the installer runs.
    let to = a.backups.to
    if (to === '~' || to.startsWith('~/')) to = a.target === 'ssh' ? to : join(ctx.home || '~', to.slice(1))
    if (!isAbsolute(to)) {
      if (a.target === 'ssh' || a.target === 'export') err('backups.to', 'an absolute folder on the server')
      else if (ctx.cwd) to = resolvePath(ctx.cwd, to)
    }
    a.backups.to = to
  }
  if (k8s && a.backups.to !== 'off') {
    if (!['default', 'pvc'].includes(a.backups.to)) err('backups.to', 'on Kubernetes backups go to a volume in the namespace (default) or off; S3 is not supported there yet')
    if (!DAILY_CRON.test(a.backups.schedule)) err('backups.schedule', 'on Kubernetes a daily time, "M H * * *" (UTC)')
  } else if (a.backups.to.startsWith('s3://') && a.target !== 'local' && a.target !== 'ssh') {
    err('backups.to', 'S3 backups need the aws command on a Docker host')
  }

  // --- size
  if (typeof p.size === 'string' || p.size === undefined) {
    const named = SIZES[p.size ?? 'small']
    if (!named) {
      err('size', `small, team, large, or { memory, cpu, storage }`)
      a.size = { ...SIZES.small }
    } else {
      a.size = { ...named }
      if (a.sso.enabled) a.size.memory = `${toMi(named.memory) + 512}Mi`
    }
  } else if (isObject(p.size)) {
    a.size = { memory: String(p.size.memory), cpu: String(p.size.cpu), storage: String(p.size.storage) }
    if (!QUANTITY.test(a.size.memory) || !QUANTITY.test(a.size.storage) || !/^[0-9]+(\.[0-9]+)?m?$/.test(a.size.cpu)) err('size', 'memory and storage like 2Gi, cpu like 2 or 500m')
  } else {
    err('size', 'small, team, large, or { memory, cpu, storage }')
  }

  a.settings = p.settings ?? {}
  if (!isObject(a.settings)) err('settings', 'a JSON object (no secrets: those go in references)')
  if (a.acmeCa && !/^https:\/\/\S+$/.test(a.acmeCa)) err('acmeCa', 'an https:// ACME directory URL')
  return { answers: a, missing, errors }
}

/** The answers as they are stored in an install record and in exported answers files. */
export function recordable(answers) {
  return structuredClone(answers)
}
