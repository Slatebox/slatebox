// The OpenAI-compatible message and tool shapes DeepInfra (and every OpenAI-compatible endpoint)
// takes. Which address, model and key a request uses comes from Admin → AI control.

export function flattenDeepInfraContent(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content)

  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part?.type === 'text') return part.text || ''
      if (part?.type === 'tool_use') {
        return `Previous ${part.name || 'tool'} result: ${JSON.stringify(
          part.input || {}
        )}`
      }
      if (part?.type === 'tool_result') {
        return `Tool result: ${flattenDeepInfraContent(part.content)}`
      }
      return JSON.stringify(part)
    })
    .filter(Boolean)
    .join('\n')
}

export function normalizeDeepInfraMessages(prompts = [], system = '') {
  const embeddedSystem = prompts
    .filter((prompt) => prompt?.role === 'system')
    .map((prompt) => flattenDeepInfraContent(prompt?.content))
    .filter(Boolean)
  const systemContent = [system, ...embeddedSystem].filter(Boolean).join('\n\n')

  const messages = prompts
    .filter((prompt) => prompt?.role !== 'system')
    .map((prompt) => ({
      role: prompt?.role === 'assistant' ? 'assistant' : 'user',
      content: flattenDeepInfraContent(prompt?.content),
    }))
    .filter((prompt) => prompt.content)

  if (systemContent) {
    const firstUserMessage = messages.find((message) => message.role === 'user')
    if (firstUserMessage) {
      firstUserMessage.content = `${systemContent}\n\n${firstUserMessage.content}`
    } else {
      messages.unshift({ role: 'user', content: systemContent })
    }
  }

  if (!messages.length) {
    // Malformed history replays (e.g. {type:'text'} parts without `text`)
    // flattened to nothing, producing messages:[] which every OpenAI-compatible
    // endpoint rejects with a chat-template 400 ("template error: list object
    // has no element 0"). Keep a placeholder so a degraded run can proceed
    // instead of burning retries + fallback + crash risk.
    const placeholder = prompts
      .filter((p) => p?.role !== 'system')
      .map(() => '[no textual content]')
    if (placeholder.length) {
      messages.push({ role: 'user', content: placeholder.join('\n\n') })
    }
  }

  return messages.reduce((merged, message) => {
    const previous = merged[merged.length - 1]
    if (previous?.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`
    } else {
      merged.push(message)
    }
    return merged
  }, [])
}

export function toDeepInfraTools(functions = []) {
  return functions.map((definition) => ({
    type: 'function',
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    },
  }))
}

export function toDeepInfraToolChoice(functionCall) {
  if (!functionCall?.name) return undefined
  return {
    type: 'function',
    function: { name: functionCall.name },
  }
}

export function getDeepInfraToolArguments(message) {
  return (
    message?.tool_calls?.[0]?.function?.arguments ||
    message?.function_call?.arguments ||
    message?.content
  )
}
