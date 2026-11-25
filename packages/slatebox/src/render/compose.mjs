// The Docker Compose file that `slatebox install export --format compose` writes, for
// GitOps and people who run Compose themselves. The installer never runs Compose: it
// starts the one container with plain `docker run` (render/container.mjs).
import { stringify } from '../yaml.mjs'
import { ports, SECRETS_FILE, SETTINGS_FILE } from './container.mjs'

export const COMPOSE_FILE = 'compose.yaml'
export { SETTINGS_FILE, SECRETS_FILE }

/**
 * @param {object} answers
 * @param {{image: string, hostGateway?: boolean, pullPolicy?: string|null}} options image: an immutable
 *   reference (repo@sha256:… or an image ID). pullPolicy null for exported files, where compose must pull.
 */
export function renderCompose(answers, { image, hostGateway = false, pullPolicy = null }) {
  const service = {
    image,
    container_name: answers.name,
    restart: 'unless-stopped',
    // Exported files leave pull_policy out, so Compose pulls the image.
    ...(pullPolicy ? { pull_policy: pullPolicy } : {}),
    ports: ports(answers),
    volumes: ['data:/data'],
    env_file: [SETTINGS_FILE, SECRETS_FILE],
    labels: { 'com.slatebox.install': answers.name, 'app.kubernetes.io/managed-by': 'slatebox-installer' },
  }
  if (hostGateway) service.extra_hosts = ['host.docker.internal:host-gateway']
  const compose = { name: answers.name, services: { slatebox: service }, volumes: { data: { name: `${answers.name}-data` } } }
  return `# Written by the slatebox installer for the install "${answers.name}".
# Start it with \`docker compose up -d --wait\` next to ${SETTINGS_FILE} and ${SECRETS_FILE}.
${stringify(compose)}`
}
