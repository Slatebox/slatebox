// The Docker Compose file for this computer and for a server over SSH. It is
// also what `slatebox install export --format compose` writes.
import { stringify } from '../yaml.mjs'

export const COMPOSE_FILE = 'compose.yaml'
export const SETTINGS_FILE = 'slatebox.env'
export const SECRETS_FILE = 'secrets.env'

/**
 * Published ports. This computer publishes on 127.0.0.1 unless --listen says
 * otherwise: Docker's port rules go around host firewalls such as ufw, so a
 * bare "7070:7070" on a VPS would put the first-account page on the internet.
 */
export function ports(answers) {
  if (answers.address.port === null) return ['80:80', '443:443']
  const listen = answers.address.listen && !['0.0.0.0', '::'].includes(answers.address.listen) ? `${answers.address.listen.includes(':') ? `[${answers.address.listen}]` : answers.address.listen}:` : ''
  return [`${listen}${answers.address.port}:7070`]
}

/** The host port of a published mapping ("127.0.0.1:7070:7070" -> 7070). */
export const hostPort = mapping => Number(mapping.split(':').at(-2))

/**
 * @param {object} answers
 * @param {{image: string, hostGateway?: boolean, pullPolicy?: string|null}} options image: an immutable
 *   reference (repo@sha256:… or an image ID). pullPolicy null for exported files, where compose must pull.
 */
export function renderCompose(answers, { image, hostGateway = false, pullPolicy = 'never' }) {
  const service = {
    image,
    container_name: answers.name,
    restart: 'unless-stopped',
    // The installer pulls (or loads) the image itself before it starts anything,
    // so an upgrade never fetches behind its back. Exported files leave it out.
    ...(pullPolicy ? { pull_policy: pullPolicy } : {}),
    ports: ports(answers),
    volumes: ['data:/data'],
    env_file: [SETTINGS_FILE, SECRETS_FILE],
    labels: { 'com.slatebox.install': answers.name, 'app.kubernetes.io/managed-by': 'slatebox-installer' },
  }
  if (hostGateway) service.extra_hosts = ['host.docker.internal:host-gateway']
  const compose = { name: answers.name, services: { slatebox: service }, volumes: { data: { name: `${answers.name}-data` } } }
  return `# Written by the slatebox installer for the install "${answers.name}".
# Change it with \`npx slatebox install --name ${answers.name} ...\` (or \`slatebox ai ...\`) rather than by hand:
# the installer keeps its answers in install.yaml and writes this file again.
${stringify(compose)}`
}
