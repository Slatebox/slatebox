// The schemas of the two agent tools, exec and describe. One definition serves the exec.run
// action (POST /api/v1/exec), the hosted /mcp endpoint, the local MCP package and the CLI:
// generated/exec-tool.json is rendered from here.
import { EXEC_LIMITS } from '../exec/limits.mjs'

export const CONFIRM_PATTERN = '^cf_[A-Za-z0-9]{24}$'
export const KEY_PATTERN = '^[!-~]{1,128}$'
export const EXEC_ID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

// exec.run's own input. The registry owns `mode`; the tool schema adds it back (below).
export const execRunInput = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      description: 'One sentence a person can approve: what this script does.',
    },
    code: {
      type: 'string',
      minLength: 1,
      maxLength: EXEC_LIMITS.codeBytes,
      description: 'JavaScript or TypeScript function body. Top-level await and return.',
    },
    confirm: {
      type: 'string',
      pattern: CONFIRM_PATTERN,
      description: 'The confirmation id from a confirmation_required result, once the person agreed.',
    },
    idempotencyKey: {
      type: 'string',
      pattern: KEY_PATTERN,
      description: 'Reuse to retry or confirm the same script; its saved calls replay instead of repeating.',
    },
  },
  required: ['intent', 'code'],
  additionalProperties: false,
}

export const execModeProperty = {
  type: 'string',
  enum: ['save', 'preview'],
  default: 'save',
  description: 'preview runs every write in the script as a preview and saves nothing.',
}

export const execToolInput = {
  ...execRunInput,
  properties: {
    intent: execRunInput.properties.intent,
    code: execRunInput.properties.code,
    mode: execModeProperty,
    confirm: execRunInput.properties.confirm,
    idempotencyKey: execRunInput.properties.idempotencyKey,
  },
}

const callRecord = {
  type: 'object',
  properties: {
    n: { type: 'integer' },
    method: { type: 'string' },
    mode: { type: ['string', 'null'] },
    ok: { type: 'boolean' },
    status: { type: 'integer' },
    code: { type: 'string' },
    held: { type: 'boolean' },
    replayed: { type: 'boolean' },
    ms: { type: 'integer' },
    pending: {
      type: 'boolean',
      description: 'Still running when the script ended, so it may yet save. Rerun with the same idempotencyKey.',
    },
  },
  // A finished call has ok and status; a call still running when the script ended has pending.
  anyOf: [{ required: ['ok', 'status'] }, { required: ['pending'] }],
  required: ['n', 'method'],
}

const reason = {
  type: 'object',
  properties: {
    n: { type: 'integer' },
    rule: {
      type: 'string',
      enum: ['removes', 'rewrites_text', 'others_notes', 'widens_audience', 'widens_access', 'breaks_board_rule'],
    },
    shareId: { type: 'string' },
    count: { type: 'integer' },
    // breaks_board_rule: the board's rules each card moved anyway breaks, in the board's words (show them to the person).
    rules: { type: 'array', items: { type: 'string' } },
  },
  required: ['rule'],
}

export const execOutput = {
  type: 'object',
  properties: {
    execId: { type: 'string' },
    status: { type: 'string', enum: ['completed', 'failed', 'confirmation_required'] },
    mode: { type: 'string', enum: ['save', 'preview'] },
    idempotencyKey: { type: 'string' },
    result: { description: 'The JSON value the script returned (completed only).' },
    truncated: { type: 'object', properties: { chars: { type: 'integer' } }, required: ['chars'] },
    logs: { type: 'array', items: { type: 'string' } },
    calls: { type: 'array', items: callRecord },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        line: { type: 'integer' },
        column: { type: 'integer' },
        status: { type: 'integer' },
        details: {},
      },
      required: ['code', 'message'],
    },
    confirmation: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        expiresAt: { type: 'string' },
        reasons: { type: 'array', items: reason },
      },
      required: ['id', 'expiresAt', 'reasons'],
    },
    usage: {
      type: 'object',
      properties: {
        calls: { type: 'integer' },
        maxCalls: { type: 'integer' },
        operations: { type: 'integer' },
        notesCreated: { type: 'integer' },
        wallMs: { type: 'integer' },
        cpuMs: { type: 'integer' },
      },
      required: ['calls', 'maxCalls'],
    },
  },
  required: ['execId', 'status', 'mode', 'idempotencyKey', 'logs', 'calls', 'usage'],
}

export const describeInput = {
  type: 'object',
  properties: {
    query: { type: 'string', maxLength: 200, description: 'Words to find methods by name, title or summary.' },
    methods: {
      type: 'array',
      maxItems: 12,
      items: { type: 'string', maxLength: 80 },
      description: 'Method names, such as slates.applyOperations, to return their full declarations.',
    },
  },
  additionalProperties: false,
}

export const describeOutput = {
  type: 'object',
  properties: {
    contract: { type: 'string' },
    methods: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          kind: { type: 'string' },
          flags: { type: 'array', items: { type: 'string' } },
          scope: { type: ['string', 'null'] },
          modes: { type: 'array', items: { type: 'string' } },
          dts: { type: 'string' },
        },
        required: ['name', 'title', 'kind'],
      },
    },
    types: { type: 'string' },
    rules: { type: 'string' },
    errors: { type: 'array', items: { type: 'object' } },
    limits: { type: 'object' },
    recipes: {
      type: 'array',
      items: { type: 'object', properties: { title: { type: 'string' }, code: { type: 'string' } } },
    },
    instance: { type: 'object' },
  },
  required: ['contract', 'methods', 'rules'],
}
