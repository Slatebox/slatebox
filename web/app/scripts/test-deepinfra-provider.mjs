import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  getDeepInfraToolArguments,
  normalizeDeepInfraMessages,
  toDeepInfraToolChoice,
  toDeepInfraTools,
} from '../server/methods/ai/deepinfra.mjs'
import {
  AI_PROVIDERS,
  buildProviderBody,
  buildProviderTelemetry,
  getNormalizedAssistantContent,
  isAllowedPlainTextResponse,
  keepsFallbackAfterShapeExhaustion,
  normalizeProviderResponse,
  resolveAIRequestTimeout,
} from '../server/methods/ai/provider.mjs'
import {
  resolveWelcomeFunctionCall,
  validateWelcomeResponse,
  WELCOME_INSTRUCTION_MIN_WORDS,
} from '../server/methods/ai/welcome-response.mjs'
import validateGenerationResponse, {
  normalizeGenerationParentIds,
  shouldAttachGenerationOrphansToMain,
} from '../server/methods/ai/generation-response.mjs'

// Which provider, model and key answer a feature is chosen in Admin → AI control (the built-in
// model table, the provider and model resolution and the settings-file keys are gone); what stays
// here is the wire: message and tool shapes, telemetry, timeouts and response checks.
const TELEMETRY_MODEL = 'deepseek-ai/DeepSeek-V3'
const { CODE_LIMITS } = await import('../server/ai-control/resolve.mjs')
assert.equal(CODE_LIMITS.shapeRetries, 3, 'shape retry cap is a cost contract: 3 attempts per provider')
assert.equal(CODE_LIMITS.infraRetries, 2)
assert.equal(resolveAIRequestTimeout(), 90000)
assert.equal(resolveAIRequestTimeout({ requested: 100 }), 1000)
assert.equal(resolveAIRequestTimeout({ requested: 300000 }), 180000)
const telemetry = buildProviderTelemetry({
  provider: AI_PROVIDERS.deepinfra,
  model: TELEMETRY_MODEL,
  feature: 'presentation',
  status: 'success',
  usage: { totalTokens: 20 },
})
assert.deepEqual(telemetry, {
  provider: AI_PROVIDERS.deepinfra,
  model: TELEMETRY_MODEL,
  feature: 'presentation',
  status: 'success',
  duration: 0,
  responseStatus: null,
  usage: { totalTokens: 20 },
  errCount: 0,
  error: undefined,
  invalidPayloadLength: undefined,
  fallbackFromProvider: undefined,
  fallbackReason: undefined,
})
assert.equal('prompts' in telemetry, false)
assert.equal('response' in telemetry, false)

