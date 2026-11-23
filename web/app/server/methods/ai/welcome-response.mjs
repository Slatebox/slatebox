import { operationPlanRetryPrompt, validatePlan } from 'slateboxjs/operations'

export const WELCOME_INSTRUCTION_MIN_WORDS = 60

export function resolveWelcomeFunctionCall(content, defaultChoice) {
  const latestContent = Array.isArray(content)
    ? content.findLast((part) => typeof part === 'string')
    : content

  if (latestContent?.trim().endsWith('!!')) {
    return { name: 'setIntention' }
  }
  return defaultChoice
}

export function validateWelcomeResponse(
  { toolCall } = {},
  {
    userMessage = '',
    existingNodeIds = [],
    requireSetIntention = false,
  } = {}
) {
  if (toolCall?.name === 'applySlateOperations') {
    const validation = validatePlan(toolCall.arguments, {
      userMessage,
      existingNodeIds,
    })
    if (validation.valid) return null
    return {
      code: 'slateOperationPlanInvalid',
      retryPrompt: operationPlanRetryPrompt(validation.errors),
    }
  }
  if (requireSetIntention && toolCall?.name !== 'setIntention') {
    return {
      code: 'welcomeIntentionRequired',
      retryPrompt:
        'This is a one-shot onboarding request. Call setIntention now with the best matching intention, complete intentionItems, and detailed instructions. Do not reply in plain text and do not ask for confirmation.',
    }
  }
  if (toolCall?.name !== 'setIntention') return null

  const instructions = toolCall.arguments?.instructions
  const wordCount =
    typeof instructions === 'string' && instructions.trim()
      ? instructions.trim().split(/\s+/).length
      : 0

  if (wordCount >= WELCOME_INSTRUCTION_MIN_WORDS) return null

  return {
    code: 'welcomeInstructionsTooShort',
    retryPrompt: `Call setIntention again. Its instructions contained ${wordCount} words, but Slatebox requires at least ${WELCOME_INSTRUCTION_MIN_WORDS}. Return a detailed 60 to 120 word implementation brief covering structure, content, hierarchy, visual treatment, relationships, and constraints.`,
  }
}

export function validateSlateMessageRoute(
  { toolCall } = {},
  { userMessage = '', existingNodeIds = [] } = {}
) {
  if (toolCall?.name === 'delegateToConversation') return null
  if (toolCall?.name === 'applySlateOperations') {
    const validation = validatePlan(toolCall.arguments, {
      userMessage,
      existingNodeIds,
    })
    if (validation.valid) return null
    return {
      code: 'slateOperationPlanInvalid',
      retryPrompt: operationPlanRetryPrompt(validation.errors),
    }
  }
  return {
    code: 'slateMessageRouteMissing',
    retryPrompt:
      'Call applySlateOperations for a direct slate edit, or delegateToConversation for discussion and content generation. Do not answer in plain text.',
  }
}
