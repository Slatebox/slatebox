import { defineAction } from './registry.mjs'
import { LIBRARY_CATEGORIES } from '../../imports/api/common/library-model.mjs'

export default defineAction({
  id: 'instance.describe',
  title: 'Server',
  description:
    'What this Slatebox instance is and can do. Without a token: its id, name, contract version and where to sign in. With a token: also the build, capability flags, limits, the canvas and workshop vocabularies, the routes it serves and your account.',
  toolset: 'instance',
  kind: 'read',
  principals: ['visitor', 'guest', 'person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/instance', operationId: 'describeInstance' } },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    type: 'object',
    properties: {
      view: { type: 'string', enum: ['public', 'account'] },
      instance: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' }, origin: { type: 'string' }, lineage: { type: 'string' } },
        required: ['id', 'name', 'origin'],
      },
      contract: {
        type: 'object',
        properties: { version: { type: 'string' }, major: { type: 'integer' }, minor: { type: 'integer' } },
        required: ['version', 'major', 'minor'],
      },
      api: { type: 'object' },
      signIn: { type: 'object' },
      connect: { type: 'object' },
      link: { type: 'object' },
      build: { type: 'object' },
      capabilities: { type: 'object' },
      limits: { type: 'object' },
      canvas: { type: 'object' },
      workshops: { type: 'object' },
      actions: { type: 'array', items: { type: 'object' } },
      account: { type: 'object' },
      library: { type: 'object', description: 'With a token or sign-in: the shared library\'s categories, and whether you review its submissions.' },
    },
    required: ['view', 'instance', 'contract', 'api', 'signIn', 'connect', 'link'],
  },
  tool: { name: 'describe_instance', title: 'Describe this instance', description: 'Describe the Slatebox server these tools talk to (Slatebox Cloud or a self-hosted one): its name, version, what it can do and where its API is.' },
  async handler(principal, _input, { deps }) {
    const described = await deps.instance.describe(principal)
    if (!deps.library || described?.view !== 'account') return described
    return { ...described, library: { categories: [...LIBRARY_CATEGORIES], reviewer: await deps.library.isReviewer(principal.userId) } }
  },
})