const welcomeMethodSource = await readFile(
  new URL('../server/methods/openai.js', import.meta.url),
  'utf8'
)
assert.equal(
  welcomeMethodSource.match(/fallback: welcomePrompt\.fallback/g)?.length || 0,
  0,
  'no welcome request names a fallback model: req.js tries the default model once after a failing service'
)
assert.equal(
  welcomeMethodSource.match(/allowPlainText: true/g)?.length,
  3,
  'only the three welcome provider requests opt into conversational text'
)
assert.equal(
  (welcomeMethodSource.match(/validateResponse: validateWelcomeResponse/g)
    ?.length || 0) +
    (welcomeMethodSource.match(/validateWelcomeResponse\(response,/g)?.length ||
      0),
  3,
  'every welcome provider request validates its tool response with slate context'
)
assert.equal(
  welcomeMethodSource.match(/maxResponseValidationRetries: 2/g)?.length,
  3,
  'chat-continuation ladder drops to 1 repair retry; preview, oneshot, and route keep 2'
)
assert.ok(
  welcomeMethodSource.includes('maxResponseValidationRetries: 1'),
  'chat-continuation must cap validation repairs at one retry'
)
assert.equal(
  welcomeMethodSource.match(/minLength: 1000/g)?.length,
  1,
  'setIntention must retain its provider-visible minimum length'
)
assert.match(
  welcomeMethodSource,
  /intentionItems:\s*{[\s\S]*?type: 'array',[\s\S]*?items:\s*{[\s\S]*?type: 'object'/,
  'setIntention intentionItems must use a valid array items schema'
)
assert.equal(WELCOME_INSTRUCTION_MIN_WORDS, 60)
// Fallback policy (ladder-cost): shape-exhausted aborts carry fallbackBlocked; the one fallback
// req.js makes (the default model) is for a failing service only, never for a shape failure.
assert.equal(keepsFallbackAfterShapeExhaustion('generation'), true)
assert.equal(keepsFallbackAfterShapeExhaustion('vision'), true)
assert.equal(keepsFallbackAfterShapeExhaustion('welcome'), false)
assert.equal(
  keepsFallbackAfterShapeExhaustion('welcome-route'),
  false,
  'route classifiers are welcome-layer shapes: the Nov 1 audit burst burned 6 fallback attempts, all dead',
)
assert.equal(
  keepsFallbackAfterShapeExhaustion(undefined),
  false,
  'unknown features default to the cost-safe block',
)
const reqSourceForPolicy = await readFile(
  new URL('../server/methods/ai/req.js', import.meta.url),
  'utf8',
)
assert.equal(
  reqSourceForPolicy.match(/!keepsFallbackAfterShapeExhaustion\(aiOpts\.feature\)/g)
    ?.length,
  2,
  'every shape-exhaustion path (validation, the invalid-JSON ladder) must run the fallback policy',
)
assert.match(reqSourceForPolicy, /first\.failure !== 'infra'/, 'the default model is tried only after a failing service')
assert.match(
  reqSourceForPolicy,
  /if \(errs >= (?:SHAPE_RETRY_LIMIT|\(aiOpts\.shapeRetries \?\? SHAPE_RETRY_LIMIT\))\)\s*\{[\s\S]{0,600}?return \{\s*abort: true,[\s\S]{0,200}fallbackBlocked:/,
  'the invalid-JSON ladder must DEGRADE at the cap with an explicit policy gate — the old throw re-entered the infra-failure catch and re-burned the full fallback ladder (12-call dead chains, audit share …427121)',
)
assert.doesNotMatch(
  reqSourceForPolicy,
  /throw Error\(`Unable to continue, error threshold/,
  'throw-on-exhaustion must stay retired (it routed shape failure into the fallback path)',
)
assert.match(
  reqSourceForPolicy,
  /const SHAPE_RETRY_LIMIT = CODE_LIMITS\.shapeRetries/,
  'shape retry cap is a cost contract: 3 attempts per provider, down from 6+6',
)
assert.deepEqual(
  resolveWelcomeFunctionCall(['Create a mind map!!'], { type: 'auto' }),
  { name: 'setIntention' }
)
assert.deepEqual(
  resolveWelcomeFunctionCall(['Tell me what I can make.'], { type: 'auto' }),
  { type: 'auto' }
)
assert.equal(
  validateWelcomeResponse({
    toolCall: {
      name: 'setIntention',
      arguments: { instructions: 'word '.repeat(150) },
    },
  }),
  null
)
assert.equal(
  validateWelcomeResponse({
    toolCall: {
      name: 'setIntention',
      arguments: { instructions: 'word '.repeat(80) },
    },
  }),
  null,
  'typical Qwen-length briefs must pass without burning a repair call',
)
assert.equal(
  validateWelcomeResponse({
    toolCall: { name: 'expandTemplates', arguments: { expand: true } },
  }),
  null
)
assert.equal(
  validateWelcomeResponse(
    { message: { content: 'Got it — I am building that now.' } },
    { requireSetIntention: true }
  )?.code,
  'welcomeIntentionRequired'
)
assert.equal(
  validateWelcomeResponse(
    { toolCall: { name: 'expandTemplates', arguments: { expand: true } } },
    { requireSetIntention: true }
  )?.code,
  'welcomeIntentionRequired'
)
assert.equal(
  validateWelcomeResponse({
    toolCall: {
      name: 'setIntention',
      arguments: { instructions: 'too short' },
    },
  })?.code,
  'welcomeInstructionsTooShort'
)
assert.match(
  welcomeMethodSource,
  /requireSetIntention: Boolean\(initialPrompt\)/,
  'one-shot onboarding must require a setIntention response'
)
assert.match(
  welcomeMethodSource,
  /function_call: initialPrompt\s*\? \{ name: 'setIntention' \}/,
  'one-shot onboarding must force the setIntention tool choice'
)
assert.equal(
  isAllowedPlainTextResponse({
    allowPlainText: true,
    message: { content: 'Here are the templates you can explore.' },
    toolCall: null,
  }),
  true
)
assert.equal(
  isAllowedPlainTextResponse({
    allowPlainText: false,
    message: { content: 'not valid JSON' },
    toolCall: null,
  }),
  false
)

const validGenerationToolCall = {
  name: 'respond',
  arguments: {
    categories: [
      {
        id: 'solar',
        description: 'Solar energy',
        parentCategoryIds: ['main'],
        isUpdate: false,
      },
    ],
    notes: [
      {
        id: 'panels01',
        description: 'Photovoltaic panels convert sunlight into electricity.',
        parentCategoryIds: ['solar'],
        isUpdate: false,
      },
    ],
    suggestion: 'Explore the renewable-energy branches next.',
  },
}
assert.equal(
  validateGenerationResponse({ toolCall: validGenerationToolCall }),
  null
)
assert.equal(validateGenerationResponse({})?.code, 'generationToolMissing')
assert.equal(
  validateGenerationResponse({
    toolCall: {
      ...validGenerationToolCall,
      arguments: {
        ...validGenerationToolCall.arguments,
        notes: [
          {
            ...validGenerationToolCall.arguments.notes[0],
            id: 'solar',
          },
        ],
      },
    },
  })?.code,
  'generationDuplicateNodeId'
)
assert.equal(
  validateGenerationResponse({
    toolCall: {
      ...validGenerationToolCall,
      arguments: {
        ...validGenerationToolCall.arguments,
        notes: [
          {
            ...validGenerationToolCall.arguments.notes[0],
            parentCategoryIds: [null],
          },
        ],
      },
    },
  })?.code,
  'generationParentReferencesInvalid'
)
assert.equal(
  validateGenerationResponse({
    toolCall: {
      ...validGenerationToolCall,
      arguments: {
        ...validGenerationToolCall.arguments,
        categories: 'not-an-array',
      },
    },
  })?.code,
  'generationCategoriesInvalid'
)
assert.deepEqual(
  normalizeGenerationParentIds(
    ['main', 'category_solar', 'main_category', 'category_main', 'wind'],
    { mainNodeId: 'root-node-id' }
  ),
  ['root-node-id', 'category_solar', 'category_wind']
)
assert.deepEqual(
  normalizeGenerationParentIds(['note_alpha', 'beta', 'main'], {
    mainNodeId: 'root-node-id',
    noteIds: ['alpha', 'note_beta'],
  }),
  ['note_alpha', 'note_beta', 'root-node-id']
)
assert.deepEqual(
  normalizeGenerationParentIds([], {
    mainNodeId: 'root-node-id',
    attachOrphansToMain: true,
  }),
  ['root-node-id']
)
assert.deepEqual(
  normalizeGenerationParentIds(['none'], {
    mainNodeId: 'root-node-id',
    attachOrphansToMain: false,
  }),
  []
)
assert.equal(
  shouldAttachGenerationOrphansToMain({
    mainNodeId: 'root-node-id',
    isAdhoc: false,
    layoutType: { val: 'dot' },
  }),
  true
)
assert.equal(
  shouldAttachGenerationOrphansToMain({
    mainNodeId: 'root-node-id',
    isAdhoc: false,
    layoutType: { val: 'none' },
  }),
  false
)
assert.equal(
  isAllowedPlainTextResponse({
    allowPlainText: true,
    message: { content: 'text alongside a tool' },
    toolCall: { name: 'setIntention' },
  }),
  false
)

const normalized = normalizeDeepInfraMessages(
  [
    {
      role: 'system',
      content: 'Use only supplied node IDs.',
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Analyze this canvas.',
          cache_control: { type: 'ephemeral' },
        },
      ],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          name: 'createPresentation',
          input: { viewpoints: [{ nodeIds: ['one'] }] },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          content: 'Viewpoints received.',
        },
      ],
    },
  ],
  'Create a concise presentation.'
)

assert.deepEqual(normalized[0], {
  role: 'user',
  content:
    'Create a concise presentation.\n\nUse only supplied node IDs.\n\nAnalyze this canvas.',
})
assert.match(normalized[1].content, /Previous createPresentation result/)
assert.match(normalized[2].content, /Tool result: Viewpoints received/)
assert.equal(JSON.stringify(normalized).includes('cache_control'), false)

const functions = [
  {
    name: 'createPresentation',
    description: 'Create viewpoints',
    parameters: { type: 'object', properties: {} },
  },
]
assert.deepEqual(toDeepInfraTools(functions), [
  {
    type: 'function',
    function: functions[0],
  },
])
assert.deepEqual(toDeepInfraToolChoice({ name: 'createPresentation' }), {
  type: 'function',
  function: { name: 'createPresentation' },
})

const providerBody = buildProviderBody({
  provider: AI_PROVIDERS.deepinfra,
  model: TELEMETRY_MODEL,
  prompts: [{ role: 'user', content: 'Lay this out.' }],
  system: 'Avoid overlap.',
  functions,
  functionCall: { name: 'createPresentation' },
})
assert.equal(providerBody.model, TELEMETRY_MODEL)
assert.equal(providerBody.tools[0].function.name, 'createPresentation')
assert.equal(providerBody.tool_choice.function.name, 'createPresentation')

const anthropicBody = buildProviderBody({
  provider: AI_PROVIDERS.anthropic,
  model: 'claude-3-7-sonnet-latest',
  prompts: [
    { role: 'system', content: 'Choose a Slatebox approach.' },
    { role: 'user', content: 'Create a pitch deck.' },
  ],
  functions,
})
assert.equal(anthropicBody.system, 'Choose a Slatebox approach.')
assert.deepEqual(anthropicBody.messages, [
  { role: 'user', content: 'Create a pitch deck.' },
])

const argumentsJson = JSON.stringify({
  name: 'Demo',
  viewpoints: [{ nodeIds: ['one'], narrative: 'Start', duration: 1000 }],
})
assert.equal(
  getDeepInfraToolArguments({
    tool_calls: [
      { function: { name: 'createPresentation', arguments: argumentsJson } },
    ],
  }),
  argumentsJson
)

assert.deepEqual(
  normalizeProviderResponse({
    provider: AI_PROVIDERS.deepinfra,
    response: {
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: 'call-1',
                function: {
                  name: 'createPresentation',
                  arguments: argumentsJson,
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
  }).toolCall,
  {
    id: 'call-1',
    name: 'createPresentation',
    arguments: JSON.parse(argumentsJson),
  }
)

const anthropicResponse = normalizeProviderResponse({
  provider: AI_PROVIDERS.anthropic,
  response: {
    content: [
      {
        id: 'tool-1',
        type: 'tool_use',
        name: 'updateLayout',
        input: { nodes: [{ id: 'one', x: 5, y: 10 }] },
      },
    ],
    usage: { input_tokens: 20, output_tokens: 8 },
  },
})
assert.deepEqual(anthropicResponse.toolCall, {
  id: 'tool-1',
  name: 'updateLayout',
  arguments: { nodes: [{ id: 'one', x: 5, y: 10 }] },
})
assert.deepEqual(anthropicResponse.usage, {
  inputTokens: 20,
  outputTokens: 8,
  totalTokens: 28,
})

const openAIResponse = normalizeProviderResponse({
  provider: AI_PROVIDERS.openai,
  response: {
    choices: [
      {
        message: {
          function_call: {
            name: 'updateLayout',
            arguments: '{"nodes":[]}',
          },
        },
      },
    ],
    usage: { prompt_tokens: 7, completion_tokens: 3 },
  },
})
assert.deepEqual(openAIResponse.toolCall, {
  id: undefined,
  name: 'updateLayout',
  arguments: { nodes: [] },
})
assert.deepEqual(openAIResponse.usage, {
  inputTokens: 7,
  outputTokens: 3,
  totalTokens: 10,
})
assert.deepEqual(getNormalizedAssistantContent(openAIResponse), [
  {
    type: 'tool_use',
    id: undefined,
    name: 'updateLayout',
    input: { nodes: [] },
  },
])
assert.deepEqual(
  getNormalizedAssistantContent({
    message: { content: 'What would you like to make?' },
    toolCall: null,
  }),
  [{ type: 'text', text: 'What would you like to make?' }]
)

assert.match(
  welcomeMethodSource,
  /const generationConfig = \{ feature: hasImagePayload \? 'vision' : 'generation' \}/,
  'all generation flows name their part (vision or generation), selected by payload modality (never by stale intention flags or provider inference); Admin → AI control picks the model'
)
assert.match(
  welcomeMethodSource,
  /useStrictGenerationValidation =\s*opts\.isConversation\?\.id === 'expert-collaborator'/,
  'strict generation validation must remain scoped to its compatible schema'
)
assert.match(
  welcomeMethodSource,
  /generationConfig && useStrictGenerationValidation[\s\S]*?validateGenerationResponse/,
  'expert generation must retain bounded response validation'
)
assert.match(
  welcomeMethodSource,
  /mainNodeId: opts\.mainNodeId,\s*layoutType: opts\.layoutType,/,
  'generation processing must receive layout semantics for orphan handling'
)

const processConversationSource = await readFile(
  new URL('../server/methods/ai/processConversation.js', import.meta.url),
  'utf8'
)
assert.match(
  processConversationSource,
  /response\.toolCall\?\.arguments != null/,
  'conversation parsing must prefer provider-normalized tool arguments'
)
assert.match(
  processConversationSource,
  /responseUsesClaude \|\| responseUsesDeepInfra[\s\S]*?getNormalizedAssistantContent\(response\)/,
  'DeepInfra assistant tool history must use normalized content'
)
assert.equal(
  processConversationSource.match(/normalizeGenerationParentIds\(/g)?.length,
  2,
  'categories and notes must map root aliases to the actual center node'
)

const aiContentListenerSource = await readFile(
  new URL('../imports/ui/components/ai/AIContentListener.jsx', import.meta.url),
  'utf8'
)
// RESTATED (P10): the retired layout service (layouts.calculate) is gone. AI
// content is laid out by the engine's tree layout through the live applier,
// which saves the move and sends it to everyone, as an agent's arrange_nodes is.
assert.match(
  aiContentListenerSource,
  /executeSlateOperations\(\{[\s\S]*?kind: 'arrange_nodes', target: \{ all: true \}, layout \}/,
  'AI content must be laid out by the engine layout an agent uses'
)
assert.doesNotMatch(aiContentListenerSource, /layouts\.calculate/, 'AI content must not call the retired layout service')
assert.match(
  aiContentListenerSource,
  /setTimeout\(\(\) => {[\s\S]*?slate\.controller\.scaleToFitAndCenter\(\)[\s\S]*?}, 600\)/,
  'AI content must fit the graph after the persisted layout animation'
)

const aiNodeSource = await readFile(
  new URL('../imports/api/common/ai.js', import.meta.url),
  'utf8'
)
assert.match(
  aiNodeSource,
  /parentNode\.relationships\.addAssociation\(node, baseAssocOpts\)/,
  'AI nodes must create relationships through the broadcasting v3 facade'
)
assert.doesNotMatch(
  aiNodeSource,
  /slate\.nodes\.add\([^\n]+, true,/,
  'AI node creation must not rely on removed v1 add callbacks'
)

// --- transient-failure retry policy (iteration 7) ---
const { isRetryableProviderFailure } = await import(
  '../server/methods/ai/provider.mjs'
)
const reqSource = await readFile(
  new URL('../server/methods/ai/req.js', import.meta.url),
  'utf8'
)

assert.equal(
  isRetryableProviderFailure(400, 'template error: list object has no element 0'),
  true,
  'DeepInfra cold-start template flake must be retryable'
)
assert.equal(isRetryableProviderFailure(429, 'rate limited'), true)
assert.equal(isRetryableProviderFailure(503, 'Server is too busy'), true)
assert.equal(isRetryableProviderFailure(500, 'internal error'), true)
assert.equal(isRetryableProviderFailure(401, 'invalid_api_key'), false)
assert.equal(isRetryableProviderFailure(403, 'quota exceeded'), false)
assert.equal(
  isRetryableProviderFailure(400, 'invalid request: unknown field foo'),
  false,
  'deterministic 4xx must fail fast, not burn retries'
)
assert.match(
  reqSource,
  /attempt <= maxInfraRetries[\s\S]*?isRetryableProviderFailure\(responseStatus, errorMessage\)/,
  'req must retry retryable provider errors before abort/fallback'
)
assert.match(
  reqSource,
  /providerInfraRetries \?\? INFRA_RETRY_LIMIT/,
  'retry budget must stay settings-overridable'
)

// --- payload-shape guards (iteration 9): empty-message + ghost tool_choice ---
{
  const b1 = buildProviderBody({
    provider: 'deepinfra',
    model: 'm',
    prompts: [{ role: 'user', content: [{ type: 'text' }] }],
  })
  assert.ok(
    b1.messages.length > 0 &&
      b1.messages.map((m) => m.content).join('').includes('no textual content'),
    'malformed history must not produce an empty messages array'
  )
  const b2 = buildProviderBody({
    provider: 'deepinfra',
    model: 'm',
    prompts: [{ role: 'user', content: 'hi' }],
    functions: [{ name: 'respond', parameters: {} }],
    functionCall: { name: 'setIntention' },
  })
  assert.ok(
    !b2.tool_choice,
    'forced tool_choice naming a missing tool must be dropped, not sent'
  )
  const b3 = buildProviderBody({
    provider: 'deepinfra',
    model: 'm',
    prompts: [{ role: 'user', content: 'hi' }],
    functions: [{ name: 'setIntention', parameters: {} }],
    functionCall: { name: 'setIntention' },
  })
  assert.equal(
    b3.tool_choice?.function?.name,
    'setIntention',
    'valid forced tool_choice must be preserved'
  )
}

// --- contentless-kick containment (iteration 11) ---
const initConvSource = await readFile(
  new URL('../imports/api/common/initAIConversation.js', import.meta.url),
  'utf8'
)
const chatSource = await readFile(
  new URL('../imports/ui/components/ai/SlateAIRunner.jsx', import.meta.url),
  'utf8'
)
assert.match(
  initConvSource,
  /if \(!aiPrompts\.length\)[\s\S]{0,700}abort: true/,
  'assembly must abort loudly when every prompt was dropped, not fire a contentless kick'
)
assert.match(
  initConvSource,
  /AI prompt dropped \(unresolved placeholders\)/,
  'dropped prompts must warn instead of silently vanishing'
)
assert.match(
  chatSource,
  /if \(initResult\?\.abort\)[\s\S]{0,800}setOutstandingAIRequests\(false\)[\s\S]{0,300}return\n      \}/,
  'chat UI must surface aborted conversations and release the spinner, not set a null context'
)

// the built-in default is Meta Muse Ember (Admin → AI control), never a legacy claude model
const { BUILTIN_DEFAULT } = await import('../server/ai-control/provider-presets.mjs')
assert.deepEqual(BUILTIN_DEFAULT, { preset: 'meta', model: 'muse-ember-1.0' })
const openaiSource = await readFile(
  new URL('../server/methods/openai.js', import.meta.url),
  'utf8'
)
assert.match(
  openaiSource,
  /hasImagePayload \? 'vision' : 'generation'/,
  'vision feature must be payload-modality driven'
)
assert.doesNotMatch(
  openaiSource,
  /aiDecision\?\.isVision \? 'vision'/,
  'stale intention isVision flags must not drive model routing'
)


console.log('AI provider contract checks passed')
