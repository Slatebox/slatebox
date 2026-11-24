// Which image to run, pinned to something that cannot change underneath an
// install, and what that image accepts.
import { capabilitiesFromProbe, LEGACY_SETTINGS } from './ai/settings-adapter.mjs'
import { EXIT, InstallError } from './errors.mjs'

/**
 * Each release of this package installs one image. Until the image is
 * published on GHCR (an owner-gated step), PINNED_DIGEST is null and the
 * installer uses the tag; give --image or --image-archive to install a local
 * build. When the image is published, the release sets PINNED_DIGEST so that
 * `npx slatebox@x.y.z install` always installs the same bytes.
 */
export const DEFAULT_REPOSITORY = 'ghcr.io/slatebox/slatebox'
export const PINNED_TAG = 'latest'
export const PINNED_DIGEST = null
export const DEFAULT_IMAGE = PINNED_DIGEST ? `${DEFAULT_REPOSITORY}@${PINNED_DIGEST}` : `${DEFAULT_REPOSITORY}:${PINNED_TAG}`

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

function unavailable(wanted, why) {
  return new InstallError(EXIT.PRECONDITION,
    `The image ${wanted} is not available: ${why}\n` +
    (wanted.startsWith(DEFAULT_REPOSITORY) ? 'The public image is not published yet. Build one (self-host/build-image.sh) and give --image <name> or --image-archive <file.tar>.' : 'Check the name, or log in to its registry with docker login.'),
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
    step('image', 'start', `Pulling ${wanted}`)
    const pulled = await docker(['pull', wanted], { timeout: 60 * 60_000 })
    if (pulled.code !== 0) throw unavailable(wanted, pulled.stderr.trim().split('\n').pop())
    info = await inspectImage(docker, wanted)
    if (!info) throw new InstallError(EXIT.PRECONDITION, `The image ${wanted} was pulled but cannot be inspected.`)
  }
  return pinImage(wanted, info)
}

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
