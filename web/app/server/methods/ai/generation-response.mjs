function validationError(code, retryPrompt) {
  return { code, retryPrompt }
}

function validateNodeCollection(nodes, collectionName, seenIds) {
  if (nodes == null) return null
  if (!Array.isArray(nodes)) {
    return validationError(
      `generation${collectionName}Invalid`,
      `Call respond again with ${collectionName.toLowerCase()} as an array.`
    )
  }

  return (
    nodes
      .map((node) => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) {
          return validationError(
            'generationNodeInvalid',
            `Every ${collectionName.toLowerCase()} item must be an object.`
          )
        }

        if (
          typeof node.id !== 'string' ||
          !node.id.trim() ||
          node.id.trim().toLowerCase() === 'main' ||
          typeof node.description !== 'string' ||
          !node.description.trim() ||
          typeof node.isUpdate !== 'boolean'
        ) {
          return validationError(
            'generationNodeInvalid',
            'Every category and note must include a unique non-main id, a non-empty description, and a boolean isUpdate value.'
          )
        }

        const normalizedId = node.id.trim().toLowerCase()
        if (seenIds.has(normalizedId)) {
          return validationError(
            'generationDuplicateNodeId',
            'Call respond again with a unique id for every category and note.'
          )
        }
        seenIds.add(normalizedId)

        if (
          !Array.isArray(node.parentCategoryIds) ||
          node.parentCategoryIds.some(
            (parentId) => typeof parentId !== 'string' || !parentId.trim()
          )
        ) {
          return validationError(
            'generationParentReferencesInvalid',
            'Every category and note must include parentCategoryIds as an array of non-empty ids. Use main for the root topic.'
          )
        }
        return null
      })
      .find(Boolean) || null
  )
}

function validateDeleteIds(value, propertyName) {
  if (value == null) return null
  if (
    !Array.isArray(value) ||
    value.some((id) => typeof id !== 'string' || !id.trim())
  ) {
    return validationError(
      'generationDeleteIdsInvalid',
      `${propertyName} must be an array of non-empty ids.`
    )
  }
  return null
}

export function normalizeGenerationParentIds(
  parentCategoryIds = [],
  {
    mainNodeId,
    noteIds = [],
    forceNoteParents = false,
    attachOrphansToMain = false,
  } = {}
) {
  const normalizedNoteIds = new Set(
    noteIds.map((noteId) => `${noteId}`.replace(/^(note_|category_)/, ''))
  )
  const normalizedParents = [
    ...new Set(
      parentCategoryIds
        .filter((parentId) => typeof parentId === 'string' && parentId.trim())
        .map((parentId) => {
          const rawParentId = parentId.trim()
          const unprefixedParentId = rawParentId.replace(
            /^(note_|category_)/,
            ''
          )
          if (['none', 'null'].includes(unprefixedParentId.toLowerCase())) {
            return null
          }
          if (
            ['main', 'main_category'].includes(
              unprefixedParentId.toLowerCase()
            )
          ) {
            return mainNodeId || 'category_main'
          }
          const prefix =
            forceNoteParents || normalizedNoteIds.has(unprefixedParentId)
              ? 'note_'
              : 'category_'
          return `${prefix}${unprefixedParentId}`
        })
        .filter(Boolean)
    ),
  ]
  if (
    normalizedParents.length === 0 &&
    attachOrphansToMain &&
    mainNodeId
  ) {
    return [mainNodeId]
  }
  return normalizedParents
}

export function shouldAttachGenerationOrphansToMain({
  mainNodeId,
  isAdhoc,
  layoutType,
} = {}) {
  return Boolean(mainNodeId) && !isAdhoc && layoutType?.val !== 'none'
}

export default function validateGenerationResponse({ toolCall } = {}) {
  if (toolCall?.name !== 'respond') {
    return validationError(
      'generationToolMissing',
      'Call the respond tool now. Do not answer with plain text.'
    )
  }

  const args = toolCall.arguments
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return validationError(
      'generationArgumentsInvalid',
      'Call respond again with one valid JSON object as its arguments.'
    )
  }

  if (typeof args.suggestion !== 'string' || !args.suggestion.trim()) {
    return validationError(
      'generationSuggestionMissing',
      'Call respond again and include a concise, non-empty suggestion.'
    )
  }

  const seenIds = new Set()
  return (
    validateNodeCollection(args.categories, 'Categories', seenIds) ||
    validateNodeCollection(args.notes, 'Notes', seenIds) ||
    validateDeleteIds(args.deleteCategoryIds, 'deleteCategoryIds') ||
    validateDeleteIds(args.deleteNoteIds, 'deleteNoteIds') ||
    null
  )
}
