// Catalog-driven welcome routing.
//
// The welcome assistant's system prompt historically ALWAYS advertised the
// template intention + the previewTemplate/expandTemplates tools. Live audit
// (iteration 14): the user-selectable template catalog is EMPTY in every
// deployed environment (the only seeded isTemplate slate is the Theme
// Generator, which userSelectableTemplateSelector excludes). So the prompt
// said "sticky-note driven ideas … use {templateIntentionId}" while that
// intention had zero content to work with — a designed dead end: welcome
// picked Template Population, the client kick had no template content, and
// the run ended in a contentless kick (pre-v3) or the clean abort (post
// iteration 11). Neither generates.
//
// With an empty catalog we now prune template routing ENTIRELY from the
// prompt (capability line, routing sentences, tools, and the
// basedOnTemplate intention from the available menu) and redirect
// sticky-note/whiteboard requests to the DEFAULT intention
// (expert-collaborator), which demonstrably generates.
//
// The moment a real approved template is seeded, the un-pruned prompt +
// tools come back automatically (the caller only prunes when the catalog
// query returns zero rows).

const TEMPLATE_SENTENCE_PATTERNS = [
  // "Group collaborations on templates (0 available, e.g. )" / "(N available - Examples: ...)"
  [/Group collaborations on (?:pre-made )?[Tt]emplates \([^)]*\)\.?\s*/g, ''],
  [/Templates \(\{templateCount\} available - Examples: \{topAvailableTemplates\}\)\.?\s*/g, ''],
  [
    /Sticky-note driven ideas \(where you'd want to whiteboard ideas on sticky notes\) will always require the \{templateIntentionId\} template\.?\s*/gi,
    'Sticky-note driven whiteboarding requests use the {defaultIntentionId} intention directly. ',
  ],
  [
    /For sticky-note driven whiteboarding, use \{templateIntentionId\}\.?\s*/gi,
    'For sticky-note driven whiteboarding, use {defaultIntentionId}. ',
  ],
  [
    /For template exploration[^\n]*?instructions\.\s*/gi,
    'Templates are currently unavailable; never mention templates. ',
  ],
  [/For templates, ONLY use:?\s*\{templateIntentionId\}\.?\s*/gi, ''],
  [/For templates: \{templateIntentionId\};\s*/gi, ''],
  // Anything that still names the template tools after the blocks above.
  [/Use (?:expandTemplates|previewTemplate)[^.]*\.\s*/gi, ''],
]

export function pruneEmptyTemplateCatalog({
  templateCount,
  body,
  functions,
  intentions,
} = {}) {
  if (typeof templateCount === 'number' && templateCount > 0) {
    // Non-empty catalog: the template product is intact — change nothing.
    return { body, functions, intentions }
  }
  let prunedBody = body || ''
  for (const [pattern, replacement] of TEMPLATE_SENTENCE_PATTERNS) {
    prunedBody = prunedBody.replace(pattern, replacement)
  }
  const prunedFunctions = (functions || []).filter(
    (f) => !['previewTemplate', 'expandTemplates'].includes(f?.name)
  )
  const prunedIntentions = (intentions || []).filter((i) => !i?.basedOnTemplate)
  return { body: prunedBody, functions: prunedFunctions, intentions: prunedIntentions }
}
/**
 * Deterministic template resolution for the FORCED-setIntention wizard path.
 *
 * Wizard entry points force function_call: setIntention, so the assistant
 * CANNOT explore via expandTemplates first — and the tool description told it
 * to only send a shareId it already had. Result: users who explicitly named a
 * template ("Use the Pro/Con Analysis template for…") got their request
 * stuffed into prose and the journey degraded to a contentless fill.
 *
 * When the model omits slateTemplateId but the request text names a catalog
 * template (case-insensitive substring), resolve it server-side. Only real,
 * selector-valid catalog entries can win.
 */
export function resolveTemplateFromText(templates, text) {
  if (!text || !templates?.length) return null
  const hay = String(text).toLowerCase()
  const hit = templates.find(
    (t) =>
      t.options?.name &&
      t.options.name.length >= 4 &&
      hay.includes(t.options.name.toLowerCase())
  )
  return hit ? hit.shareId : null
}
