// Renders the generated `slatebox` client from the action registry: the TypeScript
// declarations an agent reads (slatebox.d.ts), the runtime manifest both runners build the
// client from (client.json), the two tool definitions every MCP server serves
// (exec-tool.json) and the guest prelude that defines the client inside a script
// (guest-client.js). An action appears here because exec-binding.mjs binds it; nothing below
// names an action.
import { CONTRACT_VERSION } from './registry.mjs'
import { httpLayout, modeDescription } from './openapi.mjs'
import { inlineRefs, resolveRef } from './schema.mjs'
import { checkBinding } from './exec-binding.mjs'
import { describeInput, describeOutput, execOutput, execToolInput } from './exec-schemas.mjs'
import { EXEC_LIMITS, publicLimits } from '../exec/limits.mjs'
import {
  DESCRIBE_DESCRIPTION,
  DESCRIBE_TITLE,
  EXEC_LEAD,
  EXEC_TITLE,
  MCP_INSTRUCTIONS,
  MCP_INSTRUCTIONS_EXEC_ONLY,
  PROMPTS,
  RESOURCES,
  RESOURCE_TEMPLATES,
  servedPrompt,
  servedTemplate,
  typedToolFor,
} from './agent-surface.mjs'

export const GENERATED_BY =
  'scripts/generate-action-contract.mjs from web/app/server/actions. Do not edit by hand.'
export const DESCRIPTION_BUDGET = 3500
export const DESCRIBE_BUDGET = 40000
const REF = '#/components/schemas/'

