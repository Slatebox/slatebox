// Schemas the AI control actions share: providers, keys and models.
import { problem } from './errors.mjs'
import { AUTH_STYLES, BUILTIN_PROVIDER_IDS, PROVIDER_CAPS, TOOL_CHOICES } from '../ai-control/providers.mjs'
import { PRESET_IDS } from '../ai-control/provider-presets.mjs'

export const SLUG = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,39}$' }
export const REASON = { type: 'string', minLength: 1, maxLength: 500, description: 'Why, for the change history.' }
export const PROVIDER_ID = { ...SLUG, description: `A model provider's id (for example meta or deepinfra), or a service beside the models (${BUILTIN_PROVIDER_IDS.join(', ')}).` }
export const KEY_ID = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$', description: 'A key\'s id, from ai.keys.list.' }
export const API_KEY = { type: 'string', minLength: 1, maxLength: 400, writeOnly: true, description: 'Stored encrypted with the server\'s key-encryption key and never shown again. For nounproject: key:secret.' }
const caps = (description) => ({
  type: 'object',
  properties: Object.fromEntries(PROVIDER_CAPS.map((key) => [key, { type: 'boolean' }])),
  additionalProperties: false,
  description,
})

export const providerInput = {
  type: 'object',
  properties: {
    preset: { type: 'string', enum: [...PRESET_IDS], description: 'What the provider is: meta (Muse), openai, anthropic, deepinfra, together, groq, fireworks, openrouter, mistral, xai, gemini, or other (any OpenAI-compatible address).' },
    id: { ...SLUG, description: 'Its id here; the preset\'s by default (meta, deepinfra, ...).' },
    label: { type: 'string', minLength: 1, maxLength: 80, description: 'The name shown; the preset\'s by default.' },
    baseUrl: { type: 'string', maxLength: 500, description: 'For other only: the address up to /v1. Named presets keep their own address.' },
    auth: {
      type: 'object',
      properties: { style: { type: 'string', enum: [...AUTH_STYLES] }, name: { type: 'string', maxLength: 64 } },
      required: ['style'],
      additionalProperties: false,
      description: 'For other only: bearer (Authorization: Bearer), header { name } or none.',
    },
    toolChoice: { type: 'string', enum: [...TOOL_CHOICES], description: 'For other only: how it takes a forced tool call.' },
    extraHeaders: { type: 'object', additionalProperties: { type: 'string', maxLength: 200 }, maxProperties: 10, description: 'For other only: headers sent with every request. Nothing secret.' },
  },
  required: ['preset'],
  additionalProperties: false,
}

export const providerChange = {
  type: 'object',
  properties: {
    id: SLUG,
    label: { type: 'string', minLength: 1, maxLength: 80 },
    baseUrl: { type: 'string', maxLength: 500, description: 'Other providers only. A new address revokes the provider\'s keys (send revokeKeys true).' },
    auth: providerInput.properties.auth,
    toolChoice: providerInput.properties.toolChoice,
    extraHeaders: providerInput.properties.extraHeaders,
  },
  required: ['id'],
  additionalProperties: false,
}

export const modelInput = {
  type: 'object',
  properties: {
    provider: { ...SLUG, description: 'The provider that serves it (ai.control.get lists them).' },
    model: { type: 'string', minLength: 1, maxLength: 200, description: 'The id the provider serves, for example muse-ember-1.0.' },
    label: { type: ['string', 'null'], maxLength: 80, description: 'The name shown, for example Muse Ember.' },
    capabilities: caps('What the model can do. A part of Slatebox refuses a model whose flags miss what it needs.'),
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
  required: ['provider', 'model'],
  additionalProperties: false,
}

/** A ModelError, KeyError or ProviderError as the action error every surface shows. */
export function asProblem(error) {
  if (error?.name === 'ModelError') {
    const code = error.status === 404 ? 'not_found' : error.status === 409 ? 'conflict' : error.status === 429 ? 'rate_limited' : error.status === 503 ? 'unavailable' : 'invalid_request'
    return problem(error.status, code, error.message, { ...(error.details && { details: error.details }), ...(error.details?.retryAfter && { retryAfter: error.details.retryAfter }) })
  }
  if (error?.name === 'ProviderError' || error?.name === 'ControlStoreError') return problem(400, 'invalid_request', error.message)
  return error
}
