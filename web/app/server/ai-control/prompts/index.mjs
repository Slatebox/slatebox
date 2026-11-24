// Every prompt Slatebox's own AI paths send, one registry (registry.mjs), version 0 in the files
// beside this one, one per surface. Call sites ask for text by id: promptText('shape.system', { count }).
// index.mjs (ai-control, Meteor) plugs the snapshot in as the source of published versions.
import { createPromptRegistry } from './registry.mjs'
import shape from './shape.mjs'
import workshop from './workshop.mjs'
import exec from './exec.mjs'
import agent from './agent.mjs'
import presentation from './presentation.mjs'
import library from './library.mjs'

export const prompts = createPromptRegistry([shape, workshop, exec, agent, presentation, library])

/** The text a call site sends for a prompt: a pinned or published version, else version 0. */
export const promptText = (id, values) => prompts.text(id, values)
/** The built-in text (version 0) of a prompt. */
export const codePromptText = (id, values) => prompts.code(id, values)
/** The version a call would use now, as `id@v<n>` (for the audit trail and frozen copies). */
export const promptRef = (id) => `${id}@v${prompts.resolved(id).version}`

export const CODE_PROMPTS = prompts.codePrompts
export const CODE_SLOTS = prompts.codeSlots
export const PROMPT_IDS = Object.freeze(prompts.ids())
