// A tool call written as text. Some models served behind an OpenAI-compatible endpoint now and then answer a forced
// or offered tool with the call spelled out in the message text, in their own markup, instead of in tool_calls:
//
//   <atem:function_calls>
//   <atem:invoke name="draft_workshop">
//   <atem:parameter name="version">1</atem:parameter>
//   <atem:parameter name="lanes">[{"id": "kit", "label": "Kit"}]</atem:parameter>
//   </atem:invoke>
//   </atem:function_calls>
//
// (live eval of free-form smart components, 2026-11-25, Muse Ember: the baseline run of 46 prompts made 56 draft calls,
// 14 answers were refused and 3 prompts lost both attempts to end on the starter; a diagnostic run that logged each
// refused answer found 12 of its 18 were a complete board written this way). That is the same call, so it is read as
// one, only for a caller that opts in (req's textToolCalls: workshops.draft's lane boards and components) and only a
// complete invoke block (closed), naming a tool the request offered, with every parameter closed. A value that is
// JSON is read as JSON, else kept as the text it is. Nothing is guessed: anything else is no call, and the feature's
// own check and retry answer it as before. A parameter the tool's schema types as a string is kept as text (a title
// "2024" stays text). The arguments still go through the feature's own validation (validateWorkshop and the like),
// so this never lets a bad call through.

const INVOKE = /<(?:([A-Za-z][\w-]*):)?invoke\s+name\s*=\s*"([^"]{1,64})"\s*>([\s\S]*?)<\/(?:[A-Za-z][\w-]*:)?invoke\s*>/
const PARAMETER = /<(?:[A-Za-z][\w-]*:)?parameter\s+name\s*=\s*"([^"]{1,64})"\s*>([\s\S]*?)<\/(?:[A-Za-z][\w-]*:)?parameter\s*>/g

/**
 * The tool call a message's text spells out, or null. `tools`: the tools the request offered ({ name, parameters },
 * as req's functions); a name outside them is no call. → { id: null, name, arguments: object, fromText: true }
 */
export function textToolCall(content, tools = []) {
  if (typeof content !== 'string' || content.length > 200000 || !Array.isArray(tools) || !tools.length) return null
  const invoke = INVOKE.exec(content)
  const tool = invoke && tools.find((item) => item?.name === invoke[2])
  if (!tool) return null
  const properties = tool.parameters?.properties || {}
  const body = invoke[3]
  const args = {}
  let rest = body
  for (const [whole, name, raw] of body.matchAll(PARAMETER)) {
    if (Object.hasOwn(args, name)) return null
    const value = raw.trim()
    let read = value
    if (properties[name]?.type !== 'string') try { read = JSON.parse(value) } catch {}
    args[name] = read
    rest = rest.replace(whole, '')
  }
  // Only parameters (and white space) inside the block: a half-written or nested one is no call.
  if (rest.trim() || !Object.keys(args).length) return null
  return { id: null, name: invoke[2], arguments: args, fromText: true }
}
