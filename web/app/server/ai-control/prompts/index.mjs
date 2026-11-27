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
import connectors from './connectors.mjs'
import interview from './interview.mjs'
import personal from './personal.mjs'
import voice from './voice.mjs'
import profileSources from './profile-sources.mjs'
import profileImport from './profile-import.mjs'
import start from './start.mjs'

export const prompts = createPromptRegistry([shape, workshop, exec, agent, presentation, library, connectors, interview, personal, voice, profileSources, profileImport, start])

/** The text a call site sends for a prompt: a pinned or published version, else version 0. */
export const promptText = (id, values) => prompts.text(id, values)
/** The built-in text (version 0) of a prompt. */
export const codePromptText = (id, values) => prompts.code(id, values)
/** The version a call would use now, as `id@v<n>` (for the audit trail and frozen copies). */
export const promptRef = (id) => `${id}@v${prompts.resolved(id).version}`

/**
 * The versions of a surface's prompts that are not the built-in text, as one short string ('' while
 * every one is built in). A result kept for reuse (a shape's candidates, a presentation's plan)
 * adds it to its key, so a publish or rollback is not hidden behind an answer the old text gave,
 * and keys made with the built-in text stay as they were.
 */
export const promptsKey = (surface) => prompts.list
  .filter((p) => p.surface === surface)
  .map((p) => [p.id, prompts.resolved(p.id).version])
  .filter(([, version]) => version > 0)
  .map(([id, version]) => `${id}@v${version}`)
  .join(',')

export const CODE_PROMPTS = prompts.codePrompts
export const CODE_SLOTS = prompts.codeSlots
export const PROMPT_IDS = Object.freeze(prompts.ids())
