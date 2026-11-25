// The one container Slatebox runs in, on this computer and on a server over
// SSH, started with plain `docker run`: Slatebox is one container, so no
// Compose is needed (render/compose.mjs is only the "just write the files" export).
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export const SETTINGS_FILE = 'slatebox.env'
export const SECRETS_FILE = 'secrets.env'
/** The label that says which settings a container was made with, so a change is seen without any extra file. */
export const SPEC_LABEL = 'com.slatebox.spec'
/** Where the running container waits while its replacement starts; it comes back if the new one fails. */
export const previousName = name => `${name}-previous`

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
 * The `docker run` arguments for the install's container: its name, restart policy, published
 * ports, the named data volume, both env files, the installer's labels and an immutable image
 * (repo@sha256:… or an image ID; never pulled here: the installer pulls or loads it first).
 * The image's own HEALTHCHECK is what `docker inspect` reports as its health.
 * @returns {{args: string[], spec: string}} spec: a digest of everything the container is made from
 *   (including the env files' text, which Docker reads only when the container is created).
 */
export function containerRun(answers, { image, dir, hostGateway = false, settingsText = '', secretsText = '' }) {
  const args = [
    'run', '--detach', '--name', answers.name, '--restart', 'unless-stopped', '--pull', 'never',
    ...ports(answers).flatMap(port => ['--publish', port]),
    '--volume', `${answers.name}-data:/data`,
    '--env-file', join(dir, SETTINGS_FILE), '--env-file', join(dir, SECRETS_FILE),
    '--label', `com.slatebox.install=${answers.name}`, '--label', 'app.kubernetes.io/managed-by=slatebox-installer',
    ...(hostGateway ? ['--add-host', 'host.docker.internal:host-gateway'] : []),
  ]
  const spec = createHash('sha256').update(JSON.stringify([args, image, settingsText, secretsText])).digest('hex').slice(0, 32)
  return { args: [...args, '--label', `${SPEC_LABEL}=${spec}`, image], spec }
}
