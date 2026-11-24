// What a model answered, read the same way whatever shape req() returns it in: an SDK tool call
// ({ toolCall }), an Anthropic-style tool_use block (json.content), an OpenAI-style tool call
// (json.choices), or plain text. For test runs and the eval gate only: nothing here is applied.

const parseArgs = (value) => {
  if (value && typeof value === 'object') return value
  if (typeof value !== 'string') return {}
  try { return JSON.parse(value) } catch { return {} }
}

/** → { name, arguments } | null */
export function toolCallOf(response) {
  if (response?.toolCall?.name) return { name: response.toolCall.name, arguments: parseArgs(response.toolCall.arguments) }
  const block = Array.isArray(response?.json?.content) ? response.json.content.find((part) => part?.type === 'tool_use') : null
  if (block?.name) return { name: block.name, arguments: parseArgs(block.input) }
  const call = response?.json?.choices?.[0]?.message?.tool_calls?.[0]?.function
  if (call?.name) return { name: call.name, arguments: parseArgs(call.arguments) }
  return null
}

/** The answer's text, when it gave one. */
export function textOf(response) {
  const content = response?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.filter((part) => part?.type === 'text').map((part) => part.text).join('')
  const json = response?.json
  if (Array.isArray(json?.content)) return json.content.filter((part) => part?.type === 'text').map((part) => part.text).join('')
  const choice = json?.choices?.[0]?.message?.content
  return typeof choice === 'string' ? choice : ''
}

/** A check's verdict: ok, or what was wrong. */
export const verdict = (fn) => {
  try {
    const problem = fn()
    return problem ? { ok: false, problem } : { ok: true }
  } catch (error) {
    return { ok: false, problem: error?.message || 'The answer could not be used.' }
  }
}
