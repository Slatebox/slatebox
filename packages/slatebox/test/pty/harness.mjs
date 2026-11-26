// The installer on a real terminal (the pty test's child), against the stand-ins for Docker and
// Slatebox Cloud: `node test/pty/harness.mjs [install flags]`. Steps that take time in real life
// (the download, the start) wait SBX_FAKE_DELAY milliseconds, so spinner rows are seen.
// SBX_FAKE_DOCKER=stopped pretends Docker is installed but not running (for the first
// SBX_FAKE_DOCKER_STOPPED_CALLS docker calls, when set: then it has been started).
import { LEGACY_SETTINGS } from '../../src/ai/settings-adapter.mjs'
import { main } from '../../src/cli.mjs'
import { DEFAULT_IMAGE } from '../../src/image.mjs'
import { FakeCloud, FakeDocker } from '../fakes.mjs'

const delay = Number(process.env.SBX_FAKE_DELAY || 0)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const docker = new FakeDocker({ provider: 'colima', serverArch: 'arm64', settings: [...LEGACY_SETTINGS, 'SLATEBOX_TUNNEL_TOKEN'], commands: ['tunnel', 'setup-link'] })
docker.registry.set(DEFAULT_IMAGE, 'v0.3.0')
const cloud = new FakeCloud({ taken: ['support', 'acme'] })
let stoppedCalls = process.env.SBX_FAKE_DOCKER === 'stopped' ? Number(process.env.SBX_FAKE_DOCKER_STOPPED_CALLS || Infinity) : 0
const run = async (cmd, args, options) => {
  if (cmd === 'kubectl') return { code: 1, stdout: '', stderr: 'no context' }
  if (cmd === 'docker' && stoppedCalls > 0) {
    stoppedCalls--
    return { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon at unix:///Users/me/.colima/default/docker.sock. Is the docker daemon running?' }
  }
  if (cmd === 'docker' && delay) {
    if (args[0] === 'pull') await wait(delay * 3)
    if (args[0] === 'version') await wait(delay / 4)
    if (args[0] === 'run' && args.includes('--detach')) await wait(delay)
    if (args[0] === 'exec' && args.includes('health')) await wait(delay)
  }
  return docker.run(cmd, args, options)
}
const fetch = async (url, init) => {
  if (delay && new URL(url).pathname.includes('availability')) await wait(delay / 2)
  return cloud.fetch(url, init)
}

process.exitCode = await main(process.argv.slice(2), {
  env: { ...process.env, SLATEBOX_CLOUD_URL: cloud.base },
  run, fetch, platform: process.env.SBX_FAKE_PLATFORM || 'linux',
  sleep: async () => { if (delay) await wait(delay) }, deviceLabel: 'test-box', openBrowser: () => {}, inContainer: () => false,
  teamHealthDelay: 1, teamHealthAttempts: 3, healthPoll: 10, statfs: () => ({ bavail: 212e9 / 4096, bsize: 4096 }),
})
