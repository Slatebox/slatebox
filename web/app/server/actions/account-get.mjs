import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'

export default defineAction({
  id: 'account.get',
  title: 'Account',
  description:
    'Your name, address and whether it is verified, team and claims, AI drafting access, what is included this month (ai.included, null on a server with no meter) and whether you have Slatebox Pro (ai.pro, null without it), the token you called with, and the addresses where you change what a token may not (profile, and Credits for Slatebox Pro and top-ups). Getting Pro or topping up is done by a person in the app, never through a token: links.pay opens Credits with its pay sheet (Get Pro, or Your Pro once they have it) and links.topUp opens a top-up there. Education is null on a self-hosted instance.',
  toolset: 'account',
  kind: 'read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/me', operationId: 'getAccount' } },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      email: { type: ['string', 'null'] },
      emailVerified: { type: 'boolean' },
      team: { type: ['object', 'null'] },
      education: { type: ['string', 'null'], enum: ['none', 'requested', 'certified', null] },
      ai: { type: 'object' },
      token: { type: ['object', 'null'] },
      links: { type: 'object' },
    },
    required: ['id', 'name', 'ai', 'links'],
  },
  tool: { name: 'get_account', title: 'Read your account', description: 'Read the person\'s Slatebox account: name, team, what they can use and their AI drafting access.' },
  async handler(principal, _input, { deps }) {
    const account = await deps.accounts.summary(principal)
    if (!account) throw problem(404, 'not_found', 'This account no longer exists.')
    return account
  },
})
