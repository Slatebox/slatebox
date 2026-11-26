// Which image to run, pinned to something that cannot change underneath an
// install, and what that image accepts.
import { capabilitiesFromProbe, LEGACY_SETTINGS } from './ai/settings-adapter.mjs'
import { EXIT, InstallError } from './errors.mjs'

/**
 * Each release of this package installs one image: the public multi-arch
 * index on GHCR, by its digest, so `npx slatebox@x.y.z install` always
 * installs the same bytes. Give --image or --image-archive to install a local
 * build instead (self-host/build-image.sh).
 */
export const DEFAULT_REPOSITORY = 'ghcr.io/slatebox/slatebox'
// 0.2.0 added the team-address tunnel (cloudflared); 0.2.1 the self-host fixes and team moves;
// 0.2.2 adds SSO accounts joining the setup team as members (SSO slice 1) and the Help and
// support menu; 2.1.0 is the first image GitHub builds and signs from a release tag (the image
// version now equals the app version) and adds `slatebox updates` (automatic updates).
// PINNED_DIGEST is the published multi-arch index of ghcr.io/slatebox/slatebox:2.1.0
// (linux/amd64 and linux/arm64); `npm publish` refuses to run without it.
export const PINNED_TAG = '2.1.0'
export const PINNED_DIGEST = 'sha256:40cb7fe13714ed5e691479dc283afe65737e643ffda59257ee5c97ad6163b20a'
export const DEFAULT_IMAGE = PINNED_DIGEST ? `${DEFAULT_REPOSITORY}@${PINNED_DIGEST}` : `${DEFAULT_REPOSITORY}:${PINNED_TAG}`

// What the pinned image accepts: its own `slatebox settings --json` (self-host/rootfs/opt/slatebox/
// lib/settings.mjs at the revision it was built from). A plan for the pinned image on a machine
// that has not pulled it yet is then the real plan (a team address, several AI providers), not a
// guess from an older image. The image is still probed after it is pulled, and that answer wins.
export const PINNED_CAPABILITIES = Object.freeze({
  settings: Object.freeze([
    'SLATEBOX_URL', 'SLATEBOX_HTTPS', 'SLATEBOX_ACME_CA', 'SLATEBOX_MAIL_URL', 'SLATEBOX_MAIL_FROM', 'SLATEBOX_AI_KEY',
    'SLATEBOX_AI_URL', 'SLATEBOX_AI_MODEL', 'SLATEBOX_AI_CONFIG', 'SLATEBOX_AI_PROVIDERS', 'SLATEBOX_AI_DEFAULT', 'SLATEBOX_AI_OWN_PROVIDERS',
    'SLATEBOX_AI_PRIVATE_ENDPOINTS', 'SLATEBOX_SETTINGS', 'SLATEBOX_SSO', 'SLATEBOX_SSO_ONLY', 'SLATEBOX_SSO_ADMIN', 'SLATEBOX_SSO_DEFAULT_ROLE',
    'SLATEBOX_SSO_DOMAINS', 'SLATEBOX_KEY_ENCRYPTION_KEY', 'SLATEBOX_TUNNEL_TOKEN', 'SLATEBOX_LICENSE', 'SLATEBOX_LICENSE_FILE', 'SLATEBOX_UPDATES',
    'SLATEBOX_UPDATE_FEED', 'MONGO_URL', 'MONGO_OPLOG_URL',
  ]),
  commands: Object.freeze(['backup', 'restore', 'password-link', 'setup-link', 'health', 'version', 'sso', 'ai', 'settings', 'tunnel', 'updates', 'restore-on-start']),
  source: 'pinned',
})

/** Is this reference the image this release pins (by digest, or by its tag while unpinned)? */
export const isPinnedImage = ref => Boolean(ref) && (ref === DEFAULT_IMAGE || (PINNED_DIGEST !== null && ref === `${DEFAULT_REPOSITORY}@${PINNED_DIGEST}`))

/** Does this reference name a registry (so a digest reference can be pulled elsewhere)? */
export function hasRegistry(ref) {
  const first = ref.split('/')[0]
  return ref.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost')
}

export const repositoryOf = ref => ref.replace(/@sha256:[a-f0-9]{64}$/, '').replace(/:[^/:]+$/, '')

/** A tag (it can move), as opposed to a digest reference or an image ID. */
export const isTag = ref => !ref.includes('@sha256:') && !/^sha256:[a-f0-9]{64}$/.test(ref)

