// What this instance is and what it can do, in one document: GET /api/v1/instance, the
// Developer tab, and the published MCP server and CLI (which read it per instance, so one fixed
// tool list works with Slatebox Cloud and any self-hosted install, whatever its version).
//
// Anyone may read the public view: identity, contract version, and where to sign in and get a
// token. A signed-in person or a token adds the build, capability flags, limits, the canvas and
// workshop vocabularies, the routed actions and the caller's account.
//
// No action branches on Cloud or self-host: differences are data here. Nothing secret is read
// out: every flag is a boolean or a class, never a key, an address or a model.
import { CONTRACT_VERSION } from '../actions/registry.mjs'
import { EXEC_LIMITS, publicLimits } from '../exec/limits.mjs'
import { AI_PROVIDERS, getProviderApiKey } from '../methods/ai/provider.mjs'
import { cloudLicensed } from '../cloud-lock.mjs'
import { businessOnSale } from '../business-billing.mjs'

export const AGENT_GUIDE = 'https://docs.slatebox.com/developers/slateboxapi/terminal-and-agents/'
const UNITS = { b: 1, kb: 1024, mb: 1024 * 1024 }

const selfHosted = (settings) => settings.public?.env === 'selfhost'
// Payments run only on Slatebox Cloud by its signed Cloud key (cloud-lock.mjs): `cloud` says so.
// Settings alone (a Stripe key, metering.enabled) never make billing available.
export const billingAvailable = (settings, { cloud = false } = {}) => cloud === true && !selfHosted(settings) && Boolean(settings.stripePrivateKey)
// Slatebox Business sold in the app: billing, and both Business prices named in settings
// (payments.business.monthly / .yearly). Docs and site guards key on this, never on a code flag.
export const businessCheckout = (settings, { cloud = false } = {}) => billingAvailable(settings, { cloud }) && businessOnSale(settings)

export function instanceCapabilities(settings, { mailAvailable, env = {}, cloud = false }) {
  const self = selfHosted(settings)
  // self-hosted: the operator turned AI on, or connected a model in settings.ai (connections.mjs)
  const drafting = self
    ? settings.selfHosted?.workshopAI === true || Object.keys(settings.ai?.connections || {}).length > 0
    : Boolean(getProviderApiKey({ provider: AI_PROVIDERS.deepinfra, settings, env }))
  return {
    mail: Boolean(mailAvailable()),
    calls: !self && Boolean(settings.daily?.apiKey),
    // transcription is not priced in the meter, so a metered server does not offer it (calls.mjs transcriptionAllowed)
    transcription: Boolean(settings.deepgram?.secret) && settings.metering?.enabled !== true,
    // instance: the operator's own model or key; slatebox: Slatebox runs it (Cloud).
    aiDrafting: drafting ? { available: true, provider: self ? 'instance' : 'slatebox' } : { available: false, provider: 'none' },
    billing: billingAvailable(settings, { cloud }),
    businessCheckout: businessCheckout(settings, { cloud }),
    fileStore: Boolean(settings.aws?.imageBucket && settings.aws?.cloudUrl),
    render: false,
    icons: Boolean(settings.nounProject?.key),
    customWorkshopKinds: false,
  }
}

const bytes = (limit) => {
  const match = /^(\d+)(b|kb|mb)$/i.exec(String(limit))
  return match ? Number(match[1]) * UNITS[match[2].toLowerCase()] : Number(limit)
}

const plainJson = (value) => JSON.parse(JSON.stringify(value))

export function createInstanceDescriber({
  settings,
  origin: givenOrigin,
  identity,
  engine,
  actions,
  rateLimits,
  mailAvailable,
  accounts,
  env = {},
  // whether this server is Slatebox Cloud by its signed Cloud key (cloud-lock.mjs); read per answer
  cloud = () => cloudLicensed({ settings, env }),
  // exec's limits as this instance applies them (a self-hosted operator may change them).
  execLimits = EXEC_LIMITS,
}) {
  const origin = givenOrigin.replace(/\/$/, '')
  const [major, minor] = CONTRACT_VERSION.split('.').map(Number)
  const routed = actions.filter((action) => action.mounts.http)
  const boards = [...new Set(engine.workshopEdits.flatMap((edit) => edit.boards))]
  // Fixed for the life of the process; built once.
  const fixed = plainJson({
    canvas: engine.operations,
    workshops: { boards, edits: engine.workshopEdits },
    actions: routed.map((action) => ({
      id: action.id,
      method: action.mounts.http.method,
      path: `/api/v1${action.mounts.http.path}`,
      scope: action.scope,
      readOnly: action.readOnly,
      destructive: action.destructive,
      openWorld: action.openWorld,
      ...(action.kind === 'write' && { modes: action.modes }),
      tool: action.tool?.name ?? null,
    })),
    limits: {
      rate: { perToken: rateLimits.perToken, perAccount: rateLimits.perAccount, windowSeconds: rateLimits.windowSeconds },
      canvas: engine.limits,
      requestBodyBytes: Math.max(...routed.map((action) => bytes(action.bodyLimit))),
      exec: publicLimits(execLimits),
    },
  })

  async function publicView() {
    const { id } = await identity()
    return {
      view: 'public',
      instance: { id, name: settings.instance?.name || new URL(origin).host, origin },
      contract: { version: CONTRACT_VERSION, major, minor },
      api: { base: `${origin}/api/v1`, openapi: `${origin}/api/v1/openapi.json` },
      signIn: { page: `${origin}/login`, tokens: `${origin}/profile?tab=developer`, registration: 'open' },
      connect: { mcp: `npx --no-install slatebox-mcp --base-url ${origin}`, hosted: `${origin}/mcp`, guide: AGENT_GUIDE },
      // Reserved for the outbound link to Slatebox (P39): none until an administrator links.
      link: { level: 'none', policy: null },
    }
  }

  async function describe(principal) {
    const open = await publicView()
    if (!['person', 'agent'].includes(principal.kind)) return open
    const [{ lineage }, account] = await Promise.all([identity(), accounts.summary(principal)])
    return {
      ...open,
      view: 'account',
      instance: { ...open.instance, lineage },
      build: {
        app: settings.build?.app ?? null,
        engine: engine.version,
        relay: settings.build?.relay ?? null,
      },
      capabilities: instanceCapabilities(settings, { mailAvailable, env, cloud: cloud() === true }),
      limits: fixed.limits,
      canvas: fixed.canvas,
      workshops: fixed.workshops,
      actions: fixed.actions,
      account,
    }
  }

  return { describe }
}