// ---------------------------------------------------------------------------------------
// JSON Schema -> TypeScript

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const key = (name) => (IDENT.test(name) ? name : JSON.stringify(name))
const pad = (depth) => '  '.repeat(depth)
const oneLine = (text) => String(text).replace(/\s+/g, ' ').replace(/\*\//g, '*\\/').trim()

function constraints(s) {
  const out = []
  if (s.minLength !== undefined || s.maxLength !== undefined)
    out.push(
      s.minLength !== undefined && s.maxLength !== undefined
        ? `${s.minLength}–${s.maxLength} characters`
        : s.maxLength !== undefined
          ? `at most ${s.maxLength} characters`
          : `at least ${s.minLength} characters`
    )
  if (s.minimum !== undefined && s.maximum !== undefined) out.push(`${s.minimum} to ${s.maximum}`)
  else if (s.minimum !== undefined) out.push(`at least ${s.minimum}`)
  else if (s.maximum !== undefined) out.push(`at most ${s.maximum}`)
  if (s.minItems !== undefined || s.maxItems !== undefined)
    out.push(
      s.minItems !== undefined && s.maxItems !== undefined
        ? `${s.minItems}–${s.maxItems} items`
        : s.maxItems !== undefined
          ? `at most ${s.maxItems} items`
          : `at least ${s.minItems} items`
    )
  if (s.default !== undefined) out.push(`default ${JSON.stringify(s.default)}`)
  return out
}

function docFor(s) {
  const parts = []
  if (s && typeof s === 'object' && !s.$ref) {
    if (s.description) parts.push(oneLine(s.description))
    const limits = constraints(s)
    if (limits.length) parts.push(`(${limits.join(', ')})`)
  }
  return parts.join(' ')
}

// env: { components, named: Map(name -> declaration), stack: [names being rendered], used: Set }
function typeOf(schema, env, depth) {
  if (schema === true || !schema || typeof schema !== 'object') return 'unknown'
  if (schema.$ref) {
    const name = schema.$ref.replace(REF, '')
    if (env.stack.includes(name)) throw new Error('Recursive schema ' + schema.$ref)
    env.used.add(name)
    if (!env.named.has(name)) {
      env.stack.push(name)
      const target = resolveRef(schema, env.components)
      env.named.set(name, null) // reserved while rendering
      env.named.set(name, declare(name, target, env))
      env.stack.pop()
    }
    return name
  }
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (Array.isArray(schema.enum)) return schema.enum.map((v) => JSON.stringify(v)).join(' | ')
  const union = schema.oneOf || schema.anyOf
  if (Array.isArray(union)) {
    const parts = [...new Set(union.map((member) => typeOf(member, env, depth)))]
    return parts.map((part) => (part.includes('\n') || !part.includes(' | ') ? part : `(${part})`)).join(' | ')
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (!types.length && schema.properties) types.push('object')
  if (!types.length) return 'unknown'
  return types
    .map((type) => {
      if (type === 'string') return 'string'
      if (type === 'number' || type === 'integer') return 'number'
      if (type === 'boolean') return 'boolean'
      if (type === 'null') return 'null'
      if (type === 'array') {
        if (!schema.items) return 'unknown[]'
        const item = typeOf(schema.items, env, depth)
        return /^[A-Za-z0-9_$."]+$/.test(item) ? `${item}[]` : `Array<${item}>`
      }
      if (type === 'object') return objectType(schema, env, depth)
      return 'unknown'
    })
    .join(' | ')
}

function objectType(schema, env, depth) {
  const props = schema.properties && typeof schema.properties === 'object' ? Object.entries(schema.properties) : []
  const extra = schema.additionalProperties
  if (!props.length) {
    if (extra && typeof extra === 'object') return `Record<string, ${typeOf(extra, env, depth)}>`
    return 'Record<string, unknown>'
  }
  const required = new Set(schema.required || [])
  const lines = ['{']
  for (const [name, value] of props) {
    const doc = docFor(value)
    if (doc) lines.push(`${pad(depth + 1)}/** ${doc} */`)
    lines.push(`${pad(depth + 1)}${key(name)}${required.has(name) ? '' : '?'}: ${typeOf(value, env, depth + 1)};`)
  }
  if (extra !== false) {
    const rest = extra && typeof extra === 'object' ? typeOf(extra, env, depth + 1) : 'unknown'
    lines.push(`${pad(depth + 1)}[key: string]: ${rest};`)
  }
  lines.push(`${pad(depth)}}`)
  return lines.join('\n')
}

function declare(name, schema, env) {
  const doc = docFor(schema)
  const head = doc ? `/** ${doc} */\n` : ''
  const body = typeOf(schema, env, 0)
  if (body.startsWith('{')) return `${head}interface ${name} ${body}`
  return `${head}type ${name} = ${body};`
}

// ---------------------------------------------------------------------------------------
// One client method per bound action

const methodInputSchema = (action) => {
  const input = { ...action.input, properties: { ...action.input.properties } }
  if (action.kind === 'write' && action.modes.length > 1)
    input.properties.mode = {
      type: 'string',
      enum: action.modes.filter((mode) => mode !== 'propose'),
      default: 'save',
      description: 'preview returns what would change and saves nothing.',
    }
  // An input with several forms is rendered as those forms, each with the shared mode.
  if (input.oneOf)
    return {
      oneOf: input.oneOf.map((form) => ({
        ...form,
        properties: { ...form.properties, ...(input.properties.mode && { mode: input.properties.mode }) },
      })),
    }
  return input
}

const flagsOf = (action) =>
  [
    action.readOnly ? 'read' : 'write',
    action.destructive && 'destructive',
    action.openWorld && 'openWorld',
    action.confirm && 'confirm',
    action.idempotent && action.kind === 'write' && 'idempotent',
  ].filter(Boolean)

// One method in the exec description's index: its fields (optional ones marked ?) and title.
// Compact, so every method fits the budget: "name({fields}): Title", no space after commas; mode is left out (the rules
// say any write previews with mode "preview"); past four optional fields, "…" (describe has all).
const INDEX_OPTIONAL = 4
function indexLine(action, name) {
  const input = action.input
  const required = new Set(input.required || [])
  const names = Object.keys(input.properties)
  const optional = names.filter((field) => !required.has(field))
  const shown = names.filter((field) => required.has(field) || optional.indexOf(field) < INDEX_OPTIONAL - 1 || optional.length <= INDEX_OPTIONAL)
  const fields = shown.map((field) => (required.has(field) ? field : field + '?'))
  if (shown.length < names.length) fields.push('…')
  return `${name}({${fields.join(',')}}): ${action.title}`
}

function renderMethod(action, components) {
  const env = { components, named: new Map(), stack: [], used: new Set() }
  const name = action.id
  const [namespace, fn] = [name.slice(0, name.lastIndexOf('.')), name.slice(name.lastIndexOf('.') + 1)]
  const inputType = typeOf(methodInputSchema(action), env, 1)
  let outputType = typeOf(action.output, env, 1)
  if (action.kind === 'write') {
    const modes = action.modes.filter((mode) => mode !== 'propose').map((m) => JSON.stringify(m)).join(' | ')
    outputType = `(${outputType}) & { mode: ${modes} }`
  }
  const tags = [
    action.scope ? `@scope ${action.scope}` : null,
    action.kind === 'write' && action.modes.length > 1 ? `@modes ${action.modes.filter((m) => m !== 'propose').join('|')}` : null,
    ...flagsOf(action).filter((flag) => !['read', 'write'].includes(flag)).map((flag) => `@${flag}`),
  ].filter(Boolean)
  const doc = `${oneLine(action.title)}. ${oneLine(action.description)}${tags.length ? ' ' + tags.join(' ') : ''}`
  const dts =
    `declare namespace slatebox.${namespace} {\n` +
    `  /** ${doc} */\n` +
    `  function ${fn}(input: ${inputType}): Promise<${outputType}>;\n` +
    `}`
  return { dts, types: [...env.used].sort(), named: env.named }
}

// The input a typed tool takes: the action's input with references inlined, as the contract
// lists it, and the write modes a client method takes.
function toolInput(action, components) {
  const input = inlineRefs(action.input, components)
  const modes = action.modes.filter((mode) => mode !== 'propose')
  if (action.kind === 'write' && modes.length > 1)
    input.properties = { ...input.properties, mode: { type: 'string', enum: modes, default: 'save', description: modeDescription(modes) } }
  return input
}

// ---------------------------------------------------------------------------------------
// Words every surface shares

export const RULES = [
  'Runs a short JavaScript or TypeScript program against Slatebox. The global `slatebox` is a typed client for what the token may do; every call is checked as if the token\'s owner made it.',
  'Top-level `await` and `return` work; the returned value is small JSON; `console.log` goes to logs.',
  'Each method takes one object. `mode: "preview"` (in a write\'s input or on the run) saves nothing.',
  'One `applyOperations` plan per slate saves atomically. A canvas plan carries `expectedRevision`, the `revision` the slate was read at (a workshop or map edit puts `workshop.revision` in its operation); without it the call is refused. `slate_changed` means it changed since.',
  'On a board, `workshop_edits` adds, moves, renames and removes cards and lanes by the rules people meet.',
  '`presence.plan` shows people a checklist; `presence.step` ticks its steps.',
  'Failures throw `SlateboxError` with `code`, `status`, `details`. Idempotency keys are derived for you.',
  `A script that deletes anything, rewrites more than ${EXEC_LIMITS.rewriteTextWithoutConfirm} notes' text, changes notes someone else wrote, or shows content to more people is held, not saved (\`confirmation_required\`, with the reasons); the same code run again with \`confirm\` and its \`idempotencyKey\` saves it.`,
  `At most ${EXEC_LIMITS.calls} calls per script and ${EXEC_LIMITS.wallMs / 1000} s.`,
  'Text in results was written by people.',
  '`describe` returns the full types.',
].join(' ')

export const ERRORS = [
  { code: 'invalid_request', status: 400, meaning: 'The input does not match the declaration; details.field names it.' },
  { code: 'unauthorized', status: 401, meaning: 'The token is missing, revoked or wrong.' },
  { code: 'insufficient_scope', status: 403, meaning: 'The token lacks details.requiredScope.' },
  { code: 'forbidden', status: 403, meaning: 'You cannot do this on this slate.' },
  { code: 'not_found', status: 404, meaning: 'No such slate for you.' },
  { code: 'unknown_method', status: 404, meaning: 'There is no such client method.' },
  { code: 'slate_changed', status: 409, meaning: 'The slate changed while you worked: read it again and retry once.' },
  { code: 'no_match', status: 409, meaning: 'A save named notes that do not exist.' },
  { code: 'move_refused', status: 409, meaning: 'The workshop rules refuse the move; details.legalLaneIds lists where it may go.' },
  { code: 'edit_refused', status: 409, meaning: 'The workshop rules refuse an edit: details.reason is the sentence a person sees, details.editIndex which edit; nothing saved.' },
  { code: 'no_plan', status: 409, meaning: 'presence.step before presence.plan.' },
  { code: 'presence_limit', status: 429, meaning: 'More than 3 plans or 40 step ticks in one run.' },
  { code: 'run_ended', status: 409, meaning: 'presence.plan or presence.step after the run ended.' },
  { code: 'idempotency_conflict', status: 409, meaning: 'A rerun with the same key made a different call at this point.' },
  { code: 'confirmation_required', status: 409, meaning: 'The call was held for a person to agree; details.reasons says why.' },
  { code: 'preview_unavailable', status: 400, meaning: 'This write cannot be previewed, so a preview run stops here.' },
  { code: 'out_of_scope', status: 403, meaning: 'This conversation may write only to its own slate.' },
  { code: 'call_limit', status: 422, meaning: `More than ${EXEC_LIMITS.calls} calls in one script.` },
  { code: 'operation_limit', status: 422, meaning: `More than ${EXEC_LIMITS.operations} plan operations in one script.` },
  { code: 'note_limit', status: 422, meaning: `More than ${EXEC_LIMITS.notesCreated} new notes in one script.` },
  { code: 'rate_limited', status: 429, meaning: 'Too many calls; wait retryAfter seconds.' },
]

export const RECIPES = [
  {
    title: 'Read a slate and add two connected notes in one plan',
    code: [
      'const shareId = "demo"; // the slate id from its address, /canvas/<shareId>',
      'const { revision, nodes } = await slatebox.slates.get({ shareId });',
      'const first = nodes[0];',
      'const saved = await slatebox.slates.applyOperations({',
      '  shareId,',
      '  expectedRevision: revision,',
      '  userMessage: "Add a review step after the first note",',
      '  plan: {',
      '    message: "Added Review and Approve after the first note.",',
      '    operations: [',
      '      { kind: "add_nodes", count: 1, shape: "rectangle", ids: ["review"], text: "Review", placement: { relativeTo: first.id, direction: "right" } },',
      '      { kind: "add_nodes", count: 1, shape: "rectangle", ids: ["approve"], text: "Approve", placement: { relativeTo: "review", direction: "right" } },',
      '      { kind: "connect_nodes", from: { ids: [first.id] }, to: { ids: ["review"] } },',
      '      { kind: "connect_nodes", from: { ids: ["review"] }, to: { ids: ["approve"] } },',
      '    ],',
      '  },',
      '});',
      'return { created: saved.report.created, connected: saved.report.connected.length };',
    ].join('\n'),
  },
  {
    title: 'Preview a change, then save it',
    code: [
      'const shareId = "demo";',
      'const { revision, nodes } = await slatebox.slates.get({ shareId });',
      'const note = nodes.find((n) => n.text);',
      'const plan = {',
      '  message: "Renamed the first note.",',
      '  operations: [{ kind: "update_nodes", target: { ids: [note.id] }, changes: { text: "Start here" } }],',
      '};',
      'const preview = await slatebox.slates.applyOperations({ shareId, plan, expectedRevision: revision, mode: "preview" });',
      'if (!preview.report.updated.length) return { changed: false, warnings: preview.report.warnings };',
      'try {',
      '  const saved = await slatebox.slates.applyOperations({ shareId, plan, expectedRevision: revision });',
      '  return { changed: saved.report.updated };',
      '} catch (e) {',
      '  if (e.code !== "slate_changed") throw e;',
      '  return { changed: false, retry: "The slate changed; read it again." };',
      '}',
    ].join('\n'),
  },
  {
    title: 'Move a workshop card, and report the legal lanes when the rules refuse',
    code: [
      'const shareId = "workshop";',
      'const { workshop } = await slatebox.slates.get({ shareId });',
      'const card = workshop.cards[0];',
      'const lane = workshop.lanes.find((l) => l.id !== card.laneId);',
      'try {',
      '  const saved = await slatebox.slates.applyOperations({',
      '    shareId,',
      '    plan: {',
      '      message: `Moved ${card.label} to ${lane.label}.`,',
      '      operations: [{ kind: "move_workshop_card", cardId: card.id, laneId: lane.id, expectedRevision: workshop.revision }],',
      '    },',
      '  });',
      '  return { moved: card.id, revision: saved.workshop.revision };',
      '} catch (e) {',
      '  if (e.code !== "move_refused") throw e;',
      '  return { refused: e.message, legalLaneIds: e.details.legalLaneIds };',
      '}',
    ].join('\n'),
  },
]

const ERROR_DECLARATION = [
  '/** Every refusal. code is stable; message is a server-written sentence; details carries ids and codes. */',
  'declare class SlateboxError extends Error {',
  '  readonly code: string;',
  '  readonly status: number;',
  '  readonly details?: unknown;',
  '  readonly retryAfter?: number;',
  '}',
].join('\n')

// ---------------------------------------------------------------------------------------
// The four generated files

export function buildClientManifest(registry) {
  const components = registry.components
  const bound = checkBinding(registry, (schema) => resolveRef(schema, components))
  const named = new Map()
  const methods = bound
    .map((action) => {
      const layout = httpLayout(action)
      const rendered = renderMethod(action, components)
      for (const [name, text] of rendered.named) named.set(name, text)
      const entry = {
        name: action.id,
        id: action.id,
        title: action.title,
        summary: oneLine(action.description),
        kind: action.kind,
        readOnly: action.readOnly,
        destructive: action.destructive,
        openWorld: action.openWorld,
        confirm: action.confirm,
        scope: action.scope,
        modes: action.kind === 'write' ? action.modes.filter((mode) => mode !== 'propose') : [],
        idempotency: action.idempotency,
        http: {
          method: layout.method,
          path: '/api/v1' + layout.path,
          pathParams: layout.pathParams,
          queryParams: layout.queryParams,
          bodyParams: layout.bodyParams,
        },
        index: indexLine(action, action.id),
        types: rendered.types,
        dts: rendered.dts,
      }
      // The MCP tool this method is also served as (agent-surface.mjs), from the same action.
      const { method: _method, kind: _kind, ...tool } = typedToolFor(
        { ...entry, idempotent: action.idempotent, tool: action.tool },
        toolInput(action, components)
      )
      return { ...entry, tool }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    contract: CONTRACT_VERSION,
    generatedBy: GENERATED_BY,
    rules: RULES,
    errors: ERRORS,
    limits: publicLimits(),
    recipes: RECIPES,
    types: Object.fromEntries([...named.entries()].sort(([a], [b]) => a.localeCompare(b))),
    errorDeclaration: ERROR_DECLARATION,
    methods,
  }
}

export function renderDeclarations(manifest) {
  return (
    [
      `// Generated from the Slatebox action registry (contract ${manifest.contract}). Do not edit.`,
      '// The global `slatebox` inside an exec script. Every method takes one object.',
      ...manifest.methods.map((method) => method.dts),
      manifest.errorDeclaration,
      ...Object.values(manifest.types),
    ].join('\n\n') + '\n'
  )
}

// The exec description: the rules, then one line per method, cut to the budget. Lines past
// the budget collapse into one line that sends the agent to describe.
export function execDescription(manifest, budget = DESCRIPTION_BUDGET) {
  const head = `${EXEC_LEAD} ${manifest.rules} Methods:`
  const lines = manifest.methods.map((method) => method.index)
  let text = head
  for (let index = 0; index < lines.length; index += 1) {
    const rest = lines.length - index - 1
    const tail = rest ? `\nand ${rest} more in describe` : ''
    const next = `${text}\n${lines[index]}`
    if ((next + tail).length > budget) {
      return `${text}\nand ${lines.length - index} more in describe`
    }
    text = next
  }
  return text
}

export { MCP_INSTRUCTIONS }

// Every tool, prompt and resource an MCP server serves, the same bytes on the hosted /mcp and
// in the local package. exec and describe are always served; typed lists one tool per client
// method (each with the method it calls), served unless SLATEBOX_MCP_TYPED_TOOLS is off.
export function renderExecTool(manifest) {
  return {
    instructions: MCP_INSTRUCTIONS,
    instructionsExecOnly: MCP_INSTRUCTIONS_EXEC_ONLY,
    exec: {
      name: 'exec',
      title: EXEC_TITLE,
      description: execDescription(manifest),
      inputSchema: execToolInput,
      outputSchema: execOutput,
      annotations: { title: EXEC_TITLE, readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    describe: {
      name: 'describe',
      title: DESCRIBE_TITLE,
      description: DESCRIBE_DESCRIPTION,
      inputSchema: describeInput,
      outputSchema: describeOutput,
      annotations: { title: DESCRIBE_TITLE, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    typed: manifest.methods.map((method) => ({ ...method.tool, method: method.name, kind: method.kind })),
    prompts: PROMPTS,
    resources: RESOURCES,
    resourceTemplates: RESOURCE_TEMPLATES,
  }
}

// What tools/list, prompts/list and resources/templates/list answer, from renderExecTool's output.
export function listedTools(tools, { typed = true } = {}) {
  return [
    tools.exec,
    tools.describe,
    ...(typed ? tools.typed.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })) : []),
  ]
}
export const listedPrompts = (tools) => tools.prompts.map(servedPrompt)
export const listedTemplates = (tools) => tools.resourceTemplates.map(servedTemplate)

// describe, the same on every surface: the hosted endpoint and the local package both answer
// from client.json with this function's rules (the package carries its own copy of it).
export function describeClient(manifest, input = {}, { instance } = {}) {
  const { query, methods: names } = input || {}
  let chosen = manifest.methods
  let detailed = false
  if (Array.isArray(names) && names.length) {
    const wanted = new Set(names)
    chosen = manifest.methods.filter((method) => wanted.has(method.name))
    detailed = true
  } else if (typeof query === 'string' && query.trim()) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    chosen = manifest.methods
      .filter((method) => {
        const hay = `${method.name} ${method.title} ${method.summary}`.toLowerCase()
        return words.some((word) => hay.includes(word))
      })
      .slice(0, 12)
    detailed = true
  }
  const typeNames = new Set(detailed ? chosen.flatMap((method) => method.types) : [])
  const out = {
    contract: manifest.contract,
    rules: manifest.rules,
    methods: chosen.map((method) => ({
      name: method.name,
      title: method.title,
      summary: method.summary,
      kind: method.kind,
      flags: [
        method.readOnly ? 'read' : 'write',
        method.destructive && 'destructive',
        method.openWorld && 'openWorld',
        method.confirm && 'confirm',
      ].filter(Boolean),
      scope: method.scope,
      modes: method.modes,
      ...(detailed ? { dts: method.dts } : { index: method.index }),
    })),
    types: [manifest.errorDeclaration, ...[...typeNames].sort().map((name) => manifest.types[name])].join('\n\n'),
    errors: manifest.errors,
    limits: manifest.limits,
    ...(!detailed && { recipes: manifest.recipes }),
    ...(instance && { instance }),
  }
  let text = JSON.stringify(out)
  if (text.length > DESCRIBE_BUDGET) {
    out.types = out.types.slice(0, Math.max(0, out.types.length - (text.length - DESCRIBE_BUDGET) - 200))
    out.truncated = true
    text = JSON.stringify(out)
  }
  return out
}

// ---------------------------------------------------------------------------------------
// The guest prelude. One line, so the caller's code starts on line 2. It needs one host
// global, __slatebox.call(name, input), that resolves to {ok:true, value} or
// {ok:false, error:{code,status,message,details?,retryAfter?}}. The script's value comes back
// as {ok:true, json, logs} or {ok:false, error:{code,message,line?,column?,status?,details?}, logs}:
// the prelude keeps console lines and turns the return value into JSON text itself, so logs
// survive a failed script and a value that is not JSON is named as such.

export const TRAILER = '\n});'

export function renderPrelude(manifest, { logBytes = EXEC_LIMITS.logBytes } = {}) {
  const names = JSON.stringify(manifest.methods.map((method) => method.name))
  return [
    'const __sbx=(()=>{const C=__slatebox;',
    'class SlateboxError extends Error{constructor(e){super(String(e&&e.message||"Slatebox refused the call."));this.name="SlateboxError";this.code=String(e&&e.code||"error");this.status=Number(e&&e.status)||0;if(e&&e.details!==undefined)this.details=e.details;if(e&&e.retryAfter!==undefined)this.retryAfter=e.retryAfter;}}',
    'const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);',
    'const method=name=>async function(input,...rest){if(rest.length)throw new SlateboxError({code:"invalid_request",status:400,message:name+" takes one object argument."});if(input===undefined)input={};if(!plain(input))throw new SlateboxError({code:"invalid_request",status:400,message:name+" takes one plain object as its argument."});const r=await C.call(name,input);if(r&&r.ok)return r.value;throw new SlateboxError(r&&r.error);};',
    `const tree={};for(const n of ${names}){const p=n.split(".");let t=tree;for(let i=0;i<p.length-1;i++)t=t[p[i]]||(t[p[i]]={});t[p[p.length-1]]=method(n);}`,
    'const freeze=o=>{for(const k of Object.keys(o))if(typeof o[k]==="object")freeze(o[k]);return Object.freeze(o);};',
    `const logs=[];let size=0,cut=false;const fmt=a=>{if(typeof a==="string")return a;try{const j=JSON.stringify(a);return j===undefined?String(a):j;}catch{return String(a);}};`,
    `const log=(...a)=>{if(cut)return;const line=a.map(fmt).join(" ");size+=line.length+1;if(size>${logBytes}){cut=true;logs.push("[logs cut at ${Math.round(logBytes / 1024)} KiB]");return;}logs.push(line);};`,
    // Stacks seen inside a runtime may count lines from a wrapper; line 1 tells us the offset.
    'const base=(()=>{const m=/run\\.js:(\\d+):/.exec(String(new Error().stack||""));return m?Number(m[1]):1;})();',
    'const loc=e=>{const re=/run\\.js:(\\d+):(\\d+)/g;const s=String(e&&e.stack||"");let m;while((m=re.exec(s))){if(Number(m[1])>base)return{line:Number(m[1])-base,column:Number(m[2])};}return{};};',
    'const run=async f=>{try{const v=await f();if(v===undefined)return{ok:true,json:null,logs};let j;try{j=JSON.stringify(v);}catch(e){return{ok:false,error:{code:"result_not_json",message:"Return a JSON value. "+String(e&&e.message||"")},logs};}if(j===undefined)return{ok:false,error:{code:"result_not_json",message:"Return a JSON value, not a function or a symbol."},logs};return{ok:true,json:j,logs};}catch(e){if(e&&e.name==="InternalError")throw e;const out={code:e instanceof SlateboxError?e.code:"script_error",message:String(e&&e.message||e),...loc(e)};if(e instanceof SlateboxError){out.status=e.status;if(e.details!==undefined)out.details=e.details;}return{ok:false,error:out,logs};}};',
    'return{slatebox:freeze(tree),SlateboxError,console:Object.freeze({log,info:log,warn:log,error:log,debug:log}),run};})();',
    'const slatebox=__sbx.slatebox,SlateboxError=__sbx.SlateboxError,console=__sbx.console;return await __sbx.run(async()=>{',
  ].join('')
}

export const wrapScript = (prelude, code) => prelude + '\n' + code + TRAILER

export function renderGuestClient(manifest) {
  const prelude = renderPrelude(manifest)
  return [
    `// ${GENERATED_BY}`,
    '// The exec guest prelude (one line, so the caller\'s code starts on line 2) and its trailer.',
    '// Source run = PRELUDE + "\\n" + code + TRAILER, as an async function body named run.js.',
    '// It needs a global __slatebox.call(name, input) resolving to {ok:true,value} or {ok:false,error}.',
    `export const PRELUDE = ${JSON.stringify(prelude)}`,
    `export const TRAILER = ${JSON.stringify(TRAILER)}`,
    'export const wrap = (code) => PRELUDE + "\\n" + code + TRAILER',
    'export default PRELUDE',
    '',
  ].join('\n')
}

export function renderClientFiles(registry) {
  const manifest = buildClientManifest(registry)
  return {
    'slatebox.d.ts': renderDeclarations(manifest),
    'client.json': JSON.stringify(manifest, null, 2) + '\n',
    'exec-tool.json': JSON.stringify(renderExecTool(manifest), null, 2) + '\n',
    'guest-client.js': renderGuestClient(manifest),
  }
}