/** The image as it is on the host now, or null. Never pulls. */
export async function inspectImage(docker, ref) {
  const inspected = await docker(['image', 'inspect', '--format', '{{json .}}', ref])
  return inspected.code === 0 ? JSON.parse(inspected.stdout) : null
}

/** The pinned description of an inspected image. */
export function pinImage(wanted, info) {
  const id = info.Id
  let pinned = id
  if (wanted.includes('@sha256:')) pinned = wanted
  else if (hasRegistry(wanted)) {
    const repository = repositoryOf(wanted)
    pinned = (info.RepoDigests || []).find(digest => digest.startsWith(`${repository}@`)) || id
  }
  return { ref: wanted, pinned, id, created: info.Created, labels: info.Config?.Labels || {}, architecture: info.Architecture || null }
}

// What docker pull says when this machine cannot reach the registry at all.
const OFFLINE = /no such host|dial tcp|i\/o timeout|network is unreachable|connection refused|TLS handshake timeout|temporary failure in name resolution|could not resolve|server misbehaving|Client\.Timeout/i

function unavailable(wanted, why) {
  const registry = hasRegistry(wanted) ? wanted.split('/')[0] : 'Docker Hub'
  if (OFFLINE.test(why || '')) {
    return new InstallError(EXIT.PRECONDITION,
      `The image ${wanted} could not be downloaded: this computer cannot reach ${registry} (${why}). Nothing was changed. ` +
      'Check the internet connection (and any proxy or firewall), then run the same command again.' +
      (wanted.startsWith(DEFAULT_REPOSITORY) ? ' To install a local build instead, give --image <name> or --image-archive <file.tar>.' : ''),
      { image: wanted, offline: true })
  }
  return new InstallError(EXIT.PRECONDITION,
    `The image ${wanted} is not available: ${why}\n` +
    (wanted.startsWith(DEFAULT_REPOSITORY) ? 'The public image needs no login: check that this machine can reach ghcr.io (or that the --to version exists), then try again. To install a local build instead, give --image <name> or --image-archive <file.tar>.' : 'Check the name, or log in to its registry with docker login.'),
    { image: wanted })
}

/**
 * For an upgrade: fetch a tag again, because a cached tag says nothing about
 * what the registry has now. When the registry cannot be reached and a copy is
 * already on the host, that copy is used and the person is told.
 */
export async function refreshTag(docker, ref, step) {
  if (!isTag(ref)) return
  step('image', 'start', `Fetching ${ref} to see whether it is newer`)
  const pulled = await docker(['pull', ref], { timeout: 60 * 60_000 })
  if (pulled.code === 0) return
  const why = pulled.stderr.trim().split('\n').pop()
  if (!(await inspectImage(docker, ref))) throw unavailable(ref, why)
  step('image', 'warn', `${ref} could not be pulled (${why}); using the copy already on the host.`)
}

const ARCH = { x86_64: 'amd64', amd64: 'amd64', aarch64: 'arm64', arm64: 'arm64' }
export const normalArch = arch => ARCH[String(arch || '').trim()] || String(arch || '').trim() || null

/** Refuse an image built for another processor than the host's (or the cluster nodes'). */
export function checkArch(image, hostArch, where) {
  const want = normalArch(image.architecture)
  const have = [].concat(hostArch || []).map(normalArch).filter(Boolean)
  if (!want || !have.length || have.includes(want)) return
  throw new InstallError(EXIT.PRECONDITION, `The image ${image.ref} is built for ${want}, but ${where} is ${[...new Set(have)].join(' and ')}. Use an image built for ${[...new Set(have)].join(' or ')} (docker buildx build --platform linux/${have[0]}).`)
}

/**
 * Make the image available to a Docker host and pin it.
 * @param {(args: string[], options?: object) => Promise<{code:number,stdout:string,stderr:string}>} docker docker on the target host
 * @param {{ref?: string, archive?: string, loadArchive?: (file: string) => Promise<{code:number,stdout:string,stderr:string}>, step: Function}} options
 * @returns {Promise<{ref: string, pinned: string, id: string, created?: string, labels: object}>}
 */
