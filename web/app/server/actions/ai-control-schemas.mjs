// Schemas the AI control actions share (spec 4): providers, server connections and models.
import { problem } from './errors.mjs'
import { AUTH_STYLES, CHAT_PROTOCOLS, PROVIDER_CAPS } from '../ai-control/providers.mjs'

export const SLUG = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,39}$' }
export const REASON = { type: 'string', minLength: 1, maxLength: 500, description: 'Why, for the change history.' }
const caps = (description) => ({
  type: 'object',
  properties: Object.fromEntries(PROVIDER_CAPS.map((key) => [key, { type: 'boolean' }])),
  additionalProperties: false,
  description,
})

export const providerInput = {
  type: 'object',
  properties: {
    id: { ...SLUG, description: 'The provider\'s id, for example gemini. Built-in ids cannot be used.' },
    label: { type: 'string', minLength: 1, maxLength: 80 },
    protocol: { type: 'string', enum: [...CHAT_PROTOCOLS], description: 'The wire protocol it speaks. Gemini, Meta, Mistral, OpenRouter, Groq, Together, Ollama and vLLM speak openai-chat.' },
    baseUrl: { type: ['string', 'null'], maxLength: 500, description: 'The address up to /v1. null: each connection gives its own.' },
    baseUrlLocked: { type: 'boolean', description: 'Connections of this provider keep its address (default true when an address is given).' },
    auth: {
      type: 'object',
      properties: { style: { type: 'string', enum: [...AUTH_STYLES] }, name: { type: 'string', maxLength: 64 } },
      required: ['style'],
      additionalProperties: false,
      description: 'How the key is sent: bearer (Authorization: Bearer), header { name }, query { name } or none.',
    },
    extraHeaders: { type: 'object', additionalProperties: { type: 'string', maxLength: 200 }, maxProperties: 10, description: 'Headers sent with every request. Nothing secret: names that look like credentials are refused.' },
    keyRequired: { type: 'boolean' },
    modelOptional: { type: 'boolean' },
    defaultCapabilities: caps('What its models can usually do; a connection or model may say otherwise.'),
  },
  required: ['id', 'label', 'protocol'],
  additionalProperties: false,
}

export const serverConnectionInput = {
  type: 'object',
  properties: {
    name: { ...SLUG, description: 'The connection\'s name, for example gemini-main.' },
    type: { ...SLUG, description: 'The provider: openai-compatible, openai, anthropic, deepinfra, one an administrator added, or a service beside the models (stability, google-cse, nounproject, deepgram).' },
    baseUrl: { type: 'string', maxLength: 500, description: 'For a provider without a fixed address: the address up to /v1.' },
    model: { type: 'string', maxLength: 200, description: 'The model it serves. For google-cse, the search engine ID (cx).' },
    apiKey: { type: 'string', maxLength: 400, writeOnly: true, description: 'Stored encrypted with the server\'s key and never shown again. Leave it out to keep the saved key. For nounproject: key:secret.' },
    keyRef: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['env', 'none'] }, name: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' } },
      required: ['kind'],
      additionalProperties: false,
      description: 'env: read the key from an environment variable named SLATEBOX_AI_KEY_… (or one the settings file allows) for each request; none: no key. Sending apiKey seals the key instead.',
    },
    rotate: {
      type: 'object',
      properties: { graceHours: { type: 'integer', enum: [0, 1, 24] } },
      required: ['graceHours'],
      additionalProperties: false,
      description: 'With a new apiKey: the old key keeps working for this many hours, in case the provider has not taken the new one yet.',
    },
    capabilities: caps('What the model can do, where you know it. Unset means try it; making images needs images: true.'),
    maxTokens: { type: 'integer', minimum: 256, maximum: 200000 },
    toolChoice: { type: 'string', enum: ['auto', 'named', 'required'] },
    status: { type: 'string', enum: ['active', 'disabled'], description: 'disabled: kept, but nothing is sent to it.' },
  },
  required: ['name', 'type'],
  additionalProperties: false,
}

export const modelInput = {
  type: 'object',
  properties: {
    connection: { type: 'string', pattern: '^(server|builtin):[a-z0-9][a-z0-9-]{0,39}$', description: 'server:<connection> or builtin:deepinfra|openai|anthropic|stabilityai.' },
    model: { type: 'string', minLength: 1, maxLength: 200 },
    label: { type: ['string', 'null'], maxLength: 80 },
    capabilities: caps('What the model can do. A binding refuses a model whose flags miss what its surface needs.'),
    maxContext: { type: ['integer', 'null'], minimum: 1 },
    maxOutput: { type: ['integer', 'null'], minimum: 1 },
    prices: {
      type: ['object', 'null'],
      properties: {
        inputPerM: { type: ['number', 'null'], minimum: 0, description: 'Dollars per million input tokens.' },
        outputPerM: { type: ['number', 'null'], minimum: 0, description: 'Dollars per million output tokens.' },
        imageEach: { type: ['number', 'null'], minimum: 0, description: 'Dollars per generated image.' },
        currency: { type: 'string', enum: ['USD'] },
      },
      additionalProperties: false,
    },
    status: { type: 'string', enum: ['enabled', 'disabled'] },
  },
  required: ['connection', 'model'],
  additionalProperties: false,
}

/** A ModelError or ProviderError from ai-control/models.mjs as the action error every surface shows. */
export function asProblem(error) {
  if (error?.name === 'ModelError') {
    const code = error.status === 404 ? 'not_found' : error.status === 409 ? 'conflict' : error.status === 429 ? 'rate_limited' : 'invalid_request'
    return problem(error.status, code, error.message, { ...(error.details && { details: error.details }), ...(error.details?.retryAfter && { retryAfter: error.details.retryAfter }) })
  }
  if (error?.name === 'ProviderError' || error?.name === 'ControlStoreError') return problem(400, 'invalid_request', error.message)
  return error
}
