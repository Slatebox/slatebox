// The kinds of slate the welcome flow offers the agent (setIntention's intentionId), in code.
// Pure: no Meteor, no database. openai.js lists them in the welcome prompt and hands the chosen
// one to the client, which runs it (initAIConversation). One kind is the default (a topic with no
// other fit), and one fills a loaded template (basedOnTemplate).
import KINDS from './generation-kinds-data.mjs'

const byId = new Map(KINDS.map((kind) => [kind._id, kind]))

/** Every kind the welcome prompt offers, in the order it numbers them. Copies: callers may edit. */
export const generationKinds = () => KINDS.map((kind) => structuredClone(kind))

/** The kind with this id (a copy), or null when there is none. */
export const generationKind = (id) => (typeof id === 'string' && byId.has(id) ? structuredClone(byId.get(id)) : null)

/** The kind used when nothing else fits. */
export const defaultGenerationKind = () => structuredClone(KINDS.find((kind) => kind.isDefault))

/** The kind that fills a loaded template's categories. */
export const templateGenerationKind = () => structuredClone(KINDS.find((kind) => kind.basedOnTemplate))

/** What the agent must and may gather for a kind, as one sentence of the welcome menu. */
export function gatherSentence(kind) {
  if (!kind.gather) return ''
  const intro = kind.gather.message || ''
  const items = (required) => kind.gather.items
    .filter((item) => Boolean(item.required) === required)
    .map((item) => `${item.key}: ${item.placeholder}`)
    .filter((item) => item.trim() !== '')
    .join(', ')
  const requiredItems = items(true)
  const optionalItems = items(false)
  let sentence = `${intro} `
  if (requiredItems.length) sentence = `You must gather the following intentionItems from the user: ${requiredItems}`
  if (optionalItems.length) sentence += `; these intentionItems are optional: ${optionalItems}`
  return sentence
}

/**
 * The welcome prompt with its menu filled in: {intentionsAvailable} (the kinds, numbered),
 * {topAvailableTemplates}, {defaultIntentionId}, {templateIntentionId} and {templateCount}, every
 * time each appears. A kind's own {{tokens}} fill later from gather values, so the menu shows them
 * as the word "template".
 */
export function fillWelcomePrompt({ body, kinds, templates = [] }) {
  const menu = kinds
    .map((kind, i) => `(${i + 1}) ${kind.name} (intentionId: ${kind._id}) - ${kind.details.trim()}. ${gatherSentence(kind)}`
      .trim()
      .replace(/\{\{[a-zA-Z]+\}\}/g, 'template'))
    .join('; ')
  const examples = templates
    .slice(0, 10)
    .map((t, i) => `(${i}) ${t.options.name} - ${t.options.description.trim()}, (id: ${t.shareId})`.trim())
    .join('; ')
  return body
    .replaceAll('{intentionsAvailable}', menu)
    .replaceAll('{topAvailableTemplates}', examples)
    .replaceAll('{defaultIntentionId}', defaultGenerationKind()._id)
    .replaceAll('{templateIntentionId}', templateGenerationKind()._id)
    .replaceAll('{templateCount}', String(templates.length))
    .trim()
}