export async function resolveImage(docker, { ref, archive, loadArchive, step }) {
  let wanted = ref || DEFAULT_IMAGE
  if (archive) {
    step('image', 'start', `Loading the image from ${archive}`)
    const loaded = await loadArchive(archive)
    if (loaded.code !== 0) throw new InstallError(EXIT.PRECONDITION, `The image archive ${archive} could not be loaded: ${loaded.stderr.trim()}`)
    const named = /Loaded image: (\S+)/.exec(loaded.stdout)
    const id = /Loaded image ID: (sha256:[a-f0-9]{64})/.exec(loaded.stdout)
    if (!ref) wanted = named?.[1] || id?.[1]
    if (!wanted) throw new InstallError(EXIT.PRECONDITION, `The image archive ${archive} did not name an image.`)
  }
  let info = await inspectImage(docker, wanted)
  if (!info) {
    const pulled = await pullWithProgress(docker, wanted, step)
    if (pulled.code !== 0) throw unavailable(wanted, pulled.stderr.trim().split('\n').pop())
    info = await inspectImage(docker, wanted)
    if (!info) throw new InstallError(EXIT.PRECONDITION, `The image ${wanted} was pulled but cannot be inspected.`)
  }
  return pinImage(wanted, info)
}

/**
 * docker pull, saying so first and then every so often while it runs (the first pull of the
 * one-container image is about 1 GB), so a long download never looks like a hang.
 */
export async function pullWithProgress(docker, ref, step, { every = 15_000 } = {}) {
  step('image', 'start', `Downloading ${ref} (about 1 GB the first time; later installs and upgrades fetch only what changed)`)
  const started = Date.now()
  const timer = setInterval(() => step('image', 'start', `Still downloading the image (${Math.round((Date.now() - started) / 1000)}s so far)`), every)
  timer.unref?.()
  try {
    const pulled = await docker(['pull', ref], { timeout: 60 * 60_000 })
    if (pulled.code === 0) step('image', 'ok', `Downloaded the image in ${Math.max(1, Math.round((Date.now() - started) / 1000))}s`)
    return pulled
  } finally {
    clearInterval(timer)
  }
}

/** What an image is known to accept before it is on this machine: the pinned image's own list, else the oldest image's. */
export const knownCapabilities = ref => (isPinnedImage(ref || DEFAULT_IMAGE) ? PINNED_CAPABILITIES : FALLBACK_CAPABILITIES)

/** What the image accepts, read from the image (no network, nothing kept). */
export async function probeImage(docker, image) {
  const base = ['run', '--rm', '--network', 'none']
  const settingsJson = await docker([...base, '--entrypoint', '/opt/slatebox/bin/slatebox', image, 'settings', '--json'])
  if (settingsJson.code === 0) {
    const caps = capabilitiesFromProbe({ settingsJson: settingsJson.stdout })
    if (caps) return caps
  }
  // Older images: the usage text lists the commands, and configure.mjs refuses
  // an unknown SLATEBOX_ name with the list of every name it accepts.
  const usage = settingsJson.stderr
  const configure = await docker([...base, '-e', 'SLATEBOX_INSTALLER_PROBE=1', '--entrypoint', 'node', image, '/opt/slatebox/lib/configure.mjs'])
  const caps = capabilitiesFromProbe({ configureOutput: configure.stdout + configure.stderr, usage })
  if (!caps) {
    throw new InstallError(EXIT.PRECONDITION, `${image} does not look like a Slatebox image (it does not list its settings). Give the one-container image, ghcr.io/slatebox/slatebox.`)
  }
  return caps
}

/** MongoDB 8.0 needs AVX (x86-64) or ARMv8.2-A; the image's own mongod is the authority. */
export async function checkCpu(docker, image) {
  const result = await docker(['run', '--rm', '--network', 'none', '--entrypoint', 'mongod', image, '--version'])
  if (/exec format error/i.test(result.stderr)) {
    throw new InstallError(EXIT.PRECONDITION, `${image} is built for another processor architecture than this host ("exec format error"). Use an image built for this host's architecture.`)
  }
  if (result.code === 132 || /Illegal instruction/i.test(result.stderr)) {
    throw new InstallError(EXIT.PRECONDITION, 'This processor cannot run MongoDB 8.0, which Slatebox includes: it needs AVX on Intel/AMD (2011 or newer) or ARMv8.2-A on ARM (Raspberry Pi 5, Graviton 2, Apple silicon).')
  }
  return result.code === 0
}

export const FALLBACK_CAPABILITIES = Object.freeze({ settings: [...LEGACY_SETTINGS], commands: ['backup', 'restore', 'password-link', 'health', 'version', 'sso'], source: 'assumed' })
